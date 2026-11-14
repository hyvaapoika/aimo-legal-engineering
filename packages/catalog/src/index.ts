import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import {
  DomainError,
  productSchema,
  type Product,
  type SearchInput,
} from "@aimo/schema";

const localized = z
  .array(z.object({ value: z.string(), language: z.string() }))
  .default([]);
const measurement = z.object({ value: z.number(), unit: z.string() });
const rawProduct = z.object({
  id: z.string(),
  salesUnit: z.string(),
  baseUnit: z.string(),
  category: z.string(),
  allowedLotSize: z.number().positive(),
  deleted: z.boolean(),
  salesUnitGtin: z.string().optional(),
  countryOfOrigin: z.string().optional(),
  temperatureCondition: z.number().optional(),
  units: z
    .array(
      z.object({
        unitId: z.string(),
        sizeInBaseUnits: z.number(),
        gtin: z.string().optional(),
      }),
    )
    .default([]),
  substitutions: z
    .array(z.object({ substituteProduct: z.string() }))
    .default([]),
  synkkaData: z
    .object({
      names: z
        .array(z.object({ value: z.string(), language: z.string() }))
        .default([]),
      brand: z.string().default(""),
      marketingTexts: localized,
      keyIngredients: localized,
      preparationInstructions: localized,
      usageInstructions: localized,
      storageInstructions: localized,
      lastUpdated: z.string().optional(),
      medias: z
        .array(z.object({ id: z.number().int(), primary: z.boolean() }))
        .default([]),
      nutritionalContent: z
        .array(
          z.object({
            id: z.string(),
            value: z.number(),
            unit: z.string(),
            basisQuantity: z.number().optional(),
            basisQuantityUnit: z.string().optional(),
          }),
        )
        .default([]),
      classifications: z
        .array(
          z.object({
            name: z.string(),
            values: z
              .array(z.object({ id: z.string(), unit: z.string().optional() }))
              .default([]),
          }),
        )
        .default([]),
      unitConversions: z
        .array(
          z.object({
            synkkaPackagingType: z.string().optional(),
            volume: measurement.optional(),
            netWeight: measurement.optional(),
          }),
        )
        .default([]),
    })
    .default({
      names: [],
      brand: "",
      marketingTexts: [],
      keyIngredients: [],
      preparationInstructions: [],
      usageInstructions: [],
      storageInstructions: [],
      medias: [],
      nutritionalContent: [],
      classifications: [],
      unitConversions: [],
    }),
});
type RawProduct = z.infer<typeof rawProduct>;
function netContent(raw: RawProduct): Product["netContent"] {
  if (raw.baseUnit === "KG") return { value: 1, unit: "KG", inferred: false };
  if (raw.baseUnit === "L") return { value: 1, unit: "L", inferred: false };
  const base = raw.synkkaData.unitConversions.find(
    (x) => x.synkkaPackagingType === "BASE_UNIT_OR_EACH",
  );
  const value = base?.volume ?? base?.netWeight;
  const units: Record<string, { unit: "L" | "KG"; factor: number }> = {
    LTR: { unit: "L", factor: 1 },
    MLT: { unit: "L", factor: 0.001 },
    KGM: { unit: "KG", factor: 1 },
    GRM: { unit: "KG", factor: 0.001 },
  };
  if (value && units[value.unit] && value.value > 0)
    return {
      value: value.value * units[value.unit]!.factor,
      unit: units[value.unit]!.unit,
      inferred: false,
    };
  // Name parsing is deliberately conservative. Multipacks and variable-weight names remain unknown.
  const name =
    raw.synkkaData.names.find((n) => n.language === "fi")?.value ?? "";
  if (/\d\s*[x×]|\bn\.|noin|apx|approx/i.test(name)) return undefined;
  const match = name.match(/\b(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l)\b/i);
  if (!match) return undefined;
  const unit = match[2]!.toLowerCase();
  return {
    value:
      Number(match[1]!.replace(",", ".")) *
      ({ g: 0.001, ml: 0.001, cl: 0.01 }[unit] ?? 1),
    unit: ["kg", "g"].includes(unit) ? "KG" : "L",
    inferred: true,
  };
}
export async function loadCatalog(dataDir: string): Promise<Catalog> {
  const [raw, reliabilityCsv, carbonCsv] = await Promise.all(
    ["products.json", "delivery_reliability.csv", "carbon_footprint.csv"].map(
      (file) => readFile(join(dataDir, file), "utf8"),
    ),
  );
  const signals = (csv: string, column: string) =>
    new Map(
      (
        parse(csv, {
          columns: true,
          skip_empty_lines: true,
          bom: true,
        }) as Record<string, string>[]
      )
        .filter((r) => r[column]?.trim() && Number.isFinite(Number(r[column])))
        .map((r) => [r.productId!, Number(r[column])]),
    );
  const reliability = signals(reliabilityCsv!, "deliveryReliability");
  const carbon = signals(carbonCsv!, "AVG kg CO2-eq/kg");
  const products: Product[] = [];
  for (const input of JSON.parse(raw!) as unknown[]) {
    const p = rawProduct.parse(input);
    if (p.deleted) continue;
    const values = (name: string) =>
      p.synkkaData.classifications
        .filter((c) => c.name === name)
        .flatMap((c) => c.values);
    const allergens = values("allergen")
      .filter((v) => v.unit !== "FREE_FROM")
      .map((v) => v.id);
    const free = values("nonAllergen")
      .filter((v) => v.unit === "FREE_FROM" && !allergens.includes(v.id))
      .map((v) => v.id);
    const texts = (rows: { language: string; value: string }[]) =>
      Object.fromEntries(
        [...new Set(rows.map((r) => r.language))].map((lang) => [
          lang,
          rows
            .filter((r) => r.language === lang)
            .map((r) => r.value.trim())
            .join("\n"),
        ]),
      );
    const packs = p.units.filter((unit) => unit.sizeInBaseUnits > 0);
    if (!packs.some((u) => u.unitId === p.baseUnit))
      packs.push({ unitId: p.baseUnit, sizeInBaseUnits: 1 });
    products.push(
      productSchema.parse({
        id: p.id,
        names: Object.fromEntries(
          p.synkkaData.names.map((n) => [n.language, n.value.trim()]),
        ),
        brand: p.synkkaData.brand,
        category: p.category,
        salesUnit: p.salesUnit,
        baseUnit: p.baseUnit,
        gtin: p.salesUnitGtin,
        packs,
        allowedLotSize: p.allowedLotSize,
        netContent: netContent(p),
        claims: values("nutritionalClaim").map((v) => v.id),
        allergens,
        allergenFree: free,
        substitutions: p.substitutions.map((s) => s.substituteProduct),
        temperatureCondition: p.temperatureCondition,
        details: {
          descriptions: texts(p.synkkaData.marketingTexts),
          ingredients: texts(p.synkkaData.keyIngredients),
          preparation: texts(p.synkkaData.preparationInstructions),
          usage: texts(p.synkkaData.usageInstructions),
          storage: texts(p.synkkaData.storageInstructions),
          media: p.synkkaData.medias,
          nutrition: p.synkkaData.nutritionalContent,
          origin: p.countryOfOrigin,
          updatedAt: p.synkkaData.lastUpdated,
        },
        reliability: reliability.get(p.id),
        carbonKgPerKg: carbon.get(p.id),
      }),
    );
  }
  return new Catalog(products);
}
const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-™®]/g, " ");
export class Catalog {
  readonly byId: Map<string, Product>;
  private readonly text: Map<string, string>;
  constructor(public readonly products: Product[]) {
    this.byId = new Map(products.map((p) => [p.id, p]));
    this.text = new Map(
      products.map((p) => [
        p.id,
        normalize(
          `${p.id} ${Object.values(p.names).join(" ")} ${p.brand} ${p.claims.join(" ")}`,
        ),
      ]),
    );
  }
  get(id: string): Product {
    const p = this.byId.get(id);
    if (!p)
      throw new DomainError(
        "PRODUCT_NOT_FOUND",
        `Product ${id} is not in the supplied catalog.`,
        404,
      );
    return p;
  }
  search(input: SearchInput): Product[] {
    const tokens = normalize(input.query).split(/\s+/).filter(Boolean);
    return this.products
      .filter(
        (p) =>
          (!input.category || p.category === input.category) &&
          input.claims.every((c) => p.claims.includes(c)) &&
          input.allergenFree.every((a) => p.allergenFree.includes(a)) &&
          tokens.every((t) => this.text.get(p.id)!.includes(t)),
      )
      .map((p) => ({
        p,
        score:
          (p.id === input.query ? 1000 : 0) +
          (normalize(p.names.en ?? "").includes(normalize(input.query))
            ? 2
            : 0) +
          (tokens.includes("milk") && p.category === "10400" ? 20 : 0) +
          (tokens.includes("lactose") &&
          tokens.includes("free") &&
          p.claims.includes("FREE_FROM_LACTOSE")
            ? 8
            : 0) +
          (p.salesUnit === "ST" ? 2 : 0) +
          (p.netContent?.unit === "L" && p.netContent.value === 1 ? 2 : 0) +
          (p.brand === "Valio" ? 1 : 0),
      }))
      .sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id))
      .slice(0, input.limit)
      .map((x) => x.p);
  }
  substitutes(
    id: string,
    claims: string[] = [],
    allergenFree: string[] = [],
    limit = 3,
  ) {
    const source = this.get(id);
    return this.products
      .filter(
        (p) =>
          p.id !== id &&
          (source.substitutions.includes(p.id) ||
            p.category === source.category) &&
          claims.every((c) => p.claims.includes(c)) &&
          allergenFree.every((a) => p.allergenFree.includes(a)),
      )
      .map((p) => ({
        product: p,
        explicit: source.substitutions.includes(p.id),
        score:
          (source.substitutions.includes(p.id) ? 10 : 0) +
          (source.claims.every((c) => p.claims.includes(c)) ? 2 : 0) +
          (p.reliability ?? 0) -
          (p.carbonKgPerKg === undefined ? 0 : p.carbonKgPerKg / 100),
        rationale: `${source.substitutions.includes(p.id) ? "Supplier-listed substitute" : "Same category; human approval may be required"}. ${p.reliability === undefined ? "Reliability unknown" : `${(p.reliability * 100).toFixed(1)}% historical delivery reliability`}; ${p.carbonKgPerKg === undefined ? "carbon footprint unknown" : `${p.carbonKgPerKg.toFixed(2)} kg CO₂e/kg`}.`,
      }))
      .sort(
        (a, b) => b.score - a.score || a.product.id.localeCompare(b.product.id),
      )
      .slice(0, limit);
  }
}

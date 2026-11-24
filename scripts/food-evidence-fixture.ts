import { readFile } from "node:fs/promises";
import { Catalog } from "@aimo/catalog";
import { createDatabase } from "@aimo/database";
import { generateKeys, Signer } from "@aimo/signing";
import { MockValioClient } from "@aimo/valio-client";
import {
  supplierDeclarationSchema,
  type Product,
  type ProposalInput,
} from "@aimo/schema";
import { defaultMandate, GatewayService } from "../apps/gateway/src/service.js";

export const fixtureTime = new Date("2026-11-16T09:00:00Z");
export const fixtureProduct: Product = {
  id: "DEMO-PASTA-001",
  names: { en: "Fictional dry pasta" },
  brand: "Demo Mill",
  category: "demo-pasta",
  salesUnit: "ST",
  baseUnit: "ST",
  packs: [{ unitId: "ST", sizeInBaseUnits: 1 }],
  allowedLotSize: 1,
  claims: [],
  allergenFree: [],
  allergens: [],
  substitutions: [],
};
export async function loadFixtureDeclaration(name: "declared" | "withdrawn") {
  const url = new URL(
    `../data/fixtures/food-evidence/${name}.json`,
    import.meta.url,
  );
  return supplierDeclarationSchema.parse(
    JSON.parse(await readFile(url, "utf8")),
  );
}

export async function foodEvidenceFixture() {
  const db = await createDatabase();
  try {
    const keys = await generateKeys();
    const catalog = new Catalog([structuredClone(fixtureProduct)]);
    const service = new GatewayService(
      db,
      catalog,
      new MockValioClient({ [fixtureProduct.id]: { unitPrice: 10 } }),
      new Signer(keys.privateKey, keys.publicKey),
      () => fixtureTime,
    );
    const mandate = defaultMandate([fixtureProduct.category], fixtureTime);
    mandate.limits.perOrder = 100;
    mandate.requireEggDeclaration = true;
    const { agent: registered, credentials } = await service.register(
      "Demo kitchen",
      mandate,
    );
    const agent = await service.agent(registered.id);
    const requestedDate = "2026-11-17";
    const { offers } = await service.getOffers(agent, {
      productIds: [fixtureProduct.id],
      requestedDate,
    });
    const offer = offers[0]!;
    const request = (idempotencyKey: string, qty = 12): ProposalInput => ({
      requestedDate,
      deliverySite: mandate.deliverySites[0]!,
      idempotencyKey,
      requirementRef: "Tuesday pasta service",
      lines: [
        {
          productId: offer.productId,
          offerId: offer.id,
          salesUnit: offer.product.salesUnit,
          qty,
          requiredClaims: [],
          allergenFree: [],
        },
      ],
    });
    return { service, agent, credentials, request };
  } catch (error) {
    await db.close();
    throw error;
  }
}

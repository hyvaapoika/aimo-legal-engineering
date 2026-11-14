import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { DomainError, type Agent } from "@aimo/schema";
import { present, hasClaim, normalize, productType } from "@aimo/discovery";
import { sha256, canonical } from "@aimo/signing";
import { append } from "@aimo/ledger";
import recipes from "../../../../packages/discovery/src/recipes-data.json";
import {
  profileInputSchema,
  startSchema,
  patchSchema,
  exportSchema,
  type KitchenProfile,
  type PurchasePlan,
  type PlanRow,
  type KitchenIntent,
  type ShopProduct,
} from "../../../../packages/purchasing/src/contracts";
import {
  candidate,
  packs,
  step,
  offerIssue,
} from "../../../../packages/purchasing/src/quantities";
import { interpretKitchen, type Interpreter } from "./interpret";
import type { GatewayService } from "../service";
function fail(code: string, message: string, status = 400): never {
  throw new DomainError(code, message, status);
}
export function publicPlan(plan: PurchasePlan) {
  const {
    offers: _offers,
    fingerprint: _fingerprint,
    key: _key,
    ...view
  } = plan;
  return view;
}
export class KitchenAgent {
  constructor(
    readonly service: GatewayService,
    readonly interpret: Interpreter = interpretKitchen,
  ) {}
  private pk(agent: Agent, id: string) {
    return `${agent.customerId}:${id}`;
  }
  async profiles(agent: Agent) {
    const profiles = await Promise.all(
      (["lunch", "hotel"] as const).map((id) => this.profile(agent, id)),
    );
    const ids = [
      ...new Set(
        profiles.flatMap((p) =>
          p.preferences.flatMap((x) => [x.productId, ...x.alternatives]),
        ),
      ),
    ];
    return {
      profiles,
      products: ids.map((id) => present(this.service.catalog.get(id))),
      recipes,
    };
  }
  async profile(agent: Agent, id: "lunch" | "hotel"): Promise<KitchenProfile> {
    const saved = await this.service.db.transaction((r) =>
      r.get<{ profile: KitchenProfile }>(
        "kitchen_profiles",
        this.pk(agent, id),
      ),
    );
    return (
      saved?.profile ?? {
        id,
        customerId: agent.customerId,
        revision: 0,
        updatedAt: this.service.now().toISOString(),
        name: id === "lunch" ? "Lunch kitchen" : "Hotel breakfast",
        claims: [],
        budgetPerPortion: null,
        preferences:
          id === "hotel"
            ? [
                {
                  key: "breakfast yoghurt",
                  productId: "476824",
                  quantity: 20,
                  mode: "approved",
                  alternatives: ["476812"],
                },
                {
                  key: "breakfast butter",
                  productId: "475797",
                  quantity: 10,
                  mode: "exact",
                  alternatives: [],
                },
                {
                  key: "breakfast milk",
                  productId: "464201",
                  quantity: 24,
                  mode: "exact",
                  alternatives: [],
                },
              ]
            : [],
      }
    );
  }
  async saveProfile(agent: Agent, raw: unknown) {
    const input = profileInputSchema.parse(raw);
    if (
      new Set(input.preferences.map((p) => normalize(p.key))).size !==
      input.preferences.length
    )
      fail("DUPLICATE_PREFERENCE", "Give each preference a different name.");
    for (const p of input.preferences) {
      const source = this.service.catalog.get(p.productId);
      if (!new Decimal(p.quantity).mod(step(source)).isZero())
        fail("INVALID_QUANTITY", "Use legal whole sales packs in preferences.");
      for (const id of p.alternatives) {
        const next = this.service.catalog.get(id);
        if (
          next.category !== source.category ||
          productType(source) !== productType(next)
        )
          fail(
            "INVALID_ALTERNATIVE",
            "Approved alternatives must share the product type and supplier category.",
          );
      }
    }
    const profile: KitchenProfile = {
      ...input,
      customerId: agent.customerId,
      revision: input.revision + 1,
      updatedAt: this.service.now().toISOString(),
    };
    await this.service.db.transaction(async (repo) => {
      const old = await repo.get<{ profile: KitchenProfile }>(
        "kitchen_profiles",
        this.pk(agent, input.id),
      );
      if ((old?.profile.revision || 0) !== input.revision)
        fail(
          "STALE_PROFILE",
          "Preferences changed. Reload before saving.",
          409,
        );
      await repo.put("kitchen_profiles", {
        id: this.pk(agent, input.id),
        customerId: agent.customerId,
        profile,
      });
      await append(
        repo,
        {
          type: "kitchen.preferences.saved",
          customerId: agent.customerId,
          actor: { kind: "agent", id: agent.id },
          refs: {},
          payload: { profileId: input.id, revision: profile.revision },
        },
        this.service.now(),
      );
    });
    return profile;
  }
  async get(agent: Agent, id: string) {
    const plan = await this.service.db.transaction((r) =>
      r.get<PurchasePlan>("purchase_plans", id),
    );
    if (
      !plan ||
      plan.customerId !== agent.customerId ||
      plan.agentId !== agent.id
    )
      fail("PLAN_NOT_FOUND", "Plan not found.", 404);
    if (
      plan.status === "working" &&
      this.service.now().getTime() - Date.parse(plan.updatedAt) > 120000
    ) {
      return this.service.db.transaction(async (r) => {
        const current = await r.get<PurchasePlan>("purchase_plans", id);
        if (!current) fail("PLAN_NOT_FOUND", "Plan not found.", 404);
        if (
          current.status === "working" &&
          this.service.now().getTime() - Date.parse(current.updatedAt) > 120000
        ) {
          current.status = "failed";
          current.error = "Preparation was interrupted. Run the request again.";
          await r.put("purchase_plans", current);
        }
        return current;
      });
    }
    return plan;
  }
  private async persist(plan: PurchasePlan) {
    plan.updatedAt = this.service.now().toISOString();
    await this.service.db.transaction(async (r) => {
      const current = await r.get<PurchasePlan>("purchase_plans", plan.id);
      if (current?.revision !== plan.revision || current.status !== "working")
        fail("STALE_PLAN", "Plan changed while it was being prepared.", 409);
      await r.put("purchase_plans", plan);
    });
  }
  private async tool(plan: PurchasePlan, tool: string, label: string) {
    if (plan.events.length) plan.events[plan.events.length - 1]!.state = "done";
    plan.stage = label;
    plan.events.push({
      tool,
      label,
      state: "running",
      at: this.service.now().toISOString(),
    });
    await this.persist(plan);
  }
  private async failed(plan: PurchasePlan) {
    plan.status = "failed";
    plan.error =
      "The plan could not be prepared. Your basket has not changed. Please retry.";
    await this.persist(plan).catch(() => undefined);
  }
  async start(agent: Agent, raw: unknown) {
    const input = startSchema.parse(raw),
      profile = await this.profile(agent, input.profileId);
    if (!profile.revision)
      fail(
        "PROFILE_NOT_SAVED",
        "Review and save your kitchen preferences first.",
      );
    const prior = input.previousId
      ? await this.get(agent, input.previousId)
      : null;
    const fingerprint = sha256(canonical(input));
    const plan: PurchasePlan = {
      id: randomUUID(),
      customerId: agent.customerId,
      agentId: agent.id,
      key: input.key,
      fingerprint,
      profileId: profile.id,
      profileRevision: profile.revision,
      mandateVersion: agent.mandate.version,
      profile,
      revision: 1,
      text: input.text,
      date: input.date,
      inputKind: input.media
        ? input.media.mimeType.startsWith("image")
          ? "photo"
          : "voice"
        : "text",
      status: "working",
      stage: "Reading kitchen preferences",
      events: [],
      intent: null,
      interpretation: null,
      rows: [],
      issues: [],
      offers: {},
      totalCents: 0,
      portions: 0,
      costPerPortion: null,
      budgetExceeded: false,
      createdAt: this.service.now().toISOString(),
      updatedAt: this.service.now().toISOString(),
      error: null,
    };
    const existing = await this.service.db.transaction(async (r) => {
      const prior = (
        await r.all<PurchasePlan>("purchase_plans", agent.customerId)
      ).find((p) => p.agentId === agent.id && p.key === input.key);
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          fail(
            "IDEMPOTENCY_CONFLICT",
            "This request key was already used for another request.",
            409,
          );
        return prior;
      }
      const active = (
        await r.all<PurchasePlan>("purchase_plans", agent.customerId)
      ).filter(
        (p) =>
          p.status === "working" &&
          this.service.now().getTime() - Date.parse(p.updatedAt) < 120000,
      );
      if (active.length >= 2)
        fail("BUSY", "Wait for the current preparation to finish.", 429);
      await r.put("purchase_plans", plan);
      return null;
    });
    if (existing) return existing;
    void (async () => {
      await this.tool(
        plan,
        "getKitchenProfile",
        `Using ${profile.name} preferences`,
      );
      await this.tool(
        plan,
        "interpretRequest",
        input.media ? "Reading your attachment" : "Understanding your request",
      );
      const interpreted = await this.interpret(
        input,
        profile,
        prior?.intent ?? null,
      );
      plan.intent = intentSchemaCheck(interpreted.intent);
      plan.interpretation = interpreted.mode;
      await this.build(agent, plan);
    })().catch(() => this.failed(plan));
    return plan;
  }
  private requirements(agent: Agent, plan: PurchasePlan, extra: string[] = []) {
    return [
      ...new Set([
        ...agent.mandate.requiredClaims,
        ...plan.profile.claims,
        ...(plan.intent?.claims || []),
        ...extra,
      ]),
    ];
  }
  private recalc(plan: PurchasePlan) {
    const totals = new Map<string, { qty: Decimal; price: number }>();
    for (const row of plan.rows) {
      if (row.required === 0 && !row.pantryUnknown) {
        row.status = "covered";
        row.issue = null;
        continue;
      }
      const selected = row.candidates.find(
        (c) => c.product.id === row.selectedId,
      );
      if (selected) {
        let amount = row.required,
          unit: string = row.unit;
        if (
          row.unit === "sales" &&
          row.preferredId &&
          selected.product.id !== row.preferredId
        ) {
          const content = present(this.service.catalog.get(row.preferredId))
            .pack.content;
          if (!content || amount === null) amount = null;
          else {
            amount = new Decimal(amount).mul(content.value).toNumber();
            unit = content.unit;
          }
        }
        const requiredPacks = packs(amount, unit, selected.product);
        Object.assign(
          selected,
          candidate(
            selected.product,
            amount,
            unit,
            plan.offers[selected.product.id],
            plan.date,
            selected.reason,
            row.manualQty,
          ),
        );
        if (
          requiredPacks !== null &&
          selected.qty !== null &&
          selected.qty < requiredPacks
        )
          selected.issue = `At least ${requiredPacks} sales packs are needed for this quantity`;
      }
      row.issue = row.pantryUnknown
        ? "Confirm how much you already have"
        : selected
          ? selected.issue
          : row.exact
            ? "Your exact product is unavailable"
            : "Choose a product";
      row.status = row.issue ? "attention" : "ready";
      if (row.status === "ready" && selected) {
        const old = totals.get(selected.product.id);
        totals.set(selected.product.id, {
          qty: (old?.qty || new Decimal(0)).plus(selected.qty!),
          price: plan.offers[selected.product.id]!.price!.value,
        });
      }
    }
    plan.totalCents = [...totals.values()].reduce(
      (sum, x) =>
        sum +
        x.qty
          .mul(x.price)
          .mul(100)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .toNumber(),
      0,
    );
    plan.portions =
      plan.intent?.dishes.reduce((s, d) => s + d.portions, 0) || 0;
    plan.costPerPortion = plan.portions
      ? new Decimal(plan.totalCents)
          .div(100)
          .div(plan.portions)
          .toDecimalPlaces(2)
          .toNumber()
      : null;
    const caps = [
      plan.profile.budgetPerPortion,
      plan.intent?.budgetPerPortion,
    ].filter((n): n is number => typeof n === "number");
    const cap = caps.length ? Math.min(...caps) : null;
    plan.budgetExceeded =
      cap !== null &&
      plan.portions > 0 &&
      new Decimal(plan.totalCents).gt(
        new Decimal(cap).mul(plan.portions).mul(100),
      );
  }
  private async build(agent: Agent, plan: PurchasePlan) {
    const intent = plan.intent!;
    plan.rows = [];
    plan.offers = {};
    plan.issues = [...intent.unresolved];
    await this.tool(plan, "findRecipes", "Scaling sourced recipes");
    const groups = new Map<string, PlanRow>();
    for (const dish of intent.dishes) {
      const recipe = recipes.find((r) => r.id === dish.recipeId);
      if (!recipe) {
        plan.issues.push(`Choose a sourced recipe for ${dish.name}.`);
        continue;
      }
      const dishClaims = this.requirements(agent, plan, dish.claims);
      if (
        dishClaims.includes("VEGAN") ||
        dishClaims.includes("FREE_FROM_GLUTEN") ||
        (dishClaims.includes("VEGETARIAN") &&
          !recipe.tags.includes("vegetarian"))
      )
        plan.issues.push(
          `${recipe.title} is not verified for the requested dietary group. Choose a suitable sourced recipe or explicitly revise the requirement.`,
        );
      for (const ingredient of recipe.ingredients) {
        if (ingredient.water) continue;
        const key = normalize(ingredient.query),
          amount =
            ingredient.amountKg === null
              ? null
              : new Decimal(ingredient.amountKg)
                  .mul(dish.portions)
                  .div(recipe.basePortions)
                  .toNumber();
        const existing = groups.get(key);
        if (existing) {
          existing.required =
            amount === null || existing.required === null
              ? null
              : new Decimal(existing.required).plus(amount).toNumber();
          existing.claims = [
            ...new Set([
              ...existing.claims,
              ...this.requirements(agent, plan, dish.claims),
            ]),
          ];
          continue;
        }
        groups.set(key, {
          id: key,
          ingredient: ingredient.name,
          recipe: recipe.title,
          source: recipe.source,
          required: amount,
          unit: "KG",
          pantryUsed: 0,
          pantryUnknown: false,
          preferredId: ingredient.preferredIds[0] ?? null,
          exact: false,
          claims: this.requirements(agent, plan, dish.claims),
          candidates: [],
          selectedId: null,
          manualQty: null,
          status: "attention",
          issue: null,
        });
      }
    }
    for (const [index, item] of intent.items.entries()) {
      const pref = plan.profile.preferences.find(
        (p) =>
          normalize(p.key) === normalize(item.query) ||
          p.productId === item.query,
      );
      const id = `item-${index}`;
      groups.set(id, {
        id,
        ingredient:
          pref?.key ||
          (this.service.catalog.byId.has(item.query)
            ? this.service.catalog.get(item.query).names.en || item.query
            : item.query),
        recipe: null,
        source: null,
        required: item.quantity,
        unit: item.unit ?? "sales",
        pantryUsed: 0,
        pantryUnknown: false,
        preferredId:
          pref?.productId ??
          (this.service.catalog.byId.has(item.query) ? item.query : null),
        exact: pref
          ? pref.mode === "exact"
          : this.service.catalog.byId.has(item.query),
        claims: this.requirements(agent, plan),
        candidates: [],
        selectedId: null,
        manualQty: null,
        status: "attention",
        issue: null,
      });
      if (!item.unit)
        plan.issues.push(
          `Confirm the purchase unit for ${item.query}; it is currently shown as sales packs.`,
        );
    }
    plan.rows = [...groups.values()];
    if (plan.rows.length > 60)
      fail("TOO_MANY_INGREDIENTS", "Split this menu into fewer dishes.");
    const pantrySeen = new Set<string>();
    for (const pantry of intent.pantry) {
      if (pantrySeen.has(normalize(pantry.ingredient))) {
        plan.issues.push(
          `Pantry ingredient ${pantry.ingredient} was repeated. Keep one confirmed amount.`,
        );
        continue;
      }
      pantrySeen.add(normalize(pantry.ingredient));
      const needle = normalize(pantry.ingredient);
      let matching = plan.rows.filter(
        (r) => normalize(r.ingredient) === needle || r.id === needle,
      );
      if (!matching.length)
        matching = plan.rows.filter(
          (r) =>
            normalize(r.ingredient).includes(needle) || r.id.includes(needle),
        );
      if (matching.length !== 1) {
        plan.issues.push(
          `Specify which ingredient “${pantry.ingredient}” refers to before deducting pantry stock.`,
        );
        continue;
      }
      const row = matching[0]!;
      if (
        pantry.amountKg === null ||
        row.unit !== "KG" ||
        row.required === null
      ) {
        row.pantryUnknown = true;
        continue;
      }
      const used = Math.min(row.required, pantry.amountKg);
      row.pantryUsed += used;
      row.required = new Decimal(row.required).minus(used).toNumber();
    }
    await this.tool(
      plan,
      "searchProducts",
      "Matching ingredients to your catalogue",
    );
    for (const row of plan.rows) {
      const pref = plan.profile.preferences.find(
        (p) =>
          p.productId === row.preferredId ||
          normalize(p.key) === normalize(row.ingredient) ||
          normalize(p.key) === row.id,
      );
      if (pref) {
        row.preferredId = pref.productId;
        row.exact = pref.mode === "exact";
      }
      let ids: string[] = [];
      if (pref)
        ids = [
          pref.productId,
          ...(pref.mode === "approved" ? pref.alternatives : []),
        ];
      else if (row.exact && row.preferredId) ids = [row.preferredId];
      else {
        if (row.preferredId) ids.push(row.preferredId);
        const result = this.service.discovery.suggest({
          query: row.recipe ? row.id : row.ingredient,
          claims: row.claims,
          limit: 5,
        });
        ids.push(
          ...result.products
            .filter((p) => {
              if (!row.recipe) return true;
              const n = normalize(p.names.en || p.names.fi || "");
              if (
                /\b(chips|crisp|ketchup|candy|snack|soap|detergent|cleaner)\b/.test(
                  n,
                )
              )
                return false;
              if (
                row.id.includes("black pepper") &&
                /\b(sauce|potato|marinade|sausage)\b/.test(n)
              )
                return false;
              return true;
            })
            .map((p) => p.id),
        );
      }
      const source = row.preferredId
        ? this.service.catalog.get(row.preferredId)
        : null;
      const claims = [
        ...new Set([
          ...row.claims,
          ...(pref && source
            ? source.claims.filter(
                (c) =>
                  c.startsWith("FREE_FROM_") ||
                  ["VEGAN", "VEGETARIAN"].includes(c),
              )
            : []),
        ]),
      ];
      const free = [
        ...agent.mandate.allergenFree,
        ...(agent.mandate.allergenProfile === "strict"
          ? source?.allergenFree || []
          : []),
      ];
      row.candidates = [...new Set(ids)]
        .map((id) => this.service.catalog.get(id))
        .filter(
          (p) =>
            claims.every((c) => hasClaim(p, c)) &&
            free.every(
              (c) => p.allergenFree.includes(c) && !p.allergens.includes(c),
            ),
        )
        .slice(0, 5)
        .map((p) =>
          candidate(
            present(p),
            row.required,
            row.unit,
            undefined,
            plan.date,
            p.id === row.preferredId
              ? "Preferred product"
              : pref
                ? "Approved kitchen alternative"
                : "Catalogue match · review suitability",
          ),
        );
    }
    await this.tool(
      plan,
      "getOffers",
      "Checking prices and delivery availability",
    );
    const ids = [
      ...new Set(
        plan.rows.flatMap((r) => r.candidates.map((c) => c.product.id)),
      ),
    ];
    if (ids.length) {
      const result = await this.service.getOffers(agent, {
        productIds: ids,
        requestedDate: plan.date,
        includeSubstitutesFor: [],
      });
      plan.offers = Object.fromEntries(
        result.offers.map((o) => [o.productId, o]),
      );
    }
    await this.tool(
      plan,
      "evaluateSubstitution",
      "Applying kitchen rules and checking exceptions",
    );
    for (const row of plan.rows) {
      const source = row.preferredId
        ? present(this.service.catalog.get(row.preferredId))
        : null;
      row.candidates = row.candidates.map((c) => {
        let amount = row.required,
          unit = row.unit;
        if (row.unit === "sales" && source && c.product.id !== source.id) {
          const content = source.pack.content;
          if (!content || amount === null) {
            amount = null;
          } else {
            amount = new Decimal(amount).mul(content.value).toNumber();
            unit = content.unit as "KG" | "L";
          }
        }
        return candidate(
          c.product,
          amount,
          unit,
          plan.offers[c.product.id],
          plan.date,
          c.reason,
        );
      });
      const preferred = row.candidates.find(
        (c) => c.product.id === row.preferredId,
      );
      const choice = preferred?.available
        ? preferred
        : row.exact
          ? preferred
          : (row.candidates.find((c) => c.available) ??
            preferred ??
            row.candidates[0]);
      row.selectedId = choice?.product.id ?? null;
    }
    this.recalc(plan);
    await this.tool(plan, "prepareBasket", "Preparing your review");
    plan.status = "ready";
    plan.stage = "Ready for your review";
    plan.events.at(-1)!.state = "done";
    await this.persist(plan);
  }
  async update(agent: Agent, raw: unknown) {
    const input = patchSchema.parse(raw);
    let plan = await this.get(agent, input.id);
    if (plan.revision !== input.revision || plan.status !== "ready")
      fail("STALE_PLAN", "This plan changed. Reload it before editing.", 409);
    const profile = await this.profile(agent, plan.profileId);
    await this.service.db.transaction(async (repo) => {
      const latest = await repo.get<PurchasePlan>("purchase_plans", plan.id);
      if (latest?.revision !== input.revision || latest.status !== "ready")
        fail("STALE_PLAN", "This plan changed. Reload it before editing.", 409);
      plan = structuredClone(latest);
      plan.revision++;
      plan.updatedAt = this.service.now().toISOString();
      if (input.intent) {
        plan.intent = input.intent;
        plan.profile = profile;
        plan.profileRevision = profile.revision;
        plan.mandateVersion = agent.mandate.version;
        plan.status = "working";
        plan.events = [];
        plan.stage = "Updating your menu";
      } else {
        if (profile.revision !== plan.profileRevision)
          fail(
            "PROFILE_CHANGED",
            "Kitchen preferences changed. Rebuild the plan.",
            409,
          );
        const row = plan.rows.find((r) => r.id === input.row!.id);
        if (!row) fail("ROW_NOT_FOUND", "Ingredient not found.", 404);
        if (
          input.row!.productId !== null &&
          !row.candidates.some((c) => c.product.id === input.row!.productId)
        )
          fail(
            "INVALID_SELECTION",
            "Choose a candidate supplied for this ingredient.",
          );
        row.selectedId = input.row!.productId;
        row.manualQty = input.row!.qty;
        this.recalc(plan);
      }
      await repo.put("purchase_plans", plan);
    });
    if (input.intent)
      void this.build(agent, plan).catch(() => this.failed(plan));
    return plan;
  }
  async export(agent: Agent, raw: unknown) {
    const input = exportSchema.parse(raw),
      plan = await this.get(agent, input.id),
      profile = await this.profile(agent, plan.profileId);
    if (plan.revision !== input.revision || plan.status !== "ready")
      fail("STALE_PLAN", "Reload the latest plan.", 409);
    if (plan.mandateVersion !== agent.mandate.version)
      fail(
        "POLICY_CHANGED",
        "Purchasing permissions changed. Rebuild the plan.",
        409,
      );
    if (profile.revision !== plan.profileRevision)
      fail(
        "PROFILE_CHANGED",
        "Preferences changed. Rebuild before using this basket.",
        409,
      );
    if (
      plan.issues.length ||
      plan.rows.some((r) => r.status === "attention") ||
      plan.budgetExceeded ||
      !plan.rows.some((r) => r.status === "ready")
    )
      fail(
        "REVIEW_REQUIRED",
        "Resolve the highlighted decisions before using this basket.",
      );
    const selected = plan.rows
      .filter((r) => r.status === "ready")
      .map((r) => ({
        row: r,
        candidate: r.candidates.find((c) => c.product.id === r.selectedId)!,
      }));
    const lines = new Map<
      string,
      {
        product: ShopProduct;
        qty: number;
        requiredClaims: string[];
        allowedReplacementIds?: string[];
      }
    >();
    for (const { row, candidate: c } of selected) {
      const prior = lines.get(c.product.id);
      const preference = plan.profile.preferences.find(
        (p) => p.productId === row.preferredId,
      );
      const allowed = preference
        ? [
            preference.productId,
            ...(preference.mode === "approved" ? preference.alternatives : []),
          ]
        : row.exact && row.preferredId
          ? [row.preferredId]
          : undefined;
      lines.set(c.product.id, {
        product: c.product,
        ...(prior?.allowedReplacementIds
          ? {
              allowedReplacementIds: allowed
                ? prior.allowedReplacementIds.filter((id) =>
                    allowed.includes(id),
                  )
                : prior.allowedReplacementIds,
            }
          : allowed
            ? { allowedReplacementIds: allowed }
            : {}),
        qty: new Decimal(prior?.qty || 0).plus(c.qty!).toNumber(),
        requiredClaims: [
          ...new Set([...(prior?.requiredClaims || []), ...row.claims]),
        ],
      });
    }
    const result = await this.service.getOffers(agent, {
      productIds: [...lines.keys()],
      requestedDate: plan.date,
      includeSubstitutesFor: [],
    });
    for (const offer of result.offers) {
      const line = lines.get(offer.productId)!;
      const issue = offerIssue(offer, line.qty, plan.date);
      if (issue)
        fail(
          "OFFER_CHANGED",
          `${offer.product.names.en || offer.productId}: ${issue}. Rebuild the plan.`,
        );
      if (!line.requiredClaims.every((c) => hasClaim(offer.product, c)))
        fail(
          "REQUIREMENT_CHANGED",
          "Product requirements changed. Rebuild the plan.",
        );
    }
    const freshTotal = result.offers.reduce(
      (sum, o) =>
        sum +
        new Decimal(lines.get(o.productId)!.qty)
          .mul(o.price!.value)
          .mul(100)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .toNumber(),
      0,
    );
    if (freshTotal !== plan.totalCents)
      fail(
        "PRICE_CHANGED",
        "Prices changed. Rebuild the plan to review the new total.",
        409,
      );
    await this.service.db.transaction(async (repo) => {
      const latest = await repo.get<PurchasePlan>("purchase_plans", plan.id);
      const profileNow = await repo.get<{ profile: KitchenProfile }>(
        "kitchen_profiles",
        this.pk(agent, plan.profileId),
      );
      if (
        latest?.revision !== plan.revision ||
        profileNow?.profile.revision !== plan.profileRevision
      )
        fail(
          "STALE_PLAN",
          "Plan or preferences changed while offers were checked.",
          409,
        );
      await append(
        repo,
        {
          type: "kitchen.basket.reviewed",
          customerId: agent.customerId,
          actor: { kind: "agent", id: agent.id },
          refs: {},
          payload: {
            planId: plan.id,
            revision: plan.revision,
            totalCents: freshTotal,
          },
        },
        this.service.now(),
      );
    });
    return {
      planId: plan.id,
      revision: plan.revision,
      date: plan.date,
      lines: [...lines.values()],
      totalCents: freshTotal,
    };
  }
}
import { intentSchema as validatedIntent } from "../../../../packages/purchasing/src/contracts";
function intentSchemaCheck(value: unknown): KitchenIntent {
  return validatedIntent.parse(value);
}

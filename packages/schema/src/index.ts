import { z } from "zod";

export const id = z.string().min(1).max(100);
export const date = z.iso.date();
export const instant = z.iso.datetime({ offset: true });
export const quantity = z.number().finite().positive().max(1_000_000);
export const scopeSchema = z.enum([
  "catalog:read",
  "offers:read",
  "proposals:write",
  "orders:read",
]);
export const packSchema = z.object({
  unitId: id,
  sizeInBaseUnits: quantity,
  gtin: z.string().optional(),
});
export const contentSchema = z.object({
  value: quantity,
  unit: z.enum(["L", "KG", "PCS"]),
  inferred: z.boolean(),
});
export const productSchema = z.object({
  id,
  names: z.record(z.string(), z.string()),
  brand: z.string(),
  category: id,
  salesUnit: id,
  baseUnit: id,
  gtin: z.string().optional(),
  packs: z.array(packSchema),
  allowedLotSize: quantity,
  netContent: contentSchema.optional(),
  claims: z.array(z.string()),
  allergenFree: z.array(z.string()),
  allergens: z.array(z.string()),
  substitutions: z.array(id),
  temperatureCondition: z.number().optional(),
  details: z
    .object({
      descriptions: z.record(z.string(), z.string()),
      ingredients: z.record(z.string(), z.string()),
      preparation: z.record(z.string(), z.string()),
      usage: z.record(z.string(), z.string()),
      storage: z.record(z.string(), z.string()),
      media: z.array(z.object({ id: z.number().int(), primary: z.boolean() })),
      origin: z.string().optional(),
      updatedAt: z.string().optional(),
      nutrition: z.array(
        z.object({
          id: z.string(),
          value: z.number(),
          unit: z.string(),
          basisQuantity: z.number().optional(),
          basisQuantityUnit: z.string().optional(),
        }),
      ),
    })
    .optional(),
  reliability: z.number().min(0).max(1).optional(),
  carbonKgPerKg: z.number().nonnegative().optional(),
});
export type Product = z.infer<typeof productSchema>;
export const scheduleSchema = z.object({
  availableAmount: z.number().nonnegative(),
  availableDate: z.string().nullable(),
  salesUnit: id,
  salesBlock: z.boolean(),
});
export const offerPayloadSchema = z.object({
  id,
  customerId: id,
  productId: id,
  product: productSchema,
  requestedDate: date,
  issuedAt: instant,
  validUntil: instant,
  source: z.enum(["mock", "valio"]),
  price: z
    .object({
      value: z.number().nonnegative(),
      currency: z.literal("EUR"),
      validFrom: instant,
      validTo: instant,
      netPriceFound: z.boolean(),
    })
    .nullable(),
  comparisonPrice: z
    .object({ value: z.number().nonnegative(), unit: z.string() })
    .optional(),
  salesBlock: z.boolean(),
  closingTime: instant.nullable(),
  logisticModel: z.string().nullable(),
  availability: z.array(scheduleSchema),
});
export const offerSchema = offerPayloadSchema.extend({ signature: z.string() });
export type Offer = z.infer<typeof offerSchema>;
export const mandateSchema = z
  .object({
    version: z.number().int().positive(),
    limits: z.object({
      perOrder: z.number().nonnegative().max(10_000_000),
      perWeek: z.number().nonnegative().max(10_000_000),
      currency: z.literal("EUR"),
    }),
    categories: z.array(id).max(1000),
    deliverySites: z.array(id).min(1),
    substitutionPolicy: z.enum(["explicit", "category", "none"]),
    allergenProfile: z.enum(["strict", "standard"]),
    requiredClaims: z.array(id),
    allergenFree: z.array(id),
    acceptCatalogPrice: z.boolean(),
    approvers: z
      .array(
        z.object({
          userId: id,
          name: z.string().min(1).max(100),
          channels: z.array(z.enum(["app", "sms", "voice"])).min(1),
          phone: z
            .string()
            .regex(/^\+[1-9]\d{7,14}$/)
            .optional(),
          quietHours: z
            .object({
              start: z.number().int().min(0).max(23),
              end: z.number().int().min(0).max(23),
            })
            .optional(),
        }),
      )
      .min(1),
    validTo: instant,
  })
  .strict();
export type Mandate = z.infer<typeof mandateSchema>;
export const agentSchema = z.object({
  id,
  customerId: id,
  name: z.string(),
  active: z.boolean(),
  scopes: z.array(scopeSchema),
  publicKey: z.record(z.string(), z.unknown()),
  tokenHash: z.string(),
  mandate: mandateSchema,
  createdAt: instant,
});
export type Agent = z.infer<typeof agentSchema>;
export const proposalLineSchema = z
  .object({
    productId: id,
    qty: quantity,
    salesUnit: id,
    offerId: id,
    substituteFor: id.optional(),
    rationale: z.string().max(500).optional(),
    requiredClaims: z.array(id).default([]),
    allergenFree: z.array(id).default([]),
  })
  .strict();
export type ProposalLine = z.infer<typeof proposalLineSchema>;
export const proposalInputSchema = z
  .object({
    requestedDate: date,
    deliverySite: id,
    lines: z.array(proposalLineSchema).min(1).max(100),
    idempotencyKey: id,
    requirementRef: z.string().max(200).optional(),
  })
  .strict();
export type ProposalInput = z.infer<typeof proposalInputSchema>;
export const ruleSchema = z.object({
  id: z.string(),
  severity: z.enum(["HOLD", "REFUSE"]),
  code: z.string(),
  message: z.string(),
  productId: id.optional(),
  observed: z.unknown().optional(),
  limit: z.unknown().optional(),
});
export type FiredRule = z.infer<typeof ruleSchema>;
export const verdictSchema = z.object({
  id,
  proposalId: id,
  result: z.enum(["AUTO", "HOLD", "REFUSE"]),
  firedRules: z.array(ruleSchema),
  perLine: z.array(
    z.object({ productId: id, result: z.enum(["AUTO", "HOLD", "REFUSE"]) }),
  ),
  evaluatedAt: instant,
});
export type Verdict = z.infer<typeof verdictSchema>;
export const proposalSchema = proposalInputSchema.extend({
  id,
  agentId: id,
  customerId: id,
  totalCents: z.number().int().nonnegative(),
  status: z.enum([
    "held",
    "refused",
    "placed",
    "rejected",
    "expired",
    "amended",
  ]),
  createdAt: instant,
  verdict: verdictSchema,
  approvalId: id.optional(),
  orderId: id.optional(),
  revision: z.number().int().positive(),
  parentId: id.optional(),
});
export type Proposal = z.infer<typeof proposalSchema>;
export const approvalSchema = z.object({
  id,
  proposalId: id,
  customerId: id,
  status: z.enum(["pending", "approved", "rejected", "amended", "expired"]),
  challengeToken: z.string(),
  lineHash: z.string(),
  createdAt: instant,
  expiresAt: instant,
  nextAttemptAt: instant,
  channelIndex: z.number().int(),
  attempts: z.array(
    z.object({ channel: z.string(), at: instant, outcome: z.string() }),
  ),
  decidedAt: instant.optional(),
  approverId: id.optional(),
  channel: z.enum(["app", "sms", "voice"]).optional(),
  signature: z.string().optional(),
  replacementProposalId: id.optional(),
});
export type Approval = z.infer<typeof approvalSchema>;
export const decisionSchema = z
  .object({
    decision: z.enum(["approve", "approve_with_amount", "reject", "callback"]),
    challengeToken: z.string(),
    revision: z.number().int().positive(),
    amendedLines: z
      .array(z.object({ productId: id, qty: quantity }))
      .min(1)
      .optional(),
  })
  .strict();
export type Decision = z.infer<typeof decisionSchema>;
export const orderSchema = z.object({
  id,
  proposalId: id,
  verdictId: id,
  approvalId: id.optional(),
  customerId: id,
  agentId: id,
  lines: z.array(
    proposalLineSchema.extend({
      name: z.string(),
      gtin: z.string().optional(),
      unitPrice: z.number(),
      lineTotalCents: z.number().int(),
      deliveryDate: date,
    }),
  ),
  totalCents: z.number().int(),
  currency: z.literal("EUR"),
  deliveryDate: date,
  deliverySite: id,
  confirmedAt: instant,
  simulated: z.literal(true),
});
export type Order = z.infer<typeof orderSchema>;
export const requirementSchema = z.object({
  id,
  customerId: id,
  neededBy: date,
  source: z.enum(["inventory", "manual"]),
  lines: z.array(
    z.object({
      hint: z.string(),
      need: z.object({ qty: quantity, unit: z.enum(["L", "KG", "PCS"]) }),
      constraints: z.object({ claims: z.array(id), allergenFree: z.array(id) }),
    }),
  ),
});
export type Requirement = z.infer<typeof requirementSchema>;
export const ledgerEventSchema = z.object({
  seq: z.number().int(),
  ts: instant,
  type: z.string(),
  actor: z.object({ kind: z.enum(["agent", "aimo", "human"]), id }),
  customerId: id,
  refs: z.record(z.string(), z.string()),
  payload: z.record(z.string(), z.unknown()),
  prevHash: z.string(),
  hash: z.string(),
});
export type LedgerEvent = z.infer<typeof ledgerEventSchema>;
export const searchSchema = z.object({
  query: z.string().max(200).default(""),
  category: z.string().optional(),
  claims: z.array(id).default([]),
  allergenFree: z.array(id).default([]),
  limit: z.number().int().min(1).max(100).default(20),
});
export type SearchInput = z.infer<typeof searchSchema>;
export const offersInputSchema = z
  .object({
    productIds: z.array(id).min(1).max(1000),
    requestedDate: date,
    includeSubstitutesFor: z.array(id).max(20).default([]),
  })
  .strict();
export const domainSchemas = {
  Product: productSchema,
  Requirement: requirementSchema,
  Offer: offerSchema,
  Proposal: proposalSchema,
  Mandate: mandateSchema,
  Verdict: verdictSchema,
  Approval: approvalSchema,
  Order: orderSchema,
  LedgerEvent: ledgerEventSchema,
};

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details: unknown = undefined,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

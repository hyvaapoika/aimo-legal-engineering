import { z } from "zod";
import type { Product, Offer } from "@aimo/schema";
export const claimsSchema = z
  .array(
    z.enum([
      "FREE_FROM_LACTOSE",
      "FREE_FROM_GLUTEN",
      "VEGAN",
      "VEGETARIAN",
      "ORGANIC",
    ]),
  )
  .max(5);
export const preferenceSchema = z
  .object({
    key: z.string().min(1).max(80),
    productId: z.string().min(1).max(50),
    quantity: z.number().positive().max(10000),
    mode: z.enum(["exact", "approved"]),
    alternatives: z.array(z.string().min(1).max(50)).max(5),
  })
  .strict();
export const profileInputSchema = z
  .object({
    id: z.enum(["lunch", "hotel"]),
    revision: z.number().int().nonnegative(),
    name: z.string().min(1).max(80),
    claims: claimsSchema,
    budgetPerPortion: z.number().positive().max(1000).nullable(),
    preferences: z.array(preferenceSchema).max(20),
  })
  .strict();
export type KitchenProfile = z.infer<typeof profileInputSchema> & {
  customerId: string;
  updatedAt: string;
};
export const intentSchema = z
  .object({
    summary: z.string().max(500),
    dishes: z
      .array(
        z
          .object({
            recipeId: z.string().max(80).nullable(),
            name: z.string().min(1).max(100),
            portions: z.number().int().min(1).max(1000),
            claims: claimsSchema,
          })
          .strict(),
      )
      .max(6),
    items: z
      .array(
        z
          .object({
            query: z.string().min(1).max(100),
            quantity: z.number().positive().max(10000).nullable(),
            unit: z.enum(["sales", "KG", "L"]).nullable(),
          })
          .strict(),
      )
      .max(20),
    pantry: z
      .array(
        z
          .object({
            ingredient: z.string().min(1).max(100),
            amountKg: z.number().nonnegative().max(10000).nullable(),
          })
          .strict(),
      )
      .max(20),
    claims: claimsSchema,
    budgetPerPortion: z.number().positive().max(1000).nullable(),
    unresolved: z.array(z.string().max(250)).max(12),
  })
  .strict();
export type KitchenIntent = z.infer<typeof intentSchema>;
export const mediaSchema = z
  .object({
    mimeType: z.enum([
      "image/jpeg",
      "image/png",
      "image/webp",
      "audio/webm",
      "audio/mp4",
      "audio/wav",
      "audio/ogg",
    ]),
    data: z
      .string()
      .min(1)
      .max(4_000_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
export const startSchema = z
  .object({
    profileId: z.enum(["lunch", "hotel"]),
    text: z.string().max(4000),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    key: z.string().uuid(),
    previousId: z.string().uuid().optional(),
    media: mediaSchema.optional(),
  })
  .strict()
  .refine(
    (x) => x.text.trim() || x.media,
    "Describe a menu or attach a photo or recording.",
  );
export type AgentInput = z.infer<typeof startSchema>;
export type ShopProduct = Product & {
  group: string;
  type: string;
  image: string | null;
  reasons: string[];
  pack: {
    unit: string;
    factor: number | null;
    content: { value: number; unit: string } | null;
  };
};
export type PlanCandidate = {
  product: ShopProduct;
  qty: number | null;
  totalCents: number | null;
  available: boolean;
  issue: string | null;
  reason: string;
};
export type PlanRow = {
  id: string;
  ingredient: string;
  recipe: string | null;
  source: string | null;
  required: number | null;
  unit: "KG" | "L" | "sales";
  pantryUsed: number;
  pantryUnknown: boolean;
  preferredId: string | null;
  exact: boolean;
  claims: string[];
  candidates: PlanCandidate[];
  selectedId: string | null;
  manualQty: number | null;
  status: "ready" | "covered" | "attention";
  issue: string | null;
};
export type ToolEvent = {
  tool: string;
  label: string;
  state: "running" | "done";
  at: string;
};
export type PurchasePlan = {
  id: string;
  customerId: string;
  agentId: string;
  key: string;
  fingerprint: string;
  profileId: "lunch" | "hotel";
  profileRevision: number;
  mandateVersion: number;
  profile: KitchenProfile;
  revision: number;
  text: string;
  date: string;
  inputKind: "text" | "photo" | "voice";
  status: "working" | "ready" | "failed";
  stage: string;
  events: ToolEvent[];
  intent: KitchenIntent | null;
  interpretation: "gemini" | "local" | null;
  rows: PlanRow[];
  issues: string[];
  offers: Record<string, Offer>;
  totalCents: number;
  portions: number;
  costPerPortion: number | null;
  budgetExceeded: boolean;
  createdAt: string;
  updatedAt: string;
  error: string | null;
};
export const patchSchema = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().positive(),
    intent: intentSchema.optional(),
    row: z
      .object({
        id: z.string(),
        productId: z.string().nullable(),
        qty: z.number().positive().max(10000).nullable(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (x) => Boolean(x.intent) !== Boolean(x.row),
    "Change either the menu or one row.",
  );
export const planRefSchema = z.object({ id: z.string().uuid() }).strict();
export const exportSchema = z
  .object({ id: z.string().uuid(), revision: z.number().int().positive() })
  .strict();

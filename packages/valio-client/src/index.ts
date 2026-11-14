import { z } from "zod";
import { DomainError, scheduleSchema, type Product } from "@aimo/schema";
import { toInstant } from "@aimo/feasibility";

const priceSchema = z.object({
  value: z.number().nonnegative(),
  valueWithTax: z.number(),
  validFrom: z.string(),
  validTo: z.string(),
  currency: z.string(),
});
export const pricesSchema = z.object({
  customerId: z.string(),
  currency: z.string(),
  pricingDate: z.string(),
  products: z.array(
    z.object({
      productId: z.string(),
      quantity: z.number(),
      catalogPrice: priceSchema.nullable().optional(),
      comparisonPrice: priceSchema.nullable().optional(),
      comparisonUnit: z.string().nullable().optional(),
      netPriceFound: z.boolean(),
      error: z.boolean(),
    }),
  ),
});
export const availabilitySchema = z.object({
  timeNow: z.string(),
  requestedDate: z.string(),
  products: z.array(
    z.object({
      productId: z.string(),
      closingTime: z.string().nullable().optional(),
      salesBlock: z.boolean(),
      logisticModel: z.string().nullable().optional(),
      scheduleLines: z.array(scheduleSchema),
    }),
  ),
});
export type PriceResponse = z.infer<typeof pricesSchema>;
export type AvailabilityResponse = z.infer<typeof availabilitySchema>;
export interface ValioAdapter {
  source: "mock" | "valio";
  lookup(
    customer: string,
    products: Product[],
    requestedDate: string,
    now: Date,
  ): Promise<{ prices: PriceResponse; availability: AvailabilityResponse }>;
  ping(): Promise<unknown>;
}
export class LiveValioClient implements ValioAdapter {
  source = "valio" as const;
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private fetcher: typeof fetch = fetch,
  ) {
    if (!apiKey)
      throw new DomainError(
        "MISSING_API_KEY",
        "Set VALIO_API_KEY before disabling mock mode.",
        503,
      );
    if (new URL(baseUrl).protocol !== "https:")
      throw new DomainError(
        "INVALID_BASE_URL",
        "The live Valio endpoint must use HTTPS.",
      );
  }
  private async request(path: string, body?: unknown) {
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, this.baseUrl), {
        method: body ? "POST" : "GET",
        headers: {
          "X-API-Key": this.apiKey,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
    } catch {
      throw new DomainError(
        "VALIO_UNAVAILABLE",
        "Valio request failed or timed out.",
        502,
      );
    }
    if (!response.ok)
      throw new DomainError(
        response.status === 429 ? "VALIO_RATE_LIMIT" : "VALIO_ERROR",
        `Valio returned HTTP ${response.status}.`,
        response.status === 429 ? 429 : 502,
      );
    return response.json();
  }
  async ping() {
    return this.request("/api/ping");
  }
  async lookup(customer: string, products: Product[], requestedDate: string) {
    if (products.length < 1 || products.length > 1000)
      throw new DomainError(
        "INVALID_BATCH",
        "Shortlist between 1 and 1,000 products.",
      );
    const body = {
      customer,
      products: products.map((p) => p.id),
      requestedDate,
    };
    const [price, availability] = await Promise.all([
      this.request("/api/price", body),
      this.request("/api/availability", body),
    ]);
    return {
      prices: pricesSchema.parse(price),
      availability: availabilitySchema.parse(availability),
    };
  }
}
export type MockScenario = {
  unitPrice: number | null;
  availableAmount?: number;
  salesBlock?: boolean;
  logisticModel?: string;
  lateDays?: number;
  emptySchedule?: boolean;
  pastCutoff?: boolean;
};
export class MockValioClient implements ValioAdapter {
  source = "mock" as const;
  constructor(private scenarios: Record<string, MockScenario> = {}) {}
  async ping() {
    return { status: "ok", source: "mock" };
  }
  async lookup(
    customer: string,
    products: Product[],
    requestedDate: string,
    now: Date,
  ) {
    const validFrom = new Date(now.getTime() - 86_400_000).toISOString();
    const validTo = new Date(
      Math.max(
        Date.parse(`${requestedDate}T21:59:59Z`),
        now.getTime() + 86_400_000,
      ),
    ).toISOString();
    return {
      prices: {
        customerId: customer,
        currency: "EUR",
        pricingDate: requestedDate,
        products: products.map((p) => {
          const scenario = this.scenarios[p.id];
          // Explicitly synthetic, deterministic fallback for non-scenario catalog products.
          const value =
            scenario?.unitPrice === null
              ? null
              : (scenario?.unitPrice ??
                Number((1 + Number(p.id.slice(-3)) / 100).toFixed(2)));
          const price =
            value === null
              ? null
              : {
                  value,
                  valueWithTax: Number((value * 1.14).toFixed(2)),
                  validFrom,
                  validTo,
                  currency: "EUR",
                };
          const factor =
            p.packs.find((x) => x.unitId === p.salesUnit)?.sizeInBaseUnits ?? 1;
          return {
            productId: p.id,
            quantity: 1,
            catalogPrice: price,
            comparisonPrice:
              price && p.netContent
                ? {
                    ...price,
                    value: price.value / (p.netContent.value * factor),
                  }
                : null,
            comparisonUnit: p.netContent?.unit ?? null,
            netPriceFound: true,
            error: value === null,
          };
        }),
      },
      availability: {
        timeNow: now.toISOString(),
        requestedDate,
        products: products.map((p) => {
          const scenario = this.scenarios[p.id];
          const availableDate = new Date(
            Date.parse(`${requestedDate}T12:00:00Z`) +
              (scenario?.lateDays ?? 0) * 86_400_000,
          )
            .toISOString()
            .slice(0, 10);
          return {
            productId: p.id,
            closingTime: new Date(
              now.getTime() + (scenario?.pastCutoff ? -60_000 : 3_600_000),
            ).toISOString(),
            salesBlock: scenario?.salesBlock ?? false,
            logisticModel: scenario?.logisticModel ?? "Stock",
            scheduleLines: scenario?.emptySchedule
              ? []
              : [
                  {
                    availableAmount: scenario?.availableAmount ?? 10000,
                    availableDate,
                    salesUnit: p.salesUnit,
                    salesBlock: false,
                  },
                ],
          };
        }),
      },
    };
  }
}
export { toInstant };

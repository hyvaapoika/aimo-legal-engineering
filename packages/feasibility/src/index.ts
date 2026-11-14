import { Decimal } from "decimal.js";
import { DateTime } from "luxon";
import {
  DomainError,
  type Product,
  type Offer,
  type ProposalLine,
  type FiredRule,
} from "@aimo/schema";

export function toInstant(value: string, endOfDay = false): string {
  let parsed = DateTime.fromISO(value, {
    zone: "Europe/Helsinki",
    setZone: true,
  });
  if (value.length === 10 && endOfDay) parsed = parsed.endOf("day");
  if (!parsed.isValid)
    throw new DomainError("INVALID_TIME", "Invalid timestamp from supplier.");
  return parsed.toUTC().toISO()!;
}
export function isLotMultiple(qty: number, lot: number) {
  return new Decimal(qty).mod(lot).isZero();
}
export function lineCents(qty: number, price: number): number {
  return new Decimal(qty)
    .mul(price)
    .mul(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}
export function convertRequirement(
  product: Product,
  qty: number,
  unit: "L" | "KG" | "PCS",
) {
  if (!Number.isFinite(qty) || qty <= 0)
    throw new DomainError("INVALID_QUANTITY", "Quantity must be positive.");
  const salesPack = product.packs.find((p) => p.unitId === product.salesUnit);
  const salesFactor =
    product.salesUnit === product.baseUnit ? 1 : salesPack?.sizeInBaseUnits;
  if (!salesFactor)
    throw new DomainError(
      "UNKNOWN_UNIT",
      "No verified sales-unit conversion exists.",
    );
  let raw: Decimal;
  if (unit === product.salesUnit) raw = new Decimal(qty);
  else if (unit === "PCS" && product.baseUnit === "ST")
    raw = new Decimal(qty).div(salesFactor);
  else if (product.netContent?.unit === unit)
    raw = new Decimal(qty).div(product.netContent.value).div(salesFactor);
  else
    throw new DomainError(
      "UNKNOWN_CONTENT",
      `Cannot safely convert ${unit} to ${product.salesUnit} for ${product.id}.`,
    );
  // Packaged pieces cannot be fractional even when the supplier's generic lot is 0.01.
  const lot =
    product.baseUnit === "ST"
      ? Decimal.max(product.allowedLotSize, new Decimal(1).div(salesFactor))
      : new Decimal(product.allowedLotSize);
  const salesQty = raw.div(lot).ceil().mul(lot);
  const baseQty = salesQty.mul(salesFactor);
  const casePack = product.packs.find((p) => p.unitId === "KI");
  return {
    qty: salesQty.toNumber(),
    salesUnit: product.salesUnit,
    cases: casePack
      ? baseQty.div(casePack.sizeInBaseUnits).toNumber()
      : undefined,
    roundedUp: !raw.eq(salesQty),
    inferred: product.netContent?.inferred ?? false,
  };
}
export function feasibleRules(
  line: ProposalLine,
  offer: Offer,
  requestedDate: string,
  now: Date,
): FiredRule[] {
  const rules: FiredRule[] = [];
  const add = (
    id: string,
    severity: "HOLD" | "REFUSE",
    code: string,
    message: string,
    observed?: unknown,
    limit?: unknown,
  ) =>
    rules.push({
      id,
      severity,
      code,
      message,
      productId: line.productId,
      observed,
      limit,
    });
  if (line.salesUnit !== offer.product.salesUnit)
    add(
      "FEAS_UNIT",
      "REFUSE",
      "UNIT_MISMATCH",
      "Proposal unit does not match the signed sales unit.",
    );
  if (!isLotMultiple(line.qty, offer.product.allowedLotSize))
    add(
      "FEAS_LOT",
      "REFUSE",
      "INVALID_LOT",
      "Quantity must be a multiple of the allowed lot.",
      line.qty,
      offer.product.allowedLotSize,
    );
  const pack = offer.product.packs.find(
    (p) => p.unitId === offer.product.salesUnit,
  );
  if (
    offer.product.baseUnit === "ST" &&
    pack &&
    !new Decimal(line.qty).mul(pack.sizeInBaseUnits).isInteger()
  )
    add(
      "FEAS_WHOLE_UNIT",
      "REFUSE",
      "FRACTIONAL_PIECE",
      "Packaged products must contain whole pieces.",
    );
  if (offer.salesBlock || offer.availability.some((a) => a.salesBlock))
    add(
      "FEAS_NOT_BLOCKED",
      "REFUSE",
      "SALES_BLOCK",
      "Supplier has blocked this product for sale.",
    );
  if (offer.closingTime && now.getTime() >= Date.parse(offer.closingTime))
    add(
      "FEAS_CUTOFF",
      "REFUSE",
      "PAST_CUTOFF",
      "The supplier order cut-off has passed.",
    );
  if (!offer.availability.length)
    add(
      "FEAS_AVAILABLE",
      "HOLD",
      "UNAVAILABLE",
      "Supplier has no delivery schedule; revise or remove this line.",
    );
  else {
    const schedule = offer.availability[0]!;
    if (schedule.salesUnit !== line.salesUnit)
      add(
        "FEAS_AVAILABILITY_UNIT",
        "REFUSE",
        "UNIT_MISMATCH",
        "Availability is quoted in a different unit.",
      );
    if (
      schedule.availableAmount === 999999 ||
      offer.logisticModel?.toLowerCase() === "terminal"
    )
      add(
        "FEAS_QTY_KNOWN",
        "HOLD",
        "UNKNOWN_QUANTITY",
        "Terminal stock quantity is unknown; supplier confirmation is required.",
      );
    else if (line.qty > schedule.availableAmount)
      add(
        "FEAS_AVAILABLE",
        "HOLD",
        "INSUFFICIENT_STOCK",
        "Requested quantity exceeds supplier availability; reduce the amount.",
        line.qty,
        schedule.availableAmount,
      );
    if (
      !schedule.availableDate ||
      schedule.availableDate.slice(0, 10) > requestedDate
    )
      add(
        "FEAS_DELIVERY",
        "HOLD",
        "LATE_DELIVERY",
        "Supplier cannot confirm delivery by the requested date.",
        schedule.availableDate,
        requestedDate,
      );
  }
  return rules;
}
export const nonOverridableHolds = new Set([
  "UNKNOWN_QUANTITY",
  "UNAVAILABLE",
  "INSUFFICIENT_STOCK",
  "LATE_DELIVERY",
]);

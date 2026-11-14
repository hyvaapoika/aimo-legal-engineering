import { describe, expect, it } from "vitest";
import {
  makeLunch,
  packCount,
  replaceProduct,
  restoreDraft,
  setQuantity,
  totalCents,
} from "../apps/web/app/kitchen/state";

describe("chef design preview draft boundaries", () => {
  it("rounds sales packs up without rounding recipe needs first", () => {
    expect(packCount(9600, 6000)).toBe(2);
    expect(packCount(14400, 2500)).toBe(6);
    expect(() => packCount(10, 0)).toThrow();
    expect(() => packCount(NaN, 100)).toThrow();
  });
  it("replaces a large tin with sufficient small tins and removes the original", () => {
    const next = replaceProduct(makeLunch(120), "465046", "464638");
    expect(next.lines.find((l) => l.productId === "464638")?.qty).toBe(36);
    expect(next.lines.some((l) => l.productId === "465046")).toBe(false);
    expect(next.lines).toHaveLength(6);
  });
  it("rejects cross-ingredient and unavailable replacements", () => {
    expect(() => replaceProduct(makeLunch(120), "465046", "464249")).toThrow();
    const swapped = replaceProduct(makeLunch(120), "465046", "463947");
    expect(() => replaceProduct(swapped, "463947", "465046")).toThrow();
  });
  it("preserves explicit dietary declarations when replacing pasta", () => {
    const glutenFree = replaceProduct(makeLunch(120), "475437", "462324");
    expect(() => replaceProduct(glutenFree, "462324", "475437")).toThrow();
  });
  it("keeps products in place when changing quantities or replacing a line", () => {
    const original = makeLunch(120);
    const updated = setQuantity(original, "475437", 3);
    expect(updated.lines.map((l) => l.productId)).toEqual(
      original.lines.map((l) => l.productId),
    );
    const replaced = replaceProduct(original, "465046", "463947");
    expect(replaced.lines[1]?.productId).toBe("463947");
  });
  it("preserves a manually increased requirement when changing pack sizes", () => {
    const original = setQuantity(makeLunch(120), "465046", 8);
    const next = replaceProduct(original, "465046", "464638");
    expect(next.lines.find((l) => l.productId === "464638")?.qty).toBe(50);
  });
  it("does not silently discard extra products or restore removed products on scaling", () => {
    const extra = setQuantity(
      setQuantity(makeLunch(120), "464249", 0),
      "464638",
      3,
    );
    const next = makeLunch(150, extra);
    expect(next.lines.some((l) => l.productId === "464249")).toBe(false);
    expect(next.lines.find((l) => l.productId === "464638")?.qty).toBe(3);
  });
  it("uses integer cents and refuses fractional sales packs", () => {
    const next = setQuantity({ portions: 120, lines: [] }, "464249", 3);
    expect(totalCents(next)).toBe(975);
    expect(() => setQuantity(next, "464249", 0.5)).toThrow();
    expect(() => setQuantity(next, "invalid", 1)).toThrow();
  });
  it("rejects damaged or duplicated persisted drafts", () => {
    expect(
      restoreDraft({
        portions: 120,
        lines: [{ productId: "invalid", qty: 1 }],
      }),
    ).toBeUndefined();
    const d = makeLunch(120);
    expect(
      restoreDraft({ ...d, lines: [...d.lines, d.lines[0]] }),
    ).toBeUndefined();
    expect(restoreDraft(d)).toEqual(d);
    expect(() => makeLunch(0)).toThrow();
    expect(() => makeLunch(120.5)).toThrow();
  });
});

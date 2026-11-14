import { describe, expect, it } from "vitest";
import { deliveryFromPrompt } from "../packages/purchasing/src/delivery";
const now = new Date("2026-11-14T10:00:00Z");
const resolve = (text: string) => deliveryFromPrompt(text, "2026-11-16", now);
describe("delivery dates in kitchen prompts", () => {
  it("uses explicit dates, relative days and weekdays instead of the fallback", () => {
    expect(resolve("Pasta for 80, delivery 2026-11-18")).toBe("2026-11-18");
    expect(resolve("Breakfast for 17.11.2026")).toBe("2026-11-17");
    expect(resolve("Order for tomorrow")).toBe("2026-11-15");
    expect(resolve("Order for day after tomorrow")).toBe("2026-11-16");
    expect(resolve("Pasta for 80 on Monday")).toBe("2026-11-16");
    expect(resolve("Order for next Saturday")).toBe("2026-11-21");
    expect(resolve("Pasta for 80")).toBe("2026-11-16");
  });
  it("uses Helsinki's calendar day around midnight", () => {
    expect(
      deliveryFromPrompt(
        "tomorrow",
        "2026-11-16",
        new Date("2026-11-14T23:30:00Z"),
      ),
    ).toBe("2026-11-16");
  });
  it("refuses impossible, past, conflicting and unsupported dates instead of guessing", () => {
    for (const prompt of [
      "delivery 2026-02-30",
      "delivery 2026-11-13",
      "Monday or Tuesday",
      "delivery 11/12",
      "next week",
      "delivery Monday 30 November",
    ]) {
      expect(() => resolve(prompt)).toThrow("Add one delivery date");
    }
  });
});

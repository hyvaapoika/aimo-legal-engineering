import { DomainError } from "@aimo/schema";

const weekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const dayMs = 86400000;
// Delivery affects offers: resolve supported expressions deterministically in Helsinki time.
export function deliveryFromPrompt(text: string, fallback: string, now: Date) {
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Helsinki",
  }).format(now);
  const midnight = new Date(`${today}T00:00:00Z`);
  const dates = new Set<string>();
  const invalid = () => {
    throw new DomainError(
      "DELIVERY_DATE",
      "Add one delivery date to your request, for example ‘delivery 2026-11-18’ or ‘tomorrow’.",
      400,
    );
  };
  const add = (date: string) => {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date ||
      date < today
    )
      invalid();
    dates.add(date);
  };
  const lower = text.toLowerCase();
  for (const match of lower.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) add(match[0]);
  for (const match of lower.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g))
    add(
      `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}`,
    );
  for (const match of lower.matchAll(
    /\b(today|tomorrow|day after tomorrow|(?:(?:this|next)\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/g,
  )) {
    const value = match[0];
    let days =
      value === "today"
        ? 0
        : value === "tomorrow"
          ? 1
          : value === "day after tomorrow"
            ? 2
            : -1;
    if (days < 0) {
      const weekday = weekdays.indexOf(value.replace(/^(?:this|next)\s+/, ""));
      days = (weekday - midnight.getUTCDay() + 7) % 7;
      // “Next Monday” means the next occurrence strictly after today.
      if (!days && value.startsWith("next ")) days = 7;
    }
    add(new Date(midnight.getTime() + days * dayMs).toISOString().slice(0, 10));
  }
  // Never silently ignore an unsupported date expression and reuse an unrelated date.
  const unsupported =
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d|\b\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b|\b(?:next week|next month|in \d+ days)\b/;
  if (unsupported.test(lower) || dates.size > 1) invalid();
  if (!dates.size) add(fallback);
  return [...dates][0]!;
}

/** Convert a CNY input into integer cents without rounding an invalid amount. */
export function rechargeCents(value: string, minCents: number, maxCents: number): number | null {
  const amount = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) return null;
  const [yuan, fraction = ""] = amount.split(".");
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= minCents && cents <= maxCents ? cents : null;
}

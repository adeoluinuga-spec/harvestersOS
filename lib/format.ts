/** Format a money amount (string or number) in the given ISO currency. */
export function money(amount: string | number | null, currency = "NGN"): string {
  const n = typeof amount === "string" ? parseFloat(amount) : (amount ?? 0);
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString()}`;
  }
}

const CURRENCY_SYMBOL: Record<string, string> = { NGN: "₦", GBP: "£", USD: "$", AUD: "A$", CAD: "C$", EUR: "€" };

/** Compact money for tight KPI cards: 26_900_000_000 -> "₦26.9bn", 1_200_000 -> "£1.2m". */
export function compactMoney(amount: string | number | null, currency = "NGN"): string {
  const n = typeof amount === "string" ? parseFloat(amount) : (amount ?? 0);
  const sym = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const f = (v: number, suffix: string) =>
    `${sign}${sym}${v.toLocaleString("en-US", { maximumFractionDigits: v < 100 ? 1 : 0 })}${suffix}`;
  if (abs >= 1e12) return f(abs / 1e12, "tn");
  if (abs >= 1e9) return f(abs / 1e9, "bn");
  if (abs >= 1e6) return f(abs / 1e6, "m");
  if (abs >= 1e3) return f(abs / 1e3, "k");
  return `${sign}${sym}${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** ISO date (YYYY-MM-DD) -> "12 Jan 2026". */
export function shortDate(d: string | null): string {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

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

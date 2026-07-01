"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded border border-silver bg-paper px-3 py-2 font-sans text-xs text-ink hover:border-ink print:hidden"
    >
      Print / Save PDF
    </button>
  );
}

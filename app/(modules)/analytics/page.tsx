import { ModulePlaceholder } from "@/components/shell/ModulePlaceholder";

export default function AnalyticsPage() {
  return (
    <ModulePlaceholder
      title="Analytics"
      summary="Read-only insight derived entirely from the ledger — giving trends, spend analysis, fund health, and executive dashboards."
      planned={[
        "Giving and expense trend analysis",
        "Fund and budget health dashboards",
        "Executive and board reporting",
        "Exportable statements derived from the ledger",
      ]}
    />
  );
}

import { ModulePlaceholder } from "@/components/shell/ModulePlaceholder";

export default function InternationalPage() {
  return (
    <ModulePlaceholder
      title="International"
      summary="Multi-branch and cross-border financial consolidation. Each locale posts to the ledger in its currency; consolidation is derived, not re-keyed."
      planned={[
        "Multi-branch and multi-currency support",
        "Cross-border remittance tracking",
        "Consolidated international reporting",
        "Currency translation from ledger data",
      ]}
    />
  );
}

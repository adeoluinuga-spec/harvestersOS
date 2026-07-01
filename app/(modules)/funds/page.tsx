import { ModulePlaceholder } from "@/components/shell/ModulePlaceholder";

export default function FundsPage() {
  return (
    <ModulePlaceholder
      title="Funds"
      summary="Restricted and designated fund accounting layered over the single ledger. Fund balances are always derived from postings, never written directly."
      planned={[
        "Restricted, designated, and general fund definitions",
        "Fund balance derivation from the ledger",
        "Inter-fund transfers as balanced entries",
        "Fund compliance and reporting",
      ]}
    />
  );
}

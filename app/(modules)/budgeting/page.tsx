import { ModulePlaceholder } from "@/components/shell/ModulePlaceholder";

export default function BudgetingPage() {
  return (
    <ModulePlaceholder
      title="Budgeting"
      summary="Annual and departmental budgets measured against actuals derived from the ledger. Budgets never move money — they frame and constrain what the ledger records."
      planned={[
        "Budget creation by department and fund",
        "Budget-vs-actual tracking from ledger data",
        "Variance analysis and alerts",
        "Budget approval and revision history",
      ]}
    />
  );
}

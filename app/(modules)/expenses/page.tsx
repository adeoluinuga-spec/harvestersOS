import { ModulePlaceholder } from "@/components/shell/ModulePlaceholder";

export default function ExpensesPage() {
  return (
    <ModulePlaceholder
      title="Expenses"
      summary="Requisitions, approvals, and disbursements — each posting a balanced entry to the ledger. Corrections are reversing entries, preserving a full audit trail."
      planned={[
        "Expense requisition and multi-level approval workflow",
        "Vendor and payee registry",
        "Disbursement postings and reconciliation",
        "Supporting-document attachments",
      ]}
    />
  );
}

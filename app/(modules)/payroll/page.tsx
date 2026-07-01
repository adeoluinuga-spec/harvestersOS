import { ModulePlaceholder } from "@/components/shell/ModulePlaceholder";

export default function PayrollPage() {
  return (
    <ModulePlaceholder
      title="Payroll"
      summary="Staff and clergy compensation runs that post gross, deductions, and net as balanced ledger entries. Pay history is append-only and fully auditable."
      planned={[
        "Employee compensation records",
        "Payroll run generation and approval",
        "Statutory deductions and remittances",
        "Payslip issuance and ledger postings",
      ]}
    />
  );
}

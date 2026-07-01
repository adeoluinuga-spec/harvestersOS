import { ModulePlaceholder } from "@/components/shell/ModulePlaceholder";

export default function AdminPage() {
  return (
    <ModulePlaceholder
      title="Admin"
      summary="System administration — users, roles, approval chains, chart of accounts, and audit oversight. Controls how the ledger is written, never bypassing it."
      planned={[
        "User, role, and permission management",
        "Chart of accounts configuration",
        "Approval-chain and workflow setup",
        "Audit log and system oversight",
      ]}
    />
  );
}

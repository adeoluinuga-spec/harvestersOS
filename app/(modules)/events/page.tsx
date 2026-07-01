import { ModulePlaceholder } from "@/components/shell/ModulePlaceholder";

export default function EventsPage() {
  return (
    <ModulePlaceholder
      title="Events"
      summary="Financials for programmes and events — registrations, ticketing, and event-scoped income and expense, all posted to the ledger."
      planned={[
        "Event registration and ticketing income",
        "Event-scoped budgets and expenses",
        "Attendance-linked financials",
        "Post-event reconciliation",
      ]}
    />
  );
}

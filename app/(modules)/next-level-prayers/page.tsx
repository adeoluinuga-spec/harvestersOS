import { ModulePlaceholder } from "@/components/shell/ModulePlaceholder";

export default function NextLevelPrayersPage() {
  return (
    <ModulePlaceholder
      title="Next Level Prayers"
      summary="Financial tracking for the Next Level Prayers programme — dedicated income streams, partner giving, and programme expenses on the shared ledger."
      planned={[
        "Programme-specific giving and partnerships",
        "Dedicated income and expense tracking",
        "Programme budgeting and reporting",
        "Partner communications",
      ]}
    />
  );
}

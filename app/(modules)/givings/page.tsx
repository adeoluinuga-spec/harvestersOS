import { ModulePlaceholder } from "@/components/shell/ModulePlaceholder";

export default function GivingsPage() {
  return (
    <ModulePlaceholder
      title="Givings"
      summary="Tithes, offerings, seeds, and pledges captured against the immutable ledger. Every giving records a balanced double-entry posting; nothing is edited or deleted, only reversed."
      planned={[
        "Multi-channel giving capture (cash, transfer, card, Paystack)",
        "Giver profiles and pledge tracking",
        "Automatic double-entry postings to the income ledger",
        "Receipts and giving statements",
      ]}
    />
  );
}

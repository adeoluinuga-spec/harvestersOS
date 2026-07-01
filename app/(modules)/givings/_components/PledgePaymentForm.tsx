"use client";

import { useFormState } from "react-dom";
import { Input, Select } from "@/components/ui";
import { GIVING_CHANNELS, humanize } from "@/lib/enums";
import { recordPledgePayment, type GivingFormState } from "../actions";
import { SubmitButton } from "../../admin/_components/FormFeedback";

const initial: GivingFormState = {};

/** Compact inline form to record a payment against a single pledge. */
export function PledgePaymentForm({ pledgeId }: { pledgeId: string }) {
  const [state, action] = useFormState(recordPledgePayment, initial);

  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="pledge_id" value={pledgeId} />
      <Input
        name="amount"
        type="number"
        step="0.01"
        min="0"
        placeholder="Amount"
        className="h-8 w-28 text-xs"
      />
      <Select name="channel" defaultValue="bank_transfer" className="h-8 w-36 text-xs">
        {GIVING_CHANNELS.map((c) => (
          <option key={c} value={c}>
            {humanize(c)}
          </option>
        ))}
      </Select>
      <SubmitButton label="Record" />
      {state.error && (
        <span className="w-full text-right font-sans text-[11px] text-status-danger">
          {state.error}
        </span>
      )}
    </form>
  );
}

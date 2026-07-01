"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { Field, Input, Select } from "@/components/ui";
import { PLEDGE_TYPES, humanize } from "@/lib/enums";
import type { GiverRow } from "@/lib/givings";
import { createPledge, type GivingFormState } from "../actions";
import { Feedback, SubmitButton } from "../../admin/_components/FormFeedback";

const initial: GivingFormState = {};
type EntityLite = { id: string; name: string; functional_currency: string };

export function CreatePledgeForm({
  entities,
  givers,
}: {
  entities: EntityLite[];
  givers: GiverRow[];
}) {
  const [state, action] = useFormState(createPledge, initial);
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  const currency =
    entities.find((e) => e.id === entityId)?.functional_currency ?? "NGN";

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <input type="hidden" name="currency" value={currency} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Giver" htmlFor="giver_id" required>
          <Select id="giver_id" name="giver_id" defaultValue="">
            <option value="" disabled>
              — choose a giver —
            </option>
            {givers.map((g) => (
              <option key={g.id} value={g.id}>
                {g.full_name}
                {g.phone ? ` · ${g.phone}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Entity" htmlFor="entity_id" required>
          <Select
            id="entity_id"
            name="entity_id"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
          >
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.functional_currency})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Pledge type" htmlFor="pledge_type" required>
          <Select id="pledge_type" name="pledge_type" defaultValue="building_fund">
            {PLEDGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Total pledged (${currency})`} htmlFor="total_pledged_amount" required>
          <Input
            id="total_pledged_amount"
            name="total_pledged_amount"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
          />
        </Field>
        <Field label="Target fulfilment date" htmlFor="target_fulfillment_date">
          <Input id="target_fulfillment_date" name="target_fulfillment_date" type="date" />
        </Field>
      </div>
      <Feedback state={state} />
      <div className="flex justify-end">
        <SubmitButton label="Create pledge" />
      </div>
    </form>
  );
}

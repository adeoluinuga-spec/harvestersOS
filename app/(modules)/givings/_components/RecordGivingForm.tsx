"use client";

import { useEffect, useState } from "react";
import { useFormState } from "react-dom";
import { Field, Input, Select } from "@/components/ui";
import { GIVING_CHANNELS, humanize } from "@/lib/enums";
import type { GivingType, GiverRow } from "@/lib/givings";
import { recordGiving, type GivingFormState } from "../actions";
import { Feedback, SubmitButton } from "../../admin/_components/FormFeedback";

const initial: GivingFormState = {};

type EntityLite = { id: string; name: string; functional_currency: string };

export function RecordGivingForm({
  entities,
  givingTypes,
  givers,
}: {
  entities: EntityLite[];
  givingTypes: GivingType[];
  givers: GiverRow[];
}) {
  const [state, action] = useFormState(recordGiving, initial);
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const [mode, setMode] = useState<"new" | "existing" | "anonymous">("new");
  const [nonce, setNonce] = useState(0);

  // Clear transient fields (amount/giver) after a successful post, keeping the
  // batch context (entity, type, channel, date) for the next quick entry.
  useEffect(() => {
    if (state.ok) setNonce((n) => n + 1);
  }, [state]);

  const currency =
    entities.find((e) => e.id === entityId)?.functional_currency ?? "NGN";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="currency" value={currency} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Receiving entity" htmlFor="entity_id" required>
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
        <Field label="Date" htmlFor="transaction_date" required>
          <Input
            id="transaction_date"
            name="transaction_date"
            type="date"
            defaultValue={today}
          />
        </Field>
      </div>

      {/* Giver selection */}
      <div className="rounded-md border border-paper-200 bg-paper-50 p-4">
        <div className="mb-3 flex gap-2">
          {(["new", "existing", "anonymous"] as const).map((m) => (
            <button
              type="button"
              key={m}
              onClick={() => setMode(m)}
              className={
                "rounded px-3 py-1.5 font-sans text-xs font-medium transition-colors " +
                (mode === m
                  ? "bg-ink text-paper"
                  : "bg-paper text-ink-600 hover:bg-paper-100")
              }
            >
              {humanize(m)} giver
            </button>
          ))}
        </div>
        <input type="hidden" name="giver_mode" value={mode} />

        {mode === "new" && (
          <div key={`new-${nonce}`} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="giver_name" required>
              <Input id="giver_name" name="giver_name" placeholder="e.g. Ada Obi" />
            </Field>
            <Field label="Phone" htmlFor="giver_phone">
              <Input id="giver_phone" name="giver_phone" placeholder="0803…" />
            </Field>
            <Field label="Email" htmlFor="giver_email">
              <Input id="giver_email" name="giver_email" type="email" />
            </Field>
            <Field label="Date of birth" htmlFor="giver_dob">
              <Input id="giver_dob" name="giver_dob" type="date" />
            </Field>
          </div>
        )}

        {mode === "existing" && (
          <Field label="Select giver" htmlFor="giver_id" required>
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
        )}

        {mode === "anonymous" && (
          <p className="font-sans text-xs text-muted-foreground">
            This gift will be recorded without a giver identity.
          </p>
        )}
      </div>

      {/* Gift details */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Giving type" htmlFor="giving_type_id" required>
          <Select id="giving_type_id" name="giving_type_id" defaultValue={givingTypes[0]?.id}>
            {givingTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Amount (${currency})`} htmlFor="amount" required>
          <Input
            key={`amt-${nonce}`}
            id="amount"
            name="amount"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            placeholder="0.00"
          />
        </Field>
        <Field label="Channel" htmlFor="channel" required>
          <Select id="channel" name="channel" defaultValue="cash">
            {GIVING_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {humanize(c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note" htmlFor="note">
          <Input id="note" name="note" placeholder="Optional reference" />
        </Field>
      </div>

      {state.flagged && state.flagged.length > 0 && (
        <div className="rounded border border-status-warning/30 bg-status-warning-bg px-3 py-2 font-sans text-xs text-status-warning">
          Possible duplicate giver detected (
          {state.flagged
            .map((f) => `${f.name} · ${(f.score * 100).toFixed(0)}% ${f.reason}`)
            .join(", ")}
          ). Recorded under a new giver and queued for merge review.
        </div>
      )}

      <Feedback state={state} />
      <div className="flex justify-end">
        <SubmitButton label="Record & post gift" />
      </div>
    </form>
  );
}

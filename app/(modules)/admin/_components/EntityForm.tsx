"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { Field, Input, Select } from "@/components/ui";
import {
  ENTITY_TYPES,
  LEGAL_STATUSES,
  humanize,
  type EntityType,
} from "@/lib/enums";
import type { EntityOption } from "@/lib/repo";
import { createEntity, type FormState } from "../actions";
import { Feedback, SubmitButton } from "./FormFeedback";

const initial: FormState = {};

export function EntityForm({ parents }: { parents: EntityOption[] }) {
  const [state, action] = useFormState(createEntity, initial);
  const [type, setType] = useState<EntityType>("campus");
  const formRef = useRef<HTMLFormElement>(null);

  // Reset the form after a successful create.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  const isGroup = type === "group";
  const isEvent = type === "event";

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Entity type" htmlFor="type" required>
          <Select
            id="type"
            name="type"
            defaultValue="campus"
            onChange={(e) => setType(e.target.value as EntityType)}
          >
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Parent entity"
          htmlFor="parent_entity_id"
          required={!isGroup}
          hint={isGroup ? "Top-level Group has no parent" : undefined}
        >
          <Select id="parent_entity_id" name="parent_entity_id" disabled={isGroup}>
            <option value="">— none —</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({humanize(p.type)})
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Name" htmlFor="name" required>
        <Input id="name" name="name" placeholder="e.g. Ikorodu Campus" required />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Country" htmlFor="country" hint="ISO alpha-2">
          <Input id="country" name="country" placeholder="NG" maxLength={2} />
        </Field>
        <Field label="Functional currency" htmlFor="functional_currency" required hint="ISO 4217">
          <Input
            id="functional_currency"
            name="functional_currency"
            placeholder="NGN"
            maxLength={3}
            required
          />
        </Field>
        <Field label="Legal status" htmlFor="legal_status">
          <Select id="legal_status" name="legal_status">
            <option value="">— unspecified —</option>
            {LEGAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {isEvent && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Start date" htmlFor="start_date" required>
            <Input id="start_date" name="start_date" type="date" required />
          </Field>
          <Field label="End date" htmlFor="end_date" required>
            <Input id="end_date" name="end_date" type="date" required />
          </Field>
        </div>
      )}

      <Feedback state={state} />
      <div className="flex justify-end">
        <SubmitButton label="Create entity" />
      </div>
    </form>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { useFormState } from "react-dom";
import { Field, Input, Select } from "@/components/ui";
import { ACCOUNT_TYPES, FUND_CLASSIFICATIONS, humanize } from "@/lib/enums";
import { createAccount, type FormState } from "../actions";
import { Feedback, SubmitButton } from "./FormFeedback";

const initial: FormState = {};

export function AccountForm() {
  const [state, action] = useFormState(createAccount, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Code" htmlFor="code" required hint="e.g. 4050">
          <Input id="code" name="code" placeholder="4050" required />
        </Field>
        <Field label="Name" htmlFor="name" required className="sm:col-span-2">
          <Input id="name" name="name" placeholder="e.g. Missions Giving" required />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Account type" htmlFor="account_type" required>
          <Select id="account_type" name="account_type" defaultValue="income">
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fund classification" htmlFor="fund_classification" required>
          <Select
            id="fund_classification"
            name="fund_classification"
            defaultValue="unrestricted"
          >
            {FUND_CLASSIFICATIONS.map((f) => (
              <option key={f} value={f}>
                {humanize(f)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Feedback state={state} />
      <div className="flex justify-end">
        <SubmitButton label="Create account" />
      </div>
    </form>
  );
}

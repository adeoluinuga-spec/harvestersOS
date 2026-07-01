"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { Field, Select } from "@/components/ui";
import { APP_ROLES, humanize, isGlobalRole } from "@/lib/enums";
import type { EntityOption, UserOption } from "@/lib/repo";
import { grantRole, type FormState } from "../actions";
import { Feedback, SubmitButton } from "./FormFeedback";

const initial: FormState = {};

export function AssignRoleForm({
  users,
  entities,
}: {
  users: UserOption[];
  entities: EntityOption[];
}) {
  const [state, action] = useFormState(grantRole, initial);
  const [role, setRole] = useState<string>("campus_finance_officer");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  const global = isGlobalRole(role);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <Field label="User" htmlFor="user_id" required>
        <Select id="user_id" name="user_id" required defaultValue="">
          <option value="" disabled>
            — select a user —
          </option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.email}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Role" htmlFor="role" required>
          <Select
            id="role"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {APP_ROLES.map((r) => (
              <option key={r} value={r}>
                {humanize(r)}
                {isGlobalRole(r) ? " (global)" : ""}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Entity scope"
          htmlFor="entity_id"
          required={!global}
          hint={global ? "Global role — applies to all entities" : "Cascades to child entities"}
        >
          <Select id="entity_id" name="entity_id" disabled={global}>
            <option value="">— select an entity —</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({humanize(e.type)})
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Feedback state={state} />
      <div className="flex justify-end">
        <SubmitButton label="Grant role" />
      </div>
    </form>
  );
}

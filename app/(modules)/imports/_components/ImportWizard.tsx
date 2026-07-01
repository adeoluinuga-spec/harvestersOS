"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Button, Field, Select } from "@/components/ui";
import { uploadAndValidate, type ImportFormState } from "../actions";

export type ImportTypeInfo = {
  key: string;
  label: string;
  description: string;
  entityScoped: boolean;
  columns: { key: string; required?: boolean; help?: string }[];
};

const initial: ImportFormState = {};

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Validating…" : "Upload & preview"}
    </Button>
  );
}

export function ImportWizard({
  types,
  entities,
  initialType,
  initialEntity,
}: {
  types: ImportTypeInfo[];
  entities: { id: string; name: string }[];
  initialType?: string;
  initialEntity?: string;
}) {
  const [state, action] = useFormState(uploadAndValidate, initial);
  const [typeKey, setTypeKey] = useState(initialType || types[0]?.key || "");
  const def = types.find((t) => t.key === typeKey);

  return (
    <form action={action} className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="What are you importing?" htmlFor="import_type" required>
          <Select
            id="import_type"
            name="import_type"
            value={typeKey}
            onChange={(e) => setTypeKey(e.target.value)}
          >
            {types.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Entity context"
          htmlFor="entity_id"
          required={def?.entityScoped}
          hint={def?.entityScoped ? "Required for this import" : "Optional — tags the batch"}
        >
          <Select id="entity_id" name="entity_id" defaultValue={initialEntity || ""}>
            <option value="">— none —</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {def && (
        <div className="rounded-md border border-paper-200 bg-paper-50 p-4">
          <p className="font-sans text-sm text-ink-700">{def.description}</p>
          <a
            href={`/imports/template?type=${def.key}`}
            className="mt-2 inline-block font-sans text-xs font-semibold text-ink underline"
          >
            ↓ Download the {def.label} template (.csv)
          </a>
          <div className="mt-3">
            <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Columns
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {def.columns.map((c) => (
                <span
                  key={c.key}
                  title={c.help}
                  className={
                    "rounded border px-1.5 py-0.5 font-mono text-[11px] " +
                    (c.required
                      ? "border-ink bg-ink text-paper"
                      : "border-paper-300 bg-paper text-ink-600")
                  }
                >
                  {c.key}
                  {c.required ? "*" : ""}
                </span>
              ))}
            </div>
            <p className="mt-1 font-sans text-[11px] text-muted-foreground">
              * required. Hover a column for its format. Entities are referenced by name.
            </p>
          </div>
        </div>
      )}

      <Field label="Spreadsheet file (.xlsx, .xls or .csv)" htmlFor="file" required>
        <input
          id="file"
          name="file"
          type="file"
          accept=".xlsx,.xls,.csv"
          required
          className="block w-full font-sans text-sm text-ink file:mr-3 file:rounded file:border file:border-silver file:bg-paper file:px-3 file:py-1.5 file:font-sans file:text-xs file:text-ink hover:file:border-ink"
        />
      </Field>

      {state.error && (
        <p className="rounded border border-status-danger/30 bg-status-danger-bg px-3 py-2 font-sans text-xs text-status-danger">
          {state.error}
        </p>
      )}

      <div className="flex justify-end">
        <SubmitBtn />
      </div>
    </form>
  );
}

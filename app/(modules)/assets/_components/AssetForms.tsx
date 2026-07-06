"use client";

import { useFormState } from "react-dom";
import { Field, Input, Select } from "@/components/ui";
import { humanize } from "@/lib/enums";
import {
  capitalizeAssetAction,
  disposeAssetAction,
  runDepreciationAction,
  type AssetFormState,
} from "../actions";
import { Feedback, SubmitButton } from "../../admin/_components/FormFeedback";

const initial: AssetFormState = {};

type EntityLite = { id: string; name: string; functional_currency: string };

export function CapitalizeAssetForm({
  entities,
  categories,
}: {
  entities: EntityLite[];
  categories: readonly string[];
}) {
  const [state, action] = useFormState(capitalizeAssetAction, initial);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Owning entity" htmlFor="entity_id" required>
          <Select id="entity_id" name="entity_id" defaultValue={entities[0]?.id}>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.functional_currency})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Asset name" htmlFor="name" required>
          <Input id="name" name="name" placeholder="e.g. 250kVA Generator — Gbagada" />
        </Field>
        <Field label="Category" htmlFor="category" required>
          <Select id="category" name="category" defaultValue="equipment">
            {categories.map((c) => (
              <option key={c} value={c}>
                {humanize(c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Acquisition date" htmlFor="acquisition_date" required>
          <Input id="acquisition_date" name="acquisition_date" type="date" defaultValue={today} max={today} />
        </Field>
        <Field label="Cost" htmlFor="cost" required>
          <Input id="cost" name="cost" type="number" min="0.01" step="0.01" />
        </Field>
        <Field label="Salvage value" htmlFor="salvage_value">
          <Input id="salvage_value" name="salvage_value" type="number" min="0" step="0.01" defaultValue="0" />
        </Field>
        <Field label="Useful life (months)" htmlFor="useful_life_months" required>
          <Input id="useful_life_months" name="useful_life_months" type="number" min="1" placeholder="60" />
        </Field>
        <Field label="Funding" htmlFor="funding" required>
          <Select id="funding" name="funding" defaultValue="bank">
            <option value="bank">Paid from bank (posts credit to Bank — Operations)</option>
            <option value="opening">Already owned (opening balance equity)</option>
          </Select>
        </Field>
      </div>
      <Feedback state={state} />
      <SubmitButton label="Capitalize & post" />
    </form>
  );
}

export function RunDepreciationForm() {
  const [state, action] = useFormState(runDepreciationAction, initial);
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  const def = lastMonth.toISOString().slice(0, 7);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="space-y-1">
        <span className="block font-sans text-xs font-semibold text-muted-foreground">Month</span>
        <input
          type="month"
          name="period"
          defaultValue={def}
          className="h-10 rounded-md border border-paper-300 bg-paper px-3 font-sans text-sm"
        />
      </label>
      <SubmitButton label="Run depreciation" />
      <div className="basis-full">
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function DisposeAssetForm({ assetId, entityId }: { assetId: string; entityId: string }) {
  const [state, action] = useFormState(disposeAssetAction, initial);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="entity_id" value={entityId} />
      <input
        type="date"
        name="disposal_date"
        defaultValue={today}
        max={today}
        className="h-8 rounded border border-paper-300 bg-paper px-2 font-sans text-xs"
      />
      <input
        type="number"
        name="proceeds"
        min="0"
        step="0.01"
        placeholder="Proceeds"
        className="h-8 w-24 rounded border border-paper-300 bg-paper px-2 font-sans text-xs"
      />
      <button className="rounded border border-status-danger/40 px-2.5 py-1 font-sans text-xs font-semibold text-status-danger transition-colors hover:bg-status-danger-bg">
        Dispose
      </button>
      <div className="basis-full">
        <Feedback state={state} />
      </div>
    </form>
  );
}

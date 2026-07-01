"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";
import type { FormState } from "../actions";

/** Submit button that reflects the pending state of the enclosing form. */
export function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/** Inline success / error banner driven by the server action's return state. */
export function Feedback({ state }: { state: FormState }) {
  if (state.error)
    return (
      <p className="rounded border border-status-danger/30 bg-status-danger-bg px-3 py-2 font-sans text-xs text-status-danger">
        {state.error}
      </p>
    );
  if (state.ok)
    return (
      <p className="rounded border border-status-success/30 bg-status-success-bg px-3 py-2 font-sans text-xs text-status-success">
        {state.message}
      </p>
    );
  return null;
}

"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";

export type ActionState = { ok?: boolean; error?: string; message?: string };

export function SubmitButton({
  label,
  pendingLabel = "Saving...",
  variant = "primary",
}: {
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} variant={variant}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function Feedback({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p className="rounded border border-status-danger/30 bg-status-danger-bg px-3 py-2 font-sans text-xs text-status-danger">
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p className="rounded border border-status-success/30 bg-status-success-bg px-3 py-2 font-sans text-xs text-status-success">
        {state.message}
      </p>
    );
  }
  return null;
}

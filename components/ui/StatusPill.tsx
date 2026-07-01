import { cn } from "@/lib/utils";

/**
 * Approval / ledger-state pill.
 *
 * These are the only sanctioned uses of chromatic color in the system, and the
 * palette is intentionally desaturated and editorial (no SaaS green/red).
 * The status set anticipates the ledger + approval workflow of later phases,
 * but carries NO business logic here — purely presentational.
 */
export type Status =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "posted"
  | "reversed"
  | "void";

const styles: Record<Status, { label: string; className: string; dot: string }> = {
  draft: {
    label: "Draft",
    className: "bg-status-neutral-bg text-status-neutral border-status-neutral/20",
    dot: "bg-status-neutral",
  },
  pending: {
    label: "Pending Approval",
    className: "bg-status-warning-bg text-status-warning border-status-warning/25",
    dot: "bg-status-warning",
  },
  approved: {
    label: "Approved",
    className: "bg-status-success-bg text-status-success border-status-success/25",
    dot: "bg-status-success",
  },
  rejected: {
    label: "Rejected",
    className: "bg-status-danger-bg text-status-danger border-status-danger/25",
    dot: "bg-status-danger",
  },
  posted: {
    label: "Posted",
    className: "bg-ink text-paper border-ink",
    dot: "bg-silver",
  },
  reversed: {
    label: "Reversed",
    className: "bg-status-neutral-bg text-status-neutral border-status-neutral/20",
    dot: "bg-status-neutral",
  },
  void: {
    label: "Void",
    className: "bg-paper-100 text-ink-400 border-paper-300 line-through",
    dot: "bg-ink-300",
  },
};

export interface StatusPillProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  status: Status;
  /** Override the default label text. */
  label?: string;
}

export function StatusPill({
  status,
  label,
  className,
  ...props
}: StatusPillProps) {
  const s = styles[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-sans text-[11px] font-medium tracking-tight",
        s.className,
        className
      )}
      {...props}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden />
      {label ?? s.label}
    </span>
  );
}

import { cn } from "@/lib/utils";

type BadgeVariant = "solid" | "outline" | "muted";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variants: Record<BadgeVariant, string> = {
  solid: "bg-ink text-paper border border-ink",
  outline: "bg-transparent text-ink border border-silver",
  muted: "bg-paper-100 text-ink-600 border border-paper-200",
};

/** Neutral, monochrome label. For approval/ledger state, use StatusPill. */
export function Badge({ className, variant = "muted", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-0.5 font-sans text-[11px] font-medium uppercase tracking-[0.08em]",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

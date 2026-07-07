import { cn } from "@/lib/utils";

type BadgeVariant = "solid" | "outline" | "muted";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variants: Record<BadgeVariant, string> = {
  solid: "bg-ink text-white border border-ink",
  outline: "bg-surface text-ink-600 border border-paper-300",
  muted: "bg-paper-100 text-ink-600 border border-transparent",
};

/** Neutral label. For approval/ledger state, use StatusPill. */
export function Badge({ className, variant = "muted", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-sans text-[11px] font-medium",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

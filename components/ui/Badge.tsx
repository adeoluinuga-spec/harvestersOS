import { cn } from "@/lib/utils";

type BadgeVariant = "solid" | "outline" | "muted";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variants: Record<BadgeVariant, string> = {
  solid: "bg-ink text-paper border border-ink shadow-[0_8px_18px_rgba(7,7,7,0.18)]",
  outline: "bg-paper text-ink border border-champagne/70",
  muted: "bg-champagne-light text-ink-700 border border-champagne/25",
};

/** Neutral, monochrome label. For approval/ledger state, use StatusPill. */
export function Badge({ className, variant = "muted", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-sans text-[11px] font-semibold uppercase tracking-[0.08em]",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

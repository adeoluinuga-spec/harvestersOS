import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  // Black fill — the primary action treatment
  primary:
    "bg-ink text-paper border border-ink hover:bg-ink-800 active:bg-ink-900",
  // White with hairline — secondary
  secondary:
    "bg-paper text-ink border border-silver hover:border-ink hover:bg-paper-50",
  ghost: "bg-transparent text-ink border border-transparent hover:bg-paper-100",
  danger:
    "bg-paper text-status-danger border border-status-danger/40 hover:bg-status-danger-bg",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded font-sans font-medium tracking-tight transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";

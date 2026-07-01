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
  primary:
    "border border-ink bg-ink text-paper shadow-[0_12px_28px_rgba(7,7,7,0.22)] hover:bg-ink-800 hover:shadow-lift active:bg-ink-950",
  secondary:
    "border border-champagne/60 bg-paper text-ink shadow-card hover:border-champagne hover:bg-paper-50 hover:shadow-lift",
  ghost:
    "border border-transparent bg-transparent text-ink hover:bg-paper-100 hover:text-ink-950",
  danger:
    "border border-status-danger/40 bg-paper text-status-danger hover:bg-status-danger-bg",
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
        "inline-flex items-center justify-center gap-2 rounded-md font-sans font-semibold tracking-tight transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";

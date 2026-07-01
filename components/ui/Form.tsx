import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/** Vertical field wrapper: label + control + optional hint/error. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label?: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-status-danger">*</span>}
        </Label>
      )}
      {children}
      {error ? (
        <p className="font-sans text-xs text-status-danger">{error}</p>
      ) : hint ? (
        <p className="font-sans text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "font-sans text-xs font-semibold uppercase tracking-[0.08em] text-ink-600",
        className
      )}
      {...props}
    />
  );
}

const controlBase =
  "w-full rounded-md border border-paper-300 bg-paper/90 px-3 py-2 font-sans text-sm text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] placeholder:text-ink-300 transition-all focus:border-champagne focus:bg-surface focus:shadow-card focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:bg-paper-50";

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(controlBase, "h-10", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(controlBase, "min-h-[96px] resize-y", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(controlBase, "h-10 appearance-none pr-8", className)}
    {...props}
  />
));
Select.displayName = "Select";

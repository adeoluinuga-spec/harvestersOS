import { cn } from "@/lib/utils";

/** Keyboard-shortcut hint chip (⌘K and friends). */
export function Kbd({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-paper-300 bg-paper-50 px-1 font-sans text-[10px] font-semibold text-ink-500",
        className
      )}
      {...props}
    />
  );
}

import { cn } from "@/lib/utils";

/**
 * Empty states teach, they don't apologize: say what would appear here and
 * offer the action that creates it.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className
      )}
    >
      {icon && (
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-paper-100 text-ink-400">
          {icon}
        </div>
      )}
      <div className="font-sans text-sm font-semibold text-ink">{title}</div>
      {description && (
        <p className="max-w-sm font-sans text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

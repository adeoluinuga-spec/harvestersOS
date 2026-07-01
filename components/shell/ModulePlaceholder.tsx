import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";

/**
 * Shared placeholder for module routes during Phase 0.
 * Intentionally carries NO data or business logic — it exists to prove the
 * shell, routing, and design system, and to mark where each module will grow.
 */
export function ModulePlaceholder({
  title,
  summary,
  planned,
}: {
  title: string;
  summary: string;
  planned: string[];
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Module
        </div>
        <h2 className="font-display text-3xl tracking-display text-ink">
          {title}
        </h2>
        <p className="max-w-2xl font-sans text-sm leading-relaxed text-muted-foreground">
          {summary}
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-md border border-dashed border-silver bg-paper px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-silver" aria-hidden />
        <span className="font-sans text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Scaffold only — no data models or business logic yet
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Planned in later phases</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {planned.map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 font-sans text-sm text-ink-700"
              >
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-300" />
                {item}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Textarea,
} from "@/components/ui";
import { askAnalyticsAction, type AnalyticsQueryState } from "../actions";

const initialState: AnalyticsQueryState = { ok: false };

export function NaturalLanguageQuery({ initialQuestion }: { initialQuestion?: string }) {
  const [state, formAction] = useFormState(askAnalyticsAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const autoRan = useRef(false);

  // When arriving from a dashboard "Analyze with AI" link, run it automatically.
  useEffect(() => {
    if (initialQuestion && !autoRan.current) {
      autoRan.current = true;
      formRef.current?.requestSubmit();
    }
  }, [initialQuestion]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Ask the ledger</CardTitle>
        </CardHeader>
        <CardContent>
          <form ref={formRef} action={formAction} className="space-y-4">
            <Field label="Question" required>
              <Textarea
                name="question"
                required
                defaultValue={initialQuestion}
                placeholder="How much did Next Level Prayers spend vs budget this quarter?"
              />
            </Field>
            <SubmitButton />
          </form>
          {state.error && (
            <div className="mt-4 rounded border border-status-danger/30 bg-status-danger-bg px-4 py-3 font-sans text-sm text-status-danger">
              {state.error}
            </div>
          )}
        </CardContent>
      </Card>

      {state.ok && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{state.title}</CardTitle>
              {state.notes && (
                <p className="mt-1 font-sans text-sm text-muted-foreground">
                  {state.notes}
                </p>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ResultTable columns={state.columns ?? []} rows={state.rows ?? []} />
            {state.sql && (
              <details className="rounded border border-paper-200 bg-paper-50 p-3">
                <summary className="cursor-pointer font-sans text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Read-only SQL
                </summary>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-ink">
                  {state.sql}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Asking..." : "Ask"}
    </Button>
  );
}

function ResultTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Record<string, string | number | boolean | null>[];
}) {
  if (rows.length === 0) {
    return (
      <div className="font-sans text-sm text-muted-foreground">
        No rows matched the question.
      </div>
    );
  }

  return (
    <Table>
      <TableHead>
        <TableRow>
          {columns.map((column) => (
            <TableHeaderCell key={column}>{column.replaceAll("_", " ")}</TableHeaderCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={index}>
            {columns.map((column) => (
              <TableCell key={column}>{formatCell(row[column])}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function formatCell(value: string | number | boolean | null) {
  if (value === null) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

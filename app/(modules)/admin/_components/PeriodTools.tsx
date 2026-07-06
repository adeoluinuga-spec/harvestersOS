"use client";

import { useFormState } from "react-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import {
  closeFiscalYearAction,
  closePeriodsThroughAction,
  type FormState,
} from "../actions";
import { Feedback, SubmitButton } from "./FormFeedback";

const initial: FormState = {};

/** Bulk close-through and year-end close controls for the Periods page. */
export function PeriodTools({ defaultThrough }: { defaultThrough: string }) {
  const [throughState, throughAction] = useFormState(closePeriodsThroughAction, initial);
  const [yearState, yearAction] = useFormState(closeFiscalYearAction, initial);
  const lastYear = new Date().getFullYear() - 1;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Close periods through…</CardTitle>
          <CardDescription>
            Closes every ended, still-open month up to the cut-off in one step.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={throughAction} className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block font-sans text-xs font-semibold text-muted-foreground">
                Cut-off date
              </span>
              <input
                type="date"
                name="through"
                defaultValue={defaultThrough}
                className="h-10 rounded-md border border-paper-300 bg-paper px-3 font-sans text-sm"
              />
            </label>
            <SubmitButton label="Close periods" />
          </form>
          <div className="mt-3">
            <Feedback state={throughState} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Year-end close</CardTitle>
          <CardDescription>
            Requires every period of the year closed. Posts closing entries to
            Retained Earnings — this cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={yearAction} className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block font-sans text-xs font-semibold text-muted-foreground">
                Fiscal year
              </span>
              <input
                type="number"
                name="fiscal_year"
                defaultValue={lastYear}
                min={2000}
                max={lastYear}
                className="h-10 w-28 rounded-md border border-paper-300 bg-paper px-3 font-sans text-sm"
              />
            </label>
            <SubmitButton label="Close fiscal year" />
          </form>
          <div className="mt-3">
            <Feedback state={yearState} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

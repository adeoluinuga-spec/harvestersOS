import Link from "next/link";
import { Send, Sparkles } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { compactMoney, shortDate } from "@/lib/format";
import {
  getCampusesForWeeklyReports,
  getSubgroupsForWeeklyReports,
  getWeeklyReportInbox,
  lastCompletedWeek,
  reportScope,
} from "@/lib/weeklyIncomeReports";
import {
  generateCampusWeeklyReportAction,
  sendSubgroupWeeklyReportsAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function WeeklyReportsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireUser();
  const scope = reportScope(ctx);
  const period = lastCompletedWeek();
  const [campuses, subgroups, inbox] = await Promise.all([
    getCampusesForWeeklyReports(scope),
    getSubgroupsForWeeklyReports(ctx),
    getWeeklyReportInbox(ctx, 50),
  ]);
  const sent = String(searchParams?.sent ?? "");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="relative overflow-hidden rounded-xl bg-ink px-6 py-7 text-paper shadow-lift sm:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(200,169,106,0.28),transparent_24rem)]" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-champagne">
              In-app income reporting
            </div>
            <h2 className="font-display text-4xl font-semibold tracking-display text-paper sm:text-5xl">
              Weekly Income Reports
            </h2>
            <p className="mt-1 max-w-3xl font-sans text-sm leading-relaxed text-paper/68">
              Campus-level weekly giving, monthly weeks, target achievement, and AI interpretation for pastors.
            </p>
          </div>
          <Link href="/reports" className="font-sans text-sm font-semibold text-champagne hover:text-paper">
            Back to reports
          </Link>
        </div>
      </section>

      {sent && (
        <Card>
          <CardContent>
            <div className="font-sans text-sm font-semibold text-emerald">
              Sent {sent} weekly report{sent === "1" ? "" : "s"} to campus report inboxes.
            </div>
          </CardContent>
        </Card>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Send to all campuses in a sub-group</CardTitle>
              <CardDescription>For sub-group finance officers and higher scopes.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form action={sendSubgroupWeeklyReportsAction} className="space-y-4">
              <Field label="Sub-group" required>
                <Select name="subgroup_id" required>
                  <option value="">Select sub-group</option>
                  {subgroups.map((sg) => (
                    <option key={sg.id} value={sg.id}>
                      {sg.name} ({sg.campus_count} campuses)
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Week start"><Input name="week_start" type="date" defaultValue={period.weekStart} /></Field>
                <Field label="Week end"><Input name="week_end" type="date" defaultValue={period.weekEnd} /></Field>
              </div>
              <Button type="submit" className="gap-2">
                <Send className="h-4 w-4" />
                Send weekly report to all my campuses
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Generate one campus report</CardTitle>
              <CardDescription>Useful for review before sending, or ad-hoc pastoral insight.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form action={generateCampusWeeklyReportAction} className="space-y-4">
              <Field label="Campus" required>
                <Select name="campus_id" required>
                  <option value="">Select campus</option>
                  {campuses.map((campus) => (
                    <option key={campus.id} value={campus.id}>{campus.name}</option>
                  ))}
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Week start"><Input name="week_start" type="date" defaultValue={period.weekStart} /></Field>
                <Field label="Week end"><Input name="week_end" type="date" defaultValue={period.weekEnd} /></Field>
              </div>
              <Button type="submit" variant="secondary" className="gap-2">
                <Sparkles className="h-4 w-4" />
                Generate report
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Reports inbox</CardTitle>
          <CardDescription>In-app delivery for campus pastors, sub-group leaders, group pastors, and finance oversight.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Campus</TableHeaderCell>
                <TableHeaderCell>Week</TableHeaderCell>
                <TableHeaderCell className="text-right">Weekly giving</TableHeaderCell>
                <TableHeaderCell>Sent</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {inbox.map((report) => {
                const totals = report.generatedData.totals as { weekly_ngn?: number };
                return (
                  <TableRow key={report.id}>
                    <TableCell>
                      <Link href={`/reports/weekly/${report.id}`} className="font-semibold text-ink hover:text-champagne-dark">
                        {report.entityName}
                      </Link>
                    </TableCell>
                    <TableCell>{shortDate(report.weekStart)} - {shortDate(report.weekEnd)}</TableCell>
                    <TableCell className="text-right">{compactMoney(Number(totals?.weekly_ngn ?? 0))}</TableCell>
                    <TableCell>{report.sentAt ? shortDate(report.sentAt) : "Draft"}</TableCell>
                  </TableRow>
                );
              })}
              {inbox.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    No weekly income reports yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

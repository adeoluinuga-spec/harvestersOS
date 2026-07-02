/* eslint-disable @typescript-eslint/no-explicit-any -- recharts tooltip payloads are loosely typed */
"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { compactMoney } from "@/lib/format";

const INK = "#0A0A0A";
const CHAMPAGNE = "#C8A96A";
const DANGER = "#8B2B2B";
const GRID = "#EAEAEA";
const MUTED = "#8F8F8F";

const axis = { stroke: MUTED, fontSize: 11, tickLine: false, axisLine: false };
const compact = (v: number) => compactMoney(v);

function MoneyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-paper-200 bg-surface px-3 py-2 shadow-overlay">
      <div className="font-sans text-[11px] font-semibold text-ink">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="font-sans text-xs" style={{ color: p.color }}>
          {p.name}: <span className="font-semibold">{compactMoney(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function ChartCard({ title, subtitle, height = 240, children }: { title: string; subtitle?: string; height?: number; children: React.ReactElement }) {
  return (
    <Card>
      <CardHeader className="border-b-0 pb-2">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {subtitle && <div className="mt-0.5 font-sans text-xs text-muted-foreground">{subtitle}</div>}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div style={{ width: "100%", height }}>
          <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardCharts({
  givingTrend, incomeExpense, givingByGroup, fundProgress,
}: {
  givingTrend: { label: string; amount: number }[];
  incomeExpense: { label: string; income: number; expense: number }[];
  givingByGroup: { name: string; amount: number }[];
  fundProgress: { name: string; percent: number }[];
}) {
  const shortName = (n: string) => n.replace("Group ", "G").replace(" — ", " ").replace("Harvesters ", "");

  return (
    <section className="grid gap-6 lg:grid-cols-2">
      <ChartCard title="Consolidated giving trend" subtitle="Monthly, NGN-equivalent (last 12 months)">
        <AreaChart data={givingTrend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="giveFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHAMPAGNE} stopOpacity={0.5} />
              <stop offset="100%" stopColor={CHAMPAGNE} stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={52} tickFormatter={compact} />
          <Tooltip content={<MoneyTooltip />} />
          <Area type="monotone" dataKey="amount" name="Giving" stroke={CHAMPAGNE} strokeWidth={2} fill="url(#giveFill)" />
        </AreaChart>
      </ChartCard>

      <ChartCard title="Income vs expense" subtitle="Monthly, NGN-equivalent (last 12 months)">
        <LineChart data={incomeExpense} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={52} tickFormatter={compact} />
          <Tooltip content={<MoneyTooltip />} />
          <Line type="monotone" dataKey="income" name="Income" stroke={INK} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="expense" name="Expense" stroke={DANGER} strokeWidth={2} dot={false} />
        </LineChart>
      </ChartCard>

      <ChartCard title="Giving by group" subtitle="Year to date, NGN-equivalent">
        <BarChart data={givingByGroup.map((d) => ({ ...d, short: shortName(d.name) }))} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" {...axis} tickFormatter={compact} />
          <YAxis type="category" dataKey="short" {...axis} width={64} />
          <Tooltip content={<MoneyTooltip />} cursor={{ fill: "rgba(200,169,106,0.08)" }} />
          <Bar dataKey="amount" name="Giving" fill={CHAMPAGNE} radius={[0, 3, 3, 0]} barSize={18} />
        </BarChart>
      </ChartCard>

      <ChartCard title="Restricted fund progress" subtitle="Percent of target funded">
        <BarChart data={fundProgress.map((d) => ({ ...d, short: shortName(d.name) }))} layout="vertical" margin={{ top: 4, right: 28, left: 8, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" domain={[0, 100]} {...axis} tickFormatter={(v) => `${v}%`} />
          <YAxis type="category" dataKey="short" {...axis} width={64} />
          <Tooltip formatter={(v: any) => [`${v}%`, "Funded"]} cursor={{ fill: "rgba(200,169,106,0.08)" }} />
          <Bar dataKey="percent" name="Funded" radius={[0, 3, 3, 0]} barSize={16}>
            {fundProgress.map((d, i) => (
              <Cell key={i} fill={d.percent >= 66 ? "#1F6F43" : d.percent >= 33 ? CHAMPAGNE : DANGER} />
            ))}
          </Bar>
        </BarChart>
      </ChartCard>
    </section>
  );
}

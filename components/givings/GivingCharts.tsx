/* eslint-disable @typescript-eslint/no-explicit-any -- recharts payloads are loosely typed */
"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { compactMoney } from "@/lib/format";
import { humanize } from "@/lib/enums";

const INK = "#0A0A0A";
const CHAMPAGNE = "#C8A96A";
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

function ChartCard({ title, subtitle, height = 220, children }: { title: string; subtitle?: string; height?: number; children: React.ReactElement }) {
  return (
    <Card>
      <CardHeader className="border-b-0 pb-1">
        <div>
          <CardTitle className="text-sm">{title}</CardTitle>
          {subtitle && <div className="mt-0.5 font-sans text-[11px] text-muted-foreground">{subtitle}</div>}
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

export function EntityGivingCharts({
  mom, wow, yoy, channels,
}: {
  mom: { label: string; amount: number }[];
  wow: { label: string; amount: number }[];
  yoy: { label: string; thisYear: number; lastYear: number }[];
  channels: { name: string; amount: number }[];
}) {
  const chan = channels.map((c) => ({ name: humanize(c.name), amount: c.amount }));
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Month on month" subtitle="NGN-equivalent, last 12 months">
        <AreaChart data={mom} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <defs><linearGradient id="momFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CHAMPAGNE} stopOpacity={0.5} /><stop offset="100%" stopColor={CHAMPAGNE} stopOpacity={0.04} /></linearGradient></defs>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={50} tickFormatter={compact} />
          <Tooltip content={<MoneyTooltip />} />
          <Area type="monotone" dataKey="amount" name="Giving" stroke={CHAMPAGNE} strokeWidth={2} fill="url(#momFill)" />
        </AreaChart>
      </ChartCard>

      <ChartCard title="Week on week" subtitle="NGN-equivalent, last 12 weeks">
        <BarChart data={wow} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={50} tickFormatter={compact} />
          <Tooltip content={<MoneyTooltip />} cursor={{ fill: "rgba(200,169,106,0.08)" }} />
          <Bar dataKey="amount" name="Giving" fill={INK} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartCard>

      <ChartCard title="Year on year" subtitle="This year vs last year by month">
        <LineChart data={yoy} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={50} tickFormatter={compact} />
          <Tooltip content={<MoneyTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="thisYear" name="This year" stroke={CHAMPAGNE} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="lastYear" name="Last year" stroke={MUTED} strokeWidth={2} strokeDasharray="4 3" dot={false} />
        </LineChart>
      </ChartCard>

      <ChartCard title="By channel" subtitle="Year to date">
        <BarChart data={chan} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" {...axis} tickFormatter={compact} />
          <YAxis type="category" dataKey="name" {...axis} width={96} />
          <Tooltip content={<MoneyTooltip />} cursor={{ fill: "rgba(200,169,106,0.08)" }} />
          <Bar dataKey="amount" name="Giving" fill={CHAMPAGNE} radius={[0, 3, 3, 0]} barSize={16} />
        </BarChart>
      </ChartCard>
    </section>
  );
}

export function InflowCharts({ daily, weekly }: { daily: { label: string; amount: number }[]; weekly: { label: string; amount: number }[] }) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Daily inflow" subtitle="Last 30 days">
        <AreaChart data={daily} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <defs><linearGradient id="dayFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CHAMPAGNE} stopOpacity={0.5} /><stop offset="100%" stopColor={CHAMPAGNE} stopOpacity={0.04} /></linearGradient></defs>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" {...axis} interval={4} />
          <YAxis {...axis} width={50} tickFormatter={compact} />
          <Tooltip content={<MoneyTooltip />} />
          <Area type="monotone" dataKey="amount" name="Inflow" stroke={CHAMPAGNE} strokeWidth={2} fill="url(#dayFill)" />
        </AreaChart>
      </ChartCard>
      <ChartCard title="Weekly inflow" subtitle="Last 12 weeks">
        <BarChart data={weekly} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={50} tickFormatter={compact} />
          <Tooltip content={<MoneyTooltip />} cursor={{ fill: "rgba(200,169,106,0.08)" }} />
          <Bar dataKey="amount" name="Inflow" fill={INK} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartCard>
    </section>
  );
}

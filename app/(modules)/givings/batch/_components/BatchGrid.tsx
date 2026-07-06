"use client";

import { useMemo, useRef, useState } from "react";
import { Field, Select } from "@/components/ui";
import { humanize } from "@/lib/enums";
import { recordGivingBatch, type BatchRowResult } from "../actions";

type EntityLite = { id: string; name: string; functional_currency: string };
type TypeLite = { id: string; name: string };

type Row = {
  key: string;
  name: string;
  phone: string;
  amount: string;
  status: "pending" | "posting" | "ok" | "error";
  error?: string;
  flagged?: boolean;
};

const newRow = (): Row => ({
  key: crypto.randomUUID(),
  name: "",
  phone: "",
  amount: "",
  status: "pending",
});

/**
 * Keyboard-first Sunday entry: Tab/Enter across Name → Phone → Amount;
 * Enter on Amount appends the next row and focuses its Name. Rows post as a
 * single batch, each row committed independently and idempotently.
 */
export function BatchGrid({
  entities,
  givingTypes,
  channels,
}: {
  entities: EntityLite[];
  givingTypes: TypeLite[];
  channels: string[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [typeId, setTypeId] = useState(givingTypes[0]?.id ?? "");
  const [channel, setChannel] = useState("cash");
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const currency = entities.find((e) => e.id === entityId)?.functional_currency ?? "NGN";
  const total = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [rows]
  );
  const postable = rows.filter((r) => Number(r.amount) > 0 && r.status !== "ok");

  function update(key: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, status: r.status === "ok" ? "ok" : "pending", error: undefined } : r)));
  }

  function focusCell(rowIndex: number, cell: "name" | "phone" | "amount") {
    requestAnimationFrame(() => {
      gridRef.current
        ?.querySelector<HTMLInputElement>(`[data-row="${rowIndex}"][data-cell="${cell}"]`)
        ?.focus();
    });
  }

  function onAmountKeyDown(e: React.KeyboardEvent, rowIndex: number) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (rowIndex === rows.length - 1) {
      setRows((rs) => [...rs, newRow()]);
    }
    focusCell(rowIndex + 1, "name");
  }

  async function postBatch() {
    if (postable.length === 0 || busy) return;
    setBusy(true);
    setSummary(null);
    setRows((rs) => rs.map((r) => (postable.some((p) => p.key === r.key) ? { ...r, status: "posting" } : r)));

    const { results, error } = await recordGivingBatch({
      entityId,
      transactionDate: date,
      givingTypeId: typeId,
      channel,
      currency,
      rows: postable.map((r) => ({
        clientKey: r.key,
        giverName: r.name,
        giverPhone: r.phone,
        amount: r.amount,
      })),
    });

    if (error) {
      setSummary(error);
      setRows((rs) => rs.map((r) => (r.status === "posting" ? { ...r, status: "pending" } : r)));
      setBusy(false);
      return;
    }

    const byKey = new Map<string, BatchRowResult>(results.map((x) => [x.clientKey, x]));
    setRows((rs) =>
      rs.map((r) => {
        const res = byKey.get(r.key);
        if (!res) return r;
        return res.ok
          ? { ...r, status: "ok", flagged: (res.flagged?.length ?? 0) > 0 }
          : { ...r, status: "error", error: res.error };
      })
    );
    const ok = results.filter((r) => r.ok).length;
    const failed = results.length - ok;
    setSummary(`Posted ${ok} gift(s)${failed ? `, ${failed} failed — fix the highlighted rows and post again` : ""}. Total ${currency} ${total.toLocaleString()}.`);
    setBusy(false);
  }

  const inputCls =
    "h-9 w-full rounded border border-paper-300 bg-paper px-2 font-sans text-sm focus:border-champagne focus:outline-none";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Field label="Campus" required>
          <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>{e.name} ({e.functional_currency})</option>
            ))}
          </Select>
        </Field>
        <Field label="Service date" required>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={inputCls + " h-11"} />
        </Field>
        <Field label="Giving type" required>
          <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {givingTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Channel" required>
          <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
            {channels.map((c) => (
              <option key={c} value={c}>{humanize(c)}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div ref={gridRef} className="overflow-x-auto rounded-md border border-paper-200">
        <table className="w-full">
          <thead>
            <tr className="border-b border-paper-200 bg-paper-50 text-left font-sans text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="w-10 px-3 py-2">#</th>
              <th className="px-2 py-2">Giver name <span className="normal-case">(blank = anonymous)</span></th>
              <th className="w-40 px-2 py-2">Phone</th>
              <th className="w-36 px-2 py-2 text-right">Amount ({currency})</th>
              <th className="w-28 px-2 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className={`border-b border-paper-100 ${r.status === "error" ? "bg-status-danger-bg" : r.status === "ok" ? "bg-status-success-bg/40" : ""}`}>
                <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{i + 1}</td>
                <td className="px-2 py-1.5">
                  <input data-row={i} data-cell="name" value={r.name} disabled={r.status === "ok"}
                    onChange={(e) => update(r.key, { name: e.target.value })}
                    placeholder="e.g. Ada Obi" className={inputCls} />
                </td>
                <td className="px-2 py-1.5">
                  <input data-row={i} data-cell="phone" value={r.phone} disabled={r.status === "ok"}
                    onChange={(e) => update(r.key, { phone: e.target.value })}
                    placeholder="0803…" inputMode="tel" className={inputCls} />
                </td>
                <td className="px-2 py-1.5">
                  <input data-row={i} data-cell="amount" value={r.amount} disabled={r.status === "ok"}
                    onChange={(e) => update(r.key, { amount: e.target.value })}
                    onKeyDown={(e) => onAmountKeyDown(e, i)}
                    placeholder="0.00" inputMode="decimal" className={inputCls + " text-right"} />
                </td>
                <td className="px-2 py-1.5 font-sans text-xs">
                  {r.status === "ok" && <span className="font-semibold text-status-success">Posted{r.flagged ? " · dup?" : ""}</span>}
                  {r.status === "posting" && <span className="text-muted-foreground">Posting…</span>}
                  {r.status === "error" && <span className="font-semibold text-status-danger" title={r.error}>{(r.error ?? "Failed").slice(0, 40)}</span>}
                  {r.status === "pending" && Number(r.amount) > 0 && <span className="text-muted-foreground">ready</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-sans text-sm text-muted-foreground">
          <span className="font-semibold text-ink">{postable.length}</span> ready ·
          batch total <span className="font-semibold text-ink">{currency} {total.toLocaleString()}</span>
          <span className="ml-3 text-xs">Enter on Amount = next row</span>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setRows((rs) => [...rs, newRow()])}
            className="rounded-md border border-paper-300 px-3 py-2 font-sans text-sm font-semibold text-ink hover:border-ink">
            + Row
          </button>
          <button type="button" onClick={postBatch} disabled={busy || postable.length === 0}
            className="rounded-md border border-ink bg-ink px-4 py-2 font-sans text-sm font-bold text-paper shadow-lift transition-all hover:-translate-y-0.5 disabled:opacity-50">
            {busy ? "Posting…" : `Post ${postable.length} gift(s)`}
          </button>
        </div>
      </div>

      {summary && (
        <p className="rounded border border-champagne/40 bg-champagne-light/40 px-3 py-2 font-sans text-sm text-ink">{summary}</p>
      )}
    </div>
  );
}

import Link from "next/link";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { getBankAccounts, getSignatureSlots, getUsers } from "@/lib/requisitions";
import { createSignatureSlotAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function SignatureAdminPage() {
  const ctx = await requireSuperAdmin();
  const scope = ctx.isSuperAdmin ? "all" : ctx.accessibleEntityIds;
  const [banks, users, slots] = await Promise.all([getBankAccounts(scope), getUsers(), getSignatureSlots(scope)]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <Link href="/expenses" className="font-sans text-xs text-muted-foreground hover:text-ink">Back to requisitions</Link>
        <h2 className="font-display text-3xl tracking-display text-ink">Signature slot admin</h2>
      </div>
      <Card>
        <CardHeader><CardTitle>Create or update slot</CardTitle></CardHeader>
        <CardContent>
          <form action={createSignatureSlotAction} className="grid gap-4 lg:grid-cols-5">
            <Field label="Bank account" required className="lg:col-span-2">
              <Select name="bank_account_id" required>
                <option value="">Select account</option>
                {banks.map((b: Record<string, string>) => (
                  <option key={b.id} value={b.id}>{b.entity_name} · {b.bank_name} · {b.account_number_last4 ?? "----"}</option>
                ))}
              </Select>
            </Field>
            <Field label="Slot label" required><Input name="slot_label" placeholder="A" required /></Field>
            <Field label="Slot order"><Input name="slot_order" type="number" min="1" defaultValue="1" /></Field>
            <label className="mt-6 flex h-10 items-center gap-2 rounded border border-paper-300 px-3 font-sans text-sm">
              <input name="requires_all_members" type="checkbox" className="h-4 w-4" />
              Requires all
            </label>
            <Field label="Members" className="lg:col-span-5" hint="Use Ctrl/Cmd to select multiple eligible signatories.">
              <Select name="member_id" multiple className="h-36">
                {users.map((u: Record<string, string>) => <option key={u.id} value={u.id}>{u.email ?? u.id}</option>)}
              </Select>
            </Field>
            <Button type="submit" className="lg:col-span-1">Save slot</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Configured slots</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Bank</TableHeaderCell>
                <TableHeaderCell>Slot</TableHeaderCell>
                <TableHeaderCell>Requirement</TableHeaderCell>
                <TableHeaderCell>Members</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {slots.map((s: Record<string, string | number | boolean>) => (
                <TableRow key={String(s.id)}>
                  <TableCell>
                    <div className="font-medium">{String(s.entity_name)}</div>
                    <div className="font-sans text-xs text-muted-foreground">{String(s.bank_name)} · {String(s.account_number_last4 ?? "----")}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{String(s.slot_label)}</Badge></TableCell>
                  <TableCell>{s.requires_all_members ? "All members" : "Any one member"}</TableCell>
                  <TableCell className="text-muted-foreground">{String(s.members ?? "No members")}</TableCell>
                </TableRow>
              ))}
              {slots.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground">No signature slots configured.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

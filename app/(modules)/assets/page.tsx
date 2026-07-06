import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { humanize } from "@/lib/enums";
import { compactMoney, money, shortDate } from "@/lib/format";
import { getEntities } from "@/lib/repo";
import { ASSET_CATEGORIES, getAssetTotals, getFixedAssetRegister } from "@/lib/fixedAssets";
import { CapitalizeAssetForm, DisposeAssetForm, RunDepreciationForm } from "./_components/AssetForms";

export const dynamic = "force-dynamic";

/**
 * Fixed asset register. Assets are capitalized THROUGH the ledger, deprecate
 * monthly via posted journal entries, and dispose with automatic gain/loss.
 * Accumulated depreciation and net book value are derived, never stored.
 */
export default async function AssetsPage() {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? ("all" as const) : ctx.accessibleEntityIds;
  const [register, totals, entities] = await Promise.all([
    getFixedAssetRegister(scope),
    getAssetTotals(scope),
    getEntities(scope),
  ]);
  const entityOptions = entities
    .filter((e) => e.is_active)
    .map((e) => ({ id: e.id, name: e.name, functional_currency: e.functional_currency }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Stewardship of property
        </div>
        <h2 className="font-display text-3xl tracking-display text-ink">Fixed Assets</h2>
        <p className="max-w-2xl font-sans text-sm leading-relaxed text-muted-foreground">
          Buildings, vehicles, generators and equipment — capitalized through the ledger,
          depreciated monthly by posted entries, disposed with automatic gain/loss.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Assets on register", value: totals.n.toLocaleString() },
          { label: "Total cost", value: compactMoney(Number(totals.cost)) },
          { label: "Accumulated depreciation", value: compactMoney(Number(totals.accumulated)) },
          { label: "Net book value", value: compactMoney(Number(totals.nbv)) },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="py-4">
              <div className="font-sans text-xs font-semibold uppercase tracking-wide text-muted-foreground">{k.label}</div>
              <div className="mt-1 font-display text-2xl text-ink">{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Monthly depreciation</CardTitle>
          <CardDescription>
            Straight-line, posted per entity as balanced entries (debit 6100, credit 1510).
            Idempotent — a month can never be depreciated twice. The nightly job also runs this.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RunDepreciationForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Register</CardTitle>
          <CardDescription>Accumulated depreciation and NBV derived from the ledger</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Asset</TableHeaderCell>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell className="text-right">Cost</TableHeaderCell>
                <TableHeaderCell className="text-right">Accum. dep.</TableHeaderCell>
                <TableHeaderCell className="text-right">NBV</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {register.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No fixed assets yet — capitalize the first one below.
                  </TableCell>
                </TableRow>
              )}
              {register.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="font-medium">{a.name}</div>
                    <div className="font-sans text-xs text-muted-foreground">
                      {humanize(a.category)} · acquired {shortDate(a.acquisition_date)} · {a.useful_life_months} mo life
                    </div>
                  </TableCell>
                  <TableCell>{a.entity_name}</TableCell>
                  <TableCell className="text-right">{money(a.cost, a.currency)}</TableCell>
                  <TableCell className="text-right">{money(a.accumulated_depreciation, a.currency)}</TableCell>
                  <TableCell className="text-right font-medium">{money(a.net_book_value, a.currency)}</TableCell>
                  <TableCell>
                    <Badge variant={a.status === "active" ? "outline" : a.status === "disposed" ? "solid" : "muted"}>
                      {humanize(a.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {a.status !== "disposed" && <DisposeAssetForm assetId={a.id} entityId={a.entity_id} />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Capitalize an asset</CardTitle>
          <CardDescription>
            Posts debit Fixed Assets (1500) / credit Bank — or Opening Balance Equity for
            assets owned before go-live.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CapitalizeAssetForm entities={entityOptions} categories={ASSET_CATEGORIES} />
        </CardContent>
      </Card>
    </div>
  );
}

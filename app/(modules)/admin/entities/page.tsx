import Link from "next/link";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { getEntities, getEntityOptions } from "@/lib/repo";
import { humanize } from "@/lib/enums";
import { EntityForm } from "../_components/EntityForm";

export const dynamic = "force-dynamic";

const INDENT: Record<string, string> = {
  group: "",
  sub_group: "pl-4",
  campus: "pl-8",
  ministry_expression: "pl-4",
  event: "pl-8",
};

export default async function EntitiesPage() {
  const [rows, parents] = await Promise.all([getEntities(), getEntityOptions()]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-end justify-between">
        <div className="space-y-1">
          <Link
            href="/admin"
            className="font-sans text-xs text-muted-foreground hover:text-ink"
          >
            ← Admin
          </Link>
          <h2 className="font-display text-3xl tracking-display text-ink">
            Entities
          </h2>
        </div>
        <Badge variant="outline">{rows.length} total</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organisation hierarchy</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Parent</TableHeaderCell>
                <TableHeaderCell>Country</TableHeaderCell>
                <TableHeaderCell>Currency</TableHeaderCell>
                <TableHeaderCell>Legal status</TableHeaderCell>
                <TableHeaderCell>Dates</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className={INDENT[e.type] ?? ""}>
                    <span className="font-medium">{e.name}</span>
                    {!e.is_active && (
                      <Badge variant="muted" className="ml-2">
                        inactive
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{humanize(e.type)}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.parent_name ?? "—"}
                  </TableCell>
                  <TableCell>{e.country ?? "—"}</TableCell>
                  <TableCell className="font-medium">
                    {e.functional_currency}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.legal_status ? humanize(e.legal_status) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.start_date
                      ? `${e.start_date} → ${e.end_date}`
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create entity</CardTitle>
        </CardHeader>
        <CardContent>
          <EntityForm parents={parents} />
        </CardContent>
      </Card>
    </div>
  );
}

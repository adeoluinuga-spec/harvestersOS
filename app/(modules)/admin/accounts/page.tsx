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
import { getAccounts } from "@/lib/repo";
import { humanize } from "@/lib/enums";
import { AccountForm } from "../_components/AccountForm";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const rows = await getAccounts();

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
            Chart of Accounts
          </h2>
        </div>
        <Badge variant="outline">{rows.length} accounts</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Global accounts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Code</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Fund classification</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs font-semibold">
                    {a.code}
                  </TableCell>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{humanize(a.account_type)}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {humanize(a.fund_classification)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create account</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountForm />
        </CardContent>
      </Card>
    </div>
  );
}

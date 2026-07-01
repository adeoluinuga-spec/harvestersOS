import Link from "next/link";
import {
  Badge,
  Button,
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
import { getEntityOptions, getRoleAssignments, getUsers } from "@/lib/repo";
import { humanize } from "@/lib/enums";
import { requireSuperAdmin } from "@/lib/auth";
import { AssignRoleForm } from "../_components/AssignRoleForm";
import { revokeRole } from "../actions";

export const dynamic = "force-dynamic";

export default async function AccessPage() {
  await requireSuperAdmin();

  const [users, entities, assignments] = await Promise.all([
    getUsers(),
    getEntityOptions(),
    getRoleAssignments(),
  ]);

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
            Access & Roles
          </h2>
          <p className="font-sans text-sm text-muted-foreground">
            Assign users to entities and roles. Scoped roles cascade to child
            entities; super admin and auditor are global.
          </p>
        </div>
        <Badge variant="outline">{assignments.length} assignments</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current assignments</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>User</TableHeaderCell>
                <TableHeaderCell>Role</TableHeaderCell>
                <TableHeaderCell>Scope</TableHeaderCell>
                <TableHeaderCell>Granted by</TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {assignments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No assignments yet.
                  </TableCell>
                </TableRow>
              )}
              {assignments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.email}</TableCell>
                  <TableCell>
                    <Badge variant={a.entity_id ? "outline" : "solid"}>
                      {humanize(a.role)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.entity_name ?? "Global (all entities)"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.granted_by_email ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <form action={revokeRole}>
                      <input type="hidden" name="id" value={a.id} />
                      <Button type="submit" variant="danger" size="sm">
                        Revoke
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assign a role</CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="font-sans text-sm text-muted-foreground">
              No registered users yet. Users appear here once they create an
              account on the sign-in page.
            </p>
          ) : (
            <AssignRoleForm users={users} entities={entities} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

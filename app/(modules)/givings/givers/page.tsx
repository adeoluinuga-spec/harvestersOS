import Link from "next/link";
import {
  Card,
  CardContent,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { searchGivers } from "@/lib/givings";

export const dynamic = "force-dynamic";

export default async function GiversPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  await requireUser();
  const q = (searchParams.q ?? "").trim();
  const givers = await searchGivers(q);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <Link href="/givings" className="font-sans text-xs text-muted-foreground hover:text-ink">
          ← Givings
        </Link>
        <h2 className="font-display text-3xl tracking-display text-ink">Givers</h2>
        <p className="font-sans text-sm text-muted-foreground">
          Search by name, phone or email. Each giver has a unified history across
          every entity.
        </p>
      </div>

      <form method="get" className="flex gap-2">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search givers…"
          className="max-w-sm"
        />
        <button
          type="submit"
          className="rounded border border-silver bg-paper px-4 font-sans text-sm text-ink hover:border-ink"
        >
          Search
        </button>
      </form>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Phone</TableHeaderCell>
                <TableHeaderCell>Email</TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {givers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    No givers found.
                  </TableCell>
                </TableRow>
              )}
              {givers.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">{g.full_name}</TableCell>
                  <TableCell className="text-muted-foreground">{g.phone ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{g.email ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/givings/givers/${g.id}`}
                      className="font-sans text-xs text-ink hover:underline"
                    >
                      View history →
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getMergeQueue } from "@/lib/givings";
import { dismissDuplicateAction, mergeGiversAction } from "../actions";

export const dynamic = "force-dynamic";

const FINANCE = [
  "group_finance_officer",
  "sub_group_finance_officer",
  "campus_finance_officer",
];

export default async function DuplicatesPage() {
  const ctx = await requireUser();
  const canResolve =
    ctx.isSuperAdmin || ctx.roles.some((r) => FINANCE.includes(r.role));
  const queue = await getMergeQueue();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <Link href="/givings" className="font-sans text-xs text-muted-foreground hover:text-ink">
          ← Givings
        </Link>
        <h2 className="font-display text-3xl tracking-display text-ink">
          Potential Duplicates
        </h2>
        <p className="font-sans text-sm text-muted-foreground">
          Givers flagged as close (non-exact) matches during entry. Merge to
          unify their history under one identity, or dismiss if they are
          genuinely different people.
        </p>
      </div>

      {queue.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center font-sans text-sm text-muted-foreground">
            No potential duplicates to review. 🎉
          </CardContent>
        </Card>
      )}

      {queue.map((c: Record<string, string | number>) => {
        const a = {
          id: c.a_id as string,
          name: c.a_name as string,
          phone: c.a_phone as string,
          email: c.a_email as string,
          gifts: c.a_gifts as number,
        };
        const b = {
          id: c.b_id as string,
          name: c.b_name as string,
          phone: c.b_phone as string,
          email: c.b_email as string,
          gifts: c.b_gifts as number,
        };
        return (
          <Card key={c.id as string}>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Badge variant="outline">
                  {(Number(c.score) * 100).toFixed(0)}% match · {c.reason}
                </Badge>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[a, b].map((p, i) => (
                  <div key={p.id} className="rounded-md border border-paper-200 bg-paper-50 p-3">
                    <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      {i === 0 ? "Newly recorded" : "Existing match"}
                    </div>
                    <Link
                      href={`/givings/givers/${p.id}`}
                      className="font-display text-base tracking-display text-ink hover:underline"
                    >
                      {p.name}
                    </Link>
                    <div className="mt-1 font-sans text-xs text-muted-foreground">
                      {p.phone ?? "no phone"} · {p.email ?? "no email"}
                    </div>
                    <div className="mt-1 font-sans text-xs text-ink-600">
                      {p.gifts} gift{p.gifts === 1 ? "" : "s"}
                    </div>
                  </div>
                ))}
              </div>

              {canResolve ? (
                <div className="flex flex-wrap items-center gap-2">
                  <form action={mergeGiversAction}>
                    <input type="hidden" name="keep_id" value={b.id} />
                    <input type="hidden" name="merge_id" value={a.id} />
                    <Button type="submit" size="sm">
                      Merge into “{b.name}”
                    </Button>
                  </form>
                  <form action={mergeGiversAction}>
                    <input type="hidden" name="keep_id" value={a.id} />
                    <input type="hidden" name="merge_id" value={b.id} />
                    <Button type="submit" size="sm" variant="secondary">
                      Merge into “{a.name}”
                    </Button>
                  </form>
                  <form action={dismissDuplicateAction}>
                    <input type="hidden" name="id" value={c.id as string} />
                    <Button type="submit" size="sm" variant="ghost">
                      Not a duplicate
                    </Button>
                  </form>
                </div>
              ) : (
                <p className="font-sans text-xs text-muted-foreground">
                  Only finance officers and administrators can resolve duplicates.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

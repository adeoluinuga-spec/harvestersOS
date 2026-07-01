import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Admin landing — internal tooling to inspect and build the foundational data
 * model (entities + chart of accounts). Not the main dashboard.
 */
export default function AdminPage() {
  const links = [
    {
      href: "/admin/entities",
      title: "Entities",
      desc: "View and create the org hierarchy — Group, Sub-Groups, Campuses, Ministry Expressions, and Events.",
    },
    {
      href: "/admin/accounts",
      title: "Chart of Accounts",
      desc: "View and create the global chart of accounts shared across every entity.",
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Admin
        </div>
        <h2 className="font-display text-3xl tracking-display text-ink">
          Data Model
        </h2>
        <p className="max-w-2xl font-sans text-sm leading-relaxed text-muted-foreground">
          Internal tooling to inspect and manually build the foundational
          structure. Everything financial posts to the ledger against these
          entities and accounts.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="group">
            <Card className="h-full transition-colors group-hover:border-ink">
              <CardHeader className="border-b-0">
                <CardTitle className="text-base">{l.title}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <CardDescription>{l.desc}</CardDescription>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

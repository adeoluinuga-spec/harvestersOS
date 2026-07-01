import { NextRequest } from "next/server";
import { getContext } from "@/lib/auth";
import { parseSelection } from "@/lib/bulk";
import { giverIdsMatching, giversForStatements } from "@/lib/givings";

/**
 * POST — prepare a bulk email in the STAFF MEMBER'S OWN mail app (mailto:),
 * sent from their own finance email account. No third-party mail service.
 * Recipients go in BCC. For very large selections (beyond mailto URL limits)
 * we point the user to the CSV export for a mail-merge instead.
 */
export async function POST(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const form = await req.formData();
  const { ids, allMatching, filter } = parseSelection(form);
  const target = allMatching ? await giverIdsMatching(filter.q ?? "") : ids;
  const year = new Date().getFullYear();
  const list = await giversForStatements(target, year);
  const emails = Array.from(new Set(list.map((g) => g.email).filter(Boolean)));

  const subject = `Your ${year} Giving Statement — Harvesters`;
  const body =
    `Dear Partner,\n\n` +
    `Thank you for your faithful giving in ${year}. Your giving statement is available on request for your records and tax purposes.\n\n` +
    `Warm regards,\nFinance Office\nHarvesters International Christian Centre`;

  const mailto = `mailto:?bcc=${encodeURIComponent(emails.join(","))}&subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
  const tooLong = mailto.length > 1900 || emails.length > 90;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Compose email</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;color:#0A0A0A;margin:40px;max-width:640px}
      h1{font-size:18px}.sub{color:#666;font-size:12px;text-transform:uppercase;letter-spacing:.14em}
      a.btn{display:inline-block;margin-top:16px;background:#0A0A0A;color:#fff;text-decoration:none;padding:10px 16px;border-radius:4px;font-size:14px}
      .list{margin-top:16px;font-size:12px;color:#444;max-height:220px;overflow:auto;border:1px solid #eaeaea;padding:8px;border-radius:4px}
      .warn{background:#F6F2E9;border:1px solid #e5d9b8;padding:12px;border-radius:4px;font-size:13px;margin-top:12px}
    </style></head><body>
    <div class="sub">Bulk email · your mail app</div>
    <h1>${emails.length} recipient${emails.length === 1 ? "" : "s"} with an email address</h1>
    ${
      tooLong
        ? `<div class="warn"><strong>Too many recipients for a single email-app compose.</strong>
             Use <em>Export CSV</em> from the Givers list and run a mail-merge, or select fewer givers.</div>`
        : emails.length === 0
          ? `<div class="warn">None of the selected givers have an email address on file.</div>`
          : `<p style="font-size:13px;color:#444">Click below to open your email app with everyone in BCC,
               composed from your own account. Review and send.</p>
             <a class="btn" id="open" href="${mailto}">Open in my email app</a>`
    }
    <div class="list">${emails.map((e) => e).join("<br>") || "—"}</div>
    ${
      !tooLong && emails.length > 0
        ? `<script>setTimeout(function(){window.location.href=${JSON.stringify(mailto)};},400);</script>`
        : ""
    }
    </body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

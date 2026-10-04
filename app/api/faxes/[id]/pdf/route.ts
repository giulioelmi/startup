import { db, audit } from "@/lib/db";

// The exact packet that was faxed.
export async function GET(_req: Request, ctx: RouteContext<"/api/faxes/[id]/pdf">) {
  const row = db.prepare("SELECT transfer_id, pdf FROM faxes WHERE id = ?").get(Number((await ctx.params).id)) as
    | { transfer_id: number; pdf: Buffer }
    | undefined;
  if (!row) return new Response("Not found", { status: 404 });
  audit("user", "fax.download", row.transfer_id);
  return new Response(new Uint8Array(row.pdf), { headers: { "Content-Type": "application/pdf" } });
}

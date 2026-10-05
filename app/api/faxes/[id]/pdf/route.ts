import { audit, bytes, one } from "@/lib/db";

// The exact packet that was faxed.
export async function GET(_req: Request, ctx: RouteContext<"/api/faxes/[id]/pdf">) {
  const row = await one<{ transfer_id: number; pdf: Buffer }>("SELECT transfer_id, pdf FROM faxes WHERE id = $1", [Number((await ctx.params).id)]);
  if (!row) return new Response("Not found", { status: 404 });
  await audit("user", "fax.download", row.transfer_id);
  return new Response(new Uint8Array(bytes(row.pdf)), { headers: { "Content-Type": "application/pdf" } });
}

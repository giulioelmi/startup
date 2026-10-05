import { audit } from "@/lib/db";
import { buildPacket } from "@/lib/fax";
import { getFilledPdf, listFilled } from "@/lib/filled";
import { getHospital } from "@/lib/hospitals";
import { getTransfer } from "@/lib/transfers";

// Preview of the fax packet as it would be sent now.
export async function GET(_req: Request, ctx: RouteContext<"/api/transfers/[id]/packet">) {
  const t = await getTransfer(Number((await ctx.params).id));
  const hospital = await getHospital(t?.hospitalId);
  if (!t || !hospital) return new Response("Not found", { status: 404 });
  const filled = (await listFilled(t.id)).filter((f) => f.status === "ready");
  const pdfs = await Promise.all(filled.map(async (f) => (await getFilledPdf(f.id))!.pdf));
  await audit("user", "fax.preview", t.id);
  return new Response(new Uint8Array(await buildPacket(t, hospital, pdfs)), { headers: { "Content-Type": "application/pdf" } });
}

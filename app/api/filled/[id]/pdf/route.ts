import { audit } from "@/lib/db";
import { getFilledPdf } from "@/lib/filled";

// A form filled with the patient's data.
export async function GET(_req: Request, ctx: RouteContext<"/api/filled/[id]/pdf">) {
  const id = Number((await ctx.params).id);
  const filled = await getFilledPdf(id);
  if (!filled) return new Response("Not found", { status: 404 });
  await audit("user", "form.download", filled.transferId, `filled form ${id}`);
  return new Response(new Uint8Array(filled.pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="transfer-${filled.transferId}-form-${id}.pdf"` },
  });
}

import { getForm } from "@/lib/forms";

// The original (blank) form.
export async function GET(_req: Request, ctx: RouteContext<"/api/forms/[id]/pdf">) {
  const form = getForm(Number((await ctx.params).id));
  if (!form) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(form.pdf), { headers: { "Content-Type": "application/pdf" } });
}

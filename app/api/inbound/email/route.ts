import { after } from "next/server";
import { audit } from "@/lib/db";
import { processForm } from "@/lib/agent";
import { saveForm } from "@/lib/forms";
import { matchHospitalByEmail } from "@/lib/hospitals";

// AI work (reading/filling forms, answering calls) can take a while; allow up to 5 minutes on Vercel.
export const maxDuration = 300;

// Forms emailed to us. Works with Postmark's inbound webhook (free tier):
// set the inbound URL to  {PUBLIC_URL}/api/inbound/email?token={WEBHOOK_TOKEN}
type PostmarkInbound = {
  From: string;
  Subject: string;
  Attachments?: { Name: string; Content: string; ContentType: string }[];
};

const ACCEPTED = ["application/pdf", "image/png", "image/jpeg"];

export async function POST(req: Request) {
  if (new URL(req.url).searchParams.get("token") !== process.env.WEBHOOK_TOKEN) return new Response("Forbidden", { status: 403 });

  const mail = (await req.json()) as PostmarkInbound;
  const sender = mail.From.match(/<(.+)>/)?.[1] ?? mail.From;
  const hospital = await matchHospitalByEmail(sender);

  let saved = 0;
  for (const a of mail.Attachments ?? []) {
    if (!ACCEPTED.includes(a.ContentType)) continue;
    const id = await saveForm({
      name: a.Name || mail.Subject || "Emailed form",
      bytes: Buffer.from(a.Content, "base64"),
      mime: a.ContentType,
      hospitalId: hospital?.id ?? null,
      source: "email",
      sender,
    });
    after(() => processForm(id)); // AI reads and fills it after we reply
    saved++;
  }
  await audit("inbound-email", "form.received", null, `${saved} attachment(s) from ${hospital?.id ?? "unknown sender"}`);
  return Response.json({ saved });
}

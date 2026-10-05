import { run } from "@/lib/db";
import { isFromTwilio } from "@/lib/voice";

// Twilio call status updates (ringing, in-progress, completed, no-answer, ...).
export async function POST(req: Request) {
  const url = new URL(req.url);
  const params = Object.fromEntries(((await req.formData()) as unknown as Iterable<[string, string]>));
  if (!isFromTwilio(req.headers.get("x-twilio-signature"), `${process.env.PUBLIC_URL}${url.pathname}${url.search}`, params))
    return new Response("Forbidden", { status: 403 });
  await run("UPDATE calls SET status = $1 WHERE call_sid = $2", [params.CallStatus, params.CallSid]);
  return new Response(null, { status: 204 });
}

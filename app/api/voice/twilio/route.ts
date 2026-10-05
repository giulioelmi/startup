import { audit, run } from "@/lib/db";
import { matchHospitalByPhone } from "@/lib/hospitals";
import { getTransfer, listTransfers, updateTransfer } from "@/lib/transfers";
import { addLine, answer, getTranscript, isFromTwilio, openingLine, speakAndHangUp, speakAndListen } from "@/lib/voice";

// AI work (reading/filling forms, answering calls) can take a while; allow up to 5 minutes on Vercel.
export const maxDuration = 300;

// One webhook for the whole call. `step` says where we are:
//   inbound -> someone called our Twilio number
//   ref     -> they entered/said a transfer reference number
//   start   -> our outbound call was answered
//   turn    -> they said something (or stayed silent)
export async function POST(req: Request) {
  const url = new URL(req.url);
  const params = Object.fromEntries(((await req.formData()) as unknown as Iterable<[string, string]>));
  const signedUrl = `${process.env.PUBLIC_URL}${url.pathname}${url.search}`;
  if (!isFromTwilio(req.headers.get("x-twilio-signature"), signedUrl, params)) return new Response("Forbidden", { status: 403 });

  const step = url.searchParams.get("step") ?? "inbound";
  const callSid = params.CallSid;
  const xml = (body: string) => new Response(body, { headers: { "Content-Type": "text/xml" } });
  // When we hang up, the call is over (inbound calls get no Twilio status callback unless configured).
  const hangUp = async (say: string) => {
    await run("UPDATE calls SET status = 'completed' WHERE call_sid = $1", [callSid]);
    return xml(speakAndHangUp(say));
  };
  const turnUrl = (transferId: number, idle = 0) => `/api/voice/twilio?step=turn&transfer=${transferId}&idle=${idle}`;

  const greet = async (transferId: number) => {
    const t = (await getTransfer(transferId))!;
    await run("UPDATE calls SET transfer_id = $1 WHERE call_sid = $2", [transferId, callSid]);
    await audit("ai-voice", "call.greet", transferId);
    const say = openingLine(t);
    await addLine(callSid, "ai", say);
    return xml(speakAndListen(turnUrl(transferId), say));
  };

  if (step === "inbound") {
    await run("INSERT INTO calls (call_sid, direction, number, status) VALUES ($1, 'inbound', $2, 'in-progress') ON CONFLICT (call_sid) DO NOTHING", [callSid, params.From]);
    // A hospital calling back about its only open transfer: no reference number needed.
    const hospital = await matchHospitalByPhone(params.From ?? "");
    const fromHospital = (await listTransfers()).filter((t) => t.status === "open" && hospital && t.hospitalId === hospital.id);
    if (fromHospital.length === 1) return greet(fromHospital[0].id);
    return xml(speakAndListen("/api/voice/twilio?step=ref", "Hello. Please say or enter the transfer reference number from our fax cover sheet."));
  }

  if (step === "ref") {
    const id = Number((params.Digits || params.SpeechResult || "").replace(/\D/g, ""));
    const t = id ? await getTransfer(id) : null;
    if (t && t.status === "open") return greet(t.id);
    return hangUp("Sorry, I couldn't find that transfer. Please call our physician directly. Goodbye.");
  }

  const transferId = Number(url.searchParams.get("transfer"));
  const t = await getTransfer(transferId);
  if (!t) return hangUp("Sorry, this transfer is no longer available. Goodbye.");

  if (step === "start") return greet(transferId);

  // step === "turn"
  const heard = params.SpeechResult || (params.Digits ? `(pressed ${params.Digits})` : "");
  if (!heard) {
    // Silence or hold music: keep listening, up to ~5 minutes.
    const idle = Number(url.searchParams.get("idle") ?? 0) + 1;
    if (idle > 30) return hangUp("I'll call back later. Goodbye.");
    return xml(speakAndListen(turnUrl(transferId, idle)));
  }

  const history = await getTranscript(callSid);
  await addLine(callSid, "them", heard);
  await audit("ai-voice", "call.answer", transferId);
  const reply = await answer(t, history, heard);

  if (reply.outcome !== "none") {
    await updateTransfer(transferId, { status: reply.outcome, outcomeReason: reply.outcomeReason });
    await audit("ai-voice", `transfer.${reply.outcome}`, transferId);
  }
  if (reply.say) await addLine(callSid, "ai", reply.say);
  if (reply.endCall) return hangUp(reply.say || "Thank you. Goodbye.");
  return xml(speakAndListen(turnUrl(transferId), reply.say, reply.pressDigits));
}

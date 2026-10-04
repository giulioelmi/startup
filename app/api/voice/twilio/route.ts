import { db, audit } from "@/lib/db";
import { getHospital } from "@/lib/hospitals";
import { getTransfer, listTransfers, updateTransfer } from "@/lib/transfers";
import { addLine, answer, getTranscript, isFromTwilio, openingLine, speakAndHangUp, speakAndListen } from "@/lib/voice";

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
  const turnUrl = (transferId: number, idle = 0) => `/api/voice/twilio?step=turn&transfer=${transferId}&idle=${idle}`;

  const greet = (transferId: number) => {
    const t = getTransfer(transferId)!;
    db.prepare("UPDATE calls SET transfer_id = ? WHERE call_sid = ?").run(transferId, callSid);
    audit("ai-voice", "call.greet", transferId);
    const say = openingLine(t);
    addLine(callSid, "ai", say);
    return xml(speakAndListen(turnUrl(transferId), say));
  };

  if (step === "inbound") {
    db.prepare("INSERT OR IGNORE INTO calls (call_sid, direction, number, status) VALUES (?, 'inbound', ?, 'in-progress')").run(callSid, params.From);
    // A hospital calling back about its only open transfer: no reference number needed.
    const fromHospital = listTransfers().filter(
      (t) => t.status === "open" && getHospital(t.hospitalId)?.transferPhone.slice(-10) === params.From?.slice(-10),
    );
    if (fromHospital.length === 1) return greet(fromHospital[0].id);
    return xml(speakAndListen("/api/voice/twilio?step=ref", "Hello. Please say or enter the transfer reference number from our fax cover sheet."));
  }

  if (step === "ref") {
    const id = Number((params.Digits || params.SpeechResult || "").replace(/\D/g, ""));
    const t = id ? getTransfer(id) : null;
    if (t && t.status === "open") return greet(t.id);
    return xml(speakAndHangUp("Sorry, I couldn't find that transfer. Please call our physician directly. Goodbye."));
  }

  const transferId = Number(url.searchParams.get("transfer"));
  const t = getTransfer(transferId);
  if (!t) return xml(speakAndHangUp("Sorry, this transfer is no longer available. Goodbye."));

  if (step === "start") return greet(transferId);

  // step === "turn"
  const heard = params.SpeechResult || (params.Digits ? `(pressed ${params.Digits})` : "");
  if (!heard) {
    // Silence or hold music: keep listening, up to ~5 minutes.
    const idle = Number(url.searchParams.get("idle") ?? 0) + 1;
    if (idle > 30) return xml(speakAndHangUp("I'll call back later. Goodbye."));
    return xml(speakAndListen(turnUrl(transferId, idle)));
  }

  const history = getTranscript(callSid);
  addLine(callSid, "them", heard);
  audit("ai-voice", "call.answer", transferId);
  const reply = await answer(t, history, heard);

  if (reply.outcome !== "none") {
    updateTransfer(transferId, { status: reply.outcome, outcomeReason: reply.outcomeReason });
    audit("ai-voice", `transfer.${reply.outcome}`, transferId);
  }
  if (reply.say) addLine(callSid, "ai", reply.say);
  if (reply.endCall) return xml(speakAndHangUp(reply.say || "Thank you. Goodbye."));
  return xml(speakAndListen(turnUrl(transferId), reply.say, reply.pressDigits));
}

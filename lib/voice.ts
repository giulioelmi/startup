import twilio from "twilio";
import { z } from "zod";
import { one, run } from "./db";
import { askForObject } from "./llm";
import { getHospital } from "./hospitals";
import type { Transfer } from "./transfers";

// Real phone calls through Twilio: their speech recognition turns what the
// transfer center says into text, our LLM answers from the chart, Twilio speaks it.

export type Line = { who: "ai" | "them"; text: string; at: string };

const VOICE = (process.env.TWILIO_VOICE || "Polly.Joanna-Neural") as "Polly.Joanna-Neural"; // any Twilio voice name

export async function startCall(transferId: number, to: string) {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const base = `${process.env.PUBLIC_URL}/api/voice/twilio`;
  const call = await client.calls.create({
    to,
    from: process.env.TWILIO_PHONE_NUMBER!,
    url: `${base}?step=start&transfer=${transferId}`,
    statusCallback: `${base}/status`,
    statusCallbackEvent: ["initiated", "answered", "completed"],
  });
  await run("INSERT INTO calls (transfer_id, call_sid, direction, number, status) VALUES ($1, $2, 'outbound', $3, $4)", [
    transferId,
    call.sid,
    to,
    call.status,
  ]);
}

export async function getTranscript(callSid: string): Promise<Line[]> {
  const row = await one<{ transcript: string }>("SELECT transcript FROM calls WHERE call_sid = $1", [callSid]);
  return row ? JSON.parse(row.transcript) : [];
}

export async function addLine(callSid: string, who: Line["who"], text: string) {
  const lines = [...(await getTranscript(callSid)), { who, text, at: new Date().toISOString() }];
  await run("UPDATE calls SET transcript = $1 WHERE call_sid = $2", [JSON.stringify(lines), callSid]);
}

// What the AI says first, without waiting on the model. Discloses it is an AI.
export function openingLine(t: Transfer) {
  const p = t.summary.patient;
  const d = t.details;
  return (
    `Hello, this is an automated A.I. assistant for ${d.referringPhysician || "the referring physician"} at ${d.sendingHospital}. ` +
    `We are requesting a ${d.emergent ? "emergent " : ""}transfer for a ${p.age ?? ""} year old ${p.sex ?? ""} patient. ` +
    `Reason for transfer: ${t.reason}. Requested level of care: ${d.levelOfCare}. ` +
    `I can answer questions about the patient's chart. Our physician can be reached at ${spellPhone(d.callbackPhone)}. How can I help?`
  );
}

const spellPhone = (n: string) => n.replace(/\D/g, "").split("").join(" ");

export type Reply = {
  say: string; // "" = stay silent (hold music, recorded announcements)
  pressDigits: string; // for phone menus, e.g. "2"; "" if none
  outcome: "accepted" | "declined" | "none";
  outcomeReason: string;
  endCall: boolean;
};

export async function answer(t: Transfer, history: Line[], heard: string): Promise<Reply> {
  const hospital = await getHospital(t.hospitalId);
  return askForObject(
    z.object({
      say: z.string(),
      pressDigits: z.string(),
      outcome: z.enum(["accepted", "declined", "none"]),
      outcomeReason: z.string(),
      endCall: z.boolean(),
    }),
    `You are an A.I. assistant on a live phone call with a hospital transfer center, requesting a patient transfer on behalf of a referring physician.
Rules:
- Answer ONLY from the chart and transfer details below. Never guess. If something is not there, say you don't have it and give the physician callback number.
- Speak naturally and briefly (1-3 sentences). Say numbers and units in words a listener understands ("potassium three point nine").
- If you hear a phone menu, set pressDigits to the option for transfers / transfer center / physicians; say nothing.
- If you hear hold music, a recorded announcement, or nothing meaningful, say nothing ("").
- If they accept the transfer, set outcome "accepted" (outcomeReason: bed/unit/accepting physician if given). If they decline, outcome "declined" with their reason.
- If they ask for records, say they will be faxed to the number they give (repeat it back).
- Set endCall true only after the conversation is clearly over and you've said goodbye.`,
    JSON.stringify({
      receivingHospital: hospital?.name,
      howTheyTakeTransfers: hospital?.intakeNotes,
      reasonForTransfer: t.reason,
      transfer: t.details,
      chart: t.summary,
      conversationSoFar: history.map((l) => `${l.who === "ai" ? "You" : "Them"}: ${l.text}`),
      theyJustSaid: heard,
    }),
  );
}

// TwiML: optionally speak, then listen. Twilio calls `action` with what it heard.
export function speakAndListen(action: string, say?: string, digits?: string) {
  const r = new twilio.twiml.VoiceResponse();
  if (digits) r.play({ digits });
  const g = r.gather({ input: ["speech", "dtmf"], action, speechTimeout: "auto", timeout: 8, actionOnEmptyResult: true });
  if (say) g.say({ voice: VOICE }, say);
  return r.toString();
}

export function speakAndHangUp(say: string) {
  const r = new twilio.twiml.VoiceResponse();
  r.say({ voice: VOICE }, say);
  r.hangup();
  return r.toString();
}

// Reject requests that aren't really from Twilio.
export function isFromTwilio(signature: string | null, url: string, params: Record<string, string>) {
  if (!process.env.TWILIO_AUTH_TOKEN || !signature) return false;
  return twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature, url, params);
}

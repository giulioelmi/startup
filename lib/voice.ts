import twilio from "twilio";
import { z } from "zod";
import { after } from "next/server";
import { audit, one, run } from "./db";
import { recordOutcome } from "./agent";
import { askForObject } from "./llm";
import { callContext, PLAYBOOK } from "./call-brief";
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

// What the AI says first when a hospital calls us back, without waiting on the model. Discloses it is an AI.
// Our own calls start by listening instead: the model opens once it hears who picked up (see `answer`).
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
  outcome: "accepted" | "declined" | "follow_up" | "none";
  outcomeReason: string;
  endCall: boolean;
};

export async function answer(t: Transfer, history: Line[], heard: string): Promise<Reply> {
  return askForObject(
    z.object({
      say: z.string(),
      pressDigits: z.string(),
      outcome: z.enum(["accepted", "declined", "follow_up", "none"]),
      outcomeReason: z.string(),
      endCall: z.boolean(),
    }),
    `${PLAYBOOK}

How to reply (this engine hears one utterance at a time):
- "say" is what you speak; "" stays silent (hold music, recordings, nothing meaningful, waiting for a person).
- For a phone menu, set pressDigits to the option and say nothing.
- outcome: "accepted" (outcomeReason: accepting physician, unit/bed, report number), "declined" (their reason), "follow_up" (what the team must do or answer), else "none".
- Set endCall true only after the conversation is clearly over and you've said goodbye.`,
    JSON.stringify({
      ...(await callContext(t)),
      conversationSoFar: history.map((l) => `${l.who === "ai" ? "You" : "Them"}: ${l.text}`),
      theyJustSaid: heard,
    }),
  );
}

// What the AI learned on a call. Accepted/declined settles this hospital (declined: on to the nurse's next one);
// a follow-up is something staff must do or answer.
export async function recordCallResult(transferId: number, outcome: "accepted" | "declined" | "follow_up", details: string) {
  if (outcome === "follow_up") return audit("ai-voice", "call.follow_up", transferId, details);
  await audit("ai-voice", `transfer.${outcome}`, transferId, details);
  const next = await recordOutcome(transferId, outcome, details, "ai-voice");
  if (next) after(next);
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

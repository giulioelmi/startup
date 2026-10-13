import { createHmac, timingSafeEqual } from "node:crypto";
import { one, run } from "./db";
import { callContext, PLAYBOOK } from "./call-brief";
import { openingLine, type Line } from "./voice";
import type { Transfer } from "./transfers";

// Calls through an ElevenLabs agent instead of Twilio turn-by-turn: speech streams both ways, so replies
// come in under a second and the transfer center can interrupt. Used once ELEVENLABS_API_KEY is set and the agent
// exists (created from the Voice agent page, lib/elevenlabs-setup.ts).
// Each call gets its own brief (lib/call-brief.ts); the agent reports back through tools (app/api/voice/elevenlabs).

export type AgentConfig = { agentId: string; phoneNumberId: string; webhookSecret: string };

// The agent made by the setup page (saved in the database), or one given in ELEVENLABS_* variables.
export async function agentConfig(): Promise<AgentConfig | null> {
  if (process.env.ELEVENLABS_AGENT_ID)
    return {
      agentId: process.env.ELEVENLABS_AGENT_ID,
      phoneNumberId: process.env.ELEVENLABS_PHONE_NUMBER_ID ?? "",
      webhookSecret: process.env.ELEVENLABS_WEBHOOK_SECRET ?? "",
    };
  const row = await one<{ value: string }>("SELECT value FROM settings WHERE key = 'elevenlabs'");
  return row ? JSON.parse(row.value) : null;
}

export const elevenLabsEnabled = async () => !!process.env.ELEVENLABS_API_KEY && !!(await agentConfig());

export async function api<T>(method: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`https://api.elevenlabs.io/v1${path}`, {
    method,
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// How to use the agent's tools (defined in lib/elevenlabs-setup.ts). The rest of the playbook is shared with Twilio.
const TOOL_RULES = `Tools
- record_result: call it as soon as you know. "accepted" with the accepting physician, unit or bed, and report number; "declined" with their reason; "follow_up" for anything the team must do or answer (one call per item).
- play_keypad_touch_tone for phone menus. skip_turn while on hold or a recording plays.
- voicemail_detection when you reach voicemail, after leaving your message.
- transfer_to_number connects them to the referring physician; use it only when they ask for the physician.
- end_call after you've said goodbye.`;

// The agent's instructions and variables for one transfer.
export async function agentBrief(t: Transfer) {
  return {
    prompt: `${PLAYBOOK}\n\n${TOOL_RULES}\n\nThis call (JSON):\n${JSON.stringify(await callContext(t))}`,
    dynamic_variables: callVariables(t),
  };
}

// Values the platform fills into tool calls, so the model can't change which transfer it reports on.
export const callVariables = (t: Transfer) => ({ transfer_id: String(t.id), physician_phone: toE164(t.details.callbackPhone) });

export async function startAgentCall(t: Transfer, to: string) {
  const { prompt, dynamic_variables } = await agentBrief(t);
  const agent = (await agentConfig())!;
  const res = await api<{ conversation_id?: string; callSid?: string }>("POST", "/convai/twilio/outbound-call", {
    agent_id: agent.agentId,
    agent_phone_number_id: agent.phoneNumberId,
    to_number: to,
    conversation_initiation_client_data: {
      dynamic_variables,
      // No first message: the agent waits for a person or a phone menu, then opens to fit.
      conversation_config_override: { agent: { first_message: "", prompt: { prompt } } },
    },
  });
  await run("INSERT INTO calls (transfer_id, call_sid, direction, number, status) VALUES ($1, $2, 'outbound', $3, 'initiated')", [
    t.id,
    res.conversation_id ?? res.callSid, // the post-call webhook finds the call by either
    to,
  ]);
}

// A hospital calling our number. ElevenLabs asks us how to start the conversation.
export async function inboundSetup(t: Transfer | null) {
  if (t) {
    const { prompt, dynamic_variables } = await agentBrief(t);
    return conversationStart(`${prompt}\n\nThey called us back about this transfer.`, openingLine(t), dynamic_variables);
  }
  return conversationStart(
    `${PLAYBOOK}\n\n${TOOL_RULES}\n- find_transfer: a hospital is calling us back. Get the transfer reference number from our fax cover sheet and look it up before discussing any patient. If it isn't found, ask them to repeat it once, then give up politely.`,
    "Hello, this is an automated A.I. assistant for patient transfer requests. Could you tell me the transfer reference number from our fax cover sheet?",
    { transfer_id: "0", physician_phone: "" },
  );
}

const conversationStart = (prompt: string, first_message: string, dynamic_variables: Record<string, string>) => ({
  type: "conversation_initiation_client_data",
  dynamic_variables,
  conversation_config_override: { agent: { first_message, prompt: { prompt } } },
});

// Post-call webhook signature: header "t=<unix seconds>,v0=<hex HMAC-SHA256 of `${t}.${body}`>".
export async function isFromElevenLabs(header: string | null, body: string) {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.split("=") as [string, string]));
  const secret = (await agentConfig())?.webhookSecret;
  if (!secret || !parts.t || !parts.v0 || Date.now() / 1000 - Number(parts.t) > 30 * 60) return false;
  const expected = createHmac("sha256", secret).update(`${parts.t}.${body}`).digest("hex");
  return parts.v0.length === expected.length && timingSafeEqual(Buffer.from(parts.v0), Buffer.from(expected));
}

type PostCall = {
  type: string;
  data: {
    conversation_id: string;
    transcript?: { role: "user" | "agent"; message: string | null; time_in_call_secs?: number }[];
    metadata?: { start_time_unix_secs?: number; phone_call?: { call_sid?: string } };
    conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
  };
};

// Saves the transcript when the call ends. Tool calls have no message and are left out.
export async function savePostCall(event: PostCall) {
  const d = event.data;
  const start = d.metadata?.start_time_unix_secs ?? Date.now() / 1000;
  const lines: Line[] = (d.transcript ?? [])
    .filter((m) => m.message)
    .map((m) => ({ who: m.role === "agent" ? "ai" : "them", text: m.message!, at: new Date((start + (m.time_in_call_secs ?? 0)) * 1000).toISOString() }));
  const status = event.type === "call_initiation_failure" ? "failed" : "completed";
  const transferId = Number(d.conversation_initiation_client_data?.dynamic_variables?.transfer_id) || null;
  await run("UPDATE calls SET transcript = $1, status = $2, transfer_id = COALESCE(transfer_id, $3) WHERE call_sid IN ($4, $5)", [
    JSON.stringify(lines),
    status,
    transferId,
    d.metadata?.phone_call?.call_sid ?? "",
    d.conversation_id,
  ]);
}

export const toE164 = (n: string) => {
  const digits = n.replace(/\D/g, "");
  return digits.length === 10 ? `+1${digits}` : digits ? `+${digits}` : "";
};

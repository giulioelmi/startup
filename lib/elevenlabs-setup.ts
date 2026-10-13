import { run } from "./db";
import { agentConfig, api, type AgentConfig } from "./elevenlabs";

// Creates the ElevenLabs agent for transfer calls, once (the Voice agent page runs it). Uses the Vercel variables
// ELEVENLABS_API_KEY, PUBLIC_URL, WEBHOOK_TOKEN and TWILIO_*, plus optional ELEVENLABS_LLM and ELEVENLABS_VOICE_ID.
// Importing the Twilio number makes ElevenLabs answer its inbound calls (they reach /api/voice/elevenlabs?action=inbound).

export const SETUP_VARIABLES = ["ELEVENLABS_API_KEY", "PUBLIC_URL", "WEBHOOK_TOKEN", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"];

const hook = (action: string) => `${process.env.PUBLIC_URL}/api/voice/elevenlabs?action=${action}&token=${process.env.WEBHOOK_TOKEN}`;
const fromPlatform = (dynamic_variable: string) => ({ type: "string", dynamic_variable });

// The agent's tools. Ours (webhooks) get transfer_id from the call's variables, never from the model.
function agentTools() {
  const recordResult = {
    type: "webhook",
    name: "record_result",
    description: "Record what the transfer center decided, or something the team must follow up on. Call once per item.",
    api_schema: {
      url: hook("record_result"),
      method: "POST",
      request_body_schema: {
        type: "object",
        required: ["transfer_id", "outcome", "details"],
        properties: {
          transfer_id: fromPlatform("transfer_id"),
          outcome: { type: "string", enum: ["accepted", "declined", "follow_up"], description: "accepted, declined, or follow_up" },
          details: {
            type: "string",
            description: "accepted: accepting physician, unit/bed, report number. declined: their reason. follow_up: exactly what is needed and where to send it.",
          },
        },
      },
    },
  };

  const findTransfer = {
    type: "webhook",
    name: "find_transfer",
    description: "Look up a transfer by the reference number on our fax cover sheet, when a hospital calls us back.",
    api_schema: {
      url: hook("find_transfer"),
      method: "POST",
      request_body_schema: {
        type: "object",
        required: ["reference_number", "caller_id"],
        properties: {
          reference_number: { type: "string", description: "The reference number the caller gave, digits only." },
          caller_id: fromPlatform("system__caller_id"),
        },
      },
    },
    // Later record_result calls report on the transfer that was found.
    assignments: [
      { source: "response", dynamic_variable: "transfer_id", value_path: "transfer_id" },
      { source: "response", dynamic_variable: "physician_phone", value_path: "physician_phone" },
    ],
  };

  const system = (name: string, description: string, params: object) => ({ type: "system", name, description, params });
  return [
    recordResult,
    findTransfer,
    system("end_call", "Hang up after saying goodbye.", { system_tool_type: "end_call" }),
    system("play_keypad_touch_tone", "Press keys on a phone menu.", { system_tool_type: "play_keypad_touch_tone" }),
    system("skip_turn", "Stay silent: hold music, recordings, or waiting for someone.", { system_tool_type: "skip_turn" }),
    system("voicemail_detection", "Reached voicemail; call after leaving the message.", { system_tool_type: "voicemail_detection" }),
    system("transfer_to_number", "Connect the caller to the referring physician.", {
      system_tool_type: "transfer_to_number",
      transfers: [
        {
          transfer_destination: { type: "phone_dynamic_variable", phone_number: "physician_phone" },
          transfer_type: "conference",
          condition: "They ask to speak with the referring physician (physician-to-physician).",
        },
      ],
    }),
  ];
}

export async function setUpAgent() {
  const missing = SETUP_VARIABLES.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Set ${missing.join(", ")} in Vercel first.`);
  const env = process.env;

  // 1. Our Twilio number, so the agent can call out from it and answer calls to it. Kept if a previous run imported it.
  const phoneNumberId =
    (await agentConfig())?.phoneNumberId ||
    (
      await api<{ phone_number_id: string }>("POST", "/convai/phone-numbers", {
        provider: "twilio",
        phone_number: env.TWILIO_PHONE_NUMBER,
        label: "Transfer calls",
        sid: env.TWILIO_ACCOUNT_SID,
        token: env.TWILIO_AUTH_TOKEN,
      })
    ).phone_number_id;

  // 2. Where finished calls (transcripts) are sent, signed with a secret.
  const webhook = await api<{ webhook_id: string; webhook_secret: string }>("POST", "/workspace/webhooks", {
    settings: { auth_type: "hmac", name: "Transfer call transcripts", webhook_url: `${env.PUBLIC_URL}/api/voice/elevenlabs?action=post_call` },
  });

  // 3. The agent. Its real instructions arrive with each call (lib/elevenlabs.ts), built from the hospital, patient and workflow.
  const agent = await api<{ agent_id: string }>("POST", "/convai/agents/create", {
    name: "Transfer center caller",
    conversation_config: {
      agent: {
        first_message: "",
        language: "en",
        dynamic_variables: { dynamic_variable_placeholders: { transfer_id: "0", physician_phone: "" } },
        prompt: {
          prompt: "You make and take hospital transfer calls. Your full instructions arrive with each call.",
          llm: env.ELEVENLABS_LLM || "claude-haiku-5-5",
          temperature: 0.2,
          tools: agentTools(),
        },
      },
      ...(env.ELEVENLABS_VOICE_ID && { tts: { voice_id: env.ELEVENLABS_VOICE_ID } }),
    },
    platform_settings: {
      overrides: {
        enable_conversation_initiation_client_data_from_webhook: true,
        conversation_config_override: { agent: { first_message: true, prompt: { prompt: true } } },
      },
      workspace_overrides: {
        conversation_initiation_client_data_webhook: { url: hook("inbound"), request_headers: {} },
        webhooks: { post_call_webhook_id: webhook.webhook_id, events: ["transcript", "call_initiation_failure"] },
      },
    },
  });

  // 4. Calls to our number go to the agent.
  await api("PATCH", `/convai/phone-numbers/${phoneNumberId}`, { agent_id: agent.agent_id });

  const config: AgentConfig = { agentId: agent.agent_id, phoneNumberId, webhookSecret: webhook.webhook_secret };
  await run("INSERT INTO settings (key, value) VALUES ('elevenlabs', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(config)]);
}

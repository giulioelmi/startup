import { setUpVoiceAgent } from "@/app/actions";
import { Form } from "@/components/Form";
import { SubmitButton } from "@/components/SubmitButton";
import { Pill } from "@/components/ui";
import { agentConfig } from "@/lib/elevenlabs";
import { SETUP_VARIABLES } from "@/lib/elevenlabs-setup";

// Turns on the ElevenLabs voice agent: one click creates it with the keys already in Vercel.
export default async function VoicePage() {
  const agent = await agentConfig();
  const missing = SETUP_VARIABLES.filter((k) => !process.env[k]);
  const on = !!agent && !!process.env.ELEVENLABS_API_KEY;
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="eyebrow">Settings</p>
        <h1 className="mt-1">Voice agent</h1>
        <p className="mt-1 text-sm text-slate-600">
          Calls to transfer centers go through an ElevenLabs agent: it answers in under a second, can be interrupted, and gets a brief for each call (the
          hospital&apos;s process, the patient&apos;s needs, the chart). Without it, calls use Twilio turn-by-turn.
        </p>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center gap-2">
          <h2>Calls now use</h2>
          <Pill tone={on ? "green" : "gray"}>{on ? "ElevenLabs agent" : "Twilio turn-by-turn"}</Pill>
        </div>
        {agent && <p className="text-xs text-slate-500">Agent {agent.agentId} · phone number {agent.phoneNumberId}</p>}
      </div>

      <div className="card space-y-3">
        <h2>Vercel environment variables</h2>
        <ul className="space-y-1 text-sm">
          {SETUP_VARIABLES.map((k) => (
            <li key={k}>
              {process.env[k] ? "✅" : "❌"} <code>{k}</code>
            </li>
          ))}
          <li>
            {process.env.ELEVENLABS_LLM ? "✅" : "➖"} <code>ELEVENLABS_LLM</code> {process.env.ELEVENLABS_LLM ?? "(optional, default claude-haiku-5-5)"}
          </li>
          <li>
            {process.env.ELEVENLABS_VOICE_ID ? "✅" : "➖"} <code>ELEVENLABS_VOICE_ID</code> (optional)
          </li>
        </ul>
        {missing.length > 0 && <p className="text-sm text-amber-700">Add the missing ones in Vercel (Settings → Environment Variables), then redeploy.</p>}
        {process.env.PUBLIC_URL && (
          <p className="text-xs text-slate-500">
            The agent will reach this app at <code>{process.env.PUBLIC_URL}</code>. It must be the production URL.
          </p>
        )}
      </div>

      <Form action={setUpVoiceAgent} className="card space-y-3">
        <h2>{agent ? "Recreate the agent" : "Create the agent"}</h2>
        <p className="text-sm text-slate-600">
          Creates the agent and its tools in ElevenLabs, and moves your Twilio number to it (ElevenLabs then answers calls to the number too).
          {agent && " Use this after changing the model or voice; the old agent stays in ElevenLabs, where you can delete it."}
        </p>
        <SubmitButton busy="Creating…" disabled={missing.length > 0}>
          {agent ? "Recreate the agent" : "Create the agent"}
        </SubmitButton>
      </Form>
    </div>
  );
}

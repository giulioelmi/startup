import { expect, test, vi } from "vitest";
import { agentConfig } from "@/lib/elevenlabs";
import { setUpAgent } from "@/lib/elevenlabs-setup";

test("creates the agent with the Vercel variables and saves it, so calls use it without a redeploy", async () => {
  await expect(setUpAgent()).rejects.toThrow("ELEVENLABS_API_KEY");

  Object.assign(process.env, {
    ELEVENLABS_API_KEY: "k",
    PUBLIC_URL: "https://transfer.example.com",
    WEBHOOK_TOKEN: "t",
    TWILIO_ACCOUNT_SID: "AC1",
    TWILIO_AUTH_TOKEN: "a",
    TWILIO_PHONE_NUMBER: "+15551234567",
    ELEVENLABS_LLM: "claude-sonnet-5-5",
  });
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json({ phone_number_id: "phnum_1", webhook_id: "wh_1", webhook_secret: "sec_1", agent_id: "agent_1" }),
  );
  await setUpAgent();

  const calls = fetch.mock.calls.map(([url, init]) => [String(url).replace("https://api.elevenlabs.io/v1", ""), JSON.parse(init!.body as string)]);
  expect(calls.map(([path]) => path)).toEqual(["/convai/phone-numbers", "/workspace/webhooks", "/convai/agents/create", "/convai/phone-numbers/phnum_1"]);
  const agent = calls[2][1].conversation_config.agent.prompt;
  expect(agent.llm).toBe("claude-sonnet-5-5");
  expect(calls[2][1].conversation_config.turn).toMatchObject({ initial_wait_time: 2, turn_eagerness: "eager" });
  expect(agent.tools.find((t: { name: string }) => t.name === "record_result").api_schema.url).toBe(
    "https://transfer.example.com/api/voice/elevenlabs?action=record_result&token=t",
  );
  expect(await agentConfig()).toEqual({ agentId: "agent_1", phoneNumberId: "phnum_1", webhookSecret: "sec_1" });
  fetch.mockRestore();
});

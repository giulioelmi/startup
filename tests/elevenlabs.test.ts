import { createHmac } from "node:crypto";
import { beforeAll, expect, test, vi } from "vitest";
import { all, one } from "@/lib/db";
import { startAgentCall } from "@/lib/elevenlabs";
import { summarize } from "@/lib/summary";
import { createTransfer, getTransfer, updateTransfer } from "@/lib/transfers";
import { getTranscript } from "@/lib/voice";
import { POST } from "@/app/api/voice/elevenlabs/route";
import { record } from "./fixture";

vi.mock("next/server", () => ({ after: vi.fn() }));

process.env.WEBHOOK_TOKEN = "hook-token";
process.env.ELEVENLABS_WEBHOOK_SECRET = "el-secret";
process.env.ELEVENLABS_AGENT_ID = "agent_1";
process.env.ELEVENLABS_PHONE_NUMBER_ID = "phnum_1";

const call = (action: string, body: unknown, token = "hook-token") =>
  POST(new Request(`https://transfer.example.com/api/voice/elevenlabs?action=${action}&token=${token}`, { method: "POST", body: JSON.stringify(body) }));

let id: number;
beforeAll(async () => {
  id = await createTransfer({
    patientId: "eTest123",
    patientName: "Camila Maria Lopez",
    reason: "NSTEMI, needs cardiac cath",
    details: {
      sendingHospital: "Pomona Community Hospital",
      sendingPhone: "",
      sendingFax: "",
      referringPhysician: "Dr. Ada Park",
      callbackPhone: "909-555-0102",
      caseManager: "",
      levelOfCare: "ICU",
      emergent: false,
    },
    summary: summarize(record),
  });
  await updateTransfer(id, { hospitalId: "cedars" });
});

test("outbound: the agent gets this hospital's workflow and the patient, and waits for them to speak", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ success: true, conversation_id: "conv_1", callSid: "CA9" }));
  await startAgentCall((await getTransfer(id))!, "+13104232400");
  const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
  const data = body.conversation_initiation_client_data;
  expect(body).toMatchObject({ agent_id: "agent_1", agent_phone_number_id: "phnum_1", to_number: "+13104232400" });
  expect(data.dynamic_variables).toEqual({ transfer_id: String(id), physician_phone: "+19095550102" });
  expect(data.conversation_config_override.agent.first_message).toBe("");
  const prompt = data.conversation_config_override.agent.prompt.prompt;
  expect(prompt).toContain("Tell them the request was faxed."); // Cedars' call step
  expect(prompt).toContain("NSTEMI");
  expect(await one("SELECT status FROM calls WHERE call_sid = 'conv_1'")).toEqual({ status: "initiated" });
  fetch.mockRestore();
});

test("rejects tool calls without the webhook token", async () => {
  expect((await call("record_result", { transfer_id: String(id), outcome: "accepted", details: "" }, "bad")).status).toBe(403);
});

test("inbound from an unknown number: asks for the reference number, then finds the transfer", async () => {
  const start = await (await call("inbound", { caller_id: "+15550001111", call_sid: "CA_in", agent_id: "agent_1" })).json();
  expect(start.dynamic_variables.transfer_id).toBe("0");
  expect(start.conversation_config_override.agent.first_message).toContain("reference number");

  const found = await (await call("find_transfer", { reference_number: `number ${id}`, caller_id: "+15550001111" })).json();
  expect(found).toMatchObject({ found: true, transfer_id: String(id) });
  expect(found.call.receivingHospital.name).toContain("Cedars");
  expect(await one("SELECT transfer_id FROM calls WHERE call_sid = 'CA_in'")).toEqual({ transfer_id: id });

  expect(await (await call("find_transfer", { reference_number: "999999", caller_id: "x" })).json()).toMatchObject({ found: false });
});

test("records follow-ups for staff, then the decision", async () => {
  await call("record_result", { transfer_id: String(id), outcome: "follow_up", details: "Fax the last echo to 310-423-3305" });
  expect(await all("SELECT detail FROM audit WHERE transfer_id = $1 AND action = 'call.follow_up'", [id])).toEqual([{ detail: "Fax the last echo to 310-423-3305" }]);

  await call("record_result", { transfer_id: String(id), outcome: "accepted", details: "Dr. Smith, CCU bed 4" });
  expect(await getTransfer(id)).toMatchObject({ status: "accepted", outcomeReason: "Dr. Smith, CCU bed 4" });
});

test("saves the transcript from the signed post-call webhook", async () => {
  const body = JSON.stringify({
    type: "post_call_transcription",
    data: {
      conversation_id: "conv_1",
      metadata: { start_time_unix_secs: 1_800_000_000, phone_call: { call_sid: "CA9" } },
      transcript: [
        { role: "user", message: "Cedars transfer center.", time_in_call_secs: 1 },
        { role: "agent", message: "Hi, this is an automated A.I. assistant...", time_in_call_secs: 2 },
        { role: "agent", message: null, time_in_call_secs: 3 },
      ],
    },
  });
  const post = (signature: string) =>
    POST(new Request("https://transfer.example.com/api/voice/elevenlabs?action=post_call", { method: "POST", headers: { "elevenlabs-signature": signature }, body }));

  const t = Math.floor(Date.now() / 1000);
  expect((await post(`t=${t},v0=bad`)).status).toBe(403);
  const v0 = createHmac("sha256", "el-secret").update(`${t}.${body}`).digest("hex");
  expect((await post(`t=${t},v0=${v0}`)).status).toBe(204);
  expect((await getTranscript("conv_1")).map((l) => l.who)).toEqual(["them", "ai"]);
  expect(await one("SELECT status FROM calls WHERE call_sid = 'conv_1'")).toEqual({ status: "completed" });
});

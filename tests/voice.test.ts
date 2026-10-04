import { beforeAll, expect, test, vi } from "vitest";
import twilio from "twilio";
import { db } from "@/lib/db";
import { summarize } from "@/lib/summary";
import { createTransfer, getTransfer, updateTransfer } from "@/lib/transfers";
import { getTranscript } from "@/lib/voice";
import { POST } from "@/app/api/voice/twilio/route";
import { record } from "./fixture";

const askForObject = vi.hoisted(() => vi.fn());
vi.mock("@/lib/llm", () => ({ askForObject }));

process.env.PUBLIC_URL = "https://transfer.example.com";
process.env.TWILIO_AUTH_TOKEN = "test-token";

// Builds a request exactly like Twilio would send it, signature included.
function twilioRequest(query: string, params: Record<string, string>, sign = true) {
  const url = `${process.env.PUBLIC_URL}/api/voice/twilio?${query}`;
  const signature = sign ? twilio.getExpectedTwilioSignature("test-token", url, params) : "bad";
  return new Request(url, { method: "POST", headers: { "x-twilio-signature": signature }, body: new URLSearchParams(params) });
}

let id: number;
beforeAll(() => {
  id = createTransfer({
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
  updateTransfer(id, { hospitalId: "keck" });
});

test("rejects requests without a valid Twilio signature", async () => {
  const res = await POST(twilioRequest("step=inbound", { CallSid: "CA0", From: "+15550000000" }, false));
  expect(res.status).toBe(403);
});

test("inbound call: asks for the reference number, then greets and discloses it is an AI", async () => {
  let res = await POST(twilioRequest("step=inbound", { CallSid: "CA1", From: "+15551112222" }));
  expect(await res.text()).toContain("transfer reference number");

  res = await POST(twilioRequest("step=ref", { CallSid: "CA1", Digits: String(id) }));
  const xml = await res.text();
  expect(xml).toContain("automated A.I. assistant for Dr. Ada Park");
  expect(xml).toContain(`step=turn&amp;transfer=${id}`);
});

test("answers a question from the chart and records an acceptance", async () => {
  askForObject.mockResolvedValueOnce({ say: "Her potassium is three point nine.", pressDigits: "", outcome: "none", outcomeReason: "", endCall: false });
  let res = await POST(twilioRequest(`step=turn&transfer=${id}`, { CallSid: "CA1", SpeechResult: "What's her potassium?" }));
  expect(await res.text()).toContain("Her potassium is three point nine.");
  // The model was given the chart, so the answer can only come from there.
  expect(askForObject.mock.calls[0][2]).toContain("Potassium");

  askForObject.mockResolvedValueOnce({ say: "Thank you, goodbye.", pressDigits: "", outcome: "accepted", outcomeReason: "Accepted by Dr. Smith, CCU bed 4", endCall: true });
  res = await POST(twilioRequest(`step=turn&transfer=${id}`, { CallSid: "CA1", SpeechResult: "We accept, CCU bed 4, Dr. Smith accepting." }));
  expect(await res.text()).toContain("<Hangup/>");
  expect(getTransfer(id)).toMatchObject({ status: "accepted", outcomeReason: "Accepted by Dr. Smith, CCU bed 4" });
  expect(getTranscript("CA1").map((l) => l.who)).toEqual(["ai", "them", "ai", "them", "ai"]);
  expect(db.prepare("SELECT status FROM calls WHERE call_sid = 'CA1'").get()).toEqual({ status: "completed" });
});

test("stays quiet and keeps listening through hold music", async () => {
  const res = await POST(twilioRequest(`step=turn&transfer=${id}&idle=3`, { CallSid: "CA1" }));
  const xml = await res.text();
  expect(xml).toContain("idle=4");
  expect(xml).not.toContain("<Say");
});

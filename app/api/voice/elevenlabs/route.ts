import { callContext } from "@/lib/call-brief";
import { audit, run } from "@/lib/db";
import { callVariables, inboundSetup, isFromElevenLabs, savePostCall } from "@/lib/elevenlabs";
import { matchHospitalByPhone } from "@/lib/hospitals";
import { getTransfer, listTransfers } from "@/lib/transfers";
import { recordCallResult } from "@/lib/voice";

// Everything the ElevenLabs agent sends us. `action` says what:
//   inbound        -> a hospital called our number: how should the agent start? (conversation initiation webhook)
//   find_transfer  -> tool: look up a transfer by the reference number the caller gave
//   record_result  -> tool: accepted / declined / follow-up
//   post_call      -> the call ended: transcript (signed with ELEVENLABS_WEBHOOK_SECRET)
// All but post_call carry ?token={WEBHOOK_TOKEN}. scripts/elevenlabs-setup.mjs points the agent here.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const body = await req.text();

  if (action === "post_call") {
    if (!isFromElevenLabs(req.headers.get("elevenlabs-signature"), body)) return new Response("Forbidden", { status: 403 });
    await savePostCall(JSON.parse(body));
    return new Response(null, { status: 204 });
  }

  if (url.searchParams.get("token") !== process.env.WEBHOOK_TOKEN) return new Response("Forbidden", { status: 403 });
  const p = JSON.parse(body || "{}");

  if (action === "inbound") {
    // A hospital calling back about its only open transfer: no reference number needed.
    const hospital = await matchHospitalByPhone(p.caller_id ?? "");
    const open = (await listTransfers()).filter((t) => t.status === "open" && hospital && t.hospitalId === hospital.id);
    const t = open.length === 1 ? open[0] : null;
    await run("INSERT INTO calls (transfer_id, call_sid, direction, number, status) VALUES ($1, $2, 'inbound', $3, 'in-progress') ON CONFLICT (call_sid) DO NOTHING", [
      t?.id ?? null,
      p.call_sid,
      p.caller_id,
    ]);
    if (t) await audit("ai-voice", "call.greet", t.id);
    return Response.json(await inboundSetup(t));
  }

  if (action === "find_transfer") {
    const t = await getTransfer(Number(String(p.reference_number).replace(/\D/g, "")) || 0);
    if (!t || t.status !== "open") return Response.json({ found: false, transfer_id: "0", physician_phone: "" });
    await run(
      "UPDATE calls SET transfer_id = $1 WHERE id = (SELECT id FROM calls WHERE direction = 'inbound' AND number = $2 AND transfer_id IS NULL ORDER BY id DESC LIMIT 1)",
      [t.id, p.caller_id ?? ""],
    );
    await audit("ai-voice", "call.greet", t.id);
    return Response.json({ found: true, ...callVariables(t), call: await callContext(t) });
  }

  if (action === "record_result") {
    const transferId = Number(p.transfer_id);
    const t = transferId ? await getTransfer(transferId) : null;
    if (!t || t.status !== "open") return Response.json({ ok: false, message: "No open transfer on this call." });
    if (!["accepted", "declined", "follow_up"].includes(p.outcome)) return Response.json({ ok: false, message: "Unknown outcome." });
    await recordCallResult(t.id, p.outcome, String(p.details ?? ""));
    return Response.json({ ok: true });
  }

  return new Response("Unknown action", { status: 400 });
}

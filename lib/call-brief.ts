import { all } from "./db";
import { CAPABILITIES, getHospital } from "./hospitals";
import { progress } from "./progress";
import type { Transfer } from "./transfers";

// What the AI knows going into a transfer call, and how it handles what comes up.
// Shared by both voice engines: Twilio turn-by-turn (lib/voice.ts) and the ElevenLabs agent (lib/elevenlabs.ts).

export const PLAYBOOK = `You are an automated A.I. assistant on a live phone call with a hospital transfer center, requesting a patient transfer on behalf of a referring physician. You work the way an experienced transfer coordinator does, and you follow THIS receiving hospital's own process.

Always
- Your first sentence to a person says you are an automated A.I. assistant calling for the referring physician at the sending hospital.
- Answer ONLY from the chart and transfer details. Never guess or invent clinical facts. If something is not there, say you don't have it, offer the physician's callback number, and note the question as a follow-up.
- Be brief: 1-3 sentences per turn. Let them lead with questions; don't recite the chart.
- Say numbers so a listener understands: "potassium three point nine", phone and fax numbers digit by digit, "reference number four two".
- Never agree to anything on the physician's behalf (a different level of care, sending the patient before acceptance, a different diagnosis). Say the physician will call back.

Opening
- Wait for a person or a phone menu to speak first.
- If the request is emergent, say so first.
- Then make the request the way this hospital's workflow and intake notes expect. Examples: if their workflow says we fax first and a fax went out, say it was faxed (when, to which number) and give the reference number; if it is physician-to-physician, ask to be connected with the accepting physician; if they want specific information up front (their intake notes say what), lead with that.
- Mention the patient needs this hospital was chosen for (e.g. "she needs a cath lab") in the opening.

Situations
- Phone menu: pick the option the workflow notes name, else transfers / transfer center / physician referrals, else the operator.
- Hold music or a recording: stay silent and wait.
- Voicemail: leave one short message (who you are calling for, the patient's age, sex and reason, the reference number, the callback number), then hang up.
- Wrong department: ask to be transferred to the transfer center.
- No beds, diversion or capacity problems: ask whether they can waitlist the patient and when to call back. Waitlisted or "call back later" is a follow-up. A clear no is a decline; get the reason.
- They want the referring physician (physician-to-physician) or a person: give the callback number, and connect them if you can.
- They ask for records, forms, imaging or an insurance authorization: get exactly what they need and where to send it (repeat fax numbers and emails back), and note it as a follow-up. Say the team will send it.
- Accepted: confirm the accepting physician, the unit or bed, and the number to call report to, then record the acceptance.
- Declined: thank them, ask the reason if they didn't give one, and record it. The team moves on to the next hospital by itself; don't argue.
- Before hanging up, record anything the team must act on.`;

// Everything about this call: the hospital and its process, the patient's needs, and where we are in the workflow.
export async function callContext(t: Transfer) {
  const hospital = await getHospital(t.hospitalId);
  const { steps, workflow } = await progress(t);
  const faxes = await all("SELECT to_number, status, created_at FROM faxes WHERE transfer_id = $1 AND created_at >= $2", [t.id, t.hospitalSince ?? ""]);
  const ranked = t.ranking?.hospitals.find((h) => h.hospitalId === t.hospitalId);
  return {
    referenceNumber: t.id,
    receivingHospital: hospital && {
      name: hospital.name,
      howTheyTakeTransfers: hospital.intakeNotes,
      informationTheyRequire: hospital.requiredInfo,
      services: hospital.capabilities.map((c) => CAPABILITIES[c]),
    },
    theirWorkflow: workflow.map((s, i) => ({ step: s.type, note: s.note, done: steps.find((x) => x.index === i)?.done })),
    faxesWeSentThem: faxes,
    patientNeeds: {
      reason: t.reason,
      levelOfCare: t.details.levelOfCare,
      emergent: t.details.emergent,
      services: t.ranking?.needs.map((c) => CAPABILITIES[c]) ?? [],
      explanation: t.ranking?.needsExplanation,
      whyThisHospital: ranked?.rationale,
      servicesThisHospitalLacks: ranked?.missing.map((c) => CAPABILITIES[c]),
    },
    alreadyDeclined: t.declines, // other hospitals' answers on this transfer, with their reasons
    referral: t.details, // sending hospital, referring physician, callback number, case manager
    chart: t.summary,
  };
}

import { all } from "./db";
import { getHospital, listHospitals } from "./hospitals";
import type { StepType, WorkflowStep } from "./workflow";
import { listFilled } from "./filled";
import type { Transfer } from "./transfers";

// Where a transfer stands, for the stepper and the dashboard:
// chart, hospital, then the chosen facility's workflow steps ("w0", "w1", ...), then outcome.
export type Step = { id: string; title: string; done: boolean; skipped?: boolean; type?: StepType; index?: number };

const SHORT: Record<StepType, string> = {
  call: "Call",
  wait_for_call: "Their call",
  receive_forms: "Get forms",
  fill_forms: "Forms",
  send_fax: "Fax",
};

// Transfers chosen before workflows existed have none saved: use the facility's current one.
export async function workflowOf(t: Transfer): Promise<WorkflowStep[]> {
  return t.workflow ?? (await getHospital(t.hospitalId))?.workflow ?? [];
}

export async function progress(t: Transfer) {
  const workflow = await workflowOf(t);
  const filled = await listFilled(t.id);
  // Only calls and faxes since the current hospital was chosen count (earlier ones were for hospitals that declined).
  const since = t.hospitalSince ?? "";
  const calls = await all<{ direction: string }>("SELECT direction FROM calls WHERE transfer_id = $1 AND status = 'completed' AND created_at >= $2", [t.id, since]);
  const faxes = (await all("SELECT 1 FROM faxes WHERE transfer_id = $1 AND created_at >= $2", [t.id, since])).length;

  // Each finished call or fax completes the next step of its kind, in order.
  const used = { call: 0, wait_for_call: 0, send_fax: 0 };
  const available = {
    call: calls.filter((c) => c.direction === "outbound").length,
    wait_for_call: calls.filter((c) => c.direction === "inbound").length,
    send_fax: faxes,
  };
  const evidence = (type: StepType) => {
    if (type === "fill_forms") return filled.length > 0 && filled.every((f) => f.approvedAt);
    if (type === "receive_forms") return filled.length > 0;
    if (used[type] >= available[type]) return false;
    used[type]++;
    return true;
  };

  const steps: Step[] = [
    { id: "chart", title: "Chart", done: true },
    { id: "hospital", title: "Hospital", done: !!t.hospitalId },
    ...workflow.map((s, i) => {
      const done = evidence(s.type);
      return { id: `w${i}`, title: SHORT[s.type], type: s.type, index: i, done: done || t.skipped.includes(i), skipped: !done && t.skipped.includes(i) };
    }),
    { id: "outcome", title: "Outcome", done: t.status !== "open" },
  ];
  return { steps, workflow, next: steps.find((s) => !s.done)?.id ?? "outcome" };
}

// Human-readable timeline of what the AI and the staff did on a transfer.
const LABELS: Record<string, string> = {
  "transfer.create": "Chart pulled from the EHR",
  "transfer.rank": "AI ranked the receiving hospitals",
  "transfer.rank.fallback": "AI unavailable: hospitals listed without AI ranking",
  "transfer.choose": "Hospitals chosen, in order",
  "transfer.next": "Moved on to the next hospital",
  "form.fill": "AI filled a transfer form",
  "form.fill.failed": "AI could not fill a form",
  "form.edit": "Form edited by staff",
  "form.approve": "Form reviewed and approved",
  "call.start": "Call placed to transfer center",
  "call.answered": "Transfer center picked up",
  "call.follow_up": "Follow-up from the call",
  "call.greet": "AI presented the transfer request",
  "transfer.accepted": "Transfer ACCEPTED on the call",
  "transfer.declined": "Transfer declined on the call",
  "fax.send": "Fax packet sent",
  "step.skip": "Step marked done by staff",
  "transfer.outcome": "Outcome recorded",
};

export type Activity = { at: string; ai: boolean; text: string; detail: string | null };

export async function activity(transferId: number): Promise<Activity[]> {
  const names = Object.fromEntries((await listHospitals()).map((h) => [h.id, h.name]));
  const rows = await all<{ at: string; actor: string; action: string; detail: string | null }>(
    "SELECT at, actor, action, detail FROM audit WHERE transfer_id = $1 ORDER BY id DESC",
    [transferId],
  );
  return rows
    .filter((r) => LABELS[r.action])
    .map((r) => ({
      at: r.at,
      ai: r.actor.startsWith("ai"),
      text: LABELS[r.action],
      detail: ["transfer.choose", "transfer.next"].includes(r.action)
        ? (r.detail ?? "").split(", ").map((id) => names[id] ?? id).join(" → ")
        : r.action === "form.fill"
          ? (r.detail?.split(": ")[1] ?? null)
          : ["transfer.outcome", "call.follow_up"].includes(r.action)
            ? r.detail
            : null,
    }));
}

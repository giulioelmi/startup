import { all } from "./db";
import { getHospital, listHospitals } from "./hospitals";
import type { StepType, WorkflowStep } from "./workflow";
import { listFilled } from "./filled";
import type { Transfer } from "./transfers";

// Where a transfer stands, for the stepper and the dashboard:
// chart, hospital, then the chosen facility's workflow steps ("w0", "w1", ...), then outcome.
export type Step = { id: string; title: string; done: boolean; type?: StepType; index?: number };

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
  const calls = await all<{ direction: string }>("SELECT direction FROM calls WHERE transfer_id = $1 AND status = 'completed'", [t.id]);
  const faxes = (await all("SELECT 1 FROM faxes WHERE transfer_id = $1", [t.id])).length;

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
    ...workflow.map((s, i) => ({ id: `w${i}`, title: SHORT[s.type], type: s.type, index: i, done: evidence(s.type) || t.skipped.includes(i) })),
    { id: "outcome", title: "Outcome", done: t.status !== "open" },
  ];
  return { steps, workflow, next: steps.find((s) => !s.done)?.id ?? "outcome" };
}

// Human-readable timeline of what the AI and the staff did on a transfer.
const LABELS: Record<string, string> = {
  "transfer.create": "Chart pulled from Epic",
  "transfer.rank": "AI ranked the receiving hospitals",
  "transfer.choose": "Receiving hospital chosen",
  "form.fill": "AI filled a transfer form",
  "form.fill.failed": "AI could not fill a form",
  "form.edit": "Form edited by staff",
  "form.approve": "Form reviewed and approved",
  "call.start": "Call placed to transfer center",
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
      detail: r.action === "transfer.choose" ? names[r.detail ?? ""] ?? r.detail : r.action === "form.fill" ? r.detail?.split(": ")[1] ?? null : null,
    }));
}

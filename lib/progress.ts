import { all, one } from "./db";
import { getHospital } from "./hospitals";
import { listFilled } from "./filled";
import type { Transfer } from "./transfers";

// Where a transfer stands, for the stepper and the dashboard.
export const STEP_IDS = ["chart", "hospital", "forms", "call", "fax", "outcome"] as const;
export type StepId = (typeof STEP_IDS)[number];

export async function progress(t: Transfer) {
  const filled = await listFilled(t.id);
  const callDone = !!(await one("SELECT 1 FROM calls WHERE transfer_id = $1 AND status = 'completed'", [t.id]));
  const faxed = !!(await one("SELECT 1 FROM faxes WHERE transfer_id = $1", [t.id]));
  const steps = [
    { id: "chart", title: "Chart", done: true },
    { id: "hospital", title: "Hospital", done: !!t.hospitalId },
    { id: "forms", title: "Forms", done: filled.length > 0 && filled.every((f) => f.approvedAt) },
    { id: "call", title: "Call", done: callDone || t.status !== "open" },
    { id: "fax", title: "Fax", done: faxed },
    { id: "outcome", title: "Outcome", done: t.status !== "open" },
  ];
  return { steps, next: (steps.find((s) => !s.done)?.id ?? "outcome") as StepId };
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
  "transfer.outcome": "Outcome recorded",
};

export type Activity = { at: string; ai: boolean; text: string; detail: string | null };

export async function activity(transferId: number): Promise<Activity[]> {
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
      detail: r.action === "transfer.choose" ? getHospital(r.detail)?.name ?? r.detail : r.action === "form.fill" ? r.detail?.split(": ")[1] ?? null : null,
    }));
}

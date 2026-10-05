// The actions a facility's transfer workflow is built from. No server imports: the workflow editor uses this in the browser.
export const STEP_TYPES = {
  call: "Call the transfer center",
  wait_for_call: "Wait for their call back",
  receive_forms: "Receive their forms (fax or email)",
  fill_forms: "Fill and approve forms",
  send_fax: "Fax the packet",
} as const;
export type StepType = keyof typeof STEP_TYPES;

export const STEP_ICONS: Record<StepType, string> = { call: "📞", wait_for_call: "📲", receive_forms: "📥", fill_forms: "✍️", send_fax: "📠" };

// `number` overrides the facility's transfer phone (call) or fax (send_fax) for this step.
export type WorkflowStep = { type: StepType; note: string; number?: string };

"use client";

import { useState } from "react";
import { STEP_ICONS, STEP_TYPES, type StepType, type WorkflowStep } from "@/lib/workflow";

// Build a facility's workflow from the step actions. Saved with the surrounding form as JSON in "workflow".
export function WorkflowEditor({ initial }: { initial: WorkflowStep[] }) {
  const [steps, setSteps] = useState(initial);
  const update = (i: number, patch: Partial<WorkflowStep>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) => {
    const next = [...steps];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setSteps(next);
  };

  return (
    <div className="space-y-2">
      <input type="hidden" name="workflow" value={JSON.stringify(steps)} />
      {steps.map((s, i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg border bg-white p-3">
          <span className="mt-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-teal-700 text-sm font-bold text-white">{i + 1}</span>
          <div className="grid flex-1 gap-2 sm:grid-cols-2">
            <select value={s.type} onChange={(e) => update(i, { type: e.target.value as StepType })} className="input">
              {Object.entries(STEP_TYPES).map(([type, label]) => (
                <option key={type} value={type}>{STEP_ICONS[type as StepType]} {label}</option>
              ))}
            </select>
            {(s.type === "call" || s.type === "send_fax") && (
              <input
                value={s.number ?? ""}
                onChange={(e) => update(i, { number: e.target.value || undefined })}
                placeholder={s.type === "call" ? "Number (default: transfer center)" : "Fax (default: transfer fax)"}
                className="input"
              />
            )}
            <input value={s.note} onChange={(e) => update(i, { note: e.target.value })} placeholder="Note for staff and the AI (optional)" className="input sm:col-span-2" />
          </div>
          <div className="flex flex-col text-slate-400">
            <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="hover:text-teal-700 disabled:opacity-30" aria-label="Move up">▲</button>
            <button type="button" disabled={i === steps.length - 1} onClick={() => move(i, 1)} className="hover:text-teal-700 disabled:opacity-30" aria-label="Move down">▼</button>
            <button type="button" onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="hover:text-rose-600" aria-label="Remove">✕</button>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => setSteps([...steps, { type: "call", note: "" }])} className="btn-light">+ Add step</button>
    </div>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import { Form } from "./Form";
import { SubmitButton } from "./SubmitButton";

// Tap hospitals in the order to apply to them: 1, 2, 3... Tap a numbered one again to take it out.
export function HospitalPicker({ action, items, initial }: { action: (f: FormData) => Promise<string | void>; items: { id: string; card: ReactNode }[]; initial: string[] }) {
  const [order, setOrder] = useState(initial);
  const toggle = (id: string) => setOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const changed = order.join() !== initial.join();

  return (
    <Form action={action} className="space-y-3">
      {order.map((id) => (
        <input key={id} type="hidden" name="hospital" value={id} />
      ))}
      <p className="text-sm text-slate-600">Tap hospitals in the order to apply. If #1 declines, the app moves on to #2, and so on.</p>
      {items.map(({ id, card }) => {
        const n = order.indexOf(id) + 1;
        return (
          <div
            key={id}
            onClick={(e) => !(e.target as HTMLElement).closest("a") && toggle(id)}
            className={`relative cursor-pointer rounded-lg border p-3 pr-14 select-none ${n ? "border-teal-600 bg-teal-50/50 ring-1 ring-teal-600" : "border-slate-200 hover:border-slate-300"}`}
          >
            <span className={`absolute top-3 right-3 grid h-8 w-8 place-items-center rounded-full text-sm font-bold ${n ? "bg-teal-700 text-white" : "border-2 border-slate-300"}`}>{n || ""}</span>
            {card}
          </div>
        );
      })}
      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t bg-white py-3">
        <span className="text-sm text-slate-600">{order.length ? `${order.length} hospital${order.length > 1 ? "s" : ""} in order` : "None picked yet"}</span>
        <div className="flex gap-2">
          {order.length > 0 && (
            <button type="button" className="btn-light" onClick={() => setOrder([])}>Clear</button>
          )}
          <SubmitButton disabled={!order.length || !changed} busy="Starting…">
            {initial.length ? "Save new order" : "Start applying"}
          </SubmitButton>
        </div>
      </div>
    </Form>
  );
}

"use client";

import { createContext, useState, useTransition } from "react";

// True while a <Form>'s action runs (SubmitButton reads it).
export const Pending = createContext(false);

// A form for a server action that returns an error message instead of throwing:
// the message shows under the form and what was typed stays put.
export function Form({ action, children, className }: { action: (f: FormData) => Promise<string | void>; children: React.ReactNode; className?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => setError((await action(f)) || null));
      }}
    >
      <Pending value={pending}>{children}</Pending>
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </form>
  );
}

"use client";

import { useFormStatus } from "react-dom";

// Button that shows a busy label while its form's server action runs.
export function SubmitButton({ children, busy, className = "btn", disabled, name, value }: {
  children: React.ReactNode;
  busy?: string;
  className?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending || disabled} name={name} value={value}>
      {pending ? busy ?? "Working…" : children}
    </button>
  );
}

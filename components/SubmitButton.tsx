"use client";

import { useFormStatus } from "react-dom";

// Button that shows a busy label while its form's server action runs. `confirm` asks first.
export function SubmitButton({ children, busy, className = "btn", disabled, name, value, confirm, title }: {
  children: React.ReactNode;
  busy?: string;
  className?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
  confirm?: string;
  title?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className={className}
      disabled={pending || disabled}
      name={name}
      value={value}
      title={title}
      onClick={(e) => confirm && !window.confirm(confirm) && e.preventDefault()}
    >
      {pending ? busy ?? "Working…" : children}
    </button>
  );
}

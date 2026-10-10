import Link from "next/link";

// Small shared UI pieces.

const TONES = {
  gray: "bg-slate-100 text-slate-700",
  blue: "bg-sky-100 text-sky-800",
  amber: "bg-amber-100 text-amber-800",
  green: "bg-emerald-100 text-emerald-800",
  red: "bg-rose-100 text-rose-800",
  teal: "bg-teal-100 text-teal-800",
};

export function Pill({ tone = "gray", children, pulse }: { tone?: keyof typeof TONES; children: React.ReactNode; pulse?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}>
      {pulse && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}

export const STATUS_TONE = { open: "blue", accepted: "green", declined: "red", cancelled: "gray" } as const;

export type Step = { id: string; title: string; done: boolean };

// Horizontal progress through the transfer. Each step links to its view.
export function Stepper({ steps, current, href }: { steps: Step[]; current: string; href: (id: string) => string }) {
  return (
    <ol className="flex w-full items-center">
      {steps.map((s, i) => {
        const active = s.id === current;
        return (
          <li key={s.id} className="flex flex-1 items-center last:flex-none">
            <Link href={href(s.id)} className="group flex items-center gap-2">
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ring-2 transition ${
                  s.done ? "bg-teal-700 text-white ring-teal-700" : active ? "bg-white text-teal-700 ring-teal-700" : "bg-white text-slate-400 ring-slate-300"
                }`}
              >
                {s.done ? "✓" : i + 1}
              </span>
              <span className={`text-sm font-semibold whitespace-nowrap ${active ? "text-teal-800" : s.done ? "text-slate-700" : "text-slate-400"} group-hover:text-teal-700`}>
                {s.title}
              </span>
            </Link>
            {i < steps.length - 1 && <span className={`mx-3 h-0.5 flex-1 rounded ${s.done ? "bg-teal-700" : "bg-slate-200"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

// Dots version for tables.
export function MiniProgress({ steps }: { steps: Step[] }) {
  return (
    <div className="flex items-center gap-1" title={steps.map((s) => `${s.title}: ${s.done ? "done" : "to do"}`).join("\n")}>
      {steps.map((s) => (
        <span key={s.id} className={`h-1.5 w-6 rounded-full ${s.done ? "bg-teal-600" : "bg-slate-200"}`} />
      ))}
    </div>
  );
}

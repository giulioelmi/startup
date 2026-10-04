import type { Activity } from "@/lib/progress";

export function ActivityFeed({ items, limit }: { items: Activity[]; limit?: number }) {
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <ol className="space-y-3">
      {shown.length === 0 && <li className="text-sm text-slate-400">Nothing yet.</li>}
      {shown.map((a, i) => (
        <li key={i} className="flex gap-3 text-sm">
          <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ${a.ai ? "bg-teal-100 text-teal-800" : "bg-slate-100 text-slate-600"}`}>
            {a.ai ? "AI" : "RN"}
          </span>
          <div>
            <p className="font-medium text-slate-800">{a.text}</p>
            <p className="text-xs text-slate-500">
              {a.at.slice(11, 16)} UTC{a.detail && ` · ${a.detail}`}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

import Link from "next/link";
import { MiniProgress, Pill, STATUS_TONE } from "@/components/ui";
import { db } from "@/lib/db";
import { getHospital } from "@/lib/hospitals";
import { progress } from "@/lib/progress";
import { listTransfers } from "@/lib/transfers";

export default function Dashboard() {
  const transfers = listTransfers();
  const count = (s: string) => transfers.filter((t) => t.status === s).length;
  const forms = (db.prepare("SELECT COUNT(*) n FROM forms").get() as { n: number }).n;
  const aiFilled = (db.prepare("SELECT COUNT(*) n FROM filled_forms WHERE status = 'ready'").get() as { n: number }).n;
  const stats = [
    ["In progress", count("open")],
    ["Accepted", count("accepted")],
    ["Forms filled by AI", aiFilled],
    ["Forms on file", forms],
  ] as const;

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow">Transfer center</p>
          <h1 className="mt-1">Patient transfers</h1>
          <p className="mt-1 text-sm text-slate-600">The AI pulls the chart, picks the hospital, fills the forms, calls and faxes. Staff review and approve.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map(([label, n]) => (
          <div key={label} className="card">
            <p className="text-3xl font-bold text-slate-900">{n}</p>
            <p className="text-sm text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden p-0">
        {transfers.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-slate-600">No transfers yet.</p>
            <Link href="/patients" className="btn mt-4">Start the first transfer</Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-5 py-3">Patient</th>
                <th>Reason</th>
                <th>Receiving hospital</th>
                <th>Progress</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {transfers.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link className="font-semibold text-slate-900 hover:text-teal-700" href={`/transfers/${t.id}`}>{t.patientName}</Link>
                    <p className="text-xs text-slate-500">#{t.id} · {t.createdAt.slice(0, 16)}</p>
                  </td>
                  <td className="max-w-xs truncate pr-4">{t.reason}</td>
                  <td>{getHospital(t.hospitalId)?.name.split(" (")[0] ?? <span className="text-slate-400">Not chosen</span>}</td>
                  <td><MiniProgress steps={progress(t).steps} /></td>
                  <td><Pill tone={STATUS_TONE[t.status]}>{t.status}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

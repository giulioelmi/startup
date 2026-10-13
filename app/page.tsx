import Link from "next/link";
import { moveInWorklist, removeTransfer } from "@/app/actions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SubmitButton } from "@/components/SubmitButton";
import { MiniProgress, Pill, Spinner, STATUS_TONE } from "@/components/ui";
import { one } from "@/lib/db";
import { listHospitals } from "@/lib/hospitals";
import { progress } from "@/lib/progress";
import { listTransfers } from "@/lib/transfers";

export default async function Dashboard() {
  const transfers = await listTransfers();
  const hospitals = await listHospitals();
  const progresses = new Map(await Promise.all(transfers.map(async (t) => [t.id, (await progress(t)).steps] as const)));
  const count = (s: string) => transfers.filter((t) => t.status === s).length;
  const forms = (await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM forms"))!.n;
  const aiFilled = (await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM filled_forms WHERE status = 'ready'"))!.n;
  const choosing = transfers.filter((t) => t.status === "open" && !t.hospitalId).length;
  const stats = [
    ["Choosing a hospital", choosing],
    ["Applying", count("open") - choosing],
    ["Accepted", count("accepted")],
    ["Forms filled by AI", aiFilled],
    ["Forms on file", forms],
  ] as const;

  return (
    <div className="space-y-8">
      {transfers.some((t) => t.rankingStatus === "running") && <AutoRefresh seconds={2} />}
      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow">Transfer center</p>
          <h1 className="mt-1">Patient transfers</h1>
          <p className="mt-1 text-sm text-slate-600">The AI pulls the chart, picks the hospital, fills the forms, calls and faxes. Staff review and approve.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {stats.map(([label, n]) => (
          <div key={label} className="card">
            <p className="text-3xl font-bold text-slate-900">{n}</p>
            <p className="text-sm text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-x-auto p-0">
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
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {transfers.map((t, i) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link className="font-semibold text-slate-900 hover:text-teal-700" href={`/transfers/${t.id}`}>{t.patientName}</Link>
                    <p className="text-xs text-slate-500">#{t.id} · {t.createdAt.slice(0, 16)} UTC</p>
                  </td>
                  <td className="max-w-xs min-w-40 truncate pr-4">{t.reason}</td>
                  <td>
                    {t.rankingStatus === "running" ? (
                      <span className="flex items-center gap-2 text-teal-700"><Spinner /> AI ranking hospitals…</span>
                    ) : t.rankingStatus === "failed" ? (
                      <Link href={`/transfers/${t.id}?step=hospital`}><Pill tone="red">Ranking failed</Pill></Link>
                    ) : (
                      hospitals.find((h) => h.id === t.hospitalId)?.name.split(" (")[0] ?? <span className="text-slate-400">Not chosen</span>
                    )}
                  </td>
                  <td><MiniProgress steps={progresses.get(t.id)!} /></td>
                  <td><Pill tone={STATUS_TONE[t.status]}>{t.status}</Pill></td>
                  <td className="pr-3">
                    <div className="flex justify-end gap-1 text-slate-400">
                      <form action={moveInWorklist.bind(null, t.id, -1)}>
                        <SubmitButton className="px-1 hover:text-slate-900 disabled:opacity-30" disabled={i === 0} busy="…" title="Move up">↑</SubmitButton>
                      </form>
                      <form action={moveInWorklist.bind(null, t.id, 1)}>
                        <SubmitButton className="px-1 hover:text-slate-900 disabled:opacity-30" disabled={i === transfers.length - 1} busy="…" title="Move down">↓</SubmitButton>
                      </form>
                      <form action={removeTransfer.bind(null, t.id)}>
                        <SubmitButton className="px-1 hover:text-rose-600" busy="…" title="Delete" confirm={`Delete the transfer for ${t.patientName}?`}>✕</SubmitButton>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

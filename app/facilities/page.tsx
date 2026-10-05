import Link from "next/link";
import { listForms } from "@/lib/forms";
import { listHospitals } from "@/lib/hospitals";
import { STEP_ICONS, STEP_TYPES } from "@/lib/workflow";

export default async function FacilitiesPage() {
  const hospitals = await listHospitals();
  const forms = await listForms();
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow">Facilities</p>
          <h1 className="mt-1">Receiving hospitals</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            How each hospital takes transfers. A transfer follows its hospital&apos;s workflow step by step; add a hospital, or change a workflow, here.
          </p>
        </div>
        <Link href="/facilities/new" className="btn">+ New facility</Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {hospitals.map((h) => (
          <Link key={h.id} href={`/facilities/${h.id}`} className="card space-y-3 hover:border-teal-500">
            <div>
              <h2>{h.name}</h2>
              <p className="text-xs text-slate-500">{h.address}</p>
            </div>
            <ol className="space-y-1 text-sm">
              {h.workflow.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-5 text-right text-slate-400">{i + 1}.</span>
                  <span>{STEP_ICONS[s.type]} {STEP_TYPES[s.type]}</span>
                </li>
              ))}
              {h.workflow.length === 0 && <li className="text-slate-400">No workflow yet</li>}
            </ol>
            <p className="text-xs text-slate-500">{forms.filter((f) => f.hospital_id === h.id).length} form(s) on file</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { downloadFacilityForms, removeFacility } from "@/app/actions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SubmitButton } from "@/components/SubmitButton";
import { Pill } from "@/components/ui";
import { listForms } from "@/lib/forms";
import { CAPABILITIES, getHospital } from "@/lib/hospitals";
import { STEP_ICONS, STEP_TYPES } from "@/lib/workflow";

// AI reading downloaded forms can take a while; allow up to 5 minutes on Vercel.
export const maxDuration = 300;

const FORM_STATUS = { reading: <Pill tone="blue" pulse>AI reading…</Pill>, ready: <Pill tone="green">Ready</Pill>, failed: <Pill tone="red">Failed</Pill> };

export default async function FacilityPage(props: PageProps<"/facilities/[id]">) {
  const h = await getHospital((await props.params).id);
  if (!h) notFound();
  const forms = await listForms(h.id);
  const missing = h.formUrls.filter((url) => !forms.some((f) => f.sender === url));

  return (
    <div className="space-y-6">
      {forms.some((f) => f.status === "reading") && <AutoRefresh seconds={2} />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/facilities" className="text-sm font-medium text-teal-700">← Facilities</Link>
          <h1 className="mt-2">{h.name}</h1>
          <p className="mt-1 text-sm text-slate-500">{h.address}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/facilities/${h.id}/edit`} className="btn">Edit</Link>
          <form action={removeFacility.bind(null, h.id)}>
            <SubmitButton className="btn-light">Delete</SubmitButton>
          </form>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="card space-y-4 self-start lg:col-span-7">
          <div>
            <h2>Workflow</h2>
            <p className="text-sm text-slate-600">What happens after this hospital is chosen for a transfer.</p>
          </div>
          <ol className="relative space-y-4 border-l-2 border-teal-100 pl-6">
            {h.workflow.map((s, i) => (
              <li key={i} className="relative">
                <span className="absolute top-0 -left-[37px] grid h-7 w-7 place-items-center rounded-full bg-teal-700 text-sm font-bold text-white">{i + 1}</span>
                <p className="font-semibold">{STEP_ICONS[s.type]} {STEP_TYPES[s.type]}</p>
                {s.number && <p className="text-sm text-slate-500">{s.number}</p>}
                {s.note && <p className="text-sm text-slate-600">{s.note}</p>}
              </li>
            ))}
            <li className="relative">
              <span className="absolute top-0 -left-[37px] grid h-7 w-7 place-items-center rounded-full bg-slate-200 text-sm font-bold text-slate-600">✓</span>
              <p className="font-semibold">Outcome</p>
              <p className="text-sm text-slate-600">Accepted or declined, recorded from the call or by staff.</p>
            </li>
          </ol>
          {h.workflow.length === 0 && <p className="text-sm text-amber-700">No steps yet. <Link href={`/facilities/${h.id}/edit`} className="underline">Add some</Link>.</p>}
        </section>

        <div className="space-y-6 lg:col-span-5">
          <section className="card space-y-4 text-sm">
            {!h.verified && <Pill tone="amber">Contact details not yet verified</Pill>}
            <dl className="grid grid-cols-2 gap-3">
              <div><dt className="label">Transfer center</dt><dd>{h.transferPhone}</dd></div>
              <div><dt className="label">Fax</dt><dd>{h.transferFax ?? "—"}</dd></div>
              <div className="col-span-2"><dt className="label">Email</dt><dd>{h.transferEmail ?? "—"}</dd></div>
            </dl>
            <div><p className="label">How they take transfers</p><p>{h.intakeNotes || "—"}</p></div>
            {h.requiredInfo.length > 0 && (
              <div>
                <p className="label">They ask for</p>
                <ul className="list-disc pl-5">{h.requiredInfo.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            )}
          </section>

          <section className="card space-y-3 text-sm">
            <h2>Forms on file</h2>
            <ul className="divide-y rounded-lg border">
              {forms.map((f) => (
                <li key={f.id}>
                  <Link href={`/forms/${f.id}`} className="flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-slate-50">
                    <span className="font-medium">{f.name}</span>
                    {FORM_STATUS[f.status]}
                  </Link>
                </li>
              ))}
              {forms.length === 0 && <li className="px-3 py-3 text-slate-500">None yet. <Link href="/forms" className="font-medium text-teal-700">Upload one</Link>, or they arrive by fax/email.</li>}
            </ul>
            {missing.length > 0 && (
              <form action={downloadFacilityForms.bind(null, h.id)} className="space-y-2">
                <p className="text-slate-600">{missing.length} public form(s) not downloaded yet. They are also downloaded when this hospital is chosen for a transfer.</p>
                <SubmitButton className="btn-light" busy="Downloading…">Download from hospital website</SubmitButton>
              </form>
            )}
          </section>

          <section className="card space-y-2">
            <h2>Services</h2>
            <div className="flex flex-wrap gap-1.5">{h.capabilities.map((c) => <Pill key={c}>{CAPABILITIES[c]}</Pill>)}</div>
          </section>
        </div>
      </div>
    </div>
  );
}

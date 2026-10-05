import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteForm, rereadForm, updateForm } from "@/app/actions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { FieldEditor } from "@/components/FieldEditor";
import { PdfViewer } from "@/components/PdfViewer";
import { SubmitButton } from "@/components/SubmitButton";
import { Pill } from "@/components/ui";
import { all } from "@/lib/db";
import { getForm, type FormField } from "@/lib/forms";
import { listHospitals } from "@/lib/hospitals";

// AI work (reading/filling forms, answering calls) can take a while; allow up to 5 minutes on Vercel.
export const maxDuration = 300;

export default async function FormPage(props: PageProps<"/forms/[id]">) {
  const id = Number((await props.params).id);
  const form = await getForm(id);
  if (!form) notFound();
  const fields = JSON.parse(form.fields) as FormField[];
  const hospitals = await listHospitals();
  const usedIn = await all<{ id: number; transfer_id: number; status: string; patient_name: string }>(
    "SELECT ff.id, ff.transfer_id, ff.status, t.patient_name FROM filled_forms ff JOIN transfers t ON t.id = ff.transfer_id WHERE ff.form_id = $1",
    [id],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {(form.status === "reading" || usedIn.some((u) => u.status === "filling")) && <AutoRefresh seconds={2} />}
      <div className="space-y-6 lg:col-span-4">
        <div>
          <Link href="/forms" className="text-sm font-medium text-teal-700">← Forms inbox</Link>
          <h1 className="mt-2">{form.name}</h1>
          <p className="mt-1 text-sm text-slate-500">Arrived by {form.source}{form.sender && ` from ${form.sender}`} · {form.received_at} UTC</p>
        </div>

        <div className="card space-y-3 text-sm">
          <h2>AI forms agent</h2>
          {form.status === "reading" && <Pill tone="blue" pulse>Reading the form…</Pill>}
          {form.status === "failed" && (
            <>
              <p className="text-rose-700">Could not read this form: {form.error}</p>
              <form action={rereadForm.bind(null, id)}><SubmitButton className="btn-light">Try again</SubmitButton></form>
            </>
          )}
          {form.status === "ready" && (
            <>
              <p><Pill tone="green">✓ {fields.length} fields found</Pill></p>
              <ul className="max-h-64 space-y-1 overflow-y-auto text-slate-600">
                {fields.map((f) => <li key={f.name}>· {f.label}{f.type === "checkbox" && " ☐"}</li>)}
              </ul>
            </>
          )}
          <div className="border-t pt-3">
            <p className="label">Filled for</p>
            {usedIn.length === 0 && <p className="text-slate-500">No open transfers to this hospital yet. It will be filled automatically when one starts.</p>}
            {usedIn.map((u) => (
              <Link key={u.id} href={`/transfers/${u.transfer_id}?step=forms&doc=${u.id}`} className="flex justify-between py-1 hover:text-teal-700">
                <span>#{u.transfer_id} {u.patient_name}</span>
                <Pill tone={u.status === "ready" ? "green" : u.status === "failed" ? "red" : "blue"} pulse={u.status === "filling"}>{u.status}</Pill>
              </Link>
            ))}
          </div>
        </div>

        <form key={`${form.name}|${form.hospital_id}`} action={updateForm.bind(null, id)} className="card space-y-3">
          <div><label className="label">Name</label><input name="name" defaultValue={form.name} className="input" /></div>
          <div>
            <label className="label">Hospital</label>
            <select name="hospitalId" defaultValue={form.hospital_id ?? ""} className="input">
              <option value="">Unassigned</option>
              {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <SubmitButton className="btn-light">Save</SubmitButton>
        </form>

        <form action={deleteForm.bind(null, id)}>
          <SubmitButton className="text-sm text-rose-700 hover:underline">Delete form</SubmitButton>
        </form>
      </div>

      <div className="lg:col-span-8">
        <section className="card bg-slate-100/60">
          {form.status === "ready" ? <FieldEditor formId={id} initial={fields} /> : <PdfViewer url={`/api/forms/${id}/pdf`} />}
        </section>
      </div>
    </div>
  );
}

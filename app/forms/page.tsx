import Link from "next/link";
import { uploadForm } from "@/app/actions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SubmitButton } from "@/components/SubmitButton";
import { Pill } from "@/components/ui";
import { listForms, type FormField } from "@/lib/forms";
import { HOSPITALS, getHospital } from "@/lib/hospitals";

// AI work (reading/filling forms, answering calls) can take a while; allow up to 5 minutes on Vercel.
export const maxDuration = 300;

const SOURCE = { upload: "⬆ Upload", email: "✉ Email", fax: "📠 Fax" } as Record<string, string>;

export default async function FormsPage() {
  const forms = await listForms();
  return (
    <div className="space-y-6">
      {forms.some((f) => f.status === "reading") && <AutoRefresh seconds={2} />}
      <div>
        <p className="eyebrow">Forms inbox</p>
        <h1 className="mt-1">Hospital transfer forms</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Forms arrive here by upload, email or fax. The AI reads each one, finds every blank, works out which hospital it belongs to, and fills it
          for every open transfer to that hospital. Nobody types into a form.
        </p>
      </div>

      <form action={uploadForm} className="card grid grid-cols-4 items-end gap-3">
        <div className="col-span-2">
          <label className="label">PDF, scan or photo of a form</label>
          <input type="file" name="file" accept="application/pdf,image/png,image/jpeg" required className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:font-medium" />
        </div>
        <div>
          <label className="label">Hospital</label>
          <select name="hospitalId" className="input">
            <option value="">Let the AI work it out</option>
            {HOSPITALS.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
        <SubmitButton busy="Uploading…">Upload form</SubmitButton>
      </form>

      <div className="card overflow-hidden p-0">
        {forms.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No forms yet.</p>}
        {forms.length > 0 && (
          <table className="w-full text-sm">
            <thead className="border-b bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase">
              <tr><th className="px-5 py-3">Form</th><th>Hospital</th><th>Arrived by</th><th>AI</th><th>Received</th></tr>
            </thead>
            <tbody className="divide-y">
              {forms.map((f) => {
                const fields = JSON.parse(f.fields) as FormField[];
                return (
                  <tr key={f.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3"><Link className="font-semibold text-slate-900 hover:text-teal-700" href={`/forms/${f.id}`}>{f.name}</Link></td>
                    <td>{getHospital(f.hospital_id)?.name.split(" (")[0] ?? <span className="text-amber-700">Unassigned</span>}</td>
                    <td>{SOURCE[f.source] ?? f.source}{f.sender && <span className="block text-xs text-slate-500">{f.sender}</span>}</td>
                    <td>
                      {f.status === "reading" && <Pill tone="blue" pulse>Reading…</Pill>}
                      {f.status === "ready" && <Pill tone="green">{fields.length} fields found</Pill>}
                      {f.status === "failed" && <Pill tone="red">Failed</Pill>}
                    </td>
                    <td className="text-slate-500">{f.received_at} UTC</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

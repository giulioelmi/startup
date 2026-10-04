import Link from "next/link";
import { uploadForm } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { listForms, type FormField } from "@/lib/forms";
import { HOSPITALS, getHospital } from "@/lib/hospitals";

export default function FormsPage() {
  const forms = listForms();
  return (
    <div className="space-y-6">
      <h1>Transfer forms</h1>
      <p className="text-sm text-gray-600">
        Forms come from three places: uploaded here, emailed to our inbound address, or faxed to our fax number. Emailed/faxed forms are matched to a
        hospital by sender when possible.
      </p>

      <form action={uploadForm} className="card grid grid-cols-4 items-end gap-3">
        <div><label className="label">PDF or photo of the form</label><input type="file" name="file" accept="application/pdf,image/png,image/jpeg" required className="text-sm" /></div>
        <div><label className="label">Name</label><input name="name" placeholder="e.g. Non-EMTALA transfer request" className="input" /></div>
        <div>
          <label className="label">Hospital</label>
          <select name="hospitalId" className="input">
            <option value="">Unassigned</option>
            {HOSPITALS.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
        <SubmitButton busy="Uploading…">Upload</SubmitButton>
      </form>

      <div className="card">
        {forms.length === 0 && <p className="text-sm text-gray-500">No forms yet.</p>}
        <table className="w-full text-sm">
          <tbody className="divide-y">
            {forms.map((f) => {
              const fields = JSON.parse(f.fields) as FormField[];
              return (
                <tr key={f.id}>
                  <td className="py-2"><Link className="text-blue-700 hover:underline" href={`/forms/${f.id}`}>{f.name}</Link></td>
                  <td>{getHospital(f.hospital_id)?.name ?? <span className="text-amber-700">Unassigned</span>}</td>
                  <td>{f.source}{f.sender && ` from ${f.sender}`}</td>
                  <td>{fields.length ? `${fields.length} fields` : <span className="text-amber-700">fields not marked</span>}</td>
                  <td className="text-gray-500">{f.received_at}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

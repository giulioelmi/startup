import { notFound } from "next/navigation";
import { deleteForm, updateForm } from "@/app/actions";
import { FieldEditor } from "@/components/FieldEditor";
import { SubmitButton } from "@/components/SubmitButton";
import { getForm, type FormField } from "@/lib/forms";
import { HOSPITALS } from "@/lib/hospitals";

export default async function FormPage(props: PageProps<"/forms/[id]">) {
  const id = Number((await props.params).id);
  const form = getForm(id);
  if (!form) notFound();
  const fields = JSON.parse(form.fields) as FormField[];
  const fillable = fields.filter((f) => !f.box);

  return (
    <div className="space-y-6">
      <h1>{form.name}</h1>
      <form action={updateForm.bind(null, id)} className="card grid grid-cols-4 items-end gap-3">
        <div className="col-span-2"><label className="label">Name</label><input name="name" defaultValue={form.name} className="input" /></div>
        <div>
          <label className="label">Hospital</label>
          <select name="hospitalId" defaultValue={form.hospital_id ?? ""} className="input">
            <option value="">Unassigned</option>
            {HOSPITALS.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
        <SubmitButton>Save</SubmitButton>
      </form>

      <div className="card text-sm">
        <p>
          Source: {form.source}{form.sender && ` from ${form.sender}`} · received {form.received_at} ·{" "}
          <a className="text-blue-700" href={`/api/forms/${id}/pdf`} target="_blank">Open original PDF</a>
        </p>
        {fillable.length > 0 && (
          <p className="mt-2">This PDF has {fillable.length} fillable fields; the AI fills them directly. You can also add boxes below for anything the PDF lacks.</p>
        )}
      </div>

      <FieldEditor formId={id} initial={fields} />

      <form action={deleteForm.bind(null, id)}>
        <SubmitButton className="btn-light text-red-700">Delete form</SubmitButton>
      </form>
    </div>
  );
}

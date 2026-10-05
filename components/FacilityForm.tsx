import { saveFacility } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { WorkflowEditor } from "@/components/WorkflowEditor";
import { CAPABILITIES, type Hospital } from "@/lib/hospitals";

// Create (h = undefined) or edit a facility: contact details, services, workflow, public forms.
export function FacilityForm({ h }: { h?: Hospital }) {
  const text = (name: keyof Hospital, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className="label">{label}</label>
      <input name={name} defaultValue={h?.[name] == null ? "" : String(h[name])} className="input" {...props} />
    </div>
  );
  const list = (name: "requiredInfo" | "formUrls" | "emailDomains", label: string, placeholder: string) => (
    <div>
      <label className="label">{label}</label>
      <textarea name={name} defaultValue={h?.[name].join("\n")} rows={3} placeholder={placeholder} className="input" />
    </div>
  );

  return (
    <form action={saveFacility.bind(null, h?.id ?? null)} className="space-y-6">
      <section className="card space-y-4">
        <h2>Transfer center</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {text("name", "Name", { required: true })}
          {text("address", "Address")}
          {text("transferPhone", "Transfer center phone", { required: true, placeholder: "+13105551234" })}
          {text("transferFax", "Transfer center fax", { placeholder: "+13105551235" })}
          {text("transferEmail", "Transfer center email")}
          <div className="grid grid-cols-2 gap-3">
            {text("lat", "Latitude", { inputMode: "decimal" })}
            {text("lng", "Longitude", { inputMode: "decimal" })}
          </div>
        </div>
        <div>
          <label className="label">How they take transfers</label>
          <textarea name="intakeNotes" defaultValue={h?.intakeNotes} rows={3} className="input" placeholder="What the transfer center expects, in plain words. The AI reads this on calls and when ranking." />
        </div>
        {list("requiredInfo", "They ask for (one per line)", "Face sheet\nInsurance card")}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="verified" defaultChecked={h?.verified} /> Contact details confirmed with the transfer center</label>
      </section>

      <section className="card space-y-3">
        <div>
          <h2>Workflow</h2>
          <p className="text-sm text-slate-600">The steps a transfer to this facility goes through, in order. Each transfer copies the workflow when the facility is chosen.</p>
        </div>
        <WorkflowEditor initial={h?.workflow ?? [{ type: "call", note: "" }, { type: "fill_forms", note: "" }, { type: "send_fax", note: "" }]} />
      </section>

      <section className="card space-y-4">
        <h2>Forms and matching</h2>
        {list("formUrls", "Public form links (one per line)", "https://hospital.org/transfer-request.pdf")}
        {list("emailDomains", "Email domains its forms come from", "hospital.org")}
        <p className="text-xs text-slate-500">Forms emailed from these domains, or faxed from its numbers, are assigned to this facility automatically.</p>
      </section>

      <section className="card space-y-2">
        <h2>Services</h2>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {Object.entries(CAPABILITIES).map(([id, label]) => (
            <label key={id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="capabilities" value={id} defaultChecked={h?.capabilities.includes(id as keyof typeof CAPABILITIES)} /> {label}
            </label>
          ))}
        </div>
      </section>

      <SubmitButton busy="Saving…">Save facility</SubmitButton>
    </form>
  );
}

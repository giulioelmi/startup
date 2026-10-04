import { startTransfer } from "@/app/actions";
import { Summary } from "@/components/Summary";
import { audit } from "@/lib/db";
import { getPatientRecord } from "@/lib/epic";
import { summarize } from "@/lib/summary";
import { defaultDetails } from "@/lib/transfers";

export default async function PatientPage(props: PageProps<"/patients/[id]">) {
  const { id } = await props.params;
  let summary;
  try {
    summary = summarize(await getPatientRecord(id));
    audit("user", "chart.view", null, "Epic patient chart");
  } catch (e) {
    return <p className="card text-red-700">Could not load patient from Epic: {(e as Error).message}</p>;
  }
  const d = defaultDetails();
  const field = (name: keyof typeof d, label: string, required = false) => (
    <div>
      <label className="label">{label}</label>
      <input name={name} defaultValue={String(d[name])} required={required} className="input" />
    </div>
  );

  return (
    <div className="space-y-6">
      <Summary s={summary} />
      <form action={startTransfer} className="card space-y-3">
        <h2>Start a transfer</h2>
        <input type="hidden" name="patientId" value={id} />
        <div>
          <label className="label">Reason for transfer</label>
          <textarea name="reason" required rows={3} className="input" placeholder="e.g. Acute NSTEMI, needs cardiac cath not available here" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {field("referringPhysician", "Referring physician", true)}
          {field("callbackPhone", "Physician callback phone", true)}
          {field("caseManager", "Case manager (name, phone)")}
          {field("sendingHospital", "Sending hospital", true)}
          {field("sendingPhone", "Sending hospital phone")}
          {field("sendingFax", "Return fax")}
          {field("levelOfCare", "Requested level of care", true)}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="emergent" /> Emergent (EMTALA)</label>
        </div>
        <button className="btn">Start transfer</button>
      </form>
    </div>
  );
}

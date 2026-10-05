import { startTransfer } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Summary } from "@/components/Summary";
import { audit } from "@/lib/db";
import { getPatientRecord } from "@/lib/epic";
import { summarize } from "@/lib/summary";
import { defaultDetails } from "@/lib/transfers";

// AI work (reading/filling forms, answering calls) can take a while; allow up to 5 minutes on Vercel.
export const maxDuration = 300;

export default async function PatientPage(props: PageProps<"/patients/[id]">) {
  const { id } = await props.params;
  let summary;
  try {
    summary = summarize(await getPatientRecord(id));
    await audit("user", "chart.view", null, "Epic patient chart");
  } catch (e) {
    return (
      <div className="card space-y-2 text-rose-700">
        <p>Could not load patient from Epic: {(e as Error).message}</p>
        <a href="/epic-check" className="btn-light">Run Epic connection check</a>
      </div>
    );
  }
  const d = defaultDetails();
  const field = (name: keyof typeof d, label: string, required = false) => (
    <div>
      <label className="label">{label}</label>
      <input name={name} defaultValue={String(d[name])} required={required} className="input" />
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <form action={startTransfer} className="card space-y-4 self-start lg:col-span-5">
        <div>
          <p className="eyebrow">New transfer</p>
          <h1 className="mt-1">{summary.patient.name}</h1>
        </div>
        <input type="hidden" name="patientId" value={id} />
        <div>
          <label className="label">Reason for transfer</label>
          <textarea name="reason" required rows={3} className="input" placeholder="e.g. NSTEMI with rising troponin, needs cardiac cath not available here" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {field("referringPhysician", "Referring physician", true)}
          {field("callbackPhone", "Physician callback", true)}
          {field("levelOfCare", "Level of care", true)}
          {field("caseManager", "Case manager")}
          {field("sendingHospital", "Sending hospital", true)}
          {field("sendingFax", "Return fax")}
        </div>
        <input type="hidden" name="sendingPhone" value={d.sendingPhone} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="emergent" /> Emergent (EMTALA)</label>
        <SubmitButton busy="AI is reviewing the chart and ranking hospitals…">Start transfer →</SubmitButton>
      </form>
      <div className="lg:col-span-7">
        <Summary s={summary} />
      </div>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { callTransferCenter, chooseHospital, faxPacket, fillForm, runRanking, saveFilled, setOutcome } from "@/app/actions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SubmitButton } from "@/components/SubmitButton";
import { Summary } from "@/components/Summary";
import { db } from "@/lib/db";
import { listFilled } from "@/lib/filled";
import { listForms } from "@/lib/forms";
import { CAPABILITIES, getHospital } from "@/lib/hospitals";
import { getTransfer } from "@/lib/transfers";
import type { Line } from "@/lib/voice";

type CallRow = { id: number; direction: string; number: string; status: string; transcript: string; created_at: string };
type FaxRow = { id: number; to_number: string; provider: string; status: string; created_at: string };
const LIVE = ["queued", "initiated", "ringing", "in-progress"];

export default async function TransferPage(props: PageProps<"/transfers/[id]">) {
  const id = Number((await props.params).id);
  const t = getTransfer(id);
  if (!t) notFound();

  const hospital = getHospital(t.hospitalId);
  const forms = hospital ? listForms(hospital.id) : [];
  const filled = listFilled(id);
  const calls = db.prepare("SELECT * FROM calls WHERE transfer_id = ? ORDER BY id DESC").all(id) as CallRow[];
  const faxes = db.prepare("SELECT id, to_number, provider, status, created_at FROM faxes WHERE transfer_id = ? ORDER BY id DESC").all(id) as FaxRow[];
  const allApproved = filled.length > 0 && filled.every((f) => f.approvedAt);

  return (
    <div className="space-y-6">
      {calls.some((c) => LIVE.includes(c.status)) && <AutoRefresh />}
      <div>
        <Link href="/transfers" className="text-sm text-blue-700">← Transfers</Link>
        <h1 className="mt-1">Transfer #{t.id}: {t.patientName}</h1>
        <p className="text-sm text-gray-600">
          {t.reason} · Level of care: {t.details.levelOfCare}{t.details.emergent && " · EMERGENT"} · Status: <b>{t.status}</b>
          {t.outcomeReason && ` (${t.outcomeReason})`}
        </p>
      </div>

      {/* 1. Ranking */}
      <section className="card">
        <h2>1. Receiving hospital</h2>
        {!t.ranking ? (
          <form action={runRanking.bind(null, id)}>
            <SubmitButton busy="Ranking…">Rank hospitals with AI</SubmitButton>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              <b>Patient needs:</b> {t.ranking.needs.map((n) => CAPABILITIES[n]).join(", ") || "no specialized capability"} — {t.ranking.needsExplanation}
            </p>
            {t.ranking.hospitals.map((r, i) => {
              const h = getHospital(r.hospitalId)!;
              const chosen = t.hospitalId === h.id;
              return (
                <div key={h.id} className={`rounded-md border p-3 ${chosen ? "border-blue-600 bg-blue-50" : ""}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <b>{i + 1}. {h.name}</b>
                      <span className="ml-2 text-sm text-gray-600">
                        {r.distanceMiles != null && `${r.distanceMiles} mi · `}
                        {r.eligible ? "offers all needed services" : `missing: ${r.missing.map((m) => CAPABILITIES[m]).join(", ")}`}
                      </span>
                    </div>
                    {!chosen && (
                      <form action={chooseHospital.bind(null, id, h.id)}>
                        <SubmitButton className="btn-light">Choose</SubmitButton>
                      </form>
                    )}
                  </div>
                  <p className="mt-1 text-sm">{r.rationale}</p>
                </div>
              );
            })}
          </div>
        )}
        {hospital && (
          <div className="mt-4 rounded-md bg-gray-50 p-3 text-sm">
            <b>{hospital.name} transfer center</b>
            {!hospital.verified && <span className="ml-2 text-amber-700">(contact details not yet verified)</span>}
            <p>Phone {hospital.transferPhone} · Fax {hospital.transferFax ?? "unknown"} {hospital.transferEmail && `· ${hospital.transferEmail}`}</p>
            <p className="mt-1">{hospital.intakeNotes}</p>
            <p className="mt-1">They ask for: {hospital.requiredInfo.join("; ")}</p>
          </div>
        )}
      </section>

      {hospital && (
        <>
          {/* 2. Forms */}
          <section className="card space-y-4">
            <h2>2. Transfer forms</h2>
            {forms.length === 0 && (
              <p className="text-sm">
                No forms on file for {hospital.name}. <Link href="/forms" className="text-blue-700">Upload one</Link>, or they arrive automatically when the hospital emails or faxes them.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {forms.map((f) => (
                <form key={f.id} action={fillForm.bind(null, id, f.id)}>
                  <SubmitButton className="btn-light" busy={`Filling ${f.name}…`}>Fill “{f.name}” with AI</SubmitButton>
                </form>
              ))}
            </div>

            {filled.map((f) => (
              <form key={f.id} action={saveFilled.bind(null, f.id)} className="rounded-md border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <b>{f.formName}</b>
                  <a className="text-sm text-blue-700" href={`/api/filled/${f.id}/pdf`} target="_blank">Preview PDF</a>
                </div>
                {f.fields.length === 0 && (
                  <p className="text-sm text-amber-700">
                    This form has no fields yet. <Link className="text-blue-700" href={`/forms/${f.formId}`}>Mark the fields</Link> once, then fill again.
                  </p>
                )}
                <table className="w-full text-sm">
                  <tbody>
                    {f.fields.map((field) => {
                      const v = f.values.find((x) => x.name === field.name);
                      const missing = v?.source === "not in record";
                      return (
                        <tr key={field.name} className="align-top">
                          <td className="w-1/3 py-1 pr-2">{field.label}</td>
                          <td className="py-1">
                            {field.type === "checkbox" ? (
                              <input type="checkbox" name={`v:${field.name}`} defaultChecked={v?.value === "true"} />
                            ) : (
                              <input name={`v:${field.name}`} defaultValue={v?.value} className={`input ${missing ? "border-amber-400 bg-amber-50" : ""}`} />
                            )}
                          </td>
                          <td className={`w-1/4 py-1 pl-2 text-xs ${missing ? "text-amber-700" : "text-gray-500"}`}>{v?.source}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="mt-3 flex items-end gap-2">
                  <SubmitButton className="btn-light">Save</SubmitButton>
                  {f.approvedAt ? (
                    <span className="text-sm text-green-700">✓ Approved by {f.approvedBy} at {f.approvedAt}</span>
                  ) : (
                    <>
                      <input name="approver" placeholder="Your name to approve" className="input max-w-xs" />
                      <SubmitButton>Save & approve</SubmitButton>
                    </>
                  )}
                </div>
              </form>
            ))}
          </section>

          {/* 3. Call */}
          <section className="card space-y-3">
            <h2>3. Call the transfer center</h2>
            <p className="text-sm text-gray-600">
              The AI calls, explains the request, answers questions from the chart, and records accept/decline. The transfer center can call back
              {process.env.TWILIO_PHONE_NUMBER ? ` at ${process.env.TWILIO_PHONE_NUMBER}` : ""} using reference #{t.id}.
            </p>
            <form action={callTransferCenter.bind(null, id)} className="flex items-end gap-2">
              <div>
                <label className="label">Number to call</label>
                <input name="to" defaultValue={process.env.CALL_TEST_NUMBER || hospital.transferPhone} className="input" />
              </div>
              <SubmitButton busy="Dialing…">Call now</SubmitButton>
            </form>
            {calls.map((c) => (
              <div key={c.id} className="rounded-md border p-3 text-sm">
                <p className="mb-2 text-gray-600">{c.direction} · {c.number} · {c.status} · {c.created_at}</p>
                {(JSON.parse(c.transcript) as Line[]).map((l, i) => (
                  <p key={i} className={l.who === "ai" ? "text-blue-800" : ""}><b>{l.who === "ai" ? "AI" : "Hospital"}:</b> {l.text}</p>
                ))}
              </div>
            ))}
          </section>

          {/* 4. Fax */}
          <section className="card space-y-3">
            <h2>4. Fax the packet</h2>
            <p className="text-sm text-gray-600">
              Cover sheet + approved forms + medical record summary.
              {(process.env.FAX_PROVIDER || "mock") === "mock" && " Fax is in mock mode: the packet is built but not transmitted."}
            </p>
            <form action={faxPacket.bind(null, id)} className="flex items-end gap-2">
              <div>
                <label className="label">Fax to</label>
                <input name="to" defaultValue={process.env.FAX_TEST_NUMBER || hospital.transferFax || ""} required className="input" />
              </div>
              <SubmitButton disabled={!allApproved} busy="Sending…">Send fax</SubmitButton>
              {!allApproved && <span className="text-sm text-amber-700">Fill and approve at least one form first.</span>}
            </form>
            {faxes.map((f) => (
              <p key={f.id} className="text-sm">
                {f.created_at} · to {f.to_number} · {f.provider} · <b>{f.status}</b> ·{" "}
                <a className="text-blue-700" href={`/api/faxes/${f.id}/pdf`} target="_blank">View packet</a>
              </p>
            ))}
          </section>

          {/* 5. Outcome */}
          <section className="card">
            <h2>5. Outcome</h2>
            <form action={setOutcome.bind(null, id)} className="flex items-end gap-2">
              <select name="status" defaultValue={t.status} className="input max-w-40">
                <option value="open">Open</option>
                <option value="accepted">Accepted</option>
                <option value="declined">Declined</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <input name="reason" defaultValue={t.outcomeReason ?? ""} placeholder="Reason / accepting physician / bed" className="input" />
              <SubmitButton className="btn-light">Save</SubmitButton>
            </form>
          </section>
        </>
      )}

      <Summary s={t.summary} />
    </div>
  );
}

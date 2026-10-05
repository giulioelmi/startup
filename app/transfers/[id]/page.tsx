import Link from "next/link";
import { notFound } from "next/navigation";
import { callTransferCenter, chooseHospital, faxPacket, refillForm, runRanking, saveFilled, setOutcome, toggleStep } from "@/app/actions";
import { ActivityFeed } from "@/components/ActivityFeed";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PdfViewer } from "@/components/PdfViewer";
import { SubmitButton } from "@/components/SubmitButton";
import { Summary } from "@/components/Summary";
import { Pill, STATUS_TONE, Stepper } from "@/components/ui";
import { all } from "@/lib/db";
import { listFilled, type Filled } from "@/lib/filled";
import { listForms } from "@/lib/forms";
import { CAPABILITIES, listHospitals, type Hospital } from "@/lib/hospitals";
import { STEP_ICONS, STEP_TYPES, type WorkflowStep } from "@/lib/workflow";
import { activity, progress, type Activity } from "@/lib/progress";
import { getTransfer, type Transfer } from "@/lib/transfers";
import type { Line } from "@/lib/voice";

// AI work (reading/filling forms, answering calls) can take a while; allow up to 5 minutes on Vercel.
export const maxDuration = 300;

type CallRow = { id: number; direction: string; number: string; status: string; transcript: string; created_at: string };
type FaxRow = { id: number; to_number: string; provider: string; status: string; created_at: string };
const LIVE_CALL = ["queued", "initiated", "ringing", "in-progress"];

// The nurse's workspace for one transfer: steps across the top, the action for
// the current step on the left, the document for that step on the right.
export default async function TransferPage(props: PageProps<"/transfers/[id]">) {
  const id = Number((await props.params).id);
  const t = await getTransfer(id);
  if (!t) notFound();
  const q = (await props.searchParams) as { step?: string; doc?: string };
  const { steps, workflow, next } = await progress(t);
  const step = steps.some((s) => s.id === q.step) ? q.step! : next;
  const n = steps.findIndex((s) => s.id === step) + 1; // step number shown in the panel
  const index = steps.find((s) => s.id === step)?.index; // set for the facility's workflow steps
  const ws = index != null ? workflow[index] : undefined;
  const view = ws ? VIEW[ws.type] : (step as View); // which document shows on the right

  const hospitals = await listHospitals();
  const hospital = hospitals.find((h) => h.id === t.hospitalId);
  const filled = await listFilled(id);
  const reading = hospital ? (await listForms(hospital.id)).filter((f) => f.status === "reading") : [];
  const calls = await all<CallRow>("SELECT * FROM calls WHERE transfer_id = $1 ORDER BY id DESC", [id]);
  const faxes = await all<FaxRow>("SELECT id, to_number, provider, status, created_at FROM faxes WHERE transfer_id = $1 ORDER BY id DESC", [id]);
  const events = await activity(id);
  const busy = filled.some((f) => f.status === "filling") || reading.length > 0 || calls.some((c) => LIVE_CALL.includes(c.status));
  const p = t.summary.patient;
  const href = (s: string, doc?: string | number) => `/transfers/${id}?step=${s}${doc != null ? `&doc=${doc}` : ""}`;

  return (
    <div className="space-y-6">
      {busy && <AutoRefresh seconds={2} />}

      {/* Patient header */}
      <div className="card flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Transfer #{t.id}</p>
          <h1 className="mt-1">{p.name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {p.age} y/o {p.sex} · DOB {p.birthDate} · MRN {p.mrn ?? "—"}
          </p>
          <p className="mt-3 max-w-2xl text-sm">
            <span className="font-semibold">Reason:</span> {t.reason}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-sm">
          <div className="flex gap-2">
            {t.details.emergent && <Pill tone="red">Emergent</Pill>}
            <Pill tone="teal">{t.details.levelOfCare}</Pill>
            <Pill tone={STATUS_TONE[t.status]}>{t.status}</Pill>
          </div>
          <p className="text-slate-500">From {t.details.sendingHospital || "—"} · {t.details.referringPhysician}</p>
          {hospital && <p className="font-semibold text-slate-800">→ {hospital.name}</p>}
          {t.outcomeReason && <p className="max-w-xs text-right text-slate-600">{t.outcomeReason}</p>}
        </div>
      </div>

      <div className="card py-4">
        <Stepper steps={steps} current={step} href={(s) => href(s)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-5">
          <section className="card space-y-4">
            {step === "chart" && <ChartStep t={t} />}
            {step === "hospital" && <HospitalStep t={t} hospitals={hospitals} href={href} />}
            {ws && hospital && (
              <>
                <StepTitle n={n} title={`${STEP_ICONS[ws.type]} ${STEP_TYPES[ws.type]}`}>{ws.note}</StepTitle>
                {(ws.type === "fill_forms" || ws.type === "receive_forms") && (
                  <FormsStep t={t} ws={ws} here={step} hospital={hospital} filled={filled} reading={reading.length} selected={selectedFilled(filled, q.doc)} href={href} />
                )}
                {(ws.type === "call" || ws.type === "wait_for_call") && (
                  <CallStep t={t} ws={ws} here={step} hospital={hospital} calls={calls} selected={Number(q.doc) || calls[0]?.id} href={href} />
                )}
                {ws.type === "send_fax" && <FaxStep t={t} ws={ws} here={step} workflow={workflow} hospital={hospital} filled={filled} faxes={faxes} href={href} />}
                <form action={toggleStep.bind(null, t.id, index!)} className="border-t pt-3">
                  <SubmitButton className="text-xs font-medium text-slate-500 hover:text-teal-700">
                    {t.skipped.includes(index!) ? "↺ Undo “done”" : "Mark this step done / not needed"}
                  </SubmitButton>
                </form>
              </>
            )}
            {step === "outcome" && <OutcomeStep t={t} n={n} />}
          </section>
          <section className="card">
            <h2 className="mb-4">Activity</h2>
            <ActivityFeed items={events} limit={8} />
          </section>
        </div>

        <div className="lg:col-span-7">
          <Document t={t} view={view} ws={ws} hospital={hospital} hospitals={hospitals} filled={filled} calls={calls} faxes={faxes} events={events} doc={q.doc} />
        </div>
      </div>
    </div>
  );
}

const short = (h: Hospital) => h.name.split(" (")[0];

const selectedFilled = (filled: Filled[], doc?: string) => filled.find((f) => f.id === Number(doc)) ?? filled.find((f) => !f.approvedAt) ?? filled[0];

type Href = (step: string, doc?: string | number) => string;

// Which document each kind of workflow step shows on the right.
type View = "chart" | "hospital" | "forms" | "call" | "fax" | "outcome";
const VIEW: Record<WorkflowStep["type"], View> = { call: "call", wait_for_call: "call", receive_forms: "forms", fill_forms: "forms", send_fax: "fax" };

// ---------------- Left: one panel per step ----------------

function StepTitle({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <div>
      <p className="eyebrow">Step {n}</p>
      <h2 className="mt-1 text-lg">{title}</h2>
      {children && <p className="mt-1 text-sm text-slate-600">{children}</p>}
    </div>
  );
}

function ChartStep({ t }: { t: Transfer }) {
  const s = t.summary;
  const facts = [
    ["Problems", s.problems.length],
    ["Medications", s.medications.length],
    ["Allergies", s.allergies.length],
    ["Labs", s.labs.length],
  ] as const;
  return (
    <>
      <StepTitle n={1} title="Chart pulled from Epic">
        The AI works only from this snapshot of the chart, taken {t.createdAt} UTC. Every answer it gives can be traced back to it.
      </StepTitle>
      <div className="grid grid-cols-4 gap-2">
        {facts.map(([label, n]) => (
          <div key={label} className="rounded-lg bg-slate-50 p-3 text-center">
            <p className="text-2xl font-bold text-slate-900">{n}</p>
            <p className="text-xs text-slate-500">{label}</p>
          </div>
        ))}
      </div>
      {s.missing.length > 0 && <p className="text-xs text-amber-700">Epic did not return: {s.missing.join(", ")}</p>}
      <Link href={`/transfers/${t.id}?step=hospital`} className="btn">Next: choose hospital →</Link>
    </>
  );
}

function HospitalStep({ t, hospitals, href }: { t: Transfer; hospitals: Hospital[]; href: Href }) {
  if (!t.ranking)
    return (
      <>
        <StepTitle n={2} title="Choose the receiving hospital">The hospitals have not been ranked yet.</StepTitle>
        <form action={runRanking.bind(null, t.id)}>
          <SubmitButton busy="AI is reviewing the chart…">Rank hospitals</SubmitButton>
        </form>
      </>
    );
  const noAI = t.ranking.ai === false;
  return (
    <>
      <StepTitle n={2} title="Choose the receiving hospital" />
      {noAI ? (
        <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p>{t.ranking.needsExplanation}</p>
          <form action={runRanking.bind(null, t.id)}>
            <SubmitButton className="btn-light" busy="AI is reviewing the chart…">Re-run AI ranking</SubmitButton>
          </form>
        </div>
      ) : (
        <div className="rounded-lg bg-teal-50 p-3 text-sm text-teal-900">
          <p className="font-semibold">The patient needs</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {t.ranking.needs.length ? t.ranking.needs.map((n) => <Pill key={n} tone="teal">{CAPABILITIES[n]}</Pill>) : <Pill>No specialized service</Pill>}
          </div>
          <p className="mt-2">{t.ranking.needsExplanation}</p>
        </div>
      )}
      <div className="space-y-3">
        {t.ranking.hospitals.map((r, i) => {
          const h = hospitals.find((x) => x.id === r.hospitalId);
          if (!h) return null; // facility deleted since the ranking
          const chosen = t.hospitalId === h.id;
          return (
            <div key={h.id} className={`rounded-lg border p-3 ${chosen ? "border-teal-600 bg-teal-50/50 ring-1 ring-teal-600" : "border-slate-200"}`}>
              <div className="flex items-start justify-between gap-3">
                <Link href={href("hospital", h.id)} className="font-semibold text-slate-900 hover:text-teal-700">
                  {i + 1}. {h.name}
                </Link>
                {chosen ? (
                  <Pill tone="green">Chosen</Pill>
                ) : (
                  <form action={chooseHospital.bind(null, t.id, h.id)}>
                    <SubmitButton className="btn-light" busy="…">Choose</SubmitButton>
                  </form>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs">
                {r.distanceMiles != null && <Pill>{r.distanceMiles} mi</Pill>}
                {noAI ? null : r.eligible ? (
                  <Pill tone="green">All needed services</Pill>
                ) : (
                  <Pill tone="red">Missing {r.missing.map((m) => CAPABILITIES[m]).join(", ")}</Pill>
                )}
              </div>
              <p className="mt-2 text-sm text-slate-600">{r.rationale}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}

const FILL_STATUS = {
  filling: <Pill tone="blue" pulse>AI filling…</Pill>,
  failed: <Pill tone="red">Failed</Pill>,
  review: <Pill tone="amber">Ready for review</Pill>,
  approved: <Pill tone="green">Approved</Pill>,
};
const fillStatus = (f: Filled) => (f.status === "ready" ? FILL_STATUS[f.approvedAt ? "approved" : "review"] : FILL_STATUS[f.status]);

function FormsStep({ t, ws, here, hospital, filled, reading, selected, href }: { t: Transfer; ws: WorkflowStep; here: string; hospital: Hospital; filled: Filled[]; reading: number; selected?: Filled; href: Href }) {
  return (
    <>
      <p className="text-sm text-slate-600">
        {ws.type === "receive_forms"
          ? `Waiting for ${short(hospital)}'s forms. They arrive by fax${process.env.SENDING_HOSPITAL_FAX ? ` (${process.env.SENDING_HOSPITAL_FAX})` : ""} or email, or upload them in the Forms inbox; the AI fills them the moment they arrive.`
          : `The AI fills every ${short(hospital)} form automatically, including new ones that arrive by email or fax. Review and approve.`}
      </p>

      <ul className="divide-y rounded-lg border">
        {reading > 0 && (
          <li className="flex items-center justify-between px-3 py-2.5 text-sm">
            <span className="text-slate-600">New form received</span>
            <Pill tone="blue" pulse>AI reading…</Pill>
          </li>
        )}
        {filled.map((f) => (
          <li key={f.id}>
            <Link href={href(here, f.id)} className={`flex items-center justify-between px-3 py-2.5 text-sm hover:bg-slate-50 ${selected?.id === f.id ? "bg-teal-50/60" : ""}`}>
              <span className="font-medium">{f.formName}</span>
              {fillStatus(f)}
            </Link>
          </li>
        ))}
        {filled.length === 0 && reading === 0 && (
          <li className="px-3 py-4 text-sm text-slate-600">
            No {short(hospital)} forms on file yet. <Link href="/forms" className="font-medium text-teal-700">Upload one</Link>, or ask the transfer
            center to fax/email it — the AI fills it the moment it arrives.
          </li>
        )}
      </ul>

      {selected?.status === "failed" && (
        <div className="space-y-2 text-sm text-rose-700">
          <p>The AI could not fill this form: {selected.error}</p>
          <form action={refillForm.bind(null, t.id, selected.formId)}>
            <SubmitButton className="btn-light">Try again</SubmitButton>
          </form>
        </div>
      )}

      {selected?.status === "ready" && <Review f={selected} t={t} />}
    </>
  );
}

// Every value the AI entered, with its source. Missing items are flagged.
function Review({ f, t }: { f: Filled; t: Transfer }) {
  const missing = f.values.filter((v) => v.source === "not in record").length;
  return (
    <form action={saveFilled.bind(null, f.id)} className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <p>
          <span className="font-semibold">{f.values.length - missing}</span> of {f.values.length} fields filled from the chart
          {missing > 0 && <span className="text-amber-700"> · {missing} not in record</span>}
        </p>
        <button formAction={refillForm.bind(null, t.id, f.formId)} formNoValidate className="text-xs font-medium text-teal-700 hover:underline">
          Re-fill with AI
        </button>
      </div>
      <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
        {f.fields.map((field) => {
          const v = f.values.find((x) => x.name === field.name);
          const gap = v?.source === "not in record";
          return (
            <label key={field.name} className="block">
              <span className="flex justify-between text-xs">
                <span className="font-semibold text-slate-600">{field.label}</span>
                <span className={gap ? "text-amber-700" : "text-slate-400"}>{v?.source}</span>
              </span>
              {field.type === "checkbox" ? (
                <input type="checkbox" name={`v:${field.name}`} defaultChecked={v?.value === "true"} className="mt-1" />
              ) : (
                <input name={`v:${field.name}`} defaultValue={v?.value} className={`input mt-1 ${gap ? "border-amber-300 bg-amber-50" : ""}`} />
              )}
            </label>
          );
        })}
      </div>
      {f.approvedAt ? (
        <p className="text-sm font-medium text-emerald-700">✓ Approved by {f.approvedBy} · {f.approvedAt} UTC</p>
      ) : (
        <div className="flex gap-2 border-t pt-3">
          <input name="approver" required placeholder="Your name" className="input" />
          <SubmitButton busy="Saving…">Approve</SubmitButton>
        </div>
      )}
    </form>
  );
}

function CallStep({ t, ws, here, hospital, calls, selected, href }: { t: Transfer; ws: WorkflowStep; here: string; hospital: Hospital; calls: CallRow[]; selected?: number; href: Href }) {
  const outbound = ws.type === "call";
  const shown = calls.filter((c) => (c.direction === "outbound") === outbound);
  return (
    <>
      <p className="text-sm text-slate-600">
        {outbound
          ? "The AI calls, presents the request, answers the nurse's questions from the chart and records the decision."
          : `${short(hospital)} calls back${process.env.TWILIO_PHONE_NUMBER ? ` ${process.env.TWILIO_PHONE_NUMBER}` : " our number"} with reference #${t.id}; the AI answers from the chart and records the decision.`}
      </p>
      {outbound && (
        <form action={callTransferCenter.bind(null, t.id)} className="flex items-end gap-2">
          <input type="hidden" name="step" value={here} />
          <div className="flex-1">
            <label className="label">Number to call</label>
            <input name="to" defaultValue={process.env.CALL_TEST_NUMBER || ws.number || hospital.transferPhone} className="input" />
          </div>
          <SubmitButton busy="Dialing…">📞 Call now</SubmitButton>
        </form>
      )}
      <ul className="divide-y rounded-lg border">
        {shown.map((c) => (
          <li key={c.id}>
            <Link href={href(here, c.id)} className={`flex items-center justify-between px-3 py-2.5 text-sm hover:bg-slate-50 ${selected === c.id ? "bg-teal-50/60" : ""}`}>
              <span>
                {c.direction === "outbound" ? "Outgoing" : "Incoming"} · {c.number}
                <span className="block text-xs text-slate-500">{c.created_at} UTC</span>
              </span>
              <Pill tone={LIVE_CALL.includes(c.status) ? "blue" : c.status === "completed" ? "green" : "gray"} pulse={LIVE_CALL.includes(c.status)}>
                {c.status}
              </Pill>
            </Link>
          </li>
        ))}
        {shown.length === 0 && <li className="px-3 py-4 text-sm text-slate-500">No {outbound ? "calls" : "calls from them"} yet.</li>}
      </ul>
    </>
  );
}

function FaxStep({ t, ws, here, workflow, hospital, filled, faxes, href }: { t: Transfer; ws: WorkflowStep; here: string; workflow: WorkflowStep[]; hospital: Hospital; filled: Filled[]; faxes: FaxRow[]; href: Href }) {
  const approved = filled.every((f) => f.status === "ready" && f.approvedAt);
  const formsStep = workflow.findIndex((s) => s.type === "fill_forms");
  return (
    <>
      <p className="text-sm text-slate-600">
        Cover sheet, {filled.length ? "approved forms " : ""}and the medical record summary in one fax.
        {(process.env.FAX_PROVIDER || "mock") === "mock" && " Fax is in mock mode: the packet is built but not transmitted."}
      </p>
      <form action={faxPacket.bind(null, t.id)} className="flex items-end gap-2">
        <input type="hidden" name="step" value={here} />
        <div className="flex-1">
          <label className="label">Fax to</label>
          <input name="to" defaultValue={process.env.FAX_TEST_NUMBER || ws.number || hospital.transferFax || ""} required className="input" />
        </div>
        <SubmitButton disabled={!approved} busy="Sending…">Send fax</SubmitButton>
      </form>
      {!approved && (
        <p className="text-sm text-amber-700">
          Approve the forms first.{formsStep >= 0 && <> <Link className="font-medium underline" href={href(`w${formsStep}`)}>Go to forms</Link></>}
        </p>
      )}
      {faxes.length > 0 && <ul className="divide-y rounded-lg border">
        {faxes.map((f) => (
          <li key={f.id}>
            <Link href={href(here, f.id)} className="flex items-center justify-between px-3 py-2.5 text-sm hover:bg-slate-50">
              <span>
                To {f.to_number}
                <span className="block text-xs text-slate-500">{f.created_at} UTC · {f.provider}</span>
              </span>
              <Pill tone={f.status.startsWith("sent") || f.status === "completed" ? "green" : f.status === "failure" ? "red" : "blue"}>{f.status}</Pill>
            </Link>
          </li>
        ))}
      </ul>}
    </>
  );
}

function OutcomeStep({ t, n }: { t: Transfer; n: number }) {
  return (
    <>
      <StepTitle n={n} title="Outcome">Set automatically when the transfer center accepts or declines on the call; you can also record it here.</StepTitle>
      <form action={setOutcome.bind(null, t.id)} className="space-y-3">
        <select name="status" defaultValue={t.status} className="input">
          <option value="open">Open</option>
          <option value="accepted">Accepted</option>
          <option value="declined">Declined</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input name="reason" defaultValue={t.outcomeReason ?? ""} placeholder="Accepting physician, bed, or reason declined" className="input" />
        <SubmitButton>Save outcome</SubmitButton>
      </form>
    </>
  );
}

// ---------------- Right: the document for the current step ----------------

function Document({ t, view, ws, hospital, hospitals, filled, calls, faxes, events, doc }: { t: Transfer; view: View; ws?: WorkflowStep; hospital?: Hospital; hospitals: Hospital[]; filled: Filled[]; calls: CallRow[]; faxes: FaxRow[]; events: Activity[]; doc?: string }) {
  const frame = (title: string, sub: string, body: React.ReactNode, link?: string) => (
    <section className="card sticky top-20 space-y-4 bg-slate-100/60">
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow">Document</p>
          <h2>{title}</h2>
          <p className="text-xs text-slate-500">{sub}</p>
        </div>
        {link && <a href={link} target="_blank" className="btn-light">Open PDF ↗</a>}
      </div>
      <div className="max-h-[calc(100vh-14rem)] overflow-y-auto">{body}</div>
    </section>
  );

  if (view === "chart") return frame("Epic chart summary", `Snapshot ${t.createdAt} UTC`, <Summary s={t.summary} />);

  if (view === "hospital") {
    const h = hospitals.find((x) => x.id === (doc ?? t.hospitalId ?? t.ranking?.hospitals[0]?.hospitalId));
    return h ? frame(h.name, "Transfer center profile", <HospitalProfile h={h} />) : frame("Hospital", "", <p className="text-sm text-slate-500">No ranking yet.</p>);
  }

  if (view === "forms") {
    const f = selectedFilled(filled, doc);
    if (!f) return frame("Filled form", "", <p className="text-sm text-slate-500">The filled form appears here.</p>);
    if (f.status !== "ready") return frame(f.formName, "Original form — AI is filling it", <PdfViewer url={`/api/forms/${f.formId}/pdf`} />);
    const url = `/api/filled/${f.id}/pdf?v=${encodeURIComponent(f.approvedAt ?? JSON.stringify(f.values).length + f.id)}`;
    return frame(f.formName, f.approvedAt ? "Filled and approved" : "Filled by AI — awaiting review", <PdfViewer key={url} url={url} />, url);
  }

  if (view === "call") {
    const c = calls.find((x) => x.id === Number(doc)) ?? calls.find((x) => (x.direction === "outbound") === (ws?.type === "call"));
    if (!c) return frame("Call transcript", "", <p className="text-sm text-slate-500">The live transcript appears here during the call.</p>);
    return frame("Call transcript", `${c.direction} · ${c.number} · ${c.status}`, <Transcript lines={JSON.parse(c.transcript)} live={LIVE_CALL.includes(c.status)} />);
  }

  if (view === "fax") {
    const sent = faxes.find((x) => x.id === Number(doc));
    if (!hospital) return frame("Fax packet", "", <p className="text-sm text-slate-500">Choose a hospital first.</p>);
    const url = sent ? `/api/faxes/${sent.id}/pdf` : `/api/transfers/${t.id}/packet?v=${filled.map((f) => f.approvedAt ?? f.status).join()}`;
    return frame("Fax packet", sent ? `Sent ${sent.created_at} UTC to ${sent.to_number}` : "Preview — what will be faxed", <PdfViewer key={url} url={url} />, url);
  }

  return frame("Transfer timeline", "Everything the AI and staff did", <ActivityFeed items={events} />);
}

function HospitalProfile({ h }: { h: Hospital }) {
  return (
    <div className="space-y-4 rounded-lg bg-white p-5 text-sm">
      {!h.verified && <Pill tone="amber">Contact details not yet verified</Pill>}
      <dl className="grid grid-cols-3 gap-3">
        <div><dt className="label">Transfer center</dt><dd>{h.transferPhone}</dd></div>
        <div><dt className="label">Fax</dt><dd>{h.transferFax ?? "—"}</dd></div>
        <div><dt className="label">Email</dt><dd>{h.transferEmail ?? "—"}</dd></div>
      </dl>
      <div><p className="label">Address</p><p>{h.address}</p></div>
      <div><p className="label">How they take transfers</p><p>{h.intakeNotes}</p></div>
      <div>
        <p className="label">They ask for</p>
        <ul className="list-disc pl-5">{h.requiredInfo.map((r) => <li key={r}>{r}</li>)}</ul>
      </div>
      <div>
        <p className="label">Services</p>
        <div className="flex flex-wrap gap-1.5">{h.capabilities.map((c) => <Pill key={c}>{CAPABILITIES[c]}</Pill>)}</div>
      </div>
    </div>
  );
}

function Transcript({ lines, live }: { lines: Line[]; live: boolean }) {
  return (
    <div className="space-y-3 rounded-lg bg-white p-4">
      {lines.map((l, i) => (
        <div key={i} className={`flex ${l.who === "ai" ? "justify-start" : "justify-end"}`}>
          <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${l.who === "ai" ? "rounded-bl-sm bg-teal-700 text-white" : "rounded-br-sm bg-slate-100 text-slate-800"}`}>
            <p className="mb-0.5 text-[10px] font-bold tracking-wide uppercase opacity-70">{l.who === "ai" ? "TransferAI" : "Transfer center"}</p>
            {l.text}
          </div>
        </div>
      ))}
      {live && <p className="text-center text-xs text-slate-400">● live</p>}
      {!lines.length && <p className="text-sm text-slate-400">Waiting for the call to connect…</p>}
    </div>
  );
}

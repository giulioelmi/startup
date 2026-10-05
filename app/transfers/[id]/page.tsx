import Link from "next/link";
import { notFound } from "next/navigation";
import { callTransferCenter, chooseHospital, faxPacket, refillForm, runRanking, saveFilled, setOutcome } from "@/app/actions";
import { ActivityFeed } from "@/components/ActivityFeed";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PdfViewer } from "@/components/PdfViewer";
import { SubmitButton } from "@/components/SubmitButton";
import { Summary } from "@/components/Summary";
import { Pill, Spinner, STATUS_TONE, Stepper } from "@/components/ui";
import { all } from "@/lib/db";
import { listFilled, type Filled } from "@/lib/filled";
import { listForms } from "@/lib/forms";
import { CAPABILITIES, getHospital, type Hospital } from "@/lib/hospitals";
import { activity, progress, STEP_IDS, type Activity, type StepId } from "@/lib/progress";
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
  const { steps, next } = await progress(t);
  const step: StepId = STEP_IDS.includes(q.step as StepId) ? (q.step as StepId) : next;

  const hospital = getHospital(t.hospitalId);
  const filled = await listFilled(id);
  const reading = hospital ? (await listForms(hospital.id)).filter((f) => f.status === "reading") : [];
  const calls = await all<CallRow>("SELECT * FROM calls WHERE transfer_id = $1 ORDER BY id DESC", [id]);
  const faxes = await all<FaxRow>("SELECT id, to_number, provider, status, created_at FROM faxes WHERE transfer_id = $1 ORDER BY id DESC", [id]);
  const events = await activity(id);
  const busy = t.rankingStatus === "running" || filled.some((f) => f.status === "filling") || reading.length > 0 || calls.some((c) => LIVE_CALL.includes(c.status));
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
            {step === "hospital" && <HospitalStep t={t} href={href} />}
            {step === "forms" && <FormsStep t={t} hospital={hospital} filled={filled} reading={reading.length} selected={selectedFilled(filled, q.doc)} href={href} />}
            {step === "call" && <CallStep t={t} hospital={hospital} calls={calls} selected={Number(q.doc) || calls[0]?.id} href={href} />}
            {step === "fax" && <FaxStep t={t} hospital={hospital} filled={filled} faxes={faxes} href={href} />}
            {step === "outcome" && <OutcomeStep t={t} />}
          </section>
          <section className="card">
            <h2 className="mb-4">Activity</h2>
            <ActivityFeed items={events} limit={8} />
          </section>
        </div>

        <div className="lg:col-span-7">
          <Document t={t} step={step} hospital={hospital} filled={filled} calls={calls} faxes={faxes} events={events} doc={q.doc} />
        </div>
      </div>
    </div>
  );
}

const selectedFilled = (filled: Filled[], doc?: string) => filled.find((f) => f.id === Number(doc)) ?? filled.find((f) => !f.approvedAt) ?? filled[0];

type Href = (step: string, doc?: string | number) => string;

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

function HospitalStep({ t, href }: { t: Transfer; href: Href }) {
  if (t.rankingStatus === "running")
    return (
      <>
        <StepTitle n={2} title="Choose the receiving hospital" />
        <p className="flex items-center gap-2 text-sm text-slate-600"><Spinner /> The AI is reviewing the chart and ranking hospitals…</p>
      </>
    );
  if (!t.ranking)
    return (
      <>
        <StepTitle n={2} title="Choose the receiving hospital">The AI could not rank the hospitals yet (check the AI model settings).</StepTitle>
        {t.rankingError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">AI error: {t.rankingError}</p>}
        <form action={runRanking.bind(null, t.id)}>
          <SubmitButton busy="Starting…">Rank hospitals with AI</SubmitButton>
        </form>
      </>
    );
  return (
    <>
      <StepTitle n={2} title="Choose the receiving hospital" />
      <div className="rounded-lg bg-teal-50 p-3 text-sm text-teal-900">
        <p className="font-semibold">The patient needs</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {t.ranking.needs.length ? t.ranking.needs.map((n) => <Pill key={n} tone="teal">{CAPABILITIES[n]}</Pill>) : <Pill>No specialized service</Pill>}
        </div>
        <p className="mt-2">{t.ranking.needsExplanation}</p>
      </div>
      <div className="space-y-3">
        {t.ranking.hospitals.map((r, i) => {
          const h = getHospital(r.hospitalId)!;
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
                {r.eligible ? <Pill tone="green">All needed services</Pill> : <Pill tone="red">Missing {r.missing.map((m) => CAPABILITIES[m]).join(", ")}</Pill>}
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

function FormsStep({ t, hospital, filled, reading, selected, href }: { t: Transfer; hospital?: Hospital; filled: Filled[]; reading: number; selected?: Filled; href: Href }) {
  if (!hospital) return <StepTitle n={3} title="Transfer forms">Choose a receiving hospital first.</StepTitle>;
  return (
    <>
      <StepTitle n={3} title="Transfer forms">
        The AI fills every {hospital.name.split(" (")[0]} form automatically, including new ones that arrive by email or fax. Review and approve.
      </StepTitle>

      <ul className="divide-y rounded-lg border">
        {reading > 0 && (
          <li className="flex items-center justify-between px-3 py-2.5 text-sm">
            <span className="text-slate-600">New form received</span>
            <Pill tone="blue" pulse>AI reading…</Pill>
          </li>
        )}
        {filled.map((f) => (
          <li key={f.id}>
            <Link href={href("forms", f.id)} className={`flex items-center justify-between px-3 py-2.5 text-sm hover:bg-slate-50 ${selected?.id === f.id ? "bg-teal-50/60" : ""}`}>
              <span className="font-medium">{f.formName}</span>
              {fillStatus(f)}
            </Link>
          </li>
        ))}
        {filled.length === 0 && reading === 0 && (
          <li className="px-3 py-4 text-sm text-slate-600">
            No {hospital.name.split(" (")[0]} forms on file yet. <Link href="/forms" className="font-medium text-teal-700">Upload one</Link>, or ask the transfer
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

function CallStep({ t, hospital, calls, selected, href }: { t: Transfer; hospital?: Hospital; calls: CallRow[]; selected?: number; href: Href }) {
  if (!hospital) return <StepTitle n={4} title="Call the transfer center">Choose a receiving hospital first.</StepTitle>;
  return (
    <>
      <StepTitle n={4} title="Call the transfer center">
        The AI calls, presents the request, answers the nurse&apos;s questions from the chart and records the decision. The hospital can call back
        {process.env.TWILIO_PHONE_NUMBER ? ` ${process.env.TWILIO_PHONE_NUMBER}` : ""} with reference #{t.id}.
      </StepTitle>
      <form action={callTransferCenter.bind(null, t.id)} className="flex items-end gap-2">
        <div className="flex-1">
          <label className="label">Number to call</label>
          <input name="to" defaultValue={process.env.CALL_TEST_NUMBER || hospital.transferPhone} className="input" />
        </div>
        <SubmitButton busy="Dialing…">📞 Call now</SubmitButton>
      </form>
      <ul className="divide-y rounded-lg border">
        {calls.map((c) => (
          <li key={c.id}>
            <Link href={href("call", c.id)} className={`flex items-center justify-between px-3 py-2.5 text-sm hover:bg-slate-50 ${selected === c.id ? "bg-teal-50/60" : ""}`}>
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
        {calls.length === 0 && <li className="px-3 py-4 text-sm text-slate-500">No calls yet.</li>}
      </ul>
    </>
  );
}

function FaxStep({ t, hospital, filled, faxes, href }: { t: Transfer; hospital?: Hospital; filled: Filled[]; faxes: FaxRow[]; href: Href }) {
  if (!hospital) return <StepTitle n={5} title="Fax the packet">Choose a receiving hospital first.</StepTitle>;
  const ready = filled.filter((f) => f.status === "ready");
  const approved = ready.length > 0 && ready.every((f) => f.approvedAt);
  return (
    <>
      <StepTitle n={5} title="Fax the packet">
        Cover sheet, approved forms and the medical record summary in one fax.
        {(process.env.FAX_PROVIDER || "mock") === "mock" && " Fax is in mock mode: the packet is built but not transmitted."}
      </StepTitle>
      <form action={faxPacket.bind(null, t.id)} className="flex items-end gap-2">
        <div className="flex-1">
          <label className="label">Fax to</label>
          <input name="to" defaultValue={process.env.FAX_TEST_NUMBER || hospital.transferFax || ""} required className="input" />
        </div>
        <SubmitButton disabled={!approved} busy="Sending…">Send fax</SubmitButton>
      </form>
      {!approved && (
        <p className="text-sm text-amber-700">
          Approve the forms first. <Link className="font-medium underline" href={href("forms")}>Go to forms</Link>
        </p>
      )}
      {faxes.length > 0 && <ul className="divide-y rounded-lg border">
        {faxes.map((f) => (
          <li key={f.id}>
            <Link href={href("fax", f.id)} className="flex items-center justify-between px-3 py-2.5 text-sm hover:bg-slate-50">
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

function OutcomeStep({ t }: { t: Transfer }) {
  return (
    <>
      <StepTitle n={6} title="Outcome">Set automatically when the transfer center accepts or declines on the call; you can also record it here.</StepTitle>
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

function Document({ t, step, hospital, filled, calls, faxes, events, doc }: { t: Transfer; step: StepId; hospital?: Hospital; filled: Filled[]; calls: CallRow[]; faxes: FaxRow[]; events: Activity[]; doc?: string }) {
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

  if (step === "chart") return frame("Epic chart summary", `Snapshot ${t.createdAt} UTC`, <Summary s={t.summary} />);

  if (step === "hospital") {
    const h = getHospital(doc) ?? hospital ?? getHospital(t.ranking?.hospitals[0]?.hospitalId);
    return h ? frame(h.name, "Transfer center profile", <HospitalProfile h={h} />) : frame("Hospital", "", <p className="text-sm text-slate-500">No ranking yet.</p>);
  }

  if (step === "forms") {
    const f = selectedFilled(filled, doc);
    if (!f) return frame("Filled form", "", <p className="text-sm text-slate-500">The filled form appears here.</p>);
    if (f.status !== "ready") return frame(f.formName, "Original form — AI is filling it", <PdfViewer url={`/api/forms/${f.formId}/pdf`} />);
    const url = `/api/filled/${f.id}/pdf?v=${encodeURIComponent(f.approvedAt ?? JSON.stringify(f.values).length + f.id)}`;
    return frame(f.formName, f.approvedAt ? "Filled and approved" : "Filled by AI — awaiting review", <PdfViewer key={url} url={url} />, url);
  }

  if (step === "call") {
    const c = calls.find((x) => x.id === Number(doc)) ?? calls[0];
    if (!c) return frame("Call transcript", "", <p className="text-sm text-slate-500">The live transcript appears here during the call.</p>);
    return frame("Call transcript", `${c.direction} · ${c.number} · ${c.status}`, <Transcript lines={JSON.parse(c.transcript)} live={LIVE_CALL.includes(c.status)} />);
  }

  if (step === "fax") {
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

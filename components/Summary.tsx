import type { ClinicalSummary } from "@/lib/summary";

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-gray-700">{title}</h3>
      {items.length ? (
        <ul className="list-disc pl-5 text-sm">{items.map((i, n) => <li key={n}>{i}</li>)}</ul>
      ) : (
        <p className="text-sm text-gray-400">None on record</p>
      )}
    </div>
  );
}

export function Summary({ s }: { s: ClinicalSummary }) {
  const p = s.patient;
  return (
    <div className="card space-y-4">
      <div>
        <h2 className="mb-1">{p.name}</h2>
        <p className="text-sm text-gray-600">
          {p.age ?? "?"} y/o {p.sex} · DOB {p.birthDate} · MRN {p.mrn ?? "?"} · {p.language ?? ""} · {p.address ?? ""}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <List title="Problems" items={s.problems.map((x) => `${x.name}${x.status ? ` (${x.status})` : ""}`)} />
        <List title="Allergies" items={s.allergies.map((x) => `${x.substance}${x.reaction ? `: ${x.reaction}` : ""}`)} />
        <List title="Medications" items={s.medications.map((x) => `${x.name}${x.dosage ? ` – ${x.dosage}` : ""}`)} />
        <List title="Latest vitals" items={s.vitals.map((x) => `${x.name}: ${x.value} (${x.date ?? ""})`)} />
        <List title="Latest labs" items={s.labs.map((x) => `${x.name}: ${x.value}${x.flag ? ` ${x.flag}` : ""}`)} />
        <List title="Insurance" items={s.coverage.map((x) => `${x.payer}${x.memberId ? ` #${x.memberId}` : ""}`)} />
      </div>
      {s.missing.length > 0 && <p className="text-xs text-amber-700">Not returned by Epic: {s.missing.join(", ")}</p>}
    </div>
  );
}

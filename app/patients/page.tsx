import Link from "next/link";
import { epicConfig, searchPatients, type FhirResource } from "@/lib/epic";
import { TEST_PATIENTS } from "@/lib/epic-test-patients";
import { MIMIC_PATIENTS, searchMimic } from "@/lib/mimic";

/* eslint-disable @typescript-eslint/no-explicit-any */
const nameOf = (p: any) => p.name?.[0]?.text ?? [p.name?.[0]?.given?.join(" "), p.name?.[0]?.family].join(" ");

export default async function PatientsPage(props: PageProps<"/patients">) {
  const q = (await props.searchParams) as Record<string, string | undefined>;
  let results: FhirResource[] | null = null;
  let error: string | null = null;
  if (q.family || q.given || q.birthdate) {
    const params = { family: q.family, given: q.given, birthdate: q.birthdate };
    results = searchMimic(params);
    // Epic is searched too when it's set up; an Epic error still shows the MIMIC matches.
    if (epicConfig().clientId) {
      try {
        results.push(...(await searchPatients(params)));
      } catch (e) {
        error = `Epic: ${(e as Error).message}`;
      }
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">New transfer</p>
        <h1 className="mt-1">Find the patient</h1>
      </div>
      <form className="card grid grid-cols-4 items-end gap-3">
        <div><label className="label">Last name</label><input name="family" defaultValue={q.family} className="input" /></div>
        <div><label className="label">First name</label><input name="given" defaultValue={q.given} className="input" /></div>
        <div><label className="label">Birth date</label><input name="birthdate" type="date" defaultValue={q.birthdate} className="input" /></div>
        <button className="btn justify-center">Search</button>
      </form>

      {error && <p className="card text-rose-700">{error}</p>}
      {results && (
        <div className="card">
          <h2 className="mb-3">Results</h2>
          {results.length === 0 && <p className="text-sm text-slate-500">No patients found.</p>}
          <ul className="divide-y">
            {results.map((p: any) => (
              <li key={p.id} className="py-2">
                <Link className="font-medium text-teal-700 hover:underline" href={`/patients/${p.id}`}>{nameOf(p)}</Link>
                <span className="ml-3 text-sm text-slate-500">DOB {p.birthDate} · {p.gender}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {MIMIC_PATIENTS.length > 0 && (
        <div>
          <h2>MIMIC-IV demo patients</h2>
          <p className="mb-3 text-sm text-slate-500">Real de-identified ICU stays from the MIMIC-IV demo, with made-up names. No allergies or notes in this data.</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {MIMIC_PATIENTS.map((p) => (
              <Link key={p.id} href={`/patients/${p.id}`} className="card hover:border-teal-500">
                <p className="font-medium">{p.name}</p>
                <p className="truncate text-xs text-slate-500">{p.diagnosis ?? "No diagnosis coded"}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-3">Epic sandbox test patients</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {TEST_PATIENTS.map((p) => (
            <Link key={p.id} href={`/patients/${p.id}`} className="card flex items-center gap-3 hover:border-teal-500">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-teal-100 font-bold text-teal-800">
                {p.name.split(" ").map((w) => w[0]).join("")}
              </span>
              <span className="font-medium">{p.name}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

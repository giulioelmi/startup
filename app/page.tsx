import Link from "next/link";
import { searchPatients, type FhirResource } from "@/lib/epic";
import { TEST_PATIENTS } from "@/lib/epic-test-patients";

/* eslint-disable @typescript-eslint/no-explicit-any */
const nameOf = (p: any) => p.name?.[0]?.text ?? [p.name?.[0]?.given?.join(" "), p.name?.[0]?.family].join(" ");

export default async function PatientsPage(props: PageProps<"/">) {
  const q = (await props.searchParams) as Record<string, string | undefined>;
  let results: FhirResource[] | null = null;
  let error: string | null = null;
  if (q.family || q.given || q.birthdate) {
    try {
      results = await searchPatients({ family: q.family, given: q.given, birthdate: q.birthdate });
    } catch (e) {
      error = (e as Error).message;
    }
  }

  return (
    <div className="space-y-6">
      <h1>Patients (Epic)</h1>
      <form className="card grid grid-cols-4 items-end gap-3">
        <div><label className="label">Last name</label><input name="family" defaultValue={q.family} className="input" /></div>
        <div><label className="label">First name</label><input name="given" defaultValue={q.given} className="input" /></div>
        <div><label className="label">Birth date</label><input name="birthdate" type="date" defaultValue={q.birthdate} className="input" /></div>
        <button className="btn">Search Epic</button>
      </form>

      {error && <p className="card text-red-700">{error}</p>}
      {results && (
        <div className="card">
          <h2>Results</h2>
          {results.length === 0 && <p className="text-sm text-gray-500">No patients found.</p>}
          <ul className="divide-y">
            {results.map((p: any) => (
              <li key={p.id} className="py-2">
                <Link className="text-blue-700 hover:underline" href={`/patients/${p.id}`}>{nameOf(p)}</Link>
                <span className="ml-3 text-sm text-gray-500">DOB {p.birthDate} · {p.gender}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2>Epic sandbox test patients</h2>
        <ul className="grid grid-cols-3 gap-2">
          {TEST_PATIENTS.map((p) => (
            <li key={p.id}><Link className="text-blue-700 hover:underline" href={`/patients/${p.id}`}>{p.name}</Link></li>
          ))}
        </ul>
      </div>
    </div>
  );
}

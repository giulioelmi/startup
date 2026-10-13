import { PatientSearch } from "@/components/PatientSearch";
import { epicConfig } from "@/lib/epic";
import { TEST_PATIENTS } from "@/lib/epic-test-patients";
import { MIMIC_PATIENTS } from "@/lib/mimic";

const age = (birthDate: string) => Math.floor((Date.now() - new Date(birthDate).getTime()) / 3.15576e10);

export default function PatientsPage() {
  const epic = epicConfig().clientId ? "Epic sandbox" : "Epic sandbox · Epic not connected";
  const patients = [
    ...MIMIC_PATIENTS.map((p) => ({
      id: p.id,
      name: p.name,
      meta: `MRN ${p.mrn ?? "—"} · ${age(p.birthDate)} y/o ${p.sex[0].toUpperCase()} · DOB ${p.birthDate}`,
      detail: p.diagnosis ?? "No diagnosis coded",
    })),
    ...TEST_PATIENTS.map((p) => ({ ...p, meta: epic })),
  ];
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">New transfer</p>
        <h1 className="mt-1">Find the patient</h1>
      </div>
      <PatientSearch patients={patients} />
    </div>
  );
}

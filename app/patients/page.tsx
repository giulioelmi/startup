import { PatientSearch } from "@/components/PatientSearch";
import { TEST_PATIENTS } from "@/lib/epic-test-patients";
import { MIMIC_PATIENTS } from "@/lib/mimic";

export default function PatientsPage() {
  const patients = [...MIMIC_PATIENTS.map((p) => ({ id: p.id, name: p.name, detail: p.diagnosis ?? "No diagnosis coded" })), ...TEST_PATIENTS];
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

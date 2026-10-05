import Link from "next/link";
import { FacilityForm } from "@/components/FacilityForm";

export default function NewFacilityPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/facilities" className="text-sm font-medium text-teal-700">← Facilities</Link>
        <h1 className="mt-2">New facility</h1>
      </div>
      <FacilityForm />
    </div>
  );
}

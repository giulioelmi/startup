import Link from "next/link";
import { notFound } from "next/navigation";
import { FacilityForm } from "@/components/FacilityForm";
import { getHospital } from "@/lib/hospitals";

export default async function EditFacilityPage(props: PageProps<"/facilities/[id]/edit">) {
  const h = await getHospital((await props.params).id);
  if (!h) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={`/facilities/${h.id}`} className="text-sm font-medium text-teal-700">← {h.name}</Link>
        <h1 className="mt-2">Edit facility</h1>
      </div>
      <FacilityForm h={h} />
    </div>
  );
}

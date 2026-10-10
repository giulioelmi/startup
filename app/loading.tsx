import { Spinner } from "@/components/ui";

// Shown instantly while any page loads.
export default function Loading() {
  return (
    <div className="flex items-center justify-center gap-3 py-24 text-slate-500">
      <Spinner className="h-6 w-6 text-teal-700" />
      Loading…
    </div>
  );
}

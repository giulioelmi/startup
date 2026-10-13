import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card mx-auto max-w-lg space-y-3 text-center">
      <h1>Not found</h1>
      <p className="text-sm text-slate-600">This page doesn’t exist, or it was deleted.</p>
      <Link href="/" className="btn">Back to transfers</Link>
    </div>
  );
}

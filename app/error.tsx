"use client";

import Link from "next/link";

// Shown when a page or action fails unexpectedly.
export default function Error({ retry }: { error: Error; retry: () => void }) {
  return (
    <div className="card mx-auto max-w-lg space-y-3 text-center">
      <h1>Something went wrong</h1>
      <p className="text-sm text-slate-600">Nothing was lost. Try again, or go back to the transfers.</p>
      <div className="flex justify-center gap-2">
        <button className="btn" onClick={retry}>Try again</button>
        <Link href="/" className="btn-light">Transfers</Link>
      </div>
    </div>
  );
}

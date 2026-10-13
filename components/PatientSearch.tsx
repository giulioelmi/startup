"use client";

import Link from "next/link";
import { useState } from "react";

// Search box over every patient; the list narrows as you type.
export function PatientSearch({ patients }: { patients: { id: string; name: string; detail?: string }[] }) {
  const [q, setQ] = useState("");
  const shown = patients.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="space-y-4">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patients by name" className="input" />
      {shown.length === 0 && <p className="text-sm text-slate-500">No patients found.</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {shown.map((p) => (
          <Link key={p.id} href={`/patients/${p.id}`} className="card hover:border-teal-500">
            <p className="font-medium">{p.name}</p>
            {p.detail && <p className="truncate text-xs text-slate-500">{p.detail}</p>}
          </Link>
        ))}
      </div>
    </div>
  );
}

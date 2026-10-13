"use client";

import Link from "next/link";
import { useState } from "react";

type Patient = { id: string; name: string; meta: string; detail?: string };

// Search box over every patient (name or MRN); the list narrows as you type.
export function PatientSearch({ patients }: { patients: Patient[] }) {
  const [q, setQ] = useState("");
  const words = q.trim().toLowerCase();
  const shown = patients.filter((p) => `${p.name} ${p.meta}`.toLowerCase().includes(words));
  return (
    <div className="space-y-4">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or MRN" className="input" />
      <p className="text-xs text-slate-500">{shown.length} of {patients.length} patients</p>
      {shown.length === 0 && <p className="text-sm text-slate-500">No patients found.</p>}
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {shown.map((p) => (
          <Link key={p.id} href={`/patients/${p.id}`} className="card min-w-0 hover:border-teal-500">
            <p className="font-medium">{p.name}</p>
            <p className="text-xs text-slate-500">{p.meta}</p>
            {p.detail && <p className="truncate text-xs text-slate-500">{p.detail}</p>}
          </Link>
        ))}
      </div>
    </div>
  );
}

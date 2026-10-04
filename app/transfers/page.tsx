import Link from "next/link";
import { getHospital } from "@/lib/hospitals";
import { listTransfers } from "@/lib/transfers";

export default function TransfersPage() {
  const transfers = listTransfers();
  return (
    <div>
      <h1>Transfers</h1>
      <div className="card">
        {transfers.length === 0 && <p className="text-sm text-gray-500">No transfers yet. Start one from a patient.</p>}
        <table className="w-full text-sm">
          <tbody className="divide-y">
            {transfers.map((t) => (
              <tr key={t.id}>
                <td className="py-2">#{t.id}</td>
                <td><Link className="text-blue-700 hover:underline" href={`/transfers/${t.id}`}>{t.patientName}</Link></td>
                <td className="max-w-md truncate">{t.reason}</td>
                <td>{getHospital(t.hospitalId)?.name ?? "—"}</td>
                <td>{t.status}</td>
                <td className="text-gray-500">{t.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

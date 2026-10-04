import { audit } from "@/lib/db";
import { setFaxStatus } from "@/lib/fax";
import { saveForm } from "@/lib/forms";
import { matchHospitalByPhone } from "@/lib/hospitals";

// Sinch fax events (JSON callbacks):
//  - FAX_COMPLETED: delivery result of a fax we sent
//  - INCOMING_FAX:  a hospital faxed us something -> saved as a form
// Use {PUBLIC_URL}/api/fax/webhook?token={WEBHOOK_TOKEN} as both callback and incoming URL.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function POST(req: Request) {
  if (new URL(req.url).searchParams.get("token") !== process.env.WEBHOOK_TOKEN) return new Response("Forbidden", { status: 403 });

  const event: any = await req.json();
  const fax = event.fax ?? {};

  if (event.event === "INCOMING_FAX" && event.file) {
    const hospital = matchHospitalByPhone(fax.from ?? "");
    await saveForm({
      name: `Fax from ${fax.from ?? "unknown"}`,
      bytes: Buffer.from(event.file, "base64"),
      mime: "application/pdf",
      hospitalId: hospital?.id ?? null,
      source: "fax",
      sender: fax.from,
    });
    audit("inbound-fax", "form.received", null, hospital?.id ?? "unknown sender");
  } else if (fax.id && fax.status) {
    setFaxStatus(fax.id, fax.status);
  }
  return new Response(null, { status: 204 });
}

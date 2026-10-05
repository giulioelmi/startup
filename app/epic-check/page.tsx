import { decodeJwt, decodeProtectedHeader } from "jose";
import { createPrivateKey } from "node:crypto";
import { buildAssertion, epicConfig, requestToken } from "@/lib/epic";

// Epic connection check: shows what the server sends to Epic and what Epic answers.
// Never shows the private key or the raw signed token.
type Row = [label: string, value: string, ok: boolean | null];

async function runCheck(): Promise<Row[]> {
  const cfg = epicConfig();
  const rows: Row[] = [];
  const add = (label: string, value: string, ok: boolean | null = null) => rows.push([label, value, ok]);

  add("EPIC_CLIENT_ID", cfg.clientId ? `${cfg.clientId} (${cfg.clientId.length} chars)` : "missing", !!cfg.clientId);
  add("Key ID (kid)", cfg.keyId);
  let keyBits = 0;
  try {
    if (cfg.pem) keyBits = createPrivateKey(cfg.pem).asymmetricKeyDetails?.modulusLength ?? 0;
  } catch {}
  add("Private key", cfg.pem ? (keyBits ? `loaded, RSA ${keyBits}-bit` : "present but unreadable") : "missing", keyBits >= 2048);
  add("Token URL", cfg.tokenUrl);

  // Is our public key reachable at PUBLIC_URL, with the same kid?
  const jwksUrl = `${process.env.PUBLIC_URL ?? ""}/api/jwks`;
  try {
    const res = await fetch(jwksUrl, { cache: "no-store" });
    const kids = ((await res.json()).keys ?? []).map((k: { kid: string }) => k.kid);
    add("Public key at " + jwksUrl, `HTTP ${res.status}, kid ${kids.join(", ") || "none"}`, res.ok && kids.includes(cfg.keyId));
  } catch (e) {
    add("Public key at " + jwksUrl, `not reachable: ${(e as Error).message}`, false);
  }

  let assertion: string | null = null;
  try {
    assertion = await buildAssertion();
    const h = decodeProtectedHeader(assertion);
    const c = decodeJwt(assertion);
    add("JWT header", JSON.stringify(h));
    add("JWT claims", JSON.stringify({ ...c, exp_in_seconds: (c.exp ?? 0) - Math.floor(Date.now() / 1000) }));
  } catch (e) {
    add("Signed JWT", `could not build: ${(e as Error).message}`, false);
  }

  if (assertion) {
    const token = await requestToken(assertion).catch((e) => ({ status: 0, body: (e as Error).message }));
    add("Epic token response", `HTTP ${token.status}: ${token.status === 200 ? "access token received" : token.body}`, token.status === 200);
    if (token.status === 200) {
      const { access_token } = JSON.parse(token.body);
      const res = await fetch(`${cfg.fhirBase}/Patient/erXuFYUfucBZaryVksYEcMg3`, {
        headers: { Authorization: `Bearer ${access_token}`, Accept: "application/fhir+json" },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      add("Test patient (Camila Lopez)", res.ok ? `HTTP 200: ${body.name?.[0]?.text ?? "loaded"}` : `HTTP ${res.status}`, res.ok);
    }
  }
  return rows;
}

export default async function EpicCheck() {
  const rows = await runCheck();
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Diagnostics</p>
        <h1 className="mt-1">Epic connection check</h1>
        <p className="mt-1 text-sm text-slate-600">Runs a real sign-in to Epic&apos;s sandbox. Reload to run again. The private key and the signed token are never shown.</p>
      </div>
      <div className="card p-0">
        <table className="w-full text-sm">
          <tbody className="divide-y">
            {rows.map(([label, value, ok]) => (
              <tr key={label} className="align-top">
                <td className="w-8 px-4 py-3">{ok === null ? "" : ok ? "✅" : "❌"}</td>
                <td className="w-64 py-3 pr-4 font-semibold">{label}</td>
                <td className="py-3 pr-4 font-mono text-xs break-all">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

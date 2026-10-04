import { createPublicKey } from "node:crypto";

// Public key Epic uses to verify our signed token requests.
// Register {PUBLIC_URL}/api/jwks as the "JWK Set URL" of the Epic app.
export function GET() {
  const pem = process.env.EPIC_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!pem) return Response.json({ keys: [] });
  const jwk = createPublicKey(pem).export({ format: "jwk" });
  return Response.json({ keys: [{ ...jwk, kid: process.env.EPIC_KEY_ID || "transfer-ai-1", alg: "RS384", use: "sig" }] });
}

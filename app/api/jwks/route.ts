import { createPublicKey } from "node:crypto";
import { epicConfig } from "@/lib/epic";

// Public key Epic uses to verify our signed token requests.
// Register {PUBLIC_URL}/api/jwks as the "JWK Set URL" of the Epic app.
export function GET(req: Request) {
  // Logged so Vercel's runtime logs show whether (and when) Epic downloads the key.
  console.log("jwks fetched", { ua: req.headers.get("user-agent"), ip: req.headers.get("x-forwarded-for") });
  const { pem, keyId } = epicConfig();
  if (!pem) return Response.json({ keys: [] });
  const jwk = createPublicKey(pem).export({ format: "jwk" });
  return Response.json({ keys: [{ ...jwk, kid: keyId, alg: "RS384", use: "sig" }] });
}

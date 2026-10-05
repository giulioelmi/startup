import { expect, test } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { buildAssertion, epicConfig } from "@/lib/epic";

test("client assertion matches Epic's Backend Services rules, with trimmed settings", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  // Pasted the way Vercel often stores it: escaped newlines, stray whitespace.
  process.env.EPIC_PRIVATE_KEY = (privateKey.export({ type: "pkcs8", format: "pem" }) as string).replace(/\n/g, "\\n") + "\n";
  process.env.EPIC_CLIENT_ID = " 557fb4c5-9743-47f8-afa2-00be5ef893a7\n";
  process.env.EPIC_KEY_ID = "transfer-ai-1 ";

  expect(epicConfig().clientId).toBe("557fb4c5-9743-47f8-afa2-00be5ef893a7");
  const jwt = await buildAssertion();
  expect(decodeProtectedHeader(jwt)).toEqual({ alg: "RS384", typ: "JWT", kid: "transfer-ai-1" });

  const c = decodeJwt(jwt);
  expect(c.iss).toBe("557fb4c5-9743-47f8-afa2-00be5ef893a7");
  expect(c.sub).toBe(c.iss);
  expect(c.aud).toBe("https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token");
  expect(c.jti).toBeTruthy();
  expect(c.exp! - c.iat!).toBeLessThanOrEqual(300); // Epic: at most 5 minutes
});

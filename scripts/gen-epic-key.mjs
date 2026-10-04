// Creates the key pair for Epic Backend Services.
// Paste the private key into .env; give Epic the JWK Set URL ({PUBLIC_URL}/api/jwks)
// or upload the public key printed below.
import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const priv = privateKey.export({ type: "pkcs8", format: "pem" });
console.log("EPIC_PRIVATE_KEY=\"" + priv.trim().replace(/\n/g, "\\n") + "\"\n");
console.log("Public key (for Epic upload):\n" + publicKey.export({ type: "spki", format: "pem" }));

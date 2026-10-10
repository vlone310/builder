/** Prints a new ES256 private JWK for EDIT_TOKEN_PRIVATE_JWK. */
import { exportJWK, generateKeyPair } from "jose";

const { privateKey } = await generateKeyPair("ES256", { extractable: true });
const jwk = { ...(await exportJWK(privateKey)), kid: `k-${new Date().toISOString().slice(0, 10)}` };
console.log(JSON.stringify(jwk));

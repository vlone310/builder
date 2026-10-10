import { type Db, environments, withOrg } from "@builder/db";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { type CryptoKey, exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from "jose";
import { z } from "zod";
import { type AppEnv, notFound, parseJson, requirePermission } from "./http";

/** Audience every edit token carries; hosts reject tokens without it. */
export const EDIT_TOKEN_AUDIENCE = "builder-host";
export const EDIT_TOKEN_TTL_SECONDS = 10 * 60;

export interface EditTokenSigner {
  issuer: string;
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
}

/**
 * Loads the ES256 signing key from a private JWK (EDIT_TOKEN_PRIVATE_JWK). Without
 * one, an ephemeral key is generated: fine for local development, since hosts
 * fetch the public key from the JWKS endpoint, but tokens stop verifying on restart.
 */
export async function createEditTokenSigner(options: {
  issuer: string;
  privateJwk?: string;
}): Promise<EditTokenSigner> {
  if (options.privateJwk) {
    const jwk = JSON.parse(options.privateJwk) as JWK;
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || !jwk.kid) {
      throw new Error("EDIT_TOKEN_PRIVATE_JWK must be a P-256 private JWK with a kid");
    }
    const privateKey = (await importJWK(jwk, "ES256")) as CryptoKey;
    const { d: _private, ...publicJwk } = jwk;
    return { issuer: options.issuer, kid: jwk.kid, privateKey, publicJwk };
  }
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const kid = `ephemeral-${Date.now().toString(36)}`;
  return {
    issuer: options.issuer,
    kid,
    privateKey,
    publicJwk: { ...(await exportJWK(publicKey)), kid },
  };
}

export function jwksRoute(signer: EditTokenSigner) {
  const app = new Hono();
  app.get("/.well-known/jwks.json", (c) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json({ keys: [{ ...signer.publicJwk, alg: "ES256", use: "sig" }] });
  });
  return app;
}

const createEditTokenSchema = z.object({ siteId: z.string(), envId: z.string() });

export function editTokenRoutes(db: Db, signer: EditTokenSigner) {
  const app = new Hono<AppEnv>();

  /** A short-lived token that lets one host environment enter edit mode for this user. */
  app.post("/edit-tokens", async (c) => {
    const { orgId, userId } = requirePermission(c, "content.edit");
    const { siteId, envId } = await parseJson(c, createEditTokenSchema);
    const [environment] = await withOrg(db, orgId, (tx) =>
      tx
        .select()
        .from(environments)
        .where(and(eq(environments.id, envId), eq(environments.siteId, siteId))),
    );
    if (!environment) throw notFound("Environment");

    const expiresAt = Math.floor(Date.now() / 1000) + EDIT_TOKEN_TTL_SECONDS;
    const token = await new SignJWT({
      org: orgId,
      site: siteId,
      env: environment.name,
      envId: environment.id,
      scope: "edit",
    })
      .setProtectedHeader({ alg: "ES256", kid: signer.kid, typ: "JWT" })
      .setIssuer(signer.issuer)
      .setAudience(EDIT_TOKEN_AUDIENCE)
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(signer.privateKey);

    return c.json(
      {
        token,
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        environment: {
          id: environment.id,
          name: environment.name,
          hostUrl: environment.hostUrl,
          allowedOrigin: environment.allowedOrigin,
        },
      },
      201,
    );
  });

  return app;
}

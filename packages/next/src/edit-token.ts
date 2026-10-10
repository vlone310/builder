import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";

export const EDIT_TOKEN_AUDIENCE = "builder-host";

export interface EditSession {
  userId: string;
  orgId: string;
  siteId: string;
  env: string;
  envId: string;
  expiresAt: Date;
}

export interface EditTokenConfig {
  /** Content API origin; the token issuer and the home of /.well-known/jwks.json. */
  contentApiUrl: string;
  /** This host's site id and environment name; tokens for anything else are refused. */
  siteId: string;
  env: string;
  /** Override for tests. */
  keys?: JWTVerifyGetKey;
}

export class EditTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditTokenError";
  }
}

const keySets = new Map<string, JWTVerifyGetKey>();

function keysFor(contentApiUrl: string): JWTVerifyGetKey {
  let keys = keySets.get(contentApiUrl);
  if (!keys) {
    keys = createRemoteJWKSet(new URL("/.well-known/jwks.json", contentApiUrl), {
      cacheMaxAge: 10 * 60 * 1000,
      cooldownDuration: 30 * 1000,
    });
    keySets.set(contentApiUrl, keys);
  }
  return keys;
}

/**
 * Verifies an edit token on the server: ES256 signature against the Content API's
 * JWKS, issuer, audience, expiry, and that it was issued for this site and environment.
 */
export async function verifyEditToken(
  token: string,
  config: EditTokenConfig,
): Promise<EditSession> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, config.keys ?? keysFor(config.contentApiUrl), {
      issuer: config.contentApiUrl.replace(/\/+$/, ""),
      audience: EDIT_TOKEN_AUDIENCE,
      algorithms: ["ES256"],
    }));
  } catch (error) {
    throw new EditTokenError(
      `Invalid edit token: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (payload.scope !== "edit") throw new EditTokenError("Token is not an edit token");
  if (payload.site !== config.siteId) throw new EditTokenError("Token is for another site");
  if (payload.env !== config.env) throw new EditTokenError("Token is for another environment");
  return {
    userId: String(payload.sub),
    orgId: String(payload.org),
    siteId: String(payload.site),
    env: String(payload.env),
    envId: String(payload.envId),
    expiresAt: new Date(Number(payload.exp) * 1000),
  };
}

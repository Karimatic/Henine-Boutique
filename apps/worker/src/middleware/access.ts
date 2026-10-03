/**
 * Admin API guard: a valid session cookie (email + password + email code login) is required.
 * If ACCESS_AUD / ACCESS_TEAM_DOMAIN are configured, a valid Cloudflare Access JWT is required
 * as well (optional second wall in production).
 */
import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { hasPermission, type Permission } from "@henine/shared";
import type { AppEnv } from "../env";
import { readSession } from "../lib/auth";

const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

async function accessOk(teamDomain: string, aud: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  let set = jwksByTeam.get(teamDomain);
  if (!set) {
    set = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksByTeam.set(teamDomain, set);
  }
  try {
    await jwtVerify(token, set, { issuer: teamDomain, audience: aud, algorithms: ["RS256"] });
    return true;
  } catch {
    return false;
  }
}

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.env.ACCESS_AUD && c.env.ACCESS_TEAM_DOMAIN) {
    if (!(await accessOk(c.env.ACCESS_TEAM_DOMAIN, c.env.ACCESS_AUD, c.req.header("Cf-Access-Jwt-Assertion")))) {
      return c.json({ error: "unauthenticated" }, 401);
    }
  }
  const s = await readSession(c);
  if (!s) return c.json({ error: "unauthenticated" }, 401);
  c.set("member", {
    id: s.id,
    email: s.email,
    name: s.name,
    role: s.role,
    roleName: s.roleName,
    permissions: JSON.parse(s.permissions) as string[],
    sessionId: s.sessionId,
  });
  return next();
};

export function requirePermission(permission: Permission): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const member = c.get("member");
    if (!member || !hasPermission(member.permissions, permission)) {
      return c.json({ error: "forbidden", permission }, 403);
    }
    return next();
  };
}

/** The shop owner only (role "owner"): deletions and the team's full details. */
export const requireOwner: MiddlewareHandler<AppEnv> = async (c, next) => {
  const member = c.get("member");
  if (!member || member.role !== "owner") return c.json({ error: "owner_only" }, 403);
  return next();
};

/** Actor string recorded in audit logs, order events and stock movements. */
export function actorOf(member: { id: number; name: string }): string {
  return `member:${member.id}:${member.name}`;
}

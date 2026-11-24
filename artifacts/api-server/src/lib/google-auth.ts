import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { one, transaction, HttpError } from "./store";
import { rateLimit, renewSession } from "./security";

export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export function requestOrigin(req: Request) {
  // Hosts are validated before being used as OAuth redirect destinations.
  const host = req.get("host") || "";
  if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) throw new HttpError(400, "Invalid app address.");
  return `${req.protocol}://${host}`;
}
export async function startGoogle(req: Request, res: Response) {
  if (!googleEnabled()) { res.redirect("/?auth_error=google_unavailable"); return; }
  await rateLimit(req, "google-start", 30);
  const state = randomBytes(32).toString("hex"), verifier = randomBytes(48).toString("base64url");
  const redirectUri = `${requestOrigin(req)}/api/auth/google/callback`;
  req.session.googleOAuth = { state, verifier, redirectUri, expires: Date.now() + 10 * 60_000 };
  await new Promise<void>((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri,
    response_type: "code", scope: "openid email profile", state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256", prompt: "select_account",
  }).toString();
  res.redirect(url.href);
}
export async function finishGoogle(req: Request, res: Response) {
  const attempt = req.session.googleOAuth;
  delete req.session.googleOAuth; // Always consume state, including provider rejection.
  await new Promise<void>((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!googleEnabled() || !attempt || attempt.expires < Date.now() ||
      state.length !== attempt.state.length || !timingSafeEqual(Buffer.from(state), Buffer.from(attempt.state)) || !code) {
    res.redirect("/?auth_error=google_cancelled"); return;
  }
  try {
    const tokensResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: attempt.redirectUri, grant_type: "authorization_code", code_verifier: attempt.verifier }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokensResponse.ok) throw new Error("Google code exchange failed");
    const tokens = z.object({ access_token: z.string().min(1) }).parse(await tokensResponse.json());
    // Userinfo is fetched over TLS using this app's freshly exchanged access token.
    // No unverified ID-token claims, client-provided email, or refresh tokens are used.
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Google profile unavailable");
    const profile = z.object({ sub: z.string().min(1).max(255), email: z.string().email().max(254),
      email_verified: z.literal(true), name: z.string().max(500).optional() }).parse(await response.json());
    const email = profile.email.toLowerCase().trim();
    const user = await transaction(async (client) => {
      // Serialize on verified email for concurrent password signup / OAuth callbacks.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [email]);
      const bySub = await one("SELECT id,email FROM users WHERE google_sub=$1", [profile.sub], client);
      if (bySub) return bySub;
      const byEmail = await one("SELECT id,google_sub FROM users WHERE email=$1 FOR UPDATE", [email], client);
      if (byEmail) {
        if (byEmail.google_sub && byEmail.google_sub !== profile.sub) throw new Error("Google identity conflict");
        return one("UPDATE users SET google_sub=$1 WHERE id=$2 RETURNING id", [profile.sub, byEmail.id], client);
      }
      return one("INSERT INTO users(name,email,google_sub) VALUES($1,$2,$3) RETURNING id",
        [(profile.name?.trim() || email.split("@")[0]).slice(0,80), email, profile.sub], client);
    });
    await renewSession(req, res, user!.id);
    res.redirect("/app");
  } catch {
    req.log.warn("Google sign-in did not complete"); // Never log codes, tokens, profiles or secrets.
    res.redirect("/?auth_error=google_failed");
  }
}

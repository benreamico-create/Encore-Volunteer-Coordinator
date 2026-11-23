import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response, NextFunction } from "express";
import { pool } from "@workspace/db";
import { HttpError, one } from "./store";

declare module "express-session" {
  interface SessionData { userId?: number; csrfToken?: string; }
}
const scrypt = promisify(scryptCallback);
const secret = process.env.SESSION_SECRET;
if (!secret) throw new Error("SESSION_SECRET is required");
const PgStore = connectPgSimple(session);
export const sessionMiddleware = session({
  name: "encore.sid", secret,
  store: new PgStore({ pool, tableName: "sessions", createTableIfMissing: false, pruneSessionInterval: false }),
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7 * 86400000 },
});
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
export async function passwordMatches(password: string, stored: string) {
  const [salt, encoded] = stored.split(":");
  const hash = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(encoded, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}
export function csrfToken(req: Request, res: Response) {
  req.session.csrfToken ??= randomBytes(32).toString("hex");
  res.cookie("encore.csrf", req.session.csrfToken, { sameSite: "lax", secure: process.env.NODE_ENV === "production", httpOnly: false, path: "/" });
  return req.session.csrfToken;
}
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (!["GET","HEAD","OPTIONS"].includes(req.method) && !req.path.startsWith("/public/")) {
    const supplied = req.get("x-csrf-token");
    const expected = req.session.csrfToken;
    if (!supplied || !expected || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      throw new HttpError(403, "Your session has changed. Refresh the page and try again.");
    }
  }
  next();
}
export function userId(req: Request) {
  if (!req.session.userId) throw new HttpError(401, "Please log in to continue.");
  return req.session.userId;
}
export async function rateLimit(req: Request, scope: string, limit: number, hours = 1) {
  // Store only an HMAC, never a raw IP. Shared DB limits work across Autoscale instances.
  const key = createHmac("sha256", secret!).update(`${req.ip}:${scope}`).digest("hex");
  const row = await one(`INSERT INTO request_limits(key,count,resets_at) VALUES($1,1,now()+$2 * interval '1 hour')
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limits.resets_at < now() THEN 1 ELSE request_limits.count+1 END,
    resets_at=CASE WHEN request_limits.resets_at < now() THEN now()+$2 * interval '1 hour' ELSE request_limits.resets_at END
    RETURNING count`, [key, hours]);
  if (Number(row!.count) > limit) throw new HttpError(429, "Too many attempts. Please try again later.");
}
export async function rateLimitByUser(uid: number, scope: string, limit: number, hours = 1) {
  const key = createHmac("sha256", secret!).update(`user:${uid}:${scope}`).digest("hex");
  const row = await one(`INSERT INTO request_limits(key,count,resets_at) VALUES($1,1,now()+$2 * interval '1 hour')
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limits.resets_at < now() THEN 1 ELSE request_limits.count+1 END,
    resets_at=CASE WHEN request_limits.resets_at < now() THEN now()+$2 * interval '1 hour' ELSE request_limits.resets_at END
    RETURNING count`, [key, hours]);
  if (Number(row!.count) > limit) throw new HttpError(429, "You have sent too many messages. Please try again later.");
}
export async function renewSession(req: Request, res: Response, uid: number) {
  await new Promise<void>((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
  req.session.userId = uid;
  csrfToken(req, res);
  await new Promise<void>((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
}

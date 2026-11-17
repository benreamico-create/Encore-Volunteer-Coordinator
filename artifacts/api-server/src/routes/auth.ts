import { Router } from "express";
import { SignUpBody, LogInBody, GetSessionResponse } from "@workspace/api-zod";
import { csrfToken, passwordHash, passwordMatches, rateLimit, renewSession } from "../lib/security";
import { HttpError, one } from "../lib/store";
import { remaining } from "../lib/ai";

const router = Router();
router.get("/auth/me", async (req, res) => {
  const user = req.session.userId ? await one("SELECT id,name,email FROM users WHERE id=$1", [req.session.userId]) : null;
  res.set("Cache-Control", "no-store");
  res.json(GetSessionResponse.parse({ user: user ?? null, csrfToken: csrfToken(req,res), ai_remaining: user ? await remaining(user.id) : 150, email_enabled: false }));
});
router.post("/auth/signup", async (req, res) => {
  await rateLimit(req, "signup", 20);
  const data = SignUpBody.parse(req.body);
  const name = data.name?.trim();
  if (!name) throw new HttpError(400, "Your name is required.");
  const email = data.email.toLowerCase().trim();
  const hash = await passwordHash(data.password);
  let user;
  try { user = await one("INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email", [name,email,hash]); }
  catch (e: any) { if (e.code === "23505") throw new HttpError(409,"There is already an account with this email. Please log in."); throw e; }
  await renewSession(req,res,user!.id);
  res.json({ user, csrfToken: req.session.csrfToken, ai_remaining: await remaining(user!.id), email_enabled: false });
});
router.post("/auth/login", async (req, res) => {
  await rateLimit(req,"login",30);
  const data = LogInBody.parse(req.body);
  const user = await one("SELECT * FROM users WHERE email=$1",[data.email.trim().toLowerCase()]);
  // Equal-cost hashing also for unknown accounts.
  const valid = user ? await passwordMatches(data.password,user.password_hash) : (await passwordHash(data.password), false);
  if (!valid) throw new HttpError(401,"Email or password is incorrect.");
  await renewSession(req,res,user!.id);
  res.json({ user: {id:user!.id,name:user!.name,email:user!.email}, csrfToken:req.session.csrfToken,ai_remaining:await remaining(user!.id),email_enabled:false });
});
router.post("/auth/logout", async (req,res) => {
  await new Promise<void>((resolve,reject) => req.session.destroy(e=>e?reject(e):resolve()));
  res.clearCookie("encore.sid"); res.clearCookie("encore.csrf"); res.json({ok:true});
});
export default router;

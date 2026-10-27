import type { NextFunction, Request, Response, CookieOptions } from "express";
import { env, isProd } from "../config/env.js";
import { forbidden, unauthorized } from "../lib/http.js";
import { signSession, verifySession } from "../lib/jwt.js";
import { UserModel, type Role, type UserDoc } from "../models/User.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserDoc;
    }
  }
}

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE ?? isProd,
  sameSite: "lax",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export function setSessionCookie(res: Response, user: UserDoc) {
  const token = signSession({ sub: user.id, role: user.role, tv: user.tokenVersion });
  res.cookie(env.COOKIE_NAME, token, cookieOptions);
  return token;
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(env.COOKIE_NAME, { ...cookieOptions, maxAge: undefined });
}

function readToken(req: Request) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return req.cookies?.[env.COOKIE_NAME] as string | undefined;
}

/** Loads the signed-in, approved user onto req.user or rejects with 401. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) throw unauthorized();

  let claims;
  try {
    claims = verifySession(token);
  } catch {
    throw unauthorized("Session expired, please log in again");
  }

  const user = await UserModel.findById(claims.sub);
  if (!user || user.tokenVersion !== claims.tv) throw unauthorized("Session expired, please log in again");
  if (user.status !== "approved") throw forbidden("Your account is not active");

  req.user = user;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

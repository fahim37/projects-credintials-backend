import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";
import type { Role } from "../models/User.js";

export type SessionClaims = { sub: string; role: Role; tv: number };
// rid = PasswordReset document id that was verified with the OTP.
export type ResetClaims = { sub: string; purpose: "reset"; rid: string };

export function signSession(claims: SessionClaims) {
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"] });
}

export function verifySession(token: string) {
  return jwt.verify(token, env.JWT_SECRET) as SessionClaims & jwt.JwtPayload;
}

export function signResetToken(claims: ResetClaims) {
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn: "15m" });
}

export function verifyResetToken(token: string) {
  const payload = jwt.verify(token, env.JWT_SECRET) as ResetClaims & jwt.JwtPayload;
  if (payload.purpose !== "reset") throw new Error("Wrong token purpose");
  return payload;
}

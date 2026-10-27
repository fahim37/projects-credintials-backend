import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { env } from "../../config/env.js";
import { randomOtp, sha256 } from "../../lib/crypto.js";
import { badRequest, forbidden, unauthorized } from "../../lib/http.js";
import { signResetToken, verifyResetToken } from "../../lib/jwt.js";
import { sendOtpMail } from "../../lib/mailer.js";
import { clearSessionCookie, requireAuth, setSessionCookie } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PasswordResetModel } from "../../models/PasswordReset.js";
import { UserModel } from "../../models/User.js";

export const authRouter = Router();

const MAX_OTP_ATTEMPTS = 5;

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });

export const passwordSchema = z.string().min(8, "Password must be at least 8 characters").max(128);
const email = z.string().trim().toLowerCase().email("Enter a valid email");

const registerBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    employeeId: z.string().trim().min(1).max(40),
    email,
    password: passwordSchema,
    confirmPassword: z.string(),
    // Admins are never self-registered; they are seeded or created by another admin.
    role: z.enum(["sales", "operation"]),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

authRouter.post("/register", authLimiter, validate({ body: registerBody }), async (req, res) => {
  const { confirmPassword: _, password, ...data } = req.valid.body as z.infer<typeof registerBody>;
  await UserModel.create({ ...data, passwordHash: await bcrypt.hash(password, 12), status: "pending" });
  res.status(201).json({ message: "Registration submitted. An admin will review your account shortly." });
});

const loginBody = z.object({ email, password: z.string().min(1, "Password is required") });

authRouter.post("/login", authLimiter, validate({ body: loginBody }), async (req, res) => {
  const { email, password } = req.valid.body as z.infer<typeof loginBody>;
  const user = await UserModel.findOne({ email }).select("+passwordHash");
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw unauthorized("Invalid email or password");
  if (user.status === "pending") throw forbidden("Your account is awaiting admin approval");
  if (user.status === "rejected") throw forbidden("Your registration was rejected. Contact an admin.");

  user.lastLoginAt = new Date();
  await user.save();
  setSessionCookie(res, user);
  res.json({ user });
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ message: "Logged out" });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ---- Forgot password: request OTP -> verify OTP (get reset token) -> set new password ----

const forgotBody = z.object({ email });

authRouter.post("/forgot-password", otpLimiter, validate({ body: forgotBody }), async (req, res) => {
  const { email } = req.valid.body as z.infer<typeof forgotBody>;
  const user = await UserModel.findOne({ email, status: "approved" });

  // Same response whether or not the account exists, so emails can't be enumerated.
  if (user) {
    const otp = randomOtp();
    await PasswordResetModel.deleteMany({ user: user._id });
    await PasswordResetModel.create({
      user: user._id,
      otpHash: sha256(otp),
      expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000),
    });
    await sendOtpMail(user.email, user.name, otp);
  }
  res.json({ message: "If that email is registered, a reset code has been sent." });
});

const verifyOtpBody = z.object({ email, otp: z.string().trim().regex(/^\d{6}$/, "Enter the 6 digit code") });

authRouter.post("/verify-otp", otpLimiter, validate({ body: verifyOtpBody }), async (req, res) => {
  const { email, otp } = req.valid.body as z.infer<typeof verifyOtpBody>;
  const invalid = badRequest("Invalid or expired code");

  const user = await UserModel.findOne({ email });
  if (!user) throw invalid;
  const reset = await PasswordResetModel.findOne({ user: user._id, expiresAt: { $gt: new Date() } });
  if (!reset || reset.attempts >= MAX_OTP_ATTEMPTS) throw invalid;

  if (reset.otpHash !== sha256(otp)) {
    reset.attempts += 1;
    await reset.save();
    throw invalid;
  }

  reset.verified = true;
  await reset.save();
  res.json({ resetToken: signResetToken({ sub: user.id, purpose: "reset", rid: reset.id }) });
});

const resetBody = z
  .object({ resetToken: z.string().min(1), password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

authRouter.post("/reset-password", otpLimiter, validate({ body: resetBody }), async (req, res) => {
  const { resetToken, password } = req.valid.body as z.infer<typeof resetBody>;
  let claims;
  try {
    claims = verifyResetToken(resetToken);
  } catch {
    throw badRequest("Reset link expired, please start again");
  }

  const reset = await PasswordResetModel.findOne({ _id: claims.rid, user: claims.sub, verified: true });
  if (!reset) throw badRequest("Reset link expired, please start again");

  await UserModel.updateOne(
    { _id: claims.sub },
    { $set: { passwordHash: await bcrypt.hash(password, 12) }, $inc: { tokenVersion: 1 } },
  );
  await PasswordResetModel.deleteMany({ user: claims.sub });
  res.json({ message: "Password updated. You can now log in." });
});

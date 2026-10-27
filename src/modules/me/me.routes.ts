import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { badRequest } from "../../lib/http.js";
import { requireAuth, setSessionCookie } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { UserModel } from "../../models/User.js";
import { passwordSchema } from "../auth/auth.routes.js";

/** The signed-in user's own account (Settings page: Profile + Change Password tabs). */
export const meRouter = Router();
meRouter.use(requireAuth);

const profileBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  avatarUrl: z.string().url().or(z.literal("")).optional(),
});

meRouter.patch("/", validate({ body: profileBody }), async (req, res) => {
  const body = req.valid.body as z.infer<typeof profileBody>;
  const user = req.user!;
  if (body.name !== undefined) user.name = body.name;
  if (body.avatarUrl !== undefined) user.avatarUrl = body.avatarUrl || undefined;
  await user.save();
  res.json({ user });
});

const passwordBody = z
  .object({ currentPassword: z.string().min(1), password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

meRouter.patch("/password", validate({ body: passwordBody }), async (req, res) => {
  const { currentPassword, password } = req.valid.body as z.infer<typeof passwordBody>;
  const user = await UserModel.findById(req.user!._id).select("+passwordHash");
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw badRequest("Current password is incorrect", { currentPassword: ["Current password is incorrect"] });
  }
  user.passwordHash = await bcrypt.hash(password, 12);
  user.tokenVersion += 1; // signs out other devices
  await user.save();
  setSessionCookie(res, user); // keep this device signed in
  res.json({ message: "Password updated" });
});

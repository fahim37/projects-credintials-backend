import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { badRequest, escapeRegex, notFound, pageMeta, paginate } from "../../lib/http.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { idParams, validate } from "../../middleware/validate.js";
import { ROLES, USER_STATUSES, UserModel } from "../../models/User.js";
import { passwordSchema } from "../auth/auth.routes.js";

/** Admin-only user management (User Management screen). */
export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole("admin"));

usersRouter.get("/stats", async (_req, res) => {
  const [byRole, pending] = await Promise.all([
    UserModel.aggregate<{ _id: string; count: number }>([
      { $match: { status: "approved" } },
      { $group: { _id: "$role", count: { $sum: 1 } } },
    ]),
    UserModel.countDocuments({ status: "pending" }),
  ]);
  const count = (role: string) => byRole.find((r) => r._id === role)?.count ?? 0;
  res.json({
    total: byRole.reduce((sum, r) => sum + r.count, 0),
    admin: count("admin"),
    sales: count("sales"),
    operation: count("operation"),
    pending,
  });
});

const listQuery = z.object({
  search: z.string().trim().optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  page: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().optional(),
});

usersRouter.get("/", validate({ query: listQuery }), async (req, res) => {
  const q = req.valid.query as z.infer<typeof listQuery>;
  const { page, limit, skip } = paginate(q);
  const filter: Record<string, unknown> = { status: q.status ?? "approved" };
  if (q.role) filter.role = q.role;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), "i");
    filter.$or = [{ name: rx }, { email: rx }, { employeeId: rx }];
  }
  const [items, total] = await Promise.all([
    UserModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    UserModel.countDocuments(filter),
  ]);
  res.json({ items, meta: pageMeta(total, page, limit) });
});

const createBody = z.object({
  name: z.string().trim().min(2).max(80),
  employeeId: z.string().trim().min(1).max(40),
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
  role: z.enum(ROLES),
});

usersRouter.post("/", validate({ body: createBody }), async (req, res) => {
  const { password, ...data } = req.valid.body as z.infer<typeof createBody>;
  const user = await UserModel.create({ ...data, passwordHash: await bcrypt.hash(password, 12), status: "approved" });
  res.status(201).json({ user });
});

const updateBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  employeeId: z.string().trim().min(1).max(40).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  password: passwordSchema.optional(),
});

usersRouter.patch("/:id", validate({ params: idParams, body: updateBody }), async (req, res) => {
  const { id } = req.valid.params as { id: string };
  const { password, ...data } = req.valid.body as z.infer<typeof updateBody>;
  const user = await UserModel.findById(id);
  if (!user) throw notFound("User not found");
  if (user.id === req.user!.id && ((data.role && data.role !== "admin") || (data.status && data.status !== "approved"))) {
    throw badRequest("You cannot demote or deactivate your own account");
  }

  const revokeSessions = (data.role && data.role !== user.role) || (data.status && data.status !== "approved") || password;
  user.set(data);
  if (password) user.passwordHash = await bcrypt.hash(password, 12);
  if (revokeSessions) user.tokenVersion += 1;
  await user.save();
  res.json({ user });
});

usersRouter.post("/:id/approve", validate({ params: idParams }), async (req, res) => {
  const { id } = req.valid.params as { id: string };
  const user = await UserModel.findByIdAndUpdate(id, { status: "approved" }, { new: true });
  if (!user) throw notFound("User not found");
  res.json({ user });
});

usersRouter.post("/:id/reject", validate({ params: idParams }), async (req, res) => {
  const { id } = req.valid.params as { id: string };
  const user = await UserModel.findByIdAndUpdate(
    id,
    { status: "rejected", $inc: { tokenVersion: 1 } },
    { new: true },
  );
  if (!user) throw notFound("User not found");
  res.json({ user });
});

usersRouter.delete("/:id", validate({ params: idParams }), async (req, res) => {
  const { id } = req.valid.params as { id: string };
  if (id === req.user!.id) throw badRequest("You cannot delete your own account");
  const user = await UserModel.findByIdAndDelete(id);
  if (!user) throw notFound("User not found");
  res.status(204).end();
});

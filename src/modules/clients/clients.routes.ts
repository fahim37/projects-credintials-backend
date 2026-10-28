import { Router } from "express";
import { z } from "zod";
import { AppError, conflict, escapeRegex, notFound, pageMeta, paginate } from "../../lib/http.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { idParams, validate } from "../../middleware/validate.js";
import { ClientModel, clientKey, serializeClient } from "../../models/Client.js";
import { ProjectModel } from "../../models/Project.js";

export const clientsRouter = Router();
clientsRouter.use(requireAuth);
const canEdit = requireRole("admin", "operation");
const body = z.object({ name: z.string().trim().min(1, "Client name is required").max(120) });
const listQuery = z.object({
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

clientsRouter.get("/", validate({ query: listQuery }), async (req, res) => {
  const q = req.valid.query as z.infer<typeof listQuery>;
  const { page, limit, skip } = paginate(q);
  const filter = q.search ? { name: new RegExp(escapeRegex(q.search), "i") } : {};
  const [clients, total] = await Promise.all([
    ClientModel.find(filter).sort({ key: 1, _id: 1 }).skip(skip).limit(limit).lean(),
    ClientModel.countDocuments(filter),
  ]);
  const counts = await ProjectModel.aggregate<{ _id: unknown; count: number }>([
    { $match: { client: { $in: clients.map(c => c._id) } } },
    { $group: { _id: "$client", count: { $sum: 1 } } },
  ]);
  const usage = new Map(counts.map(c => [String(c._id), c.count]));
  res.json({ items: clients.map(c => serializeClient(c, usage.get(String(c._id)) ?? 0)), meta: pageMeta(total, page, limit) });
});

clientsRouter.get("/:id", validate({ params: idParams }), async (req, res) => {
  const { id } = req.valid.params as { id: string };
  const client = await ClientModel.findById(id).lean();
  if (!client) throw notFound("Client not found");
  res.json({ client: serializeClient(client, await ProjectModel.countDocuments({ client: id })) });
});

async function checkDuplicate(name: string, exceptId?: string) {
  const existing = await ClientModel.findOne({ key: clientKey(name), ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).lean();
  if (existing) throw new AppError(409, "A client with this name already exists", {
    name: ["A client with this name already exists"], existingClientId: [String(existing._id)],
  });
}

clientsRouter.post("/", canEdit, validate({ body }), async (req, res) => {
  const { name } = req.valid.body as z.infer<typeof body>;
  await checkDuplicate(name);
  const client = await ClientModel.create({ name, createdBy: req.user!._id });
  res.status(201).json({ client: serializeClient(client) });
});

clientsRouter.patch("/:id", canEdit, validate({ params: idParams, body }), async (req, res) => {
  const { id } = req.valid.params as { id: string };
  const { name } = req.valid.body as z.infer<typeof body>;
  await checkDuplicate(name, id);
  const client = await ClientModel.findById(id);
  if (!client) throw notFound("Client not found");
  client.name = name;
  await client.save();
  res.json({ client: serializeClient(client, await ProjectModel.countDocuments({ client: id })) });
});

clientsRouter.delete("/:id", canEdit, validate({ params: idParams }), async (req, res) => {
  const { id } = req.valid.params as { id: string };
  const count = await ProjectModel.countDocuments({ client: id });
  if (count) throw conflict(`This client has ${count} project(s). Reassign or delete them first.`);
  if (!await ClientModel.findByIdAndDelete(id)) throw notFound("Client not found");
  res.status(204).end();
});

import { Router } from "express";
import type { Model } from "mongoose";
import { z } from "zod";
import { conflict, escapeRegex, notFound } from "../../lib/http.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { idParams, validate } from "../../middleware/validate.js";
import { CategoryModel, ProfileNameModel } from "../../models/Lookup.js";
import { ProjectModel } from "../../models/Project.js";

/**
 * Builds the CRUD router for an admin-managed name list.
 * Everyone signed in can read (needed for filters and project forms); only admins can change.
 */
function lookupRouter(LookupModel: Model<any>, projectField: "category" | "profileName", label: string) {
  const router = Router();
  router.use(requireAuth);

  const listQuery = z.object({ search: z.string().trim().optional() });

  router.get("/", validate({ query: listQuery }), async (req, res) => {
    const { search } = req.valid.query as z.infer<typeof listQuery>;
    const filter = search ? { name: new RegExp(escapeRegex(search), "i") } : {};
    const [items, usage] = await Promise.all([
      LookupModel.find(filter).sort({ name: 1 }),
      ProjectModel.aggregate<{ _id: unknown; count: number }>([{ $group: { _id: `$${projectField}`, count: { $sum: 1 } } }]),
    ]);
    const counts = new Map(usage.map((u) => [String(u._id), u.count]));
    res.json({ items: items.map((i) => ({ ...i.toJSON(), projectCount: counts.get(i.id) ?? 0 })) });
  });

  const body = z.object({ name: z.string().trim().min(1, `${label} is required`).max(80) });

  router.post("/", requireRole("admin"), validate({ body }), async (req, res) => {
    const { name } = req.valid.body as z.infer<typeof body>;
    if (await LookupModel.exists({ key: name.toLowerCase() })) throw conflict(`${label} "${name}" already exists`);
    const item = await LookupModel.create({ name, createdBy: req.user!._id });
    res.status(201).json({ item });
  });

  router.patch("/:id", requireRole("admin"), validate({ params: idParams, body }), async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const { name } = req.valid.body as z.infer<typeof body>;
    if (await LookupModel.exists({ key: name.toLowerCase(), _id: { $ne: id } })) {
      throw conflict(`${label} "${name}" already exists`);
    }
    const item = await LookupModel.findById(id);
    if (!item) throw notFound(`${label} not found`);
    item.set({ name });
    await item.save();
    res.json({ item });
  });

  router.delete("/:id", requireRole("admin"), validate({ params: idParams }), async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const inUse = await ProjectModel.countDocuments({ [projectField]: id });
    if (inUse) throw conflict(`This ${label.toLowerCase()} is used by ${inUse} project(s). Reassign them first.`);
    const item = await LookupModel.findByIdAndDelete(id);
    if (!item) throw notFound(`${label} not found`);
    res.status(204).end();
  });

  return router;
}

export const categoriesRouter = lookupRouter(CategoryModel, "category", "Category");
export const profileNamesRouter = lookupRouter(ProfileNameModel, "profileName", "Profile name");

import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { badRequest, escapeRegex, notFound, pageMeta, paginate } from "../../lib/http.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { idParams, objectId, validate } from "../../middleware/validate.js";
import { ClientModel } from "../../models/Client.js";
import { projectInput, requireCurrentProjectFormat, type ProjectInput } from "./project-input.js";
import { CategoryModel, ProfileNameModel } from "../../models/Lookup.js";
import {
  CREDENTIAL_KINDS,
  ENVIRONMENTS,
  ProjectModel,
  RESOURCE_TYPES,
  SERVICE_LINES,
} from "../../models/Project.js";
import { sealNotes, sealResources, serializeProject, serializeProjectRow } from "./projects.service.js";
import { RESOURCE_TEMPLATES } from "./templates.js";

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

const canEdit = requireRole("operation", "admin");

const populateRefs = [
  { path: "client", select: "name" },
  { path: "profileName", select: "name" },
  { path: "category", select: "name" },
  { path: "createdBy", select: "name role" },
  { path: "updatedBy", select: "name role" },
];

/** Static options the project form needs: enums + resource templates. */
projectsRouter.get("/meta", (_req, res) => {
  res.json({
    serviceLines: SERVICE_LINES,
    resourceTypes: RESOURCE_TYPES,
    environments: ENVIRONMENTS,
    credentialKinds: CREDENTIAL_KINDS,
    templates: RESOURCE_TEMPLATES,
  });
});

// ---------- list ----------

const listQuery = z.object({
  search: z.string().trim().optional(),
  clientId: objectId.optional(),
  category: objectId.optional(),
  profileName: objectId.optional(),
  serviceLine: z.enum(SERVICE_LINES).optional(),
  tag: z.string().trim().optional(),
  expiring: z.enum(["true", "false"]).optional(),
  sort: z.enum(["updatedAt", "-updatedAt", "clientName", "-clientName", "createdAt", "-createdAt", "name", "-name"]).default("-updatedAt"),
  page: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().optional(),
});

projectsRouter.get("/", validate({ query: listQuery }), async (req, res) => {
  const q = req.valid.query as z.infer<typeof listQuery>;
  const { page, limit, skip } = paginate(q);

  const filter: Record<string, unknown> = {};
  if (q.clientId) filter.client = new Types.ObjectId(q.clientId);
  if (q.category) filter.category = new Types.ObjectId(q.category);
  if (q.profileName) filter.profileName = new Types.ObjectId(q.profileName);
  if (q.serviceLine) filter.serviceLine = q.serviceLine;
  if (q.tag) filter.tags = q.tag;
  if (q.expiring === "true") filter["resources.expiresAt"] = { $lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) };
  const search: Record<string, unknown> = {};
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), "i");
    const [profiles, categories] = await Promise.all([
      ProfileNameModel.find({ name: rx }).distinct("_id"),
      CategoryModel.find({ name: rx }).distinct("_id"),
    ]);
    search.$or = [
      { name: rx }, { clientName: rx }, { tags: rx }, { liveUrl: rx }, { repoUrl: rx },
      { "liveSites.label": rx }, { "liveSites.url": rx },
      { "repositories.label": rx }, { "repositories.url": rx },
      { "resources.title": rx }, { profileName: { $in: profiles } }, { category: { $in: categories } },
    ];
  }
  const sortField = q.sort.replace("-", "");
  const sortDir = q.sort.startsWith("-") ? -1 : 1;
  const [result] = await ProjectModel.aggregate([
    { $match: filter },
    { $project: { client: 1, name: 1, clientName: 1, profileName: 1, category: 1, serviceLine: 1, liveUrl: 1, repoUrl: 1, liveSites: 1, repositories: 1, tags: 1, "resources.title": 1, "resources.type": 1, "resources.template": 1, "resources.expiresAt": 1, updatedBy: 1, updatedAt: 1, createdAt: 1 } },
    { $lookup: { from: "clients", localField: "client", foreignField: "_id", as: "_client", pipeline: [{ $project: { name: 1 } }] } },
    { $set: { clientName: { $ifNull: [{ $arrayElemAt: ["$_client.name", 0] }, "$clientName"] }, name: { $ifNull: ["$name", "$clientName"] } } },
    { $match: search },
    { $facet: { items: [{ $sort: { [sortField]: sortDir, _id: 1 } }, { $skip: skip }, { $limit: limit }], total: [{ $count: "count" }] } },
  ]).collation({ locale: "en", strength: 2 });
  const rows = await ProjectModel.populate(result.items, populateRefs.filter(p => p.path !== "createdBy"));
  res.json({ items: rows.map(serializeProjectRow), meta: pageMeta(result.total[0]?.count ?? 0, page, limit) });
});

/** Resources whose renewal/expiry date falls within the next N days (or is already past). */
const expiringQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

projectsRouter.get("/expiring", validate({ query: expiringQuery }), async (req, res) => {
  const { days } = req.valid.query as z.infer<typeof expiringQuery>;
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const items = await ProjectModel.aggregate([
    { $unwind: "$resources" },
    { $match: { "resources.expiresAt": { $ne: null, $lte: until } } },
    { $sort: { "resources.expiresAt": 1 } },
    { $limit: 50 },
    { $lookup: { from: "clients", localField: "client", foreignField: "_id", as: "_client", pipeline: [{ $project: { name: 1 } }] } },
    {
      $project: {
        _id: 0,
        projectId: { $toString: "$_id" },
        clientName: { $ifNull: [{ $arrayElemAt: ["$_client.name", 0] }, "$clientName"] },
        projectName: { $ifNull: ["$name", "$clientName"] },
        resourceId: { $toString: "$resources._id" },
        resourceTitle: "$resources.title",
        resourceType: "$resources.type",
        environment: "$resources.environment",
        expiresAt: "$resources.expiresAt",
      },
    },
  ]);
  res.json({ items });
});

/** All tags in use, for the tag filter and autocomplete. */
projectsRouter.get("/tags", async (_req, res) => {
  const tags = await ProjectModel.distinct("tags");
  res.json({ items: (tags as string[]).sort() });
});

// ---------- detail ----------

projectsRouter.get("/:id", validate({ params: idParams }), async (req, res) => {
  const { id } = req.valid.params as { id: string };
  const project = await ProjectModel.findById(id).populate(populateRefs);
  if (!project) throw notFound("Project not found");
  res.json({ project: serializeProject(project) });
});

// ---------- create / update ----------

async function assertLookups(body: ProjectInput) {
  const [profile, category, client] = await Promise.all([
    ProfileNameModel.exists({ _id: body.profileName }),
    CategoryModel.exists({ _id: body.category }),
    ClientModel.exists({ _id: body.clientId }),
  ]);
  const details: Record<string, string[]> = {};
  if (!client) details.clientId = ["Client no longer exists"];
  if (!profile) details.profileName = ["Profile name no longer exists"];
  if (!category) details.category = ["Category no longer exists"];
  if (Object.keys(details).length) throw badRequest("Validation failed", details);
}

function toDocument(body: ProjectInput) {
  const { clientId, ...values } = body;
  return {
    ...values,
    client: clientId,
    liveUrl: body.liveSites[0]?.url ?? "",
    repoUrl: body.repositories[0]?.url ?? "",
    tags: [...new Set(body.tags)],
    notes: sealNotes(body.notes),
    resources: sealResources(body.resources),
  };
}

projectsRouter.post("/", canEdit, requireCurrentProjectFormat, validate({ body: projectInput }), async (req, res) => {
  const body = req.valid.body as ProjectInput;
  await assertLookups(body);
  const created = await ProjectModel.create({ ...toDocument(body), createdBy: req.user!._id, updatedBy: req.user!._id });
  const project = await ProjectModel.findById(created._id).populate(populateRefs);
  res.status(201).json({ project: serializeProject(project!) });
});

projectsRouter.put("/:id", canEdit, requireCurrentProjectFormat, validate({ params: idParams, body: projectInput }), async (req, res) => {
  const { id } = req.valid.params as { id: string };
  const body = req.valid.body as ProjectInput;
  await assertLookups(body);
  const project = await ProjectModel.findById(id);
  if (!project) throw notFound("Project not found");
  project.set({ ...toDocument(body), updatedBy: req.user!._id });
  await project.save();
  await project.populate(populateRefs);
  res.json({ project: serializeProject(project) });
});

projectsRouter.post("/:id/duplicate", canEdit, validate({ params: idParams }), async (req, res) => {
  const { id } = req.valid.params as { id: string };
  const source = await ProjectModel.findById(id).lean();
  if (!source) throw notFound("Project not found");
  const { _id, createdAt, updatedAt, ...rest } = source as Record<string, any>;
  const copy = await ProjectModel.create({
    ...rest,
    name: `${source.name.slice(0, 113)} (copy)`,
    // Fresh sub-document ids; encrypted values are copied as-is.
    resources: source.resources.map(({ _id: _r, ...r }: any) => ({
      ...r,
      credentials: r.credentials.map(({ _id: _c, ...c }: any) => ({ ...c, _id: new Types.ObjectId() })),
    })),
    createdBy: req.user!._id,
    updatedBy: req.user!._id,
  });
  await copy.populate(populateRefs);
  res.status(201).json({ project: serializeProject(copy) });
});

projectsRouter.delete("/:id", canEdit, validate({ params: idParams }), async (req, res) => {
  const { id } = req.valid.params as { id: string };
  const project = await ProjectModel.findByIdAndDelete(id);
  if (!project) throw notFound("Project not found");
  res.status(204).end();
});

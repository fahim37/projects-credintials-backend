import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { badRequest, escapeRegex, notFound, pageMeta, paginate } from "../../lib/http.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { idParams, objectId, validate } from "../../middleware/validate.js";
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
  category: objectId.optional(),
  profileName: objectId.optional(),
  serviceLine: z.enum(SERVICE_LINES).optional(),
  tag: z.string().trim().optional(),
  expiring: z.enum(["true", "false"]).optional(),
  sort: z.enum(["updatedAt", "-updatedAt", "clientName", "-clientName", "createdAt", "-createdAt"]).default("-updatedAt"),
  page: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().optional(),
});

projectsRouter.get("/", validate({ query: listQuery }), async (req, res) => {
  const q = req.valid.query as z.infer<typeof listQuery>;
  const { page, limit, skip } = paginate(q);

  const filter: Record<string, unknown> = {};
  if (q.category) filter.category = q.category;
  if (q.profileName) filter.profileName = q.profileName;
  if (q.serviceLine) filter.serviceLine = q.serviceLine;
  if (q.tag) filter.tags = q.tag;
  if (q.expiring === "true") {
    filter["resources.expiresAt"] = { $lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) };
  }
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), "i");
    const [profiles, categories] = await Promise.all([
      ProfileNameModel.find({ name: rx }).distinct("_id"),
      CategoryModel.find({ name: rx }).distinct("_id"),
    ]);
    filter.$or = [
      { clientName: rx },
      { tags: rx },
      { liveUrl: rx },
      { "resources.title": rx },
      { profileName: { $in: profiles } },
      { category: { $in: categories } },
    ];
  }

  const sortField = q.sort.replace("-", "");
  const sortDir = q.sort.startsWith("-") ? -1 : 1;

  const [rows, total] = await Promise.all([
    ProjectModel.find(filter)
      .select("clientName profileName category serviceLine liveUrl tags resources.type resources.template resources.expiresAt updatedBy updatedAt")
      .populate(populateRefs.filter((p) => p.path !== "createdBy"))
      .sort({ [sortField]: sortDir, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ProjectModel.countDocuments(filter),
  ]);

  res.json({ items: rows.map(serializeProjectRow), meta: pageMeta(total, page, limit) });
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
    {
      $project: {
        _id: 0,
        projectId: { $toString: "$_id" },
        clientName: 1,
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

const optionalUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "Must start with http:// or https://")
  .optional()
  .default("");

const credentialInput = z.object({
  label: z.string().trim().min(1, "Field name is required").max(100),
  value: z.string().max(20_000).default(""),
  kind: z.enum(CREDENTIAL_KINDS).default("text"),
});

const resourceInput = z.object({
  title: z.string().trim().min(1, "Resource name is required").max(120),
  type: z.enum(RESOURCE_TYPES).default("Other"),
  template: z.string().trim().max(40).optional(),
  environment: z.enum(ENVIRONMENTS).default("production"),
  url: optionalUrl,
  notes: z.string().max(20_000).optional().default(""),
  expiresAt: z.coerce.date().nullable().optional(),
  credentials: z.array(credentialInput).max(100).default([]),
});

const projectInput = z.object({
  clientName: z.string().trim().min(1, "Client name is required").max(120),
  profileName: objectId,
  category: objectId,
  serviceLine: z.enum(SERVICE_LINES),
  liveUrl: optionalUrl,
  repoUrl: optionalUrl,
  tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(20).default([]),
  notes: z.string().max(20_000).optional().default(""),
  resources: z.array(resourceInput).max(100).default([]),
});

type ProjectInput = z.infer<typeof projectInput>;

async function assertLookups(body: ProjectInput) {
  const [profile, category] = await Promise.all([
    ProfileNameModel.exists({ _id: body.profileName }),
    CategoryModel.exists({ _id: body.category }),
  ]);
  const details: Record<string, string[]> = {};
  if (!profile) details.profileName = ["Profile name no longer exists"];
  if (!category) details.category = ["Category no longer exists"];
  if (Object.keys(details).length) throw badRequest("Validation failed", details);
}

function toDocument(body: ProjectInput) {
  return {
    ...body,
    tags: [...new Set(body.tags)],
    notes: sealNotes(body.notes),
    resources: sealResources(body.resources),
  };
}

projectsRouter.post("/", canEdit, validate({ body: projectInput }), async (req, res) => {
  const body = req.valid.body as ProjectInput;
  await assertLookups(body);
  const created = await ProjectModel.create({ ...toDocument(body), createdBy: req.user!._id, updatedBy: req.user!._id });
  const project = await ProjectModel.findById(created._id).populate(populateRefs);
  res.status(201).json({ project: serializeProject(project!) });
});

projectsRouter.put("/:id", canEdit, validate({ params: idParams, body: projectInput }), async (req, res) => {
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
    clientName: `${source.clientName} (copy)`,
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

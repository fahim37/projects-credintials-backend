import type { RequestHandler } from "express";
import { z } from "zod";
import { conflict } from "../../lib/http.js";
import { objectId } from "../../middleware/validate.js";
import { CREDENTIAL_KINDS, ENVIRONMENTS, RESOURCE_TYPES, SERVICE_LINES } from "../../models/Project.js";

export const optionalUrl = z.string().trim().max(2048).refine(v => !v || /^https?:\/\/\S+$/i.test(v), "Must start with http:// or https://").optional().default("");
const linkInput = z.object({ label: z.string().trim().max(120), url: z.string().trim().max(2048) }).superRefine((v, ctx) => {
  if (!v.label && !v.url) return;
  if (!v.label) ctx.addIssue({ code: "custom", path: ["label"], message: "Link label is required" });
  let valid = false;
  try { const url = new URL(v.url); valid = ["http:", "https:"].includes(url.protocol) && !!url.hostname; } catch {}
  if (!valid) ctx.addIssue({ code: "custom", path: ["url"], message: "Enter an http:// or https:// URL" });
});
export const linkList = z.array(linkInput).max(100).transform(rows => rows.filter(r => r.label || r.url));
export const projectInput = z.object({
  clientId: objectId,
  name: z.string().trim().min(1, "Project name is required").max(120),
  profileName: objectId,
  category: objectId,
  serviceLine: z.enum(SERVICE_LINES),
  liveSites: linkList,
  repositories: linkList,
  tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(20).default([]),
  notes: z.string().max(20_000).optional().default(""),
  resources: z.array(z.object({
    title: z.string().trim().min(1, "Resource name is required").max(120),
    type: z.enum(RESOURCE_TYPES).default("Other"),
    template: z.string().trim().max(40).nullish().transform(v => v ?? undefined),
    environment: z.enum(ENVIRONMENTS).default("production"),
    url: optionalUrl,
    notes: z.string().max(20_000).optional().default(""),
    expiresAt: z.coerce.date().nullable().optional(),
    credentials: z.array(z.object({
      label: z.string().trim().min(1, "Field name is required").max(100),
      value: z.string().max(20_000).default(""),
      kind: z.enum(CREDENTIAL_KINDS).default("text"),
    })).max(100).default([]),
  })).max(100).default([]),
});
export type ProjectInput = z.infer<typeof projectInput>;

export const requireCurrentProjectFormat: RequestHandler = (req, _res, next) => {
  if (req.body && ("clientName" in req.body || "liveUrl" in req.body || "repoUrl" in req.body) && !("clientId" in req.body && "liveSites" in req.body && "repositories" in req.body)) {
    throw conflict("The project form has been updated. Refresh this page before saving; your saved project has not changed.");
  }
  next();
};

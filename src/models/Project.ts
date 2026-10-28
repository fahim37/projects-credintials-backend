import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

export const SERVICE_LINES = ["App", "FSD", "Both"] as const;

export const RESOURCE_TYPES = [
  "Website",
  "VPS",
  "Hosting",
  "Domain",
  "Database",
  "Cloud Storage",
  "Cloud Provider",
  "App Store",
  "Play Store",
  "Repository",
  "Design",
  "Email",
  "Payment",
  "API",
  "Other",
] as const;

export const ENVIRONMENTS = ["production", "staging", "development"] as const;

/** How a credential value is shown/edited in the UI. */
export const CREDENTIAL_KINDS = ["text", "secret", "url", "email", "multiline"] as const;

/**
 * One label/value pair inside a resource, e.g. { label: "VPS Password", value: "enc:v1:...", kind: "secret" }.
 * `value` is ALWAYS stored encrypted (see lib/crypto.ts); the projects service seals it on write
 * and opens it on read.
 */
const credentialSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    value: { type: String, default: "" },
    kind: { type: String, enum: CREDENTIAL_KINDS, default: "text" },
  },
  { _id: true },
);

/** A deployable/accessible thing that belongs to a project: a VPS, a Cloudinary account, a Figma file... */
const resourceSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: RESOURCE_TYPES, default: "Other" },
    // Template key the resource was created from (e.g. "cloudinary"); drives the icon in the UI.
    template: { type: String, trim: true },
    environment: { type: String, enum: ENVIRONMENTS, default: "production" },
    url: { type: String, trim: true },
    credentials: { type: [credentialSchema], default: [] },
    // Notes may contain sensitive context, so they are encrypted too.
    notes: { type: String },
    // Renewal / expiry date for domains, hosting, SSL, developer accounts...
    expiresAt: { type: Date },
  },
  { _id: true },
);

const projectSchema = new Schema(
  {
    clientName: { type: String, required: true, trim: true },
    profileName: { type: Schema.Types.ObjectId, ref: "ProfileName", required: true, index: true },
    category: { type: Schema.Types.ObjectId, ref: "Category", required: true, index: true },
    serviceLine: { type: String, enum: SERVICE_LINES, required: true, index: true },
    liveUrl: { type: String, trim: true },
    repoUrl: { type: String, trim: true },
    tags: { type: [String], default: [] },
    // Project-wide notes, encrypted like resource notes.
    notes: { type: String },
    resources: { type: [resourceSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

projectSchema.index({ clientName: 1 });
projectSchema.index({ tags: 1 });
projectSchema.index({ updatedAt: -1 });
projectSchema.index({ "resources.expiresAt": 1 });

export type Project = InferSchemaType<typeof projectSchema>;
export type ProjectDoc = HydratedDocument<Project>;
export const ProjectModel = model("Project", projectSchema);

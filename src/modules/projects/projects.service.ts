import { decrypt, encrypt, needsRotation } from "../../lib/crypto.js";
import type { ProjectDoc } from "../../models/Project.js";

type CredentialInput = { label: string; value: string; kind: string };
type ResourceInput = {
  title: string;
  type: string;
  template?: string;
  environment: string;
  url?: string;
  notes?: string;
  expiresAt?: Date | null;
  credentials: CredentialInput[];
};

const seal = (v: string | undefined | null) => (v ? encrypt(v) : undefined);
const open = (v: string | undefined | null) => (v ? decrypt(v) : "");

/** Encrypts every credential value and note before the project is written. */
export function sealResources(resources: ResourceInput[]) {
  return resources.map((r) => ({
    ...r,
    notes: seal(r.notes),
    expiresAt: r.expiresAt ?? undefined,
    credentials: r.credentials.map((c) => ({ ...c, value: encrypt(c.value ?? "") })),
  }));
}

export const sealNotes = seal;

export type PlainResource = Omit<ResourceInput, "template" | "url" | "notes" | "expiresAt" | "credentials"> & {
  id: string;
  template: string | null;
  url: string;
  notes: string;
  expiresAt: Date | null;
  credentials: (CredentialInput & { id: string })[];
};

/** Plain JSON for the detail/edit screens, with every secret decrypted. */
export function serializeProject(doc: ProjectDoc) {
  const p = doc.toObject({ versionKey: false }) as Record<string, any>;
  return {
    id: String(p._id),
    clientName: p.clientName,
    profileName: lookupRef(p.profileName),
    category: lookupRef(p.category),
    serviceLine: p.serviceLine,
    liveUrl: p.liveUrl ?? "",
    repoUrl: p.repoUrl ?? "",
    tags: p.tags ?? [],
    notes: open(p.notes),
    resources: ((p.resources ?? []) as any[]).map((r): PlainResource => ({
      id: String(r._id),
      title: r.title,
      type: r.type,
      template: r.template ?? null,
      environment: r.environment,
      url: r.url ?? "",
      notes: open(r.notes),
      expiresAt: r.expiresAt ?? null,
      credentials: (r.credentials ?? []).map((c: any) => ({
        id: String(c._id),
        label: c.label,
        kind: c.kind,
        value: open(c.value),
      })),
    })),
    createdBy: userRef(p.createdBy),
    updatedBy: userRef(p.updatedBy),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** Lightweight row for the list table: no secrets leave the server here. */
export function serializeProjectRow(p: Record<string, any>) {
  const soon = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const expiries = (p.resources ?? [])
    .map((r: any) => r.expiresAt && new Date(r.expiresAt).getTime())
    .filter(Boolean) as number[];
  return {
    id: String(p._id),
    clientName: p.clientName,
    profileName: lookupRef(p.profileName),
    category: lookupRef(p.category),
    serviceLine: p.serviceLine,
    liveUrl: p.liveUrl ?? "",
    tags: p.tags ?? [],
    resourceCount: p.resources?.length ?? 0,
    resourceTypes: [...new Set((p.resources ?? []).map((r: any) => r.template ?? r.type))],
    nextExpiry: expiries.length ? new Date(Math.min(...expiries)) : null,
    expiringSoon: expiries.some((t) => t <= soon),
    updatedBy: userRef(p.updatedBy),
    updatedAt: p.updatedAt,
  };
}

/** True if any stored value was sealed with an old key (used by the key-rotation script). */
export function projectNeedsRotation(doc: ProjectDoc) {
  const values = [doc.notes, ...doc.resources.flatMap((r) => [r.notes, ...r.credentials.map((c) => c.value)])];
  return values.some((v) => v && needsRotation(v));
}

function lookupRef(v: any) {
  if (!v) return null;
  if (typeof v === "object" && "name" in v) return { id: String(v._id), name: v.name };
  return { id: String(v), name: "" };
}

function userRef(v: any) {
  if (!v) return null;
  if (typeof v === "object" && "name" in v) return { id: String(v._id), name: v.name, role: v.role };
  return { id: String(v), name: "", role: "" };
}

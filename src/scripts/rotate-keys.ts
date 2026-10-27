import { connectDb, disconnectDb } from "../config/db.js";
import { ProjectModel } from "../models/Project.js";
import { sealNotes, sealResources, projectNeedsRotation, serializeProject } from "../modules/projects/projects.service.js";

/**
 * Re-encrypts every project still sealed with an older key.
 * Usage: put the new key FIRST in ENCRYPTION_KEYS (keep the old one after it), run this,
 * then remove the old key once it reports 0 remaining.
 */
await connectDb();

let rotated = 0;
for await (const project of ProjectModel.find()) {
  if (!projectNeedsRotation(project)) continue;
  const plain = serializeProject(project);
  project.set({
    notes: sealNotes(plain.notes),
    resources: sealResources(
      plain.resources.map((r) => ({ ...r, template: r.template ?? undefined, expiresAt: r.expiresAt })),
    ),
  });
  await project.save({ timestamps: false });
  rotated++;
}

console.log(`Re-encrypted ${rotated} project(s).`);
await disconnectDb();

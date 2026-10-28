import { Types, type mongo } from "mongoose";
import { clientKey } from "../../models/Client.js";

/** Raw collection updates intentionally leave credentials, subdocument IDs and timestamps untouched. */
export async function migrateClients(db: mongo.Db, apply = false) {
  const clients = await db.collection("clients").find().toArray();
  const projects = await db.collection("projects").find().sort({ createdAt: 1, _id: 1 }).toArray();
  const byKey = new Map(clients.map(c => [c.key, c]));
  const byId = new Map(clients.map(c => [String(c._id), c]));
  const newClients: mongo.Document[] = [];
  const assignments: { projectId: string; clientName: string; projectName: string; liveSites: number; repositories: number; changed: boolean }[] = [];
  const updates: { id: mongo.Document["_id"]; key: string; set: mongo.Document }[] = [];
  const usedNames = new Map<string, Set<string>>();
  for (const p of projects) {
    if (p.client && p.name) {
      const names = usedNames.get(String(p.client)) ?? new Set<string>();
      names.add(p.name);
      usedNames.set(String(p.client), names);
    }
  }
  for (const p of projects) {
    let client = p.client ? byId.get(String(p.client)) : undefined;
    if (!client) {
      const name = String(p.clientName ?? "").trim();
      if (!name) throw new Error(`Project ${p._id} has no client name; fix it before migrating.`);
      const key = clientKey(name);
      client = byKey.get(key);
      if (!client) {
        client = { _id: new Types.ObjectId(), name, key, createdAt: p.createdAt ?? new Date(), updatedAt: p.createdAt ?? new Date() };
        byKey.set(key, client);
        byId.set(String(client._id), client);
        newClients.push(client);
      }
    }
    const set: mongo.Document = {};
    if (!p.client || String(p.client) !== String(client._id)) set.client = client._id;
    let name = p.name;
    if (!name) {
      const base = p.serviceLine === "Both" ? "App & web project" : `${p.serviceLine} project`;
      const names = usedNames.get(String(client._id)) ?? new Set<string>();
      name = base;
      for (let n = 2; names.has(name); n++) name = `${base} ${n}`;
      names.add(name);
      usedNames.set(String(client._id), names);
      set.name = name;
    }
    if (!Array.isArray(p.liveSites)) set.liveSites = p.liveUrl ? [{ label: "Main site", url: p.liveUrl }] : [];
    if (!Array.isArray(p.repositories)) set.repositories = p.repoUrl ? [{ label: "Main repository", url: p.repoUrl }] : [];
    const changed = Object.keys(set).length > 0;
    assignments.push({ projectId: String(p._id), clientName: client.name, projectName: name, liveSites: (set.liveSites ?? p.liveSites).length, repositories: (set.repositories ?? p.repositories).length, changed });
    if (changed) updates.push({ id: p._id, key: client.key, set });
  }
  if (apply) {
    await db.collection("clients").createIndex({ key: 1 }, { unique: true });
    for (const client of newClients) {
      await db.collection("clients").updateOne({ key: client.key }, { $setOnInsert: client }, { upsert: true });
    }
    const saved = await db.collection("clients").find().toArray();
    const ids = new Map(saved.map(c => [c.key, c._id]));
    for (const u of updates) {
      if (u.set.client) u.set.client = ids.get(u.key);
      await db.collection("projects").updateOne({ _id: u.id }, { $set: u.set });
    }
  }
  return { mode: apply ? "applied" : "dry-run", projectCount: projects.length, clientsToCreate: newClients.map(c => ({ name: c.name, key: c.key })), projectsToUpdate: updates.length, assignments };
}

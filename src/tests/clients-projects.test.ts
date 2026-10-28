import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import mongoose, { Types } from "mongoose";
import { createApp } from "../app.js";
import { env } from "../config/env.js";
import { encrypt } from "../lib/crypto.js";
import { signSession } from "../lib/jwt.js";
import { ClientModel } from "../models/Client.js";
import { CategoryModel, ProfileNameModel } from "../models/Lookup.js";
import { ProjectModel } from "../models/Project.js";
import { UserModel } from "../models/User.js";
import { migrateClients } from "../modules/clients/migrate-clients.js";

test("clients, named projects, links and legacy migration", { timeout: 90000 }, async t => {
  // Never run fixture writes or cleanup against the configured application database.
  const dbName = `pmtest_clients_${Date.now().toString(36)}_${process.pid}`;
  await mongoose.connect(env.MONGODB_URI, { dbName });
  const db = mongoose.connection.db!;
  assert.equal(db.databaseName, dbName);
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api`;
  try {
    await Promise.all([ClientModel.init(), UserModel.init(), CategoryModel.init(), ProfileNameModel.init()]);
    await t.test("migration dry run, case-insensitive grouping, numbering and idempotency preserve ciphertext and timestamps", async () => {
      const date = new Date("2025-01-01T00:00:00Z");
      const secret = encrypt("fixture-secret");
      const resources = [{ _id: new Types.ObjectId(), title: "Server", type: "VPS", environment: "production", credentials: [{ _id: new Types.ObjectId(), label: "Password", value: secret, kind: "secret" }], notes: secret }];
      const fixture = [
        { _id: new Types.ObjectId(), clientName: " Buyer ", serviceLine: "FSD", profileName: new Types.ObjectId(), liveUrl: "https://buyer.example", repoUrl: "https://github.com/example/buyer", resources, notes: secret, createdAt: date, updatedAt: date },
        { _id: new Types.ObjectId(), clientName: "buyer", serviceLine: "FSD", profileName: new Types.ObjectId(), resources: [], createdAt: date, updatedAt: date },
        { _id: new Types.ObjectId(), clientName: "Buyer Two", serviceLine: "Both", resources: [], createdAt: date, updatedAt: date },
        { _id: new Types.ObjectId(), clientName: "Buyer", name: "Already named", serviceLine: "App", liveSites: [], repositories: [], liveUrl: "https://old.example", resources: [], createdAt: date, updatedAt: date },
      ];
      await db.collection("projects").insertMany(fixture);
      const preview = await migrateClients(db);
      assert.equal(preview.clientsToCreate.length, 2);
      assert.equal(preview.projectsToUpdate, 4);
      assert.equal(await ClientModel.countDocuments(), 0);
      assert.equal((await db.collection("projects").findOne({ _id: fixture[0]!._id }))!.client, undefined);
      await migrateClients(db, true);
      const second = await migrateClients(db, true);
      assert.equal(second.projectsToUpdate, 0);
      assert.equal(second.clientsToCreate.length, 0);
      const saved = await db.collection("projects").findOne({ _id: fixture[0]!._id });
      assert.ok(saved);
      assert.deepEqual(saved.resources, resources);
      assert.equal(saved.notes, secret);
      assert.deepEqual(saved.updatedAt, date);
      assert.deepEqual(saved.createdAt, date);
      assert.deepEqual(saved.liveSites, [{ label: "Main site", url: fixture[0]!.liveUrl }]);
      assert.deepEqual(saved.repositories, [{ label: "Main repository", url: fixture[0]!.repoUrl }]);
      const buyerProjects = await db.collection("projects").find({ client: saved.client }).toArray();
      assert.equal(buyerProjects.length, 3);
      assert.deepEqual(buyerProjects.map(p => p.name).sort(), ["Already named", "FSD project", "FSD project 2"]);
      assert.deepEqual((await db.collection("projects").findOne({ _id: fixture[3]!._id }))!.liveSites, []);
      assert.equal((await db.collection("projects").findOne({ _id: fixture[2]!._id }))!.name, "App & web project");
      await db.collection("projects").deleteMany({});
      await db.collection("clients").deleteMany({});
    });

    const users = await UserModel.create((["admin", "operation", "sales"] as const).map(role => ({ name: role, role, status: "approved" as const, employeeId: `fixture-${role}`, email: `${role}@fixture.invalid`, passwordHash: "unused-test-hash" })));
    const tokens = Object.fromEntries(users.map(user => [user.role, signSession({ sub: user.id, role: user.role, tv: user.tokenVersion })]));
    async function request(method: string, path: string, body?: unknown, role = "operation") {
      const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${tokens[role]}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: response.status === 204 ? undefined : await response.json() };
    }
    const category = await CategoryModel.create({ name: "Development" });
    const profile = await ProfileNameModel.create({ name: "Profile One" });
    const otherProfile = await ProfileNameModel.create({ name: "Profile Two" });
    let clientId: string;
    let projectId: string;
    const draft = { name: "Delivery Platform", profileName: profile.id, category: category.id, serviceLine: "FSD", liveSites: [{ label: "Admin", url: "https://admin.example.com" }, { label: "Rider", url: "https://rider.example.com" }, { label: "", url: "" }], repositories: [{ label: "Frontend", url: "https://github.com/example/frontend" }, { label: "Backend", url: "https://github.com/example/backend" }], tags: [], notes: "Private note", resources: [{ title: "Server", type: "VPS", template: null, environment: "production", expiresAt: new Date().toISOString(), credentials: [{ label: "Password", value: "secret-value", kind: "secret" }] }] };

    await t.test("create clients, reject normalized duplicates and enforce permissions", async () => {
      const created = await request("POST", "/clients", { name: " Acme " });
      assert.equal(created.status, 201); clientId = created.data.client.id;
      assert.equal(created.data.client.name, "Acme");
      const duplicate = await request("POST", "/clients", { name: "ACME" });
      assert.equal(duplicate.status, 409);
      assert.equal(duplicate.data.details.existingClientId[0], clientId);
      assert.equal((await request("POST", "/clients", { name: "Forbidden" }, "sales")).status, 403);
      assert.equal((await request("GET", "/clients", undefined, "sales")).status, 200);
      assert.equal((await fetch(base + "/clients")).status, 401);
    });

    await t.test("multiple projects across profiles, ordered links and encrypted resources", async () => {
      const created = await request("POST", "/projects", { ...draft, clientId });
      assert.equal(created.status, 201, JSON.stringify(created.data)); projectId = created.data.project.id;
      assert.equal(created.data.project.liveSites.length, 2);
      assert.equal(created.data.project.repositories.length, 2);
      assert.equal(created.data.project.resources[0].credentials[0].value, "secret-value");
      const raw = await ProjectModel.findById(projectId).lean();
      assert.ok(raw?.resources[0]?.credentials[0]?.value.startsWith("enc:"));
      const second = await request("POST", "/projects", { ...draft, clientId, name: "Mobile App", profileName: otherProfile.id, serviceLine: "App", liveSites: [], repositories: [], resources: [] });
      assert.equal(second.status, 201);
      const count = await request("GET", `/clients/${clientId}`);
      assert.equal(count.data.client.projectCount, 2);
      assert.equal((await request("DELETE", `/clients/${clientId}`)).status, 409);
      assert.equal((await request("POST", "/projects", { ...draft, clientId }, "sales")).status, 403);
      assert.equal((await request("PATCH", `/clients/${clientId}`, { name: "Forbidden" }, "sales")).status, 403);
      assert.equal((await request("DELETE", `/clients/${clientId}`, undefined, "sales")).status, 403);
    });

    await t.test("link validation, outdated-form protection, list search and pre-pagination sorting", async () => {
      for (const link of [{ label: "", url: "https://valid.example" }, { label: "Bad", url: "javascript:alert(1)" }, { label: "Bad", url: "https://" }]) assert.equal((await request("POST", "/projects", { ...draft, clientId, liveSites: [link] })).status, 400);
      const legacy = await request("PUT", `/projects/${projectId}`, { clientName: "Acme", liveUrl: "https://old.example", repoUrl: "" });
      assert.equal(legacy.status, 409); assert.match(legacy.data.message, /Refresh/);
      assert.equal((await request("GET", `/projects/${projectId}`)).data.project.liveSites.length, 2);
      for (const search of ["Delivery", "Acme", "Rider", "rider.example", "Backend", "github.com/example/backend"]) {
        const result = await request("GET", `/projects?clientId=${clientId}&search=${encodeURIComponent(search)}`);
        assert.ok(result.data.items.some((p: { id: string }) => p.id === projectId), search);
        assert.ok(!JSON.stringify(result.data).includes("secret-value"));
      }
      const sorted = await request("GET", `/projects?clientId=${clientId}&sort=-name&limit=1&page=1`);
      assert.equal(sorted.data.items[0].name, "Mobile App"); assert.equal(sorted.data.meta.total, 2);
      assert.equal((await request("GET", `/projects?clientId=${clientId}&sort=-name&limit=1&page=2`)).data.items[0].name, "Delivery Platform");
      const other = await request("POST", "/clients", { name: "Zulu" }, "admin");
      await request("POST", "/projects", { ...draft, clientId: other.data.client.id, name: "Aardvark" });
      assert.equal((await request("GET", "/projects?sort=clientName&limit=1")).data.items[0].clientName, "Acme");
      assert.equal((await request("GET", "/clients?search=acme&limit=1")).data.meta.total, 1);
    });

    await t.test("rename reflects in every view and renewal; duplication and reassignment preserve project independence", async () => {
      assert.equal((await request("PATCH", `/clients/${clientId}`, { name: "Renamed Buyer" })).status, 200);
      assert.equal((await request("GET", `/projects/${projectId}`)).data.project.clientName, "Renamed Buyer");
      assert.equal((await request("GET", `/projects?clientId=${clientId}`)).data.items[0].clientName, "Renamed Buyer");
      assert.ok((await request("GET", "/projects/expiring")).data.items.some((p: { clientName: string; projectName: string }) => p.clientName === "Renamed Buyer" && p.projectName === "Delivery Platform"));
      const copy = await request("POST", `/projects/${projectId}/duplicate`);
      assert.equal(copy.status, 201); assert.equal(copy.data.project.client.id, clientId); assert.equal(copy.data.project.name, "Delivery Platform (copy)");
      assert.equal(copy.data.project.repositories.length, 2);
      const other = await request("POST", "/clients", { name: "New Buyer" });
      const updated = await request("PUT", `/projects/${projectId}`, { ...draft, clientId: other.data.client.id, liveSites: [{ label: "Public site", url: "https://public.example" }], repositories: [] });
      assert.equal(updated.status, 200);
      assert.equal(updated.data.project.client.id, other.data.client.id);
      assert.equal(updated.data.project.liveSites.length, 1); assert.deepEqual(updated.data.project.repositories, []);
      assert.equal((await request("GET", `/clients/${clientId}`)).data.client.projectCount, 2);
      assert.equal((await request("GET", `/projects/${copy.data.project.id}`)).data.project.liveSites.length, 2);
      await request("DELETE", `/projects/${projectId}`);
      assert.equal((await request("DELETE", `/clients/${other.data.client.id}`)).status, 204);
    });
  } finally {
    server.close();
    server.closeAllConnections();
    try {
      assert.ok(db.databaseName.startsWith("pmtest_clients_"));
      await db.dropDatabase();
    } finally { await mongoose.disconnect(); }
  }
});

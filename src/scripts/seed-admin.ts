import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { connectDb, disconnectDb } from "../config/db.js";
import { UserModel } from "../models/User.js";

/** Creates the first admin from ADMIN_* env vars. Safe to re-run: skips if the email exists. */
if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
  console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first.");
  process.exit(1);
}

await connectDb();

const existing = await UserModel.findOne({ email: env.ADMIN_EMAIL.toLowerCase() });
if (existing) {
  console.log(`Admin ${existing.email} already exists (role: ${existing.role}). Nothing to do.`);
} else {
  await UserModel.create({
    name: env.ADMIN_NAME,
    employeeId: env.ADMIN_EMPLOYEE_ID,
    email: env.ADMIN_EMAIL,
    passwordHash: await bcrypt.hash(env.ADMIN_PASSWORD, 12),
    role: "admin",
    status: "approved",
  });
  console.log(`Admin ${env.ADMIN_EMAIL} created.`);
}

await disconnectDb();

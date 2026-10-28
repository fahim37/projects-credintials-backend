import { connectDb, disconnectDb } from "../config/db.js";
import mongoose from "mongoose";
import { migrateClients } from "../modules/clients/migrate-clients.js";

try {
  await connectDb();
  const report = await migrateClients(mongoose.connection.db!, process.argv.includes("--apply"));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await disconnectDb();
}

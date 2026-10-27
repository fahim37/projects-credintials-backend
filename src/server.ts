import { env } from "./config/env.js";
import { connectDb, disconnectDb } from "./config/db.js";
import { createApp } from "./app.js";

await connectDb();

const app = createApp();
const onListen = () => console.log(`API listening on http://${env.HOST ?? "localhost"}:${env.PORT}`);
const server = env.HOST ? app.listen(env.PORT, env.HOST, onListen) : app.listen(env.PORT, onListen);

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close();
  await disconnectDb();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

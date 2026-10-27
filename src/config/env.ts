import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(5000),
  // e.g. 127.0.0.1 in production so the API is only reachable through the frontend proxy.
  HOST: z.string().optional(),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),

  // Comma separated list of origins allowed to call the API directly.
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  COOKIE_NAME: z.string().default("pm_session"),
  // Defaults to true in production. Set "false" only while the app is served over plain HTTP (no domain/TLS yet).
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),

  // Base64 encoded 32-byte keys. Format: "<version>:<base64key>,<version>:<base64key>".
  // The first entry is used for new writes; the rest are kept so old values can still be read.
  ENCRYPTION_KEYS: z.string().min(1, "ENCRYPTION_KEYS is required"),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default("SCALEUP <no-reply@scaleup.local>"),

  OTP_TTL_MINUTES: z.coerce.number().default(10),

  ADMIN_NAME: z.string().default("Admin"),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_EMPLOYEE_ID: z.string().default("ADMIN-001"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";

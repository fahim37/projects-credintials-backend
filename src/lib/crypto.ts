import crypto from "node:crypto";
import { env } from "../config/env.js";

/**
 * Field-level encryption for stored credentials.
 *
 * Ciphertext format: "enc:<keyVersion>:<iv b64>:<authTag b64>:<ciphertext b64>"
 * Every value carries the version of the key that sealed it, so keys can be rotated:
 * put the new key first in ENCRYPTION_KEYS, keep the old one after it, and run
 * `npm run rotate:keys` (or just re-save projects) to re-encrypt.
 */

const ALGO = "aes-256-gcm";
const PREFIX = "enc";

type Keyring = { current: string; keys: Map<string, Buffer> };

function loadKeyring(): Keyring {
  const keys = new Map<string, Buffer>();
  let current = "";
  for (const entry of env.ENCRYPTION_KEYS.split(",").map((s) => s.trim()).filter(Boolean)) {
    const idx = entry.indexOf(":");
    if (idx <= 0) throw new Error(`ENCRYPTION_KEYS entry must look like "v1:<base64>"`);
    const version = entry.slice(0, idx);
    const key = Buffer.from(entry.slice(idx + 1), "base64");
    if (key.length !== 32) throw new Error(`Encryption key "${version}" must decode to 32 bytes`);
    if (!current) current = version;
    keys.set(version, key);
  }
  if (!current) throw new Error("ENCRYPTION_KEYS has no keys");
  return { current, keys };
}

const keyring = loadKeyring();

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, keyring.keys.get(keyring.current)!, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, keyring.current, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decrypt(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 5 || parts[0] !== PREFIX) throw new Error("Value is not encrypted");
  const [, version, iv, tag, ct] = parts;
  const key = keyring.keys.get(version!);
  if (!key) throw new Error(`Unknown encryption key version "${version}"`);
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(iv!, "base64"));
  decipher.setAuthTag(Buffer.from(tag!, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct!, "base64")), decipher.final()]).toString("utf8");
}

export function isEncrypted(value: string) {
  return value.startsWith(`${PREFIX}:`);
}

/** True when the value was sealed with an older key and should be re-encrypted. */
export function needsRotation(value: string) {
  return isEncrypted(value) && value.split(":")[1] !== keyring.current;
}

export function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function randomOtp(length = 6) {
  return crypto.randomInt(0, 10 ** length).toString().padStart(length, "0");
}

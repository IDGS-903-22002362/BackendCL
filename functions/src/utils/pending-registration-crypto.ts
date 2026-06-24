import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_SALT = "pending-registration-v1";

function getEncryptionKey(): Buffer {
  const secret =
    process.env.PENDING_REGISTRATION_SECRET || process.env.JWT_SECRET;

  if (!secret) {
    throw new Error(
      "PENDING_REGISTRATION_SECRET o JWT_SECRET no está configurado",
    );
  }

  return crypto.scryptSync(secret, KEY_SALT, 32);
}

export function encryptPendingPassword(password: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(password, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptPendingPassword(encryptedPayload: string): string {
  const key = getEncryptionKey();
  const payload = Buffer.from(encryptedPayload, "base64");

  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");
}

import crypto from "crypto";

const AES_ALGO = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const rawKey = process.env.DATA_ENCRYPTION_KEY;

  if (!rawKey) {
    throw new Error("DATA_ENCRYPTION_KEY is required for encryption at rest");
  }

  return crypto.createHash("sha256").update(rawKey).digest();
}

export function encryptAtRest(plainText: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(AES_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptAtRest(cipherPayload: string): string {
  const [ivB64, authTagB64, dataB64] = cipherPayload.split(":");

  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error("Invalid encrypted payload format");
  }

  const key = getEncryptionKey();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const encrypted = Buffer.from(dataB64, "base64");

  const decipher = crypto.createDecipheriv(AES_ALGO, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function maskField(value: string, visibleLast = 4, maskChar = "*"): string {
  if (visibleLast < 0) {
    return value;
  }

  const visible = visibleLast > 0 ? value.slice(-visibleLast) : "";
  const maskedLength = Math.max(0, value.length - visibleLast);

  return `${maskChar.repeat(maskedLength)}${visible}`;
}

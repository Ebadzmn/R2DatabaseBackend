import crypto from "crypto";
import { env } from "../config/env";
import { AppError } from "../utils/errors";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const rawKey = env.ENCRYPTION_KEY;
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, "hex");
  }
  // Ensure exactly 32 bytes using SHA-256 if not a 64-char hex
  return crypto.createHash("sha256").update(rawKey).digest();
}

export class EncryptionService {
  /**
   * Encrypts plaintext using AES-256-GCM
   * Returns formatted string: iv:authTag:ciphertext (in hex)
   */
  public static encrypt(plainText: string): string {
    if (!plainText) return plainText;
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plainText, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
  }

  /**
   * Decrypts ciphertext in iv:authTag:ciphertext format using AES-256-GCM
   */
  public static decrypt(encryptedData: string): string {
    if (!encryptedData) return encryptedData;
    const parts = encryptedData.split(":");
    if (parts.length !== 3) {
      throw new AppError("Malformed encrypted data format", 500, "INTERNAL_ERROR");
    }

    const [ivHex, authTagHex, cipherTextHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const key = getKey();

    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      throw new AppError("Invalid IV or authentication tag length", 500, "INTERNAL_ERROR");
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    try {
      let decrypted = decipher.update(cipherTextHex, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch {
      throw new AppError("Failed to decrypt data: Authentication tag verification failed", 500, "INTERNAL_ERROR");
    }
  }
}

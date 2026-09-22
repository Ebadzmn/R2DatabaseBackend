import { EncryptionService } from "../src/services/encryption.service";

describe("EncryptionService (AES-256-GCM)", () => {
  it("should successfully encrypt and decrypt a plaintext string", () => {
    const secret = "my_cloudflare_r2_secret_access_key_999";
    const encrypted = EncryptionService.encrypt(secret);

    expect(encrypted).toBeDefined();
    expect(encrypted).not.toEqual(secret);
    expect(encrypted.split(":")).toHaveLength(3); // iv:authTag:ciphertext

    const decrypted = EncryptionService.decrypt(encrypted);
    expect(decrypted).toEqual(secret);
  });

  it("should generate different ciphertexts and IVs for the same plaintext", () => {
    const text = "consistent_secret";
    const enc1 = EncryptionService.encrypt(text);
    const enc2 = EncryptionService.encrypt(text);

    expect(enc1).not.toEqual(enc2);
    expect(EncryptionService.decrypt(enc1)).toEqual(text);
    expect(EncryptionService.decrypt(enc2)).toEqual(text);
  });

  it("should fail and throw an error if the encrypted ciphertext or authTag is tampered with", () => {
    const secret = "tamper_protection_test";
    const encrypted = EncryptionService.encrypt(secret);
    const [iv, authTag, cipherText] = encrypted.split(":");

    // Tamper with ciphertext
    const tamperedCipher = cipherText.substring(0, cipherText.length - 2) + "aa";
    const tamperedPayload = `${iv}:${authTag}:${tamperedCipher}`;

    expect(() => {
      EncryptionService.decrypt(tamperedPayload);
    }).toThrow(/Authentication tag verification failed/);
  });
});

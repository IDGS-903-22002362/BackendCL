import {
  decryptPendingPassword,
  encryptPendingPassword,
} from "../src/utils/pending-registration-crypto";

describe("pending-registration-crypto", () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = "test-secret-for-pending-registration";
  });

  afterAll(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  it("encrypts and decrypts a password", () => {
    const password = "mi-password-segura-123";
    const encrypted = encryptPendingPassword(password);

    expect(encrypted).not.toBe(password);
    expect(decryptPendingPassword(encrypted)).toBe(password);
  });
});

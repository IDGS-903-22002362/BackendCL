import {
  APPLE_REVIEW_TEST_EMAIL,
  isAppleReviewTestEmail,
} from "../src/lib/auth/apple-review-credentials";

describe("isAppleReviewTestEmail", () => {
  it("matches the Apple review email case-insensitively", () => {
    expect(isAppleReviewTestEmail(APPLE_REVIEW_TEST_EMAIL)).toBe(true);
    expect(isAppleReviewTestEmail("Cliente@Gmail.com")).toBe(true);
    expect(isAppleReviewTestEmail("  cliente@gmail.com  ")).toBe(true);
  });

  it("rejects other emails", () => {
    expect(isAppleReviewTestEmail("otro@gmail.com")).toBe(false);
    expect(isAppleReviewTestEmail("cliente@gmail.com.mx")).toBe(false);
    expect(isAppleReviewTestEmail("")).toBe(false);
  });
});

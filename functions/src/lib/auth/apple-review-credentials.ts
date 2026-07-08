export const APPLE_REVIEW_TEST_EMAIL = "cliente@gmail.com";

export function isAppleReviewTestEmail(email: string): boolean {
  return email.trim().toLowerCase() === APPLE_REVIEW_TEST_EMAIL;
}

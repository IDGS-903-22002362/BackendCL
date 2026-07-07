jest.mock("../src/config/app.firebase", () => ({
  firestoreApp: {
    collection: jest.fn(() => ({
      doc: jest.fn(),
    })),
  },
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    firestore: {
      Timestamp: {
        now: jest.fn(),
      },
    },
  },
}));

import { IdempotencyRepository } from "../src/modules/loyalty/repositories/idempotency.repository";

describe("IdempotencyRepository", () => {
  it("builds Firestore-safe document ids when operation contains slashes", () => {
    const repo = new IdempotencyRepository();

    const docId = repo.buildDocId(
      "admin/adjustments",
      "season-pass-verifier",
      "abc123",
    );

    expect(docId).toBe("admin%2Fadjustments:season-pass-verifier:abc123");
    expect(docId).not.toContain("/");
  });
});

const mockOnDocumentCreated = jest.fn();
const mockProcessQueuedJob = jest.fn();
const mockAssertAiConfig = jest.fn();

jest.mock("firebase-functions/v2/firestore", () => ({
  onDocumentCreated: mockOnDocumentCreated,
}));

jest.mock("../src/services/ai/jobs/tryon-workflow.service", () => ({
  __esModule: true,
  default: {
    processQueuedJob: mockProcessQueuedJob,
  },
}));

jest.mock("../src/config/ai.config", () => ({
  assertAiConfig: mockAssertAiConfig,
}));

describe("AI try-on trigger", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOnDocumentCreated.mockImplementation((_options, handler) => handler);
  });

  it("configura el trigger para la base tiendacl y procesa el job creado", async () => {
    let processTryOnJobTrigger:
      | ((event: {
          params: { jobId: string };
          database: string;
          document: string;
        }) => Promise<void>)
      | undefined;

    jest.isolateModules(() => {
      ({ processTryOnJobTrigger } = require("../src/services/ai/jobs/tryon-processor.trigger"));
    });

    expect(mockOnDocumentCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        document: "tryon_jobs/{jobId}",
        database: "tiendacl",
      }),
      expect.any(Function),
    );

    expect(processTryOnJobTrigger).toBeDefined();

    await processTryOnJobTrigger?.({
      params: { jobId: "job_123" },
      database: "tiendacl",
      document: "tryon_jobs/job_123",
    });

    expect(mockAssertAiConfig).toHaveBeenCalledWith({
      requireGemini: false,
      requireTryOn: true,
    });
    expect(mockProcessQueuedJob).toHaveBeenCalledWith("job_123");
  });
});

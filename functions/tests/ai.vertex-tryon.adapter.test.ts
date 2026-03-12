jest.mock("../src/config/ai.config", () => ({
  __esModule: true,
  default: {
    tryOn: {
      project: "e-comerce-leon",
      region: "us-central1",
      endpointPublisher: "google",
      model: "virtual-try-on-001",
      timeoutMs: 2500,
    },
  },
}));

jest.mock("google-auth-library", () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({
    getClient: jest.fn().mockResolvedValue({
      getAccessToken: jest.fn().mockResolvedValue({ token: "test-access-token" }),
    }),
  })),
}));

import vertexTryOnAdapter, {
  VertexTryOnError,
} from "../src/services/ai/adapters/vertex-tryon.adapter";

describe("Vertex try-on adapter", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("construye la llamada oficial a Vertex y parsea bytes base64", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          predictions: [
            {
              bytesBase64Encoded: "ZmFrZS1pbWFnZQ==",
              mimeType: "image/png",
              jobId: "provider-job-1",
            },
          ],
        }),
      ),
    });

    const result = await vertexTryOnAdapter.runTryOn({
      personImageUri: "gs://e-comerce-leon-ai-private/ai/uploads/user_1/person.png",
      garmentImageUri: "gs://e-comerce-leon.appspot.com/productos/jersey.png",
      outputGcsUri: "gs://e-comerce-leon-ai-private/ai/tryon-results/user_1/session_1",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];

    expect(url).toBe(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/e-comerce-leon/locations/us-central1/publishers/google/models/virtual-try-on-001:predict",
    );
    expect(options.headers.Authorization).toBe("Bearer test-access-token");

    const payload = JSON.parse(String(options.body));
    expect(payload.instances[0].personImage.image.gcsUri).toBe(
      "gs://e-comerce-leon-ai-private/ai/uploads/user_1/person.png",
    );
    expect(payload.instances[0].productImages[0].image.gcsUri).toBe(
      "gs://e-comerce-leon.appspot.com/productos/jersey.png",
    );
    expect(payload.parameters.sampleCount).toBe(1);
    expect(payload.parameters.storageUri).toBe(
      "gs://e-comerce-leon-ai-private/ai/tryon-results/user_1/session_1/",
    );

    expect(result).toMatchObject({
      providerJobId: "provider-job-1",
      outputImageBytesBase64: "ZmFrZS1pbWFnZQ==",
      mimeType: "image/png",
    });
  });

  it("mapea quota exceeded a un error controlado", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 429,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          error: {
            message: "Quota exceeded",
          },
        }),
      ),
    });

    await expect(
      vertexTryOnAdapter.runTryOn({
        personImageUri: "gs://bucket/person.png",
        garmentImageUri: "gs://bucket/garment.png",
      }),
    ).rejects.toMatchObject({
      code: "VERTEX_QUOTA_EXCEEDED",
      message: "Quota exceeded",
    } satisfies Partial<VertexTryOnError>);
  });

  it("mapea timeout del fetch a un error controlado", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(
      new DOMException("Aborted", "AbortError"),
    );

    await expect(
      vertexTryOnAdapter.runTryOn({
        personImageUri: "gs://bucket/person.png",
        garmentImageUri: "gs://bucket/garment.png",
      }),
    ).rejects.toMatchObject({
      code: "VERTEX_TIMEOUT",
    } satisfies Partial<VertexTryOnError>);
  });
});

import plantillaService from "../src/services/plantilla.service";

// Mock the firebase config
jest.mock("../src/config/firebase", () => ({
  storageTienda: {
    bucket: () => ({
      getFiles: jest.fn(),
      name: "test-bucket",
    }),
  },
}));

describe("PlantillaService", () => {
  it("should get photos for a given ID", async () => {
    const service = plantillaService as any;
    const mockGetFiles = service.bucket.getFiles as jest.Mock;

    const id = "12345";
    const files = [
      { name: `plantilla/${id}/foto1.jpg` },
      { name: `plantilla/${id}/foto2.png` },
      { name: `plantilla/${id}/not-image.txt` },
    ];
    // Mock the response of getFiles
    // getFiles returns [files, nextQuery, apiResponse]
    mockGetFiles.mockResolvedValue([files]);

    const result = await plantillaService.getFotosPorId(id);

    expect(mockGetFiles).toHaveBeenCalledWith({
      prefix: `plantilla/${id}/`,
    });

    expect(result).toHaveProperty(id);
    expect(result[id]).toHaveLength(2);
    expect(result[id]).toContain(
      "https://storage.googleapis.com/test-bucket/plantilla/12345/foto1.jpg"
    );
    expect(result[id]).toContain(
      "https://storage.googleapis.com/test-bucket/plantilla/12345/foto2.png"
    );
  });
});

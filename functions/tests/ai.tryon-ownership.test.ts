jest.mock("../src/services/ai/jobs/tryon-workflow.service", () => ({
  __esModule: true,
  default: {
    getJobStatus: jest.fn(),
    getDownloadUrl: jest.fn(),
  },
}));

import { Request, Response } from "express";
import { RolUsuario } from "../src/models/usuario.model";
import * as tryonController from "../src/controllers/ai/tryon.controller";
import tryOnWorkflowService from "../src/services/ai/jobs/tryon-workflow.service";

const mockedWorkflow = tryOnWorkflowService as jest.Mocked<
  typeof tryOnWorkflowService
>;

const createResponse = (): Response => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };

  return res as unknown as Response;
};

describe("AI try-on ownership", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("bloquea descarga de job ajeno para cliente", async () => {
    mockedWorkflow.getJobStatus.mockResolvedValue({
      id: "job_1",
      userId: "other_user",
      status: "completed",
    } as never);

    const req = {
      params: { id: "job_1" },
      user: { uid: "user_1", rol: RolUsuario.CLIENTE },
    } as unknown as Request;
    const res = createResponse();

    await tryonController.getTryOnDownloadLink(req, res);

    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(403);
    expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({
      success: false,
    });
    expect(mockedWorkflow.getDownloadUrl).not.toHaveBeenCalled();
  });

  it("permite descarga al admin aunque el job pertenezca a otro usuario", async () => {
    mockedWorkflow.getJobStatus.mockResolvedValue({
      id: "job_1",
      userId: "other_user",
      status: "completed",
    } as never);
    mockedWorkflow.getDownloadUrl.mockResolvedValue("https://signed.example/job_1");

    const req = {
      params: { id: "job_1" },
      user: { uid: "admin_1", rol: RolUsuario.ADMIN },
    } as unknown as Request;
    const res = createResponse();

    await tryonController.getTryOnDownloadLink(req, res);

    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(200);
    expect(mockedWorkflow.getDownloadUrl).toHaveBeenCalledWith("job_1");
  });
});

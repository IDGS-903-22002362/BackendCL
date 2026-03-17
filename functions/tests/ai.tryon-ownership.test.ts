jest.mock("../src/services/ai/jobs/tryon-workflow.service", () => ({
  __esModule: true,
  default: {
    createJob: jest.fn(),
    getJobStatus: jest.fn(),
    getDownloadUrl: jest.fn(),
  },
}));

import { Request, Response } from "express";
import {
  ProductPreviewMode,
  ProductPreviewType,
} from "../src/models/ai/ai.model";
import { RolUsuario } from "../src/models/usuario.model";
import * as tryonController from "../src/controllers/ai/tryon.controller";
import tryOnWorkflowService from "../src/services/ai/jobs/tryon-workflow.service";
import { AiRuntimeError } from "../src/services/ai/ai.error";

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

  it("expone previewMode al crear job y errores estables al fallar", async () => {
    mockedWorkflow.createJob.mockResolvedValueOnce({
      id: "job_preview",
      userId: "user_1",
      sessionId: "session_1",
      productId: "prod_cap",
      status: "queued",
      previewMode: ProductPreviewMode.ACCESSORY_MOCKUP,
      productPreviewType: ProductPreviewType.ACCESSORY,
    } as never);

    const okReq = {
      body: {
        sessionId: "session_1",
        productId: "prod_cap",
        userImageAssetId: "asset_1",
        consentAccepted: true,
      },
      user: { uid: "user_1", rol: RolUsuario.CLIENTE },
    } as unknown as Request;
    const okRes = createResponse();

    await tryonController.createTryOnJob(okReq, okRes);

    expect((okRes.status as jest.Mock).mock.calls[0][0]).toBe(201);
    expect((okRes.json as jest.Mock).mock.calls[0][0]).toMatchObject({
      success: true,
      data: {
        previewMode: ProductPreviewMode.ACCESSORY_MOCKUP,
      },
    });

    mockedWorkflow.createJob.mockRejectedValueOnce(
      new AiRuntimeError(
        "PRODUCT_PREVIEW_UNSUPPORTED",
        "Producto no compatible",
        400,
      ),
    );

    const errorReq = {
      body: {
        sessionId: "session_1",
        productId: "prod_unknown",
        userImageAssetId: "asset_1",
        consentAccepted: true,
      },
      user: { uid: "user_1", rol: RolUsuario.CLIENTE },
    } as unknown as Request;
    const errorRes = createResponse();

    await tryonController.createTryOnJob(errorReq, errorRes);

    expect((errorRes.status as jest.Mock).mock.calls[0][0]).toBe(400);
    expect((errorRes.json as jest.Mock).mock.calls[0][0]).toMatchObject({
      success: false,
      error: {
        code: "PRODUCT_PREVIEW_UNSUPPORTED",
        message: "Producto no compatible",
      },
    });
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
    expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({
      success: true,
      data: {
        jobId: "job_1",
        url: "https://signed.example/job_1",
      },
    });
  });

  it("retorna error controlado si no puede generar la signed URL", async () => {
    mockedWorkflow.getJobStatus.mockResolvedValue({
      id: "job_1",
      userId: "user_1",
      status: "completed",
    } as never);
    mockedWorkflow.getDownloadUrl.mockRejectedValue(new Error("signBlob denied"));

    const req = {
      params: { id: "job_1" },
      user: { uid: "user_1", rol: RolUsuario.CLIENTE },
    } as unknown as Request;
    const res = createResponse();

    await tryonController.getTryOnDownloadLink(req, res);

    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(500);
    expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({
      success: false,
      message: "No se pudo generar el link de descarga del try-on",
    });
  });
});

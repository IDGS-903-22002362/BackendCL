const axiosCreate = jest.fn();

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    create: axiosCreate,
  },
  AxiosError: class AxiosError extends Error {
    code?: string;
    response?: { status?: number; data?: unknown };
  },
}));

import aplazoProvider from "../src/services/payments/providers/aplazo.provider";
import { PaymentStatus } from "../src/services/payments/payment-status.enum";

const buildClientMock = () => ({
  post: jest.fn(),
  get: jest.fn(),
  request: jest.fn(),
});

describe("Aplazo provider", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    process.env.APLAZO_ENABLED = "true";
    process.env.APLAZO_ONLINE_ENABLED = "true";
    process.env.APLAZO_INSTORE_ENABLED = "true";

    process.env.APLAZO_ONLINE_BASE_URL = "https://api.aplazo.net/api";
    process.env.APLAZO_ONLINE_MERCHANT_BASE_URL =
      "https://merchant.aplazo.net/api";
    process.env.APLAZO_ONLINE_REFUNDS_BASE_URL =
      "https://refunds-bifrost.aplazo.net/api";
    process.env.APLAZO_ONLINE_AUTH_PATH = "/auth";
    process.env.APLAZO_ONLINE_CREATE_PATH = "/loan";
    process.env.APLAZO_ONLINE_STATUS_PATH = "/v1/loan/status";
    process.env.APLAZO_ONLINE_REFUND_PATH = "/loan/refund-from-cart";
    process.env.APLAZO_ONLINE_REFUND_STATUS_PATH =
      "/v1/merchant/refund/status";
    process.env.APLAZO_ONLINE_MERCHANT_ID = "merchant_online";
    process.env.APLAZO_ONLINE_API_TOKEN = "token_online";
    process.env.APLAZO_ONLINE_WEBHOOK_SECRET = "secret_online";
    process.env.APLAZO_ONLINE_WEBHOOK_AUTH_SCHEME = "Bearer";
    process.env.APLAZO_ONLINE_TIMEOUT_MS = "15000";

    process.env.APLAZO_INSTORE_BASE_URL = "https://api.aplazo.net";
    process.env.APLAZO_INSTORE_MERCHANT_BASE_URL =
      "https://merchant.aplazo.net";
    process.env.APLAZO_INSTORE_CREATE_PATH = "/api/pos/loan";
    process.env.APLAZO_INSTORE_STATUS_PATH = "/api/pos/loan/{cartId}";
    process.env.APLAZO_INSTORE_CANCEL_PATH = "/api/pos/loan/cancel";
    process.env.APLAZO_INSTORE_REFUND_PATH = "/api/pos/loan/refund";
    process.env.APLAZO_INSTORE_REFUND_STATUS_PATH =
      "/api/pos/loan/refund/{cartId}";
    process.env.APLAZO_INSTORE_MERCHANT_ID = "merchant_instore";
    process.env.APLAZO_INSTORE_API_TOKEN = "token_instore";
    process.env.APLAZO_INSTORE_WEBHOOK_SECRET = "secret_instore";
    process.env.APLAZO_INSTORE_WEBHOOK_AUTH_SCHEME = "Bearer";
    process.env.APLAZO_INSTORE_TIMEOUT_MS = "15000";
    process.env.APLAZO_INSTORE_DEFAULT_COMM_CHANNEL = "q";
  });

  it("authenticates online and maps create response using loanId and cartId", async () => {
    const authClient = buildClientMock();
    const createClient = buildClientMock();
    authClient.post.mockResolvedValue({
      data: { authorization: "Bearer online-token" },
    });
    createClient.request.mockResolvedValue({
      data: {
        loanId: "loan_987",
        cartId: "orden_123",
        url: "https://checkout.aplazo/loan_987",
        status: "No confirmado",
      },
    });
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(createClient);

    const result = await aplazoProvider.createOnline({
      paymentAttemptId: "attempt_1",
      idempotencyKey: "idem_12345678",
      amountMinor: 129900,
      currency: "mxn",
      providerReference: "orden_123",
      customerName: "Juan Perez",
      customerEmail: "juan@example.com",
      customerPhone: "4771234567",
      successUrl: "https://app/success",
      cancelUrl: "https://app/cancel",
      failureUrl: "https://app/failure",
      webhookUrl: "https://api/webhooks/aplazo",
      cartUrl: "https://app/cart",
      metadata: { sucursalId: "shop_1", cartId: "orden_123" },
      pricingSnapshot: {
        subtotalMinor: 129900,
        taxMinor: 0,
        shippingMinor: 0,
        totalMinor: 129900,
        currency: "mxn",
        items: [
          {
            productoId: "prod_1",
            cantidad: 1,
            precioUnitarioMinor: 129900,
            subtotalMinor: 129900,
          },
        ],
      },
    });

    expect(authClient.post).toHaveBeenCalledWith("/auth", {
      apiToken: "token_online",
      merchantId: "merchant_online",
    });
    expect(createClient.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "post",
        url: "/loan",
        headers: { Authorization: "Bearer online-token" },
      }),
    );
    expect(result.providerLoanId).toBe("loan_987");
    expect(result.providerReference).toBe("orden_123");
    expect(result.redirectUrl).toBe("https://checkout.aplazo/loan_987");
    expect(result.status).toBe(PaymentStatus.PENDING_CUSTOMER);
  });

  it("sends numeric merchantId to online auth when configured as digits", async () => {
    process.env.APLAZO_ONLINE_MERCHANT_ID = "2639";

    const authClient = buildClientMock();
    const createClient = buildClientMock();
    authClient.post.mockResolvedValue({
      data: { authorization: "Bearer online-token" },
    });
    createClient.request.mockResolvedValue({
      data: {
        loanId: "loan_987",
        cartId: "orden_123",
        url: "https://checkout.aplazo/loan_987",
        status: "No confirmado",
      },
    });
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(createClient);

    await aplazoProvider.createOnline({
      paymentAttemptId: "attempt_1",
      idempotencyKey: "idem_12345678",
      amountMinor: 129900,
      currency: "mxn",
      providerReference: "orden_123",
      customerName: "Juan Perez",
      customerEmail: "juan@example.com",
      customerPhone: "4771234567",
      successUrl: "https://app/success",
      cancelUrl: "https://app/cancel",
      failureUrl: "https://app/failure",
      webhookUrl: "https://api/webhooks/aplazo",
      cartUrl: "https://app/cart",
      metadata: { cartId: "orden_123" },
      pricingSnapshot: {
        subtotalMinor: 129900,
        taxMinor: 0,
        shippingMinor: 0,
        totalMinor: 129900,
        currency: "mxn",
        items: [
          {
            productoId: "prod_1",
            cantidad: 1,
            precioUnitarioMinor: 129900,
            subtotalMinor: 129900,
          },
        ],
      },
    });

    expect(authClient.post).toHaveBeenCalledWith("/auth", {
      apiToken: "token_online",
      merchantId: 2639,
    });
  });

  it("creates in-store payments with api_token and merchant_id headers", async () => {
    const createClient = buildClientMock();
    createClient.request.mockResolvedValue({
      data: {
        loanId: "loan_pos_1",
        cartId: "venta_pos_1",
        link: "https://aplazo/pos/venta_pos_1",
        qr: "qr_payload",
        qrImageUrl: "https://aplazo/qr/venta_pos_1.png",
        status: "No confirmado",
      },
    });
    axiosCreate.mockReturnValueOnce(createClient);

    const result = await aplazoProvider.createInStore({
      paymentAttemptId: "attempt_pos_1",
      idempotencyKey: "idem_pos_12345678",
      amountMinor: 85000,
      currency: "mxn",
      providerReference: "venta_pos_1",
      customerName: "Cliente POS",
      customerPhone: "4771234567",
      webhookUrl: "https://api/webhooks/aplazo",
      callbackUrl: "https://app/payments/aplazo/success",
      metadata: { sucursalId: "sucursal_1", commChannel: "q" },
      pricingSnapshot: {
        subtotalMinor: 85000,
        taxMinor: 0,
        shippingMinor: 0,
        totalMinor: 85000,
        currency: "mxn",
        items: [
          {
            productoId: "prod_1",
            cantidad: 1,
            precioUnitarioMinor: 85000,
            subtotalMinor: 85000,
          },
        ],
      },
    });

    expect(createClient.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "post",
        url: "/api/pos/loan",
        headers: {
          api_token: "token_instore",
          merchant_id: "merchant_instore",
        },
      }),
    );
    expect(result.providerLoanId).toBe("loan_pos_1");
    expect(result.providerReference).toBe("venta_pos_1");
    expect(result.paymentLink).toBe("https://aplazo/pos/venta_pos_1");
    expect(result.qrString).toBe("qr_payload");
  });

  it("queries online status by loanId and not by cartId when loanId exists", async () => {
    const authClient = buildClientMock();
    const merchantClient = buildClientMock();
    authClient.post.mockResolvedValue({
      data: { authorization: "Bearer online-token" },
    });
    merchantClient.get.mockResolvedValue({
      data: {
        loanId: "loan_123",
        cartId: "orden_123",
        status: "Activo",
        currency: "mxn",
        totalPrice: 1299,
      },
    });
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(merchantClient);

    const result = await aplazoProvider.getStatus({
      id: "attempt_1",
      ordenId: "orden_123",
      userId: "user_1",
      provider: "APLAZO" as any,
      metodoPago: "APLAZO" as any,
      monto: 1299,
      amountMinor: 129900,
      currency: "mxn",
      estado: "PENDIENTE" as any,
      flowType: "online" as any,
      idempotencyKey: "idem_123",
      createdAt: {} as any,
      updatedAt: {} as any,
      providerLoanId: "loan_123",
      providerReference: "orden_123",
    });

    expect(merchantClient.get).toHaveBeenCalledWith("/v1/loan/status", {
      params: { loanId: "loan_123" },
    });
    expect(result.status).toBe(PaymentStatus.PAID);
    expect(result.providerLoanId).toBe("loan_123");
    expect(result.providerReference).toBe("orden_123");
  });

  it("parses webhook using Authorization and merchantId to resolve the channel", async () => {
    const result = await aplazoProvider.parseWebhook({
      rawBody: Buffer.from(
        JSON.stringify({
          status: "Activo",
          loanId: "loan_987",
          cartId: "orden_123",
          merchantId: "merchant_online",
        }),
      ),
      headers: {
        authorization: "Bearer secret_online",
      },
    });

    expect(result.channel).toBe("online");
    expect(result.providerLoanId).toBe("loan_987");
    expect(result.providerReference).toBe("orden_123");
    expect(result.status).toBe(PaymentStatus.PAID);
  });

  it("rejects webhook authorization mismatches", async () => {
    await expect(
      aplazoProvider.parseWebhook({
        rawBody: Buffer.from(
          JSON.stringify({
            status: "Activo",
            loanId: "loan_987",
            cartId: "orden_123",
            merchantId: "merchant_online",
          }),
        ),
        headers: {
          authorization: "Bearer wrong_secret",
        },
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_WEBHOOK_INVALID_SIGNATURE",
    });
  });
});

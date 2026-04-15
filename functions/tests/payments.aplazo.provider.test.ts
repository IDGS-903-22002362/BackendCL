const axiosCreate = jest.fn();
const loggerInfo = jest.fn();
const loggerError = jest.fn();

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    create: axiosCreate,
  },
  AxiosError: class AxiosError extends Error {
    code?: string;
    config?: { url?: string };
    response?: {
      status?: number;
      data?: unknown;
      headers?: Record<string, unknown>;
    };
  },
}));

jest.mock("../src/utils/logger", () => {
  const loggerInstance = {
    child: () => ({
      info: loggerInfo,
      error: loggerError,
      debug: jest.fn(),
      warn: jest.fn(),
    }),
    info: loggerInfo,
    error: loggerError,
    debug: jest.fn(),
    warn: jest.fn(),
  };

  return {
    __esModule: true,
    default: loggerInstance,
    logger: loggerInstance,
  };
});

import aplazoProvider, {
  normalizeProviderError,
} from "../src/services/payments/providers/aplazo.provider";
import { PaymentStatus } from "../src/services/payments/payment-status.enum";
import {
  maskToken,
  normalizeEmail,
  normalizeMxPhoneForAplazo,
  sanitizeOutgoingProviderPayload,
} from "../src/services/payments/payment-sanitizer";

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
        data: expect.objectContaining({
          totalPrice: 1299,
          currency: "MXN",
          cartId: "orden_123",
          successUrl: "https://app/success",
          errorUrl: "https://app/failure",
          webHookUrl: "https://api/webhooks/aplazo",
          shipping: {
            price: 0,
            title: "Envio",
          },
          taxes: {
            price: 0,
            title: "IVA",
          },
          discount: {
            price: 0,
            title: "Descuento",
          },
          products: [
            {
              id: "prod_1",
              count: 1,
              description: "prod_1",
              title: "prod_1",
              price: 1299,
              imageUrl: undefined,
            },
          ],
          buyer: {
            firstName: "Juan",
            lastName: "Perez",
            email: "juan@example.com",
            phone: "4771234567",
          },
        }),
      }),
    );
    expect(loggerInfo).toHaveBeenCalledWith(
      "Aplazo request prepared",
      expect.objectContaining({
        channel: "online",
        paymentAttemptId: "attempt_1",
        providerReference: "orden_123",
        payload: expect.objectContaining({
          buyer: expect.objectContaining({
            phone: "***4567",
          }),
        }),
      }),
    );
    expect(loggerInfo).toHaveBeenCalledWith(
      "Aplazo response received",
      expect.objectContaining({
        providerHttpStatus: undefined,
        body: expect.objectContaining({
          loanId: "loan_987",
          cartId: "orden_123",
        }),
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

  it("keeps configured online merchantId as shopId even if metadata includes sucursalId", async () => {
    process.env.APLAZO_ONLINE_MERCHANT_ID = "3683";

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
      metadata: {
        cartId: "orden_123",
        sucursalId: "sucursal-1",
      },
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

    expect(createClient.request).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shopId: 3683,
        }),
      }),
    );
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

  it("maps short provider status codes", () => {
    expect(aplazoProvider.mapProviderStatus("PE")).toBe(
      PaymentStatus.PENDING_CUSTOMER,
    );
    expect(aplazoProvider.mapProviderStatus("CO")).toBe(PaymentStatus.PAID);
    expect(aplazoProvider.mapProviderStatus("CA")).toBe(
      PaymentStatus.CANCELED,
    );
  });

  it("normalizes mx phone and email for aplazo helpers", () => {
    expect(normalizeMxPhoneForAplazo("4771234567")).toBe("4771234567");
    expect(normalizeMxPhoneForAplazo("+52 477 123 4567")).toBe("4771234567");
    expect(normalizeMxPhoneForAplazo("(477) 123-4567")).toBe("4771234567");
    expect(normalizeMxPhoneForAplazo("123")).toBeUndefined();
    expect(normalizeEmail("  USER@Example.COM  ")).toBe("user@example.com");
  });

  it("maps provider 400 errors with real response details", async () => {
    const authClient = buildClientMock();
    const createClient = buildClientMock();
    authClient.post.mockResolvedValue({
      data: { authorization: "Bearer online-token" },
    });
    createClient.request.mockRejectedValue(
      Object.assign(new Error("Bad request"), {
        config: {
          url: "/loan",
        },
        response: {
          status: 400,
          headers: {
            authorization: "Bearer provider-secret",
            "x-request-id": "req-123",
          },
          data: { error: "invalid payload", reason: "cartId duplicated" },
        },
      }),
    );
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(createClient);

    await expect(
      aplazoProvider.createOnline({
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
        metadata: { cartId: "orden_123" },
        pricingSnapshot: {
          subtotalMinor: 129900,
          taxMinor: 0,
          shippingMinor: 0,
          totalMinor: 129900,
          currency: "MXN",
          items: [
            {
              productoId: "prod_1",
              cantidad: 1,
              precioUnitarioMinor: 129900,
              subtotalMinor: 129900,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      details: {
        providerHttpStatus: 400,
        providerUrl: "/loan",
        providerResponse: {
          error: "invalid payload",
          reason: "cartId duplicated",
        },
        providerHeaders: {
          authorization: "Bear***cret",
          "x-request-id": "req-123",
        },
      },
    });

    expect(loggerError).toHaveBeenCalledWith(
      "Aplazo request failed",
      expect.objectContaining({
        channel: "online",
        requestPayload: expect.objectContaining({
          buyer: expect.objectContaining({
            email: "ju***@example.com",
            phone: "***4567",
          }),
        }),
        details: expect.objectContaining({
          providerResponse: {
            error: "invalid payload",
            reason: "cartId duplicated",
          },
        }),
      }),
    );
  });

  it("maps timeout and network errors", async () => {
    const authClient = buildClientMock();
    const createClient = buildClientMock();
    authClient.post.mockResolvedValue({
      data: { authorization: "Bearer online-token" },
    });
    createClient.request
      .mockRejectedValueOnce(
        Object.assign(new Error("timeout"), {
          code: "ECONNABORTED",
        }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error("socket hang up"), {
          code: "ECONNRESET",
        }),
      );
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(createClient)
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(createClient);

    await expect(
      aplazoProvider.createOnline({
        paymentAttemptId: "attempt_timeout",
        idempotencyKey: "idem_timeout_123",
        amountMinor: 129900,
        currency: "mxn",
        providerReference: "orden_timeout",
        customerName: "Juan Perez",
        customerEmail: "juan@example.com",
        customerPhone: "4771234567",
        successUrl: "https://app/success",
        failureUrl: "https://app/failure",
        webhookUrl: "https://api/webhooks/aplazo",
        metadata: { cartId: "orden_timeout" },
        pricingSnapshot: {
          subtotalMinor: 129900,
          taxMinor: 0,
          shippingMinor: 0,
          totalMinor: 129900,
          currency: "MXN",
          items: [
            {
              productoId: "prod_1",
              cantidad: 1,
              precioUnitarioMinor: 129900,
              subtotalMinor: 129900,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_TIMEOUT",
      details: {
        providerUrl: "https://api.aplazo.net/api/loan",
      },
    });

    await expect(
      aplazoProvider.createOnline({
        paymentAttemptId: "attempt_network",
        idempotencyKey: "idem_network_123",
        amountMinor: 129900,
        currency: "mxn",
        providerReference: "orden_network",
        customerName: "Juan Perez",
        customerEmail: "juan@example.com",
        customerPhone: "4771234567",
        successUrl: "https://app/success",
        failureUrl: "https://app/failure",
        webhookUrl: "https://api/webhooks/aplazo",
        metadata: { cartId: "orden_network" },
        pricingSnapshot: {
          subtotalMinor: 129900,
          taxMinor: 0,
          shippingMinor: 0,
          totalMinor: 129900,
          currency: "MXN",
          items: [
            {
              productoId: "prod_1",
              cantidad: 1,
              precioUnitarioMinor: 129900,
              subtotalMinor: 129900,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_NETWORK_ERROR",
    });
  });

  it("rejects invalid customer email, phone, and empty products before calling aplazo", async () => {
    const authClient = buildClientMock();
    const createClient = buildClientMock();
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(createClient);

    await expect(
      aplazoProvider.createOnline({
        paymentAttemptId: "attempt_invalid_phone",
        idempotencyKey: "idem_invalid_phone",
        amountMinor: 1000,
        currency: "MXN",
        providerReference: "cart_1",
        customerName: " Juan   Perez ",
        customerEmail: "juan@example.com",
        customerPhone: "123",
        successUrl: "https://app/success",
        failureUrl: "https://app/failure",
        webhookUrl: "https://api/webhooks/aplazo",
        metadata: { cartId: "cart_1" },
        pricingSnapshot: {
          subtotalMinor: 1000,
          taxMinor: 0,
          shippingMinor: 0,
          totalMinor: 1000,
          currency: "MXN",
          items: [
            {
              productoId: "prod_1",
              cantidad: 1,
              precioUnitarioMinor: 1000,
              subtotalMinor: 1000,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_VALIDATION_ERROR",
      message: "Teléfono inválido para Aplazo",
    });

    await expect(
      aplazoProvider.createOnline({
        paymentAttemptId: "attempt_invalid_email",
        idempotencyKey: "idem_invalid_email",
        amountMinor: 1000,
        currency: "MXN",
        providerReference: "cart_2",
        customerName: " Juan   Perez ",
        customerEmail: "bad-email",
        customerPhone: "4771234567",
        successUrl: "https://app/success",
        failureUrl: "https://app/failure",
        webhookUrl: "https://api/webhooks/aplazo",
        metadata: { cartId: "cart_2" },
        pricingSnapshot: {
          subtotalMinor: 1000,
          taxMinor: 0,
          shippingMinor: 0,
          totalMinor: 1000,
          currency: "MXN",
          items: [
            {
              productoId: "prod_1",
              cantidad: 1,
              precioUnitarioMinor: 1000,
              subtotalMinor: 1000,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_VALIDATION_ERROR",
      message: "Email inválido para Aplazo",
    });

    await expect(
      aplazoProvider.createOnline({
        paymentAttemptId: "attempt_invalid_items",
        idempotencyKey: "idem_invalid_items",
        amountMinor: 1000,
        currency: "MXN",
        providerReference: "cart_3",
        customerName: "Juan Perez",
        customerEmail: "juan@example.com",
        customerPhone: "4771234567",
        successUrl: "https://app/success",
        failureUrl: "https://app/failure",
        webhookUrl: "https://api/webhooks/aplazo",
        metadata: { cartId: "cart_3" },
        pricingSnapshot: {
          subtotalMinor: 0,
          taxMinor: 0,
          shippingMinor: 0,
          totalMinor: 1000,
          currency: "MXN",
          items: [],
        },
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_VALIDATION_ERROR",
      message: "No fue posible construir products[] válidos para Aplazo",
    });

    expect(authClient.post).not.toHaveBeenCalled();
    expect(createClient.request).not.toHaveBeenCalled();
  });

  it("normalizes provider errors and sanitizes tokens", () => {
    const error = normalizeProviderError(
      Object.assign(new Error("Bad request"), {
        code: "ERR_BAD_REQUEST",
        config: { url: "/loan" },
        response: {
          status: 400,
          headers: {
            authorization: "Bearer provider-secret-token",
          },
          data: {
            apiToken: "provider-secret-token",
            error: "invalid payload",
          },
        },
      }),
      {
        requestPayload: {
          apiToken: "local-token-123456",
          buyer: {
            email: "test@example.com",
            phone: "4771234567",
          },
        },
      },
    );

    expect(error).toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      statusCode: 502,
      details: {
        providerHttpStatus: 400,
        providerUrl: "/loan",
        providerHeaders: {
          authorization: "Bear***oken",
        },
        providerResponse: {
          apiToken: "prov***oken",
          error: "invalid payload",
        },
        requestPayload: {
          apiToken: "loca***3456",
          buyer: {
            email: "te***@example.com",
            phone: "***4567",
          },
        },
      },
    });
    expect(maskToken("provider-secret-token")).toBe("prov***oken");
    expect(
      sanitizeOutgoingProviderPayload({
        Authorization: "Bearer provider-secret-token",
      }),
    ).toEqual({
      Authorization: "Bear***oken",
    });
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

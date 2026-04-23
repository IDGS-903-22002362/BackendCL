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
    jest.resetAllMocks();

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
    process.env.APLAZO_ONLINE_CANCEL_PATH = "/v1/merchant/loan/cancel";
    process.env.APLAZO_ONLINE_REFUND_PATH = "/loan/refund-from-cart";
    process.env.APLAZO_ONLINE_REFUND_STATUS_PATH =
      "/v1/merchant/refund/status";
    process.env.APLAZO_ONLINE_MERCHANT_ID = "2639";
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
      metadata: {
        sucursalId: "shop_1",
        cartId: "orden_123",
        addressLine: "Fake Street 123",
        postalCode: "99999",
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

    expect(authClient.post).toHaveBeenCalledWith("/auth", {
      apiToken: "token_online",
      merchantId: 2639,
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
          cartUrl: "https://app/cart",
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
            addressLine: "Fake Street 123",
            postalCode: "99999",
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

  it("preserves loanToken in sanitized create response", async () => {
    const authClient = buildClientMock();
    const createClient = buildClientMock();
    authClient.post.mockResolvedValue({
      data: { authorization: "Bearer online-token" },
    });
    createClient.request.mockResolvedValue({
      data: {
        loanId: 156123,
        loanToken: "1777a4f6-da5e-4787-9956-40467dd0c37e",
        url: "https://checkout.aplazo.net/main/1777a4f6-da5e-4787-9956-40467dd0c37e",
      },
    });
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(createClient);

    const result = await aplazoProvider.createOnline({
      paymentAttemptId: "attempt_loan_token",
      idempotencyKey: "idem_loan_token",
      amountMinor: 260000,
      currency: "mxn",
      providerReference: "cart-id-321",
      customerName: "John Doe",
      customerEmail: "john@doe.com",
      customerPhone: "5511113590",
      successUrl: "https://merchant-page.mx/Success_Aplazo/cartid1234.php",
      failureUrl: "https://merchant-page.mx/Error_Aplazo.php",
      webhookUrl: "https://merchant-page.mx/order/hook",
      cartUrl: "https://merchant-page.mx/Cart_Aplazo.php",
      metadata: {
        cartId: "cart-id-321",
        addressLine: "Fake Street 123",
        postalCode: "99999",
      },
      pricingSnapshot: {
        subtotalMinor: 260000,
        taxMinor: 0,
        shippingMinor: 0,
        totalMinor: 260000,
        currency: "mxn",
        items: [
          {
            productoId: "product-01",
            cantidad: 1,
            precioUnitarioMinor: 260000,
            subtotalMinor: 260000,
          },
        ],
      },
    });

    expect(result.providerLoanId).toBe("156123");
    expect(result.rawResponseSanitized).toMatchObject({
      loanId: 156123,
      loanToken: "1777***c37e",
      url: "https://checkout.aplazo.net/main/1777a4f6-da5e-4787-9956-40467dd0c37e",
    });
  });

  it("sends numeric merchantId to online auth when configured as digits string", async () => {
    process.env.APLAZO_ONLINE_MERCHANT_ID = " 2639 ";

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

  it("accepts auth token from Authorization response header", async () => {
    const authClient = buildClientMock();
    const createClient = buildClientMock();
    authClient.post.mockResolvedValue({
      data: {},
      headers: {
        Authorization: "Bearer header-token",
      },
    });
    createClient.request.mockResolvedValue({
      data: {
        loanId: "loan_987",
        cartId: "orden_123",
        url: "https://checkout.aplazo/loan_987",
      },
    });
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(createClient);

    await aplazoProvider.createOnline({
      paymentAttemptId: "attempt_header_auth",
      idempotencyKey: "idem_header_auth",
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
        addressLine: "Fake Street 123",
        postalCode: "99999",
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
        headers: { Authorization: "Bearer header-token" },
      }),
    );
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

  it("queries online status by loan_id and not by cart_id when loanId exists", async () => {
    const authClient = buildClientMock();
    const merchantClient = buildClientMock();
    authClient.post.mockResolvedValue({
      data: { authorization: "Bearer online-token" },
    });
    merchantClient.get.mockResolvedValue({
      data: {
        loanId: 151187,
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
      params: { loan_id: "loan_123" },
    });
    expect(result.status).toBe(PaymentStatus.PAID);
    expect(result.providerLoanId).toBe("151187");
    expect(result.providerReference).toBe("orden_123");
  });

  it("queries online status by cart_id when loanId is not available", async () => {
    const authClient = buildClientMock();
    const merchantClient = buildClientMock();
    authClient.post.mockResolvedValue({
      data: { authorization: "Bearer online-token" },
    });
    merchantClient.get.mockResolvedValue({
      data: {
        loanId: 151188,
        status: "No confirmado",
      },
    });
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(merchantClient);

    const result = await aplazoProvider.getStatus({
      id: "attempt_2",
      ordenId: "orden_456",
      userId: "user_1",
      provider: "APLAZO" as any,
      metodoPago: "APLAZO" as any,
      monto: 899,
      amountMinor: 89900,
      currency: "mxn",
      estado: "PENDIENTE" as any,
      flowType: "online" as any,
      idempotencyKey: "idem_456",
      createdAt: {} as any,
      updatedAt: {} as any,
      providerReference: "orden_456",
    });

    expect(merchantClient.get).toHaveBeenCalledWith("/v1/loan/status", {
      params: { cart_id: "orden_456" },
    });
    expect(result.status).toBe(PaymentStatus.PENDING_CUSTOMER);
    expect(result.providerLoanId).toBe("151188");
    expect(result.providerReference).toBe("orden_456");
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
        cartUrl: "https://app/cart",
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
        providerCode: "invalid payload",
        providerParams: {},
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

  it("maps outstanding loan duplicate error code from provider error field", async () => {
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
          data: {
            status: 0,
            error: "OUTSTANDING_LOAN_ALREADY_EXISTS",
            message:
              "Outstanding loan with cartId: cart-id-321 already exists",
          },
        },
      }),
    );
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(createClient);

    await expect(
      aplazoProvider.createOnline({
        paymentAttemptId: "attempt_dup_loan",
        idempotencyKey: "idem_dup_loan",
        amountMinor: 260000,
        currency: "mxn",
        providerReference: "cart-id-321",
        customerName: "John Doe",
        customerEmail: "john@doe.com",
        customerPhone: "5511113590",
        successUrl: "https://merchant-page.mx/Success_Aplazo/cartid1234.php",
        failureUrl: "https://merchant-page.mx/Error_Aplazo.php",
        webhookUrl: "https://merchant-page.mx/order/hook",
        cartUrl: "https://merchant-page.mx/Cart_Aplazo.php",
        metadata: {
          cartId: "cart-id-321",
        },
        pricingSnapshot: {
          subtotalMinor: 260000,
          taxMinor: 0,
          shippingMinor: 0,
          totalMinor: 260000,
          currency: "mxn",
          items: [
            {
              productoId: "product-01",
              cantidad: 1,
              precioUnitarioMinor: 260000,
              subtotalMinor: 260000,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: "Outstanding loan with cartId: cart-id-321 already exists",
      details: {
        providerHttpStatus: 400,
        providerCode: "OUTSTANDING_LOAN_ALREADY_EXISTS",
        providerUrl: "/loan",
      },
    });
  });

  it("maps auth 404 errors with provider context", async () => {
    const authClient = buildClientMock();
    const createClient = buildClientMock();
    authClient.post.mockRejectedValue(
      Object.assign(new Error("Not Found"), {
        config: {
          url: "/auth",
        },
        response: {
          status: 404,
          data: {
            timestamp: "2025-01-03T15:58:32.023+00:00",
            status: 404,
            error: "Not Found",
            path: "/api/auth",
          },
        },
      }),
    );
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(createClient);

    await expect(
      aplazoProvider.createOnline({
        paymentAttemptId: "attempt_auth_404",
        idempotencyKey: "idem_auth_404",
        amountMinor: 129900,
        currency: "mxn",
        providerReference: "orden_123",
        customerName: "Juan Perez",
        customerEmail: "juan@example.com",
        customerPhone: "4771234567",
        successUrl: "https://app/success",
        failureUrl: "https://app/failure",
        webhookUrl: "https://api/webhooks/aplazo",
        cartUrl: "https://app/cart",
        metadata: {
          cartId: "orden_123",
          addressLine: "Fake Street 123",
          postalCode: "99999",
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
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: "Not Found",
      details: {
        providerHttpStatus: 404,
        providerCode: "Not Found",
        providerUrl: "/auth",
        providerResponse: {
          timestamp: "2025-01-03T15:58:32.023+00:00",
          status: 404,
          error: "Not Found",
          path: "/api/auth",
        },
      },
    });
  });

  it("maps auth 400 errors with provider context", async () => {
    const authClient = buildClientMock();
    const createClient = buildClientMock();
    authClient.post.mockRejectedValue(
      Object.assign(new Error("Bad request"), {
        config: {
          url: "/auth",
        },
        response: {
          status: 400,
          data: {
            timestamp: "2025-01-03T15:58:32.023+00:00",
            status: 400,
            error: "Bad request",
            path: "/api/auth",
          },
        },
      }),
    );
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(createClient);

    await expect(
      aplazoProvider.createOnline({
        paymentAttemptId: "attempt_auth_400",
        idempotencyKey: "idem_auth_400",
        amountMinor: 129900,
        currency: "mxn",
        providerReference: "orden_123",
        customerName: "Juan Perez",
        customerEmail: "juan@example.com",
        customerPhone: "4771234567",
        successUrl: "https://app/success",
        failureUrl: "https://app/failure",
        webhookUrl: "https://api/webhooks/aplazo",
        cartUrl: "https://app/cart",
        metadata: {
          cartId: "orden_123",
          addressLine: "Fake Street 123",
          postalCode: "99999",
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
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: "Bad request",
      details: {
        providerHttpStatus: 400,
        providerCode: "Bad request",
        providerUrl: "/auth",
      },
    });
  });

  it("cancels online loan by cartId using refunds-bifrost GET endpoint", async () => {
    const authClient = buildClientMock();
    const refundsClient = buildClientMock();
    authClient.post.mockResolvedValue({
      data: { Authorization: "Bearer online-token" },
    });
    refundsClient.get.mockResolvedValue({
      data: {},
    });
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(refundsClient);

    const result = await aplazoProvider.cancelOrVoid({
      paymentAttempt: {
        id: "attempt_cancel_online",
        ordenId: "orden_123",
        userId: "user_1",
        provider: "APLAZO" as any,
        metodoPago: "APLAZO" as any,
        monto: 1299,
        amountMinor: 129900,
        currency: "mxn",
        estado: "PENDIENTE" as any,
        flowType: "online" as any,
        idempotencyKey: "idem_attempt_cancel_online",
        createdAt: {} as any,
        updatedAt: {} as any,
        providerReference: "cart-id-321",
        providerLoanId: "151187",
      },
      reason: "manual admin cancel",
    });

    expect(refundsClient.get).toHaveBeenCalledWith(
      "/v1/merchant/loan/cancel",
      {
        params: {
          cartId: "cart-id-321",
        },
      },
    );
    expect(result.status).toBe(PaymentStatus.CANCELED);
    expect(result.providerStatus).toBe("cancelado");
    expect(result.providerReference).toBe("cart-id-321");
  });

  it("preserves LOAN_BAD_STATUS when online cancel is rejected by provider", async () => {
    const authClient = buildClientMock();
    const refundsClient = buildClientMock();
    authClient.post.mockResolvedValue({
      data: { Authorization: "Bearer online-token" },
    });
    refundsClient.get.mockRejectedValue(
      Object.assign(new Error("LOAN BAD STATUS"), {
        config: {
          url: "/v1/merchant/loan/cancel",
        },
        response: {
          status: 400,
          data: {
            code: "LOAN_BAD_STATUS",
            data: {
              status: "CANCELLED",
            },
            error: "LOAN BAD STATUS",
            timestamp: 1734637318072,
            message: "LOAN BAD STATUS",
            path: "/api/v1/merchant/loan/cancel",
          },
        },
      }),
    );
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(refundsClient);

    await expect(
      aplazoProvider.cancelOrVoid({
        paymentAttempt: {
          id: "attempt_cancel_bad_status",
          ordenId: "orden_123",
          userId: "user_1",
          provider: "APLAZO" as any,
          metodoPago: "APLAZO" as any,
          monto: 1299,
          amountMinor: 129900,
          currency: "mxn",
          estado: "PENDIENTE" as any,
          flowType: "online" as any,
          idempotencyKey: "idem_attempt_cancel_bad_status",
          createdAt: {} as any,
          updatedAt: {} as any,
          providerReference: "cart-id-321",
        },
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: "LOAN BAD STATUS",
      details: {
        providerHttpStatus: 400,
        providerCode: "LOAN_BAD_STATUS",
        providerUrl: "/v1/merchant/loan/cancel",
        providerResponse: {
          code: "LOAN_BAD_STATUS",
          data: {
            status: "CANCELLED",
          },
          error: "LOAN BAD STATUS",
          timestamp: 1734637318072,
          message: "LOAN BAD STATUS",
          path: "/api/v1/merchant/loan/cancel",
        },
      },
    });
  });

  it("requests online refund by cartId with totalAmount and reason", async () => {
    process.env.APLAZO_REFUNDS_ENABLED = "true";
    const authClient = buildClientMock();
    const merchantClient = buildClientMock();
    authClient.post.mockResolvedValue({
      data: { Authorization: "Bearer online-token" },
    });
    merchantClient.request.mockResolvedValue({
      data: {
        refundId: 665,
        merchantId: 12,
        cartId: "merchant-cart-123",
        refundStatus: "REQUESTED",
        refundDate: "2022-09-05T21:11:34.091719",
      },
    });
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(merchantClient);

    const result = await aplazoProvider.refund({
      paymentAttempt: {
        id: "attempt_refund_online",
        ordenId: "orden_123",
        userId: "user_1",
        provider: "APLAZO" as any,
        metodoPago: "APLAZO" as any,
        monto: 1299,
        amountMinor: 129900,
        currency: "mxn",
        estado: "PAGADO" as any,
        flowType: "online" as any,
        idempotencyKey: "idem_attempt_refund_online",
        createdAt: {} as any,
        updatedAt: {} as any,
        providerReference: "merchant-cart-123",
        providerLoanId: "151187",
      },
      refundAmountMinor: 100,
      reason: "Wrong size",
    });

    expect(merchantClient.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "post",
        url: "/loan/refund-from-cart",
        headers: { Authorization: "Bearer online-token" },
        data: {
          cartId: "merchant-cart-123",
          totalAmount: 1,
          reason: "Wrong size",
        },
      }),
    );
    expect(result.refundId).toBe("665");
    expect(result.providerStatus).toBe("REQUESTED");
    expect(result.refundState).toBe("processing");
    expect(result.refundAmountMinor).toBe(100);
    expect(result.rawResponseSanitized).toMatchObject({
      refundId: 665,
      merchantId: 12,
      cartId: "merchant-cart-123",
      refundStatus: "REQUESTED",
      refundDate: "2022-09-05T21:11:34.091719",
    });
  });

  it("preserves provider context when online refund returns 500", async () => {
    process.env.APLAZO_REFUNDS_ENABLED = "true";
    const authClient = buildClientMock();
    const merchantClient = buildClientMock();
    authClient.post.mockResolvedValue({
      data: { Authorization: "Bearer online-token" },
    });
    merchantClient.request.mockRejectedValue(
      Object.assign(new Error("Internal Server Error"), {
        config: {
          url: "/loan/refund-from-cart",
        },
        response: {
          status: 500,
          data: {
            timestamp: "2025-01-06T18:20:20.811+00:00",
            status: 500,
            error: "Internal Server Error",
            message: "",
            path: "/api/loan/refund-from-cart",
          },
        },
      }),
    );
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(merchantClient);

    await expect(
      aplazoProvider.refund({
        paymentAttempt: {
          id: "attempt_refund_500",
          ordenId: "orden_123",
          userId: "user_1",
          provider: "APLAZO" as any,
          metodoPago: "APLAZO" as any,
          monto: 1299,
          amountMinor: 129900,
          currency: "mxn",
          estado: "PAGADO" as any,
          flowType: "online" as any,
          idempotencyKey: "idem_attempt_refund_500",
          createdAt: {} as any,
          updatedAt: {} as any,
          providerReference: "non-existant-cart",
        },
        refundAmountMinor: 15000,
        reason: "Refund_reason",
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: "Internal Server Error",
      details: {
        providerHttpStatus: 500,
        providerCode: "Internal Server Error",
        providerUrl: "/loan/refund-from-cart",
        providerResponse: {
          timestamp: "2025-01-06T18:20:20.811+00:00",
          status: 500,
          error: "Internal Server Error",
          message: "",
          path: "/api/loan/refund-from-cart",
        },
      },
    });
  });

  it("gets online refund status by cartId and selects the latest refund entry", async () => {
    process.env.APLAZO_REFUNDS_ENABLED = "true";
    const authClient = buildClientMock();
    const merchantClient = buildClientMock();
    authClient.post.mockResolvedValue({
      data: { Authorization: "Bearer online-token" },
    });
    merchantClient.get.mockResolvedValue({
      data: [
        {
          id: 25079,
          status: "PROCESSING",
          refundDate: "2024-12-19T17:45:03.59153",
          amount: 120,
        },
        {
          id: 25083,
          status: "PROCESSING",
          refundDate: "2024-12-19T17:49:33.910913",
          amount: 10,
        },
        {
          id: 25084,
          status: "PROCESSING",
          refundDate: "2024-12-19T17:49:55.499337",
          amount: 20,
        },
      ],
    });
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(merchantClient);

    const result = await aplazoProvider.getRefundStatus({
      paymentAttempt: {
        id: "attempt_refund_status_latest",
        ordenId: "orden_123",
        userId: "user_1",
        provider: "APLAZO" as any,
        metodoPago: "APLAZO" as any,
        monto: 1299,
        amountMinor: 129900,
        currency: "mxn",
        estado: "PAGADO" as any,
        flowType: "online" as any,
        idempotencyKey: "idem_attempt_refund_status_latest",
        createdAt: {} as any,
        updatedAt: {} as any,
        providerReference: "abc321",
      },
    });

    expect(merchantClient.get).toHaveBeenCalledWith(
      "/v1/merchant/refund/status",
      {
        params: {
          cartId: "abc321",
        },
      },
    );
    expect(result.refundId).toBe("25084");
    expect(result.providerStatus).toBe("PROCESSING");
    expect(result.refundState).toBe("processing");
    expect(result.status).toBe(PaymentStatus.PENDING_PROVIDER);
    expect(result.refundAmountMinor).toBe(2000);
    expect(result.refundEntries).toEqual([
      {
        refundId: "25079",
        providerStatus: "PROCESSING",
        refundState: "processing",
        refundDate: "2024-12-19T17:45:03.59153",
        amountMinor: 12000,
      },
      {
        refundId: "25083",
        providerStatus: "PROCESSING",
        refundState: "processing",
        refundDate: "2024-12-19T17:49:33.910913",
        amountMinor: 1000,
      },
      {
        refundId: "25084",
        providerStatus: "PROCESSING",
        refundState: "processing",
        refundDate: "2024-12-19T17:49:55.499337",
        amountMinor: 2000,
      },
    ]);
    expect(result.rawResponseSanitized).toMatchObject({
      items: [
        {
          id: 25079,
          status: "PROCESSING",
          refundDate: "2024-12-19T17:45:03.59153",
          amount: 120,
        },
        {
          id: 25083,
          status: "PROCESSING",
          refundDate: "2024-12-19T17:49:33.910913",
          amount: 10,
        },
        {
          id: 25084,
          status: "PROCESSING",
          refundDate: "2024-12-19T17:49:55.499337",
          amount: 20,
        },
      ],
    });
  });

  it("gets online refund status by cartId and selects the requested refundId", async () => {
    process.env.APLAZO_REFUNDS_ENABLED = "true";
    const authClient = buildClientMock();
    const merchantClient = buildClientMock();
    authClient.post.mockResolvedValue({
      data: { Authorization: "Bearer online-token" },
    });
    merchantClient.get.mockResolvedValue({
      data: [
        {
          id: 25079,
          status: "PROCESSING",
          refundDate: "2024-12-19T17:45:03.59153",
          amount: 120,
        },
        {
          id: 25083,
          status: "REFUNDED",
          refundDate: "2024-12-19T17:49:33.910913",
          amount: 10,
        },
      ],
    });
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(merchantClient);

    const result = await aplazoProvider.getRefundStatus({
      paymentAttempt: {
        id: "attempt_refund_status_specific",
        ordenId: "orden_123",
        userId: "user_1",
        provider: "APLAZO" as any,
        metodoPago: "APLAZO" as any,
        monto: 1299,
        amountMinor: 129900,
        currency: "mxn",
        estado: "PAGADO" as any,
        flowType: "online" as any,
        idempotencyKey: "idem_attempt_refund_status_specific",
        createdAt: {} as any,
        updatedAt: {} as any,
        providerReference: "abc321",
      },
      refundId: "25083",
    });

    expect(result.refundId).toBe("25083");
    expect(result.providerStatus).toBe("REFUNDED");
    expect(result.refundState).toBe("succeeded");
    expect(result.status).toBe(PaymentStatus.REFUNDED);
    expect(result.refundAmountMinor).toBe(1000);
  });

  it("fails when the requested online refundId is not present in Aplazo response", async () => {
    process.env.APLAZO_REFUNDS_ENABLED = "true";
    const authClient = buildClientMock();
    const merchantClient = buildClientMock();
    authClient.post.mockResolvedValue({
      data: { Authorization: "Bearer online-token" },
    });
    merchantClient.get.mockResolvedValue({
      data: [
        {
          id: 25079,
          status: "PROCESSING",
          refundDate: "2024-12-19T17:45:03.59153",
          amount: 120,
        },
      ],
    });
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(merchantClient);

    await expect(
      aplazoProvider.getRefundStatus({
        paymentAttempt: {
          id: "attempt_refund_status_missing",
          ordenId: "orden_123",
          userId: "user_1",
          provider: "APLAZO" as any,
          metodoPago: "APLAZO" as any,
          monto: 1299,
          amountMinor: 129900,
          currency: "mxn",
          estado: "PAGADO" as any,
          flowType: "online" as any,
          idempotencyKey: "idem_attempt_refund_status_missing",
          createdAt: {} as any,
          updatedAt: {} as any,
          providerReference: "abc321",
        },
        refundId: "99999",
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_REFUND_NOT_FOUND",
      statusCode: 404,
    });
  });

  it("fails when auth does not return a bearer token", async () => {
    const authClient = buildClientMock();
    const createClient = buildClientMock();
    authClient.post.mockResolvedValue({
      data: {},
      headers: {},
    });
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(createClient);

    await expect(
      aplazoProvider.createOnline({
        paymentAttemptId: "attempt_auth_missing_token",
        idempotencyKey: "idem_auth_missing_token",
        amountMinor: 129900,
        currency: "mxn",
        providerReference: "orden_123",
        customerName: "Juan Perez",
        customerEmail: "juan@example.com",
        customerPhone: "4771234567",
        successUrl: "https://app/success",
        failureUrl: "https://app/failure",
        webhookUrl: "https://api/webhooks/aplazo",
        cartUrl: "https://app/cart",
        metadata: {
          cartId: "orden_123",
          addressLine: "Fake Street 123",
          postalCode: "99999",
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
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: "Aplazo online auth no devolvió token Bearer",
    });

    expect(createClient.request).not.toHaveBeenCalled();
  });

  it("fails when auth merchantId config is not numeric", async () => {
    process.env.APLAZO_ONLINE_MERCHANT_ID = "merchant_online";

    const authClient = buildClientMock();
    const createClient = buildClientMock();
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(createClient);

    await expect(
      aplazoProvider.createOnline({
        paymentAttemptId: "attempt_auth_invalid_mid",
        idempotencyKey: "idem_auth_invalid_mid",
        amountMinor: 129900,
        currency: "mxn",
        providerReference: "orden_123",
        customerName: "Juan Perez",
        customerEmail: "juan@example.com",
        customerPhone: "4771234567",
        successUrl: "https://app/success",
        failureUrl: "https://app/failure",
        webhookUrl: "https://api/webhooks/aplazo",
        cartUrl: "https://app/cart",
        metadata: {
          cartId: "orden_123",
          addressLine: "Fake Street 123",
          postalCode: "99999",
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
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: "APLAZO_ONLINE_MERCHANT_ID debe ser numérico para auth",
    });

    expect(authClient.post).not.toHaveBeenCalled();
    expect(createClient.request).not.toHaveBeenCalled();
  });

  it("fails before calling aplazo when cartUrl is missing", async () => {
    const authClient = buildClientMock();
    const createClient = buildClientMock();
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(createClient);

    await expect(
      aplazoProvider.createOnline({
        paymentAttemptId: "attempt_missing_cart_url",
        idempotencyKey: "idem_missing_cart_url",
        amountMinor: 129900,
        currency: "mxn",
        providerReference: "orden_123",
        customerName: "Juan Perez",
        customerEmail: "juan@example.com",
        customerPhone: "4771234567",
        successUrl: "https://app/success",
        failureUrl: "https://app/failure",
        webhookUrl: "https://api/webhooks/aplazo",
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
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_VALIDATION_ERROR",
      message: "Aplazo online requiere cartUrl",
    });

    expect(authClient.post).not.toHaveBeenCalled();
    expect(createClient.request).not.toHaveBeenCalled();
  });

  it("preserves provider code and params from loan status errors", async () => {
    const authClient = buildClientMock();
    const merchantClient = buildClientMock();
    authClient.post.mockResolvedValue({
      data: { authorization: "Bearer online-token" },
    });
    merchantClient.get.mockRejectedValue(
      Object.assign(new Error("Not found"), {
        config: {
          url: "/v1/loan/status",
        },
        response: {
          status: 404,
          data: {
            message: "loan by CartId = some-cart was not found.",
            code: "LOAN_NOT_FOUND",
            params: ["CartId", "some-cart"],
            payload: null,
          },
        },
      }),
    );
    axiosCreate
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(merchantClient);

    try {
      await aplazoProvider.getStatus({
        id: "attempt_status_error",
        ordenId: "orden_missing",
        userId: "user_1",
        provider: "APLAZO" as any,
        metodoPago: "APLAZO" as any,
        monto: 100,
        amountMinor: 10000,
        currency: "mxn",
        estado: "PENDIENTE" as any,
        flowType: "online" as any,
        idempotencyKey: "idem_missing",
        createdAt: {} as any,
        updatedAt: {} as any,
        providerReference: "some-cart",
      });
      throw new Error("Expected getStatus to fail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "PAYMENT_PROVIDER_ERROR",
        details: {
          providerHttpStatus: 404,
          providerCode: "LOAN_NOT_FOUND",
          providerParams: {
            items: ["CartId", "some-cart"],
          },
          providerUrl: "/v1/loan/status",
        },
      });
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "loan by CartId = some-cart was not found.",
      );
    }
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
        cartUrl: "https://app/cart",
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
        cartUrl: "https://app/cart",
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
          merchantId: "2639",
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
            merchantId: "2639",
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

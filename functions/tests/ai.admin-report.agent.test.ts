jest.mock("../src/services/ai/adapters/gemini.adapter", () => ({
  __esModule: true,
  default: {
    generate: jest.fn(),
    generateStructured: jest.fn(),
  },
}));

jest.mock("../src/services/ai/analytics/analytics.repository", () => ({
  __esModule: true,
  default: {
    listOrdersInPeriod: jest.fn(),
    getProductsByIds: jest.fn(),
    listProducts: jest.fn(),
    getCategories: jest.fn(),
    getLines: jest.fn(),
    listOffers: jest.fn(),
    listPromoCodes: jest.fn(),
  },
}));

import geminiAdapter from "../src/services/ai/adapters/gemini.adapter";
import analyticsRepository from "../src/services/ai/analytics/analytics.repository";
import adminReportAgent, {
  MAX_TOOL_CALLS_PER_QUESTION,
} from "../src/services/ai/analytics/admin-report.agent";
import { AiRuntimeError } from "../src/services/ai/ai.error";
import { RolUsuario } from "../src/models/usuario.model";

const gemini = geminiAdapter as jest.Mocked<typeof geminiAdapter>;
const repository = analyticsRepository as jest.Mocked<typeof analyticsRepository>;

const NOW = new Date("2026-03-18T18:00:00.000Z");

const buildGenerationResult = (
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>,
) =>
  ({
    text: "",
    functionCalls,
    response: {
      candidates: [
        {
          content: {
            role: "model",
            parts: functionCalls.map((call) => ({ functionCall: call })),
          },
        },
      ],
    },
    model: "gemini-3.7-flash",
    purpose: "main",
  }) as never;

const VALID_REPORT = {
  summary: "Las ventas de la semana bajaron 20% contra la semana previa.",
  confidence: "media",
  blocks: [
    {
      type: "kpis",
      items: [
        { label: "Ingresos", value: 800, format: "currency", change: -20 },
      ],
    },
    {
      type: "text",
      kind: "observacion",
      content: "Se registraron 1 pedido pagado en el periodo.",
    },
  ],
};

const askInput = {
  question: "¿Por que bajaron las ventas esta semana?",
  userId: "admin-1",
  role: RolUsuario.ADMIN,
  requestId: "req-1",
  sessionId: "session-1",
  now: NOW,
};

beforeEach(() => {
  repository.listOrdersInPeriod.mockResolvedValue({
    orders: [],
    truncated: false,
  });
  repository.getProductsByIds.mockResolvedValue(new Map());
  repository.listProducts.mockResolvedValue({ products: [], truncated: false });
  repository.getCategories.mockResolvedValue(new Map());
  repository.getLines.mockResolvedValue(new Map());
  repository.listOffers.mockResolvedValue([]);
  repository.listPromoCodes.mockResolvedValue([]);
  gemini.generateStructured.mockResolvedValue(VALID_REPORT as never);
});

describe("adminReportAgent", () => {
  it("encadena varias tools en rondas sucesivas y registra la traza", async () => {
    gemini.generate
      .mockResolvedValueOnce(
        buildGenerationResult([
          { name: "compare_sales_periods", args: { period: "this_week" } },
        ]),
      )
      .mockResolvedValueOnce(
        buildGenerationResult([
          { name: "get_sales_by_category", args: { period: "this_week" } },
          { name: "get_orders_metrics", args: { period: "this_week" } },
        ]),
      )
      .mockResolvedValueOnce(buildGenerationResult([]));

    const result = await adminReportAgent.execute(askInput);

    expect(result.trace.toolsUsed).toEqual([
      "compare_sales_periods",
      "get_sales_by_category",
      "get_orders_metrics",
    ]);
    expect(result.trace.toolCalls).toHaveLength(3);
    expect(result.trace.toolCalls[0]).toMatchObject({
      toolName: "compare_sales_periods",
      success: true,
    });
    expect(result.trace.toolCalls[0].periodLabel).toContain("esta semana");
    expect(result.trace.investigationRounds).toBe(3);
    expect(result.report.summary).toBe(VALID_REPORT.summary);
  });

  it("declara las tools de analitica en la llamada a Gemini", async () => {
    gemini.generate.mockResolvedValue(buildGenerationResult([]));

    await adminReportAgent.execute(askInput);

    const call = gemini.generate.mock.calls[0][0];
    const toolNames = (call.tools || []).map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "get_sales_summary",
        "compare_sales_periods",
        "get_sales_by_product",
        "get_sales_by_category",
        "get_inventory_health",
        "get_orders_metrics",
      ]),
    );
    expect(call.systemInstruction).toContain("Nunca inventes ventas");
    expect(call.systemInstruction).toContain("2026-03-18");
  });

  it("responde sin llamar tools cuando Gemini no solicita ninguna", async () => {
    gemini.generate.mockResolvedValue(buildGenerationResult([]));

    const result = await adminReportAgent.execute(askInput);

    expect(result.trace.toolCalls).toHaveLength(0);
    expect(repository.listOrdersInPeriod).not.toHaveBeenCalled();
    expect(gemini.generateStructured).toHaveBeenCalledTimes(1);
  });

  it("bloquea consultas duplicadas exactas en vez de repetirlas", async () => {
    gemini.generate
      .mockResolvedValueOnce(
        buildGenerationResult([
          { name: "get_sales_summary", args: { period: "today" } },
        ]),
      )
      .mockResolvedValueOnce(
        buildGenerationResult([
          { name: "get_sales_summary", args: { period: "today" } },
        ]),
      )
      .mockResolvedValueOnce(buildGenerationResult([]));

    const result = await adminReportAgent.execute(askInput);

    expect(repository.listOrdersInPeriod).toHaveBeenCalledTimes(1);
    expect(result.trace.toolCalls[1]).toMatchObject({
      success: false,
      errorMessage: "Consulta duplicada omitida",
    });
  });

  it("rechaza herramientas inexistentes sin romper el flujo", async () => {
    gemini.generate
      .mockResolvedValueOnce(
        buildGenerationResult([{ name: "delete_all_products", args: {} }]),
      )
      .mockResolvedValueOnce(buildGenerationResult([]));

    const result = await adminReportAgent.execute(askInput);

    expect(result.trace.toolCalls[0]).toMatchObject({
      toolName: "delete_all_products",
      success: false,
      errorMessage: "Herramienta no disponible",
    });
    expect(result.report.summary).toBeTruthy();
  });

  it("continua cuando una tool falla y guarda el error en la traza", async () => {
    repository.listOrdersInPeriod.mockRejectedValueOnce(
      new Error("Firestore no disponible"),
    );

    gemini.generate
      .mockResolvedValueOnce(
        buildGenerationResult([
          { name: "get_sales_summary", args: { period: "today" } },
        ]),
      )
      .mockResolvedValueOnce(buildGenerationResult([]));

    const result = await adminReportAgent.execute(askInput);

    expect(result.trace.toolCalls[0]).toMatchObject({
      success: false,
      errorMessage: "Firestore no disponible",
    });
    expect(result.report.summary).toBeTruthy();

    const evidencePrompt = String(
      gemini.generateStructured.mock.calls[0][0].prompt,
    );
    expect(evidencePrompt).toContain("Firestore no disponible");
  });

  it("respeta el limite de rondas configurado", async () => {
    gemini.generate.mockImplementation(async () =>
      buildGenerationResult([
        {
          name: "get_sales_summary",
          args: { period: "custom", from: "2026-03-01", to: `2026-03-0${(gemini.generate.mock.calls.length % 9) + 1}` },
        },
      ]),
    );

    const result = await adminReportAgent.execute(askInput);

    // aiConfig.gemini.maxToolSteps por defecto es 6.
    expect(result.trace.investigationRounds).toBeLessThanOrEqual(6);
    expect(result.trace.toolCalls.length).toBeLessThanOrEqual(
      MAX_TOOL_CALLS_PER_QUESTION,
    );
  });

  it("solo envia al redactor la evidencia real de las tools", async () => {
    repository.listOrdersInPeriod.mockResolvedValue({
      orders: [
        {
          id: "o1",
          createdAt: NOW,
          dayKey: "2026-03-18",
          estado: "ENTREGADA",
          paymentStatus: "PAGADO",
          fulfillmentMethod: "PICKUP",
          metodoPago: "TARJETA",
          total: 1234,
          subtotal: 1234,
          shippingTotal: 0,
          discountTotal: 0,
          promoCode: null,
          promoCodeDiscount: 0,
          customerKey: "uid-secreto",
          items: [],
        },
      ],
      truncated: false,
    });

    gemini.generate
      .mockResolvedValueOnce(
        buildGenerationResult([
          { name: "get_sales_summary", args: { period: "today" } },
        ]),
      )
      .mockResolvedValueOnce(buildGenerationResult([]));

    await adminReportAgent.execute(askInput);

    const structuredCall = gemini.generateStructured.mock.calls[0][0];
    const prompt = String(structuredCall.prompt);

    expect(prompt).toContain("1234");
    expect(prompt).not.toContain("uid-secreto");
    expect(structuredCall.responseJsonSchema).toBeDefined();
    expect(structuredCall.tools).toBeUndefined();
  });

  it("reintenta una vez y luego falla de forma controlada si el JSON no cumple el esquema", async () => {
    gemini.generate.mockResolvedValue(buildGenerationResult([]));
    gemini.generateStructured.mockResolvedValue({ nope: true } as never);

    await expect(adminReportAgent.execute(askInput)).rejects.toBeInstanceOf(
      AiRuntimeError,
    );
    expect(gemini.generateStructured).toHaveBeenCalledTimes(2);
  });

  it("emite estados legibles mientras investiga", async () => {
    gemini.generate
      .mockResolvedValueOnce(
        buildGenerationResult([
          { name: "get_inventory_health", args: {} },
        ]),
      )
      .mockResolvedValueOnce(buildGenerationResult([]));

    const statuses: string[] = [];
    for await (const event of adminReportAgent.run(askInput)) {
      if (event.type === "status") {
        statuses.push(event.data.status);
      }
    }

    expect(statuses).toContain("Revisando inventario...");
    expect(statuses[statuses.length - 1]).toBe("Preparando informe...");
    expect(statuses.join(" ")).not.toContain("get_inventory_health");
  });

  it("mantiene el contexto conversacional para preguntas de seguimiento", async () => {
    gemini.generate.mockResolvedValue(buildGenerationResult([]));

    await adminReportAgent.execute({
      ...askInput,
      question: "¿Y contra el mes pasado?",
      history: [
        { role: "user", content: "¿Como fueron las ventas este mes?" },
        { role: "assistant", content: "Las ventas del mes suman 10,000 MXN." },
      ],
    });

    const contents = gemini.generate.mock.calls[0][0].contents as Array<{
      role: string;
      parts: Array<{ text?: string }>;
    }>;

    expect(contents).toHaveLength(3);
    expect(contents[0].role).toBe("user");
    expect(contents[1].role).toBe("model");
    expect(contents[2].parts[0].text).toBe("¿Y contra el mes pasado?");
  });
});

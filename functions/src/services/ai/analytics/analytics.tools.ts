/**
 * Capa de herramientas READ-ONLY expuestas a Gemini para el Asistente
 * Administrativo.
 *
 * El modelo nunca toca Firestore: solo puede invocar estas funciones con
 * argumentos validados por Zod. Ninguna tool escribe, borra ni modifica datos.
 */

import { z } from "zod";
import { FunctionDeclaration } from "@google/genai";
import { RolUsuario } from "../../../models/usuario.model";
import { buildFunctionDeclaration } from "../tools/types";
import analyticsRepository, { AnalyticsOrder } from "./analytics.repository";
import {
  aggregateByProduct,
  breakdownOrders,
  buildDailySeries,
  buildVariation,
  countUnits,
  isPaidOrder,
  roundCurrency,
  shareOfTotal,
  summarizeSales,
} from "./analytics.metrics";
import {
  AnalyticsTool,
  AnalyticsToolContext,
  buildDataQuality,
  cached,
  createAnalyticsToolContext,
  loadCatalogProducts,
  loadCategories,
  loadLines,
  loadOrders,
  periodShape,
  productLabel,
  resolveFromInput,
} from "./analytics.tool-kit";
import { BEHAVIOR_TOOLS } from "./behavior.tools";
import {
  ANALYTICS_PERIOD_KEYS,
  describePeriodForModel,
  resolvePeriod,
  resolvePreviousPeriod,
} from "./period.util";

export type { AnalyticsTool, AnalyticsToolContext };
export { createAnalyticsToolContext };

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

const getSalesSummarySchema = z.object({
  ...periodShape,
  includeDailySeries: z
    .boolean()
    .optional()
    .describe(
      "true para incluir la serie diaria de ingresos, util para graficas de tendencia.",
    ),
});

const getSalesSummary: AnalyticsTool = {
  name: "get_sales_summary",
  description:
    "Resumen de ventas confirmadas (pedidos pagados) de un periodo: ingresos, pedidos, unidades, ticket promedio, envio, descuentos y clientes distintos. Opcionalmente devuelve la serie diaria.",
  schema: getSalesSummarySchema,
  execute: async (rawInput, context) => {
    const input = getSalesSummarySchema.parse(rawInput);
    const period = resolveFromInput(input, context);
    const page = await loadOrders(context, period);
    const totals = summarizeSales(page.orders);

    return {
      period: describePeriodForModel(period),
      currency: "MXN",
      ...totals,
      dailySeries: input.includeDailySeries
        ? buildDailySeries(page.orders, period)
        : undefined,
      dataQuality: buildDataQuality(page, period),
    };
  },
};

const comparePeriodsSchema = z.object({
  ...periodShape,
  comparedTo: z
    .enum(ANALYTICS_PERIOD_KEYS)
    .optional()
    .describe(
      "Periodo de comparacion. Si se omite se usa el periodo previo inmediato del mismo tamano.",
    ),
  comparedFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Inicio del periodo comparado. Solo si comparedTo="custom".'),
  comparedToDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Fin del periodo comparado. Solo si comparedTo="custom".'),
});

const compareSalesPeriods: AnalyticsTool = {
  name: "compare_sales_periods",
  description:
    "Compara dos periodos de ventas y devuelve ingresos, pedidos, unidades y ticket promedio con variacion absoluta y porcentual. Si no se indica el periodo de comparacion usa el anterior inmediato.",
  schema: comparePeriodsSchema,
  execute: async (rawInput, context) => {
    const input = comparePeriodsSchema.parse(rawInput);
    const current = resolveFromInput(input, context);
    const baseline = input.comparedTo
      ? resolvePeriod(
          {
            period: input.comparedTo,
            from: input.comparedFrom,
            to: input.comparedToDate,
          },
          context.now,
        )
      : resolvePreviousPeriod(current);

    const [currentPage, baselinePage] = await Promise.all([
      loadOrders(context, current),
      loadOrders(context, baseline),
    ]);

    const currentTotals = summarizeSales(currentPage.orders);
    const baselineTotals = summarizeSales(baselinePage.orders);

    return {
      currentPeriod: describePeriodForModel(current),
      baselinePeriod: describePeriodForModel(baseline),
      currency: "MXN",
      metrics: {
        revenue: buildVariation(currentTotals.revenue, baselineTotals.revenue),
        paidOrders: buildVariation(
          currentTotals.paidOrders,
          baselineTotals.paidOrders,
        ),
        units: buildVariation(currentTotals.units, baselineTotals.units),
        averageOrderValue: buildVariation(
          currentTotals.averageOrderValue,
          baselineTotals.averageOrderValue,
        ),
        uniqueCustomers: buildVariation(
          currentTotals.uniqueCustomers,
          baselineTotals.uniqueCustomers,
        ),
      },
      dataQuality: {
        current: buildDataQuality(currentPage, current),
        baseline: buildDataQuality(baselinePage, baseline),
      },
    };
  },
};

const salesByProductSchema = z.object({
  ...periodShape,
  ranking: z
    .enum(["top", "bottom"])
    .optional()
    .describe(
      'top = mayores ingresos (default). bottom = productos con menor rendimiento entre los que si vendieron.',
    ),
  metric: z
    .enum(["revenue", "units"])
    .optional()
    .describe("Metrica de ordenamiento. Default: revenue."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("Cantidad de productos a devolver. Default 10, maximo 25."),
});

const getSalesByProduct: AnalyticsTool = {
  name: "get_sales_by_product",
  description:
    "Ventas agregadas por producto en un periodo: unidades, ingresos, pedidos y participacion sobre el total. Permite pedir el ranking superior o inferior.",
  schema: salesByProductSchema,
  execute: async (rawInput, context) => {
    const input = salesByProductSchema.parse(rawInput);
    const period = resolveFromInput(input, context);
    const limit = input.limit ?? 10;
    const metric = input.metric ?? "revenue";
    const ranking = input.ranking ?? "top";

    const page = await loadOrders(context, period);
    const aggregates = Array.from(aggregateByProduct(page.orders).values());
    const totalRevenue = aggregates.reduce((acc, item) => acc + item.revenue, 0);
    const totalUnits = aggregates.reduce((acc, item) => acc + item.units, 0);

    aggregates.sort((a, b) => {
      const diff = metric === "units" ? a.units - b.units : a.revenue - b.revenue;
      return ranking === "top" ? -diff : diff;
    });

    const selected = aggregates.slice(0, limit);
    const products = await analyticsRepository.getProductsByIds(
      selected.map((item) => item.productId),
    );

    return {
      period: describePeriodForModel(period),
      currency: "MXN",
      ranking,
      metric,
      totals: {
        productsWithSales: aggregates.length,
        revenue: roundCurrency(totalRevenue),
        units: totalUnits,
      },
      products: selected.map((item) => {
        const label = productLabel(item.productId, products);
        return {
          productId: item.productId,
          sku: label.sku,
          name: label.name,
          units: item.units,
          revenue: item.revenue,
          orders: item.orders,
          revenueShare: shareOfTotal(item.revenue, totalRevenue),
          unitsShare: shareOfTotal(item.units, totalUnits),
        };
      }),
      dataQuality: buildDataQuality(page, period),
    };
  },
};

const salesByCategorySchema = z.object({
  ...periodShape,
  groupBy: z
    .enum(["categoria", "linea"])
    .optional()
    .describe("Agrupacion del catalogo real. Default: categoria."),
  limit: z.number().int().min(1).max(25).optional(),
});

const getSalesByCategory: AnalyticsTool = {
  name: "get_sales_by_category",
  description:
    "Ventas agregadas por categoria o linea del catalogo real: ingresos, unidades y participacion. Los nombres provienen de las colecciones de catalogo de la tienda.",
  schema: salesByCategorySchema,
  execute: async (rawInput, context) => {
    const input = salesByCategorySchema.parse(rawInput);
    const period = resolveFromInput(input, context);
    const groupBy = input.groupBy ?? "categoria";
    const limit = input.limit ?? 15;

    const page = await loadOrders(context, period);
    const aggregates = Array.from(aggregateByProduct(page.orders).values());
    const products = await analyticsRepository.getProductsByIds(
      aggregates.map((item) => item.productId),
    );
    const catalog =
      groupBy === "categoria"
        ? await loadCategories(context)
        : await loadLines(context);

    const grouped = new Map<
      string,
      { id: string; name: string; revenue: number; units: number; products: number }
    >();

    for (const aggregate of aggregates) {
      const product = products.get(aggregate.productId);
      const groupId =
        (groupBy === "categoria" ? product?.categoriaId : product?.lineaId) ||
        "sin_clasificar";
      const entry = grouped.get(groupId) || {
        id: groupId,
        name:
          catalog.get(groupId)?.name ||
          (groupId === "sin_clasificar"
            ? "Sin clasificar"
            : `Sin nombre (${groupId})`),
        revenue: 0,
        units: 0,
        products: 0,
      };

      entry.revenue = roundCurrency(entry.revenue + aggregate.revenue);
      entry.units += aggregate.units;
      entry.products += 1;
      grouped.set(groupId, entry);
    }

    const rows = Array.from(grouped.values()).sort(
      (a, b) => b.revenue - a.revenue,
    );
    const totalRevenue = rows.reduce((acc, row) => acc + row.revenue, 0);
    const totalUnits = rows.reduce((acc, row) => acc + row.units, 0);

    return {
      period: describePeriodForModel(period),
      currency: "MXN",
      groupBy,
      totals: {
        groups: rows.length,
        revenue: roundCurrency(totalRevenue),
        units: totalUnits,
      },
      groups: rows.slice(0, limit).map((row) => ({
        id: row.id,
        name: row.name,
        revenue: row.revenue,
        units: row.units,
        productsWithSales: row.products,
        revenueShare: shareOfTotal(row.revenue, totalRevenue),
      })),
      dataQuality: buildDataQuality(page, period),
    };
  },
};

const inventoryHealthSchema = z.object({
  focus: z
    .enum(["overview", "low_stock", "out_of_stock", "overstock"])
    .optional()
    .describe("Que parte del inventario detallar. Default: overview."),
  salesLookbackDays: z
    .number()
    .int()
    .min(7)
    .max(180)
    .optional()
    .describe(
      "Dias de ventas usados para estimar rotacion y dias de cobertura. Default 30.",
    ),
  limit: z.number().int().min(1).max(25).optional(),
});

const getInventoryHealth: AnalyticsTool = {
  name: "get_inventory_health",
  description:
    "Estado real del inventario: stock disponible, productos sin stock, con stock bajo respecto a su minimo configurado y candidatos a sobreinventario segun rotacion reciente.",
  schema: inventoryHealthSchema,
  execute: async (rawInput, context) => {
    const input = inventoryHealthSchema.parse(rawInput);
    const focus = input.focus ?? "overview";
    const lookbackDays = input.salesLookbackDays ?? 30;
    const limit = input.limit ?? 10;

    const lookbackPeriod = resolvePeriod(
      {
        period: "custom",
        from: new Date(
          context.now.getTime() - (lookbackDays - 1) * 24 * 60 * 60 * 1000,
        )
          .toISOString()
          .slice(0, 10),
        to: context.now.toISOString().slice(0, 10),
      },
      context.now,
    );

    const [catalog, page] = await Promise.all([
      loadCatalogProducts(context),
      loadOrders(context, lookbackPeriod),
    ]);

    const salesByProduct = aggregateByProduct(page.orders);
    const active = catalog.products.filter((product) => product.active);

    const enriched = active.map((product) => {
      const unitsSold = salesByProduct.get(product.id)?.units ?? 0;
      const dailyRate = unitsSold / lookbackDays;
      const daysOfSupply =
        dailyRate > 0 ? Math.round(product.availableStock / dailyRate) : null;

      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        availableStock: product.availableStock,
        reservedStock: product.reservedStock,
        minStock: product.minStock,
        unitsSoldInLookback: unitsSold,
        daysOfSupply,
      };
    });

    const outOfStock = enriched.filter((item) => item.availableStock <= 0);
    const lowStock = enriched.filter(
      (item) =>
        item.availableStock > 0 &&
        item.minStock > 0 &&
        item.availableStock <= item.minStock,
    );
    const overstock = enriched.filter(
      (item) =>
        item.availableStock > 0 &&
        (item.daysOfSupply === null
          ? item.availableStock >= 20
          : item.daysOfSupply > 120),
    );

    const notes: string[] = [];
    if (catalog.truncated) {
      notes.push(
        "El catalogo supera el limite de lectura del agente; el resumen de inventario puede estar incompleto.",
      );
    }
    if (page.truncated) {
      notes.push(
        "El historial de ventas usado para estimar rotacion quedo truncado.",
      );
    }
    if (enriched.every((item) => item.minStock === 0)) {
      notes.push(
        "Ningun producto activo tiene stock minimo configurado, por lo que no es posible clasificar stock bajo con el umbral del negocio.",
      );
    }

    const sortOverstock = [...overstock].sort(
      (a, b) => b.availableStock - a.availableStock,
    );
    const sortLow = [...lowStock].sort(
      (a, b) => a.availableStock - b.availableStock,
    );

    const detail =
      focus === "low_stock"
        ? sortLow.slice(0, limit)
        : focus === "out_of_stock"
          ? outOfStock.slice(0, limit)
          : focus === "overstock"
            ? sortOverstock.slice(0, limit)
            : [
                ...sortLow.slice(0, Math.ceil(limit / 2)),
                ...outOfStock.slice(0, Math.floor(limit / 2)),
              ];

    return {
      focus,
      lookback: describePeriodForModel(lookbackPeriod),
      totals: {
        activeProducts: active.length,
        totalAvailableUnits: enriched.reduce(
          (acc, item) => acc + item.availableStock,
          0,
        ),
        outOfStockProducts: outOfStock.length,
        lowStockProducts: lowStock.length,
        overstockCandidates: overstock.length,
        productsWithoutSalesInLookback: enriched.filter(
          (item) => item.unitsSoldInLookback === 0,
        ).length,
      },
      products: detail,
      dataQuality: {
        productsScanned: catalog.products.length,
        truncated: catalog.truncated || page.truncated,
        notes,
      },
    };
  },
};

const ordersMetricsSchema = z.object({
  ...periodShape,
});

const getOrdersMetrics: AnalyticsTool = {
  name: "get_orders_metrics",
  description:
    "Metricas operativas de pedidos en un periodo: totales por estado, estado de pago, metodo de entrega (pickup vs domicilio), metodo de pago y ticket promedio.",
  schema: ordersMetricsSchema,
  execute: async (rawInput, context) => {
    const input = ordersMetricsSchema.parse(rawInput);
    const period = resolveFromInput(input, context);
    const page = await loadOrders(context, period);
    const breakdown = breakdownOrders(page.orders);
    const totals = summarizeSales(page.orders);

    return {
      period: describePeriodForModel(period),
      currency: "MXN",
      ...breakdown,
      averageOrderValue: totals.averageOrderValue,
      paidRevenue: totals.revenue,
      paidUnits: totals.units,
      conversionToPaidRate:
        breakdown.totalOrders > 0
          ? shareOfTotal(breakdown.paidOrders, breakdown.totalOrders)
          : 0,
      dataQuality: buildDataQuality(page, period),
    };
  },
};

const promotionsSchema = z.object({
  ...periodShape,
  limit: z.number().int().min(1).max(25).optional(),
});

const getPromotionsPerformance: AnalyticsTool = {
  name: "get_promotions_performance",
  description:
    "Uso real de codigos promocionales en los pedidos pagados del periodo y estado de las ofertas configuradas (vigencia, descuento y unidades vendidas bajo oferta).",
  schema: promotionsSchema,
  execute: async (rawInput, context) => {
    const input = promotionsSchema.parse(rawInput);
    const period = resolveFromInput(input, context);
    const limit = input.limit ?? 10;

    const [page, offers, promoCodes] = await Promise.all([
      loadOrders(context, period),
      cached(context, "offers", () => analyticsRepository.listOffers()),
      cached(context, "promoCodes", () => analyticsRepository.listPromoCodes()),
    ]);

    const paid = page.orders.filter(isPaidOrder);
    const usage = new Map<
      string,
      { code: string; orders: number; discount: number; revenue: number }
    >();

    for (const order of paid) {
      if (!order.promoCode) {
        continue;
      }

      const entry = usage.get(order.promoCode) || {
        code: order.promoCode,
        orders: 0,
        discount: 0,
        revenue: 0,
      };

      entry.orders += 1;
      entry.discount = roundCurrency(entry.discount + order.promoCodeDiscount);
      entry.revenue = roundCurrency(entry.revenue + order.total);
      usage.set(order.promoCode, entry);
    }

    const ordersWithCode = paid.filter((order) => Boolean(order.promoCode)).length;

    return {
      period: describePeriodForModel(period),
      currency: "MXN",
      promoCodeUsageInPeriod: {
        paidOrders: paid.length,
        ordersWithPromoCode: ordersWithCode,
        promoCodePenetration: shareOfTotal(ordersWithCode, paid.length),
        totalPromoDiscount: roundCurrency(
          paid.reduce((acc, order) => acc + order.promoCodeDiscount, 0),
        ),
        byCode: Array.from(usage.values())
          .sort((a, b) => b.orders - a.orders)
          .slice(0, limit),
      },
      configuredPromoCodes: promoCodes.slice(0, limit),
      configuredOffers: offers.slice(0, limit),
      dataQuality: buildDataQuality(page, period),
    };
  },
};

const customerMetricsSchema = z.object({
  ...periodShape,
});

const getCustomerMetrics: AnalyticsTool = {
  name: "get_customer_metrics",
  description:
    "Metricas agregadas y anonimas de clientes en el periodo: compradores distintos, pedidos por comprador, tasa de recompra dentro del periodo e ingreso promedio por comprador. No devuelve datos personales.",
  schema: customerMetricsSchema,
  execute: async (rawInput, context) => {
    const input = customerMetricsSchema.parse(rawInput);
    const period = resolveFromInput(input, context);
    const page = await loadOrders(context, period);

    const paid = page.orders.filter(isPaidOrder);
    const byCustomer = new Map<string, { orders: number; revenue: number }>();
    let ordersWithoutCustomer = 0;

    for (const order of paid) {
      if (!order.customerKey) {
        ordersWithoutCustomer += 1;
        continue;
      }

      const entry = byCustomer.get(order.customerKey) || {
        orders: 0,
        revenue: 0,
      };
      entry.orders += 1;
      entry.revenue = roundCurrency(entry.revenue + order.total);
      byCustomer.set(order.customerKey, entry);
    }

    const buyers = Array.from(byCustomer.values());
    const repeatBuyers = buyers.filter((buyer) => buyer.orders > 1).length;
    const revenue = buyers.reduce((acc, buyer) => acc + buyer.revenue, 0);

    return {
      period: describePeriodForModel(period),
      currency: "MXN",
      uniqueBuyers: buyers.length,
      paidOrders: paid.length,
      ordersPerBuyer:
        buyers.length > 0
          ? roundCurrency(paid.length / buyers.length)
          : 0,
      repeatBuyersInPeriod: repeatBuyers,
      repeatRateInPeriod: shareOfTotal(repeatBuyers, buyers.length),
      revenuePerBuyer:
        buyers.length > 0 ? roundCurrency(revenue / buyers.length) : 0,
      unitsPerPaidOrder:
        paid.length > 0
          ? roundCurrency(
              paid.reduce((acc, order) => acc + countUnits(order), 0) /
                paid.length,
            )
          : 0,
      ordersWithoutCustomerReference: ordersWithoutCustomer,
      dataQuality: {
        ...buildDataQuality(page, period),
        notes: [
          ...(buildDataQuality(page, period).notes as string[]),
          "La tasa de recompra solo considera pedidos dentro del periodo consultado; no es retencion historica.",
        ],
      },
    };
  },
};

/** Tools de ventas, catalogo e inventario (fase 1). */
export const SALES_TOOLS: AnalyticsTool[] = [
  getSalesSummary,
  compareSalesPeriods,
  getSalesByProduct,
  getSalesByCategory,
  getInventoryHealth,
  getOrdersMetrics,
  getPromotionsPerformance,
  getCustomerMetrics,
];

/**
 * Registro completo: ventas + comportamiento, trafico, funnel, correlaciones,
 * pronostico y anomalias.
 */
export const ANALYTICS_TOOLS: AnalyticsTool[] = [
  ...SALES_TOOLS,
  ...BEHAVIOR_TOOLS,
];

export const ANALYTICS_TOOL_MAP = new Map(
  ANALYTICS_TOOLS.map((tool) => [tool.name, tool]),
);

export const buildAnalyticsFunctionDeclarations = (): FunctionDeclaration[] =>
  ANALYTICS_TOOLS.map((tool) =>
    buildFunctionDeclaration({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
      roles: [RolUsuario.ADMIN],
      agentTypes: [],
      execute: tool.execute as never,
    }),
  );

export type AnalyticsOrderForTests = AnalyticsOrder;

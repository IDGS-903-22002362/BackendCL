import { EstadoOrden, PaymentState } from "../src/models/orden.model";
import {
  extractPaidProductIdsFromOrder,
  isOrdenPagada,
} from "../src/services/recomendaciones/utils/order-paid.util";
import { diversifyCandidates } from "../src/services/recomendaciones/utils/diversification.util";
import { RecomendacionEstrategia } from "../src/models/recomendaciones.model";
import { Producto } from "../src/models/producto.model";

describe("recomendaciones order-paid util", () => {
  it("identifica orden pagada por paymentStatus", () => {
    expect(
      isOrdenPagada({
        estado: EstadoOrden.PENDIENTE,
        paymentStatus: PaymentState.PAGADO,
      } as never),
    ).toBe(true);
  });

  it("excluye orden cancelada aunque tenga paymentStatus pagado", () => {
    expect(
      isOrdenPagada({
        estado: EstadoOrden.CANCELADA,
        paymentStatus: PaymentState.PAGADO,
      } as never),
    ).toBe(false);
  });

  it("extrae productos de orden pagada", () => {
    const ids = extractPaidProductIdsFromOrder({
      estado: EstadoOrden.CONFIRMADA,
      items: [{ productoId: "p1", cantidad: 1, precioUnitario: 100, subtotal: 100 }],
    } as never);

    expect(ids).toEqual(["p1"]);
  });
});

describe("recomendaciones diversification util", () => {
  it("limita productos por categoría", () => {
    const productsById = new Map<string, Producto>([
      ["a", { id: "a", categoriaId: "cat1", lineaId: "l1" } as Producto],
      ["b", { id: "b", categoriaId: "cat1", lineaId: "l1" } as Producto],
      ["c", { id: "c", categoriaId: "cat1", lineaId: "l1" } as Producto],
      ["d", { id: "d", categoriaId: "cat2", lineaId: "l2" } as Producto],
    ]);

    const result = diversifyCandidates(
      [
        { productoId: "a", score: 4, estrategia: RecomendacionEstrategia.PARA_TI },
        { productoId: "b", score: 3, estrategia: RecomendacionEstrategia.PARA_TI },
        { productoId: "c", score: 2, estrategia: RecomendacionEstrategia.PARA_TI },
        { productoId: "d", score: 1, estrategia: RecomendacionEstrategia.PARA_TI },
      ],
      productsById,
      { limite: 4, maxPorCategoria: 2, maxPorLinea: 4 },
    );

    expect(result.map((item) => item.productoId)).toEqual(["a", "b", "d", "c"]);
  });
});

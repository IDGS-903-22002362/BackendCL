# Módulo de inventario — documentación técnica completa

Última actualización: 2026-06-22

Este documento describe cómo funciona el inventario en Club León Ecommerce de punta a punta.

---

## 1. Resumen ejecutivo

El inventario es **fuente de verdad en backend**.

| Concepto | Dónde vive | Quién lo modifica |
|----------|------------|-------------------|
| Stock actual | Documento `productos` en Firestore | `ProductService.updateStock`, `replaceSizeInventory` |
| Historial | Colección `movimientosInventario` | Cada cambio genera un movimiento |
| Descuento por venta | Movimiento `venta` al confirmar pago | `InventoryReservationService.confirmOrderReservations` |
| Validación en compra | Carrito y creación de orden | `CarritoService`, `OrdenService` |
| Alertas | Cálculo + notificaciones | `evaluateLowStock`, `StockAlertService` |

**Nota:** No hay inventario multi-ubicación operativo; `Stock`/`Ubicacion` en el modelo son diseño futuro.

---

## 2. Modelo de datos

Ver `docs/inventario-modulo-completo.md` para detalle extendido (recepciones, reservas, índices).

---

## 3. Servicios

- `InventoryService` — movimientos, ajustes, dashboard
- `InventoryReservationService` — reservas checkout
- `InventoryReceptionService` — recepciones de mercancía
- `ProductService` — transacciones atómicas de stock

---

## 4. APIs

| Endpoint | Auth | Uso |
|----------|------|-----|
| `POST /api/inventario/movimientos` | Admin/Empleado | entrada, salida, venta, devolución |
| `POST /api/inventario/ajustes` | Admin/Empleado | conteo físico |
| `POST /api/inventario/recepciones` | Admin/Empleado | crear recepción |
| `POST /api/inventario/recepciones/:id/confirmar` | Admin/Empleado | confirmar unidades |
| `GET /api/inventario/movimientos` | Auth | historial |
| `GET /api/inventario/alertas-stock` | Admin/Empleado | dashboard |
| `GET /api/inventario/dashboard` | Admin/Empleado | resumen v2 |

---

## 5. Flujo de compra (v2)

```
Carrito → valida stock
Crear orden → valida stock (sin descontar físico)
Inicio pago → reserva checkout (reservasInventario)
Pago OK → confirmación reserva → movimiento VENTA
Pago fallido/expirado → liberación reserva
Cancelar pagada → DEVOLUCION si hubo VENTA
```

---

## 6. Frontend

- `TiendaFrontCL/src/lib/api/inventario.ts`
- Admin: `/admin/inventario`, `/movimientos`, `/ajustes`, `/alertas-stock`, `/recepciones`

---

## 7. Alcance

**Incluido:** stock global/por talla, movimientos, ajustes, alertas, reservas checkout, recepciones, UI admin.

**No incluido:** multi-ubicación, devoluciones formales en línea, POS principal.

---

## 8. Devoluciones — política

> Para devoluciones o cambios de productos comprados en la tienda en línea, el cliente debe contactar directamente con La Guarida del León en tienda física (Estadio Nou Camp, Blvd. Adolfo López Mateos Oriente 1810, Col. La Martinica, C.P. 37500, León, Guanajuato) o en puntos de venta autorizados. No existe en la plataforma un flujo automático de solicitud, aprobación, recepción ni inspección de devoluciones.

Reintegro automático `devolucion` al cancelar orden pagada con `venta` previa se mantiene.

---

## 9. Índices Firestore

Desplegar:

```bash
firebase deploy --only firestore:indexes --project e-comerce-leon
```

Índices `reservasInventario`: `estado+expiraEn`, `ordenId+estado`, `productoId+estado`.

---

## 10. Referencias

- `docs/inventario-modulo-completo.md`
- `docs/modulo-inventario-auditoria.md`
- Tests: `functions/tests/inventory.*.test.ts`

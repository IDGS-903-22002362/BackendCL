# POS Backend — Plan de implementación

Estado global: **completado** en el alcance descrito. Ver § Estado final por fase.

Leyenda: `[x]` hecho · `[~]` hecho con limitación documentada · `[ ]` no realizado.

---

## Fase 0 — Inspección

- [x] `package.json`, `tsconfig.json`, `firebase.json`, `jest.config.js`
- [x] Bootstrap Express (`app.ts`, `index.ts`, `routes/index.ts`) y orden de middleware
- [x] Auth, roles, App Check, rate limiting, manejo de errores
- [x] Fuentes de verdad: productos, tallas, inventario, ofertas, códigos, órdenes, pagos, usuarios
- [x] Convenciones del módulo más moderno (`modules/loyalty`) para replicarlas
- [x] Reglas e índices Firestore, workflows de CI, scripts de migración existentes
- [x] Deuda técnica relevante (D1–D5 en `POS_BACKEND_ARCHITECTURE.md` § 1.5)

## Fase 1 — Diseño

- [x] `docs/POS_BACKEND_ARCHITECTURE.md`
- [x] `docs/POS_BACKEND_IMPLEMENTATION_PLAN.md` (este documento)
- [x] Decisiones DEC-01…DEC-14 registradas

## Fase 2 — Núcleo del módulo

- [x] `constants/pos.constants.ts` — colecciones, defaults, denominaciones, límites, TTLs
- [x] `models/pos.enums.ts` — capacidades, estados, tipos de movimiento, eventos de auditoría
- [x] `models/pos.types.ts` — entidades y DTOs
- [x] `errors/pos-problem.error.ts` — RFC 7807 + catálogo completo de códigos de dominio

## Fase 3 — Dominio puro (sin Firestore, 100% testeable)

- [x] `domain/money.ts` — enteros en centavos, conversión pesos↔centavos, reparto proporcional
- [x] `domain/operational-date.ts` — `America/Mexico_City` + `operationalDayCutoffHour`
- [x] `domain/capabilities.ts` — matriz rol → capacidades y helpers de separación de funciones
- [x] `domain/state-machines.ts` — transiciones de caja, sesión, turno, venta, pago, movimiento, corte, cierre, devolución, incidencia
- [x] `domain/cash-count.ts` — validación y recálculo de denominaciones
- [x] `domain/expected-cash.ts` — efectivo esperado desde el ledger
- [x] `domain/cut-classification.ts` — tolerancias, clasificación y nivel de autorización requerido
- [x] `domain/refund-allocation.ts` — reparto de reembolso en pagos mixtos

## Fase 4 — Infraestructura

- [x] `repositories/pos-firestore.ts` — accesores a colecciones (`firestoreTienda`), sin nuevos clientes
- [x] `repositories/*.repository.ts` — un agregado por repositorio
- [x] `services/pos-idempotency.service.ts` — persistente, con estados y hash de payload
- [x] `services/pos-audit.service.ts` — append-only + sanitización por allowlist
- [x] `services/pos-settings.service.ts` — configuración con caché corta y validación Zod
- [x] `services/pos-authorization.service.ts` — capacidades, ownership, separación de funciones
- [x] `middleware/pos.middleware.ts` — App Check (`observe|enforce`), actor, capacidad, idempotencia, rate limit, error handler `problem+json`

## Fase 5 — Cajas, sesiones y turnos

- [x] CRUD de cajas + archivar, bloquear, desbloquear
- [x] Apertura de caja con fondo inicial (transacción + lock)
- [x] Cierre y cierre forzado con motivo + incidencia
- [x] Inicio de turno con lock por cajero
- [x] Handoff solicitud/confirmación con entrega de efectivo
- [x] Fin de turno, `start-count`, `force-close`, línea de tiempo
- [x] Recuperación de sesión abandonada (`force-close` + incidencia `ABANDONED_SESSION`)

## Fase 6 — Ventas

- [x] Borrador, alta/edición/baja de líneas con snapshots
- [x] Repricing con `ofertasService` (fuente de verdad única)
- [x] Aplicar y quitar código promocional vía `codigosPromocionService`
- [x] Descuento manual con límites, autorizador y auditoría de valor antes/después
- [x] Suspender / reanudar / cancelar
- [x] `checkout-preview` con revalidación de catálogo, precio, promoción e inventario
- [x] Límites: líneas, unidades por línea, longitud de notas, modificaciones, vigencia del borrador

## Fase 7 — Pagos, inventario e inventario atómico

- [x] Efectivo con cambio y validación de suficiencia
- [x] Tarjeta externa con terminal, referencia única, código de autorización, decline y cancel
- [x] Pago mixto atómico sin duplicar la venta
- [x] Commit único: venta + pagos + inventario + `movimientosInventario` + ledger + auditoría
- [x] Interfaz `PosCardTerminalGateway` para terminal integrada futura
- [x] Tickets comerciales no fiscales + reimpresión auditada

## Fase 8 — Movimientos de efectivo

- [x] Ledger inmutable con 11 tipos
- [x] Entradas, salidas, retiro de seguridad, reposición, ajuste autorizado
- [x] Transferencias entre cajas con dos efectos vinculados y confirmación de recepción
- [x] Aprobación / rechazo / cancelación con separación de funciones
- [x] Reversa + ajuste compensatorio en lugar de edición

## Fase 9 — Arqueos y cortes

- [x] Arqueo ciego: sin esperado, diferencia ni total del sistema en la respuesta
- [x] Recálculo del total a partir de denominaciones
- [x] Versionado de conteos (nunca se sobrescribe)
- [x] Creación del corte al enviar el conteo
- [x] Revisión: aprobar, rechazar, segundo conteo, aclaración, escalar, reabrir
- [x] Clasificación por tolerancia y umbrales por rol
- [x] Incidencias automáticas por diferencia
- [x] Cortes de sesión (consolidación de turnos)

## Fase 10 — Devoluciones y reembolsos

- [x] Devolución parcial y total con validación de cantidades acumuladas
- [x] Reparto de reembolso en pagos mixtos
- [x] Reembolso en efectivo → ledger; reembolso de tarjeta → conciliación
- [x] Reposición de inventario condicionada a la condición física
- [x] Aprobación / rechazo / completado con motivo

## Fase 11 — Cierre diario, reportes y exportaciones

- [x] `readiness` con checklist de bloqueos
- [x] `preview` consolidado por caja, turno, cajero, método, movimientos y diferencias
- [x] `close` idempotente y único por fecha
- [x] `force-close` con permiso especial, motivo, bloqueos ignorados e incidencia
- [x] 6 reportes paginados con filtros y orden allowlisted
- [x] Exportaciones CSV con permisos, expiración, auditoría y límites

## Fase 12 — Transporte y contrato

- [x] `validators/pos.validators.ts` con `.strict()` en todos los comandos
- [x] `routes/pos.routes.ts` montado en `/api/pos/v1`
- [x] `openapi/pos-v1.openapi.yaml` + `npm run validate:pos-openapi`
- [x] Registro en `functions/src/routes/index.ts`

## Fase 13 — Pruebas

- [x] Unitarias de dominio: dinero, fecha operativa, capacidades, estados, arqueo, efectivo esperado, clasificación, reparto de reembolso
- [x] Integración con emulador de Firestore: flujos A–E, concurrencia y seguridad
- [x] 10 casos de concurrencia obligatorios
- [x] Casos de seguridad obligatorios (IDOR, escalamiento, arqueo ciego, precios manipulados, mass assignment, App Check)

## Fase 14 — Operación

- [x] `firestore.indexes.json` con los índices del POS
- [x] `firestore.rules` con bloque explícito `pos*` cerrado a clientes
- [x] `firebase.json` con emulador de Auth y config de pruebas del POS
- [x] Seed idempotente para emulador
- [x] Script de migración con `--dry-run` y confirmación explícita para producción
- [x] `.env.example`, `README`, guías de emulador/pruebas/migración/despliegue
- [x] OpenAPI `pos-v1.openapi.yaml` + `npm run validate:pos-openapi`
- [x] Endpoints `GET|PUT /operators/:uid`
- [x] Integración con el workflow de CI existente
- [x] `docs/POS_BACKEND_OPERATIONS.md`

---

## Estado final por fase

| Fase | Estado | Nota |
|------|--------|------|
| 0 Inspección | Completa | — |
| 1 Diseño | Completa | — |
| 2 Núcleo | Completa | — |
| 3 Dominio | Completa | — |
| 4 Infraestructura | Completa | — |
| 5 Cajas/turnos | Completa | — |
| 6 Ventas | Completa | — |
| 7 Pagos | Completa | Terminal integrada no implementada por diseño: solo existe la interfaz y el gateway manual |
| 8 Efectivo | Completa | — |
| 9 Cortes | Completa | — |
| 10 Devoluciones | Completa | Reembolso bancario de tarjeta se registra como operación externa; no se simula conexión |
| 11 Cierre/reportes | Completa | Exportación sincrónica (DEC-11); XLSX y PDF no implementados por falta de librería mantenida en el repo |
| 12 Transporte | Completa | — |
| 13 Pruebas | Completa | Las pruebas de integración requieren el emulador de Firestore (`npm run test:pos:emulator`) |
| 14 Operación | Completa | La migración de producción **no** se ejecutó, por instrucción explícita |

## Fuera de alcance (no implementado, intencional)

CFDI/SAT/XML/PDF fiscal, facturas, factura global, datos fiscales de cliente, PAC, portal de
autofacturación, complementos de pago, notas de crédito fiscales, contabilidad, nómina, CRM,
multi-sucursal, rediseño de frontend, apps móviles, sustitución de Stripe/Aplazo, procesamiento
directo de datos bancarios, captura o almacenamiento de datos de tarjeta.

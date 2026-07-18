# Baseline verificable: controles vigentes y writers que bloquean las mutaciones de Admin Copilot

> **Veredicto actual:** los controles entregados de App Check, ownership acotado, separación Shopping/Admin, compatibilidad legacy y grounding por ID están implementados y sus pruebas pasan. **Admin Copilot debe permanecer estrictamente read-only.** La capa canónica de comandos administrativos todavía no existe y los writers actuales no comparten idempotencia, auditoría ni control de versión. Además, `ProductService.updateProduct` puede sobrescribir inventario concurrente al reescribir `tallaIds`, `inventarioPorTalla`, `existencias` y `disponible` durante una actualización de metadata.

Este documento cierra la evidencia de **TAREA 1** y el diseño/base de migración de **TAREA 2**. No habilita `prepare`, `confirm`, `commit` ni tools mutables.

## Camino de revisión

1. Confirmar el veredicto y la matriz de controles.
2. Revisar primero el hallazgo P0 de `updateProduct`.
3. Usar el mapa de writers como inventario de migración; no migrarlos masivamente.
4. Implementar la capa canónica en el orden incremental propuesto.
5. Mantener las mutaciones de Admin Copilot bloqueadas hasta completar CAS, fencing, recovery e idempotencia adversarial.

## 1. Matriz del estado verificado

| Control | Implementado | Prueba existente | Riesgo pendiente |
|---|---:|---:|---|
| App Check independiente del JWT | Sí. `functions/src/routes/ai.routes.ts:router.use(aiAppCheckMiddleware)` protege el router de IA; `functions/src/middleware/ai-app-check.middleware.ts:aiAppCheckMiddleware` verifica con Firebase Admin y resuelve `observe`/`enforce`. | `functions/tests/ai.app-check.middleware.test.ts`: token válido, ausente, inválido, header manipulado, JWT que no omite App Check, observe, bypass local y fail-closed en producción. | Falta evidencia de rollout/configuración real en Firebase; `observe` no bloquea. El bypass debe seguir limitado a runtime local explícito. |
| Ownership e IDOR en recursos ya revisados | Sí, para sesiones/mensajes asociados, assets, pedidos y Try-On revisados. La ocultación usa respuesta equivalente a inexistente; evidencia en `AiChatService.assertAttachmentsOwnedByUser`, `OrdenService.getOrderStatusForAssistant` y `tryon.controller`. | `functions/tests/ai.chat.service.test.ts`, `ai.order-ownership.test.ts`, `ai.tryon-ownership.test.ts`, `ai.file.service.test.ts`; incluyen dos usuarios y excepción de ADMIN donde aplica. | No equivale a la auditoría exhaustiva de TAREA 9: faltan pruebas integrales para tool calls, puntos, feedback, trazas, propuestas/operaciones administrativas y todas las signed URLs/descargas. |
| Separación Shopping Agent / Admin Copilot | Sí. `functions/src/models/ai/ai.model.ts:AiAgentType`, `AiChatService.createAdminSession`, prompts separados y tool selection por `agentType`. El tipo administrativo se deriva en backend y exige rol ADMIN. | `functions/tests/ai.agent-type.test.ts`, `ai.chat.service.test.ts`, `ai.orchestrator.test.ts`, `ai.tool-registry.test.ts`. | Las definiciones ejecutables de tools mutables siguen en código; la seguridad depende también de que ninguna ruta alternativa evite el registry. Debe conservarse el deny explícito. |
| Compatibilidad de sesiones legacy | Sí. `functions/src/models/ai/ai.model.ts:resolveAiAgentType` degrada cualquier valor distinto de `admin` a `shopping`. | `functions/tests/ai.agent-type.test.ts:trata sesiones legacy...`; `ai.chat.service.test.ts:acepta una sesion legacy...`. | No hay migración/backfill ni métrica de volumen legacy; la compatibilidad es segura por menor privilegio, pero mantiene deuda de datos. |
| Grounding de producto por ID | Sí. `TiendaFrontCL/src/lib/ai/message-content.ts:buildProductContextMessage` serializa `type`, `productId` y `pageContext`; no serializa datos comerciales. Las consultas de detalle, precio, stock y variantes disponibles para el agente se resuelven mediante tools del backend. | `TiendaFrontCL/src/lib/ai/message-content.test.ts`: contexto mínimo, rechazo de datos comerciales/instrucciones y compatibilidad de marcador legacy. | El marcador legacy sigue siendo aceptado para lectura de transcript; deben mantenerse los schemas estrictos y la rehidratación backend en cada nueva UI. |
| Shopping Agent sin tools administrativas | Sí. `functions/src/services/ai/tools/definitions.ts` separa `shoppingAgentTypes`/`adminAgentTypes`; `ToolRegistryService.getAllowedTools` filtra por agente. | `functions/tests/ai.tool-registry.test.ts:Shopping Agent conserva tools comerciales y nunca recibe tools admin`. | Nuevas tools necesitan test negativo explícito para Shopping; no basta con confiar en el nombre `admin_*`. |
| Admin Copilot sin tools mutables | Sí, **read-only por diseño actual**. `functions/src/services/ai/rbac/tool-registry.service.ts:MODEL_DENIED_TOOL_NAMES` bloquea update stock/price/publish/hide tanto en listado como lookup directo; los prompts dicen “solo lectura”. | `functions/tests/ai.tool-registry.test.ts:Admin Copilot recibe lectura...`, `nunca expone mutaciones administrativas...`; `ai.agent-type.test.ts:mantiene prompts separados...`. | P0 si el deny se elimina antes de tener capa canónica, CAS, fencing, recovery e idempotencia. Las implementaciones dormidas en `definitions.ts` y `StoreAiBusinessService.admin*` siguen siendo writers potenciales. |

### Evidencia de commits revisados

| Repositorio | Commit | Alcance confirmado |
|---|---|---|
| BackendCL | `7784a01` — `fix(ai): enforce app check and resource ownership` | Middleware App Check, rutas IA, ownership y pruebas App Check/IDOR. |
| BackendCL | `5c479c7` — `feat(ai): separate shopping and admin agents` | Tipo persistido, sesiones/rutas/prompts/RBAC/toolsets separados y pruebas. |
| TiendaFrontCL | `5ece852` — `fix(ai): ground product context by identifier` | Marcador identifier-only y cobertura contra datos comerciales/instrucciones del producto. |

## 2. Hallazgo crítico: una actualización de metadata puede revertir inventario

**P0 — lost update cross-path.** `functions/src/services/product.service.ts:ProductService.updateProduct` realiza este patrón:

1. lee el producto fuera de transacción (`docRef.get`);
2. aunque el request solo cambie precio, publicación, descripción, imágenes o categoría, reconstruye `tallaIds` e `inventarioPorTalla` desde esa lectura;
3. deriva `existencias` y `disponible`;
4. ejecuta `docRef.update({...payload})` sin precondición de versión.

La evidencia está en `ProductService.updateProduct`, especialmente el armado de `inventarioInput`, `inventarioPorTalla` y `payload`, y el `docRef.update`. Si `ProductService.updateStock`, `replaceSizeInventory` o `InventoryReservationService` escribe inventario después de la lectura y antes del update de metadata, `updateProduct` puede reponer el snapshot anterior. Esto contradice la condición “un writer concurrente no puede ser sobrescrito”.

**Implicación inmediata:**

- no conectar `StoreAiBusinessService.adminUpdatePrice`, `adminPublishProduct` ni `adminHideProduct` a un modelo;
- no tratar una transacción interna de inventario como protección suficiente mientras otro writer actualiza el mismo documento fuera de transacción;
- el primer corte de la capa canónica debe separar metadata/pricing/publicación de inventario y aplicar CAS/precondición explícita a los campos o documento afectados.

## 3. Mapa exhaustivo de writers encontrados

### Cómo leer la tabla

- **Transacción** indica atomicidad local del write actual; no implica seguridad de una propuesta de larga duración.
- **Idempotencia** es `Sí` solo cuando la deduplicación está unida atómicamente al cambio. “Parcial” significa cache/marker separado o cobertura solo para una variante del flujo.
- **Control de versión** exige CAS/precondición/versionado explícito. Una transacción Firestore evita lost updates dentro de esa transacción, pero no sustituye una versión esperada conservada desde `prepare`.
- La búsqueda del frontend no encontró escrituras Firestore directas en panel/admin o proxies: las pantallas usan API/BFF. `TiendaFrontCL/src/lib/firebase/client.ts:getFirestore` inicializa el cliente, pero no apareció `setDoc`, `updateDoc`, `addDoc`, `deleteDoc`, `writeBatch` ni `runTransaction` en esos paths.

| Recurso | Writer (evidencia archivo:símbolo) | Servicio utilizado | Usa transacción | Tiene idempotencia | Tiene control de versión |
|---|---|---|---:|---:|---:|
| Producto, precio, publicación, visibilidad, tallas/variantes | `POST /api/productos`, `PUT /api/productos/:id`, `PATCH /api/productos/:id/estado`, `DELETE /api/productos/:id` — `functions/src/routes/products.routes.ts` → `products.command.controller:create/update/setActiveStatus/remove` | `ProductService.createProduct/updateProduct/setProductActiveStatus/deleteProduct` | No | No | No |
| Producto, precio, publicación y metadata desde panel | `TiendaFrontCL/src/app/admin/productos/page.tsx:handleSave/handleDelete` y el toggle de visibilidad inline | `productsAdminApi.create/update/delete/setProductActiveStatus` → BFF `/api/productos` → backend anterior | No adicional | No | No |
| Imágenes del producto | `products.command.controller:uploadImages/deleteImage`; panel `AdminProductsPage:handleSave` mediante `productsAdminApi.uploadImages/deleteImage` | `StorageService` + `ProductService.updateProduct` | No | No | No; además hereda el P0 de reescritura de inventario |
| Detalles/atributos de producto | `POST/PUT/DELETE /api/productos/:id/detalles`; `detalleProducto.command.controller:createDetalle/updateDetalle/deleteDetalle`; panel `AdminProductsPage:syncProductDetails` | `DetalleProductoService.createDetalle/updateDetalle/deleteDetalle` | Crear/eliminar: sí; actualizar: no | No | Solo snapshot transaccional en crear/eliminar; sin versión esperada |
| Rating agregado en producto | `functions/src/controllers/products/products.command.controller.ts:rateProduct` → `ProductRatingService.upsertProductRating` | Escritura de rating y `ratingSummary` en `productos` | Sí | Sí por rating de usuario/documento | Solo snapshot transaccional; sin versión de comando |
| Inventario puntual | `PUT /api/productos/:id/stock` — `products.command.controller:updateStock`; panel `InventoryAdjustmentsPage:onSubmitPuntual` | `ProductService.updateStock` | Sí, producto + movimiento | No | Solo snapshot transaccional |
| Inventario por talla/variantes | `PUT /api/productos/:id/inventario-tallas` — `products.command.controller:replaceSizeInventory`; panel `InventoryAdjustmentsPage:onSubmitMasivo` | `ProductService.replaceSizeInventory` | Sí, producto + movimientos | No | Solo snapshot transaccional |
| Movimientos/ajustes legacy de inventario | `POST /api/inventario/movimientos`, `POST /api/inventario/ajustes` — `inventory.command.controller:registerMovement/registerAdjustment` | `InventoryService.registerMovement/registerAdjustment` → `ProductService.updateStock` | Cambio de stock: sí; dedupe se guarda después | Parcial y no atómica: el cache idempotente se escribe después del stock | Sin versión esperada |
| Recepciones de mercancía | `POST /api/inventario/recepciones`, `PUT .../lineas`, `POST .../confirmar|cerrar` — `inventory-reception.command.controller:*`; panel `InventoryRecepcionesPage:handleCreate/handleConfirm/handleClose` | `InventoryReceptionService`; confirmación llama `InventoryService.registerRecepcionMovement` | No como operación completa; cada stock sí | Parcial; confirmación/cache no están en la misma transacción global | No |
| Reservas de inventario de checkout/orden | `functions/src/services/inventory-reservation.service.ts:reserveForCheckoutAttempt/reserveForOrder/releaseCheckoutAttemptReservations/releaseOrderReservations/confirmOrderReservations` | `InventoryReservationService` escribe `productos`, reservas y movimientos | Sí por lote/ítem según método | Sí/Parcial mediante IDs deterministas y estados de reserva | Solo snapshot transaccional; sin versión externa |
| Migración y reconciliación de reservas | `InventoryReservationService:migrateReservationsToOrder/expireDueReservations/reconcilePaidOrdersWithoutSale/repairOrphanActiveReservations` | `InventoryReservationService` | Mixto: batch y transacciones por caso | Parcial por estado | No versión de comando |
| Job programado de inventario | `functions/src/inventory-reservation.cron.ts:expireInventoryReservations` | Orquesta expiración/reconciliación anterior cada 5 minutos | Hereda cada servicio | Hereda cada servicio | No coordinación con comandos administrativos |
| Confirmación/liberación por orden | `functions/src/services/orden.service.ts:commitStockForOrder/releaseUnpaidOrder/cancelarOrden` | `InventoryReservationService` y restauración de stock | Mixto | Parcial por estados de orden/reserva | Sin versión esperada común |
| Stock legacy general | `functions/src/services/product.service.ts:decrementStock/incrementStock/restoreStockFromOrder` | `ProductService` directo sobre `productos.existencias` | Sí por producto; restore es secuencial | No | Solo snapshot transaccional |
| Ofertas CRUD/estado/alcance por producto/categoría/línea/talla | `POST/PUT/DELETE /api/ofertas` — `ofertas.command.controller:crear/actualizar/eliminar`; panel `AdminOfertasPage:handleSave/handleConfirmDelete` | `OfertasService.crearOferta/actualizarOferta/eliminarOferta` | No | No | No |
| Stock consumido de oferta | `PaidOrderFinalizerService.commitPromotionalCounters` → `OfertasService.commitOfferStockForOrder/incrementarStockVendidoOfertaForOrder` | `OfertasService` + marker `ofertaStockUsos/{orden}_{oferta}` | Sí | Sí por orden+oferta en `...ForOrder`; método `incrementarStockVendidoOferta` no | Solo snapshot transaccional |
| Snapshot desnormalizado de oferta en producto | `OfertasService` CRUD y `POST /api/ofertas/sincronizar-snapshots`; `ProductOfferSnapshotService.syncProductOfferSnapshot/syncProductsByIds/syncProductsAffectedByOffer/backfillAllActiveProducts` | `ProductOfferSnapshotService` escribe campos de oferta y `updatedAt` en `productos` | No en single; batch en bulk | Parcial: recalcula el snapshot, pero actualiza `updatedAt` y no tiene receipt idempotente | No; puede competir con otros writers del producto |
| Códigos promocionales CRUD/estado/alcance | `POST/PUT/DELETE /api/codigos-promocion` — `codigosPromocionCommandController:crear/actualizar/eliminar`; panel `AdminOfertasPage:handleSaveCodigoPromocion/handleConfirmDelete` | `codigosPromocionService.crear/actualizar/eliminar` | No | No | No |
| Contadores de código promocional | `PaidOrderFinalizerService.commitPromotionalCounters` → `codigosPromocionService.registrarUsoOrden`; también existe `registrarUso` | `codigosPromocionService` | Sí | Sí por orden+código solo en `registrarUsoOrden`; `registrarUso` no | Solo snapshot transaccional |
| Categorías/visibilidad | `POST/PUT/DELETE /api/categorias` y endpoints de imagen — `categories.command.controller:*`; panel `AdminCategoriasPage:onSubmit/onDelete` | `CategoryService.createCategory/updateCategory/deleteCategory` + `StorageService` | No | No | No |
| Tallas/variantes de catálogo | `POST/PUT/DELETE /api/tallas` — `sizes.command.controller:create/update/remove`; panel `AdminTallasPage:onSubmit/onDelete` | `size.service:createSize/updateSize/deleteSize` | No | No | No; delete hace check-then-delete fuera de transacción |
| Líneas relacionadas con categorías/ofertas | `POST/PUT/DELETE /api/lineas` y endpoints de imagen — `lines.command.controller:*`; panel `AdminLineasPage:onSubmit/onDelete` | `LineService.createLine/updateLine/deleteLine` + `StorageService` | No | No | No |
| Tools IA mutables dormidas | `functions/src/services/ai/tools/definitions.ts:admin_update_stock/admin_update_price/admin_publish_product/admin_hide_product` | `StoreAiBusinessService.adminUpdateStock/adminUpdatePrice/adminPublishProduct/adminHideProduct` → `ProductService` | Hereda servicio | No | No. **Bloqueadas hoy por `MODEL_DENIED_TOOL_NAMES`** |
| Backfill de búsqueda de productos | `functions/src/scripts/backfill-product-search-text.ts:backfillProductSearchText`; `ProductService.backfillProductSearchText` | Batch directo a `productos.searchText/updatedAt` | Batch, no transacción de lectura+write | Repetible por valor | No |
| Migraciones de inventario | `functions/src/scripts/migrate-inventory-v2.ts:migrateInventoryV2`; `functions/src/scripts/migrate-size-inventory.ts:migrateProductsSizeInventory` | Batch directo a `productos` | No | Dry-run/repetible según normalización; sin receipt | No |
| Reparación de inventario de órdenes no pagadas | `functions/src/scripts/repair-unpaid-orders-inventory.ts:repairUnpaidOrdersInventory` | `InventoryService.registerMovement` registra devoluciones y el script marca la orden con merge | No global | Parcial por estado/documento | No |
| Seed/importador de catálogo | `functions/src/scripts/seed.ts:seedLineas/seedCategorias/seedTallas/seedProductos/seedAiKnowledge` | Firestore batch/set; productos usan `.add`; promociones usan `promocionesTienda/{id}` | Batch por grupo | Parcial: IDs fijos en taxonomía/promos; productos `.add` pueden duplicarse | No |

### Cobertura por dominio solicitada

| Dominio | Writers cubiertos arriba |
|---|---|
| Precio | Product CRUD/update; tool IA dormida; ofertas/códigos y snapshots. |
| Inventario | Product stock, ajustes, recepciones, reservas, órdenes, cron, scripts y tool IA dormida. |
| Productos | CRUD, imágenes, detalles, rating, snapshots, backfill, migraciones y seed. |
| Publicación/visibilidad | `activo` en producto, categoría y línea; `estado` en ofertas/códigos. |
| Ofertas/promociones | CRUD admin, contadores por pago, snapshot a producto y seed de `promocionesTienda`. |
| Variantes/tallas | `tallaIds`, `inventarioPorTalla`, tallas CRUD, reservas/stock por talla. No existe una colección `variantes` independiente en la evidencia revisada. |
| Categorías | Categorías CRUD/imágenes; referencias desde producto, oferta, código y líneas. |

## 4. Diseño objetivo de la capa canónica

La capa debe vivir debajo de HTTP, panel administrativo y tools IA. Ningún adapter decide reglas comerciales ni escribe Firestore directamente.

### Contrato mínimo

```ts
type CatalogCommandEnvelope<TCommand> = {
  commandId: string;
  commandType: string;
  actor: { uid: string; role: string; scopes: string[] }; // derivado del token
  idempotencyKey: string;
  payloadHash: string;
  expectedVersions: Array<{ resourcePath: string; updateTime: string }>;
  reason: string;
  traceId: string;
  command: TCommand;
};
```

El dispatcher canónico debe:

1. derivar actor/rol/scopes en backend;
2. validar comando tipado con schema estricto y sin propiedades adicionales;
3. cargar el estado real y aplicar reglas de negocio deterministas;
4. unir en una transacción el receipt de idempotencia, la comparación de versión, la mutación y la auditoría;
5. rechazar la misma key con hash distinto;
6. devolver el mismo resultado para una repetición válida;
7. registrar actor, comando, recursos, antes/después mínimo, resultado, versión y trace sin secretos;
8. emitir side effects posteriores mediante outbox/retry idempotente, nunca ocultar su fallo;
9. no depender del modelo ni confiar en precio/stock/rol/UID del frontend.

### Límites de módulos

| Componente | Responsabilidad | Prohibido |
|---|---|---|
| HTTP/BFF/panel/tool adapter | Autenticación de transporte, CSRF/App Check cuando aplique, parsear y construir comando | Escribir Firestore o decidir precio/stock |
| `CatalogCommandDispatcher` | Autorización, idempotencia, auditoría, transacción y routing tipado | Texto libre del modelo como comando ejecutable |
| Handler por recurso | Reglas del dominio y patch mínimo | Reescribir campos ajenos al comando |
| Repository transaccional | Reads/writes con precondición y versionado | Read-modify-write fuera de transacción |
| Outbox | Side effects idempotentes y observables | Convertir un fallo de side effect en éxito silencioso |

## 5. Orden incremental de implementación y migración

1. **Cerrar P0 antes de agregar mutaciones.** Separar `updateProductMetadata`, `changeProductPrice`, `changeProductPublication` y comandos de inventario. Cada handler escribe solo sus campos; agregar prueba adversarial metadata-vs-stock.
2. **Infraestructura canónica sin consumers.** Tipos, schemas, autorización backend, repositorio de idempotencia/hash, audit log, expected version/CAS y outbox. Probar repetición, key con payload distinto y writer concurrente.
3. **Precio y publicación de un solo producto.** Migrar primero endpoints legacy `PUT/PATCH productos`; mantener adapters compatibles. No habilitar tools IA. Medir diff y rollback por command receipt.
4. **Inventario puntual.** Migrar `updateStock` y `/inventario/ajustes`, uniendo movimiento+idempotencia+producto en una transacción. Luego migrar inventario masivo por talla con resultado por ítem.
5. **Reservas, órdenes y recepciones.** Hacer que todos los writers de inventario compartan las mismas invariantes/versionado. El cron y recovery deben usar los mismos comandos internos, no patches directos.
6. **Ofertas y códigos.** Migrar CRUD primero; después contadores de pago, conservando markers por orden. Separar snapshots desnormalizados mediante outbox versionada.
7. **Taxonomía y variantes.** Migrar categorías, líneas y tallas; hacer atómico el check de talla en uso. Mantener compatibilidad documental.
8. **Scripts/importadores/jobs.** Convertirlos en adapters explícitos con dry-run, scope, límite, receipt, auditoría y reanudación; no permitir bypass por credenciales administrativas.
9. **Preparación administrativa.** Solo después de que los writers anteriores estén cubiertos, diseñar `prepare` read-only sobre los handlers canónicos y conservar `updateTime`/versiones de todos los recursos.
10. **Admin Copilot mutable, al final.** Habilitar una tool por recurso únicamente cuando sus pruebas de CAS, fencing, lease vencido, crash recovery, parcialidad e idempotencia pasen. Hasta entonces, mantener `MODEL_DENIED_TOOL_NAMES` y prompts read-only.

### Regla de migración

Cada recurso se migra como work unit independiente: handler + adapter legacy + pruebas + evidencia. No retirar el writer anterior hasta demostrar que todos sus consumidores pasan por el adapter canónico. No usar una migración masiva para “normalizar” el catálogo mientras coexistan writers sin versión.

## 6. Verificación ejecutada para este baseline

### Evidencia actual

| Área | Comando ejecutado | Resultado exacto |
|---|---|---|
| Backend Functions build | `cd BackendCL/functions && npm run build` | **PASS**, `tsc`, exit `0`. |
| Backend suite IA | `cd BackendCL/functions && npx jest --runInBand --testPathPatterns='ai'` | **PASS**, `28` suites, `130` tests, `0` fallos, `0` snapshots; exit `0`. |
| Frontend unit | `cd TiendaFrontCL && npm run test:unit` | **PASS**, `33` tests, `9` suites, `0` fallos/cancelados/skipped; exit `0`. |
| Frontend typecheck | `cd TiendaFrontCL && npm run typecheck` | **PASS**, `next typegen` y `tsc --noEmit`; exit `0`. npm emitió warnings de configuración legacy con bytes NUL, no fallos de tipos. |

### Evidencia histórica, no revalidada en este work unit

- Frontend lint: reportado previamente como PASS con `82` warnings preexistentes.
- Frontend build: reportado previamente como PASS con `45` páginas.
- Backend evals: reportadas previamente como `5` tests PASS.
- Índices/exportaciones: reportados previamente como `79` índices JSON y `26` exports de Functions.

Estos resultados históricos sirven de contexto, no como gate actual. Este baseline no ejecutó lint/build completo del frontend, E2E, emuladores, rules tests ni deploy.

## 7. Riesgos y siguiente work unit

### P0 — bloquean cualquier mutación de Admin Copilot

1. `ProductService.updateProduct` reescribe inventario desde una lectura obsoleta al cambiar metadata/precio/publicación.
2. Los writers catalogados no comparten versión/CAS, receipt de idempotencia ni auditoría canónica.
3. `InventoryService` y recepciones guardan dedupe después del cambio; una carrera puede duplicar movimientos.
4. Scripts/jobs/legacy writers pueden evitar cualquier lock consultivo o flujo de propuesta.
5. Las tools mutables existen como código dormido; quitar el deny hoy reabriría writes inseguros.

### P1 — deben cerrarse antes de una migración amplia

1. Snapshots de oferta y backfills modifican `updatedAt` del producto sin versión coordinada.
2. CRUD de talla/categoría/línea usa check-then-write fuera de transacción.
3. Idempotencia y control de versión son inconsistentes entre reservas, contadores de pago y administración.
4. La auditoría ownership todavía no cubre todos los recursos enumerados por TAREA 9.
5. Falta un gate reproducible de emuladores/rules/E2E para probar concurrencia entre todos los writers.

### Next work unit ownership

| Owner | Próximo work unit | Criterio de salida |
|---|---|---|
| Backend catálogo/inventario | Separar metadata de inventario y corregir el P0 de `updateProduct` | Prueba adversarial demuestra que update de precio/publicación no revierte un stock concurrente; patch no incluye campos de inventario. |
| Backend plataforma | Crear skeleton de `CatalogCommandDispatcher`, idempotency receipt, audit y expected-version repository | Tests de misma key/mismo hash, misma key/hash distinto y CAS conflict; aún sin conectar IA. |
| Backend QA/seguridad | Construir harness de concurrencia multi-writer con Emulator | Cubre endpoint legacy vs comando, dos admins y job/reserva concurrente. |
| Frontend admin | Sin cambios funcionales todavía; conservar adapters HTTP actuales | Contratos se mantienen mientras backend migra recurso por recurso. |
| AI | Mantener Admin Copilot read-only y el deny de mutaciones | `ai.tool-registry.test.ts` sigue probando cero tools mutables para Shopping y Admin. |

**skill_resolution: paths-injected** (`cognitive-doc-design`).

## Key Learnings:

1. La transacción de inventario no evita lost updates si `updateProduct` reescribe esos campos desde una lectura externa obsoleta.
2. El panel administrativo no escribe Firestore directamente; sus writers reales terminan en servicios backend y deben migrarse allí.
3. Las tools mutables están bloqueadas por registry, pero sus implementaciones siguen presentes y deben considerarse writers potenciales.
4. La idempotencia de ajustes/recepciones no es atómica cuando el receipt se guarda después de modificar stock.

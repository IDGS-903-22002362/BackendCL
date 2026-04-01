# Aplazo Payments Backend

## Documentos relacionados

- Frontend consumption guide: [aplazo-frontend-consumption.md](./aplazo-frontend-consumption.md)

## Resumen

Esta integración agrega Aplazo como proveedor alternativo sin tocar las rutas legacy de Stripe:

- Stripe legacy:
  - `/api/pagos/*`
  - `/api/stripe/*`
- Aplazo nuevo:
  - `POST /api/payments/aplazo/online/create`
  - `POST /api/payments/aplazo/in-store/create`
  - `GET /api/payments/:paymentAttemptId/status`
  - `POST /api/webhooks/aplazo`
  - `POST /api/admin/payments/aplazo/:paymentAttemptId/reconcile`
  - `POST /api/admin/payments/aplazo/:paymentAttemptId/cancel`
  - `POST /api/admin/payments/aplazo/:paymentAttemptId/refund`
  - `GET /payments/aplazo/success`
  - `GET /payments/aplazo/failure`
  - `GET /payments/aplazo/cancel`

## Source Of Truth

- Online:
  - El webhook válido de Aplazo es la fuente principal.
  - El return URL solo sirve para UX y polling.
- In-store:
  - El webhook válido de Aplazo es la fuente principal.
  - Reconcile backend funciona como respaldo operativo.

## Variables De Entorno

### Global

- `APLAZO_ENABLED`
- `APLAZO_ENV`
- `APLAZO_INTEGRATION_VERSION`
- `APLAZO_ONLINE_ENABLED`
- `APLAZO_INSTORE_ENABLED`
- `APLAZO_REFUNDS_ENABLED`
- `APLAZO_RECONCILE_ENABLED`

### Online

- `APLAZO_ONLINE_BASE_URL`
- `APLAZO_ONLINE_MERCHANT_ID`
- `APLAZO_ONLINE_API_TOKEN`
- `APLAZO_ONLINE_WEBHOOK_SECRET`
- `APLAZO_ONLINE_SUCCESS_URL`
- `APLAZO_ONLINE_CANCEL_URL`
- `APLAZO_ONLINE_FAILURE_URL`
- `APLAZO_ONLINE_CART_URL`
- `APLAZO_ONLINE_TIMEOUT_MS`
- `APLAZO_ONLINE_CREATE_PATH`
- `APLAZO_ONLINE_STATUS_PATH`
- `APLAZO_ONLINE_CANCEL_PATH`
- `APLAZO_ONLINE_REFUND_PATH`

### In-Store

- `APLAZO_INSTORE_BASE_URL`
- `APLAZO_INSTORE_MERCHANT_ID`
- `APLAZO_INSTORE_API_TOKEN`
- `APLAZO_INSTORE_WEBHOOK_SECRET`
- `APLAZO_INSTORE_CALLBACK_URL`
- `APLAZO_INSTORE_TIMEOUT_MS`
- `APLAZO_INSTORE_CREATE_PATH`
- `APLAZO_INSTORE_STATUS_PATH`
- `APLAZO_INSTORE_CANCEL_PATH`

## TODOs De Contrato Privado

El adapter `functions/src/services/payments/providers/aplazo.provider.ts` y `functions/src/services/payments/aplazo.contract.v1.ts` contienen los TODOs explícitos para completar con el paquete privado/Postman:

- `// TODO: confirmar nombre exacto con colección Postman de Aplazo`
- `// TODO: confirmar headers exactos con colección Postman de Aplazo`
- `// TODO: confirmar payload exacto con colección Postman de Aplazo`

No se inventaron endpoints ni nombres finales de contrato fuera de esas capas.

## Flujos

### Online Sandbox

1. Crear o reutilizar una orden ecommerce con `metodoPago=APLAZO`.
2. Configurar secrets/env de Aplazo online.
3. Llamar `POST /api/payments/aplazo/online/create` con bearer token del dueño.
4. Redirigir al `redirectUrl` devuelto.
5. Simular callback/webhook sandbox de Aplazo.
6. Verificar estado con `GET /api/payments/:paymentAttemptId/status`.
7. Confirmar que la orden pase a `CONFIRMADA` solo después del webhook/reconcile.

### In-Store Sandbox

1. Abrir una `posSession` con `status=OPEN`.
2. Configurar secrets/env de Aplazo in-store.
3. Llamar `POST /api/payments/aplazo/in-store/create` como `ADMIN` o `EMPLEADO`.
4. Mostrar `paymentLink`, `qrString` o `qrImageUrl` en POS.
5. Simular webhook sandbox o ejecutar reconcile manual.
6. Verificar `GET /api/payments/:paymentAttemptId/status`.
7. Confirmar que la `ventaPos` pase a `PAGADA` y que inventario se descuente una sola vez.

## Reconciliación

- Trigger de eventos:
  - `functions/src/services/payments/payment-event.trigger.ts`
- Scheduler:
  - `functions/src/aplazo-payments.cron.ts`
- Colecciones:
  - `pagos`
  - `paymentEventLogs`
  - `ventasPos`
  - `posSessions`
  - `paymentReconciliationReports`

## Rollout Seguro

1. Desplegar con `APLAZO_ENABLED=false`.
2. Completar paths/headers/payloads exactos desde el material privado.
3. Probar sandbox online.
4. Probar sandbox in-store.
5. Activar `APLAZO_ONLINE_ENABLED=true`.
6. Activar `APLAZO_INSTORE_ENABLED=true` cuando POS esté validado.
7. Mantener `APLAZO_REFUNDS_ENABLED=false` hasta certificar refund o proceso manual.

## Runbook Operativo

- Buscar un pago por referencia:
  - Consultar `pagos.providerReference`
  - Consultar `paymentEventLogs.providerReference`
- Reintentar reconcile manual:
  - `POST /api/admin/payments/aplazo/:paymentAttemptId/reconcile`
- Cancelar intento atorado:
  - `POST /api/admin/payments/aplazo/:paymentAttemptId/cancel`
- Refund no soportado por contrato:
  - `POST /api/admin/payments/aplazo/:paymentAttemptId/refund`
  - El backend deja `refundState=requested`
- Si llega un `late paid` después de `canceled/expired/failed`:
  - El intento no reabre orden/stock
  - Se registra divergencia para revisión manual

## Checklist De Certificación

- Pago aprobado online
- Pago rechazado online
- Pago expirado online
- Cancelación online
- Redirect sin webhook
- Webhook sin redirect
- Webhook duplicado
- Reintento idempotente de create
- Pago QR aprobado
- Pago QR expirado
- Link/SMS no abierto
- Reconcile manual exitoso
- Refund soportado o refund manual documentado

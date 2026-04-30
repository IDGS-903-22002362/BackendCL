# Aplazo Frontend Consumption

Guia para consumir Aplazo Online desde storefront y backoffice usando este
backend.

El frontend no debe llamar a Aplazo directo. Este backend autentica contra
Aplazo, crea intentos de pago online, registra el webhook, consulta estado del
proveedor cuando aplica y confirma ordenes solo desde webhook/reconciliacion.

## Bases y reglas comunes

- Base local: `http://localhost:3000`.
- Base Cloud Functions: `https://<region>-<project>.cloudfunctions.net/api`.
- En los ejemplos se muestran paths completos desde la raiz Express. Si usas
  una variable `API_BASE_URL` que ya termina en `/api`, no dupliques `/api`.
- Los endpoints bajo `/api` requieren `Authorization: Bearer <JWT de la app>`,
  excepto webhooks.
- Los endpoints backoffice requieren rol `ADMIN` o `EMPLEADO`; cancelacion y
  refunds manuales exigen `ADMIN` en servicio.
- Usa `Idempotency-Key` en creates cuando el cliente pueda reintentar la misma
  accion. Debe tener entre 8 y 255 caracteres.
- Los schemas son estrictos: campos extra en body se rechazan.
- Estados canonicos del backend: `created`, `pending_provider`,
  `pending_customer`, `authorized`, `paid`, `failed`, `canceled`, `expired`,
  `refunded`, `partially_refunded`.
- No confirmes pago por return URL. Confirma pago solo cuando el status del
  backend sea `paid`.

## Inventario de APIs Aplazo Online implementadas

- Autenticacion Aplazo Online: interna del backend mediante `APLAZO_ONLINE_AUTH_PATH`.
- `POST /api/payments/aplazo/online/create`
- `GET /api/payments/{paymentAttemptId}/status`
- `POST /api/admin/payments/aplazo/{paymentAttemptId}/reconcile`
- `POST /api/admin/payments/aplazo/{paymentAttemptId}/cancel`
- `POST /api/admin/payments/aplazo/{paymentAttemptId}/refund`
- `GET /api/admin/payments/aplazo/{paymentAttemptId}/refund/status`
- `GET /payments/aplazo/success`
- `GET /payments/aplazo/failure`
- `GET /payments/aplazo/cancel`
- `POST /api/webhooks/aplazo`

Nota: no hay rutas separadas del tipo
`/api/payments/aplazo/online/{paymentAttemptId}/status`. Usa el endpoint comun
`GET /api/payments/{paymentAttemptId}/status`.

## Crear pago online

Flujo para ecommerce web. Parte de una orden ya creada en backend con
`metodoPago: "APLAZO"` y `estado: "PENDIENTE"`.

`POST /api/payments/aplazo/online/create`

Headers:

- `Authorization: Bearer <token usuario>`
- `Idempotency-Key: <opcional>`

Body minimo recomendado:

```json
{
  "orderId": "orden_123",
  "successUrl": "https://frontend.com/payments/aplazo/success",
  "cancelUrl": "https://frontend.com/payments/aplazo/cancel",
  "failureUrl": "https://frontend.com/payments/aplazo/failure",
  "cartUrl": "https://frontend.com/cart"
}
```

Reglas:

- `orderId` es requerido.
- `customer.name`, `customer.email`, `customer.phone` son opcionales en schema,
  pero el backend debe poder resolver los tres desde body, JWT o `usuariosApp`.
- `successUrl` debe venir en body o configuracion.
- `failureUrl` debe venir en body o configuracion; si no viene, se usa
  `cancelUrl`.
- `metadata.cartId` es opcional. Si no viene, el backend usa `orderId` como
  referencia Aplazo.
- `total` es opcional. Si se envia, debe coincidir con el total recalculado en
  backend desde la orden.
- `currency` es opcional. Si se envia, solo se acepta `MXN`.
- `items`, `subtotal`, `tax`, `shipping` se aceptan por contrato, pero la fuente
  de verdad para online es la orden persistida.

Respuesta `201` si se creo, `200` si fue reintento idempotente o ya habia un
intento no terminal:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_123",
  "provider": "aplazo",
  "flowType": "online",
  "status": "pending_customer",
  "redirectUrl": "https://checkout.aplazo.net/...",
  "checkoutUrl": "https://checkout.aplazo.net/...",
  "expiresAt": "2026-04-30T18:30:00.000Z"
}
```

Uso storefront:

1. Crear orden con `metodoPago: "APLAZO"`.
2. Crear intento online.
3. Guardar `paymentAttemptId`.
4. Redirigir a `checkoutUrl` o `redirectUrl`.
5. Al volver de Aplazo, consultar status en backend.
6. Mostrar pago exitoso solo con `status: "paid"`.

## Consulta estado de pago

`GET /api/payments/{paymentAttemptId}/status`

Headers:

- `Authorization: Bearer <token usuario o backoffice>`

Respuesta:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_123",
  "provider": "aplazo",
  "status": "pending_customer",
  "providerStatus": "No confirmado",
  "amount": 1299,
  "currency": "MXN",
  "paidAt": null,
  "expiresAt": "2026-04-30T18:30:00.000Z",
  "isTerminal": false,
  "nextPollAfterMs": 3000
}
```

Regla de polling:

- Si `isTerminal` es `false`, reintenta despues de `nextPollAfterMs`.
- Si `isTerminal` es `true`, detente.
- `paid` confirma pago.
- `failed`, `canceled` y `expired` cierran sin pago.
- `refunded` y `partially_refunded` son estados post-pago.

## Cancela un pago

`POST /api/admin/payments/aplazo/{paymentAttemptId}/cancel`

Headers:

- `Authorization: Bearer <token ADMIN>`

Body:

```json
{
  "reason": "Cliente solicito cancelacion"
}
```

Respuesta:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_123",
  "provider": "aplazo",
  "status": "canceled",
  "providerStatus": "canceled"
}
```

## Solicita un reembolso

`POST /api/admin/payments/aplazo/{paymentAttemptId}/refund`

Headers:

- `Authorization: Bearer <token ADMIN>`

Body:

```json
{
  "reason": "Devolucion parcial",
  "refundAmountMinor": 1000
}
```

Notas:

- `refundAmountMinor` esta en centavos. `1000` equivale a `$10.00`.
- Si se omite, el proveedor/servicio puede tratarlo como refund total segun el
  contrato configurado.
- Si `APLAZO_REFUNDS_ENABLED=false`, el backend registra solicitud manual con
  `refundState: "requested"` sin llamar al proveedor.

Respuesta:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_123",
  "provider": "aplazo",
  "status": "partially_refunded",
  "refundState": "processing"
}
```

## Consulta estado de reembolso

`GET /api/admin/payments/aplazo/{paymentAttemptId}/refund/status`

Headers:

- `Authorization: Bearer <token ADMIN|EMPLEADO>`

Query opcional:

- `refundId=<id de Aplazo>`

Respuesta:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_123",
  "provider": "aplazo",
  "status": "partially_refunded",
  "refundState": "processing",
  "providerStatus": "PROCESSING",
  "refundId": "25083",
  "refundAmount": 10,
  "totalRefundedAmount": 120,
  "currency": "MXN",
  "refunds": [
    {
      "id": "25079",
      "status": "REFUNDED",
      "refundState": "succeeded",
      "refundDate": "2024-12-19T17:45:03.59153",
      "amount": 120
    }
  ]
}
```

## Return URLs

Estas rutas son para el navegador cuando Aplazo redirige de vuelta. No usan JWT.

- `GET /payments/aplazo/success`
- `GET /payments/aplazo/failure`
- `GET /payments/aplazo/cancel`

La return URL solo sirve para UX. El frontend siempre debe consultar
`GET /api/payments/{paymentAttemptId}/status` antes de mostrar confirmacion.

## Webhook Aplazo

`POST /api/webhooks/aplazo`

El webhook es la fuente de verdad para confirmar pagos Aplazo Online.

Headers:

- `Authorization: Bearer <APLAZO_ONLINE_WEBHOOK_SECRET>` si esta configurado.

Procesamiento:

- El evento se deduplica en `paymentEventLogs`.
- La orden se finaliza de forma asincrona por trigger/reconciliacion.
- `loanId` se guarda como referencia de prestamo Aplazo.

## Reconciliacion manual

`POST /api/admin/payments/aplazo/{paymentAttemptId}/reconcile`

Headers:

- `Authorization: Bearer <token ADMIN|EMPLEADO>`

Sin body.

Uso:

- Boton manual de "sincronizar con Aplazo".
- Recuperar intentos online en `pending_provider` por timeout.

## Formatos de error

Errores de pagos usan:

```json
{
  "ok": false,
  "error": {
    "code": "PAYMENT_VALIDATION_ERROR",
    "message": "Mensaje para UI/log",
    "details": {}
  }
}
```

Codigos frecuentes:

- `PAYMENT_AUTH_REQUIRED`
- `PAYMENT_FORBIDDEN`
- `PAYMENT_VALIDATION_ERROR`
- `PAYMENT_ORDER_INVALID`
- `PAYMENT_AMOUNT_MISMATCH`
- `PAYMENT_PROVIDER_ERROR`
- `PAYMENT_PROVIDER_TIMEOUT`
- `PAYMENT_WEBHOOK_INVALID_SIGNATURE`
- `PAYMENT_REFUND_UNSUPPORTED`
- `PAYMENT_REFUND_NOT_FOUND`
- `PAYMENT_FLOW_UNSUPPORTED`

## Checklist frontend

### Web ecommerce

1. Crear orden con `metodoPago: "APLAZO"`.
2. Llamar `POST /api/payments/aplazo/online/create`.
3. Redirigir a `checkoutUrl`.
4. Al volver a success/failure/cancel, resolver UX con la return URL.
5. Consultar `GET /api/payments/{paymentAttemptId}/status`.

### Backoffice refunds

1. Solicitar refund con
   `POST /api/admin/payments/aplazo/{paymentAttemptId}/refund`.
2. Consultar estado con
   `GET /api/admin/payments/aplazo/{paymentAttemptId}/refund/status`.
3. Usar `totalRefundedAmount` como monto confirmado por backend.

## Lo que no debe usarse

- No usar estados en mayusculas (`PENDING_CUSTOMER`, `PAID`) en frontend nuevo.
- No asumir que `success` significa pagado.
- No llamar a APIs de Aplazo desde navegador.
- No enviar secretos, merchant IDs privados o tokens Aplazo al frontend.
- No usar endpoints admin desde storefront publico.
- No usar endpoints Aplazo in-store/POS; ese flujo fue retirado de este backend.

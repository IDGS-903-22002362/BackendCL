# Aplazo Frontend Consumption

Guia corta para consumir Aplazo desde frontend usando este backend.

## Regla base

- El frontend no debe llamar a Aplazo directo.
- El frontend solo consume el backend.
- Los endpoints protegidos usan `Authorization: Bearer <JWT de tu app>`.
- Las return URLs de Aplazo son publicas y no usan JWT.
- Webhooks y endpoints admin no son para frontend.

## Endpoints frontend

### 1. Crear intento Aplazo online

`POST /api/payments/aplazo/online/create`

Headers:

- `Authorization: Bearer <token>`
- `Idempotency-Key: <opcional>`

Body:

```json
{
  "orderId": "orden_123",
  "customer": {
    "name": "Juan Perez",
    "email": "juan@example.com",
    "phone": "4771234567"
  },
  "successUrl": "https://frontend.com/pagos/aplazo/success",
  "cancelUrl": "https://frontend.com/pagos/aplazo/cancel",
  "failureUrl": "https://frontend.com/pagos/aplazo/failure",
  "cartUrl": "https://frontend.com/carrito",
  "metadata": {
    "cartId": "orden_123",
    "addressLine": "Fake Street 123",
    "postalCode": "99999"
  }
}
```

Respuesta `201` o `200`:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_123",
  "provider": "aplazo",
  "flowType": "online",
  "status": "PENDING_CUSTOMER",
  "redirectUrl": "https://checkout.aplazo.net/...",
  "checkoutUrl": "https://checkout.aplazo.net/...",
  "expiresAt": "2026-04-17T18:30:00.000Z"
}
```

Uso frontend:

1. Crear intento.
2. Guardar `paymentAttemptId`.
3. Redirigir a `redirectUrl`.
4. Al volver del checkout, consultar `GET /api/payments/:paymentAttemptId/status`.

Errores mas comunes:

- `401 PAYMENT_AUTH_REQUIRED`: token faltante, invalido o expirado.
- `404 PAYMENT_ORDER_INVALID`: orden no encontrada.
- `403 PAYMENT_FORBIDDEN`: la orden no pertenece al usuario.
- `409 PAYMENT_ORDER_INVALID`: orden no pagable o no fue creada con metodo `APLAZO`.
- `409 PAYMENT_AMOUNT_MISMATCH`: el total enviado por frontend no coincide con backend.
- `400 PAYMENT_VALIDATION_ERROR`: customer/urls/cartId invalidos.
- `502 PAYMENT_PROVIDER_ERROR`: Aplazo rechazo la solicitud.
- `504 PAYMENT_PROVIDER_TIMEOUT`: timeout con Aplazo; el frontend debe seguir consultando status.

### 2. Crear intento Aplazo in-store

`POST /api/payments/aplazo/in-store/create`

Headers:

- `Authorization: Bearer <token>`
- `Idempotency-Key: <opcional>`

Body:

```json
{
  "posSessionId": "sesion_123",
  "deviceId": "device_1",
  "cajaId": "caja_1",
  "sucursalId": "sucursal_1",
  "vendedorUid": "uid_vendedor",
  "customer": {
    "name": "Cliente POS",
    "email": "cliente@example.com",
    "phone": "4771234567"
  },
  "items": [
    {
      "productoId": "prod_1",
      "cantidad": 1
    }
  ],
  "metadata": {
    "commChannel": "q"
  }
}
```

Respuesta `201` o `200`:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_pos_123",
  "provider": "aplazo",
  "flowType": "in_store",
  "status": "PENDING_CUSTOMER",
  "paymentLink": "https://aplazo/pos/venta_pos_1",
  "qrString": "qr_payload",
  "qrImageUrl": "https://aplazo/qr/venta_pos_1.png",
  "expiresAt": "2026-04-17T18:30:00.000Z"
}
```

Uso frontend POS:

1. Crear intento.
2. Renderizar `paymentLink` o `qrImageUrl`.
3. Consultar `GET /api/payments/:paymentAttemptId/status` hasta que cambie a terminal.

Errores mas comunes:

- `401 PAYMENT_AUTH_REQUIRED`
- `403 PAYMENT_FORBIDDEN`: solo `ADMIN` o `EMPLEADO`.
- `400` de validacion Zod
- `409 PAYMENT_AMOUNT_MISMATCH`
- `502 PAYMENT_PROVIDER_ERROR`
- `504 PAYMENT_PROVIDER_TIMEOUT`

### 3. Consultar estado de intento

`GET /api/payments/{paymentAttemptId}/status`

Headers:

- `Authorization: Bearer <token>`

Respuesta `200`:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_123",
  "provider": "aplazo",
  "status": "PENDING_CUSTOMER",
  "providerStatus": "No confirmado",
  "amount": 1299,
  "currency": "MXN",
  "paidAt": null,
  "expiresAt": "2026-04-17T18:30:00.000Z",
  "isTerminal": false,
  "nextPollAfterMs": 3000
}
```

Regla frontend:

- Si `isTerminal` es `false`, volver a consultar despues de `nextPollAfterMs`.
- Si `isTerminal` es `true`, detener polling.

Estados practicos que debes contemplar:

- `PENDING_PROVIDER`
- `PENDING_CUSTOMER`
- `PAID`
- `CANCELED`
- `FAILED`
- `EXPIRED`
- `REFUNDED`
- `PARTIALLY_REFUNDED`

Errores mas comunes:

- `401 PAYMENT_AUTH_REQUIRED`
- `403 PAYMENT_FORBIDDEN`
- `404 PAYMENT_ATTEMPT_NOT_FOUND`
- `502 PAYMENT_PROVIDER_ERROR`
- `504 PAYMENT_PROVIDER_TIMEOUT`

### 4. Return URL success

`GET /payments/aplazo/success`

Query:

- `paymentAttemptId`, o
- `providerPaymentId`, o
- `providerReference`

Si mandas `Accept: application/json`, responde JSON.

Respuesta `200`:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_123",
  "provider": "aplazo",
  "status": "PENDING_CUSTOMER",
  "message": "Estamos validando tu pago con Aplazo. El webhook sigue siendo la fuente de verdad.",
  "isTerminal": false,
  "nextPollAfterMs": 3000
}
```

Uso frontend:

- util cuando Aplazo redirige al navegador
- puedes mostrar la vista con este payload y despues seguir con polling a `/api/payments/:paymentAttemptId/status`

Error comun:

- `400` de validacion si no mandas ninguno de los query params requeridos

### 5. Return URL failure

`GET /payments/aplazo/failure`

Mismo contrato que `success`.

Respuesta `200`:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_123",
  "provider": "aplazo",
  "status": "PENDING_CUSTOMER",
  "message": "Estamos validando tu pago con Aplazo. El webhook sigue siendo la fuente de verdad.",
  "isTerminal": false,
  "nextPollAfterMs": 3000
}
```

Error comun:

- `400` de validacion por query invalido o faltante

### 6. Return URL cancel

`GET /payments/aplazo/cancel`

Mismo contrato que `success`.

Respuesta `200`:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_123",
  "provider": "aplazo",
  "status": "CANCELED",
  "message": "El intento ya no está vigente o fue rechazado.",
  "isTerminal": true,
  "nextPollAfterMs": 0
}
```

Error comun:

- `400` de validacion por query invalido o faltante

## Formatos de error

### Error de pagos

Usado por los endpoints protegidos de pagos:

```json
{
  "ok": false,
  "error": {
    "code": "PAYMENT_PROVIDER_ERROR",
    "message": "Mensaje legible",
    "details": {}
  }
}
```

Codigos utiles para frontend:

- `PAYMENT_AUTH_REQUIRED`
- `PAYMENT_FORBIDDEN`
- `PAYMENT_ATTEMPT_NOT_FOUND`
- `PAYMENT_ORDER_INVALID`
- `PAYMENT_VALIDATION_ERROR`
- `PAYMENT_AMOUNT_MISMATCH`
- `PAYMENT_PROVIDER_ERROR`
- `PAYMENT_PROVIDER_TIMEOUT`

### Error de validacion Zod

Usado por `body`, `params` o `query` invalidos:

```json
{
  "success": false,
  "message": "Validación fallida",
  "errors": [
    {
      "campo": "orderId",
      "mensaje": "String must contain at least 1 character(s)",
      "codigo": "too_small"
    }
  ]
}
```

Nota:

- estos errores no usan la llave `ok`
- para frontend conviene tratarlos como errores de formulario o request invalido

## Flujo recomendado web

1. Crear intento con `POST /api/payments/aplazo/online/create`.
2. Redirigir a `checkoutUrl`.
3. Al volver a `success`, `failure` o `cancel`, leer `paymentAttemptId`.
4. Consultar `GET /api/payments/{paymentAttemptId}/status` hasta `isTerminal = true`.
5. Confirmar pago solo cuando `status = PAID`.

## Flujo recomendado POS

1. Crear intento con `POST /api/payments/aplazo/in-store/create`.
2. Mostrar QR o link.
3. Hacer polling de `GET /api/payments/{paymentAttemptId}/status`.
4. Cerrar flujo solo cuando `isTerminal = true`.

## Regla critica

- `cancel`, `failure` o un error del proveedor no significan pago confirmado.
- El estado final valido para frontend debe salir de `GET /api/payments/{paymentAttemptId}/status`.
- El backend sigue tratando webhook + reconciliacion como fuente de verdad.

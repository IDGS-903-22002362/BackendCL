# Aplazo Frontend Consumption

Guia para consumir Aplazo desde frontend y backoffice usando este backend.

El frontend no debe llamar a Aplazo directo. Este backend crea los intentos,
registra el webhook, consulta el status del proveedor cuando aplica, y confirma
ordenes o ventas POS solo desde webhook/reconciliacion.

## Reglas comunes

- Base local de desarrollo: `http://localhost:3000`.
- Base Cloud Functions: `https://<region>-<project>.cloudfunctions.net/api`.
- Los endpoints bajo `/api` requieren `Authorization: Bearer <JWT de la app>`.
- Los endpoints de POS/admin requieren rol `ADMIN` o `EMPLEADO`.
- Usa `Idempotency-Key` en creates cuando el cliente pueda reintentar la misma
  accion. Debe tener entre 8 y 255 caracteres.
- Los schemas son estrictos: campos extra en body se rechazan.
- Los estados canonicos del backend van en minusculas:
  `created`, `pending_provider`, `pending_customer`, `authorized`, `paid`,
  `failed`, `canceled`, `expired`, `refunded`, `partially_refunded`.
- No confirmes pago por return URL. Confirma pago solo cuando el status del
  backend sea `paid`.

## API Aplazo Online

Flujo para ecommerce web. Parte de una orden ya creada en backend con metodo de
pago `APLAZO` y estado `PENDIENTE`.

### Crear intento online

`POST /api/payments/aplazo/online/create`

Headers:

- `Authorization: Bearer <token>`
- `Idempotency-Key: <opcional>`

Body minimo recomendado:

```json
{
  "orderId": "orden_123",
  "customer": {
    "name": "Juan Perez",
    "email": "juan@example.com",
    "phone": "4771234567"
  },
  "successUrl": "https://frontend.com/payments/aplazo/success",
  "cancelUrl": "https://frontend.com/payments/aplazo/cancel",
  "failureUrl": "https://frontend.com/payments/aplazo/failure",
  "cartUrl": "https://frontend.com/cart",
  "metadata": {
    "cartId": "orden_123"
  }
}
```

Campos aceptados:

- `orderId` requerido.
- `customer.name`, `customer.email`, `customer.phone` opcionales en el schema,
  pero el backend debe poder resolver los tres desde body, JWT o `usuariosApp`.
- `successUrl` requerido por configuracion o body.
- `failureUrl` requerido por configuracion o body; si no viene, se usa
  `cancelUrl`.
- `cancelUrl`, `cartUrl` opcionales.
- `metadata.cartId` opcional. Si no viene, el backend usa `orderId` como
  `cartId` para Aplazo.
- `total` opcional. Si se envia, debe coincidir con el total recalculado por el
  backend.
- `currency` opcional. Si se envia, solo se acepta `MXN`.
- `items`, `subtotal`, `tax`, `shipping` estan aceptados por contrato, pero la
  fuente de verdad para online es la orden persistida en backend.

Respuesta `201` si se creo, `200` si fue reintento idempotente o ya habia un
intento no terminal para la orden:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_123",
  "provider": "aplazo",
  "flowType": "online",
  "status": "pending_customer",
  "redirectUrl": "https://checkout.aplazo.net/...",
  "checkoutUrl": "https://checkout.aplazo.net/...",
  "expiresAt": "2026-04-27T18:30:00.000Z"
}
```

Uso frontend:

1. Crear intento.
2. Persistir `paymentAttemptId` en el estado de checkout.
3. Redirigir a `redirectUrl` o `checkoutUrl`.
4. Al volver de Aplazo, leer query params y consultar el status del backend.
5. Mostrar exito solo con `status: "paid"`.

Errores comunes:

- `401 PAYMENT_AUTH_REQUIRED`: token faltante, invalido o expirado.
- `404 PAYMENT_ORDER_INVALID`: orden no encontrada.
- `403 PAYMENT_FORBIDDEN`: la orden no pertenece al usuario.
- `409 PAYMENT_ORDER_INVALID`: orden no pagable o metodo distinto de `APLAZO`.
- `409 PAYMENT_AMOUNT_MISMATCH`: `total` no coincide con backend.
- `400 PAYMENT_VALIDATION_ERROR`: customer, URLs, currency o cartId invalidos.
- `502 PAYMENT_PROVIDER_ERROR`: Aplazo rechazo la solicitud.
- `504 PAYMENT_PROVIDER_TIMEOUT`: el intento queda en `pending_provider`; hacer
  polling.

### Status online

`GET /api/payments/{paymentAttemptId}/status`

Headers:

- `Authorization: Bearer <token>`

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
  "expiresAt": "2026-04-27T18:30:00.000Z",
  "isTerminal": false,
  "nextPollAfterMs": 3000
}
```

Regla de polling:

- Si `isTerminal` es `false`, reintenta despues de `nextPollAfterMs`.
- Si `isTerminal` es `true`, detente.
- `paid` confirma pago.
- `failed`, `canceled` y `expired` son cierre sin pago.
- `refunded` y `partially_refunded` son estados terminales post-pago.

## API Aplazo In-Store

Flujo POS. Se consume desde frontend de punto de venta o backoffice, no desde el
storefront publico. Requiere rol `ADMIN` o `EMPLEADO`.

La fuente operativa del flujo in-store es la venta POS en `ventasPos`. El backend
puede crear esa venta desde `items` o reutilizar una venta existente con
`ventaPosId`; el intento Aplazo siempre queda asociado a esa venta.

### Crear intento in-store

`POST /api/payments/aplazo/in-store/create`

Headers:

- `Authorization: Bearer <token ADMIN|EMPLEADO>`
- `Idempotency-Key: <opcional>`

Body creando una venta POS desde items:

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
      "cantidad": 1,
      "tallaId": "m"
    }
  ],
  "metadata": {
    "cartId": "venta-pos-123",
    "commChannel": "q"
  }
}
```

Body usando una venta POS existente:

```json
{
  "ventaPosId": "venta_pos_123",
  "posSessionId": "sesion_123",
  "deviceId": "device_1",
  "cajaId": "caja_1",
  "sucursalId": "sucursal_1",
  "vendedorUid": "uid_vendedor",
  "metadata": {
    "commChannel": "q"
  }
}
```

Campos y reglas:

- `posSessionId`, `deviceId`, `cajaId`, `sucursalId`, `vendedorUid` requeridos.
- Debe venir `ventaPosId` o `items`.
- Si no viene `ventaPosId`, `customer.phone` es requerido.
- `items[].productoId` y `items[].cantidad` son requeridos al crear venta.
- `items[].tallaId` es opcional.
- `amount` opcional. Si se envia, debe coincidir con el calculo backend.
- `currency` opcional.
- `metadata.cartId` opcional. Si no viene, el backend usa el id de venta POS.
- `metadata.commChannel` se pasa a Aplazo para el canal configurado; valores
  usados por integracion: `q` QR, `w` WhatsApp, `s` SMS.
- Reintentos desde `items` sin `Idempotency-Key` se deduplican por sesion POS,
  vendedor, telefono, items normalizados y monto.
- Si `ventaPosId` ya tiene un intento Aplazo activo, el backend devuelve ese
  intento y no crea otro.
- Ventas POS terminales (`PAGADA`, `CANCELADA`, `EXPIRADA`) no aceptan nuevos
  intentos Aplazo.

Respuesta `201` o `200`:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_pos_123",
  "provider": "aplazo",
  "flowType": "in_store",
  "status": "pending_customer",
  "ventaPosId": "venta_pos_123",
  "cartId": "instore_ref_1",
  "providerReference": "instore_ref_1",
  "paymentLink": "https://aplazo/pos/venta_pos_1",
  "qrString": "qr_payload",
  "qrImageUrl": "https://aplazo/qr/venta_pos_1.png",
  "expiresAt": "2026-04-27T18:30:00.000Z"
}
```

Uso POS:

1. Crear intento.
2. Mostrar `qrImageUrl`, renderizar `qrString` o abrir `paymentLink`.
3. Hacer polling a `GET /api/payments/{paymentAttemptId}/status`.
4. Guardar `ventaPosId` y `cartId`/`providerReference` para trazabilidad POS.
5. Cerrar venta solo con `status: "paid"`; el backend marca `ventasPos` como
   `PAGADA` desde webhook/reconciliacion y registra salida de inventario.

Errores comunes:

- `401 PAYMENT_AUTH_REQUIRED`.
- `403 PAYMENT_FORBIDDEN`: rol distinto de `ADMIN` o `EMPLEADO`.
- `400` de validacion Zod por body incompleto.
- `409 PAYMENT_AMOUNT_MISMATCH`.
- `502 PAYMENT_PROVIDER_ERROR`.
- `504 PAYMENT_PROVIDER_TIMEOUT`.

### Status in-store

Usa el mismo endpoint comun:

`GET /api/payments/{paymentAttemptId}/status`

El contrato de respuesta y reglas de polling son iguales al flujo online.

### Registrar sucursales in-store

`POST /api/admin/payments/aplazo/in-store/stores/register`

Headers:

- `Authorization: Bearer <token ADMIN|EMPLEADO>`

Body:

```json
{
  "branches": ["test-store-05", "test-store-06"]
}
```

Respuesta:

```json
{
  "ok": true,
  "provider": "aplazo",
  "flowType": "in_store",
  "branches": [
    {
      "id": "475",
      "name": "test-store-05"
    }
  ]
}
```

### Reenviar checkout in-store

`POST /api/admin/payments/aplazo/in-store/{cartId}/checkout/resend`

Headers:

- `Authorization: Bearer <token ADMIN|EMPLEADO>`

Body:

```json
{
  "target": {
    "phoneNumber": "5548813917"
  },
  "channels": ["WHATSAPP"]
}
```

Reglas:

- `cartId` es el `providerReference`/cartId registrado con Aplazo.
- `channels` acepta `WHATSAPP`, `SMS`, sin duplicados.

Respuesta:

```json
{
  "ok": true,
  "provider": "aplazo",
  "flowType": "in_store",
  "cartId": "cart-123",
  "result": {}
}
```

### Generar QR in-store

`GET /api/admin/payments/aplazo/in-store/{cartId}/checkout/qr?shopId=475`

Headers:

- `Authorization: Bearer <token ADMIN|EMPLEADO>`

Respuesta:

```json
{
  "ok": true,
  "provider": "aplazo",
  "flowType": "in_store",
  "cartId": "cart-123",
  "checkoutUrl": "https://checkout.aplazo.net/...",
  "qrCode": "base64-or-provider-code"
}
```

## Return URLs publicas

Estas rutas son para el navegador cuando Aplazo redirige de vuelta. No usan JWT.
Si el request acepta JSON (`Accept: application/json`), responden JSON; si no,
responden HTML simple.

Rutas:

- `GET /payments/aplazo/success`
- `GET /payments/aplazo/failure`
- `GET /payments/aplazo/cancel`

Query requerido: al menos uno de estos parametros:

- `paymentAttemptId`
- `providerPaymentId`
- `providerReference`

Ejemplo:

`GET /payments/aplazo/success?paymentAttemptId=pay_attempt_123`

Respuesta JSON:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_123",
  "provider": "aplazo",
  "status": "pending_customer",
  "message": "Estamos validando tu pago con Aplazo. El webhook sigue siendo la fuente de verdad.",
  "isTerminal": false,
  "nextPollAfterMs": 3000
}
```

Mensajes posibles:

- `Pago validado correctamente.` cuando el intento ya esta `paid`.
- `El intento ya no esta vigente o fue rechazado.` para `failed`, `canceled` o
  `expired`.
- `Estamos validando tu pago con Aplazo...` para estados pendientes.
- `No encontramos el intento de pago...` si aun no hay match local.

Regla frontend:

- La return URL solo sirve para UX.
- Despues de recibirla, usa `GET /api/payments/{paymentAttemptId}/status`.
- No muestres compra pagada hasta que el status sea `paid`.

## Webhook Aplazo

`POST /api/webhooks/aplazo`

No es para frontend. Se registra automaticamente como `webhookUrl` cuando el
backend crea un intento online o in-store.

Payload esperado de confirmacion:

```json
{
  "status": "Activo",
  "loanId": 155789,
  "cartId": "cart-123-abc",
  "merchantId": 1234
}
```

Seguridad:

- El backend valida `Authorization` contra `APLAZO_ONLINE_WEBHOOK_SECRET` o
  `APLAZO_INSTORE_WEBHOOK_SECRET` cuando estan configurados.
- El esquema puede ser `Bearer` o `Basic` via
  `APLAZO_*_WEBHOOK_AUTH_SCHEME`.
- Requests sin token valido responden `400`.
- IP whitelisting debe configurarse a nivel infraestructura cuando Aplazo
  entregue las IPs sandbox/produccion.

Procesamiento:

- `status: "Activo"` se mapea a `paid`.
- `cartId` se usa para encontrar el `PaymentAttempt`.
- `loanId` se guarda como referencia de prestamo Aplazo.
- El evento se deduplica en `paymentEventLogs`.
- La orden o venta POS se finaliza de forma asincrona por trigger/reconciliacion.

## Admin Aplazo

Estos endpoints son para backoffice, soporte o tareas operativas. Requieren
`ADMIN` o `EMPLEADO`, salvo cancelacion manual que internamente exige `ADMIN`.

### Reconciliar intento

`POST /api/admin/payments/aplazo/{paymentAttemptId}/reconcile`

Sin body.

Respuesta:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_123",
  "provider": "aplazo",
  "status": "paid",
  "providerStatus": "ACTIVE"
}
```

Uso:

- Boton manual de "sincronizar con Aplazo".
- Recuperar intentos en `pending_provider` por timeout.

### Cancelar o void manual

`POST /api/admin/payments/aplazo/{paymentAttemptId}/cancel`

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

### Solicitar refund

`POST /api/admin/payments/aplazo/{paymentAttemptId}/refund`

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
  estado del intento y contrato configurado.

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

### Consultar refund status

`GET /api/admin/payments/aplazo/{paymentAttemptId}/refund/status`

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
    },
    {
      "id": "25083",
      "status": "PROCESSING",
      "refundState": "processing",
      "refundDate": "2024-12-19T17:49:33.910913",
      "amount": 10
    }
  ]
}
```

## Formatos de error

### Error de pagos

Usado por endpoints de pagos y auth de pagos:

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

Codigos frecuentes:

- `PAYMENT_AUTH_REQUIRED`
- `PAYMENT_FORBIDDEN`
- `PAYMENT_ATTEMPT_NOT_FOUND`
- `PAYMENT_ORDER_INVALID`
- `PAYMENT_VALIDATION_ERROR`
- `PAYMENT_AMOUNT_MISMATCH`
- `PAYMENT_PROVIDER_ERROR`
- `PAYMENT_PROVIDER_TIMEOUT`
- `PAYMENT_WEBHOOK_INVALID_SIGNATURE`

### Error de validacion Zod

Usado por body, params o query invalidos:

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

Estos errores no usan `ok`; tratalos como formulario/request invalido.

## Flujos recomendados

### Web ecommerce

1. Crear orden con `metodoPago: APLAZO`.
2. Llamar `POST /api/payments/aplazo/online/create`.
3. Redirigir a `checkoutUrl`.
4. Al volver a success/failure/cancel, resolver UX con la return URL.
5. Hacer polling de `GET /api/payments/{paymentAttemptId}/status`.
6. Confirmar compra solo con `status: "paid"`.

### POS in-store

1. Abrir sesion POS.
2. Llamar `POST /api/payments/aplazo/in-store/create`.
3. Mostrar QR/link o reenviar checkout.
4. Hacer polling de `GET /api/payments/{paymentAttemptId}/status`.
5. Cerrar venta solo con `status: "paid"`.

### Backoffice refunds

1. Solicitar refund con
   `POST /api/admin/payments/aplazo/{paymentAttemptId}/refund`.
2. Consultar
   `GET /api/admin/payments/aplazo/{paymentAttemptId}/refund/status`.
3. Usar `totalRefundedAmount` como monto confirmado por backend.

## Lo que ya no debe usarse

- No usar estados en mayusculas (`PENDING_CUSTOMER`, `PAID`) en frontend nuevo.
  El backend actual responde estados canonicos en minusculas.
- No asumir que `success` significa pagado.
- No llamar a APIs de Aplazo desde navegador.
- No enviar secretos, merchant IDs privados o tokens Aplazo al frontend.
- No usar endpoints admin desde storefront publico.

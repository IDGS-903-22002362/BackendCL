# Aplazo Frontend Consumption Guide

## Objetivo

Este documento explica cómo consumir desde frontend los endpoints nuevos de Aplazo ya expuestos por el backend.

Está orientado a dos clientes:

- ecommerce web/app
- POS / tienda física

No documenta Stripe ni endpoints administrativos internos.

## Conceptos base

- El frontend nunca habla directo con Aplazo.
- El frontend solo habla con este backend.
- El backend crea el intento, habla con Aplazo y responde con `redirectUrl`, `paymentLink` o datos QR.
- El frontend nunca confirma el pago usando `success`, `failure` o `cancel`.
- La fuente de verdad real es el backend por webhook o reconcile.
- La referencia principal para el frontend es `paymentAttemptId`.
- `Idempotency-Key` es opcional pero recomendado para reintentos seguros.

## Endpoints disponibles

### Online

- `POST /api/payments/aplazo/online/create`
- `GET /api/payments/:paymentAttemptId/status`
- `GET /payments/aplazo/success`
- `GET /payments/aplazo/failure`
- `GET /payments/aplazo/cancel`

### In-store

- `POST /api/payments/aplazo/in-store/create`
- `GET /api/payments/:paymentAttemptId/status`

## Autenticación

### Ecommerce online

- Requiere sesión autenticada del dueño de la orden.
- Enviar `Authorization: Bearer <token>`.

### POS / in-store

- Requiere sesión autenticada de personal autorizado.
- Solo `ADMIN` o `EMPLEADO` con sesión POS válida.
- Enviar `Authorization: Bearer <token>`.

## Respuesta estándar de error

Todos los endpoints nuevos usan este contrato:

```json
{
  "ok": false,
  "error": {
    "code": "PAYMENT_VALIDATION_ERROR",
    "message": "Mensaje legible",
    "details": {}
  }
}
```

## Flujo online paso a paso

### 1. Crear intento online

Llama `POST /api/payments/aplazo/online/create`.

Usa este endpoint cuando:

- ya existe una orden ecommerce
- la orden fue creada con método de pago `APLAZO`
- el usuario ya está autenticado

### Request

Headers:

- `Authorization: Bearer <token>`
- `Content-Type: application/json`
- `Idempotency-Key: <clave-opcional-pero-recomendada>`

Body:

```json
{
  "orderId": "orden_123",
  "customer": {
    "name": "Juan Perez",
    "email": "juan@example.com",
    "phone": "4771234567"
  },
  "items": [
    {
      "productoId": "prod_1",
      "cantidad": 1,
      "tallaId": "m"
    }
  ],
  "subtotal": 1299,
  "tax": 0,
  "shipping": 0,
  "total": 1299,
  "currency": "mxn",
  "successUrl": "https://frontend.example.com/payments/aplazo/success",
  "cancelUrl": "https://frontend.example.com/payments/aplazo/cancel",
  "failureUrl": "https://frontend.example.com/payments/aplazo/failure",
  "cartUrl": "https://frontend.example.com/cart",
  "metadata": {
    "cartId": "orden_123",
    "concesionId": "con_1",
    "sucursalId": "suc_1",
    "vendedorUid": "uid_1"
  }
}
```

### Qué recalcula el backend

Aunque el frontend puede enviar totales e items, el backend recalcula el monto real desde la orden.

Eso significa:

- no confíes en que el frontend define el monto final
- el backend puede rechazar el request si `total` no coincide con lo recalculado

### Response

Cuando se crea un intento nuevo:

- HTTP `201`

Cuando es un reintento idempotente:

- HTTP `200`

Body:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_123",
  "provider": "aplazo",
  "flowType": "online",
  "status": "pending_customer",
  "redirectUrl": "https://checkout.aplazo/..."
}
```

### Qué hacer con `redirectUrl`

- Si `redirectUrl` existe, redirige al usuario inmediatamente.
- Guarda localmente:
  - `paymentAttemptId`
  - `flowType`
  - `orderId`
- Si la red falla al crear el intento, reintenta usando la misma `Idempotency-Key`.

### 2. Regreso desde Aplazo

Cuando el navegador vuelva a:

- `/payments/aplazo/success`
- `/payments/aplazo/failure`
- `/payments/aplazo/cancel`

no marques pago exitoso todavía.

Esas rutas son solo UX. El frontend debe seguir consultando:

- `GET /api/payments/:paymentAttemptId/status`

### 3. Polling de estado

Usa `paymentAttemptId` para consultar el estado real:

- si `isTerminal=false`, sigue haciendo polling
- usa `nextPollAfterMs` como intervalo recomendado por el backend
- detén el polling cuando `isTerminal=true`

## Flujo in-store paso a paso

### Cuándo usarlo

Usa `POST /api/payments/aplazo/in-store/create` cuando el personal de caja necesita:

- generar link de pago
- mostrar QR
- esperar confirmación asíncrona del pago

### `ventaPosId` vs `items[]`

Puedes usar dos formas:

- mandar `ventaPosId` si ya existe una venta POS preparada
- mandar `items[]` si quieres que el backend cree la venta POS borrador

Si no mandas `ventaPosId`, `items[]` es obligatorio.

### Requisitos POS

El frontend POS debe conocer y mandar:

- `posSessionId`
- `deviceId`
- `cajaId`
- `sucursalId`
- `vendedorUid`

El backend valida que todo coincida con la sesión POS abierta.

### Request

Headers:

- `Authorization: Bearer <token>`
- `Content-Type: application/json`
- `Idempotency-Key: <clave-opcional-pero-recomendada>`

Body ejemplo con `items[]`:

```json
{
  "posSessionId": "pos_session_1",
  "deviceId": "device-1",
  "cajaId": "caja-1",
  "sucursalId": "sucursal-1",
  "vendedorUid": "empleado_1",
  "customer": {
    "name": "Cliente POS",
    "phone": "4771234567"
  },
  "items": [
    {
      "productoId": "prod_1",
      "cantidad": 2,
      "tallaId": "m"
    }
  ],
  "amount": 2598,
  "currency": "mxn",
  "metadata": {
    "cartId": "venta_pos_456",
    "commChannel": "q"
  }
}
```

### `commChannel`

El frontend puede mandar `metadata.commChannel` con:

- `q`: QR
- `w`: WhatsApp
- `s`: SMS

Si no se manda, el backend usa su default configurado.

### Response

HTTP:

- `201` si se creó un intento nuevo
- `200` si fue un reintento idempotente

Body:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_pos_123",
  "provider": "aplazo",
  "flowType": "in_store",
  "status": "pending_customer",
  "paymentLink": "https://aplazo/checkout/...",
  "qrString": "qr_payload",
  "qrImageUrl": "https://aplazo/qr/....png",
  "expiresAt": "2026-04-01T18:30:00.000Z"
}
```

### Qué hacer con la respuesta

Si el backend devuelve:

- `paymentLink`: muéstralo para abrir/copiar/enviar
- `qrString`: úsalo para renderizar QR si tu frontend ya tiene librería QR
- `qrImageUrl`: úsalo como imagen directa si no quieres generar el QR en cliente

### Qué hacer si expira

Si `status=expired` o `isTerminal=true` con fallo:

- deja de hacer polling
- informa al cajero que debe generar un nuevo intento
- no sigas reutilizando el intento expirado

## Endpoint de status

### Request

`GET /api/payments/:paymentAttemptId/status`

Headers:

- `Authorization: Bearer <token>`

### Response

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_123",
  "provider": "aplazo",
  "status": "pending_customer",
  "providerStatus": "No confirmado",
  "amount": 1299,
  "currency": "mxn",
  "paidAt": null,
  "expiresAt": "2026-04-01T18:30:00.000Z",
  "isTerminal": false,
  "nextPollAfterMs": 3000
}
```

### Cómo usarlo en frontend

- `paymentAttemptId` es la llave principal de polling
- `status` es el estado normalizado que debe usar la UI
- `providerStatus` es el estado crudo del proveedor, útil para debugging o soporte
- `isTerminal` decide si se termina el flujo visual
- `nextPollAfterMs` te da la frecuencia sugerida

## Mapa de estados para UI

### `pending_provider`

- El backend o proveedor sigue procesando.
- UI recomendada: “Estamos preparando tu pago”.

### `pending_customer`

- El cliente todavía no completa la acción o Aplazo no ha confirmado.
- UI recomendada: “Estamos esperando confirmación de tu pago”.

### `authorized`

- El pago tiene una validación intermedia, pero todavía no es éxito final.
- UI recomendada: tratarlo como “validando”.

### `paid`

- Éxito final.
- UI recomendada: mostrar confirmación final.

### `failed`

- Terminal no exitoso.
- UI recomendada: mostrar error y ofrecer reintento.

### `canceled`

- Terminal no exitoso.
- UI recomendada: informar cancelación y permitir volver a intentar.

### `expired`

- Terminal no exitoso.
- UI recomendada: generar nuevo intento.

### `refunded`

- Estado posterior al pago.
- Normalmente no forma parte del checkout inicial.

### `partially_refunded`

- Estado posterior al pago.
- Normalmente no forma parte del checkout inicial.

## Return URLs y UX

Estas rutas existen para el regreso del navegador:

- `GET /payments/aplazo/success`
- `GET /payments/aplazo/failure`
- `GET /payments/aplazo/cancel`

### Qué devuelven

Si el cliente pide HTML:

- responden con una página simple de backend

Si el cliente pide JSON con `Accept: application/json`:

- responden JSON

Ejemplo:

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

### Recomendación de uso

- Para una SPA, la vía principal debe seguir siendo `GET /api/payments/:paymentAttemptId/status`.
- Usa las return URLs como transición UX, no como confirmación final.
- Si el usuario vuelve antes de que llegue el webhook, sigue mostrando “estamos validando”.

## Errores frecuentes para frontend

### `401 PAYMENT_AUTH_REQUIRED`

- El usuario no está autenticado.
- Acción UI: forzar login o renovar sesión.

### `403 PAYMENT_FORBIDDEN`

- El usuario no puede operar esa orden o esa sesión POS.
- Acción UI: bloquear acción y mostrar mensaje claro.

### `404 PAYMENT_ATTEMPT_NOT_FOUND`

- `paymentAttemptId` no existe.
- Acción UI: detener polling y ofrecer volver al checkout.

### `404 PAYMENT_ORDER_NOT_FOUND`

- `orderId` inválido o no accesible.
- Acción UI: no crear intento, volver a checkout.

### `404 PAYMENT_POS_SESSION_NOT_FOUND`

- La sesión POS ya no existe o no está abierta.
- Acción UI: pedir reapertura de sesión de caja.

### `409 PAYMENT_VALIDATION_ERROR`

- Body inválido, `commChannel` inválido, datos inconsistentes o flujo no permitido.

### `409 PAYMENT_AMOUNT_MISMATCH`

- El backend recalculó un monto distinto.
- Acción UI: refrescar resumen desde backend y reintentar.

### `409 PAYMENT_INVALID_TRANSITION`

- El intento ya está en un estado que no permite la operación.

### `409 PAYMENT_REFUND_UNSUPPORTED`

- No forma parte del checkout normal del frontend.
- Se documenta solo para soporte interno.

### `502 PAYMENT_PROVIDER_ERROR`

- Aplazo respondió con error.
- Acción UI: mostrar error temporal y permitir reintento controlado.

### `504 PAYMENT_PROVIDER_TIMEOUT`

- Timeout contra Aplazo.
- Acción UI: no asumas fallo inmediato; consulta status o reintenta con la misma `Idempotency-Key`.

## Recomendaciones de UI

- Deshabilita doble click mientras corre `create`.
- Guarda localmente `paymentAttemptId`, `flowType` y referencia de orden/venta.
- Reutiliza la misma `Idempotency-Key` si el usuario reintenta por red o timeout.
- No muestres “pago exitoso” hasta que `status=paid`.
- Si el usuario cierra la ventana y vuelve después, reanuda usando `paymentAttemptId`.

## Ejemplos con `fetch`

### 1. Crear pago Aplazo online

```ts
const response = await fetch("/api/payments/aplazo/online/create", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    "Idempotency-Key": idempotencyKey,
  },
  body: JSON.stringify({
    orderId: "orden_123",
    customer: {
      name: "Juan Perez",
      email: "juan@example.com",
      phone: "4771234567",
    },
    successUrl: `${window.location.origin}/payments/aplazo/success`,
    cancelUrl: `${window.location.origin}/payments/aplazo/cancel`,
    failureUrl: `${window.location.origin}/payments/aplazo/failure`,
    cartUrl: `${window.location.origin}/cart`,
    metadata: {
      cartId: "orden_123",
    },
  }),
});

const data = await response.json();

if (!response.ok || !data.ok) {
  throw new Error(data?.error?.message || "No se pudo crear el intento");
}

localStorage.setItem("aplazoPaymentAttemptId", data.paymentAttemptId);

if (data.redirectUrl) {
  window.location.href = data.redirectUrl;
}
```

### 2. Crear pago Aplazo in-store

```ts
const response = await fetch("/api/payments/aplazo/in-store/create", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    "Idempotency-Key": idempotencyKey,
  },
  body: JSON.stringify({
    posSessionId: "pos_session_1",
    deviceId: "device-1",
    cajaId: "caja-1",
    sucursalId: "sucursal-1",
    vendedorUid: "empleado_1",
    customer: {
      name: "Cliente POS",
      phone: "4771234567",
    },
    items: [
      {
        productoId: "prod_1",
        cantidad: 1,
      },
    ],
    amount: 850,
    currency: "mxn",
    metadata: {
      commChannel: "q",
      cartId: "venta_pos_456",
    },
  }),
});

const data = await response.json();

if (!response.ok || !data.ok) {
  throw new Error(data?.error?.message || "No se pudo crear el intento POS");
}

const paymentAttemptId = data.paymentAttemptId;
const paymentLink = data.paymentLink;
const qrString = data.qrString;
const qrImageUrl = data.qrImageUrl;
```

### 3. Polling de estado

```ts
async function pollPaymentStatus(paymentAttemptId: string, token: string) {
  let shouldContinue = true;

  while (shouldContinue) {
    const response = await fetch(`/api/payments/${paymentAttemptId}/status`, {
      headers: {
        "Authorization": `Bearer ${token}`,
      },
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data?.error?.message || "No se pudo consultar el pago");
    }

    if (data.status === "paid") {
      return data;
    }

    if (data.isTerminal) {
      return data;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, data.nextPollAfterMs || 3000),
    );
  }
}
```

### 4. Leer JSON desde return URL

```ts
const response = await fetch(
  `/payments/aplazo/success?paymentAttemptId=${paymentAttemptId}`,
  {
    headers: {
      "Accept": "application/json",
    },
  },
);

const data = await response.json();

if (data.isTerminal && data.status === "paid") {
  // éxito final confirmado
} else {
  // seguir mostrando “estamos validando”
}
```

## Tabla de pantallas vs endpoints

| Pantalla | Endpoint principal | Uso |
| --- | --- | --- |
| Checkout ecommerce | `POST /api/payments/aplazo/online/create` | Crear intento y obtener `redirectUrl` |
| Waiting screen ecommerce | `GET /api/payments/:paymentAttemptId/status` | Polling hasta estado terminal |
| Return page ecommerce | `GET /payments/aplazo/success|failure|cancel` | UX de regreso, nunca confirmación final |
| Pantalla POS QR | `POST /api/payments/aplazo/in-store/create` + `GET /api/payments/:paymentAttemptId/status` | Crear intento, renderizar QR y hacer polling |
| Pantalla POS link sent | `POST /api/payments/aplazo/in-store/create` + `GET /api/payments/:paymentAttemptId/status` | Mostrar link y esperar confirmación |
| Pantalla de confirmación final | `GET /api/payments/:paymentAttemptId/status` | Mostrar éxito solo cuando `status=paid` |

## Checklist de integración frontend

- El usuario autenticado existe antes de llamar endpoints online.
- El personal POS tiene sesión de caja válida antes de crear intentos in-store.
- Se usa `Idempotency-Key` en reintentos de create.
- Se persiste `paymentAttemptId` localmente.
- El frontend siempre consulta `status` antes de declarar éxito.
- El polling se detiene con `isTerminal=true`.
- El frontend distingue entre `redirectUrl`, `paymentLink`, `qrString` y `qrImageUrl`.
- Las return URLs no se usan como confirmación de negocio.
- La UI maneja `pending_provider`, `pending_customer`, `paid`, `failed`, `canceled` y `expired`.

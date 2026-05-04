# Aplazo Frontend Consumption Guide

Guía para consumir desde frontend los endpoints operativos de Aplazo:

- Cancelar un pago.
- Solicitar un reembolso.
- Consultar el estado de un reembolso.

Estos endpoints son administrativos y requieren Bearer token de Firebase Auth. El frontend público del cliente no debe llamarlos directamente.

## Base URL y Auth

Usa la URL pública del backend:

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL;
```

Todas las llamadas administrativas deben enviar:

```http
Authorization: Bearer <firebase_id_token>
Content-Type: application/json
```

Roles:

- `cancel`: el endpoint está montado con middleware staff, pero el servicio exige `ADMIN`.
- `refund`: exige `ADMIN`.
- `refund/status`: permite `ADMIN` o `EMPLEADO`.

Formato de error estándar:

```json
{
  "ok": false,
  "error": {
    "code": "PAYMENT_NOT_PAID_USE_CANCEL",
    "message": "Mensaje legible",
    "details": {}
  }
}
```

## Cliente vs Administración

### Cliente del e-commerce

El cliente no debe cancelar ni reembolsar directamente con estos endpoints.

Flujo recomendado:

1. Cliente inicia checkout Aplazo desde el flujo normal de compra.
2. Cliente puede volver a páginas públicas de éxito, fallo o cancelación.
3. Si abandona el checkout, el frontend puede mostrar la orden como pendiente y seguir consultando el estado normal del pago.
4. La cancelación real en Aplazo debe ejecutarla backend/admin/cron cuando se determine que el intento venció o ya no debe completarse.

Para soporte, el frontend del cliente puede mostrar textos como:

- `pending_customer`: pago pendiente en Aplazo.
- `canceled`: pago cancelado.
- `paid`: pago confirmado.
- `partially_refunded`: reembolso parcial aplicado.
- `refunded`: reembolso total aplicado.

### Administración del e-commerce

El panel admin sí puede usar estos endpoints para operar pagos:

- Cancelar intentos Aplazo todavía no confirmados.
- Solicitar reembolsos sobre pagos confirmados/ACTIVO.
- Consultar estado de reembolsos.

Regla operativa:

- Si el pago está `NO CONFIRMADO` / `pending_customer`, usar cancelación.
- Si el pago está `ACTIVO` / `paid`, usar reembolso.
- Si está `canceled`, `expired`, `failed`, `refunded` o no pagado, no intentar reembolso.

## 1. Cancelar un pago Aplazo

Cancela un intento Aplazo online solo cuando todavía está `NO CONFIRMADO`.

```http
POST /api/admin/payments/aplazo/{paymentAttemptId}/cancel
```

Body:

```json
{
  "reason": "checkout abandoned"
}
```

Ejemplo frontend admin:

```ts
type AplazoCancelResponse = {
  ok: true;
  paymentAttemptId: string;
  provider: "aplazo";
  status: string;
  providerStatus?: string;
};

export async function cancelAplazoPayment(params: {
  apiUrl: string;
  idToken: string;
  paymentAttemptId: string;
  reason?: string;
}) {
  const res = await fetch(
    `${params.apiUrl}/api/admin/payments/aplazo/${params.paymentAttemptId}/cancel`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: params.reason }),
    },
  );

  const data = await res.json();
  if (!res.ok) {
    throw data;
  }

  return data as AplazoCancelResponse;
}
```

Respuesta exitosa:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_123",
  "provider": "aplazo",
  "status": "canceled",
  "providerStatus": "cancelado"
}
```

Errores esperados:

- `PAYMENT_FORBIDDEN`: el usuario no es `ADMIN`.
- `PAYMENT_CANCEL_NOT_ALLOWED`: el pago ya está ACTIVO/pagado o no está en estado cancelable.
- `PAYMENT_VALIDATION_ERROR`: el intento no es Aplazo o faltan datos de referencia.

UX recomendada:

- Mostrar acción "Cancelar intento" solo si el pago está pendiente/no confirmado.
- Si el backend responde que ya está pagado, ocultar cancelar y ofrecer reembolso.

## 2. Solicitar un reembolso Aplazo

Solicita un reembolso parcial o total. Solo aplica a pagos confirmados localmente y ACTIVO en Aplazo.

```http
POST /api/admin/payments/aplazo/{paymentAttemptId}/refund
```

Body para parcial:

```json
{
  "refundAmountMinor": 10000,
  "reason": "Wrong size"
}
```

Body para total por saldo disponible:

```json
{
  "reason": "Customer requested full refund"
}
```

`refundAmountMinor` usa centavos. Ejemplo: `10000` = `$100.00 MXN`.

Ejemplo frontend admin:

```ts
type AplazoRefundResponse = {
  ok: true;
  paymentAttemptId: string;
  provider: "aplazo";
  status: "partially_refunded" | "refunded" | string;
  refundState?: string;
};

export async function refundAplazoPayment(params: {
  apiUrl: string;
  idToken: string;
  paymentAttemptId: string;
  refundAmountMinor?: number;
  reason?: string;
}) {
  const res = await fetch(
    `${params.apiUrl}/api/admin/payments/aplazo/${params.paymentAttemptId}/refund`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refundAmountMinor: params.refundAmountMinor,
        reason: params.reason,
      }),
    },
  );

  const data = await res.json();
  if (!res.ok) {
    throw data;
  }

  return data as AplazoRefundResponse;
}
```

Respuesta exitosa:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_123",
  "provider": "aplazo",
  "status": "partially_refunded",
  "refundState": "succeeded"
}
```

Restricciones aplicadas por backend:

- El pago local debe estar `paid`.
- Aplazo debe responder estado ACTIVO/pagado antes de ejecutar el refund.
- Si Aplazo responde NO CONFIRMADO, se rechaza y debe usarse cancelación.
- `refundAmountMinor` debe ser mayor a `0`.
- El monto no puede exceder el saldo reembolsable.
- Si no se manda `refundAmountMinor`, se toma el saldo disponible completo.
- Si ya hay un refund `processing`, se rechaza para evitar doble refund.
- Si el pago ya está completamente reembolsado, no se manda otro refund a Aplazo.

Errores esperados:

- `PAYMENT_NOT_PAID_USE_CANCEL`: pago no confirmado; usar cancelación.
- `REFUND_AMOUNT_INVALID`: monto inválido o `<= 0`.
- `REFUND_AMOUNT_EXCEEDS_AVAILABLE`: monto mayor al saldo disponible.
- `REFUND_ALREADY_PROCESSING`: ya hay un refund en proceso para el pago.
- `PAYMENT_ALREADY_REFUNDED`: el pago ya está totalmente reembolsado.
- `APLAZO_REFUND_FAILED`: Aplazo falló; el pago local no fue marcado como reembolsado.
- `PAYMENT_FORBIDDEN`: usuario sin rol `ADMIN`.

UX recomendada:

- Mostrar botón "Reembolsar" solo cuando `status === "paid"` o `partially_refunded` con saldo disponible, si el backend expone ese dato en la vista admin.
- Pedir motivo obligatorio en UI aunque el backend lo acepte opcional.
- Para refund total, permitir dejar vacío el monto y enviar solo `reason`.
- Después de un refund exitoso, refrescar el detalle del pago y consultar estado de refund.

## 3. Consultar estado de un reembolso

Sincroniza el estado de refunds con Aplazo y devuelve el refund seleccionado o el más reciente.

```http
GET /api/admin/payments/aplazo/{paymentAttemptId}/refund/status
```

Query opcional:

```http
?refundId=25083
```

Ejemplo frontend admin:

```ts
type AplazoRefundStatusResponse = {
  ok: true;
  paymentAttemptId: string;
  provider: "aplazo";
  status: string;
  refundState?: string;
  providerStatus?: string;
  refundId?: string;
  refundAmount?: number;
  totalRefundedAmount: number;
  currency: string;
  refunds: Array<{
    id?: string;
    status?: string;
    refundState?: string;
    refundDate?: string;
    amount?: number;
  }>;
};

export async function getAplazoRefundStatus(params: {
  apiUrl: string;
  idToken: string;
  paymentAttemptId: string;
  refundId?: string;
}) {
  const url = new URL(
    `${params.apiUrl}/api/admin/payments/aplazo/${params.paymentAttemptId}/refund/status`,
  );
  if (params.refundId) {
    url.searchParams.set("refundId", params.refundId);
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.idToken}`,
    },
  });

  const data = await res.json();
  if (!res.ok) {
    throw data;
  }

  return data as AplazoRefundStatusResponse;
}
```

Respuesta exitosa:

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
      "id": "25083",
      "status": "PROCESSING",
      "refundState": "processing",
      "refundDate": "2024-12-19T17:49:33.910913",
      "amount": 10
    }
  ]
}
```

Errores esperados:

- `PAYMENT_FORBIDDEN`: usuario no es `ADMIN` ni `EMPLEADO`.
- `PAYMENT_VALIDATION_ERROR`: intento no es Aplazo.
- `PAYMENT_REFUND_UNSUPPORTED`: proveedor/config no soporta consulta.
- `PAYMENT_ATTEMPT_NOT_FOUND`: intento no encontrado.

UX recomendada:

- En el panel admin, mostrar una tabla con `refunds`.
- Usar `refundState` para badges:
  - `processing`: en proceso.
  - `succeeded`: completado.
  - `failed`: fallido.
  - `requested`: solicitado.
- Permitir refrescar manualmente el estado.

## Flujos Recomendados

### Flujo de cliente: checkout abandonado

1. Cliente inicia pago Aplazo.
2. Cliente cierra o abandona checkout.
3. Frontend público muestra pago pendiente.
4. Backend/cron o admin cancela cuando vence la ventana operativa.
5. Cliente ve la orden como cancelada o pendiente según el estado sincronizado.

El cliente no debe llamar `POST /cancel`.

### Flujo de admin: cancelar pago no confirmado

1. Admin abre detalle de orden/pago.
2. UI verifica que el estado no sea pagado.
3. Admin elige "Cancelar intento Aplazo".
4. Frontend llama `POST /cancel`.
5. UI refresca el detalle y muestra `canceled`.

### Flujo de admin: reembolso parcial

1. Admin abre detalle de un pago `paid`.
2. Admin captura monto en pesos; frontend convierte a centavos.
3. Frontend llama `POST /refund`.
4. UI muestra estado `partially_refunded`.
5. Frontend llama `GET /refund/status` para confirmar seguimiento.

### Flujo de admin: reembolso total

1. Admin abre detalle de un pago `paid` o parcialmente reembolsado con saldo.
2. Admin elige "Reembolso total".
3. Frontend manda solo `reason`, sin `refundAmountMinor`.
4. Backend usa el saldo reembolsable restante.
5. UI refresca y muestra `refunded`.

## Helper de errores

```ts
export function getAplazoAdminErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null
      ? (error as { error?: { code?: string } }).error?.code
      : undefined;

  switch (code) {
    case "PAYMENT_NOT_PAID_USE_CANCEL":
      return "Este pago aún no está confirmado. Usa cancelación, no reembolso.";
    case "REFUND_AMOUNT_INVALID":
      return "El monto del reembolso debe ser mayor a 0.";
    case "REFUND_AMOUNT_EXCEEDS_AVAILABLE":
      return "El monto excede el saldo disponible para reembolso.";
    case "REFUND_ALREADY_PROCESSING":
      return "Ya hay un reembolso en proceso para este pago.";
    case "PAYMENT_ALREADY_REFUNDED":
      return "Este pago ya fue reembolsado por completo.";
    case "APLAZO_REFUND_FAILED":
      return "Aplazo no pudo procesar el reembolso. Intenta más tarde o revisa soporte.";
    case "PAYMENT_CANCEL_NOT_ALLOWED":
      return "Este pago no puede cancelarse. Si ya está pagado, usa reembolso.";
    case "PAYMENT_FORBIDDEN":
      return "No tienes permisos para realizar esta operación.";
    default:
      return "No fue posible completar la operación de Aplazo.";
  }
}
```

## Checklist de integración frontend

- Usar Firebase ID token vigente en panel admin.
- No exponer estos endpoints en UI pública del cliente.
- Convertir montos de pesos a centavos antes de enviar `refundAmountMinor`.
- Deshabilitar botones mientras una request está en curso.
- Manejar errores por `error.code`, no por texto.
- Refrescar el detalle de pago después de cancelar o reembolsar.
- Para refunds, consultar `GET /refund/status` después de solicitar el reembolso.

# Backend Stripe Guide

## Variables de entorno requeridas

Definir en `functions/.env` (no commitear secretos):

- `STRIPE_SECRET_KEY=sk_test_...`
- `STRIPE_WEBHOOK_SECRET=whsec_...`
- `STRIPE_PUBLISHABLE_KEY=pk_test_...` (opcional para `/api/stripe/config`)
- `APP_URL=https://tu-front.com`
- `STRIPE_CURRENCY=mxn`

Notas:
- Nunca exponer `STRIPE_SECRET_KEY` en frontend.
- Usar llaves separadas por entorno (test/live).

## Desarrollo local

```bash
npm run dev --prefix functions
```

Servidor local esperado: `http://localhost:3000`.

## Webhooks con Stripe CLI

```bash
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

## Endpoints Stripe

Base URL local: `http://localhost:3000/api/stripe`

- `GET /config`
- `POST /payment-intents`
- `GET /payment-intents/:id`
- `POST /checkout-sessions`
- `GET /checkout-sessions/:id`
- `POST /setup-intents`
- `POST /billing-portal`
- `POST /refunds` (admin/empleado)
- `POST /webhook` (sin auth, con firma Stripe)

Compatibilidad vigente:
- `POST /api/pagos/iniciar`
- `POST /api/pagos/webhook`
- `POST /api/pagos/:id/reembolso`
- `GET /api/pagos/:id`
- `GET /api/pagos/orden/:ordenId`

## Ejemplos curl

Crear PaymentIntent:

```bash
curl -X POST http://localhost:3000/api/stripe/payment-intents \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: pi_order_123_v1" \
  -d '{
    "orderId": "orden_123",
    "savePaymentMethod": true
  }'
```

Crear Checkout Session:

```bash
curl -X POST http://localhost:3000/api/stripe/checkout-sessions \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: cs_order_123_v1" \
  -d '{
    "orderId": "orden_123"
  }'
```

Crear SetupIntent:

```bash
curl -X POST http://localhost:3000/api/stripe/setup-intents \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Crear Billing Portal:

```bash
curl -X POST http://localhost:3000/api/stripe/billing-portal \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"returnUrl":"http://localhost:3000/mi-cuenta"}'
```

Reembolso por orden:

```bash
curl -X POST http://localhost:3000/api/stripe/refunds \
  -H "Authorization: Bearer <JWT_ADMIN>" \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "orden_123",
    "reason": "requested_by_customer"
  }'
```

## Pruebas recomendadas

- Pago exitoso con tarjeta `4242 4242 4242 4242`.
- Pago con autenticacion/3DS.
- Pago fallido (`4000 0000 0000 9995`).
- Reembolso.
- Verificar que `ordenes` y `pagos` cambian estado solo via webhook.

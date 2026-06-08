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

## FedEx en Firebase

FedEx corre con secretos de Firebase Functions en producción. Después de definirlos localmente, súbelos al proyecto con:

```bash
firebase functions:secrets:set FEDEX_ENV
firebase functions:secrets:set FEDEX_BASE_URL
firebase functions:secrets:set FEDEX_CLIENT_ID
firebase functions:secrets:set FEDEX_CLIENT_SECRET
firebase functions:secrets:set FEDEX_ACCOUNT_NUMBER
```

Si también usas pickup, tracking o remitente avanzado, configura los secretos adicionales de FedEx que consume `functions/src/modules/shipping/fedex/fedex.config.ts` y `fedex-ship.mapper.ts`.

Variables de remitente usadas por FedEx:

```bash
FEDEX_SHIPPER_CONTACT_NAME=La Guarida del Leon
FEDEX_SHIPPER_COMPANY_NAME=La Guarida del Leon
FEDEX_SHIPPER_PHONE=4777112626
FEDEX_SHIPPER_EMAIL=desarrolloclubleon@gmail.com
FEDEX_SHIPPER_STREET_1=Blvd. Adolfo Lopez Mateos
FEDEX_SHIPPER_STREET_2=La Martinca
FEDEX_SHIPPER_CITY=Leon de los Aldama
FEDEX_SHIPPER_STATE_OR_PROVINCE_CODE=Guanajuato
FEDEX_SHIPPER_POSTAL_CODE=37500
FEDEX_SHIPPER_COUNTRY_CODE=MX
FEDEX_SHIPPER_RESIDENTIAL=false
```

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

# Stripe Integration Audit Checklist

## Estado inicial encontrado (integración parcial)

- [x] Se usaba `PaymentIntents` con `POST /api/pagos/iniciar`.
- [x] Existia webhook en `POST /api/pagos/webhook`.
- [x] Se verificaba firma con `stripe.webhooks.constructEvent`.
- [x] Se hacia deduplicacion de eventos por `event.id` en `stripe_webhook_events`.
- [x] El estado final de pago/orden se actualizaba desde webhook (fuente de verdad).
- [ ] No existia API dedicada bajo `/api/stripe/*`.
- [ ] No existia creacion de Checkout Session.
- [ ] No existia SetupIntent ni Billing Portal.
- [ ] No se persistia mapping `user -> stripeCustomerId`.
- [ ] No habia helper central de idempotencia deterministica para Stripe.
- [ ] No habia `express.raw` dedicado para webhook `/api/stripe/webhook`.
- [ ] No existia `STRIPE_PUBLISHABLE_KEY`, `APP_URL`, `STRIPE_CURRENCY` en `.env.example`.
- [ ] No habia rate limit especifico para endpoints Stripe criticos.

## Correcciones aplicadas

- Se agrego `functions/src/lib/stripe.ts` para cliente Stripe, currency/env y claves de idempotencia.
- Se habilito `express.raw({ type: 'application/json' })` en `/api/stripe/webhook` y `/api/pagos/webhook`.
- Se agrego router nuevo `/api/stripe` con endpoints:
  - `GET /config`
  - `POST /payment-intents`
  - `GET /payment-intents/:id`
  - `POST /checkout-sessions`
  - `GET /checkout-sessions/:id`
  - `POST /setup-intents`
  - `POST /billing-portal`
  - `POST /refunds`
  - `POST /webhook`
- Se mantuvo compatibilidad total de `/api/pagos/*`.
- Se agrego mapping persistente `stripeCustomerId` en `usuariosApp`.
- Se guardan referencias Stripe en orden/pago (`stripePaymentIntentId`, `stripeCheckoutSessionId`, `stripeCustomerId`, `rawEventId`).
- Se aplica idempotencia explicita en `paymentIntents.create` y `checkout.sessions.create`.
- Se agrego rate limit para endpoints criticos de Stripe.
- Se actualizo Swagger y variables de entorno de ejemplo.

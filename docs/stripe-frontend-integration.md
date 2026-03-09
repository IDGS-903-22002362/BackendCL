# Guía Completa de Integración de Pagos (Stripe) en Frontend (Next.js)

Este documento detalla exhaustivamente cómo el frontend en Next.js se conecta con todos los endpoints del backend relacionados a **Stripe** y la gestión de **Pagos**, cubriendo todos los flujos disponibles en la API.

---

## 1. Prerrequisitos e Instalación

Para interactuar con la API de Stripe de forma segura desde el cliente de React, requieres las librerías oficiales de Stripe.

```bash
npm install @stripe/stripe-js @stripe/react-stripe-js
```

---

## 2. Inicialización Dinámica y Conexión al Backend

No es necesario exponer la clave pública estática en tu `.env` del frontend si tu backend ya la expone de manera segura a través del endpoint de configuración. 

**Endpoint:** `GET /api/stripe/config`
**Uso en Next.js:** Obtener dinámicamente la clave para inicializar `stripe-js`

```typescript
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { useEffect, useState } from 'react';

export const useStripeConfig = () => {
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      // Conexión Frontend -> Backend para obtener clave pública
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/stripe/config`);
      const response = await res.json();
      
      if (response.success && response.data.publishableKey) {
        setStripePromise(loadStripe(response.data.publishableKey));
      }
    };
    fetchConfig();
  }, []);

  return stripePromise;
};
```

---

## 3. Flujo Principal: React Elements (Recomendado)

En este flujo el cliente nunca abandona la aplicación de Next.js. El formulario se carga como un iframe seguro integrado en tu interfaz.

### 3.1 Iniciar el Pago desde el Backend

Dada una orden creada en estado `PENDIENTE`, el frontend le indica al backend crear un intento de pago ("PaymentIntent") en Stripe.

**Endpoint Backend:** `POST /api/pagos/iniciar`  (o alternativamente `POST /api/stripe/payment-intents` si requieres enviar detalles de envío o moneda dinámica)
**Headers:** `Idempotency-Key` y `Authorization: Bearer <Token>`

```typescript
const iniciarIntentoPago = async (ordenId: string) => {
  const token = await firebaseAuth.currentUser.getIdToken();
  
  // Idempotency-Key previene que este llamado cree dobles cobros si hay fallo de red
  const idempotencyKey = `pago_${ordenId}_${Date.now()}`;
  
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/pagos/iniciar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Idempotency-Key': idempotencyKey 
    },
    body: JSON.stringify({
      ordenId: ordenId,
      metodoPago: 'TARJETA' // Único método admitido actualmente
    })
  });
  
  const response = await res.json();
  if (!res.ok || !response.success) throw new Error(response.message);

  // El backend retorna el clientSecret, que es la llave única de esta transacción
  return response.data.clientSecret; 
};
```

### 3.2 Renderizar el Formulario

Con el `clientSecret` obtenido, envolvemos nuestro componente en `<Elements>`.

```tsx
import { Elements } from '@stripe/react-stripe-js';

// Asumiendo que obtuviste `clientSecret` y `stripePromise` (de /api/stripe/config)
const options = {
  clientSecret,
  appearance: { theme: 'stripe' as const },
};

return (
  <Elements stripe={stripePromise} options={options}>
    <FormularioPago ordenId={ordenId} />
  </Elements>
);
```

### 3.3 Confirmar Pago con `useStripe()`

El componente renderiza `<PaymentElement />` (input del número de tarjeta gestionado por Stripe) y confirma la transacción directamente de tu cliente (Next.js) hacia Stripe. **El servidor de backend nunca ve los números de las tarjetas.**

```tsx
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';
import { useState, FormEvent } from 'react';

export const FormularioPago = ({ ordenId }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    // Conexión Frontend -> APIs de Stripe
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // Redirige al concluir la autenticación del banco o si hay éxito
        return_url: `${window.location.origin}/pago/exitoso?orden_id=${ordenId}`,
      },
    });

    if (error) setErrorMessage(error.message || 'Error al procesar.');
  };

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />
      <button disabled={!stripe} className="btn-primary mt-4">Pagar</button>
      {errorMessage && <p className="text-red-500 mt-2">{errorMessage}</p>}
    </form>
  );
};
```

### 3.4 Comprobación Posteriori: Validar si la Orden se pagó

Stripe redirige al usuario a `/pago/exitoso`. Paralelamente, Stripe envía un evento webhoook (`POST /api/pagos/webhook`) al backend para liquidar la orden en Firebase. El frontend debe consultar amablemente el estado desde el backend.

**Endpoint Backend:** `GET /api/pagos/orden/{ordenId}`

```typescript
const verificarEstado = async (ordenId: string) => {
  const token = await firebaseAuth.currentUser.getIdToken();
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/pagos/orden/${ordenId}`, {
     headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const response = await res.json();
  if (response.success) {
    if (response.data.estado === 'COMPLETADO') {
       console.log("¡Éxito! Su compra ha sido verificada.");
    }
  }
};
```

---

## 4. Flujo Alternativo: Stripe Checkout (Hosted Page)

Si no quieres componentes reactivos locales, redirige al usuario a la vista de caja hospedada por Stripe.

**Endpoint Backend:** `POST /api/stripe/checkout-sessions`

```typescript
const redirigirAStripeCheckout = async (ordenId: string) => {
  const token = await firebaseAuth.currentUser.getIdToken();
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/stripe/checkout-sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      orderId: ordenId,
      successUrl: `${window.location.origin}/exito?orden_id=${ordenId}`,
      cancelUrl: `${window.location.origin}/carrito`
    })
  });
  
  const response = await res.json();
  if (response.success && response.data.url) {
     // Redirección completa a checkout.stripe.com
     window.location.href = response.data.url;
  }
};
```

---

## 5. Adicional: Guardar Métodos de Pago a Futuro

Para permitirle a un usuario guardar su tarjeta para compras futuras, usamos SetupIntents en lugar de PaymentIntents.

**Endpoint Backend:** `POST /api/stripe/setup-intents`

```typescript
const iniciarGuardadoTarjeta = async (customerId?: string) => {
  const token = await firebaseAuth.currentUser.getIdToken();
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/stripe/setup-intents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ customerId })
  });
  
  const response = await res.json();
  // El clientSecret devuelto se pasa al componente <Elements> y `stripe.confirmSetup({ ... })`
  return response.data.clientSecret;
};
```

---

## 6. Adicional: Gestión de Portal del Cliente (Billing Portal)

Permite al usuario borrar tarjetas o descargar facturas pasadas en un panel brindado por Stripe.

**Endpoint Backend:** `POST /api/stripe/billing-portal`

```typescript
const irAPortalFacturacion = async () => {
  const token = await firebaseAuth.currentUser.getIdToken();
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/stripe/billing-portal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ returnUrl: window.location.href })
  });
  
  const response = await res.json();
  // Redirige al panel hospedado por Stripe (billing.stripe.com)
  if (response.success) window.location.href = response.data.url;
};
```

---

## 7. Panel de Administrador: Reembolsos

Si construyes un panel backend para tu staff, ellos podrán procesar reembolsos. El endpoint primario requiere privilegios (`requireAdmin`).

**Endpoint Backend:** `POST /api/pagos/{idDelPago}/reembolso` O alternativo con orden: `POST /api/stripe/refunds`

```typescript
const procesarReembolso = async (pagoId: string, cantidad?: number, motivo?: string) => {
  const token = await firebaseAuth.currentUser.getIdToken(); // Token de un Admin
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/pagos/${pagoId}/reembolso`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      refundAmount: cantidad, // Nulo = Reembolso total
      refundReason: motivo
    })
  });
  
  if ((await res.json()).success) {
    alert("Reembolso completado. La base de datos actualizó el estado a REEMBOLSADO/CANCELADA.");
  }
};
```

# Integracion FedEx en Frontend

Guia breve para consumir FedEx desde el frontend considerando el flujo actual de checkout, pagos Stripe/Aplazo, generacion de guia y reembolsos.

## Cambios nuevos: remitente FedEx controlado por backend

El backend ya tiene configurada la direccion origen/remitente de FedEx en secrets desplegados. El frontend no debe pedir, guardar ni enviar datos del remitente para el flujo normal de checkout.

Remitente activo en backend:

| Campo backend | Valor operativo |
| --- | --- |
| Contacto | La Guarida del Leon |
| Empresa | La Guarida del Leon |
| Telefono | 4777112626 |
| Direccion | Blvd. Adolfo Lopez Mateos, La Martinca |
| Ciudad | Leon de los Aldama |
| Estado | Guanajuato |
| CP | 37500 |
| Pais | MX |
| Residencial | false |

Impacto para frontend:

- En checkout, enviar solo la direccion destino del cliente.
- No exponer variables `FEDEX_SHIPPER_*` en `.env`, `.env.local`, `env.example`, `NEXT_PUBLIC_*` ni App Hosting del frontend.
- No agregar campos de origen/remitente en formularios de cliente.
- No mandar `origin` en `POST /api/carrito/shipping/fedex/quotes`.
- No mandar `packages`, `shipper` ni `accountNumber` desde cliente; el backend resuelve carrito, productos y credenciales.
- No mandar ni forzar `serviceType` al cotizar carrito; el backend no envia `serviceType` a FedEx salvo que exista `FEDEX_SERVICE_TYPE` configurado explicitamente en backend.
- No configurar `FEDEX_SERVICE_TYPE` en el frontend. En produccion debe quedar vacio/no definido por ahora.
- No recalcular costo de envio en frontend; usar siempre `options[].amount` devuelto por backend.
- Si existe una pantalla interna de pruebas que llama `POST /api/shipping/fedex/rates`, puede seguir enviando `origin`, pero no debe usarse para checkout real.

## Cambios nuevos: cotizacion Rate API con YOUR_PACKAGING

El backend de FedEx Rate API fue ajustado para cotizar con empaque propio:

| Campo Rate API | Valor backend |
| --- | --- |
| `packagingType` | `YOUR_PACKAGING` |
| `pickupType` | `USE_SCHEDULED_PICKUP` |
| `rateRequestType` | `["ACCOUNT", "LIST"]` |
| `serviceType` | Se omite por defecto |
| `totalPackageCount` | Lo calcula backend desde los paquetes |

Impacto para frontend:

- El checkout debe seguir llamando `fedexApi.quoteCart(direccionEnvio)`.
- El frontend no debe filtrar servicios antes de cotizar ni mandar `serviceType` al endpoint de cotizacion del carrito.
- El frontend no debe configurar ni exponer `FEDEX_SERVICE_TYPE`; esa variable es exclusiva del backend y debe quedar vacia/no definida en produccion.
- Aunque alguien configure `FEDEX_SERVICE_TYPE` en backend, no se enviaran valores bloqueados: `FEDEX_ONE_RATE`, `SMART_POST`, `FEDEX_GROUND_ECONOMY`, `GROUND_HOME_DELIVERY` ni `FEDEX_GROUND`.
- No implementar hacks de frontend para forzar servicios de Estados Unidos; para MX el backend deja que FedEx devuelva los servicios validos.
- La seleccion del usuario se hace despues de recibir `options[]`, usando `optionId` como identificador preferido.
- `selectedServiceType` queda solo como fallback de compatibilidad para crear la orden si no existe `optionId`; no debe usarse para forzar cotizaciones.
- Un error `422` en cotizacion FedEx puede traer mensajes como `Invalid service and packaging combination`; mostrarlo como error de cotizacion recuperable, permitir revisar direccion o reintentar, y no cambiar flujos de pago.

### Implementacion en este frontend

El frontend ya cuenta con `src/lib/api/fedex.ts`. El flujo debe usar `fedexApi.quoteCart(direccionEnvio)` para checkout real; esa funcion llama al route handler local de Next `/api/carrito/shipping/fedex/quotes`, que a su vez proxya al backend.

1. Revisar que `buildFedExDireccionEnvio` en checkout construya solo datos del destinatario.
2. Validar direccion con `fedexApi.validateAddress` si se desea normalizar antes de cotizar.
3. Cotizar con `fedexApi.quoteCart(direccionEnvio)`.
4. Mostrar opciones devueltas por backend y guardar `quoteId` mas `optionId`.
5. Crear orden con `shippingQuoteId` y `selectedShippingOptionId`.
6. Despues del pago, consultar tracking; no intentar crear guia desde cliente.

Ejemplo esperado en checkout:

```ts
const direccionEnvio = buildFedExDireccionEnvio(values);
const quote = await fedexApi.quoteCart(direccionEnvio);
const selectedOption = quote.options.find(
  (option) => option.optionId === selectedShippingOptionId,
);
```

Ejemplo de payload correcto para crear orden:

```ts
{
  fulfillmentMethod: "DELIVERY",
  direccionEnvio,
  metodoPago: "TARJETA",
  shippingQuoteId: quote.quoteId,
  selectedShippingOptionId: selectedOption.optionId
}
```

No incluir en checkout:

```ts
{
  costoEnvio: selectedOption.amount,
  origin: {},
  shipper: {},
  packages: [],
  accountNumber: "..."
}
```

No intentar forzar cotizacion con alguno de estos servicios:

```ts
[
  "FEDEX_ONE_RATE",
  "SMART_POST",
  "FEDEX_GROUND_ECONOMY",
  "GROUND_HOME_DELIVERY",
  "FEDEX_GROUND"
]
```

Checklist de migracion para estos cambios:

- Eliminar cualquier uso frontend de `FEDEX_SHIPPER_NAME`, `FEDEX_SHIPPER_CONTACT_NAME`, `FEDEX_SHIPPER_COMPANY_NAME`, `FEDEX_SHIPPER_PHONE`, `FEDEX_SHIPPER_STREET_1`, `FEDEX_SHIPPER_CITY`, `FEDEX_SHIPPER_STATE_OR_PROVINCE_CODE`, `FEDEX_SHIPPER_POSTAL_CODE`, `FEDEX_SHIPPER_COUNTRY_CODE` y similares.
- Eliminar cualquier `FEDEX_SERVICE_TYPE`, `FEDEX_ONE_RATE` o servicio FedEx hardcodeado de `.env`, `.env.local`, App Hosting, constantes frontend y payloads de checkout.
- Eliminar inputs UI de "direccion origen", "remitente" o "shipper" en checkout cliente.
- Confirmar que `fedexApi.quoteCart` solo reciba `direccionEnvio`.
- Confirmar que el payload de cotizacion de carrito no incluya `origin`, `packages`, `shipper`, `accountNumber`, `serviceType` ni `packagingType`.
- Confirmar que el payload de checkout no incluya `costoEnvio`.
- En errores `422` de cotizacion, mostrar el mensaje de backend y permitir reintentar/cambiar direccion; no iniciar pago sin cotizacion seleccionada.
- En errores `502` de validacion de direccion, tratar como advertencia no bloqueante y continuar a cotizar si el formulario local es valido.

## Reglas base

- El frontend no debe llamar directo a FedEx. Siempre debe usar el backend.
- Para checkout con envio, usar la cotizacion de carrito, no enviar `costoEnvio` manual.
- La orden debe quedar con `fulfillmentMethod: DELIVERY`, `shipping.provider: FEDEX` y `shipping.status: QUOTE_SELECTED`.
- La confirmacion de pago por Stripe o Aplazo es la fuente que habilita la generacion de guia.
- Si `FEDEX_AUTO_CREATE_LABEL_ON_PAID` esta activo, el backend intenta crear la guia cuando el pago queda confirmado.
- Si el pago se cancela o reembolsa y hay guia FedEx activa, el backend intenta cancelar la guia antes de liberar la orden.
- Si la guia ya esta entregada, el backend no permite cancelar/reembolsar automaticamente esa orden.
- Para pickup en sucursal no se usa FedEx; el flujo debe mandar `fulfillmentMethod: PICKUP`.

## Flujo cliente recomendado

1. Capturar direccion de envio.
2. Validar direccion con FedEx si se quiere normalizar antes de cotizar.
3. Cotizar el carrito con `POST /api/carrito/shipping/fedex/quotes`.
4. Mostrar opciones devueltas por backend.
5. Guardar la opcion elegida por `optionId`; usar `serviceType` solo como fallback si no hay `optionId`.
6. Crear la orden con `POST /api/carrito/checkout`.
7. Iniciar pago segun metodo elegido.
8. Esperar confirmacion del pago consultando los endpoints actuales de pagos.
9. Consultar tracking de la orden con `GET /api/orders/{orderId}/tracking`.

## URLs y proxy Next.js

- En el frontend, las llamadas cliente deben usar los route handlers locales de Next, por ejemplo `/api/shipping/fedex/address/validate`.
- En produccion, el proxy puede registrar una URL con `/api/api/...`: el primer `/api` corresponde al nombre de la Cloud Function y el segundo al prefijo del backend Express.
- No quitar el prefijo `/api` de `API_BASE_URL` ni de `backendPath` solo por ver `/api/api/...` en logs; esa forma es esperada para este despliegue.

## APIs publicas o de cliente

| Uso | Endpoint | Auth | Cuando usar |
| --- | --- | --- | --- |
| Validar direccion | `POST /api/shipping/fedex/address/validate` | No obligatoria | Antes de cotizar, para detectar direccion invalida o normalizada. |
| Cotizacion generica FedEx | `POST /api/shipping/fedex/rates` | No obligatoria | Solo para pantallas genericas o pruebas controladas. |
| Cotizacion real del carrito | `POST /api/carrito/shipping/fedex/quotes` | Cliente autenticado | Checkout. Es la ruta que debe usarse para cobrar envio. |
| Crear orden desde carrito | `POST /api/carrito/checkout` | Cliente autenticado | Despues de elegir una cotizacion FedEx. |
| Tracking cliente | `GET /api/orders/{orderId}/tracking` | Cliente autenticado | Pantalla de detalle de compra o seguimiento. |

## Validacion de direccion

Endpoint:

`POST /api/shipping/fedex/address/validate`

Campos de entrada:

| Campo | Regla |
| --- | --- |
| `address.streetLines` | 1 a 3 lineas. |
| `address.city` | Opcional. |
| `address.stateOrProvinceCode` | Opcional. |
| `address.postalCode` | Obligatorio para MX. |
| `address.countryCode` | Codigo de 2 letras. |
| `address.residential` | Opcional. |

Reglas para Mexico:

- Para `countryCode: "MX"`, no enviar `address.stateOrProvinceCode` desde checkout al endpoint de validacion. FedEx puede responder `GENERIC.ERROR` si se manda el nombre completo del estado o codigos como `GUA`/`GTO`.
- Conservar el estado completo en `direccionEnvio.estado` para cotizacion de carrito y checkout; esta regla aplica solo al payload tecnico de `address/validate`.
- Si la validacion de direccion devuelve `502`, tratarla como advertencia no bloqueante y continuar con la cotizacion real del carrito cuando el formulario local sea valido.

Respuesta util:

| Campo | Uso |
| --- | --- |
| `isValid` | Permite bloquear o advertir antes de cotizar. |
| `classification` | Tipo de direccion: residencial, negocio, mixta o desconocida. |
| `addressState` | Nivel de normalizacion. |
| `resolvedAddress` | Direccion normalizada por FedEx. |
| `changes` | Diferencias contra la direccion enviada. |
| `warnings` | Advertencias tecnicas. |
| `customerMessages` | Mensajes que pueden mostrarse al cliente. |

## Cotizacion generica FedEx

Endpoint:

`POST /api/shipping/fedex/rates`

Usarla solo si la pantalla no depende del carrito. Para checkout real, usar `POST /api/carrito/shipping/fedex/quotes`.

Campos de entrada:

| Campo | Regla |
| --- | --- |
| `origin` | Direccion origen FedEx. |
| `destination` | Direccion destino FedEx. |
| `packages` | Al menos un paquete con peso y dimensiones. |
| `shipDate` | `YYYY-MM-DD`; opcional. |
| `currency` | `MXN` por defecto. |
| `rateRequestTypes` | `ACCOUNT` por defecto. |
| `serviceType` | Solo para pruebas internas controladas; no usar en checkout ni enviar valores bloqueados. |

Respuesta util:

| Campo | Uso |
| --- | --- |
| `quoteId` | Identificador de cotizacion generica. |
| `options[]` | Servicios disponibles. |
| `options[].amount` | Costo de envio. |
| `options[].serviceType` | Servicio FedEx. |
| `options[].serviceName` | Nombre visible. |
| `options[].estimatedDeliveryDate` | Fecha estimada si existe. |
| `options[].surcharges` | Cargos incluidos. |

## Cotizacion del carrito

Endpoint principal para checkout:

`POST /api/carrito/shipping/fedex/quotes`

Enviar solo `direccionEnvio`. El backend toma los productos del carrito autenticado, calcula paquetes con peso/dimensiones, cotiza FedEx y guarda una cotizacion temporal.

El backend arma internamente el payload FedEx con `packagingType: "YOUR_PACKAGING"` y omite `serviceType` por defecto. El frontend no debe mandar `packagingType`, `serviceType`, paquetes ni origen en este endpoint.

Payload interno esperado hacia FedEx, para referencia de debug:

```ts
requestedShipment = {
  shipper,
  recipient,
  pickupType: "USE_SCHEDULED_PICKUP",
  rateRequestType: ["ACCOUNT", "LIST"],
  packagingType: "YOUR_PACKAGING",
  totalPackageCount: requestedPackageLineItems.length,
  requestedPackageLineItems,
}
```

En logs de backend debe verse algo equivalente a:

```ts
{
  hasServiceType: false,
  serviceType: null,
  packagingType: "YOUR_PACKAGING",
  hasOneRateSpecialService: false
}
```

Formato requerido de `direccionEnvio`:

- `telefono` debe enviarse como 10 digitos nacionales MX, sin `+52`, espacios, guiones ni parentesis. Ejemplo: `4773538866`.
- Si Stripe Address Element devuelve `+52 477 353 8866`, el frontend debe normalizarlo antes de llamar a cotizacion o checkout.

Respuesta util para frontend:

| Campo | Uso |
| --- | --- |
| `quoteId` | Debe enviarse en checkout como `shippingQuoteId`. |
| `expiresAt` | Si expira, recotizar antes de crear orden. |
| `options[]` | Lista de servicios disponibles. |
| `options[].optionId` | Identificador preferido para seleccionar envio. |
| `options[].serviceType` | Alternativa para seleccionar envio. |
| `options[].serviceName` | Texto visible de servicio. |
| `options[].amount` | Costo final de envio. |
| `options[].currency` | Moneda esperada, normalmente `MXN`. |
| `options[].estimatedDeliveryDate` | Fecha estimada si FedEx la devuelve. |
| `options[].transitTime` | Tiempo de transito si FedEx lo devuelve. |

Errores que el frontend debe manejar:

| Caso | Accion UI |
| --- | --- |
| Carrito vacio | Regresar al carrito. |
| Producto sin peso/dimensiones FedEx | Bloquear checkout con envio y avisar soporte/admin. |
| Cotizacion no disponible | Permitir reintentar o cambiar direccion. |
| FedEx devuelve `422` por combinacion servicio/empaque | Mostrar mensaje recuperable y permitir reintentar; no iniciar pago. |
| FedEx devuelve `422` por cuenta, zona, CP, pickup o dimensiones | Mostrar el mensaje del backend, permitir corregir direccion/reintentar y escalar a admin si apunta a producto/configuracion. |
| Cotizacion expirada | Recotizar. |
| Carrito cambio despues de cotizar | Recotizar antes de checkout. |

## Checkout con FedEx

Endpoint:

`POST /api/carrito/checkout`

Campos relevantes para DELIVERY:

| Campo | Regla |
| --- | --- |
| `fulfillmentMethod` | Debe ser `DELIVERY`. |
| `direccionEnvio` | Obligatoria. |
| `metodoPago` | `TARJETA` para Stripe o `APLAZO` para Aplazo. |
| `shippingQuoteId` | Obligatorio. Usar `quoteId`. |
| `selectedShippingOptionId` | Preferido. Usar `optionId`. |
| `selectedServiceType` | Alternativa legacy si no se usa `optionId`; no usar para cotizar. |
| `costoEnvio` | No enviarlo. El backend lo calcula desde la cotizacion. |

Al crear la orden, el backend guarda el snapshot FedEx en `order.shipping` y recalcula `subtotal`, `impuestos`, `costoEnvio` y `total`.

## Pagos y FedEx

### Stripe

Despues de crear la orden con `metodoPago: TARJETA`, continuar con el flujo Stripe existente.

Cuando el webhook de Stripe confirma el pago:

- La orden pasa a confirmada.
- El costo FedEx ya esta incluido en el total de la orden.
- Stripe Checkout agrega el envio como item de pago cuando existe `costoEnvio`.
- El backend puede generar guia FedEx automaticamente si la orden es DELIVERY y tiene `shipping.provider: FEDEX`.

### Aplazo

Despues de crear la orden con `metodoPago: APLAZO`, iniciar Aplazo con:

`POST /api/payments/aplazo/online/create`

Cuando Aplazo confirma por webhook o reconciliacion:

- La orden pasa a confirmada.
- Aplazo recibe el total con envio incluido.
- El snapshot de precios incluye `shippingMinor`.
- El backend puede generar guia FedEx automaticamente si la orden es DELIVERY y tiene `shipping.provider: FEDEX`.

### Estados esperados

| Momento | Orden | FedEx |
| --- | --- | --- |
| Orden creada antes de pagar | `PENDIENTE` | `QUOTE_SELECTED` |
| Pago confirmado | `CONFIRMADA` | `LABEL_CREATED` si la guia se creo |
| Guia en transito | `CONFIRMADA` o `ENVIADA` | `IN_TRANSIT` |
| Entrega final | `ENTREGADA` | `DELIVERED` |
| Pago fallido/cancelado | `CANCELADA` si aplica | Guia cancelada si existia y era cancelable |

## Tracking cliente

Endpoint:

`GET /api/orders/{orderId}/tracking`

Respuesta util:

| Campo | Uso |
| --- | --- |
| `trackingNumber` | Numero visible de guia. |
| `status` | Estado normalizado. |
| `statusLabel` | Texto listo para UI. |
| `statusDescription` | Descripcion adicional. |
| `estimatedDeliveryDate` | ETA si existe. |
| `deliveredAt` | Fecha de entrega si aplica. |
| `lastLocation` | Ultima ubicacion conocida. |
| `events` | Eventos resumidos para timeline. |
| `warnings` | Mensajes no bloqueantes. |

Estados normalizados:

- `LABEL_CREATED`
- `IN_TRANSIT`
- `OUT_FOR_DELIVERY`
- `DELIVERED`
- `EXCEPTION`
- `UNKNOWN`

## APIs admin FedEx

Todas requieren Bearer token con rol admin/empleado.

| Uso | Endpoint |
| --- | --- |
| Health OAuth FedEx | `GET /api/admin/fedex/auth/health` |
| Health cotizacion | `GET /api/admin/fedex/rates/health` |
| Health direccion | `GET /api/admin/fedex/address/health` |
| Crear guia para orden | `POST /api/admin/orders/{orderId}/fedex/ship` |
| Cancelar guia de orden | `POST /api/admin/orders/{orderId}/fedex/cancel-shipment` |
| Tracking admin de orden | `GET /api/admin/orders/{orderId}/fedex/tracking` |
| Tracking directo por guias | `POST /api/admin/fedex/track` |
| Disponibilidad pickup FedEx | `POST /api/admin/fedex/pickups/availability` |
| Crear pickup FedEx | `POST /api/admin/fedex/pickups` |
| Cancelar pickup FedEx | `POST /api/admin/fedex/pickups/{pickupId}/cancel` |
| Crear etiqueta sandbox | `POST /api/admin/fedex/ship/test-label` |
| Cancelar etiqueta sandbox | `POST /api/admin/fedex/ship/cancel-test` |

## Tracking admin directo

Endpoint:

`POST /api/admin/fedex/track`

Campos:

| Campo | Regla |
| --- | --- |
| `trackingNumbers` | 1 a 30 guias. |
| `includeDetailedScans` | Opcional; usar solo cuando la UI necesite detalle completo. |

La respuesta agrupa resultados por guia en `results`.

## Crear guia admin

Endpoint:

`POST /api/admin/orders/{orderId}/fedex/ship`

Campos opcionales:

| Campo | Regla |
| --- | --- |
| `serviceType` | Si no se manda, backend usa el servicio seleccionado en la cotizacion. |
| `labelImageType` | `PDF` por defecto; tambien soporta `PNG`. |

Respuesta util:

| Campo | Uso |
| --- | --- |
| `trackingNumber` | Guia principal. |
| `serviceType` | Servicio utilizado. |
| `labelUrl` | URL de etiqueta si se genero. |
| `labelStoragePath` | Ruta interna en storage. |
| `alreadyCreated` | Evita duplicar UI si la guia ya existia. |
| `warnings` | Mensajes no bloqueantes. |

## Cancelar guia admin

Endpoint:

`POST /api/admin/orders/{orderId}/fedex/cancel-shipment`

Campos:

| Campo | Regla |
| --- | --- |
| `reason` | Motivo visible/auditable. |
| `forceRefreshTracking` | Usar cuando se necesita validar estado reciente antes de cancelar. |

No permitir en UI cancelar una guia marcada como `DELIVERED`.

## Pickups FedEx admin

Usar pickup FedEx cuando operaciones necesita programar recoleccion de paquetes ya etiquetados.

| Endpoint | Uso |
| --- | --- |
| `POST /api/admin/fedex/pickups/availability` | Verificar ventana disponible. |
| `POST /api/admin/fedex/pickups` | Crear pickup para una o varias ordenes. |
| `POST /api/admin/fedex/pickups/{pickupId}/cancel` | Cancelar pickup programado. |

Campos principales:

| Campo | Regla |
| --- | --- |
| `pickupDate` | Formato `YYYY-MM-DD`. |
| `readyTime` | Formato `HH:mm:ss`. |
| `latestTime` | Debe ser mayor que `readyTime`. |
| `orderIds` | Ordenes con guia FedEx. |
| `carrierCode` | `FDXE` o `FDXG`; opcional en algunos endpoints. |

## Manejo de errores

| HTTP | Significado frontend |
| --- | --- |
| `400` | Datos incompletos o invalidos. |
| `401` | Falta sesion. |
| `403` | Usuario sin permisos. |
| `409` | Cotizacion expirada, carrito cambio, guia no cancelable o conflicto de estado. |
| `422` | FedEx no puede procesar la cotizacion, falta logistica del producto o hubo combinacion servicio/empaque invalida. Mostrar mensaje y permitir reintentar/cambiar direccion. |
| `429` | Rate limit; reintentar despues. |
| `502` | En validacion de direccion: advertencia no bloqueante y continuar a cotizacion. En guia/tracking: FedEx rechazo o no respondio correctamente. |
| `500` | Error interno. |

## Checklist frontend

- Usar `POST /api/carrito/shipping/fedex/quotes` para checkout con envio.
- No enviar `costoEnvio` en checkout DELIVERY.
- Guardar y enviar `quoteId` mas `optionId`; usar `serviceType` solo como fallback legacy.
- No enviar `serviceType`, `packagingType`, `origin`, `packages`, `shipper` ni `accountNumber` para cotizar carrito.
- No agregar `FEDEX_SERVICE_TYPE` ni `FEDEX_ONE_RATE` a variables del frontend.
- Recotizar si cambia direccion, carrito, cantidades o talla.
- Crear la orden antes de iniciar Stripe o Aplazo.
- No mostrar guia hasta que exista `trackingNumber`.
- Consultar tracking desde `/api/orders/{orderId}/tracking`.
- En admin, permitir crear guia manual si el pago ya esta confirmado y no existe guia.
- En reembolsos/cancelaciones, mostrar conflicto si la guia ya fue entregada.

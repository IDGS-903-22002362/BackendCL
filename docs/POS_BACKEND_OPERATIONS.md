# POS Backend — Operaciones

Guía operativa del módulo de Punto de Venta. Complementa
`POS_BACKEND_ARCHITECTURE.md` y `POS_BACKEND_IMPLEMENTATION_PLAN.md`.

## Variables de entorno

| Variable | Valores | Default | Notas |
|----------|---------|---------|-------|
| `POS_APP_CHECK_MODE` | `observe` \| `enforce` | `enforce` en Cloud, `observe` en local | No se omite por Bearer |
| `POS_APP_CHECK_ALLOW_LOCAL_BYPASS` | `true` \| `false` | `false` | Solo emulador/dev; nunca en Cloud |
| `APP_CHECK_ENFORCED` | `true` \| `false` | — | Si es `true`, el POS usa `enforce` |
| `POS_MIGRATION_CONFIRM` | `I_UNDERSTAND` | — | Obligatorio para `--production` |
| `POS_SEED_ALLOW_NON_EMULATOR` | `true` | — | Solo si se siembra fuera del emulador a propósito |
| `FIRESTORE_EMULATOR_HOST` | host:port | — | Emulador Firestore |

No hay secretos específicos del POS: reutiliza JWT, App Check y Firebase Admin del backend.

## Comandos locales

```bash
cd functions
npm ci
npm run build
npm test -- --testPathPatterns="pos\."
npm run validate:pos-openapi

# Emuladores
firebase emulators:start --only firestore,auth --project demo-pos
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run pos:seed:emulator
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run pos:migrate:emulator

# API local
npm run dev
# Base: http://localhost:3000/api/pos/v1
```

Cabeceras mínimas:

* `Authorization: Bearer <jwt-staff>`
* `X-Firebase-AppCheck: <token>` (en `enforce`)
* `Idempotency-Key: <uuid>` en comandos con efectos
* `X-Pos-Device-Id: <id>` opcional

## Seed

IDs fijos (sin PII real):

* Usuarios: `pos-seed-cashier`, `pos-seed-senior`, `pos-seed-supervisor`, `pos-seed-admin`
* Cajas: `pos-seed-reg-01` … `03`, `pos-seed-reg-mobile`
* Productos: `pos-seed-prod-jersey`, `pos-seed-prod-playera`

Para limpiar datos locales del emulador: reiniciar el emulador (no hay wipe destructivo en el script).

## Migración

1. Dry-run: `npm run pos:migrate:dry-run`
2. Emulador: `npm run pos:migrate:emulator`
3. Staging: `npm run build && node lib/modules/pos/scripts/pos-migrate.js --staging`
4. Producción: **no se ejecuta en esta entrega**. Requiere
   `POS_MIGRATION_CONFIRM=I_UNDERSTAND` y `--production`.

Efectos:

* Crea `posSettings/MAIN_STORE` si falta (nunca sobrescribe).
* Crea `posOperators/{uid}` = `CASHIER` para `EMPLEADO` sin registro.
* Reporta productos sin buckets de inventario (sin escribir).

Rollback lógico: eliminar documentos creados listados en el reporte JSON.

## Reconciliación de proyecciones

```bash
npm run build
node lib/modules/pos/scripts/pos-reconcile-projections.js --shift=<shiftId>
# Escritura opcional:
node lib/modules/pos/scripts/pos-reconcile-projections.js --shift=<shiftId> --apply --confirm=APPLY
```

## Política de pagos mixtos con tarjeta rechazada

Si en un pago mixto la parte de tarjeta falla:

1. La parte en efectivo ya aprobada se conserva.
2. La venta permanece en `PAYMENT_PENDING`.
3. El cajero reintenta la tarjeta o cancela; la cancelación genera `CASH_REFUND` de la parte en efectivo.

## Alertas recomendadas (sin infraestructura nueva)

* `pos.stock.insufficient` sostenido
* `pos.idempotency.conflict` elevado
* `pos.transaction.contention` / Firestore `ABORTED`
* `pos.close.forced`
* `pos.cut.difference` por encima del umbral de admin
* `pos.http.5xx` en `/api/pos/v1`

## Matriz de permisos (resumen)

| Capacidad | Cajero | Senior | Supervisor | Admin | Super |
|-----------|:------:|:------:|:----------:|:-----:|:-----:|
| `pos.access` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `pos.sale.create` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `pos.sale.discount_manual` | | ✓ | ✓ | ✓ | ✓ |
| `pos.sale.refund` | | | ✓ | ✓ | ✓ |
| `register.open` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `register.force_close` | | | | ✓ | ✓ |
| `cut.approve` | | | ✓ | ✓ | ✓ |
| `cut.reopen` | | | | ✓ | ✓ |
| `daily_close.execute` | | | | ✓ | ✓ |
| `daily_close.force` | | | | | ✓ |
| `pos.config.manage` | | | | ✓ | ✓ |
| `audit.read` | | | | ✓ | ✓ |

Regla de separación: nadie aprueba su propio corte ni su propia solicitud de movimiento.

## Despliegue futuro

1. `npm run build` y `npm run test -- --testPathPatterns="pos\."`
2. Desplegar índices: `firebase deploy --only firestore:indexes --project e-comerce-leon`
3. Desplegar reglas: `firebase deploy --only firestore:rules --project e-comerce-leon`
4. Desplegar functions cuando el frontend POS esté listo
5. Ejecutar migración en staging antes de producción

No desplegar desde esta tarea.

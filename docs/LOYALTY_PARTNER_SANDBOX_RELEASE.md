# Release operativo — Loyalty Partner API (Sandbox)

**Fecha:** 2026-07-01  
**Veredicto:** **LISTO PARA ENTREGAR A SOCIOS (sandbox piloto)**

## URLs

| Recurso | URL |
|---------|-----|
| API sandbox | https://us-central1-e-comerce-leon.cloudfunctions.net/api/loyalty/sandbox/v1 |
| Portal | https://clubleon-developer-portal--e-comerce-leon.us-central1.hosted.app |
| OpenAPI | /openapi/loyalty-public-v1.yaml en portal |
| Postman | /postman/Club-Leon-Loyalty-API.postman_collection.json en portal |

## DNS developers.clubleon.mx

En Firebase Console → App Hosting → clubleon-developer-portal → Add custom domain.
Apuntar CNAME segun instrucciones de Firebase. CORS ya incluye https://developers.clubleon.mx.

## Socio Piloto A (redactado)

- partnerId: partner_test_fc32a6cfe47b7273
- clientId: client_test_e4950f34c84505f0a953e7fe
- clientSecret: canal seguro (rotado en release)
- test member: test_member_partner_a_001 (500 pts)

## Pruebas live: PASS (battery + E2E A/B/C + concurrencia 20x + rate limit 429 + Newman oauth 200)

## Revocacion v1: tokens emitidos validos hasta exp (3600s); sin denylist.
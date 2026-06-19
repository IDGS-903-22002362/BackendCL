# Recomendaciones - despliegue Firestore

Los indices viven en `BackendCL/firestore.indexes.json`.

Desplegar solo indices:

```bash
cd "C:/Users/luisr/Documents/Club Leon Projects/BackendCL"
firebase deploy --only firestore:indexes --project e-comerce-leon
```

Colecciones indexadas: recomendacionEventos, recomendacionCache, recomendacionMetricas, productos (activo+disponible+updatedAt).

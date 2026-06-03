import { getFirestore } from 'firebase-admin/firestore';

async function setupTTL() {
  const db = getFirestore();
  
  // Firestore TTL se configura desde la consola o CLI
  // No hay API para crear políticas TTL programáticamente
  console.log(`
    ⚠️ Configuración manual requerida:
    1. Ve a Firebase Console → Firestore
    2. Crea colección 'temp_verification_codes'
    3. Ve a la pestaña "Políticas de TTL"
    4. Crea política con campo 'expiresAt'
  `);
}
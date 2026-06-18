const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

(async () => {
  try {
    const serviceAccountPath = path.resolve(__dirname, '..', '..', 'serviceAccountKey.json');
    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      console.log('Initialized admin with local service account');
    } else {
      admin.initializeApp();
      console.log('Initialized admin with default credentials');
    }

    const db = admin.firestore();

    const collections = [
      'liga_mx_plantillas_actuales',
      'liga_mx_jugadores_actuales',
      'liga_mx_contexto_actual',
    ];

    for (const col of collections) {
      const snapshot = await db.collection(col).get();
      console.log(`\nCollection: ${col}  (count=${snapshot.size})`);
      snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`- id=${doc.id} ->`, JSON.stringify(Object.keys(data).slice(0,10)));
      });
    }

    process.exit(0);
  } catch (err) {
    console.error('Error querying Firestore:', err);
    process.exit(1);
  }
})();

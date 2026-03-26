import axios from 'axios';
import { firestoreApp } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import { SyncDocument } from '../models/sync.model';

export class SyncService {
  private baseUrl = process.env.LMX_API_URL;
  private apiKey = process.env.LMX_API_KEY;

  private async get(path: string, params: any) {
    const res = await axios.get(`${this.baseUrl}${path}`, {
      headers: {
        'x-api-key': this.apiKey,
      },
      params,
    });

    return res.data?.data ?? res.data ?? [];
  }

  // 🔥 UNA SOLA FUNCIÓN → UNA SOLA EJECUCIÓN → TODO ACTUALIZA
  async syncAll(
    idTemporada: number,
    idTorneo: number,
    idDivision: number
  ) {
    // 👇 llamadas internas (siguen siendo varias, pero TU función es UNA)
    const [calendarioRaw, tablaRaw] = await Promise.all([
      this.get('/v2/calendario', {
        idTemporada,
        idTorneo,
        idDivision,
      }),
      this.get('/v2/tablaGeneral', {
        idTemporada,
        idTorneo,
        idDivision,
      }),
    ]);

    const calendario = calendarioRaw;
    const clasificacion = tablaRaw;

    const torneo = idTorneo === 1 ? 'Apertura' : 'Clausura';

    const doc: SyncDocument = {
      idTemporada,
      idTorneo,
      idDivision,
      torneo,
      calendario,
      clasificacion,
      updatedAt: new Date() as any,
    };

    await firestoreApp
      .collection('leon_data')
      .doc(`${idTemporada}_${idTorneo}_${idDivision}`)
      .set(doc, { merge: true });

    return doc;
  }
}
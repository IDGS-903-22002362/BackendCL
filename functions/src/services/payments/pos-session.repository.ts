import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import { EstadoPosSession, PosSession } from "../../models/pos-session.model";

export const POS_SESSIONS_COLLECTION = "posSessions";

export class PosSessionRepository {
  private readonly collection = firestoreTienda.collection(POS_SESSIONS_COLLECTION);

  async getOpenSession(id: string): Promise<PosSession | null> {
    const snapshot = await this.collection.doc(id).get();
    if (!snapshot.exists) {
      return null;
    }

    const session = {
      id: snapshot.id,
      ...(snapshot.data() as PosSession),
    };

    if (session.status !== EstadoPosSession.OPEN) {
      return null;
    }

    return session;
  }

  async touch(id: string): Promise<void> {
    await this.collection.doc(id).set(
      {
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  }
}

export const posSessionRepository = new PosSessionRepository();
export default posSessionRepository;

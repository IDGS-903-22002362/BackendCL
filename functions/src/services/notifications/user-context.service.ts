import { firestoreApp } from "../../config/app.firebase";
import { notificationCollections } from "./collections";

class NotificationUserContextService {
  async resolveUserDocument(
    userId: string,
  ): Promise<FirebaseFirestore.DocumentSnapshot> {
    const normalizedUserId = userId.trim();
    const directRef = firestoreApp
      .collection(notificationCollections.users)
      .doc(normalizedUserId);
    const directSnapshot = await directRef.get();

    if (directSnapshot.exists) {
      return directSnapshot;
    }

    const snapshot = await firestoreApp
      .collection(notificationCollections.users)
      .where("uid", "==", normalizedUserId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new Error(`Usuario "${normalizedUserId}" no encontrado`);
    }

    return snapshot.docs[0];
  }

  async resolveUserReference(
    userId: string,
  ): Promise<FirebaseFirestore.DocumentReference> {
    const snapshot = await this.resolveUserDocument(userId);
    return snapshot.ref;
  }

  async getUserData<T extends Record<string, unknown> = Record<string, unknown>>(
    userId: string,
  ): Promise<(T & { id: string }) | null> {
    const snapshot = await this.resolveUserDocument(userId).catch(() => null);

    if (!snapshot?.exists) {
      return null;
    }

    return {
      id: snapshot.id,
      ...(snapshot.data() as T),
    };
  }
}

export const notificationUserContextService =
  new NotificationUserContextService();
export default notificationUserContextService;

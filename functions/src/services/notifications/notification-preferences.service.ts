import { Timestamp } from "firebase-admin/firestore";
import notificationConfig from "../../config/notification.config";
import {
  NotificationEventType,
  NotificationPreferenceDocument,
} from "../../models/notificacion.model";
import { notificationCollections } from "./collections";
import notificationUserContextService from "./user-context.service";

type NotificationPreferencesPatch = Partial<
  Omit<
    NotificationPreferenceDocument,
    "id" | "userId" | "createdAt" | "updatedAt"
  >
>;

class NotificationPreferencesService {
  private async getPreferencesRef(
    userId: string,
  ): Promise<FirebaseFirestore.DocumentReference> {
    const userRef = await notificationUserContextService.resolveUserReference(
      userId,
    );

    return userRef
      .collection(notificationCollections.userPreferences)
      .doc("default");
  }

  private async buildDefaultPreferences(
    userId: string,
  ): Promise<Omit<NotificationPreferenceDocument, "id">> {
    const userData = await notificationUserContextService.getUserData(userId);
    const timezoneCandidate =
      typeof userData?.timezone === "string"
        ? userData.timezone
        : typeof userData?.timeZone === "string"
          ? userData.timeZone
          : undefined;
    const localeCandidate =
      typeof userData?.locale === "string" ? userData.locale : undefined;
    const now = Timestamp.now();

    return {
      userId,
      pushEnabled: true,
      transactionalEnabled: true,
      orderUpdatesEnabled: true,
      cartRemindersEnabled: true,
      restockEnabled: true,
      priceDropEnabled: true,
      marketingEnabled: true,
      matchdayEnabled: true,
      reactivationEnabled: true,
      recommendationsEnabled: true,
      quietHours: {
        enabled: notificationConfig.defaults.quietHours.enabled,
        startHour: notificationConfig.defaults.quietHours.startHour,
        endHour: notificationConfig.defaults.quietHours.endHour,
      },
      timezone:
        timezoneCandidate?.trim() || notificationConfig.defaults.timezone,
      locale: localeCandidate?.trim() || notificationConfig.defaults.locale,
      maxMarketingPerDay: notificationConfig.defaults.marketingMaxPerDay,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getPreferences(userId: string): Promise<NotificationPreferenceDocument> {
    const preferencesRef = await this.getPreferencesRef(userId);
    const snapshot = await preferencesRef.get();

    if (!snapshot.exists) {
      const defaults = await this.buildDefaultPreferences(userId);
      await preferencesRef.set(defaults);

      return {
        id: preferencesRef.id,
        ...defaults,
      };
    }

    return {
      id: snapshot.id,
      ...(snapshot.data() as NotificationPreferenceDocument),
    };
  }

  async updatePreferences(
    userId: string,
    patch: NotificationPreferencesPatch,
  ): Promise<NotificationPreferenceDocument> {
    const preferencesRef = await this.getPreferencesRef(userId);
    const current = await this.getPreferences(userId);
    const nextQuietHours = patch.quietHours
      ? {
          ...current.quietHours,
          ...patch.quietHours,
        }
      : current.quietHours;

    await preferencesRef.set(
      {
        ...patch,
        ...(patch.timezone ? { timezone: patch.timezone.trim() } : {}),
        ...(patch.locale ? { locale: patch.locale.trim() } : {}),
        ...(patch.quietHours ? { quietHours: nextQuietHours } : {}),
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );

    const updatedSnapshot = await preferencesRef.get();
    return {
      id: updatedSnapshot.id,
      ...(updatedSnapshot.data() as NotificationPreferenceDocument),
    };
  }

  isEventEnabled(
    preference: NotificationPreferenceDocument,
    eventType: NotificationEventType,
  ): boolean {
    if (!preference.pushEnabled) {
      return false;
    }

    switch (eventType) {
      case "order_created":
      case "order_confirmed":
      case "order_shipped":
      case "order_delivered":
        return preference.transactionalEnabled && preference.orderUpdatesEnabled;
      case "cart_abandoned":
        return preference.cartRemindersEnabled;
      case "product_restocked":
        return preference.restockEnabled;
      case "price_drop":
        return preference.priceDropEnabled;
      case "inactive_user":
        return preference.reactivationEnabled;
      case "promo_campaign":
        return preference.marketingEnabled;
      case "matchday_campaign":
        return preference.marketingEnabled && preference.matchdayEnabled;
      case "probable_repurchase":
        return preference.marketingEnabled && preference.recommendationsEnabled;
      case "manual_test":
        return true;
      default:
        return false;
    }
  }
}

export const notificationPreferencesService =
  new NotificationPreferencesService();
export default notificationPreferencesService;

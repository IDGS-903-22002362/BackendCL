import { Timestamp } from "firebase-admin/firestore";
import { DevicePushToken } from "../../models/notificacion.model";
import logger from "../../utils/logger";
import { notificationCollections } from "./collections";
import notificationUserContextService from "./user-context.service";

type RegisterDeviceTokenInput = {
  deviceId: string;
  token: string;
  platform: "ios" | "android" | "web";
  locale?: string;
  timezone?: string;
  appVersion?: string;
  buildNumber?: string;
};

type UpdateDeviceTokenInput = Partial<
  Omit<RegisterDeviceTokenInput, "deviceId">
> & {
  enabled?: boolean;
};

class DeviceTokenService {
  private readonly baseLogger = logger.child({
    component: "device-token-service",
  });

  private async getDeviceRef(
    userId: string,
    deviceId: string,
  ): Promise<FirebaseFirestore.DocumentReference> {
    const userRef = await notificationUserContextService.resolveUserReference(
      userId,
    );

    return userRef
      .collection(notificationCollections.userDeviceTokens)
      .doc(deviceId.trim());
  }

  async registerToken(
    userId: string,
    input: RegisterDeviceTokenInput,
  ): Promise<DevicePushToken> {
    const now = Timestamp.now();
    const deviceRef = await this.getDeviceRef(userId, input.deviceId);
    const existingSnapshot = await deviceRef.get();

    const payload: Partial<DevicePushToken> = {
      userId,
      deviceId: input.deviceId.trim(),
      token: input.token.trim(),
      platform: input.platform,
      enabled: true,
      locale: input.locale?.trim(),
      timezone: input.timezone?.trim(),
      appVersion: input.appVersion?.trim(),
      buildNumber: input.buildNumber?.trim(),
      lastSeenAt: now,
      invalidReason: undefined,
      lastFailureAt: undefined,
      updatedAt: now,
    };

    if (!existingSnapshot.exists) {
      await deviceRef.set({
        ...payload,
        createdAt: now,
      });
    } else {
      await deviceRef.set(payload, { merge: true });
    }

    const savedSnapshot = await deviceRef.get();
    const savedData = savedSnapshot.data() as DevicePushToken;

    this.baseLogger.info("device_token_registered", {
      userId,
      deviceId: input.deviceId,
      platform: input.platform,
    });

    return {
      id: savedSnapshot.id,
      ...savedData,
    };
  }

  async updateToken(
    userId: string,
    deviceId: string,
    input: UpdateDeviceTokenInput,
  ): Promise<DevicePushToken> {
    const now = Timestamp.now();
    const deviceRef = await this.getDeviceRef(userId, deviceId);
    const snapshot = await deviceRef.get();

    if (!snapshot.exists) {
      throw new Error(`Dispositivo "${deviceId}" no encontrado`);
    }

    await deviceRef.set(
      {
        ...("token" in input && input.token
          ? { token: input.token.trim(), invalidReason: undefined }
          : {}),
        ...("platform" in input && input.platform
          ? { platform: input.platform }
          : {}),
        ...("locale" in input ? { locale: input.locale?.trim() } : {}),
        ...("timezone" in input ? { timezone: input.timezone?.trim() } : {}),
        ...("appVersion" in input
          ? { appVersion: input.appVersion?.trim() }
          : {}),
        ...("buildNumber" in input
          ? { buildNumber: input.buildNumber?.trim() }
          : {}),
        ...("enabled" in input && input.enabled !== undefined
          ? { enabled: input.enabled }
          : {}),
        lastSeenAt: now,
        updatedAt: now,
      },
      { merge: true },
    );

    const savedSnapshot = await deviceRef.get();
    return {
      id: savedSnapshot.id,
      ...(savedSnapshot.data() as DevicePushToken),
    };
  }

  async disableToken(userId: string, deviceId: string): Promise<void> {
    const deviceRef = await this.getDeviceRef(userId, deviceId);
    const snapshot = await deviceRef.get();

    if (!snapshot.exists) {
      return;
    }

    await deviceRef.set(
      {
        enabled: false,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  }

  async getActiveTokens(userId: string): Promise<DevicePushToken[]> {
    const userRef = await notificationUserContextService.resolveUserReference(
      userId,
    );
    const snapshot = await userRef
      .collection(notificationCollections.userDeviceTokens)
      .where("enabled", "==", true)
      .get();

    return snapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...(doc.data() as DevicePushToken),
      }))
      .filter((device) => Boolean(device.token?.trim()));
  }

  async markTokenInvalid(
    userId: string,
    deviceId: string,
    reason: string,
  ): Promise<void> {
    const deviceRef = await this.getDeviceRef(userId, deviceId);
    const snapshot = await deviceRef.get();

    if (!snapshot.exists) {
      return;
    }

    await deviceRef.set(
      {
        enabled: false,
        invalidReason: reason,
        lastFailureAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );

    this.baseLogger.warn("device_token_marked_invalid", {
      userId,
      deviceId,
      reason,
    });
  }
}

export const deviceTokenService = new DeviceTokenService();
export default deviceTokenService;

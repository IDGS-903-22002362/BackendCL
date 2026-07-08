export type ClientOrigin = "web" | "ios_app" | "android_app";

export type ClientPrivacyMetadata = {
  clientOrigin?: ClientOrigin;
  advertisingTrackingAllowed?: boolean;
};

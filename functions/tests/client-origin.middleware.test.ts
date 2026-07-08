import {
  canSendAdvertisingConversion,
  canSendAdvertisingConversionForOrder,
} from "../src/lib/privacy/advertising-tracking-policy";
import {
  parseClientOriginHeader,
  resolveAdvertisingTrackingAllowed,
} from "../src/middlewares/client-origin.middleware";

describe("client origin middleware helpers", () => {
  it("parses ios_app and android_app strictly", () => {
    expect(parseClientOriginHeader("ios_app")).toBe("ios_app");
    expect(parseClientOriginHeader("android_app")).toBe("android_app");
    expect(parseClientOriginHeader("invalid")).toBe("web");
  });

  it("disables advertising tracking for embedded app origins", () => {
    expect(resolveAdvertisingTrackingAllowed("ios_app")).toBe(false);
    expect(resolveAdvertisingTrackingAllowed("android_app")).toBe(false);
    expect(resolveAdvertisingTrackingAllowed("web")).toBe(true);
  });

  it("blocks advertising conversions for app orders", () => {
    expect(canSendAdvertisingConversion("ios_app")).toBe(false);
    expect(
      canSendAdvertisingConversionForOrder({
        clientOrigin: "android_app",
        advertisingTrackingAllowed: false,
      }),
    ).toBe(false);
    expect(canSendAdvertisingConversion("web")).toBe(true);
  });
});

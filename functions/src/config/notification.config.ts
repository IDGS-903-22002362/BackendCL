const DEFAULT_NOTIFICATION_TIMEZONE = "America/Mexico_City";
const DEFAULT_NOTIFICATION_LOCALE = "es-MX";

const toTrimmedString = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const isValidTimezone = (value: string): boolean => {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

export const resolveNotificationTimezone = (
  value: string | undefined,
  fallback = DEFAULT_NOTIFICATION_TIMEZONE,
): string => {
  const candidate = toTrimmedString(value);
  if (candidate && isValidTimezone(candidate)) {
    return candidate;
  }

  const normalizedFallback =
    toTrimmedString(fallback) || DEFAULT_NOTIFICATION_TIMEZONE;

  return isValidTimezone(normalizedFallback)
    ? normalizedFallback
    : DEFAULT_NOTIFICATION_TIMEZONE;
};

export const resolveNotificationLocale = (
  value: string | undefined,
  fallback = DEFAULT_NOTIFICATION_LOCALE,
): string => toTrimmedString(value) || toTrimmedString(fallback) || DEFAULT_NOTIFICATION_LOCALE;

export const resolveOptionalNotificationTimezone = (
  value: string | undefined,
  fallback = DEFAULT_NOTIFICATION_TIMEZONE,
): string | undefined => {
  const candidate = toTrimmedString(value);
  return candidate ? resolveNotificationTimezone(candidate, fallback) : undefined;
};

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

const toBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
};

export const notificationConfig = {
  defaults: {
    timezone: resolveNotificationTimezone(process.env.NOTIFICATIONS_DEFAULT_TIMEZONE),
    locale: resolveNotificationLocale(process.env.NOTIFICATIONS_DEFAULT_LOCALE),
    quietHours: {
      enabled: toBool(process.env.NOTIFICATIONS_QUIET_HOURS_ENABLED, true),
      startHour: toInt(process.env.NOTIFICATIONS_QUIET_HOURS_START, 22),
      endHour: toInt(process.env.NOTIFICATIONS_QUIET_HOURS_END, 9),
    },
    marketingMaxPerDay: toInt(
      process.env.NOTIFICATIONS_MARKETING_MAX_PER_DAY,
      2,
    ),
  },
  windows: {
    cartAbandonedMinutes: toInt(
      process.env.NOTIFICATIONS_CART_ABANDONED_MINUTES,
      360,
    ),
    cartCooldownHours: toInt(
      process.env.NOTIFICATIONS_CART_COOLDOWN_HOURS,
      48,
    ),
    priceDropCooldownDays: toInt(
      process.env.NOTIFICATIONS_PRICE_DROP_COOLDOWN_DAYS,
      7,
    ),
    productInterestLookbackDays: toInt(
      process.env.NOTIFICATIONS_PRODUCT_INTEREST_LOOKBACK_DAYS,
      30,
    ),
    orderLookbackDays: toInt(
      process.env.NOTIFICATIONS_ORDER_LOOKBACK_DAYS,
      365,
    ),
    inactiveUserDays: toInt(
      process.env.NOTIFICATIONS_INACTIVE_USER_DAYS,
      7,
    ),
    probableRepurchaseDays: toInt(
      process.env.NOTIFICATIONS_PROBABLE_REPURCHASE_DAYS,
      45,
    ),
    campaignCooldownHours: toInt(
      process.env.NOTIFICATIONS_CAMPAIGN_COOLDOWN_HOURS,
      24,
    ),
  },
  scheduler: {
    abandonedCartBatchSize: toInt(
      process.env.NOTIFICATIONS_ABANDONED_CART_BATCH_SIZE,
      200,
    ),
    inactiveUsersBatchSize: toInt(
      process.env.NOTIFICATIONS_INACTIVE_USERS_BATCH_SIZE,
      200,
    ),
    campaignBatchSize: toInt(
      process.env.NOTIFICATIONS_CAMPAIGN_BATCH_SIZE,
      200,
    ),
    repurchaseBatchSize: toInt(
      process.env.NOTIFICATIONS_REPURCHASE_BATCH_SIZE,
      200,
    ),
  },
  ai: {
    promptVersion: toTrimmedString(process.env.AI_NOTIFICATION_PROMPT_VERSION) || "v1",
    modelVersion:
      toTrimmedString(process.env.GEMINI_MODEL_SUMMARY) ||
      toTrimmedString(process.env.GEMINI_MODEL_FAST) ||
      toTrimmedString(process.env.GEMINI_MODEL_PRIMARY) ||
      "gemini-fallback",
  },
};

export default notificationConfig;

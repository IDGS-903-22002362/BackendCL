import { RequestHandler } from "express";
import aiConfig from "../config/ai.config";
import { createSimpleRateLimiter } from "./rate-limit.middleware";

export const createAiRateLimiter = (
  keyPrefix: string,
  maxRequests = aiConfig.api.rateLimitMax,
  windowMs = aiConfig.api.rateLimitWindowMs,
): RequestHandler => {
  return createSimpleRateLimiter({
    keyPrefix,
    maxRequests,
    windowMs,
  });
};

export const aiChatRateLimiter = createAiRateLimiter("ai:chat");
export const aiUploadRateLimiter = createAiRateLimiter("ai:upload", Math.max(3, Math.floor(aiConfig.api.rateLimitMax / 3)));
export const aiTryOnRateLimiter = createAiRateLimiter("ai:tryon", Math.max(5, Math.floor(aiConfig.api.rateLimitMax / 2)));

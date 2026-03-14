import { Timestamp } from "firebase-admin/firestore";
import { RolUsuario } from "../usuario.model";

export enum AiSessionStatus {
  ACTIVE = "active",
  ARCHIVED = "archived",
  CLOSED = "closed",
}

export enum AiMessageRole {
  USER = "user",
  ASSISTANT = "assistant",
  SYSTEM = "system",
  TOOL = "tool",
}

export enum AiToolCallStatus {
  SUCCESS = "success",
  ERROR = "error",
  DENIED = "denied",
}

export enum TryOnJobStatus {
  QUEUED = "queued",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
}

export enum ProductPreviewMode {
  BODY_TRYON = "body_tryon",
  ACCESSORY_MOCKUP = "accessory_mockup",
  PROP_MOCKUP = "prop_mockup",
  UNSUPPORTED = "unsupported",
}

export enum ProductPreviewType {
  APPAREL = "apparel",
  ACCESSORY = "accessory",
  PROP = "prop",
  UNKNOWN = "unknown",
}

export enum ProductPreviewClassificationSource {
  CATEGORY_ID = "category_id",
  CATEGORY_NAME = "category_name",
  LINE_NAME = "line_name",
  DESCRIPTION_KEYWORD = "description_keyword",
  UNCLASSIFIED = "unclassified",
}

export enum TryOnAssetKind {
  USER_UPLOAD = "user_upload",
  PRODUCT_IMAGE = "product_image",
  OUTPUT_IMAGE = "output_image",
}

export interface AiUsageMetrics {
  promptTokens?: number;
  responseTokens?: number;
  totalTokens?: number;
}

export interface AiAttachment {
  assetId: string;
  url?: string;
  mimeType: string;
  kind: TryOnAssetKind | "generic";
}

export interface AiSession {
  id?: string;
  userId: string;
  role: RolUsuario;
  channel: string;
  title: string;
  status: AiSessionStatus;
  summary?: string;
  lastMessageAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AiMessage {
  id?: string;
  sessionId: string;
  userId: string;
  role: AiMessageRole;
  content: string;
  model?: string;
  attachments?: AiAttachment[];
  toolCallIds?: string[];
  latencyMs?: number;
  tokenUsage?: AiUsageMetrics;
  createdAt: Timestamp;
}

export interface AiToolCall {
  id?: string;
  sessionId: string;
  messageId: string;
  userId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: AiToolCallStatus;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  createdAt: Timestamp;
}

export interface TryOnAsset {
  id?: string;
  userId: string;
  sessionId?: string;
  jobId?: string;
  productId?: string;
  variantId?: string;
  sku?: string;
  kind: TryOnAssetKind;
  bucket: string;
  objectPath: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  sha256?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ProductCategorySnapshot {
  categoryId?: string;
  categoryName?: string | null;
  lineId?: string;
  lineName?: string | null;
  productDescription?: string;
}

export interface TryOnJob {
  id?: string;
  userId: string;
  sessionId: string;
  productId: string;
  variantId?: string;
  sku?: string;
  inputUserImageAssetId: string;
  inputUserImageUrl?: string;
  inputProductImageUrl: string;
  outputAssetId?: string;
  // Stable storage reference (gs://...) persisted by backend; signed URLs are generated on demand.
  outputImageUrl?: string;
  status: TryOnJobStatus;
  consentAccepted: boolean;
  requestedByRole: RolUsuario;
  previewMode: ProductPreviewMode;
  productPreviewType: ProductPreviewType;
  classificationSource: ProductPreviewClassificationSource;
  productCategorySnapshot: ProductCategorySnapshot;
  errorCode?: string;
  errorMessage?: string;
  providerJobId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;
}

export interface AiAuditLog {
  id?: string;
  userId?: string;
  sessionId?: string;
  jobId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  status: "success" | "error" | "denied";
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
}

export interface FaqEntry {
  id?: string;
  question: string;
  answer: string;
  tags: string[];
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PolicyDocument {
  id?: string;
  title: string;
  body: string;
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ToolExecutionResult<T extends Record<string, unknown> = Record<string, unknown>> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

# Graph Report - BackendCL  (2026-10-06)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 6795 nodes · 17489 edges · 243 communities (210 shown, 33 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 227 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `89225d03`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166
- Community 167
- Community 168
- Community 169
- Community 170
- Community 171
- Community 172
- Community 173
- Community 174
- Community 175
- Community 176
- Community 177
- Community 178
- Community 179
- Community 180
- Community 181
- Community 182
- Community 183
- Community 184
- Community 185
- Community 186
- Community 187
- Community 188
- Community 189
- Community 190
- Community 191
- Community 192
- Community 193
- Community 194
- Community 195
- Community 196
- Community 197
- Community 198
- Community 199
- Community 200
- Community 201
- Community 202
- Community 203
- Community 204
- Community 205
- Community 206
- Community 208
- Community 209
- Community 210
- Community 211
- Community 212
- Community 213
- Community 214
- Community 215
- Community 216
- Community 217
- Community 220
- Community 221
- Community 222
- Community 224
- Community 229
- Community 231
- Community 232
- Community 233
- Community 234
- Community 236
- Community 237

## God Nodes (most connected - your core abstractions)
1. `RolUsuario` - 112 edges
2. `ApiError` - 87 edges
3. `firestoreTienda` - 84 edges
4. `PaymentApiError` - 78 edges
5. `LoyaltyProblemError` - 77 edges
6. `ProductService` - 72 edges
7. `Producto` - 70 edges
8. `firestoreApp` - 68 edges
9. `Orden` - 67 edges
10. `PaymentAttempt` - 61 edges

## Surprising Connections (you probably didn't know these)
- `AuthenticatedUser` --references--> `RolUsuario`  [EXTRACTED]
  functions/src/types/express.d.ts → functions/src/models/usuario.model.ts
- `webhook()` --calls--> `ApiError`  [EXTRACTED]
  functions/src/controllers/payments/payments.command.controller.ts → functions/src/utils/api-error.ts
- `aiUploadMiddleware` --calls--> `ApiError`  [EXTRACTED]
  functions/src/services/ai/storage/ai-upload.middleware.ts → functions/src/utils/api-error.ts
- `Request` --references--> `LoyaltyActorContext`  [EXTRACTED]
  functions/src/modules/loyalty/middleware/loyalty.middleware.ts → functions/src/modules/loyalty/models/loyalty.types.ts
- `createTryOnJob()` --calls--> `toAiErrorPayload()`  [EXTRACTED]
  functions/src/controllers/ai/tryon.controller.ts → functions/src/services/ai/ai.error.ts

## Import Cycles
- None detected.

## Communities (243 total, 33 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (87): employeeCapabilities, getAiCapabilitiesFromRequest(), normalizeScopes(), requireAiAdmin(), requireAiCapability(), AiAgentType, ADMIN, SHOPPING (+79 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (67): getAll(), getById(), getFotosPorId(), asPlainBody(), handleMultipart(), MIME_BY_EXTENSION, MulterFile, resolveUploadMimeType() (+59 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (50): admin, fs, path, admin, fs, path, appOficial, firestoreApp (+42 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (77): LoyaltyTransactionType, ADJUSTMENT, BONUS, EARN, EXPIRATION, REDEMPTION_CONFIRM, REDEMPTION_HOLD, REDEMPTION_REFUND (+69 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (55): LOYALTY_PARTNER_COLLECTIONS, LOYALTY_PROBLEM_BASE_URI, LoyaltyProblemCode, LoyaltyProblemError, PROBLEM_META, LoyaltyEnvironment, PRODUCTION, SANDBOX (+47 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (44): firestoreTienda, tiendaApp, AiAuditLog, AiMessage, AiMessageRole, ASSISTANT, SYSTEM, TOOL (+36 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (65): cleanText(), createOptionId(), createQuoteId(), DEFAULT_CARRIER_CODES, DEFAULT_RATE_REQUEST_TYPES, FedexClientLike, FedexPublicRateError, FedexPublicRateErrorCode (+57 more)

### Community 7 - "Community 7"
Cohesion: 0.04
Nodes (50): aiConfig, assertAiConfig(), AssertAiConfigOptions, assertVertexCompatibleGeminiModel(), buildVertexModelConfigError(), GeminiExecutionMode, geminiMode, getAiRuntimeSummary() (+42 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (45): configuracionOpta, tieneCredencialesOpta(), validarConfiguracionOpta(), aTexto(), CalendarioCrudo, esCalendarioLigaMx(), extraerNombreCompetencia(), seleccionarCalendarioActivo() (+37 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (63): baseUrl, main(), newRequestId(), PARALLEL, request(), assert(), clientA, clientB (+55 more)

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (29): buildErrorResponse(), createFavorito(), deleteFavorito(), favoritoCommandLogger, getStatusFromErrorCode(), buildErrorResponse(), checkFavorito(), favoritoQueryLogger (+21 more)

### Community 11 - "Community 11"
Cohesion: 0.04
Nodes (68): axios, busboy, cors, express, helmet, uuid, zod, main (+60 more)

### Community 12 - "Community 12"
Cohesion: 0.06
Nodes (30): CHECKOUT_STALE_PAYMENT_PENDING_MINUTES, INVENTORY_EMPLOYEE_ADJUSTMENT_LIMIT, INVENTORY_RESERVATION_TTL_MINUTES, CheckoutAttempt, CheckoutAttemptStatus, CANCELED, CREATED, EXPIRED (+22 more)

### Community 13 - "Community 13"
Cohesion: 0.06
Nodes (57): mapFedexPickupAvailabilityRequest(), mapFedexPickupCancelRequest(), assertPickupEnabled(), calculateShipmentTotals(), createPickupId(), DocumentReferenceLike, DocumentSnapshotLike, FEDEX_PICKUP_AVAILABILITY_PATH (+49 more)

### Community 14 - "Community 14"
Cohesion: 0.10
Nodes (56): assertAplazoEnabled(), getAplazoContractConfig(), getAplazoContractTodoMessage(), sanitizeAplazoPayload(), createPaymentProviderError(), createPaymentProviderNetworkError(), createPaymentProviderTimeoutError(), createPaymentValidationError() (+48 more)

### Community 15 - "Community 15"
Cohesion: 0.05
Nodes (43): AiSessionStatus, ACTIVE, ARCHIVED, CLOSED, ProductCategorySnapshot, ProductPreviewMode, ACCESSORY_MOCKUP, BODY_TRYON (+35 more)

### Community 16 - "Community 16"
Cohesion: 0.06
Nodes (37): LOYALTY_COLLECTIONS, LOYALTY_DEFAULTS, LOYALTY_PROBLEM_BASE_URI_LEGACY, earnLoyaltyPointsForPaidOrder(), reverseLoyaltyPointsForRefund(), systemActor, LoyaltyRedemptionStatus, CANCELLED (+29 more)

### Community 17 - "Community 17"
Cohesion: 0.06
Nodes (50): swaggerDefinition, swaggerOptions, uploadAiFileBodySchema, removeBeneficioImagenSchema, beneficioRedireccionSchema, createBeneficioSchema, puntosRecompensaSchema, updateBeneficioSchema (+42 more)

### Community 18 - "Community 18"
Cohesion: 0.09
Nodes (15): buildHostedCheckoutSessionBaseParams(), buildStripeCheckoutSessionExpiresAt(), buildStripePaymentIntentCardOptions(), getAppUrl(), getStripeClient(), getStripeCurrency(), getMetadataString(), isAdminOrEmpleado() (+7 more)

### Community 19 - "Community 19"
Cohesion: 0.07
Nodes (26): LoyaltyChannel, ADMIN, ECOMMERCE, PARTNER, STORE, SYSTEM, LoyaltyTransactionStatus, CONFIRMED (+18 more)

### Community 20 - "Community 20"
Cohesion: 0.06
Nodes (54): AnalyticsOrder, buildDataQuality(), ANALYTICS_TOOLS, AffinityPair, analyzeAffinity(), buildCustomerCohorts(), buildCustomerSegments(), BusinessPriority (+46 more)

### Community 21 - "Community 21"
Cohesion: 0.06
Nodes (54): aggregateProductBehavior(), BehaviorDailyPoint, __behaviorMetricsTestables, buildBehaviorDailySeries(), buildBehaviorDataQuality(), buildConversionFunnel(), buildHourlyDistribution(), classifyInterest() (+46 more)

### Community 22 - "Community 22"
Cohesion: 0.08
Nodes (34): AlcanceOferta, CalcularPrecioOfertaItemDto, FechaOfertaInput, Oferta, PrecioOfertaCalculado, ResultadoCalculoOfertas, TipoDescuento, FechaFirestore (+26 more)

### Community 23 - "Community 23"
Cohesion: 0.07
Nodes (46): codigosPromocionCommandController, RequestWithAuth, codigosPromocionQueryController, AplicaCodigoPromocion, CodigoPromocion, CodigoPromocionFilters, CreateCodigoPromocionDto, ItemValidarCodigoPromocionDto (+38 more)

### Community 24 - "Community 24"
Cohesion: 0.05
Nodes (35): FedexProviderError, cancelFedexPickup(), cancelFedexShipmentForOrder(), cancelFedexTestShipment(), checkFedexPickupAvailability(), createFedexPickup(), createFedexShipmentForOrder(), createFedexTestLabel() (+27 more)

### Community 25 - "Community 25"
Cohesion: 0.06
Nodes (46): attributeIndicatesValid(), buildChanges(), collectMessages(), determineIsValid(), extractScore(), FedexAddressValidationPayload, getFirstResolvedAddress(), hasStrongErrorMessage() (+38 more)

### Community 26 - "Community 26"
Cohesion: 0.07
Nodes (35): fedexLabelStockType, mapFedexCancelShipmentRequest(), assertCompleteAddress(), assertPackages(), buildRecipient(), currentShipDate(), FEDEX_CANCEL_DELETION_CONTROL, FEDEX_CANCEL_SHIPMENT_METHOD (+27 more)

### Community 27 - "Community 27"
Cohesion: 0.07
Nodes (39): buildFedexTrackingUrl(), calculateManualShippingCost(), isLeonPostalCode(), LEON_POSTAL_CODE_MAX, LEON_POSTAL_CODE_MIN, MANUAL_FEDEX_CARRIER, MANUAL_FEDEX_CURRENCY, MANUAL_FEDEX_METHOD (+31 more)

### Community 28 - "Community 28"
Cohesion: 0.05
Nodes (49): app, NOTIFICATION_SCHEDULER_SECRETS, scheduledAccountDeletion, abandonedCartNotifications, api, birthdayNotifications, campaignNotifications, cleanupRecommendationEventsFunction (+41 more)

### Community 29 - "Community 29"
Cohesion: 0.07
Nodes (30): FedexAuthService, FedexCachedToken, FedexOAuthResponse, FedexTokenStatus, isValidOAuthResponse(), FedexClient, FedexRequestConfig, FedexConfig (+22 more)

### Community 30 - "Community 30"
Cohesion: 0.07
Nodes (33): abandonAttempt(), cancelAttempt(), getAttemptStatus(), getAuthenticatedUid(), getIdempotencyKey(), quoteFieraPoints(), reconcilePendingAttempts(), startCheckout() (+25 more)

### Community 31 - "Community 31"
Cohesion: 0.07
Nodes (39): requestVerificationCode(), verifyAndLogin(), refreshToken(), buildUsuarioFromDoc(), calcularEdad(), getFirebaseWebApiKey(), getIdentityToolkitErrorCode(), isAlreadyExistsError() (+31 more)

### Community 32 - "Community 32"
Cohesion: 0.07
Nodes (27): AiAttachment, AiSessionMode, AUTHENTICATED, GUEST, resolveAiAgentType(), RolUsuario, ADMIN, CLIENTE (+19 more)

### Community 33 - "Community 33"
Cohesion: 0.08
Nodes (39): cleanText(), FedexClientLike, FedexServiceAvailabilityError, FedexServiceAvailabilityErrorCode, FedexServiceAvailabilityService, getDefaultShipDatestamp(), isPlainDate(), mapProviderError() (+31 more)

### Community 34 - "Community 34"
Cohesion: 0.05
Nodes (30): addMediaMetadata(), create(), deleteImage(), deleteVideo(), createGalleryMediaMetadataSchema(), createGallerySchema, deleteGalleryImageSchema, deleteGalleryVideoSchema (+22 more)

### Community 35 - "Community 35"
Cohesion: 0.07
Nodes (49): aggregateByProduct(), breakdownOrders(), buildDailySeries(), buildVariation(), countUnits(), DailyPoint, increment(), isCanceledOrder() (+41 more)

### Community 36 - "Community 36"
Cohesion: 0.08
Nodes (38): alertToMessage(), fedexTrackingStatusLabels, getDateTimeByType(), getEstimatedDeliveryDate(), getLastEvent(), labelCreatedResult(), mapEvents(), mapFedexTrackRequest() (+30 more)

### Community 37 - "Community 37"
Cohesion: 0.05
Nodes (45): ADMIN_REPORT_BLOCK_TYPES, ADMIN_REPORT_CHART_TYPES, ADMIN_REPORT_VALUE_FORMATS, AdminReportKpiItem, adminReportSchema, anomalyBlockSchema, buildAdminReportJsonSchema(), chartBlockSchema (+37 more)

### Community 38 - "Community 38"
Cohesion: 0.07
Nodes (33): createTryOnJob(), tryOnControllerLogger, TryOnEligibility, AI_INTERNAL_ERROR_CODE, AI_TRYON_ASSET_UNAVAILABLE_CODE, AI_TRYON_DISABLED_CODE, AI_TRYON_RATE_LIMIT_CODE, PRODUCT_PREVIEW_CLASSIFICATION_FAILED_CODE (+25 more)

### Community 39 - "Community 39"
Cohesion: 0.04
Nodes (49): scripts, activate:loyalty-flags, audit:stripe-payments, backfill:personalizable, backfill:search-text, backup:pos-repair, build, build:watch (+41 more)

### Community 40 - "Community 40"
Cohesion: 0.06
Nodes (35): aiAdminChatRateLimiter, aiChatRateLimiter, aiPublicChatRateLimiter, aiTryOnRateLimiter, aiUploadRateLimiter, createAiRateLimiter(), aiTryOnPollRateLimiter, aiTryOnUserRateLimiter (+27 more)

### Community 41 - "Community 41"
Cohesion: 0.06
Nodes (19): deleteUserImage(), uploadUserImage(), TryOnAsset, TryOnAssetKind, OUTPUT_IMAGE, PRODUCT_IMAGE, USER_UPLOAD, AiFileService (+11 more)

### Community 42 - "Community 42"
Cohesion: 0.08
Nodes (44): mapAddress(), mapContact(), mapFedexPickupCreateRequest(), getPickupContact(), alertToMessage(), assertValidPackage(), cleanFedexText(), cleanOptionalText() (+36 more)

### Community 43 - "Community 43"
Cohesion: 0.12
Nodes (24): ReservaInventario, ActualizarProductoDTO, CrearProductoDTO, FedexProductShipping, InventarioGlobalBuckets, InventarioPorTallaBuckets, InventarioPorTallaExtended, ProductoDetallado (+16 more)

### Community 44 - "Community 44"
Cohesion: 0.13
Nodes (10): PaymentPricingSnapshot, PaymentApiError, ProviderRefundStatusEntry, PaymentRefundRequestRecord, isPrivileged(), normalizeCurrency(), PaymentsService, roundToMinor() (+2 more)

### Community 45 - "Community 45"
Cohesion: 0.08
Nodes (30): PaymentStatus, AUTHORIZED, CANCELED, CREATED, EXPIRED, FAILED, PAID, PARTIALLY_REFUNDED (+22 more)

### Community 46 - "Community 46"
Cohesion: 0.07
Nodes (33): authAppOficial, createFirebaseSessionToken(), logout(), logoutAllSessions(), maskUid(), buildRateLimitKey(), cleanupExpired(), consumeInMemoryRateLimit() (+25 more)

### Community 47 - "Community 47"
Cohesion: 0.10
Nodes (30): messagingAppOficial, notificationConfig, NotificationBroadcastChunkStatus, NotificationBroadcastJob, NotificationBroadcastStatus, NotificationBroadcastTarget, NotificationCategory, NotificationDeliveryStatus (+22 more)

### Community 48 - "Community 48"
Cohesion: 0.16
Nodes (7): LigaMxService, ClasificacionLigaMxDoc, ContextoLigaMxDoc, DetallePartidoLigaMxDoc, DivisionKey, PartidoLigaMxDoc, PlantillaLigaMxDoc

### Community 49 - "Community 49"
Cohesion: 0.06
Nodes (32): addItemCarritoSchema, checkoutCarritoBaseObject, checkoutCarritoSchema, checkoutReturnUrlSchema, checkoutShippingSelectionSchema, codigoPromocionCheckoutSchema, createCartFedexQuoteSchema, fieraPointsRequestSchema (+24 more)

### Community 50 - "Community 50"
Cohesion: 0.11
Nodes (13): ProveedorPago, APLAZO, STRIPE, fallbackLegacyStatus(), mapLegacyEstadoToPaymentStatus(), paymentAttemptLogger, PaymentAttemptRepository, toPaymentAttempt() (+5 more)

### Community 51 - "Community 51"
Cohesion: 0.10
Nodes (33): buildAddressValidityFlags(), collectCustomerMessages(), FedexAddressValidationError, FedexAddressValidationErrorCode, FedexAddressValidationService, FedexClientLike, hasInterpolatedStreetAddress(), isPlainDate() (+25 more)

### Community 52 - "Community 52"
Cohesion: 0.07
Nodes (21): replaceSizeInventory(), setActiveStatus(), updateStock(), uploadImages(), ProductRating, ProductRatingEligibility, ProductRatingEligibilityReason, ProductUserRatingSnapshot (+13 more)

### Community 53 - "Community 53"
Cohesion: 0.17
Nodes (5): CatalogCursor, CatalogQuery, CatalogResponse, CatalogSort, ProductService

### Community 54 - "Community 54"
Cohesion: 0.06
Nodes (36): ProductPreviewClassificationSource, CATEGORY_ID, CATEGORY_NAME, DESCRIPTION_KEYWORD, LINE_NAME, UNCLASSIFIED, TryOnEligibilityReason, PRODUCT_IMAGE_UNAVAILABLE (+28 more)

### Community 55 - "Community 55"
Cohesion: 0.07
Nodes (22): PaymentRefundRecord, CompleteRefundInput, CreateProcessingRefundInput, FailRefundInput, PaymentRefundRepository, toRefundRecord(), withoutUndefined(), ApproveRefundRequestInput (+14 more)

### Community 56 - "Community 56"
Cohesion: 0.09
Nodes (32): paymentAuthMiddleware(), paymentCustomerMiddleware(), paymentStaffMiddleware(), respondAuthError(), aplazoAdminActionSchema, aplazoOnlineCreateSchema, aplazoRefundRequestParamSchema, aplazoRefundStatusQuerySchema (+24 more)

### Community 57 - "Community 57"
Cohesion: 0.09
Nodes (35): puedeAsignarPuntos(), assertCanManageMember(), cancelRedemption(), confirmRedemption(), createAdjustment(), createEarnTransaction(), createRedemption(), getAdminRedemptionsReport() (+27 more)

### Community 58 - "Community 58"
Cohesion: 0.11
Nodes (23): getRecepcion(), listRecepciones(), ActualizarStockDTO, AlertaStockTalla, ConfirmarRecepcionMercanciaDTO, CrearRecepcionMercanciaDTO, CrearStockDTO, CrearUbicacionDTO (+15 more)

### Community 59 - "Community 59"
Cohesion: 0.07
Nodes (22): getAdminProducts(), getById(), getCatalog(), getStockBySize(), AdminProductsQuery, AdminProductStatusFilter, InventarioPorTalla, StockMinimoPorTalla (+14 more)

### Community 60 - "Community 60"
Cohesion: 0.10
Nodes (30): ROLES_ASIGNACION_PUNTOS, legacyAssignPoints(), legacyAssignPointsBySale(), legacyClaimFichajeBonus(), legacyGetAsignaciones(), legacyGetMyHistorial(), legacyGetMyPoints(), legacySumarStreakPoints() (+22 more)

### Community 61 - "Community 61"
Cohesion: 0.13
Nodes (20): LOYALTY_SANDBOX_COLLECTIONS, LoyaltyActorContext, ReversalInput, TransactionResponseDto, WalletResponseDto, SandboxMemberRecord, main(), parseArgs() (+12 more)

### Community 62 - "Community 62"
Cohesion: 0.09
Nodes (28): LoyaltyAdjustmentReason, FRAUD_REVERSAL, GOODWILL, MANUAL_CORRECTION, PROMOTION, SYSTEM_CORRECTION, LoyaltyWallet, WalletRepository (+20 more)

### Community 63 - "Community 63"
Cohesion: 0.13
Nodes (20): buildErrorResponse(), createDetalle(), deleteDetalle(), detalleProductoCommandLogger, getStatusFromErrorCode(), updateDetalle(), buildErrorResponse(), detalleProductoQueryLogger (+12 more)

### Community 64 - "Community 64"
Cohesion: 0.07
Nodes (34): assertStripeKeyEnvironment(), buildEmbeddedCheckoutSessionBaseParams, buildStripeIdempotencyKey(), getRequiredEnv(), getStripeMinimumAmountMinor(), getStripePublishableKey(), getStripeSecretKey(), getStripeWebhookSecret() (+26 more)

### Community 65 - "Community 65"
Cohesion: 0.10
Nodes (33): validateQuery(), handleLoyaltyError(), requireIdempotencyKey(), attachPartnerActor(), createPartnerAuthMiddleware(), partnerRequestLogMiddleware(), requestIdMiddleware(), createLoyaltyPartnerRouter() (+25 more)

### Community 66 - "Community 66"
Cohesion: 0.13
Nodes (11): ActualizarBeneficioDTO, CrearBeneficioDTO, Beneficio, BENEFICIO_DESTINOS, BeneficioClaimResult, BeneficioDestinoModulo, BeneficioMediaTipo, BeneficioReclamo (+3 more)

### Community 67 - "Community 67"
Cohesion: 0.13
Nodes (14): GeneratedPushCopy, NotificationDeliveryRecord, NotificationEvent, generatedPushCopySchema, NotificationAiService, NotificationDeliveryService, NotificationEligibilityService, EventLockResult (+6 more)

### Community 68 - "Community 68"
Cohesion: 0.08
Nodes (31): addDays(), ALPHA_GRID, backtest(), BacktestOutcome, BETA_GRID, dampedTrendFit(), exponentialSmoothingFit(), FITTERS (+23 more)

### Community 69 - "Community 69"
Cohesion: 0.11
Nodes (19): itemPersonalizacionSchema, CatalogProductCardDTO, computeProductOfferSnapshot(), ProductOfferSnapshotFields, ProductOfferSnapshotService, readStoredOfferSnapshot(), toProductoOfertaBase(), ProductCardsService (+11 more)

### Community 70 - "Community 70"
Cohesion: 0.12
Nodes (32): obtenerNombreTorneo(), fechaPartidoApiToIsoString(), construirResumenTorneo(), debeOcultarMarcadorTemporal(), esCierrePartidoPublicable(), esFasePrimerTiempo(), esMarcadorOficial(), esPartidoConcluido() (+24 more)

### Community 71 - "Community 71"
Cohesion: 0.11
Nodes (29): FedexRateAddressInput, FedexRateOption, FedexRatePackageInput, buildCanonicalStreetLines(), buildDestinationFromCartPayload(), buildOptionId(), buildOrigin(), buildShippingCartHash() (+21 more)

### Community 72 - "Community 72"
Cohesion: 0.10
Nodes (28): AcreditacionesError, getOrCreateApp(), getRealtimeDbAcreditaciones(), isAcreditacionesConfigured(), loadServiceAccount(), resolveServiceAccountPath(), CortesiaTrabajadorClub, buildCortesiaDocId() (+20 more)

### Community 73 - "Community 73"
Cohesion: 0.08
Nodes (26): configuracionExpiracionPuntos, MovimientoPuntos, OrigenPuntos, ResumenPuntosAnual, TipoMovimientoPuntos, ACUMULACION, AJUSTE, BONIFICACION (+18 more)

### Community 74 - "Community 74"
Cohesion: 0.13
Nodes (21): create(), deleteContacto(), getAll(), getById(), updateStatus(), devOtpFallback(), getBrevoConfig(), isLocalDevRuntime() (+13 more)

### Community 75 - "Community 75"
Cohesion: 0.08
Nodes (29): aplazoCancelReturn(), aplazoFailureReturn(), aplazoSuccessReturn(), renderHtml(), respondReturn(), ActualizarPagoDTO, CURRENCY_DEFAULT, PaymentFinalizationState (+21 more)

### Community 76 - "Community 76"
Cohesion: 0.11
Nodes (24): ProductPreviewType, ACCESSORY, APPAREL, PROP, UNKNOWN, buildGeminiFallbackPrompt(), buildPrompt(), extractGeminiImage() (+16 more)

### Community 77 - "Community 77"
Cohesion: 0.08
Nodes (22): CheckoutAddressValidationStatus, ActualizarOrdenDTO, DireccionEnvio, FulfillmentMethod, DELIVERY, PICKUP, MetodoPago, APLAZO (+14 more)

### Community 78 - "Community 78"
Cohesion: 0.08
Nodes (25): PaymentState, FALLIDO, PAGADO, PENDIENTE, REEMBOLSADO, COLECCION_PAGOS, EstadoPago, COMPLETADO (+17 more)

### Community 79 - "Community 79"
Cohesion: 0.07
Nodes (20): added, base, changed, deployed, next, perProject, removed, RUNTIME_MANAGED (+12 more)

### Community 80 - "Community 80"
Cohesion: 0.11
Nodes (25): asStringArray(), buildClaimDocId(), buildItemClaimId(), buildPhoneClaimId(), buildSeasonPassId(), buildSeasonPassItemId(), buildVerificationRecord(), claimSeasonPassItems() (+17 more)

### Community 82 - "Community 82"
Cohesion: 0.12
Nodes (30): assertDayKey(), resolveDayRange(), resolveFromInput(), dayKeyFromNow(), resolveCompletedWindow(), ANALYTICS_PERIOD_KEYS, ANALYTICS_TIMEZONE, AnalyticsPeriodError (+22 more)

### Community 83 - "Community 83"
Cohesion: 0.12
Nodes (29): allowDefaultDimensions(), assertFedexLimits(), buildConsolidatedPackage(), buildFedexPackageLineItemsFromCart(), buildPerUnitPackages(), DEFAULT_PACKAGE, DEFAULT_PACKAGES, FEDEX_PRODUCT_DIMENSIONS_MISSING (+21 more)

### Community 84 - "Community 84"
Cohesion: 0.12
Nodes (24): assertValidShipDate(), FedexClientLike, FedexPostalCodeService, FedexPostalErrorCode, FedexPostalValidationError, getDefaultFedexShipDate(), isPlainDate(), mapProviderError() (+16 more)

### Community 85 - "Community 85"
Cohesion: 0.07
Nodes (3): StoreAiBusinessService, AssistantProductSearchFilters, AssistantProductSearchResult

### Community 86 - "Community 86"
Cohesion: 0.06
Nodes (32): devDependencies, cross-env, eslint, eslint-config-google, eslint-plugin-import, firebase, firebase-functions-test, @firebase/rules-unit-testing (+24 more)

### Community 87 - "Community 87"
Cohesion: 0.11
Nodes (16): addEarnMovement(), aggregateEarners(), EARN_TYPES, isEarnMovement(), isRetryableFirestoreError(), MovementRecord, normalizedText(), PointsBalanceRow (+8 more)

### Community 88 - "Community 88"
Cohesion: 0.12
Nodes (29): BLOCKED_SERVICE_TYPES, chooseRatedDetail(), cleanFedexText(), cleanStreetLines(), FedexRateRequestConfigError, FedexRateRequestPayload, getDeliveryDate(), getMoneyAmount() (+21 more)

### Community 89 - "Community 89"
Cohesion: 0.10
Nodes (28): AnomalyFinding, AnomalySeverity, __anomalyTestables, detectProductAnomalies(), detectSeriesAnomalies(), madOf(), medianOf(), MIN_BASELINE_OBSERVATIONS (+20 more)

### Community 90 - "Community 90"
Cohesion: 0.17
Nodes (6): RecomendacionAgregadoDocumento, RecomendacionCandidato, RecomendacionContexto, AggregatesService, excludeProductIds(), uniqueProductIds()

### Community 91 - "Community 91"
Cohesion: 0.11
Nodes (21): AdminAgentEvent, AdminReportAgent, AdminReportTrace, AdminToolCallTrace, __agentTestables, EvidenceEntry, extractPeriodLabel(), isCorrectableStructuredOutputError() (+13 more)

### Community 92 - "Community 92"
Cohesion: 0.11
Nodes (13): getOptionalIdempotencyKey(), registerAdjustment(), registerMovement(), DashboardAlertasStock, DashboardInventarioItem, DiagnosticoInventarioProducto, ListarAlertasStockQuery, ListarDashboardInventarioQuery (+5 more)

### Community 93 - "Community 93"
Cohesion: 0.24
Nodes (28): asRecord(), categoryCandidate(), ChartBlock, ChartCandidate, ChartEvidenceEntry, ChartKind, chartTypeFor(), collectCandidates() (+20 more)

### Community 94 - "Community 94"
Cohesion: 0.14
Nodes (16): NotificationDeliveryMode, NotificationEventType, NotificationPriority, EnqueueNotificationEventInput, NotificationEventService, buildNotificationFingerprint(), bypassesQuietHours(), getLocalDateParts() (+8 more)

### Community 95 - "Community 95"
Cohesion: 0.12
Nodes (19): ANALYTICS_COLLECTIONS, AnalyticsCatalogEntry, AnalyticsOfferSummary, AnalyticsOrderItem, AnalyticsOrdersPage, AnalyticsPromoCodeSummary, AnalyticsRepository, mapOrder() (+11 more)

### Community 96 - "Community 96"
Cohesion: 0.07
Nodes (27): dependencies, axios, busboy, cors, dotenv, express, file-type, firebase-admin (+19 more)

### Community 97 - "Community 97"
Cohesion: 0.14
Nodes (9): FulfillmentStatus, CANCELED, EXPIRED, PAID, PENDING_PAYMENT, PICKED_UP, PREPARING, READY_FOR_PICKUP (+1 more)

### Community 98 - "Community 98"
Cohesion: 0.17
Nodes (6): Orden, buildVariantKey(), isUnpaidPendingOrder(), OrdenService, roundCurrency(), toStringArray()

### Community 99 - "Community 99"
Cohesion: 0.13
Nodes (20): configuracionLigaMx, ID_TORNEO_APERTURA, ID_TORNEO_CLAUSURA, perfilesDivision, COLECCIONES, contarDocumentosEnColeccion(), verificarSincronizacion(), ContextoActivoResuelto (+12 more)

### Community 100 - "Community 100"
Cohesion: 0.14
Nodes (19): create(), remove(), update(), getAll(), getById(), getInventory(), CrearCategoriaDTO, CrearLineaDTO (+11 more)

### Community 101 - "Community 101"
Cohesion: 0.19
Nodes (5): MovimientoInventario, RegistrarAjusteInventarioDTO, RegistrarAjusteInventarioResult, RegistrarMovimientoInventarioDTO, InventoryService

### Community 102 - "Community 102"
Cohesion: 0.08
Nodes (17): RecomendacionEstrategia, COMPLEMENTOS_CARRITO, COMPRADOS_JUNTOS, COMPRAR_NUEVAMENTE, MAS_VENDIDOS, NOVEDADES, OFERTAS_RELEVANTES, PARA_TI (+9 more)

### Community 103 - "Community 103"
Cohesion: 0.10
Nodes (19): reconcileAplazoPayments, AI_API_SECRETS, API_RUNTIME_SECRETS, APLAZO_PAYMENT_SECRETS, APP_OFICIAL_SECRETS, AUTH_SECRETS, BOLETOMOVIL_SECRETS, BREVO_SECRETS (+11 more)

### Community 104 - "Community 104"
Cohesion: 0.17
Nodes (23): obtenerPerfilDivision(), validarConfiguracionLigaMx(), aNumeroNullable(), aTextoNullable(), construirCalendarioActual(), construirClasificacionActual(), construirContextoActual(), construirPlantillaActual() (+15 more)

### Community 105 - "Community 105"
Cohesion: 0.14
Nodes (21): ask(), createSession(), listSessions(), sendError(), streamLogger, wantsSseResponse(), createAdminSession(), createPublicSession() (+13 more)

### Community 106 - "Community 106"
Cohesion: 0.13
Nodes (17): create(), deleteImage(), remove(), syncInstagramNoticias(), update(), uploadImages(), getAll(), getById() (+9 more)

### Community 107 - "Community 107"
Cohesion: 0.16
Nodes (7): ActualizarNoticiaDTO, CrearNoticiaDTO, CategoriaNoticia, IAContenido, Noticia, OrigenNoticia, NewService

### Community 108 - "Community 108"
Cohesion: 0.12
Nodes (19): categoriaIdParamSchema, productoDetalleParamsSchema, adminProductsQuerySchema, booleanQuerySchema, catalogProductQuerySchema, createProductSchema, deleteImageSchema, fedexShippingSchema (+11 more)

### Community 109 - "Community 109"
Cohesion: 0.09
Nodes (16): CheckoutUnavailableItemDetail, EstadoReservaInventario, ACTIVA, CONFIRMADA, EXPIRADA, LIBERADA, InventoryStockUnavailableError, applyFilter() (+8 more)

### Community 110 - "Community 110"
Cohesion: 0.09
Nodes (9): NotificationSchedulerService, enqueueEventMock, userDocs, enqueueEventMock, hasUserRatedProductMock, orderDocs, productDocs, enqueueEventMock (+1 more)

### Community 111 - "Community 111"
Cohesion: 0.18
Nodes (6): getPreferences(), listInbox(), NotificationInboxItem, NotificationInboxPage, NotificationInboxReadResult, NotificationInboxService

### Community 112 - "Community 112"
Cohesion: 0.08
Nodes (11): EstadoOrden, CANCELADA, CONFIRMADA, EN_PROCESO, ENTREGADA, ENVIADA, PENDIENTE, LIMIT (+3 more)

### Community 113 - "Community 113"
Cohesion: 0.18
Nodes (11): ActualizarItemCarritoDTO, AgregarItemCarritoDTO, Carrito, CarritoPopulado, MAX_CANTIDAD_POR_ITEM, ItemOrden, CreateCartFedexQuoteInput, ValidateSelectedQuoteInput (+3 more)

### Community 114 - "Community 114"
Cohesion: 0.13
Nodes (19): PreparationStatus, DELIVERED, INCIDENT, PENDING_PREPARATION, PICKED_UP, PREPARING, READY_FOR_PICKUP, READY_TO_SHIP (+11 more)

### Community 115 - "Community 115"
Cohesion: 0.15
Nodes (9): PaymentEventLogRecord, buildLogId(), PaymentEventLogRepository, eventProcessorLogger, PaymentEventProcessingService, canTransitionPaymentStatus(), transitionMap, ACTIVE_PAYMENT_STATUSES (+1 more)

### Community 116 - "Community 116"
Cohesion: 0.24
Nodes (22): approveAplazoRefundRequest(), cancelAplazoPayment(), createAplazoOnline(), createAplazoRefundRequest(), getActorFromRequest(), getAplazoRefundRequest(), getAplazoRefundStatus(), getOptionalIdempotencyKey() (+14 more)

### Community 117 - "Community 117"
Cohesion: 0.12
Nodes (19): RecomendacionConfigGlobal, RecomendacionSeccionConfig, RecomendacionSuperficie, ADMIN, CARRITO, CHECKOUT, CUENTA, HOME (+11 more)

### Community 118 - "Community 118"
Cohesion: 0.14
Nodes (16): EstadoVentaPos, BORRADOR, CANCELADA, EXPIRADA, FALLIDA, PAGADA, PENDIENTE_PAGO, VentaPos (+8 more)

### Community 119 - "Community 119"
Cohesion: 0.18
Nodes (19): isPlainObject(), maskEmail(), maskPhone(), maskToken(), normalizeEmail(), normalizeMxPhoneForAplazo(), normalizeWhitespace(), sanitizeAxiosErrorData() (+11 more)

### Community 120 - "Community 120"
Cohesion: 0.19
Nodes (9): isValidTimezone(), resolveNotificationLocale(), resolveNotificationTimezone(), resolveOptionalNotificationTimezone(), toTrimmedString(), NotificationPreferenceDocument, NotificationPreferencesPatch, NotificationPreferencesService (+1 more)

### Community 121 - "Community 121"
Cohesion: 0.18
Nodes (9): ItemCarrito, CheckoutPricingInput, CheckoutPricingService, FirestoreLike, resolveLogistics(), resolveRequiresShipping(), roundMoney(), toPositiveNumber() (+1 more)

### Community 122 - "Community 122"
Cohesion: 0.09
Nodes (18): TipoMovimientoInventario, AJUSTE, CONTEO_FISICO, DEVOLUCION, ENTRADA, LIBERACION_RESERVA, RECEPCION, RESERVA (+10 more)

### Community 123 - "Community 123"
Cohesion: 0.18
Nodes (7): CreatePickupLocationDTO, PickupAvailabilityItem, PickupAvailabilityResult, PickupLocation, UpdatePickupLocationDTO, PickupLocationService, DocData

### Community 124 - "Community 124"
Cohesion: 0.21
Nodes (11): RecomendacionAgregadoProducto, RecomendacionCacheDocumento, RecomendacionEvento, RecomendacionMetricasDiarias, RecomendacionPesoEstrategia, RecomendacionVisitante, recomendacionCollections, TrackEventInput (+3 more)

### Community 125 - "Community 125"
Cohesion: 0.12
Nodes (13): AnalyticsProduct, createAnalyticsToolContext(), ANALYTICS_TOOL_MAP, __behaviorToolsTestables, context(), NOW, repository, run() (+5 more)

### Community 126 - "Community 126"
Cohesion: 0.13
Nodes (13): buildCorsOptions(), getCorsOptions(), isMultipart(), isNotMultipart(), getAllowedCorsOriginsWithStore(), parseOrigins(), PRODUCTION_CORS_ORIGINS, readConfiguredOrigins() (+5 more)

### Community 127 - "Community 127"
Cohesion: 0.21
Nodes (16): ChatNormalizerService, collapseWhitespace(), collectMatches(), detectTopics(), includesTerm(), normalizeText(), resolvePricePreference(), resolveReferences() (+8 more)

### Community 128 - "Community 128"
Cohesion: 0.10
Nodes (21): dependencies, axios, busboy, cors, dotenv, express, firebase-admin, firebase-functions (+13 more)

### Community 129 - "Community 129"
Cohesion: 0.17
Nodes (17): actualizarPerfil(), calcularEdad(), completarDatosPerfil(), completarPerfil(), canClaimProfileBonus(), hasDemographicFieldsComplete(), NormalizedProfileDemographics, normalizeGenero() (+9 more)

### Community 130 - "Community 130"
Cohesion: 0.13
Nodes (17): aplicaASchema, baseCodigoPromocionSchema, codigoNormalizadoSchema, codigoPromocionCarritoItemSchema, codigoPromocionCarritoItemsSchema, codigoPromocionParamsSchema, createCodigoPromocionSchema, disponibilidadCodigosPromocionCarritoSchema (+9 more)

### Community 131 - "Community 131"
Cohesion: 0.16
Nodes (8): AiSession, ChatPlanSessionUpdates, ConversationState, ProductCandidateReference, AiSessionService, ConversationStateService, ToolOutputSummary, uniqueProducts()

### Community 132 - "Community 132"
Cohesion: 0.19
Nodes (10): RachaCheckInResult, RachaUsuario, processDailyRachas, runOnce(), RachaService, previousDayKey(), toDayKey(), evaluateRachaRisk() (+2 more)

### Community 133 - "Community 133"
Cohesion: 0.16
Nodes (16): AnalyticsBehaviorPage, BEHAVIOR_COLLECTION, BEHAVIOR_EVENT_TYPES, behaviorLogger, BehaviorRepository, __behaviorTestables, isMissingIndexError(), mapEvent() (+8 more)

### Community 134 - "Community 134"
Cohesion: 0.18
Nodes (15): AplazoChannel, AplazoChannelConfig, AplazoConfig, AplazoWebhookAuthScheme, getAplazoConfig(), getBoolean(), getNumber(), getOptional() (+7 more)

### Community 135 - "Community 135"
Cohesion: 0.17
Nodes (15): aiAppCheckMiddleware(), AiAppCheckMode, AiAppCheckReason, appCheckLogger, getRequestMetadata(), getVerificationFailureReason(), isControlledLocalBypassEnabled(), isProductionRuntime() (+7 more)

### Community 136 - "Community 136"
Cohesion: 0.12
Nodes (12): RecomendacionEventoTipo, AGREGAR_CARRITO, BUSQUEDA, CLIC_PRODUCTO, CLIC_RECOMENDACION, COMPRA, FAVORITO, IMPRESION_RECOMENDACION (+4 more)

### Community 137 - "Community 137"
Cohesion: 0.19
Nodes (6): CrearUsuarioAppDTO, UsuarioApp, dedupeUsuariosByUid(), normalizeUserRoles(), toTimestampMs(), UserAppService

### Community 138 - "Community 138"
Cohesion: 0.16
Nodes (4): ExternalTxnIndexRecord, IdempotencyRecord, ExternalTxnRepository, IdempotencyRepository

### Community 139 - "Community 139"
Cohesion: 0.19
Nodes (15): AnalysisTraceSummary, ANOMALY_TOOL_NAME, asNumber(), asRecord(), collectForecastPayloads(), CURRENCY_METRICS, FORECAST_TOOL_NAME, ForecastPayload (+7 more)

### Community 140 - "Community 140"
Cohesion: 0.24
Nodes (16): CalendarDate, evaluateBirthdayToday(), fromParts(), fromUtcDate(), getCalendarDateInTimezone(), isBirthdayToday(), isLeapYear(), isValidCalendarDate() (+8 more)

### Community 141 - "Community 141"
Cohesion: 0.11
Nodes (12): __dirname, INTERNAL_PATHS, internalPath, legacyPath, openapiDir, problemResponses, publicPath, publicSpec (+4 more)

### Community 142 - "Community 142"
Cohesion: 0.12
Nodes (6): clearViewHistory(), log, CATALOG_AGGREGATES, CATALOG_STRATEGIES, InvalidationService, USER_STRATEGIES

### Community 143 - "Community 143"
Cohesion: 0.20
Nodes (15): broadcastIdParamSchema, broadcastNotificationSchema, deviceIdParamSchema, deviceTokenBaseSchema, enqueueNotificationEventSchema, inboxNotificationIdParamSchema, inboxQuerySchema, manualNotificationTestSchema (+7 more)

### Community 144 - "Community 144"
Cohesion: 0.15
Nodes (16): alcanceOfertaSchema, CalcularPreciosOfertaInput, calcularPreciosOfertaSchema, CreateOfertaInput, createOfertaSchema, fechaOfertaSchema, idsArraySchema, ListarOfertasQueryInput (+8 more)

### Community 145 - "Community 145"
Cohesion: 0.13
Nodes (10): NotificationBroadcastCopy, NotificationBroadcastCreationResult, BROADCAST_CHUNK_SIZE, NotificationBroadcastService, broadcastDocSet, bulkWriterClose, bulkWriterSet, chunkDocRefs (+2 more)

### Community 146 - "Community 146"
Cohesion: 0.31
Nodes (6): HistorialPuntosUsuario, aplicarMovimientoAResumen(), calcularCiclosCompletados(), construirResumenPuntosAnual(), obtenerCicloActual(), PointsService

### Community 147 - "Community 147"
Cohesion: 0.16
Nodes (16): LoyaltyActorType, ADMIN, EMPLOYEE, PARTNER, SERVICE, SUPER_ADMIN, USER, asPositiveInteger() (+8 more)

### Community 148 - "Community 148"
Cohesion: 0.24
Nodes (12): canSendAdvertisingConversion(), canSendAdvertisingConversionForOrder(), APP_ORIGINS, CLIENT_ORIGIN_HEADER, clientOriginMiddleware(), isEmbeddedAppOrigin(), parseClientOriginHeader(), resolveAdvertisingTrackingAllowed() (+4 more)

### Community 150 - "Community 150"
Cohesion: 0.16
Nodes (11): STORE_FIRESTORE_DATABASE, AI_TRIGGER_SECRETS, NOTIFICATION_EVENT_SECRETS, processTryOnJobTrigger, triggerLogger, processBroadcastChunkTrigger, triggerLogger, processNotificationEventTrigger (+3 more)

### Community 151 - "Community 151"
Cohesion: 0.17
Nodes (5): enqueueEvent(), sendTestNotification(), updatePreferences(), NotificationProcessingResult, NotificationProcessingService

### Community 152 - "Community 152"
Cohesion: 0.15
Nodes (8): NotificationBroadcastChunk, NotificationBroadcastWorkerService, chunkSet, disableTokensBulk, persistBroadcastResults, runTransaction, sendBroadcastChunk, transactionUpdates

### Community 153 - "Community 153"
Cohesion: 0.12
Nodes (15): compileOnSave, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, noImplicitReturns, noUnusedLocals, outDir (+7 more)

### Community 154 - "Community 154"
Cohesion: 0.12
Nodes (16): devDependencies, cross-env, form-data, rimraf, ts-node-dev, @types/busboy, @types/cors, @types/express (+8 more)

### Community 155 - "Community 155"
Cohesion: 0.18
Nodes (12): BRAND, construirHtml(), escapeHtml(), { execFileSync }, extraerFechaNacimiento(), { firestoreApp }, fs, localizarNavegador() (+4 more)

### Community 156 - "Community 156"
Cohesion: 0.19
Nodes (7): ActualizarPatrocinadorDTO, CrearPatrocinadorDTO, PatrocinadorLogoVariante, logoFieldByVariante, mockedPatrocinadorService, mockedStorageAppService, samplePatrocinador

### Community 157 - "Community 157"
Cohesion: 0.17
Nodes (10): verifySeasonPassSchema, assignPointsBySaleSchema, assignUserPointsSchema, externalTransactionIdSchema, saleFolioSchema, staffAssignmentHistoryQuerySchema, emailLookupRateLimiter, router (+2 more)

### Community 158 - "Community 158"
Cohesion: 0.26
Nodes (13): resolveAvailableStock(), areEqual(), DRY_RUN, getNormalizedPayload(), migrateProductsSizeInventory(), NormalizedProductPayload, completeInventarioPorTalla(), CompleteSizeInventoryOptions (+5 more)

### Community 159 - "Community 159"
Cohesion: 0.24
Nodes (5): normalizeAdminConversationState(), AdminReportResult, AdminAssistantService, buildTitle(), toIso()

### Community 160 - "Community 160"
Cohesion: 0.30
Nodes (14): asNumber(), asRecord(), __decisionEnrichTestables, DecisionEvidenceEntry, FRIENDLY_SOURCE_LABELS, hasTruncated(), periodLabel(), reconcileDecisionBlocksAndSources() (+6 more)

### Community 161 - "Community 161"
Cohesion: 0.25
Nodes (13): claimPoints(), create(), destroyPermanently(), getUploadedFile(), getUploadedFiles(), remove(), removeImage(), removeMedia() (+5 more)

### Community 162 - "Community 162"
Cohesion: 0.36
Nodes (11): buildError(), getBuyAgain(), getCartRecommendations(), getHomeRecommendations(), getProductRecommendations(), getRecentlyViewed(), getRecommendations(), getSessionId() (+3 more)

### Community 163 - "Community 163"
Cohesion: 0.29
Nodes (12): getFirebaseErrorCode(), normalizeFechaNacimiento(), normalizeGenero(), registrationServerErrorMessage(), requestRegistrationCode(), verifyRegistration(), calcularEdad(), createEmailUser() (+4 more)

### Community 164 - "Community 164"
Cohesion: 0.20
Nodes (13): CAMPAIGN_CLAIM_FIELD, CAMPAIGN_DESCRIPTION, CAMPAIGN_KEY, CAMPAIGN_POINTS, isInactive(), listTargetUids(), main(), mapPool() (+5 more)

### Community 165 - "Community 165"
Cohesion: 0.27
Nodes (12): aTextoNullable(), ComponentesFechaHoraLocal, convertirFechaHoraLocalAZonaUtc(), DIAS_SEMANA_EN_US, esSufijoZUtcFalsoDeApi(), esVentanaSemanalClasificacion(), normalizarCadenaFechaHora(), obtenerMomentoEnZona() (+4 more)

### Community 166 - "Community 166"
Cohesion: 0.27
Nodes (3): diversifyCandidates(), extractPaidProductIdsFromOrder(), isOrdenPagada()

### Community 167 - "Community 167"
Cohesion: 0.27
Nodes (8): AuthObjectLike, getAuthObject(), getRequestUserId(), getStringValue(), handleError(), OfertasCommandController, CreateOfertaDto, UpdateOfertaDto

### Community 168 - "Community 168"
Cohesion: 0.31
Nodes (9): createBillingPortal(), createRefund(), createSetupIntent(), getAuthenticatedUid(), getCheckoutSession(), getPaymentIntent(), getRawWebhookBody(), respondStripeError() (+1 more)

### Community 169 - "Community 169"
Cohesion: 0.26
Nodes (11): adminConfigUpdateSchema, adminMetricsQuerySchema, eventMetadataSchema, homeRecommendationsQuerySchema, mergeIdentitySchema, productoIdParamSchema, recommendationsQuerySchema, trackEventsBatchSchema (+3 more)

### Community 170 - "Community 170"
Cohesion: 0.15
Nodes (12): ActualizarConfiguracionPuntosDTO, ActualizarConfiguracionTiendaDTO, ConfiguracionAlertas, ConfiguracionPromocion, ConfiguracionPuntos, TipoPromocion, DESCUENTO_FIJO, DESCUENTO_PORCENTAJE (+4 more)

### Community 171 - "Community 171"
Cohesion: 0.27
Nodes (4): SeasonPassVerificationError, SeasonPassVerificationService, mockedAxios, originalEnv

### Community 172 - "Community 172"
Cohesion: 0.17
Nodes (7): baseProducts, clone(), createSnapshotDoc(), DocData, FakeTimestamp, Filter, Order

### Community 173 - "Community 173"
Cohesion: 0.18
Nodes (7): clone(), compareValue(), createSnapshotDoc(), DocData, FakeTimestamp, Filter, Order

### Community 174 - "Community 174"
Cohesion: 0.22
Nodes (12): analyzeCodebase(), CollectionInfo, CONFIG, ensureDirectoryExistence(), FirebaseServiceUsage, generateArchitectureDiagram(), generateDataModelDiagram(), generateMarkdownReport() (+4 more)

### Community 175 - "Community 175"
Cohesion: 0.26
Nodes (5): normalizeFedExCity(), normalizeMxStateForFedEx(), FedexAvailabilityService, FedexRateQuoteInput, tests

### Community 176 - "Community 176"
Cohesion: 0.23
Nodes (11): getOrderUsuarioId(), handleOrderInvalidation(), hasRelevantFieldChange(), invalidateRecommendationsOnConfigChange, invalidateRecommendationsOnInventoryChange, invalidateRecommendationsOnOfferChange, invalidateRecommendationsOnOrderChange, invalidateRecommendationsOnProductChange (+3 more)

### Community 177 - "Community 177"
Cohesion: 0.18
Nodes (6): clone(), createSnapshotDoc(), DocData, FakeTimestamp, Filter, Order

### Community 178 - "Community 178"
Cohesion: 0.27
Nodes (10): A, B, call(), getToken(), main(), record(), results, rid() (+2 more)

### Community 179 - "Community 179"
Cohesion: 0.29
Nodes (6): limpiarTexto(), loadMissingLocalSecrets(), resolverProjectId(), LIGA_MX_SECRETS, syncLigaMxData, runSync()

### Community 180 - "Community 180"
Cohesion: 0.42
Nodes (10): complete(), expire(), getActor(), getById(), list(), prepare(), ready(), respondError() (+2 more)

### Community 181 - "Community 181"
Cohesion: 0.36
Nodes (5): FieraPointsQuote, FieraPointsRequest, PaymentComposition, FieraPointsPaymentService, mapLoyaltyError()

### Community 182 - "Community 182"
Cohesion: 0.47
Nodes (10): alertToMessage(), collectNestedRecords(), collectWarnings(), firstNestedString(), getString(), mapFedexPickupAvailabilityResponse(), mapFedexPickupCancelResponse(), mapFedexPickupCreateResponse() (+2 more)

### Community 183 - "Community 183"
Cohesion: 0.20
Nodes (9): AI_COLLECTIONS, CLIENT_KINDS, ClientKind, getClientContext(), getClientFirestore(), LIGA_MX_PUBLIC_COLLECTIONS, RULES_PATH, TestFirestore (+1 more)

### Community 184 - "Community 184"
Cohesion: 0.18
Nodes (11): scripts, build, clean, deploy, dev, diagnostico, docs:firebase, prebuild (+3 more)

### Community 185 - "Community 185"
Cohesion: 0.27
Nodes (8): getCalendar(), getContext(), getDivisionKey(), getMatch(), getMatchDetail(), getPlayer(), getRoster(), getStandings()

### Community 186 - "Community 186"
Cohesion: 0.33
Nodes (5): handleError(), OfertasQueryController, parseBooleanQuery(), parseNumberQuery(), CalcularPreciosOfertaDto

### Community 187 - "Community 187"
Cohesion: 0.36
Nodes (9): create(), destroyPermanently(), getUploadedFile(), isLogoVariante(), remove(), removeImage(), serializePatrocinador(), update() (+1 more)

### Community 190 - "Community 190"
Cohesion: 0.27
Nodes (6): EstadoPosSession, CLOSED, OPEN, PosSession, POS_SESSIONS_COLLECTION, PosSessionRepository

### Community 191 - "Community 191"
Cohesion: 0.27
Nodes (9): AdminDecisionOptionState, buildConversationStatePrompt(), __conversationStateTestables, evolveAdminConversationState(), inferCategoryFilter(), inferPeriod(), ordinalIndex(), ORDINALS (+1 more)

### Community 192 - "Community 192"
Cohesion: 0.38
Nodes (4): PendingRegistrationService, decryptPendingPassword(), encryptPendingPassword(), getEncryptionKey()

### Community 193 - "Community 193"
Cohesion: 0.20
Nodes (4): agentRun, buildQuery(), DocData, RecordedQuery

### Community 194 - "Community 194"
Cohesion: 0.33
Nodes (6): addItem(), clearCart(), getCartIdentity(), mergeCarts(), removeItem(), updateItem()

### Community 195 - "Community 195"
Cohesion: 0.22
Nodes (4): getOperationalSummary(), listAdminNotifications(), markAdminNotificationsRead(), markAllAdminNotificationsRead()

### Community 196 - "Community 196"
Cohesion: 0.42
Nodes (8): create(), deactivate(), errorResponse(), getPublicById(), listPublic(), mapErrorStatus(), update(), validateAvailability()

### Community 198 - "Community 198"
Cohesion: 0.22
Nodes (9): ManualShippingStatus, DELIVERED, DELIVERED_TO_CARRIER, IN_TRANSIT, INCIDENT, PENDING_MANUAL_SHIPMENT, PREPARING, READY_TO_SHIP (+1 more)

### Community 199 - "Community 199"
Cohesion: 0.25
Nodes (8): EVAL_QUESTIONS, main(), runQuestion(), SUITE_QUESTIONS, AdminConversationState, AdminAgentHistoryEntry, RunAdminReportInput, AdminAssistantSession

### Community 201 - "Community 201"
Cohesion: 0.57
Nodes (7): captureTracking(), markPreparing(), markReadyToShip(), requireAdminId(), sendError(), toStatusCode(), updateStatus()

### Community 208 - "Community 208"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, rootDir, types, extends, include, ../tsconfig.json

### Community 209 - "Community 209"
Cohesion: 0.25
Nodes (7): mockCreateUser, mockDeleteUser, mockDocCreate, mockExistsGet, mockGetUserByEmail, mockOtorgarBono, mockSyncClaims

### Community 210 - "Community 210"
Cohesion: 0.38
Nodes (4): backfillPersonalizable(), DRY_RUN, isJersey(), normalize()

### Community 211 - "Community 211"
Cohesion: 0.33
Nodes (3): storageTienda, IMAGE_EXTENSIONS, PlantillaService

### Community 212 - "Community 212"
Cohesion: 0.52
Nodes (6): closeRecepcion(), confirmRecepcion(), createRecepcion(), getOptionalIdempotencyKey(), mapErrorStatus(), updateRecepcionLineas()

### Community 213 - "Community 213"
Cohesion: 0.29
Nodes (7): TipoUbicacion, ALMACEN, COMEDOR, ESTADIO, OFICINA, OTRO, TIENDA

### Community 214 - "Community 214"
Cohesion: 0.43
Nodes (3): RecomendacionHomeRespuesta, RecomendacionRespuesta, RecomendacionesService

### Community 215 - "Community 215"
Cohesion: 0.52
Nodes (6): getLevelByPoints(), getPointsFromUserData(), LEVELS, normalizePoints(), syncUserLevelOnPointsChange, toFiniteNumber()

### Community 220 - "Community 220"
Cohesion: 0.53
Nodes (4): createFavoritoSchema, listFavoritosQuerySchema, productoIdParamSchema, router

### Community 221 - "Community 221"
Cohesion: 0.53
Nodes (4): ligaMxDivisionQuerySchema, ligaMxMatchIdParamSchema, ligaMxPlayerIdParamSchema, router

### Community 222 - "Community 222"
Cohesion: 0.33
Nodes (3): DocData, firestoreState, MockTimestamp

### Community 229 - "Community 229"
Cohesion: 0.50
Nodes (3): AuthedRequest, checkInRacha(), getRacha()

### Community 232 - "Community 232"
Cohesion: 0.50
Nodes (3): mockAssertAiConfig, mockOnDocumentCreated, mockProcessQueuedJob

### Community 234 - "Community 234"
Cohesion: 0.67
Nodes (3): engines, node, npm

## Knowledge Gaps
- **1689 isolated node(s):** `ActualizarUsuarioAppDTO`, `CanjeProducto`, `NivelLealtad`, `SolicitudEliminacion`, `AiCapability` (+1684 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 2226 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **33 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `RolUsuario` connect `Community 32` to `Community 0`, `Community 1`, `Community 2`, `Community 131`, `Community 3`, `Community 5`, `Community 7`, `Community 137`, `Community 15`, `Community 148`, `Community 30`, `Community 31`, `Community 35`, `Community 36`, `Community 163`, `Community 38`, `Community 43`, `Community 55`, `Community 56`, `Community 57`, `Community 60`, `Community 64`, `Community 193`, `Community 195`, `Community 199`, `Community 72`, `Community 73`, `Community 75`, `Community 209`, `Community 85`, `Community 87`, `Community 91`, `Community 92`, `Community 98`, `Community 230`, `Community 105`, `Community 106`, `Community 112`, `Community 118`, `Community 125`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **What connects `ActualizarUsuarioAppDTO`, `CanjeProducto`, `NivelLealtad` to the rest of the system?**
  _1689 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.031121281464530894 - nodes in this community are weakly interconnected._
- **Why does `firestoreTienda` connect `Community 5` to `Community 1`, `Community 2`, `Community 133`, `Community 9`, `Community 10`, `Community 12`, `Community 15`, `Community 16`, `Community 147`, `Community 22`, `Community 23`, `Community 158`, `Community 43`, `Community 47`, `Community 50`, `Community 52`, `Community 55`, `Community 58`, `Community 59`, `Community 190`, `Community 63`, `Community 64`, `Community 69`, `Community 71`, `Community 75`, `Community 78`, `Community 210`, `Community 92`, `Community 94`, `Community 95`, `Community 100`, `Community 112`, `Community 114`, `Community 117`, `Community 118`, `Community 121`, `Community 123`, `Community 124`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.045024064586244375 - nodes in this community are weakly interconnected._
- **Why does `stripe` connect `Community 64` to `Community 11`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.03706140350877193 - nodes in this community are weakly interconnected._
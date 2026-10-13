# Graph Report - BackendCL  (2026-10-08)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 6803 nodes · 17503 edges · 230 communities (203 shown, 27 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 227 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `bf5423bb`
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
- Community 204
- Community 205
- Community 206
- Community 207
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
- Community 218
- Community 219
- Community 220
- Community 221
- Community 223
- Community 224

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
- `EventLockResult` --references--> `NotificationEvent`  [EXTRACTED]
  functions/src/services/notifications/notification-event.service.ts → functions/src/models/notificacion.model.ts
- `webhook()` --calls--> `ApiError`  [EXTRACTED]
  functions/src/controllers/payments/payments.command.controller.ts → functions/src/utils/api-error.ts
- `aiUploadMiddleware` --calls--> `ApiError`  [EXTRACTED]
  functions/src/services/ai/storage/ai-upload.middleware.ts → functions/src/utils/api-error.ts
- `AskAdminAssistantInput` --references--> `RolUsuario`  [EXTRACTED]
  functions/src/services/ai/analytics/admin-report.service.ts → functions/src/models/usuario.model.ts
- `OrchestrateAiMessageResult` --references--> `AiAgentType`  [EXTRACTED]
  functions/src/services/ai/adapters/ai-orchestrator.ts → functions/src/models/ai/ai.model.ts

## Import Cycles
- None detected.

## Communities (230 total, 27 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (57): clearViewHistory(), log, RecomendacionAgregadoProducto, RecomendacionCacheDocumento, RecomendacionConfigGlobal, RecomendacionEstrategia, COMPLEMENTOS_CARRITO, COMPRADOS_JUNTOS (+49 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (61): ActualizarPagoDTO, COLECCION_PAGOS, CURRENCY_DEFAULT, EstadoPago, COMPLETADO, FALLIDO, PENDIENTE, PROCESANDO (+53 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (36): admin, fs, path, admin, fs, path, aiConfig, storageTienda (+28 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (60): createTryOnJob(), tryOnControllerLogger, requireTryOnEnabled(), AiSessionStatus, ACTIVE, ARCHIVED, CLOSED, ProductCategorySnapshot (+52 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (46): AuthObjectLike, getAuthObject(), getRequestUserId(), getStringValue(), handleError(), OfertasCommandController, AlcanceOferta, CalcularPrecioOfertaItemDto (+38 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (64): AiAgentType, ADMIN, SHOPPING, ActualizarUsuarioAppDTO, CanjeProducto, NivelLealtad, RolUsuario, ADMIN (+56 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (45): configuracionOpta, tieneCredencialesOpta(), validarConfiguracionOpta(), aTexto(), CalendarioCrudo, esCalendarioLigaMx(), extraerNombreCompetencia(), seleccionarCalendarioActivo() (+37 more)

### Community 7 - "Community 7"
Cohesion: 0.10
Nodes (7): CatalogCursor, CatalogQuery, CatalogResponse, CatalogSort, Producto, CatalogQueryError, ProductService

### Community 8 - "Community 8"
Cohesion: 0.06
Nodes (62): alertToMessage(), collectNestedRecords(), collectWarnings(), firstNestedString(), getString(), mapFedexPickupAvailabilityRequest(), mapFedexPickupAvailabilityResponse(), mapFedexPickupCancelRequest() (+54 more)

### Community 9 - "Community 9"
Cohesion: 0.05
Nodes (46): assertAiConfig(), AssertAiConfigOptions, assertVertexCompatibleGeminiModel(), buildVertexModelConfigError(), GeminiExecutionMode, geminiMode, getAiRuntimeSummary(), isTruthyEnv() (+38 more)

### Community 10 - "Community 10"
Cohesion: 0.07
Nodes (36): itemPersonalizacionSchema, ActualizarItemCarritoDTO, AgregarItemCarritoDTO, Carrito, CarritoPopulado, ItemCarrito, MAX_CANTIDAD_POR_ITEM, CheckoutFlowError (+28 more)

### Community 11 - "Community 11"
Cohesion: 0.04
Nodes (69): axios, busboy, cors, express, helmet, uuid, zod, main (+61 more)

### Community 12 - "Community 12"
Cohesion: 0.06
Nodes (49): validateParams(), verifyRole(), removeBeneficioImagenSchema, createFavoritoSchema, listFavoritosQuerySchema, productoIdParamSchema, ligaMxDivisionQuerySchema, ligaMxMatchIdParamSchema (+41 more)

### Community 13 - "Community 13"
Cohesion: 0.08
Nodes (15): buildHostedCheckoutSessionBaseParams(), buildStripeCheckoutSessionExpiresAt(), buildStripePaymentIntentCardOptions(), getAppUrl(), getStripeClient(), getStripeCurrency(), getMetadataString(), isAdminOrEmpleado() (+7 more)

### Community 14 - "Community 14"
Cohesion: 0.05
Nodes (59): BACKUP_SCRIPT_VERSION, main(), parseArgs(), plain(), ReportUser, AbsorptionFill, applyFill(), buildAbsorbedExternalId() (+51 more)

### Community 15 - "Community 15"
Cohesion: 0.05
Nodes (60): AdminDecisionOptionState, __conversationStateTestables, evolveAdminConversationState(), inferCategoryFilter(), inferPeriod(), ordinalIndex(), ORDINALS, PERIOD_PATTERNS (+52 more)

### Community 16 - "Community 16"
Cohesion: 0.06
Nodes (46): actualizarPerfil(), asStringArray(), buildClaimDocId(), buildItemClaimId(), buildPhoneClaimId(), buildSeasonPassId(), buildSeasonPassItemId(), buildVerificationRecord() (+38 more)

### Community 17 - "Community 17"
Cohesion: 0.07
Nodes (28): CHECKOUT_STALE_PAYMENT_PENDING_MINUTES, INVENTORY_EMPLOYEE_ADJUSTMENT_LIMIT, INVENTORY_RESERVATION_TTL_MINUTES, CheckoutAttempt, CheckoutAttemptStatus, CANCELED, CREATED, EXPIRED (+20 more)

### Community 18 - "Community 18"
Cohesion: 0.06
Nodes (55): baseUrl, main(), newRequestId(), PARALLEL, request(), assert(), baseUrl, log() (+47 more)

### Community 19 - "Community 19"
Cohesion: 0.07
Nodes (40): LOYALTY_PROBLEM_BASE_URI, LoyaltyProblemCode, PROBLEM_META, LoyaltyEnvironment, PRODUCTION, SANDBOX, PartnerScope, POINTS_EARN (+32 more)

### Community 20 - "Community 20"
Cohesion: 0.09
Nodes (38): CheckoutUnavailableItemDetail, EstadoReservaInventario, ACTIVA, CONFIRMADA, EXPIRADA, LIBERADA, ReservaInventario, InventarioPorTallaExtended (+30 more)

### Community 21 - "Community 21"
Cohesion: 0.06
Nodes (57): roundCurrency, loadBehaviorEvents(), aggregateProductBehavior(), BehaviorDailyPoint, __behaviorMetricsTestables, buildBehaviorDataQuality(), buildConversionFunnel(), buildHourlyDistribution() (+49 more)

### Community 22 - "Community 22"
Cohesion: 0.05
Nodes (29): firestoreTienda, tiendaApp, getMetrics(), PaymentState, FALLIDO, PAGADO, PENDIENTE, REEMBOLSADO (+21 more)

### Community 23 - "Community 23"
Cohesion: 0.05
Nodes (37): asPlainBody(), handleMultipart(), MIME_BY_EXTENSION, MulterFile, resolveUploadMimeType(), MultipartImagesOptions, parseMultipartImages(), buttonSchema (+29 more)

### Community 24 - "Community 24"
Cohesion: 0.07
Nodes (32): LOYALTY_COLLECTIONS, LOYALTY_DEFAULTS, LOYALTY_PROBLEM_BASE_URI_LEGACY, LOYALTY_SANDBOX_COLLECTIONS, earnLoyaltyPointsForPaidOrder(), reverseLoyaltyPointsForRefund(), systemActor, LoyaltyWallet (+24 more)

### Community 25 - "Community 25"
Cohesion: 0.07
Nodes (46): codigosPromocionCommandController, RequestWithAuth, codigosPromocionQueryController, AplicaCodigoPromocion, CodigoPromocion, CodigoPromocionFilters, CreateCodigoPromocionDto, ItemValidarCodigoPromocionDto (+38 more)

### Community 26 - "Community 26"
Cohesion: 0.05
Nodes (35): FedexProviderError, cancelFedexPickup(), cancelFedexShipmentForOrder(), cancelFedexTestShipment(), checkFedexPickupAvailability(), createFedexPickup(), createFedexShipmentForOrder(), createFedexTestLabel() (+27 more)

### Community 27 - "Community 27"
Cohesion: 0.05
Nodes (48): app, scheduledAccountDeletion, abandonedCartNotifications, api, birthdayNotifications, campaignNotifications, cleanupRecommendationEventsFunction, expirePickupOrdersFunction (+40 more)

### Community 28 - "Community 28"
Cohesion: 0.08
Nodes (43): cleanText(), createOptionId(), createQuoteId(), DEFAULT_CARRIER_CODES, DEFAULT_RATE_REQUEST_TYPES, FedexClientLike, FedexPublicRateError, FedexPublicRateErrorCode (+35 more)

### Community 29 - "Community 29"
Cohesion: 0.04
Nodes (36): ActualizarOrdenDTO, EstadoOrden, CANCELADA, CONFIRMADA, EN_PROCESO, ENTREGADA, ENVIADA, PENDIENTE (+28 more)

### Community 30 - "Community 30"
Cohesion: 0.07
Nodes (30): FedexAuthService, FedexCachedToken, FedexOAuthResponse, FedexTokenStatus, isValidOAuthResponse(), FedexClient, FedexRequestConfig, FedexConfig (+22 more)

### Community 31 - "Community 31"
Cohesion: 0.07
Nodes (22): appOficial, authAppOficial, firestoreApp, storageAppOficial, createFirebaseSessionToken(), LOYALTY_PARTNER_COLLECTIONS, PartnerAuditEntry, main() (+14 more)

### Community 32 - "Community 32"
Cohesion: 0.08
Nodes (39): cleanText(), FedexClientLike, FedexServiceAvailabilityError, FedexServiceAvailabilityErrorCode, FedexServiceAvailabilityService, getDefaultShipDatestamp(), isPlainDate(), mapProviderError() (+31 more)

### Community 33 - "Community 33"
Cohesion: 0.06
Nodes (40): AiAttachment, AiMessage, AiMessageRole, ASSISTANT, SYSTEM, TOOL, USER, AiSessionMode (+32 more)

### Community 34 - "Community 34"
Cohesion: 0.06
Nodes (35): aiAdminChatRateLimiter, aiChatRateLimiter, aiPublicChatRateLimiter, aiTryOnRateLimiter, aiUploadRateLimiter, createAiRateLimiter(), aiTryOnPollRateLimiter, aiTryOnUserRateLimiter (+27 more)

### Community 35 - "Community 35"
Cohesion: 0.09
Nodes (25): AiAuditLog, ChatToolCallPlan, FaqEntry, GuestSessionAccess, KnowledgeDocument, PendingClarification, PolicyDocument, PromotionDocument (+17 more)

### Community 36 - "Community 36"
Cohesion: 0.09
Nodes (13): FulfillmentStatus, CANCELED, EXPIRED, PAID, PENDING_PAYMENT, PICKED_UP, PREPARING, READY_FOR_PICKUP (+5 more)

### Community 37 - "Community 37"
Cohesion: 0.07
Nodes (44): puedeAsignarPuntos(), assertCanManageMember(), cancelRedemption(), confirmRedemption(), createAdjustment(), createEarnTransaction(), createRedemption(), getAdminRedemptionsReport() (+36 more)

### Community 38 - "Community 38"
Cohesion: 0.08
Nodes (47): mapAddress(), mapContact(), mapFedexPickupCreateRequest(), getPickupAddress(), getPickupContact(), alertToMessage(), assertValidPackage(), cleanFedexText() (+39 more)

### Community 39 - "Community 39"
Cohesion: 0.08
Nodes (38): alertToMessage(), fedexTrackingStatusLabels, getDateTimeByType(), getEstimatedDeliveryDate(), getLastEvent(), labelCreatedResult(), mapEvents(), mapFedexTrackRequest() (+30 more)

### Community 40 - "Community 40"
Cohesion: 0.05
Nodes (45): ADMIN_REPORT_BLOCK_TYPES, ADMIN_REPORT_CHART_TYPES, ADMIN_REPORT_VALUE_FORMATS, AdminReportKpiItem, adminReportSchema, anomalyBlockSchema, buildAdminReportJsonSchema(), chartBlockSchema (+37 more)

### Community 41 - "Community 41"
Cohesion: 0.04
Nodes (49): scripts, activate:loyalty-flags, audit:stripe-payments, backfill:personalizable, backfill:search-text, backup:pos-repair, build, build:watch (+41 more)

### Community 42 - "Community 42"
Cohesion: 0.08
Nodes (25): ask(), createSession(), listSessions(), sendError(), streamLogger, wantsSseResponse(), createAdminSession(), createPublicSession() (+17 more)

### Community 43 - "Community 43"
Cohesion: 0.07
Nodes (35): assert(), clientA, clientB, main(), PROD, record(), req(), results (+27 more)

### Community 44 - "Community 44"
Cohesion: 0.09
Nodes (27): PaymentStatus, AUTHORIZED, CANCELED, CREATED, EXPIRED, FAILED, PAID, PARTIALLY_REFUNDED (+19 more)

### Community 45 - "Community 45"
Cohesion: 0.08
Nodes (41): attributeIndicatesValid(), buildChanges(), collectMessages(), determineIsValid(), extractScore(), FedexAddressValidationPayload, getFirstResolvedAddress(), hasStrongErrorMessage() (+33 more)

### Community 46 - "Community 46"
Cohesion: 0.10
Nodes (45): createPaymentProviderError(), createPaymentProviderNetworkError(), createPaymentProviderTimeoutError(), createPaymentValidationError(), isValidEmail(), ensureRequiredUrl(), normalizeCurrency(), aplazoLogger (+37 more)

### Community 47 - "Community 47"
Cohesion: 0.08
Nodes (31): abandonAttempt(), cancelAttempt(), getAttemptStatus(), getAuthenticatedUid(), getIdempotencyKey(), quoteFieraPoints(), reconcilePendingAttempts(), startCheckout() (+23 more)

### Community 48 - "Community 48"
Cohesion: 0.09
Nodes (29): mapFedexCancelShipmentRequest(), assertCompleteAddress(), assertPackages(), buildRecipient(), currentShipDate(), FEDEX_CANCEL_DELETION_CONTROL, FEDEX_CANCEL_SHIPMENT_METHOD, FEDEX_CANCEL_SHIPMENT_PATH (+21 more)

### Community 49 - "Community 49"
Cohesion: 0.06
Nodes (29): AlertaStockProducto, ListarAlertasStockQuery, ActualizarProductoDTO, CrearProductoDTO, FedexProductShipping, InventarioGlobalBuckets, InventarioPorTalla, InventarioPorTallaBuckets (+21 more)

### Community 50 - "Community 50"
Cohesion: 0.09
Nodes (28): NotificationBroadcastChunkStatus, NotificationBroadcastStatus, NotificationCategory, NotificationDeliveryMode, NotificationEntityType, NotificationEventStatus, NotificationEventType, NotificationInboxDeleteResult (+20 more)

### Community 51 - "Community 51"
Cohesion: 0.10
Nodes (34): buildAddressValidityFlags(), collectCustomerMessages(), FedexAddressValidationError, FedexAddressValidationErrorCode, FedexAddressValidationService, FedexClientLike, hasInterpolatedStreetAddress(), isPlainDate() (+26 more)

### Community 52 - "Community 52"
Cohesion: 0.16
Nodes (7): LigaMxService, ClasificacionLigaMxDoc, ContextoLigaMxDoc, DetallePartidoLigaMxDoc, DivisionKey, PartidoLigaMxDoc, PlantillaLigaMxDoc

### Community 53 - "Community 53"
Cohesion: 0.14
Nodes (9): PaymentApiError, ProviderRefundStatusEntry, PaymentRefundRequestRecord, getMetadataString(), isPrivileged(), PaymentsService, roundToMinor(), toPaymentStatus() (+1 more)

### Community 54 - "Community 54"
Cohesion: 0.07
Nodes (33): buildFedexTrackingUrl(), calculateManualShippingCost(), isLeonPostalCode(), LEON_POSTAL_CODE_MAX, LEON_POSTAL_CODE_MIN, MANUAL_FEDEX_CARRIER, MANUAL_FEDEX_CURRENCY, MANUAL_FEDEX_METHOD (+25 more)

### Community 55 - "Community 55"
Cohesion: 0.07
Nodes (29): employeeCapabilities, getAiCapabilitiesFromRequest(), normalizeScopes(), requireAiAdmin(), requireAiCapability(), ChatPlan, ChatPlanSessionUpdates, ConversationFilters (+21 more)

### Community 56 - "Community 56"
Cohesion: 0.07
Nodes (32): addItemCarritoSchema, checkoutCarritoBaseObject, checkoutCarritoSchema, checkoutReturnUrlSchema, checkoutShippingSelectionSchema, codigoPromocionCheckoutSchema, createCartFedexQuoteSchema, fieraPointsRequestSchema (+24 more)

### Community 57 - "Community 57"
Cohesion: 0.12
Nodes (8): RecomendacionAgregadoDocumento, RecomendacionCandidato, RecomendacionContexto, AggregatesService, extractPaidProductIdsFromOrder(), isOrdenPagada(), excludeProductIds(), uniqueProductIds()

### Community 58 - "Community 58"
Cohesion: 0.09
Nodes (34): swaggerDefinition, swaggerOptions, beneficioRedireccionSchema, createBeneficioSchema, puntosRecompensaSchema, updateBeneficioSchema, createGallerySchema, deleteGalleryImageSchema (+26 more)

### Community 59 - "Community 59"
Cohesion: 0.06
Nodes (29): addMediaMetadata(), create(), deleteImage(), deleteVideo(), destroyPermanently(), createGalleryMediaMetadataSchema(), CreateGaleriaMediaMetadata, GaleriaMediaMetadata (+21 more)

### Community 60 - "Community 60"
Cohesion: 0.07
Nodes (20): replaceSizeInventory(), setActiveStatus(), updateStock(), uploadImages(), ProductRating, ProductRatingEligibility, ProductRatingEligibilityReason, ProductUserRatingSnapshot (+12 more)

### Community 61 - "Community 61"
Cohesion: 0.06
Nodes (10): deleteUserImage(), uploadUserImage(), getAll(), getById(), aplazoCancelReturn(), aplazoFailureReturn(), aplazoSuccessReturn(), renderHtml() (+2 more)

### Community 62 - "Community 62"
Cohesion: 0.08
Nodes (33): checkEmail(), verifySeasonPassSchema, assignPointsBySaleSchema, assignUserPointsSchema, externalTransactionIdSchema, saleFolioSchema, staffAssignmentHistoryQuerySchema, emailLookupRateLimiter (+25 more)

### Community 63 - "Community 63"
Cohesion: 0.12
Nodes (26): HistorialPuntosUsuario, MovimientoPuntos, OrigenPuntos, ResumenPuntosAnual, TipoMovimientoPuntos, ACUMULACION, AJUSTE, BONIFICACION (+18 more)

### Community 64 - "Community 64"
Cohesion: 0.10
Nodes (30): ROLES_ASIGNACION_PUNTOS, legacyAssignPoints(), legacyAssignPointsBySale(), legacyClaimFichajeBonus(), legacyGetAsignaciones(), legacyGetMyHistorial(), legacyGetMyPoints(), legacySumarStreakPoints() (+22 more)

### Community 65 - "Community 65"
Cohesion: 0.10
Nodes (29): claimPoints(), create(), destroyPermanently(), getUploadedFile(), getUploadedFiles(), remove(), removeImage(), removeMedia() (+21 more)

### Community 66 - "Community 66"
Cohesion: 0.13
Nodes (20): buildErrorResponse(), createDetalle(), deleteDetalle(), detalleProductoCommandLogger, getStatusFromErrorCode(), updateDetalle(), buildErrorResponse(), detalleProductoQueryLogger (+12 more)

### Community 67 - "Community 67"
Cohesion: 0.07
Nodes (34): assertStripeKeyEnvironment(), buildEmbeddedCheckoutSessionBaseParams, buildStripeIdempotencyKey(), getRequiredEnv(), getStripeMinimumAmountMinor(), getStripePublishableKey(), getStripeSecretKey(), getStripeWebhookSecret() (+26 more)

### Community 68 - "Community 68"
Cohesion: 0.07
Nodes (26): normalizeFedExCity(), normalizeMxStateForFedEx(), FedexAvailabilityService, FedexCarrierCode, fedexCarrierCodeSchema, FedexPackagingType, FedexPickupType, FedexProvider (+18 more)

### Community 69 - "Community 69"
Cohesion: 0.08
Nodes (31): addDays(), ALPHA_GRID, backtest(), BacktestOutcome, BETA_GRID, dampedTrendFit(), exponentialSmoothingFit(), FITTERS (+23 more)

### Community 70 - "Community 70"
Cohesion: 0.13
Nodes (16): isValidTimezone(), notificationConfig, resolveNotificationLocale(), resolveNotificationTimezone(), resolveOptionalNotificationTimezone(), toTrimmedString(), NotificationPreferenceDocument, NOTIFICATION_COLLECTIONS (+8 more)

### Community 71 - "Community 71"
Cohesion: 0.15
Nodes (18): EarnTransactionInput, LoyaltyActorContext, ReversalInput, TransactionResponseDto, WalletResponseDto, SandboxMemberRecord, main(), parseArgs() (+10 more)

### Community 72 - "Community 72"
Cohesion: 0.11
Nodes (30): normalizeMxPhoneForFedEx(), FedexRateAddressInput, FedexRatePackageInput, buildCanonicalStreetLines(), buildDestinationFromCartPayload(), buildOptionId(), buildOrigin(), buildShippingCartHash() (+22 more)

### Community 73 - "Community 73"
Cohesion: 0.12
Nodes (32): obtenerNombreTorneo(), fechaPartidoApiToIsoString(), construirResumenTorneo(), debeOcultarMarcadorTemporal(), esCierrePartidoPublicable(), esFasePrimerTiempo(), esMarcadorOficial(), esPartidoConcluido() (+24 more)

### Community 74 - "Community 74"
Cohesion: 0.11
Nodes (24): logout(), logoutAllSessions(), maskUid(), requestVerificationCode(), verifyAndLogin(), refreshToken(), buildUsuarioFromDoc(), calcularEdad() (+16 more)

### Community 75 - "Community 75"
Cohesion: 0.08
Nodes (28): buildRateLimitKey(), cleanupExpired(), consumeInMemoryRateLimit(), createSimpleRateLimiter(), RateLimitDecision, RateLimitEntry, RateLimitOptions, rejectRateLimited() (+20 more)

### Community 76 - "Community 76"
Cohesion: 0.11
Nodes (31): validateBody(), validateQuery(), handleLoyaltyError(), requireIdempotencyKey(), partnerRequestLogMiddleware(), requestIdMiddleware(), createLoyaltyPartnerRouter(), earnRateLimit (+23 more)

### Community 77 - "Community 77"
Cohesion: 0.08
Nodes (19): LoyaltyChannel, ADMIN, ECOMMERCE, PARTNER, STORE, SYSTEM, LoyaltyTransactionStatus, CONFIRMED (+11 more)

### Community 78 - "Community 78"
Cohesion: 0.19
Nodes (20): AplazoChannel, assertAplazoEnabled(), AplazoContractBaseUrls, AplazoContractConfig, AplazoContractPaths, getAplazoContractConfig(), getAplazoContractTodoMessage(), getEnv() (+12 more)

### Community 79 - "Community 79"
Cohesion: 0.13
Nodes (21): create(), deleteContacto(), getAll(), getById(), updateStatus(), devOtpFallback(), getBrevoConfig(), isLocalDevRuntime() (+13 more)

### Community 80 - "Community 80"
Cohesion: 0.11
Nodes (24): ProductPreviewType, ACCESSORY, APPAREL, PROP, UNKNOWN, buildGeminiFallbackPrompt(), buildPrompt(), extractGeminiImage() (+16 more)

### Community 81 - "Community 81"
Cohesion: 0.11
Nodes (18): addEarnMovement(), aggregateEarners(), assertDayKey(), EARN_TYPES, isEarnMovement(), isRetryableFirestoreError(), MovementRecord, normalizedText() (+10 more)

### Community 82 - "Community 82"
Cohesion: 0.07
Nodes (20): added, base, changed, deployed, next, perProject, removed, RUNTIME_MANAGED (+12 more)

### Community 83 - "Community 83"
Cohesion: 0.08
Nodes (28): getRecepcion(), listRecepciones(), ActualizarStockDTO, AlertaStockTalla, ConfirmarRecepcionMercanciaDTO, CrearRecepcionMercanciaDTO, CrearStockDTO, CrearUbicacionDTO (+20 more)

### Community 84 - "Community 84"
Cohesion: 0.08
Nodes (31): LoyaltyActorType, ADMIN, EMPLOYEE, PARTNER, SERVICE, SUPER_ADMIN, USER, LoyaltyTransactionType (+23 more)

### Community 85 - "Community 85"
Cohesion: 0.12
Nodes (29): allowDefaultDimensions(), assertFedexLimits(), buildConsolidatedPackage(), buildFedexPackageLineItemsFromCart(), buildPerUnitPackages(), DEFAULT_PACKAGE, DEFAULT_PACKAGES, FEDEX_PRODUCT_DIMENSIONS_MISSING (+21 more)

### Community 86 - "Community 86"
Cohesion: 0.12
Nodes (24): assertValidShipDate(), FedexClientLike, FedexPostalCodeService, FedexPostalErrorCode, FedexPostalValidationError, getDefaultFedexShipDate(), isPlainDate(), mapProviderError() (+16 more)

### Community 87 - "Community 87"
Cohesion: 0.09
Nodes (31): AnalyticsTool, cached(), loadCatalogProducts(), loadCategories(), loadEarliestEventDays(), loadLines(), loadOrders(), periodShape (+23 more)

### Community 88 - "Community 88"
Cohesion: 0.06
Nodes (32): devDependencies, cross-env, eslint, eslint-config-google, eslint-plugin-import, firebase, firebase-functions-test, @firebase/rules-unit-testing (+24 more)

### Community 89 - "Community 89"
Cohesion: 0.13
Nodes (22): CheckoutAddressValidationStatus, CheckoutFlowErrorCode, CheckoutPaymentProvider, CheckoutShippingMethod, FieraPointsMode, FieraPointsQuote, FieraPointsQuoteReason, FieraPointsRedemptionStatus (+14 more)

### Community 90 - "Community 90"
Cohesion: 0.12
Nodes (30): BLOCKED_SERVICE_TYPES, chooseRatedDetail(), cleanFedexText(), cleanStreetLines(), FedexRateRequestConfigError, FedexRateRequestPayload, getDeliveryDate(), getMoneyAmount() (+22 more)

### Community 91 - "Community 91"
Cohesion: 0.10
Nodes (28): AnomalyFinding, AnomalySeverity, __anomalyTestables, detectProductAnomalies(), detectSeriesAnomalies(), madOf(), medianOf(), MIN_BASELINE_OBSERVATIONS (+20 more)

### Community 93 - "Community 93"
Cohesion: 0.15
Nodes (7): fallbackLegacyStatus(), PaymentAttemptRepository, toPaymentAttempt(), PaymentAttempt, buildTimestampPatch(), PaymentFinalizerService, ProviderRefundStatusInput

### Community 94 - "Community 94"
Cohesion: 0.09
Nodes (20): messagingAppOficial, NotificationBroadcastChunk, NotificationDeliveryStatus, NotificationEligibilityResult, BroadcastChunkProcessingResult, NotificationBroadcastWorkerService, BroadcastChunkSendResult, INVALID_FCM_CODES (+12 more)

### Community 95 - "Community 95"
Cohesion: 0.09
Nodes (17): getPreferences(), listInbox(), NotificationBroadcastCopy, NotificationBroadcastCreationResult, NotificationBroadcastJob, NotificationBroadcastTarget, BroadcastAudience, NotificationBroadcastAudienceService (+9 more)

### Community 96 - "Community 96"
Cohesion: 0.12
Nodes (15): create(), deactivate(), errorResponse(), getPublicById(), listPublic(), mapErrorStatus(), update(), validateAvailability() (+7 more)

### Community 97 - "Community 97"
Cohesion: 0.12
Nodes (24): paymentAuthMiddleware(), paymentCustomerMiddleware(), paymentStaffMiddleware(), respondAuthError(), aplazoAdminActionSchema, aplazoOnlineCreateSchema, aplazoRefundRequestParamSchema, aplazoRefundStatusQuerySchema (+16 more)

### Community 98 - "Community 98"
Cohesion: 0.17
Nodes (7): AdjustmentInput, LoyaltyTransaction, RedemptionInput, assertUniqueUserClaimField(), LoyaltyEngineService, normalizeCustomerNameSnapshot(), requireLoyaltyWrites()

### Community 99 - "Community 99"
Cohesion: 0.11
Nodes (22): buildConversationStatePrompt(), AdminReportAgent, AdminReportTrace, AdminToolCallTrace, __agentTestables, EvidenceEntry, extractPeriodLabel(), isCorrectableStructuredOutputError() (+14 more)

### Community 100 - "Community 100"
Cohesion: 0.11
Nodes (10): CrearUsuarioAppDTO, UsuarioApp, dedupeUsuariosByUid(), normalizeUserRoles(), toTimestampMs(), UserAppService, authCreateUser, DocData (+2 more)

### Community 101 - "Community 101"
Cohesion: 0.09
Nodes (23): TryOnJobStatus, COMPLETED, FAILED, PROCESSING, QUEUED, getNestedString(), getString(), mapHttpStatusToCode() (+15 more)

### Community 102 - "Community 102"
Cohesion: 0.17
Nodes (7): GeneratedPushCopy, NotificationDeliveryRecord, NotificationEvent, generatedPushCopySchema, NotificationAiService, NotificationEligibilityService, mockedGeminiAdapter

### Community 103 - "Community 103"
Cohesion: 0.24
Nodes (28): asRecord(), categoryCandidate(), ChartBlock, ChartCandidate, ChartEvidenceEntry, ChartKind, chartTypeFor(), collectCandidates() (+20 more)

### Community 104 - "Community 104"
Cohesion: 0.14
Nodes (7): Banner, BannerButton, BannerContentConfig, BannerContentType, CreateBannerDTO, UpdateBannerDTO, BannerService

### Community 105 - "Community 105"
Cohesion: 0.12
Nodes (12): CrearFavoritoDTO, Favorito, FavoritoConProducto, FavoriteCreationResult, favoritoLogger, FavoritoService, FavoritoServiceError, createDocSnapshot() (+4 more)

### Community 106 - "Community 106"
Cohesion: 0.12
Nodes (19): ANALYTICS_COLLECTIONS, AnalyticsCatalogEntry, AnalyticsOfferSummary, AnalyticsOrderItem, AnalyticsOrdersPage, AnalyticsPromoCodeSummary, AnalyticsRepository, mapOrder() (+11 more)

### Community 107 - "Community 107"
Cohesion: 0.15
Nodes (25): buildBehaviorDailySeries(), AnalyticsPeriodError, AnalyticsPeriodInput, AnalyticsPeriodKey, assertDayKey(), buildDayKey(), buildPeriod(), dayKeyFormatter (+17 more)

### Community 108 - "Community 108"
Cohesion: 0.07
Nodes (27): dependencies, axios, busboy, cors, dotenv, express, file-type, firebase-admin (+19 more)

### Community 109 - "Community 109"
Cohesion: 0.10
Nodes (17): ADULT_LINE_IDS, ADULT_LINE_KEYWORDS, APPAREL_CATEGORY_IDS, APPAREL_KEYWORDS, buildPolicy(), buildUnsupportedPolicy(), EXCLUDED_CATEGORY_IDS, EXCLUDED_CATEGORY_KEYWORDS (+9 more)

### Community 111 - "Community 111"
Cohesion: 0.15
Nodes (16): CheckoutItemPricingSnapshot, CheckoutShippingAddress, CheckoutShippingSnapshot, FedexRatePackageDto, ShippingQuoteOption, ValidateSelectedQuoteInput, CheckoutShippingInput, CheckoutShippingService (+8 more)

### Community 112 - "Community 112"
Cohesion: 0.10
Nodes (20): reconcileAplazoPayments, AI_API_SECRETS, AI_TRIGGER_SECRETS, API_RUNTIME_SECRETS, APLAZO_PAYMENT_SECRETS, APP_OFICIAL_SECRETS, AUTH_SECRETS, BOLETOMOVIL_SECRETS (+12 more)

### Community 113 - "Community 113"
Cohesion: 0.13
Nodes (20): configuracionLigaMx, ID_TORNEO_APERTURA, ID_TORNEO_CLAUSURA, perfilesDivision, COLECCIONES, contarDocumentosEnColeccion(), verificarSincronizacion(), ContextoActivoResuelto (+12 more)

### Community 114 - "Community 114"
Cohesion: 0.12
Nodes (19): createDetalleProductoSchema, updateDetalleProductoSchema, adminProductsQuerySchema, booleanQuerySchema, catalogProductQuerySchema, createProductSchema, deleteImageSchema, fedexShippingSchema (+11 more)

### Community 115 - "Community 115"
Cohesion: 0.19
Nodes (6): ListarMovimientosInventarioQuery, MovimientoInventario, RegistrarAjusteInventarioDTO, RegistrarAjusteInventarioResult, RegistrarMovimientoInventarioDTO, InventoryService

### Community 116 - "Community 116"
Cohesion: 0.13
Nodes (22): CortesiaTrabajadorClub, buildCortesiaDocId(), cortesiaDocToResponse(), CORTESIAS_SUBCOLLECTION, CortesiasSyncSummary, fetchPartidosLeonLocal(), getTorneoBasePath(), getTorneoLabel() (+14 more)

### Community 117 - "Community 117"
Cohesion: 0.17
Nodes (23): obtenerPerfilDivision(), validarConfiguracionLigaMx(), aNumeroNullable(), aTextoNullable(), construirCalendarioActual(), construirClasificacionActual(), construirContextoActual(), construirPlantillaActual() (+15 more)

### Community 118 - "Community 118"
Cohesion: 0.16
Nodes (7): ActualizarNoticiaDTO, CrearNoticiaDTO, CategoriaNoticia, IAContenido, Noticia, OrigenNoticia, NewService

### Community 119 - "Community 119"
Cohesion: 0.13
Nodes (24): LoyaltyAdjustmentReason, FRAUD_REVERSAL, GOODWILL, MANUAL_CORRECTION, PROMOTION, SYSTEM_CORRECTION, AbortError, AppliedStep (+16 more)

### Community 120 - "Community 120"
Cohesion: 0.11
Nodes (21): main(), parseArgs(), CAMPAIGN_CLAIM_FIELD, CAMPAIGN_DESCRIPTION, CAMPAIGN_KEY, CAMPAIGN_POINTS, isInactive(), listTargetUids() (+13 more)

### Community 121 - "Community 121"
Cohesion: 0.11
Nodes (16): AnalyticsOrder, AnalyticsProduct, createAnalyticsToolContext(), ANALYTICS_TOOL_MAP, ANALYTICS_TOOLS, buildAnalyticsFunctionDeclarations(), __behaviorToolsTestables, context() (+8 more)

### Community 122 - "Community 122"
Cohesion: 0.09
Nodes (9): NotificationSchedulerService, enqueueEventMock, userDocs, enqueueEventMock, hasUserRatedProductMock, orderDocs, productDocs, enqueueEventMock (+1 more)

### Community 123 - "Community 123"
Cohesion: 0.21
Nodes (6): ActualizarPatrocinadorDTO, CrearPatrocinadorDTO, Patrocinador, PatrocinadorLogoVariante, logoFieldByVariante, PatrocinadorService

### Community 124 - "Community 124"
Cohesion: 0.24
Nodes (22): approveAplazoRefundRequest(), cancelAplazoPayment(), createAplazoOnline(), createAplazoRefundRequest(), getActorFromRequest(), getAplazoRefundRequest(), getAplazoRefundStatus(), getOptionalIdempotencyKey() (+14 more)

### Community 125 - "Community 125"
Cohesion: 0.18
Nodes (19): isPlainObject(), maskEmail(), maskPhone(), maskToken(), normalizeEmail(), normalizeMxPhoneForAplazo(), normalizeWhitespace(), sanitizeAxiosErrorData() (+11 more)

### Community 126 - "Community 126"
Cohesion: 0.12
Nodes (10): getAdminProducts(), getById(), getCatalog(), getStockBySize(), AdminProductListItemDTO, AdminProductsQuery, AdminProductStatusFilter, mockedFavoritoService (+2 more)

### Community 127 - "Community 127"
Cohesion: 0.14
Nodes (18): createNewSchema, deleteImageSchema, updateNewSchema, adminConfigUpdateSchema, adminMetricsQuerySchema, eventMetadataSchema, homeRecommendationsQuerySchema, mergeIdentitySchema (+10 more)

### Community 128 - "Community 128"
Cohesion: 0.15
Nodes (15): EstadoVentaPos, BORRADOR, CANCELADA, EXPIRADA, FALLIDA, PAGADA, PENDIENTE_PAGO, VentaPos (+7 more)

### Community 129 - "Community 129"
Cohesion: 0.23
Nodes (16): LoyaltyProblemError, assertProductionRedemptionOwnership(), cancelRedemption(), confirmRedemption(), createEarnTransaction(), createMemberToken(), createRedemption(), getMemberTransactions() (+8 more)

### Community 130 - "Community 130"
Cohesion: 0.16
Nodes (12): ActualizarBeneficioDTO, CrearBeneficioDTO, BENEFICIO_DESTINOS, BeneficioClaimResult, BeneficioDestinoModulo, BeneficioMediaTipo, BeneficioReclamo, BeneficioRedireccion (+4 more)

### Community 131 - "Community 131"
Cohesion: 0.21
Nodes (16): ChatNormalizerService, collapseWhitespace(), collectMatches(), detectTopics(), includesTerm(), normalizeText(), resolvePricePreference(), resolveReferences() (+8 more)

### Community 132 - "Community 132"
Cohesion: 0.10
Nodes (21): dependencies, axios, busboy, cors, dotenv, express, firebase-admin, firebase-functions (+13 more)

### Community 133 - "Community 133"
Cohesion: 0.13
Nodes (17): aplicaASchema, baseCodigoPromocionSchema, codigoNormalizadoSchema, codigoPromocionCarritoItemSchema, codigoPromocionCarritoItemsSchema, codigoPromocionParamsSchema, createCodigoPromocionSchema, disponibilidadCodigosPromocionCarritoSchema (+9 more)

### Community 134 - "Community 134"
Cohesion: 0.24
Nodes (4): NotificationInboxItem, NotificationInboxPage, NotificationInboxReadResult, NotificationInboxService

### Community 135 - "Community 135"
Cohesion: 0.17
Nodes (15): aiAppCheckMiddleware(), AiAppCheckMode, AiAppCheckReason, appCheckLogger, getRequestMetadata(), getVerificationFailureReason(), isControlledLocalBypassEnabled(), isProductionRuntime() (+7 more)

### Community 136 - "Community 136"
Cohesion: 0.16
Nodes (3): TryOnJob, TryOnJobService, TryOnWorkflowService

### Community 137 - "Community 137"
Cohesion: 0.12
Nodes (12): RecomendacionEventoTipo, AGREGAR_CARRITO, BUSQUEDA, CLIC_PRODUCTO, CLIC_RECOMENDACION, COMPRA, FAVORITO, IMPRESION_RECOMENDACION (+4 more)

### Community 138 - "Community 138"
Cohesion: 0.16
Nodes (4): ExternalTxnIndexRecord, IdempotencyRecord, ExternalTxnRepository, IdempotencyRepository

### Community 139 - "Community 139"
Cohesion: 0.19
Nodes (18): aggregateByProduct(), breakdownOrders(), buildDailySeries(), buildVariation(), countUnits(), DailyPoint, increment(), isCanceledOrder() (+10 more)

### Community 140 - "Community 140"
Cohesion: 0.18
Nodes (15): BEHAVIOR_COLLECTION, behaviorLogger, BehaviorRepository, __behaviorTestables, isMissingIndexError(), mapEvent(), MAX_BEHAVIOR_EVENTS_SCANNED, normalizeChannel() (+7 more)

### Community 141 - "Community 141"
Cohesion: 0.24
Nodes (16): CalendarDate, evaluateBirthdayToday(), fromParts(), fromUtcDate(), getCalendarDateInTimezone(), isBirthdayToday(), isLeapYear(), isValidCalendarDate() (+8 more)

### Community 142 - "Community 142"
Cohesion: 0.11
Nodes (12): __dirname, INTERNAL_PATHS, internalPath, legacyPath, openapiDir, problemResponses, publicPath, publicSpec (+4 more)

### Community 143 - "Community 143"
Cohesion: 0.16
Nodes (12): create(), destroyPermanently(), getUploadedFile(), isLogoVariante(), remove(), removeImage(), serializePatrocinador(), update() (+4 more)

### Community 144 - "Community 144"
Cohesion: 0.19
Nodes (13): create(), remove(), update(), CrearCategoriaDTO, CrearLineaDTO, CrearProveedorDTO, CrearTallaDTO, Talla (+5 more)

### Community 145 - "Community 145"
Cohesion: 0.15
Nodes (16): alcanceOfertaSchema, CalcularPreciosOfertaInput, calcularPreciosOfertaSchema, CreateOfertaInput, createOfertaSchema, fechaOfertaSchema, idsArraySchema, ListarOfertasQueryInput (+8 more)

### Community 146 - "Community 146"
Cohesion: 0.24
Nodes (9): RachaCheckInResult, RachaUsuario, processDailyRachas, runOnce(), RachaService, previousDayKey(), toDayKey(), evaluateRachaRisk() (+1 more)

### Community 147 - "Community 147"
Cohesion: 0.18
Nodes (8): normalizeAdminConversationState(), AdminAgentEvent, AdminAgentHistoryEntry, AdminReportResult, AdminReport, AdminAssistantService, buildTitle(), toIso()

### Community 148 - "Community 148"
Cohesion: 0.20
Nodes (14): AnalysisTraceSummary, ANOMALY_TOOL_NAME, asNumber(), asRecord(), collectForecastPayloads(), CURRENCY_METRICS, FORECAST_TOOL_NAME, ForecastPayload (+6 more)

### Community 149 - "Community 149"
Cohesion: 0.18
Nodes (8): ApproveRefundRequestInput, CreateRefundRequestInput, PaymentRefundRequestRepository, PaymentRefundRequestStatus, ProcessRefundRequestInput, RejectRefundRequestInput, toRefundRequestRecord(), withoutUndefined()

### Community 150 - "Community 150"
Cohesion: 0.12
Nodes (14): TipoMovimientoInventario, AJUSTE, CONTEO_FISICO, DEVOLUCION, ENTRADA, LIBERACION_RESERVA, RECEPCION, RESERVA (+6 more)

### Community 151 - "Community 151"
Cohesion: 0.12
Nodes (15): compileOnSave, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, noImplicitReturns, noUnusedLocals, outDir (+7 more)

### Community 152 - "Community 152"
Cohesion: 0.12
Nodes (16): devDependencies, cross-env, form-data, rimraf, ts-node-dev, @types/busboy, @types/cors, @types/express (+8 more)

### Community 153 - "Community 153"
Cohesion: 0.23
Nodes (10): buildErrorResponse(), createFavorito(), deleteFavorito(), favoritoCommandLogger, getStatusFromErrorCode(), buildErrorResponse(), checkFavorito(), favoritoQueryLogger (+2 more)

### Community 154 - "Community 154"
Cohesion: 0.18
Nodes (9): LoyaltyRedemptionStatus, CANCELLED, CONFIRMED, EXPIRED, PENDING, REFUNDED, LoyaltyRedemption, RedemptionResponseDto (+1 more)

### Community 155 - "Community 155"
Cohesion: 0.30
Nodes (14): asNumber(), asRecord(), __decisionEnrichTestables, DecisionEvidenceEntry, FRIENDLY_SOURCE_LABELS, hasTruncated(), periodLabel(), reconcileDecisionBlocksAndSources() (+6 more)

### Community 156 - "Community 156"
Cohesion: 0.25
Nodes (8): PendingRegistrationDoc, PendingRegistrationPayload, PendingRegistrationService, StorePendingRegistrationResult, VerifyPendingRegistrationResult, decryptPendingPassword(), encryptPendingPassword(), getEncryptionKey()

### Community 157 - "Community 157"
Cohesion: 0.20
Nodes (12): BRAND, construirHtml(), escapeHtml(), { execFileSync }, extraerFechaNacimiento(), { firestoreApp }, fs, localizarNavegador() (+4 more)

### Community 158 - "Community 158"
Cohesion: 0.22
Nodes (9): AplazoChannelConfig, AplazoConfig, AplazoWebhookAuthScheme, getAplazoConfig(), getBoolean(), getNumber(), getOptional(), getWebhookAuthScheme() (+1 more)

### Community 159 - "Community 159"
Cohesion: 0.36
Nodes (11): buildError(), getBuyAgain(), getCartRecommendations(), getHomeRecommendations(), getProductRecommendations(), getRecentlyViewed(), getRecommendations(), getSessionId() (+3 more)

### Community 160 - "Community 160"
Cohesion: 0.29
Nodes (12): getFirebaseErrorCode(), normalizeFechaNacimiento(), normalizeGenero(), registrationServerErrorMessage(), requestRegistrationCode(), verifyRegistration(), calcularEdad(), createEmailUser() (+4 more)

### Community 163 - "Community 163"
Cohesion: 0.27
Nodes (8): OrderEvent, OrderEventActorType, OrderEventType, LIMIT, repairExpiredPickupOrders(), resolveRestoredState(), RestoredState, OrderEventService

### Community 164 - "Community 164"
Cohesion: 0.27
Nodes (12): aTextoNullable(), ComponentesFechaHoraLocal, convertirFechaHoraLocalAZonaUtc(), DIAS_SEMANA_EN_US, esSufijoZUtcFalsoDeApi(), esVentanaSemanalClasificacion(), normalizarCadenaFechaHora(), obtenerMomentoEnZona() (+4 more)

### Community 165 - "Community 165"
Cohesion: 0.20
Nodes (6): cleanupTryOnAssets, cronLogger, LogContext, LogLevel, sanitizeContext(), StructuredLogger

### Community 166 - "Community 166"
Cohesion: 0.19
Nodes (9): STORE_FIRESTORE_DATABASE, NOTIFICATION_EVENT_SECRETS, NOTIFICATION_SCHEDULER_SECRETS, processBroadcastChunkTrigger, triggerLogger, processNotificationEventTrigger, triggerLogger, processPaymentEventTrigger (+1 more)

### Community 167 - "Community 167"
Cohesion: 0.31
Nodes (9): createBillingPortal(), createRefund(), createSetupIntent(), getAuthenticatedUid(), getCheckoutSession(), getPaymentIntent(), getRawWebhookBody(), respondStripeError() (+1 more)

### Community 168 - "Community 168"
Cohesion: 0.15
Nodes (12): ActualizarConfiguracionPuntosDTO, ActualizarConfiguracionTiendaDTO, ConfiguracionAlertas, ConfiguracionPromocion, ConfiguracionPuntos, TipoPromocion, DESCUENTO_FIJO, DESCUENTO_PORCENTAJE (+4 more)

### Community 169 - "Community 169"
Cohesion: 0.29
Nodes (5): CatalogProductCardDTO, readStoredOfferSnapshot(), ProductCardsService, filterElegibleProductIds(), isProductoElegible()

### Community 170 - "Community 170"
Cohesion: 0.17
Nodes (7): baseProducts, clone(), createSnapshotDoc(), DocData, FakeTimestamp, Filter, Order

### Community 171 - "Community 171"
Cohesion: 0.17
Nodes (7): applyFilter(), DocData, DocRef, EXPIRED_AT, FUTURE_AT, NOW, toComparable()

### Community 172 - "Community 172"
Cohesion: 0.18
Nodes (7): clone(), compareValue(), createSnapshotDoc(), DocData, FakeTimestamp, Filter, Order

### Community 173 - "Community 173"
Cohesion: 0.22
Nodes (12): analyzeCodebase(), CollectionInfo, CONFIG, ensureDirectoryExistence(), FirebaseServiceUsage, generateArchitectureDiagram(), generateDataModelDiagram(), generateMarkdownReport() (+4 more)

### Community 174 - "Community 174"
Cohesion: 0.30
Nodes (10): confirmRecepcionSchema, createRecepcionSchema, listInventoryDashboardQuerySchema, listInventoryMovementsQuerySchema, listLowStockAlertsQuerySchema, listRecepcionesQuerySchema, registerInventoryAdjustmentSchema, registerInventoryMovementSchema (+2 more)

### Community 175 - "Community 175"
Cohesion: 0.23
Nodes (11): getOrderUsuarioId(), handleOrderInvalidation(), hasRelevantFieldChange(), invalidateRecommendationsOnConfigChange, invalidateRecommendationsOnInventoryChange, invalidateRecommendationsOnOfferChange, invalidateRecommendationsOnOrderChange, invalidateRecommendationsOnProductChange (+3 more)

### Community 176 - "Community 176"
Cohesion: 0.18
Nodes (6): clone(), createSnapshotDoc(), DocData, FakeTimestamp, Filter, Order

### Community 177 - "Community 177"
Cohesion: 0.27
Nodes (10): A, B, call(), getToken(), main(), record(), results, rid() (+2 more)

### Community 178 - "Community 178"
Cohesion: 0.29
Nodes (6): limpiarTexto(), loadMissingLocalSecrets(), resolverProjectId(), LIGA_MX_SECRETS, syncLigaMxData, runSync()

### Community 179 - "Community 179"
Cohesion: 0.20
Nodes (3): enqueueEvent(), sendTestNotification(), updatePreferences()

### Community 180 - "Community 180"
Cohesion: 0.42
Nodes (10): complete(), expire(), getActor(), getById(), list(), prepare(), ready(), respondError() (+2 more)

### Community 181 - "Community 181"
Cohesion: 0.20
Nodes (9): AI_COLLECTIONS, CLIENT_KINDS, ClientKind, getClientContext(), getClientFirestore(), LIGA_MX_PUBLIC_COLLECTIONS, RULES_PATH, TestFirestore (+1 more)

### Community 182 - "Community 182"
Cohesion: 0.18
Nodes (11): scripts, build, clean, deploy, dev, diagnostico, docs:firebase, prebuild (+3 more)

### Community 183 - "Community 183"
Cohesion: 0.27
Nodes (8): getCalendar(), getContext(), getDivisionKey(), getMatch(), getMatchDetail(), getPlayer(), getRoster(), getStandings()

### Community 184 - "Community 184"
Cohesion: 0.33
Nodes (5): handleError(), OfertasQueryController, parseBooleanQuery(), parseNumberQuery(), CalcularPreciosOfertaDto

### Community 186 - "Community 186"
Cohesion: 0.27
Nodes (4): DashboardAlertasStock, DashboardInventarioItem, DiagnosticoInventarioProducto, ListarDashboardInventarioQuery

### Community 188 - "Community 188"
Cohesion: 0.27
Nodes (6): EstadoPosSession, CLOSED, OPEN, PosSession, POS_SESSIONS_COLLECTION, PosSessionRepository

### Community 189 - "Community 189"
Cohesion: 0.20
Nodes (4): agentRun, buildQuery(), DocData, RecordedQuery

### Community 190 - "Community 190"
Cohesion: 0.33
Nodes (6): addItem(), clearCart(), getCartIdentity(), mergeCarts(), removeItem(), updateItem()

### Community 191 - "Community 191"
Cohesion: 0.22
Nodes (4): getOperationalSummary(), listAdminNotifications(), markAdminNotificationsRead(), markAllAdminNotificationsRead()

### Community 195 - "Community 195"
Cohesion: 0.46
Nodes (6): AcreditacionesError, getOrCreateApp(), getRealtimeDbAcreditaciones(), isAcreditacionesConfigured(), loadServiceAccount(), resolveServiceAccountPath()

### Community 196 - "Community 196"
Cohesion: 0.32
Nodes (3): configuracionExpiracionPuntos, loyaltyPointsExpirationJob, processPointsExpiration

### Community 197 - "Community 197"
Cohesion: 0.57
Nodes (7): captureTracking(), markPreparing(), markReadyToShip(), requireAdminId(), sendError(), toStatusCode(), updateStatus()

### Community 198 - "Community 198"
Cohesion: 0.39
Nodes (6): getAll(), getById(), getInventory(), getAllSizes(), getSizeById(), getSizeInventory()

### Community 200 - "Community 200"
Cohesion: 0.25
Nodes (8): TryOnEligibilityReason, PRODUCT_IMAGE_UNAVAILABLE, PRODUCT_OUT_OF_STOCK, PRODUCT_UNAVAILABLE, PRODUCT_UNCLASSIFIED, PRODUCT_UNSUPPORTED, TRYON_DISABLED, USER_IMAGE_UNAVAILABLE

### Community 204 - "Community 204"
Cohesion: 0.25
Nodes (5): address, cart, originalEnv, resolvedAddress, validAddressValidationResult

### Community 205 - "Community 205"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, rootDir, types, extends, include, ../tsconfig.json

### Community 206 - "Community 206"
Cohesion: 0.25
Nodes (7): mockCreateUser, mockDeleteUser, mockDocCreate, mockExistsGet, mockGetUserByEmail, mockOtorgarBono, mockSyncClaims

### Community 207 - "Community 207"
Cohesion: 0.52
Nodes (6): closeRecepcion(), confirmRecepcion(), createRecepcion(), getOptionalIdempotencyKey(), mapErrorStatus(), updateRecepcionLineas()

### Community 208 - "Community 208"
Cohesion: 0.52
Nodes (6): getLevelByPoints(), getPointsFromUserData(), LEVELS, normalizePoints(), syncUserLevelOnPointsChange, toFiniteNumber()

### Community 211 - "Community 211"
Cohesion: 0.29
Nodes (3): docUpdate, mockedAuth, mockedFirestore

### Community 212 - "Community 212"
Cohesion: 0.33
Nodes (6): RefundState, FAILED, NONE, PROCESSING, REQUESTED, SUCCEEDED

### Community 215 - "Community 215"
Cohesion: 0.33
Nodes (4): DocData, getStockBySizeMock, QueryFilter, updateStockMock

### Community 216 - "Community 216"
Cohesion: 0.67
Nodes (3): getOptionalIdempotencyKey(), registerAdjustment(), registerMovement()

### Community 217 - "Community 217"
Cohesion: 0.50
Nodes (3): AuthedRequest, checkInRacha(), getRacha()

### Community 218 - "Community 218"
Cohesion: 0.50
Nodes (3): mockAssertAiConfig, mockOnDocumentCreated, mockProcessQueuedJob

### Community 221 - "Community 221"
Cohesion: 0.67
Nodes (3): engines, node, npm

## Knowledge Gaps
- **1694 isolated node(s):** `RecomendacionPesoEstrategia`, `TrackEventInput`, `ActualizarPagoDTO`, `PaymentPricingSnapshotItem`, `PaymentPricingSnapshotShipping` (+1689 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 2230 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **27 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `RolUsuario` connect `Community 5` to `Community 128`, `Community 1`, `Community 2`, `Community 3`, `Community 136`, `Community 9`, `Community 12`, `Community 14`, `Community 23`, `Community 29`, `Community 31`, `Community 160`, `Community 33`, `Community 35`, `Community 36`, `Community 37`, `Community 39`, `Community 42`, `Community 43`, `Community 47`, `Community 54`, `Community 55`, `Community 186`, `Community 189`, `Community 62`, `Community 191`, `Community 64`, `Community 65`, `Community 67`, `Community 74`, `Community 206`, `Community 81`, `Community 87`, `Community 92`, `Community 97`, `Community 99`, `Community 100`, `Community 101`, `Community 116`, `Community 121`, `Community 127`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **What connects `RecomendacionPesoEstrategia`, `TrackEventInput`, `ActualizarPagoDTO` to the rest of the system?**
  _1694 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.037977579501258296 - nodes in this community are weakly interconnected._
- **Why does `firestoreTienda` connect `Community 22` to `Community 128`, `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 0`, `Community 7`, `Community 10`, `Community 140`, `Community 144`, `Community 17`, `Community 18`, `Community 20`, `Community 149`, `Community 24`, `Community 25`, `Community 33`, `Community 163`, `Community 35`, `Community 36`, `Community 169`, `Community 49`, `Community 50`, `Community 54`, `Community 186`, `Community 188`, `Community 60`, `Community 66`, `Community 67`, `Community 70`, `Community 72`, `Community 83`, `Community 89`, `Community 94`, `Community 95`, `Community 96`, `Community 104`, `Community 105`, `Community 106`, `Community 109`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.04180602006688963 - nodes in this community are weakly interconnected._
- **Why does `firestoreApp` connect `Community 31` to `Community 130`, `Community 134`, `Community 6`, `Community 14`, `Community 16`, `Community 146`, `Community 24`, `Community 27`, `Community 156`, `Community 160`, `Community 37`, `Community 59`, `Community 62`, `Community 63`, `Community 64`, `Community 65`, `Community 67`, `Community 70`, `Community 71`, `Community 74`, `Community 75`, `Community 77`, `Community 79`, `Community 81`, `Community 211`, `Community 84`, `Community 94`, `Community 95`, `Community 97`, `Community 100`, `Community 113`, `Community 116`, `Community 117`, `Community 118`, `Community 119`, `Community 120`, `Community 123`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.04049247606019152 - nodes in this community are weakly interconnected._
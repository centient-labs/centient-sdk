/**
 * @centient/sdk - TypeScript SDK for Engram Memory Server
 *
 * A typed client for AI agent memory operations.
 *
 * @example
 * ```typescript
 * import { EngramClient, createEngramClient } from "@centient/sdk";
 *
 * // Create client from environment variables
 * const client = createEngramClient();
 *
 * // Or with explicit config
 * const client = new EngramClient({
 *   baseUrl: "http://localhost:3100",
 *   apiKey: "your-api-key",
 * });
 *
 * // Create a session
 * const session = await client.createSession({
 *   sessionId: "2026-01-17-feature-work",
 *   projectPath: "/path/to/project",
 *   embeddingPreset: "balanced",
 * });
 *
 * // Save notes
 * await client.createNote(session.id, {
 *   type: "decision",
 *   content: "Using PostgreSQL with RLS for multi-tenant data isolation",
 * });
 *
 * // Search session memory
 * const results = await client.search(session.id, {
 *   query: "database security",
 *   limit: 5,
 * });
 * ```
 *
 * @packageDocumentation
 */

// Client
export { EngramClient, createEngramClient } from "./client.js";

// Resources (Knowledge API - for engram)
export {
  BaseResource,
  // Agent identity management (P17 multi-agent shared memory)
  AgentsResource,
  type AgentIdentity,
  type CreateAgentParams,
  type UpdateAgentParams,
  type ListAgentsParams,
  // Ambient context (role-biased ambient knowledge)
  AmbientContextResource,
  type AmbientCrystal,
  type GetAmbientContextParams,
  SessionsResource,
  SessionNotesResource,
  SessionScratchResource,
  NotesResource,
  EdgesResource,
  // Session coordination resources (ADR-028 Stage 3)
  SessionConstraintsResource,
  SessionDecisionPointsResource,
  SessionBranchesResource,
  SessionNoteEdgesResource,
  SessionStuckDetectionsResource,
  SessionLinksResource,
  // Crystals resource (curated knowledge collections)
  CrystalsResource,
  CrystalItemsResource,
  CrystalVersionsResource,
  CrystalHierarchyResource,
  type LocalSession,
  type LocalSessionNote,
  type LifecycleStatus,
  type NoteEmbeddingStatus,
  type LocalSearchResult,
  type SessionScratch,
  type CreateLocalSessionParams,
  type UpdateLocalSessionParams,
  type ListLocalSessionsParams,
  type CreateLocalNoteParams,
  type UpdateLocalNoteParams,
  type ListLocalNotesParams,
  type SearchLocalNotesParams,
  type CreateScratchParams,
  type UpdateScratchParams,
  type ListScratchParams,
  type FinalizeSessionOptions,
  type FinalizeSessionResult,
  // Session coordination types (ADR-028 Stage 3)
  type SessionConstraint,
  type ConstraintViolation,
  type DecisionPoint,
  type DecisionPointWithBranches,
  type ExplorationBranch,
  type BranchTreeNode,
  type SessionNoteEdge,
  type NoteTraversalResult,
  type StuckDetection,
  type SessionLink,
  type CreateConstraintParams,
  type UpdateConstraintParams,
  type ListConstraintsParams,
  type CreateDecisionPointParams,
  type UpdateDecisionPointParams,
  type ListDecisionPointsParams,
  type CreateBranchParams,
  type UpdateBranchParams,
  type CloseBranchParams,
  type ListBranchesParams,
  type CreateNoteEdgeParams,
  type ListNoteEdgesParams,
  type TraverseNotesParams,
  type CreateStuckDetectionParams,
  type ResolveStuckDetectionParams,
  type ListStuckDetectionsParams,
  type CreateSessionLinkParams,
  type ListSessionLinksParams,
  // Export/Import resource (ADR-042 crystal export/import fidelity)
  ExportImportResource,
  type ExportScope,
  type ExportEntityType,
  type ExportFilter,
  type ExportParams,
  type ExportEstimate,
  type ConflictResolution,
  type ImportOptions,
  type ImportConflict,
  type ImportPreview,
  type ImportResult,
  // Terrafirma resources (ADR-049 filesystem sync)
  TerrafirmaResource,
  TerrafirmaMigrationsResource,
  type TerrafirmaMode,
  type ProcessStatus,
  type TerrafirmaSyncStatus,
  type MigrationStatus,
  type SyncScope,
  type TerrafirmaWatcherStatus,
  type TerrafirmaReconcilerStatus,
  type TerrafirmaSyncCounts,
  type TerrafirmaSuggestedAction,
  type TerrafirmaStatus,
  type CrystalMembershipInfo,
  type FileConflictInfo,
  type TerrafirmaFileInfo,
  type ListFilesParams,
  type LinkedCrystalInfo,
  type TerrafirmaFileEntry,
  type ListFilesResult,
  type StartMigrationOptions,
  type MigrationStartResult,
  type MigrationError,
  type MigrationCurrentStatus,
  type TriggerSyncOptions,
  type SyncResult,
  // Real-time event streaming (P19)
  EventsResource,
  type EngramEventType,
  type BaseEngramStreamEvent,
  type EngramStreamEventCallback,
  type EventSubscription,
  // Entity extraction resources (entity-extraction phases)
  EntitiesResource,
  ExtractionResource,
  EntityClass,
  EntityReviewAction,
  ExtractionJobStatus,
  type EntityCard,
  type EntityEdge,
  type EntityWithEdges,
  type EntityMention,
  type EntityRelationship,
  type EntityReviewResult,
  type ExtractionJob,
  type ExtractionStats,
  type ExtractionConfig,
  type ListEntitiesParams,
  type ExtractParams,
  // Facts resource (bi-temporal facts)
  FactsResource,
  type Fact,
  type CreateFactParams,
  type UpdateFactParams,
  type FactHistoryParams,
  // Memory spaces resource (P17 multi-agent shared memory)
  MemorySpacesResource,
  type MemorySpacePermission,
  type MemorySpace,
  type MemorySpaceWithMembers,
  type MemorySpaceMember,
  type CreateMemorySpaceParams,
  type ListMemorySpacesParams,
  type JoinMemorySpaceParams,
  // Users resource
  UsersResource,
  type User,
  type ApiKey,
  type CreateUserParams,
  // Audit resource
  AuditResource,
  type AuditLevel,
  type AuditOutcome,
  type AuditEventType,
  type AuditEvent,
  type IngestEventParams,
  type ListAuditEventsParams,
  type AuditStats,
  // Sync resource (ADR-011 instance-to-instance sync)
  SyncResource,
  SyncPeersResource,
  type SyncPeer,
  type SyncConflict,
  type SyncStatus,
  type CreatePeerParams,
  type SyncPullParams,
  type SyncPushResult,
  type ListConflictsParams,
  type SyncChange,
  // GC resource
  GcResource,
  type GcCandidate,
  type GcAuditEntry,
  type GcRunResult,
  type ListGcCandidatesParams,
  type ListGcAuditParams,
  // Maintenance resource
  MaintenanceResource,
  type MaintenanceParams,
  type TombstoneCleanupResult,
  type ChangelogCompactResult,
} from "./resources/index.js";

// Server version compatibility
export { MIN_SERVER_VERSION } from "./client.js";

// Unified Knowledge Crystal Types (ADR-055 — primary)
export type {
  NodeType,
} from "./types/node-type.js";

export type {
  // Core entity
  KnowledgeCrystal,
  TrashedCrystal,
  NodeVisibility,
  EmbeddingStatus,
  MembershipAddedBy,
  ContentRef,
  // CRUD params
  CreateKnowledgeCrystalParams,
  UpdateKnowledgeCrystalParams,
  ListKnowledgeCrystalsParams,
  SearchKnowledgeCrystalsParams,
  KnowledgeCrystalSearchResult,
  RankedCrystalSearchResult,
  CrystalSearchWithRerankingResult,
  // Crystal sub-resource types
  CrystalMembership,
  CrystalItem,
  AddCrystalItemParams,
  ListCrystalItemsParams,
  CrystalVersion,
  CreateCrystalVersionParams,
  ListCrystalVersionsParams,
  // Hierarchy types (ADR-031)
  ContainedCrystal,
  ParentCrystal,
  CrystalHierarchy,
  CycleDetectedError,
  AddChildCrystalParams,
  ListHierarchyParams,
  ScopedSearchParams,
  ScopedSearchResult,
} from "./types/knowledge-crystal.js";

export type {
  // Core edge type
  KnowledgeCrystalEdgeRelationship,
  KnowledgeCrystalEdge,
  CreateKnowledgeCrystalEdgeParams,
  UpdateKnowledgeCrystalEdgeParams,
  ListKnowledgeCrystalEdgesParams,
} from "./types/knowledge-crystal-edge.js";

// Reranking Types (ADR-retrieval-reranking)
export type {
  RerankingStrategy,
  RerankingConfig,
  RerankingContextBudget,
  RerankingBoosts,
  RerankCandidate,
  RerankRequest,
  RerankResponse,
  RerankingMetadata,
  RerankingBudgetUsage,
  DiagnosticRerankInfo,
  RankedSearchResult,
} from "./types/reranking.js";

// Errors
export {
  EngramError,
  NotFoundError,
  SessionExistsError,
  ValidationFailedError,
  UnauthorizedError,
  NetworkError,
  TimeoutError,
  InternalError,
} from "./errors.js";

// Types
export type {
  // Enums
  NoteType,
  EmbeddingPreset,
  ConstraintScope,
  ConstraintDetectedFrom,
  HealthStatus,
  ErrorCode,

  // Session
  CreateSessionRequest,
  Session,
  SessionDetails,
  SessionSummary,
  SessionsListResponse,

  // Notes
  NoteRelationships,
  CreateNoteRequest,
  Note,
  NotesListResponse,

  // Search
  SearchRequest,
  SearchResult,
  SearchResponse,

  // Drift
  DriftLevel,
  DriftAnalysis,
  DriftHistoryEntry,
  PerTypeAnalysis,
  PrefixSuffixStats,
  DriftResponse,

  // Constraints
  ConstraintStatus,
  CreateConstraintRequest,
  Constraint,
  ConstraintsListResponse,
  CheckViolationRequest,
  ViolationScores,
  Violation,
  CheckViolationResponse,

  // Relationships
  RelationshipType,
  AddRelationshipRequest,
  AddRelationshipResponse,
  RelatedNote,
  CausalChainResponse,

  // Duplicate Check
  CheckDuplicateRequest,
  DuplicateMatch,
  CheckDuplicateResponse,

  // Health
  HealthResponse,
  DependencyHealth,
  CircuitBreakerStats,
  RateLimiterStats,
  DetailedHealthResponse,

  // Memory Bank
  MemoryType,
  Memory,
  MemoryBankProject,
  MemorySearchOptions,
  CrossProjectSearchResult,
  SearchMemoryBankRequest,
  SearchMemoryBankResponse,
  ListMemoriesOptions,
  ListMemoriesResponse,
  PushToMemoryBankRequest,
  PushToMemoryBankResponse,

  // Patterns
  PatternCategory,
  SearchPatternsOptions,
  PatternSummary,
  SearchPatternsResponse,
  Pattern,
  PatternOutcome,
  TrackPatternUsageRequest,
  TrackPatternUsageResponse,

  // Retrieval
  RetrievalRequest,
  RetrievalSource,
  RetrievalResponse,
  ExpandQueryRequest,
  ExpandQueryResponse,
  SynthesizeRequest,
  SynthesizeResponse,

  // Graph
  GraphQueryType,
  GraphQueryFilters,
  GraphQueryRequest,
  GraphNode,
  GraphEdge,
  GraphQueryResponse,
  CreateGraphRelationshipRequest,
  CreateGraphRelationshipResponse,
  SessionRelationshipType,
  LinkSessionsRequest,
  LinkSessionsResponse,

  // Lifecycle & Promotion (ADR-050)
  SearchKnowledgeScope,
  PromotionSummary,

  // Errors
  ApiError,
  ValidationError,

  // Config
  EngramClientConfig,

  // Curator (Knowledge Ingestion)
  TrustLevel,
  SourceType,
  MarkdownSourceConfig,
  TextSourceConfig,
  JsonSourceConfig,
  ManualSourceConfig,
  SourceConfig,
  KnowledgeSource,
  AddSourceRequest,
  AddSourceResponse,
  ListSourcesResponse,
  GetSourceResponse,
  IngestRequest,
  IngestStats,
  IngestResponse,
  ManualIngestRequest,
  ManualIngestResponse,
  CuratorStats,
  CuratorStatsResponse,
  CuratorConfig,
  CuratorConfigResponse,

  // Advisor (Proactive Assistance)
  ActivityType,
  AlertTrigger,
  AlertPriority,
  TaskContext,
  AnalyzeTaskRequest,
  TaskAnalysis,
  ScoredKnowledge,
  Suggestion,
  Alert,
  ProactiveAnalysis,
  AnalyzeTaskResponse,
  GetContextResponse,
  SuggestRequest,
  SuggestResponse,
  Decision,
  IdentifyGapsRequest,
  KnowledgeGap,
  IdentifyGapsResponse,
  CreateAlertRequest,
  CreateAlertResponse,
  ListAlertsResponse,
  GetConsiderationsRequest,
  Consideration,
  GetConsiderationsResponse,
  AdvisorFeedbackRequest,
  AdvisorFeedbackResponse,

  // Brain (Unified Knowledge Layer)
  KnowledgeType,
  BrainTrustLevel,
  SearchFilters,
  BrainSearchRequest,
  BrainSearchResult,
  BrainSearchResponse,
  TaskHistoryItem,
  BrainContextRequest,
  BrainTaskContext,
  BrainContextResponse,
  UsageAction,
  UsageOutcome,
  TrackUsageRequest,
  TrackUsageResponse,
  UsageStats,
  GetUsageStatsResponse,
  BrainEvolveRequest,
  EvolutionResult,
  BrainEvolveResponse,
  BrainHealth,
  BrainHealthResponse,
  BrainStatsResponse,
  BrainConfig,
  BrainConfigResponse,

  // Engagement (Pipeline Orchestration)
  PipelineOptions,
  BeginTaskRequest,
  EngagementTask,
  BeginTaskResponse,
  GetTaskContextRequest,
  EngagementContext,
  GetTaskContextResponse,
  SuggestionFeedback,
  EndTaskRequest,
  EndTaskResponse,
  EngagementFeedbackRequest,
  EngagementFeedbackResponse,
  EvolutionTrigger,
  TriggerEvolutionRequest,
  EngagementEvolutionResult,
  TriggerEvolutionResponse,
  EngagementStatus,
  GetEngagementStatusResponse,

  // Admin
  RedisHealth,
  AdminStatsResponse,

  // Projects & Artifacts (ADR-020)
  ProjectIdentity,
  ProjectManifest,
  ArtifactType,
  ArtifactMetadata,
  Artifact,
  RegisterProjectRequest,
  RegisterProjectResponse,
  UploadArtifactRequest,
  UploadArtifactResponse,
  ListArtifactsResponse,
  DownloadArtifactResponse,
  SyncArtifactsRequest,
  SyncArtifactsResponse,

  // Project Linking (Git-Aware Auto-Registration)
  LinkedProject,
  ProjectSuggestion,
  ProjectLookupResponse,
  ProjectSearchResponse,
  LinkProjectRequest,
  LinkProjectResponse,

  // Embeddings (API Proxy)
  EmbeddingModule,
  EmbeddingRequest,
  EmbeddingResponse,
  BatchEmbeddingRequest,
  BatchEmbeddingResponse,
  EmbeddingInfoResponse,

  // Vectors (API Proxy)
  VectorSearchRequest,
  VectorSearchResult,
  VectorSearchResponse,
  VectorUpsertRequest,
  VectorUpsertResponse,
  VectorDeleteRequest,
  VectorDeleteResponse,
  VectorScrollRequest,
  VectorScrollResponse,
  VectorGetRequest,
  VectorGetResponse,
  CreatePayloadIndexRequest,
  CreatePayloadIndexResponse,
  SetPayloadRequest,
  SetPayloadResponse,
  VectorCountRequest,
  VectorCountResponse,

  // Collections (API Proxy)
  CreateCollectionRequest,
  CreateCollectionResponse,
  CollectionInfo,
  ListCollectionsResponse,
  UpdateCollectionRequest,
  UpdateCollectionResponse,
  DeleteCollectionResponse,

  // Chat/LLM (API Proxy)
  ChatRole,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionChoice,
  ChatCompletionResponse,
  ChatStreamChunk,
  ChatStreamEvent,

  // Secrets
  SecretProvider,
  SecretEntry,
  KnownSecret,
  ListSecretsResponse,
  GetSecretResponse,
  SetSecretRequest,
  SetSecretResponse,
  DeleteSecretResponse,
  ValidateSecretResponse,

  // Coherence Types (P09 — Ingestion-Time Coherence)
  CoherenceMode,
  CoherenceStatus,
  CoherenceOutcome,
  CoherenceConflictType,
  CoherenceProposedAction,
  CoherenceSeverity,
  ContradictionDescriptor,
  CoherenceResolutionRecommendation,
  StalenessIndicator,
  CoherenceEvaluationMetadata,
  CoherenceResult,
  CoherenceConflictRecord,
} from "./types.js";

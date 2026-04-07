/**
 * Resource exports for engram SDK
 */

export { BaseResource } from "./base.js";

// Agents resource (P17 multi-agent shared memory)
export {
  AgentsResource,
  type AgentIdentity,
  type CreateAgentParams,
  type UpdateAgentParams,
  type ListAgentsParams,
} from "./agents.js";

// Ambient context resource (role-biased ambient knowledge)
export {
  AmbientContextResource,
  type AmbientCrystal,
  type GetAmbientContextParams,
} from "./ambient-context.js";
export {
  SessionsResource,
  SessionNotesResource,
  SessionScratchResource,
  NotesResource,
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
} from "./sessions.js";
export { EdgesResource } from "./edges.js";
export {
  CrystalsResource,
  CrystalItemsResource,
  CrystalVersionsResource,
  CrystalHierarchyResource,
} from "./crystals.js";

// Session coordination resources (ADR-028 Stage 3)
export {
  SessionConstraintsResource,
  SessionDecisionPointsResource,
  SessionBranchesResource,
  SessionNoteEdgesResource,
  SessionStuckDetectionsResource,
  SessionLinksResource,
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
} from "./session-coordination.js";

// Export/Import resource (ADR-042 crystal export/import fidelity)
export {
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
} from "./export-import.js";

// Entity extraction resources
export {
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
} from "./entities.js";

// Real-time event streaming (P19)
export {
  EventsResource,
  type EngramEventType,
  type BaseEngramStreamEvent,
  type EngramStreamEventCallback,
  type EventSubscription,
} from "./events.js";

// Terrafirma resources (ADR-049 filesystem sync)
export {
  TerrafirmaResource,
  TerrafirmaMigrationsResource,
  type TerrafirmaMode,
  type ProcessStatus,
  type SyncStatus as TerrafirmaSyncStatus,
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
} from "./terrafirma.js";

// Facts resource (bi-temporal facts)
export {
  FactsResource,
  type Fact,
  type CreateFactParams,
  type UpdateFactParams,
  type FactHistoryParams,
} from "./facts.js";

// Memory spaces resource (P17 multi-agent shared memory)
export {
  MemorySpacesResource,
  type MemorySpacePermission,
  type MemorySpace,
  type MemorySpaceWithMembers,
  type MemorySpaceMember,
  type CreateMemorySpaceParams,
  type ListMemorySpacesParams,
  type JoinMemorySpaceParams,
} from "./memory-spaces.js";

// Users resource
export {
  UsersResource,
  type User,
  type ApiKey,
  type CreateUserParams,
} from "./users.js";

// Audit resource
export {
  AuditResource,
  type AuditLevel,
  type AuditOutcome,
  type AuditEventType,
  type AuditEvent,
  type IngestEventParams,
  type ListAuditEventsParams,
  type AuditStats,
} from "./audit.js";

// Sync resource (ADR-011 instance-to-instance sync)
export {
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
} from "./sync.js";

// GC resource
export {
  GcResource,
  type GcCandidate,
  type GcAuditEntry,
  type GcRunResult,
  type ListGcCandidatesParams,
  type ListGcAuditParams,
} from "./gc.js";

// Maintenance resource
export {
  MaintenanceResource,
  type MaintenanceParams,
  type TombstoneCleanupResult,
  type ChangelogCompactResult,
} from "./maintenance.js";

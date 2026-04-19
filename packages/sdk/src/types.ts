/**
 * TypeScript types for Engram Memory Server API
 * Generated from OpenAPI 3.1 specification
 */

// ============================================
// Enums
// ============================================

/**
 * Canonical note type for session memory entries.
 *
 * Each note saved to a session is classified by one of these types,
 * which determines how the note is indexed, searched, and surfaced.
 *
 * - `"decision"` - A decision made during the session with rationale
 * - `"hypothesis"` - A working hypothesis being tested or explored
 * - `"blocker"` - An impediment or blocking issue encountered
 * - `"learning"` - A lesson learned or insight gained
 * - `"pattern"` - A reusable pattern identified during work
 * - `"finding"` - A research result, optionally with verification tracking
 * - `"prior_knowledge"` - Auto-generated from archive seeding of previous sessions
 * - `"decision_point"` - Marks an exploration branch point where alternatives diverge
 * - `"branch"` - Tracks an alternative exploration path from a decision point
 */
export type NoteType =
  | "decision"
  | "hypothesis"
  | "blocker"
  | "learning"
  | "pattern"
  | "finding"
  | "prior_knowledge"
  | "decision_point"
  | "branch";

export type EmbeddingPreset = "stable" | "responsive" | "balanced" | "ttt";

export type ConstraintScope = "session" | "task" | "file";

export type ConstraintDetectedFrom = "auto" | "explicit";

export type HealthStatus = "ok" | "degraded" | "unhealthy";

// ============================================
// Session Types
// ============================================

export interface CreateSessionRequest {
  sessionId: string;
  projectPath: string;
  embeddingPreset?: EmbeddingPreset;
  seedTopic?: string;
}

export interface Session {
  id: string;
  projectPath: string;
  collectionName: string;
  embeddingPreset: EmbeddingPreset;
  createdAt: string;
  seeding?: {
    knowledge?: {
      query: string;
      count: number;
    };
  };
}

export interface SessionDetails {
  id: string;
  projectPath: string;
  collectionName: string;
  stats: {
    totalNotes: number;
    notesByType: Record<NoteType, number>;
  };
  embedding?: {
    noteCount: number;
    hasEmbedding: boolean;
  };
}

export interface SessionSummary {
  id: string;
  projectPath: string;
  collectionName: string;
  stats: {
    totalNotes: number;
    notesByType: Record<string, number>;
  };
}

export interface SessionsListResponse {
  sessions: SessionSummary[];
  total: number;
}

// ============================================
// Note Types
// ============================================

export interface NoteRelationships {
  preceded_by?: number[];
  caused_by?: number[];
  validated_by?: number[];
  related_to?: number[];
}

export interface CreateNoteRequest {
  type: NoteType;
  content: string;
  metadata?: Record<string, unknown>;
  relationships?: NoteRelationships;
}

export type DriftLevel = "none" | "low" | "medium" | "high" | "extreme";

export interface DriftAnalysis {
  similarity: number;
  driftLevel: DriftLevel;
  isAnomalous: boolean;
  suggestion?: string;
}

export interface Note {
  id: number;
  type: NoteType;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  drift?: DriftAnalysis | null;
  partition?: "prefix" | "suffix";
}

export interface NotesListResponse {
  notes: Note[];
  total: number;
}

// ============================================
// Search Types
// ============================================

export interface SearchRequest {
  query: string;
  limit?: number;
  includeRelationships?: boolean;
}

export interface SearchResult {
  id: number;
  type: NoteType;
  content: string;
  score: number;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  took: number;
}

// ============================================
// Drift Types
// ============================================

export interface DriftHistoryEntry {
  noteIndex: number;
  type: NoteType;
  drift: number;
  timestamp: string;
}

export interface PerTypeAnalysis {
  type: NoteType;
  count: number;
  averageDrift: number;
  maxDrift: number;
}

export interface PrefixSuffixStats {
  prefixSize: number;
  suffixSize: number;
  prefixWeight: number;
  suffixWeight: number;
}

export interface DriftResponse {
  sessionId: string;
  noteCount: number;
  totalWeight: number;
  averageSimilarity: number;
  prefixSuffix: PrefixSuffixStats;
  history?: DriftHistoryEntry[];
  perTypeAnalysis?: PerTypeAnalysis[];
}

// ============================================
// Constraint Types
// ============================================

export type ConstraintStatus = "active" | "lifted";

export interface CreateConstraintRequest {
  content: string;
  detectedFrom?: ConstraintDetectedFrom;
  scope?: ConstraintScope;
  keywords?: string[];
}

export interface Constraint {
  id: string;
  content: string;
  detectedFrom: ConstraintDetectedFrom;
  scope: ConstraintScope;
  keywords: string[];
  timestamp: string;
  status: ConstraintStatus;
  violatedCount: number;
  metadata?: Record<string, unknown>;
}

export interface ConstraintsListResponse {
  constraints: Constraint[];
}

export interface CheckViolationRequest {
  proposedAction: string;
}

export interface ViolationScores {
  semantic: number;
  keyword: number;
  rrf: number;
}

export interface Violation {
  constraint: Constraint;
  severity: "high" | "medium" | "low";
  reason: string;
  scores: ViolationScores;
}

export interface CheckViolationResponse {
  violated: boolean;
  violations: Violation[];
}

// ============================================
// Relationship Types
// ============================================

export type RelationshipType =
  | "preceded_by"
  | "caused_by"
  | "validated_by"
  | "related_to"
  | "superseded_by";

export interface AddRelationshipRequest {
  targetNoteId: number;
  relationship: RelationshipType;
}

export interface AddRelationshipResponse {
  success: boolean;
  sourceNoteId: number;
  targetNoteId: number;
  relationship: RelationshipType;
}

export interface RelatedNote extends SearchResult {
  relationship: string;
}

export interface CausalChainResponse {
  chain: Array<SearchResult & { depth: number; relationship: string }>;
  startNoteId: number;
  maxDepth: number;
}

// ============================================
// Duplicate Check Types
// ============================================

export interface CheckDuplicateRequest {
  description: string;
  threshold?: number;
}

export interface DuplicateMatch {
  id: number;
  content: string;
  type: NoteType;
  similarity: number;
}

export interface CheckDuplicateResponse {
  hasDuplicates: boolean;
  duplicates: DuplicateMatch[];
}

// ============================================
// Health Types
// ============================================

export interface HealthResponse {
  status: HealthStatus;
  version: string;
}

export interface DependencyHealth {
  status: HealthStatus;
  latencyMs?: number;
  lastChecked: string;
  error?: string;
}

export interface CircuitBreakerStats {
  state: "closed" | "open" | "half-open";
  failures: number;
  successes: number;
  lastFailure?: string;
}

export interface RateLimiterStats {
  tokens: number;
  maxTokens: number;
  refillRate: number;
  lastRefill: string;
}

export interface DetailedHealthResponse {
  status: HealthStatus;
  version: string;
  uptime: number;
  dependencies: Record<string, DependencyHealth>;
  circuitBreakers: Record<string, CircuitBreakerStats>;
  rateLimiters: Record<string, RateLimiterStats>;
}

// ============================================
// Lifecycle & Promotion Types (ADR-050)
// ============================================

export type SearchKnowledgeScope = "items" | "patterns" | "crystals";

export interface PromotionSummary {
  totalNotesEvaluated: number;
  promoted: number;
  flaggedForReview: number;
  archived: number;
  topPromotions: Array<{ type: string; content: string; score: number }>;
  averageScore: number;
}

// ============================================
// Error Types
// ============================================

export type ErrorCode =
  // ADR-004: Validation
  | "VALIDATION_INPUT_MISSING"
  | "VALIDATION_INPUT_INVALID"
  | "VALIDATION_FORMAT_JSON"
  | "VALIDATION_FORMAT_DATE"
  | "VALIDATION_RANGE_LIMIT"
  | "VALIDATION_TYPE_MISMATCH"
  // ADR-004: Resource
  | "RESOURCE_SESSION_NOT_FOUND"
  | "RESOURCE_SESSION_EXISTS"
  | "RESOURCE_SESSION_EXPIRED"
  | "RESOURCE_PATTERN_NOT_FOUND"
  | "RESOURCE_SKILL_NOT_FOUND"
  | "RESOURCE_DECISION_NOT_FOUND"
  | "RESOURCE_CONSTRAINT_NOT_FOUND"
  | "RESOURCE_CONSTRAINT_EXISTS"
  | "RESOURCE_PLAN_NOT_FOUND"
  | "RESOURCE_VERSION_NOT_FOUND"
  | "RESOURCE_CRYSTAL_NOT_FOUND"
  | "RESOURCE_BRANCH_NOT_FOUND"
  | "RESOURCE_BRANCH_EXPIRED"
  | "RESOURCE_CHANNEL_NOT_FOUND"
  | "RESOURCE_TRAIL_NOT_FOUND"
  // ADR-004: Operation
  | "OPERATION_SEARCH_FAILED"
  | "OPERATION_LOAD_FAILED"
  | "OPERATION_SAVE_FAILED"
  | "OPERATION_EXECUTE_FAILED"
  | "OPERATION_EXECUTE_TIMEOUT"
  | "OPERATION_INDEX_FAILED"
  | "OPERATION_EXTRACT_FAILED"
  | "OPERATION_VALIDATE_FAILED"
  | "OPERATION_AGGREGATE_FAILED"
  | "OPERATION_QUERY_FAILED"
  | "OPERATION_TRACK_FAILED"
  | "OPERATION_VERSION_FAILED"
  | "OPERATION_VERSION_CONFLICT"
  | "OPERATION_REVIEW_FAILED"
  | "OPERATION_PLAN_FAILED"
  // ADR-004: External
  | "EXTERNAL_QDRANT_UNAVAILABLE"
  | "EXTERNAL_QDRANT_ERROR"
  | "EXTERNAL_OPENAI_UNAVAILABLE"
  | "EXTERNAL_OPENAI_ERROR"
  | "EXTERNAL_OPENAI_RATE_LIMITED"
  | "EXTERNAL_GEMINI_UNAVAILABLE"
  | "EXTERNAL_GEMINI_ERROR"
  | "EXTERNAL_GEMINI_RATE_LIMITED"
  | "EXTERNAL_LLM_ERROR"
  // Legacy (retained for backward compatibility)
  | "NOT_FOUND"
  | "SESSION_EXISTS"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR"
  | "COHERENCE_CONTRADICTION_DETECTED";

export interface ApiError {
  code: ErrorCode;
  message: string;
}

export interface ValidationError {
  success: false;
  error: {
    issues: Array<{
      code: string;
      message: string;
      path: string[];
    }>;
    name: "ZodError";
  };
}

// ============================================
// Memory Bank Types
// ============================================

export type MemoryType = "decision" | "learning" | "finding" | "pattern";

export interface Memory {
  /** Unique identifier for the memory */
  id?: string;
  /** The extracted fact or knowledge */
  fact: string;
  /** Semantic similarity distance (lower = more similar) */
  distance: number;
  /** Human-readable name/title */
  name: string;
  /** Type of memory */
  type: string;
  /** Session where this memory was created */
  sessionId?: string;
  /** Confidence score (0-1) */
  confidence?: number;
  /** Tags for categorization */
  tags?: string[];
  /** Whether this memory is useful across all projects */
  crossProject?: boolean;
  /** Source project name (set when viewing cross-project memories) */
  sourceProject?: string;
}

/**
 * Project info for Memory Bank dropdown
 */
export interface MemoryBankProject {
  /** Project name (e.g., "centient", "privatelanguage") */
  name: string;
  /** Total number of memories in this project */
  memoryCount: number;
  /** Number of memories marked as cross-project */
  crossProjectCount: number;
}

/**
 * Options for searching memories
 */
export interface MemorySearchOptions {
  /** Search query */
  query: string;
  /** Maximum results to return */
  limit?: number;
  /** Only return memories marked as crossProject: true */
  crossProjectOnly?: boolean;
}

/**
 * Result from cross-project search
 */
export interface CrossProjectSearchResult {
  /** Memories from all projects (each has sourceProject set) */
  memories: Memory[];
  /** List of project names that were searched */
  projectsSearched: string[];
  /** Search query used */
  query: string;
  /** Time taken in ms */
  took: number;
}

export interface SearchMemoryBankRequest {
  query: string;
  projectName: string;
  topK?: number;
  /** Only return memories marked as crossProject: true */
  crossProjectOnly?: boolean;
}

export interface SearchMemoryBankResponse {
  memories: Memory[];
  query: string;
  projectName: string;
  took: number;
}

export interface ListMemoriesOptions {
  limit?: number;
}

export interface ListMemoriesResponse {
  memories: Memory[];
  projectName: string;
  total: number;
  took: number;
}

export interface PushToMemoryBankRequest {
  finalizationPackPath: string;
  dryRun?: boolean;
}

export interface PushToMemoryBankResponse {
  projectName: string;
  pushed: number;
  memories: Array<{
    type: string;
    content: string;
  }>;
  took: number;
}

// ============================================
// Pattern Types
// ============================================

export type PatternCategory =
  | "database"
  | "security"
  | "ui"
  | "backend"
  | "testing"
  | "architecture"
  | "mcp-integration";

export type PatternSearchMode = "fast" | "comprehensive";

export interface SearchPatternsOptions {
  keyword?: string;
  category?: PatternCategory;
  limit?: number;
  includeExecutable?: boolean;
}

export interface PatternSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  usageCount: number;
  successRate: number;
  tags: string[];
  score?: number;
}

export interface SearchPatternsResponse {
  patterns: PatternSummary[];
  keyword?: string;
  category?: PatternCategory;
  total: number;
  took: number;
}

export interface Pattern extends PatternSummary {
  documentation?: string;
  code?: string;
  examples?: Array<{
    input: unknown;
    expectedOutput: unknown;
  }>;
}

export type PatternOutcome = "success" | "partial" | "failure";

export interface TrackPatternUsageRequest {
  projectPath?: string;
  context?: string;
  outcome?: PatternOutcome;
  outcomeNotes?: string;
}

export interface TrackPatternUsageResponse {
  patternId: string;
  usageCount: number;
  status: string;
  took: number;
}

// ============================================
// Retrieval Types
// ============================================

export interface RetrievalRequest {
  query: string;
  sessionId?: string;
  projectName?: string;
  includePatterns?: boolean;
  maxResults?: number;
}

export interface RetrievalSource {
  type: "session" | "pattern";
  content: string;
  score: number;
}

export interface RetrievalResponse {
  answer: string;
  confidence: number;
  sources: RetrievalSource[];
  took: number;
}

export interface ExpandQueryRequest {
  query: string;
  maxExpansions?: number;
}

export interface ExpandQueryResponse {
  original: string;
  expansions: string[];
}

export interface SynthesizeRequest {
  query: string;
  results: Array<{
    content: string;
    type?: string;
    score?: number;
    source?: string;
  }>;
}

export interface SynthesizeResponse {
  answer: string;
  confidence: number;
  sources: string[];
}

// ============================================
// Graph Types
// ============================================

export type GraphQueryType =
  | "causal_chain"
  | "temporal_sequence"
  | "relevant_adjacency"
  | "evolution_path"
  | "validation_chain";

export interface GraphQueryFilters {
  maxDepth?: number;
  noteTypes?: string[];
  relationshipTypes?: string[];
  dateRange?: {
    start?: string;
    end?: string;
  };
}

export interface GraphQueryRequest {
  queryType: GraphQueryType;
  startNode?: number | string;
  sessionId: string;
  filters?: GraphQueryFilters;
}

export interface GraphNode {
  note: {
    id: number;
    type: string;
    content: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
  };
  depth: number;
  relationship: string;
}

export interface GraphEdge {
  source: number;
  target: number;
  relationship: string;
}

export interface GraphQueryResponse {
  queryType: GraphQueryType;
  nodes: GraphNode[];
  edges: GraphEdge[];
  took: number;
}

export interface CreateGraphRelationshipRequest {
  sessionId: string;
  targetNoteId: number;
  relationship: RelationshipType;
  evidence?: string;
}

export interface CreateGraphRelationshipResponse {
  success: boolean;
  sourceNoteId: number;
  targetNoteId: number;
  relationship: string;
}

export type SessionRelationshipType =
  | "builds_on"
  | "extends"
  | "supersedes"
  | "resolves_blockers_from";

export interface LinkSessionsRequest {
  sourceSession: string;
  targetSession: string;
  relationship: SessionRelationshipType;
  projectPath: string;
  evidence?: string;
}

export interface LinkSessionsResponse {
  success: boolean;
  sourceSession: string;
  targetSession: string;
  relationship: string;
}

// ============================================
// Curator Types (Knowledge Ingestion)
// ============================================

export type TrustLevel =
  | "authoritative"
  | "peer_reviewed"
  | "industry"
  | "community"
  | "unverified";

export type SourceType = "markdown" | "text" | "json" | "manual";

export interface MarkdownSourceConfig {
  type: "markdown";
  path: string;
}

export interface TextSourceConfig {
  type: "text";
  path: string;
}

export interface JsonSourceConfig {
  type: "json";
  path: string;
  contentField?: string;
}

export interface ManualSourceConfig {
  type: "manual";
  content: string;
  title?: string;
}

export type SourceConfig =
  | MarkdownSourceConfig
  | TextSourceConfig
  | JsonSourceConfig
  | ManualSourceConfig;

export interface KnowledgeSource {
  id: string;
  name: string;
  type: SourceType;
  config: SourceConfig;
  trust: TrustLevel;
  tags: string[];
  enabled: boolean;
}

export interface AddSourceRequest {
  name: string;
  type: SourceType;
  config: SourceConfig;
  trust?: TrustLevel;
  tags?: string[];
  enabled?: boolean;
}

export interface AddSourceResponse {
  id: string;
  source: KnowledgeSource;
  took: number;
}

export interface ListSourcesResponse {
  sources: KnowledgeSource[];
  total: number;
  took: number;
}

export interface GetSourceResponse {
  source: KnowledgeSource;
  took: number;
}

export interface IngestRequest {
  sourceId?: string;
  processAll?: boolean;
}

export interface IngestStats {
  documentsIngested: number;
  documentsFailed: number;
  chunksCreated: number;
  tokensProcessed: number;
}

export interface IngestResponse {
  processed: number;
  successful: number;
  failed: number;
  stats: IngestStats;
  took: number;
}

export interface ManualIngestRequest {
  content: string;
  title?: string;
  trust?: TrustLevel;
  tags?: string[];
}

export interface ManualIngestResponse {
  success: boolean;
  stats: IngestStats;
  took: number;
}

export interface CuratorStats {
  totalDocuments: number;
  totalChunks: number;
  byTrust: Record<TrustLevel, number>;
  byTag: Record<string, number>;
}

export interface CuratorStatsResponse {
  stats: CuratorStats;
  sources: {
    total: number;
    enabled: number;
  };
  took: number;
}

export interface CuratorConfig {
  domainKeywords?: string[];
  minRelevanceScore?: number;
  collectionName?: string;
}

export interface CuratorConfigResponse {
  config: CuratorConfig;
  took?: number;
}

// ============================================
// Advisor Types (Proactive Assistance)
// ============================================

export type ActivityType =
  | "task_started"
  | "decision_made"
  | "code_written"
  | "question_asked"
  | "search_performed"
  | "error_encountered"
  | "file_modified";

export type AlertTrigger =
  | "keyword_match"
  | "pattern_detected"
  | "risk_identified"
  | "opportunity_spotted"
  | "knowledge_updated";

export type AlertPriority = "high" | "medium" | "low";

export interface TaskContext {
  taskDescription: string;
  recentActivity?: string[];
  currentFiles?: string[];
  techStack?: string[];
  constraints?: string[];
}

export interface AnalyzeTaskRequest {
  task: string;
  context?: TaskContext;
}

export interface TaskAnalysis {
  complexity: "low" | "medium" | "high";
  riskAreas: string[];
  opportunities: string[];
  missingContext: string[];
}

export interface ScoredKnowledge {
  id: string;
  content: string;
  score: number;
  type: string;
}

export interface Suggestion {
  id: string;
  type: string;
  content: string;
  relevance: number;
  source?: string;
}

export interface Alert {
  id: string;
  trigger: AlertTrigger;
  priority: AlertPriority;
  message: string;
  context: string;
  timestamp: string;
  dismissed: boolean;
}

export interface ProactiveAnalysis {
  task: string;
  analysis: TaskAnalysis;
  suggestions: Suggestion[];
  alerts: Alert[];
  recommendedReading: ScoredKnowledge[];
  estimatedImpact: string;
  generatedAt: string;
}

export interface AnalyzeTaskResponse {
  analysis: ProactiveAnalysis;
  metadata: { duration: number };
  took: number;
}

export interface GetContextResponse {
  context: {
    primary: ScoredKnowledge[];
    secondary: ScoredKnowledge[];
    suggestions: Suggestion[];
  };
  metadata: { duration: number };
  took: number;
}

export interface SuggestRequest {
  sessionId: string;
  type: ActivityType;
  description: string;
  context?: Record<string, unknown>;
}

export interface SuggestResponse {
  suggestions: Suggestion[];
  metadata: { duration: number };
  took: number;
}

export interface Decision {
  id: string;
  description: string;
  rationale?: string;
  timestamp?: string;
}

export interface IdentifyGapsRequest {
  decisions: Decision[];
  concepts?: string[];
}

export interface KnowledgeGap {
  topic: string;
  severity: "high" | "medium" | "low";
  description: string;
  suggestedSources: string[];
}

export interface IdentifyGapsResponse {
  gaps: KnowledgeGap[];
  metadata: { duration: number };
  took: number;
}

export interface CreateAlertRequest {
  trigger: AlertTrigger;
  context: string;
}

export interface CreateAlertResponse {
  alert: Alert | null;
  message?: string;
  metadata?: { duration: number };
  took: number;
}

export interface ListAlertsResponse {
  alerts: Alert[];
  total: number;
  took: number;
}

export interface GetConsiderationsRequest {
  decision: string;
  alternatives?: string[];
}

export interface Consideration {
  question: string;
  relevance: number;
  relatedKnowledge?: string[];
}

export interface GetConsiderationsResponse {
  considerations: Consideration[];
  metadata: { duration: number };
  took: number;
}

export interface AdvisorFeedbackRequest {
  suggestionId: string;
  helpful: boolean;
  applied?: boolean;
  comment?: string;
}

export interface AdvisorFeedbackResponse {
  recorded: boolean;
  suggestionId: string;
  took: number;
}

// ============================================
// Brain Types (Unified Knowledge Layer)
// ============================================

export type KnowledgeType =
  | "document"
  | "chunk"
  | "concept"
  | "pattern"
  | "precedent"
  | "annotation";

export type BrainTrustLevel =
  | "authoritative"
  | "peer_reviewed"
  | "industry"
  | "community"
  | "unverified";

export interface SearchFilters {
  types?: KnowledgeType[];
  trustLevels?: BrainTrustLevel[];
  tags?: string[];
  concepts?: string[];
  minRelevance?: number;
  minQuality?: number;
  minFreshness?: number;
  dateRange?: {
    start?: string;
    end?: string;
  };
  sourceIds?: string[];
}

export interface BrainSearchRequest {
  query: string;
  filters?: SearchFilters;
  maxResults?: number;
}

export interface BrainSearchResult {
  id: string;
  type: KnowledgeType;
  content: string;
  score: number;
  trust: BrainTrustLevel;
  source?: string;
  concepts?: string[];
  metadata?: Record<string, unknown>;
}

export interface BrainSearchResponse {
  results: BrainSearchResult[];
  total: number;
  query: string;
  metadata: { duration: number };
  took: number;
}

export interface TaskHistoryItem {
  action: string;
  timestamp: string;
  outcome?: "success" | "partial" | "failure";
}

export interface BrainContextRequest {
  task: string;
  context?: string;
  techStack?: string[];
  constraints?: string[];
  history?: TaskHistoryItem[];
}

export interface BrainTaskContext {
  relevantKnowledge: BrainSearchResult[];
  concepts: string[];
  patterns: string[];
  recommendations: string[];
  warnings: string[];
}

export interface BrainContextResponse {
  context: BrainTaskContext;
  metadata: { duration: number };
  took: number;
}

export type UsageAction = "retrieved" | "cited" | "applied" | "rejected" | "validated";
export type UsageOutcome = "helpful" | "neutral" | "unhelpful" | "misleading";

export interface TrackUsageRequest {
  knowledgeId: string;
  sessionId: string;
  task: string;
  action: UsageAction;
  outcome: UsageOutcome;
  feedback?: {
    rating: number;
    comment?: string;
    improvements?: string[];
  };
}

export interface TrackUsageResponse {
  tracked: boolean;
  knowledgeId: string;
  metadata: { duration: number };
  took: number;
}

export interface UsageStats {
  totalUsage: number;
  byAction: Record<UsageAction, number>;
  byOutcome: Record<UsageOutcome, number>;
  averageRating: number;
  lastUsed: string;
}

export interface GetUsageStatsResponse {
  stats: UsageStats;
  metadata: { duration: number };
  took: number;
}

export interface BrainEvolveRequest {
  force?: boolean;
}

export interface EvolutionResult {
  conceptsUpdated: number;
  patternsDiscovered: number;
  connectionsCreated: number;
  qualityImprovements: number;
}

export interface BrainEvolveResponse {
  evolution: EvolutionResult;
  metadata: { duration: number };
  took: number;
}

export interface BrainHealth {
  totalKnowledge: number;
  freshness: number;
  coverage: number;
  qualityScore: number;
  lastEvolution: string;
  staleCount: number;
}

export interface BrainHealthResponse {
  health: BrainHealth;
  metadata: { duration: number };
  took: number;
}

export interface BrainStatsResponse {
  stats: BrainHealth;
  metadata: { duration: number };
  took: number;
}

export interface BrainConfig {
  domainId?: string;
  domainName?: string;
  primaryThreshold?: number;
  secondaryThreshold?: number;
  maxResults?: number;
  autoEvolve?: boolean;
}

export interface BrainConfigResponse {
  config: BrainConfig;
  took?: number;
}

// ============================================
// Engagement Types (Pipeline Orchestration)
// ============================================

export interface PipelineOptions {
  maxSuggestions?: number;
  minRelevance?: number;
  background?: boolean;
  timeoutMs?: number;
}

export interface BeginTaskRequest {
  sessionId: string;
  description: string;
  options?: PipelineOptions;
  metadata?: Record<string, unknown>;
}

export interface EngagementTask {
  id: string;
  sessionId: string;
  description: string;
  status: "active" | "completed" | "abandoned";
  startedAt: string;
  suggestions: Suggestion[];
  metadata?: Record<string, unknown>;
}

export interface BeginTaskResponse {
  task: EngagementTask;
  metadata: { duration: number };
  took: number;
}

export interface GetTaskContextRequest {
  options?: PipelineOptions;
}

export interface EngagementContext {
  task: EngagementTask;
  suggestions: Suggestion[];
  relevantKnowledge: ScoredKnowledge[];
}

export interface GetTaskContextResponse {
  context: EngagementContext;
  metadata: { duration: number };
  took: number;
}

export interface SuggestionFeedback {
  suggestionId: string;
  taskId: string;
  outcome: "applied" | "ignored" | "rejected";
  helpful: boolean;
  comment?: string;
  timestamp?: string;
}

export interface EndTaskRequest {
  outcome: "completed" | "abandoned";
  feedback?: SuggestionFeedback[];
}

export interface EndTaskResponse {
  ended: boolean;
  taskId: string;
  outcome: "completed" | "abandoned";
  metadata: { duration: number };
  took: number;
}

export interface EngagementFeedbackRequest {
  suggestionId: string;
  taskId: string;
  outcome: "applied" | "ignored" | "rejected";
  helpful: boolean;
  comment?: string;
}

export interface EngagementFeedbackResponse {
  recorded: boolean;
  suggestionId: string;
  metadata: { duration: number };
  took: number;
}

export type EvolutionTrigger = "scheduled" | "feedback_batch" | "task_complete" | "manual";

export interface TriggerEvolutionRequest {
  trigger: EvolutionTrigger;
}

export interface EngagementEvolutionResult {
  knowledgeUpdates: number;
  patternRefinements: number;
  effectivenessRecalculated: number;
}

export interface TriggerEvolutionResponse {
  evolution: EngagementEvolutionResult;
  metadata: { duration: number };
  took: number;
}

export interface EngagementStatus {
  activeTasks: number;
  completedTasks: number;
  totalSuggestions: number;
  feedbackCollected: number;
  lastEvolution: string;
}

export interface GetEngagementStatusResponse {
  status: EngagementStatus;
  metadata: { duration: number };
  took: number;
}

// ============================================
// Admin Types
// ============================================

export interface RedisHealth {
  connected: boolean;
  latencyMs?: number;
  lastCheck?: string;
}

export interface AdminStatsResponse {
  redis: {
    sessionCount: number;
    health: RedisHealth | null;
  };
  localCache: {
    sessionCount: number;
  };
  checkedAt: string;
}

// ============================================
// Client Configuration
// ============================================

export interface EngramClientConfig {
  /** Base URL of the Engram server (e.g., "http://localhost:3100") */
  baseUrl: string;
  /** API key for authentication */
  apiKey?: string;
  /**
   * User ID to send as X-User-ID header on all requests.
   * Used with service keys to specify which user's context the request is acting on behalf of.
   */
  userId?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Number of retry attempts for failed requests (default: 3) */
  retries?: number;
  /** Base delay between retries in ms (default: 1000) */
  retryDelay?: number;
}

// ============================================
// Project & Artifact Types (ADR-020)
// ============================================

/**
 * Project identity - used by local storage AND server
 * Project ID is a 12-char SHA-256 hash of the normalized path
 */
export interface ProjectIdentity {
  /** 12-char SHA-256 hash of normalized path */
  id: string;
  /** Directory name (e.g., "centient") */
  name: string;
  /** Normalized absolute path */
  normalizedPath: string;
  /** Original absolute path (may differ from normalized on case-insensitive filesystems) */
  originalPath: string;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last verification */
  lastVerifiedAt?: string;
}

/**
 * Artifact type enumeration
 */
export type ArtifactType = "finalization-pack" | "session-summary" | "pr-body";

/**
 * Artifact metadata - used by local AND server
 */
export interface ArtifactMetadata {
  /** UUID for server, or sessionId for local-only */
  id: string;
  /** Project ID (12-char hash) */
  projectId: string;
  /** Session ID (e.g., "2026-01-19-feature") */
  sessionId: string;
  /** Type of artifact */
  type: ArtifactType;
  /** SHA-256 hash of content for integrity verification */
  contentHash: string;
  /** ISO timestamp of creation */
  createdAt: string;
  /** Size in bytes */
  size: number;
}

/**
 * Full artifact with content
 */
export interface Artifact extends ArtifactMetadata {
  /** Content as JSON string or Markdown */
  content: string;
}

/**
 * Project manifest stored in ~/.centient/projects/{id}/manifest.json
 */
export interface ProjectManifest extends ProjectIdentity {
  /** Sessions stored in this project */
  sessions?: string[];
}

// ============================================
// Artifact API Types
// ============================================

/**
 * Request to register a project with the server
 */
export interface RegisterProjectRequest {
  /** 12-char project ID hash */
  id: string;
  /** Project name (directory name) */
  name: string;
  /** Normalized path for matching across machines */
  normalizedPath: string;
}

/**
 * Response from project registration
 */
export interface RegisterProjectResponse {
  success: boolean;
  project: ProjectIdentity;
}

/**
 * Request to upload an artifact
 */
export interface UploadArtifactRequest {
  /** Project ID */
  projectId: string;
  /** Session ID */
  sessionId: string;
  /** Artifact type */
  type: ArtifactType;
  /** Content (JSON or Markdown) */
  content: string;
}

/**
 * Response from artifact upload
 */
export interface UploadArtifactResponse {
  success: boolean;
  artifact: ArtifactMetadata;
}

/**
 * Response from listing artifacts
 */
export interface ListArtifactsResponse {
  artifacts: ArtifactMetadata[];
  total: number;
}

/**
 * Response from artifact download
 */
export interface DownloadArtifactResponse {
  success: boolean;
  artifact: Artifact;
}

/**
 * Request for syncing artifacts
 */
export interface SyncArtifactsRequest {
  /** Project ID */
  projectId: string;
  /** Direction: push (local to server), pull (server to local), or both */
  direction: "push" | "pull" | "both";
  /** Only sync artifacts newer than this timestamp */
  since?: string;
}

/**
 * Response from artifact sync
 */
export interface SyncArtifactsResponse {
  success: boolean;
  pushed: number;
  pulled: number;
  conflicts: Array<{
    artifactId: string;
    reason: string;
  }>;
}

// ============================================
// Project Linking Types (Git-Aware Auto-Registration)
// ============================================

/**
 * User-UI project with linking information
 */
export interface LinkedProject {
  /** User-UI project UUID */
  id: string;
  /** Project display name */
  name: string;
  /** URL-friendly project identifier */
  slug: string;
  /** Normalized Git remote URL (e.g., github.com/user/repo) */
  gitRemote?: string;
  /** Normalized filesystem path */
  linkedPath?: string;
  /** 12-char hash used by centient for artifact linking */
  centientProjectId?: string;
}

/**
 * Project suggestion from fuzzy search
 */
export interface ProjectSuggestion {
  /** User-UI project UUID */
  id: string;
  /** Project display name */
  name: string;
  /** URL-friendly project identifier */
  slug: string;
  /** Normalized Git remote URL */
  gitRemote?: string;
  /** Fuzzy match score (0-1) */
  similarityScore: number;
}

/**
 * Response from project identity lookup
 */
export interface ProjectLookupResponse {
  /** Matched project or null if not found */
  project: LinkedProject | null;
  /** How the project was matched */
  matchType: "git_remote" | "linked_path" | "none";
}

/**
 * Response from project fuzzy search
 */
export interface ProjectSearchResponse {
  /** List of matching projects sorted by similarity */
  suggestions: ProjectSuggestion[];
}

/**
 * Request to link a project to centient identity
 */
export interface LinkProjectRequest {
  /** Normalized filesystem path */
  linkedPath?: string;
  /** Normalized Git remote URL */
  gitRemote?: string;
  /** 12-char centient project ID hash */
  centientProjectId?: string;
}

/**
 * Response from project linking
 */
export interface LinkProjectResponse {
  /** Whether linking was successful */
  linked: boolean;
}

// ============================================
// Embedding Types (API Proxy)
// ============================================

export type EmbeddingModule = "session" | "patterns" | "memory-bank" | "search" | "retrieval";

export interface EmbeddingRequest {
  text: string;
  module?: EmbeddingModule;
}

export interface EmbeddingResponse {
  embedding: number[];
  dimensions: number;
  model: string;
  cached: boolean;
  took: number;
}

export interface BatchEmbeddingRequest {
  texts: string[];
  module?: EmbeddingModule;
}

export interface BatchEmbeddingResponse {
  embeddings: Array<{
    embedding: number[];
    dimensions: number;
    cached: boolean;
  }>;
  count: number;
  model: string;
  took: number;
}

export interface EmbeddingInfoResponse {
  available: boolean;
  model: string;
  dimensions: number;
  maxInputChars: number;
  cache: {
    size: number;
    maxSize: number;
  };
}

// ============================================
// Vector Types (API Proxy)
// ============================================

export interface VectorSearchRequest {
  collection: string;
  vector: number[];
  limit?: number;
  filter?: Record<string, unknown>;
  scoreThreshold?: number;
  withPayload?: boolean;
  withVector?: boolean;
}

export interface VectorSearchResult {
  id: string | number;
  score: number;
  payload?: Record<string, unknown>;
  vector?: number[];
}

export interface VectorSearchResponse {
  results: VectorSearchResult[];
  collection: string;
  took: number;
}

export interface VectorUpsertRequest {
  collection: string;
  points: Array<{
    id: string | number;
    vector: number[];
    payload?: Record<string, unknown>;
  }>;
  wait?: boolean;
}

export interface VectorUpsertResponse {
  upserted: number;
  collection: string;
  took: number;
}

export interface VectorDeleteRequest {
  collection: string;
  ids: Array<string | number>;
  wait?: boolean;
}

export interface VectorDeleteResponse {
  deleted: number;
  collection: string;
  took: number;
}

export interface VectorScrollRequest {
  collection: string;
  limit?: number;
  offset?: string | number;
  filter?: Record<string, unknown>;
  withPayload?: boolean;
  withVector?: boolean;
}

export interface VectorScrollResponse {
  points: Array<{
    id: string | number;
    payload?: Record<string, unknown>;
    vector?: number[];
  }>;
  nextOffset?: string | number;
  collection: string;
  took: number;
}

export interface VectorGetRequest {
  collection: string;
  ids: Array<string | number>;
  withPayload?: boolean;
  withVector?: boolean;
}

export interface VectorGetResponse {
  points: Array<{
    id: string | number;
    payload?: Record<string, unknown>;
    vector?: number[];
  }>;
  collection: string;
  took: number;
}

export interface CreatePayloadIndexRequest {
  collection: string;
  fieldName: string;
  fieldSchema: "keyword" | "integer" | "float" | "bool" | "geo" | "datetime" | "text";
}

export interface CreatePayloadIndexResponse {
  created: boolean;
  exists?: boolean;
  collection: string;
  fieldName: string;
  fieldSchema?: string;
  took: number;
}

export interface SetPayloadRequest {
  collection: string;
  payload: Record<string, unknown>;
  points: Array<string | number>;
}

export interface SetPayloadResponse {
  updated: number;
  collection: string;
  took: number;
}

export interface VectorCountRequest {
  collection: string;
  filter?: Record<string, unknown>;
  exact?: boolean;
}

export interface VectorCountResponse {
  count: number;
  collection: string;
  took: number;
}

// ============================================
// Collection Types (API Proxy)
// ============================================

export interface CreateCollectionRequest {
  name: string;
  vectorSize?: number;
  distance?: "Cosine" | "Euclid" | "Dot";
  onDiskPayload?: boolean;
  replicationFactor?: number;
  shardNumber?: number;
}

export interface CreateCollectionResponse {
  created: boolean;
  name: string;
  vectorSize: number;
  distance: string;
  took: number;
}

export interface CollectionInfo {
  name: string;
  status: string;
  pointsCount: number;
  vectorsCount: number;
  segmentsCount: number;
  config: {
    vectorSize?: number;
    distance?: string;
    onDiskPayload?: boolean;
    replicationFactor?: number;
    shardNumber?: number;
  };
  took: number;
}

export interface ListCollectionsResponse {
  collections: Array<{ name: string }>;
  total: number;
  took: number;
}

export interface UpdateCollectionRequest {
  optimizersConfig?: {
    indexingThreshold?: number;
    memmapThreshold?: number;
  };
  params?: {
    replicationFactor?: number;
    writeConsistencyFactor?: number;
  };
}

export interface UpdateCollectionResponse {
  updated: boolean;
  name: string;
  took: number;
}

export interface DeleteCollectionResponse {
  deleted: boolean;
  name: string;
  took: number;
}

// ============================================
// Chat/LLM Types (API Proxy)
// ============================================

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: "assistant";
    content: string;
  };
  finishReason: string;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  took: number;
}

export interface ChatStreamChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      content?: string;
    };
    finishReason: string | null;
  }>;
}

export interface ChatStreamEvent {
  type: "start" | "delta" | "end" | "error";
  content?: string;
  error?: string;
}

// ============================================
// Secrets Types
// ============================================

export type SecretProvider = "env" | "file" | "none";

export interface SecretEntry {
  name: string;
  provider: SecretProvider;
  exists: boolean;
  maskedValue?: string;
  lastModified?: string;
}

export interface KnownSecret {
  name: string;
  description: string;
  required: boolean;
}

export interface ListSecretsResponse {
  secrets: SecretEntry[];
  knownSecrets: KnownSecret[];
  total: number;
  configured: number;
}

export interface GetSecretResponse extends SecretEntry {
  description?: string;
  required: boolean;
}

export interface SetSecretRequest {
  name: string;
  value: string;
}

export interface SetSecretResponse {
  success: boolean;
  secret: SecretEntry;
  warning?: string;
  message: string;
}

export interface DeleteSecretResponse {
  success: boolean;
  message: string;
}

export interface ValidateSecretResponse {
  name: string;
  valid: boolean;
  message: string;
  details?: Record<string, unknown>;
  validatedAt: string;
}

// ============================================
// Coherence Types (P09 — Ingestion-Time Coherence)
// These types mirror packages/engram/src/types/coherence.ts and are
// kept in sync manually. The engram package is the canonical source;
// these definitions exist here for SDK consumers that cannot depend
// on the engram package directly.
// ============================================

/** The enforcement mode for a coherence check. */
export type CoherenceMode = "blocking" | "advisory" | "bypass";

/**
 * Persisted status on `session_notes.coherence_status`.
 * NULL in the database means no check was run (bypass mode or pre-P09 notes).
 */
export type CoherenceStatus =
  | "valid"
  | "contradiction_detected"
  | "staleness_detected"
  | "supersession_applied"
  | "conflict_overridden"
  | "pending_human_review";

/** Classification of the detected conflict. */
export type CoherenceConflictType = "contradiction" | "supersession" | "duplication" | "staleness";

/** Recommended action for the conflicting note pair. */
export type CoherenceProposedAction = "none" | "mark_superseded" | "mark_stale" | "escalate";

/** Urgency of the conflict. */
export type CoherenceSeverity = "info" | "warning" | "critical";

/** High-level outcome of a coherence evaluation. */
export type CoherenceOutcome = "pass" | "block" | "warn" | "defer";

/**
 * Describes a single contradiction detected between the incoming note and an
 * existing note in the same session.
 */
export interface ContradictionDescriptor {
  conflictingItemId: string;
  conflictType: CoherenceConflictType;
  similarityScore: number;
  newNoteType: string;
  existingNoteType: string;
  existingNoteSummary: string;
  existingNoteLifecycleStatus: string;
  existingNoteMutable: boolean;
  proposedAction: CoherenceProposedAction;
  severity: CoherenceSeverity;
}

/** A concrete resolution path for the caller to act on. */
export interface CoherenceResolutionRecommendation {
  action: "revise_and_retry" | "override" | "merge" | "escalate";
  description: string;
  conflictingNoteId: string;
}

/** Advisory staleness signal. */
export interface StalenessIndicator {
  relatedNoteId: string;
  similarityScore: number;
  recommendation: string;
}

/** Diagnostic metadata about the coherence evaluation run. */
export interface CoherenceEvaluationMetadata {
  candidatesEvaluated: number;
  similarityThreshold: number;
  conflictPatternsMatched: string[];
  evaluationDurationMs: number;
}

/**
 * The full result of a coherence check.
 * Returned by CoherenceIngestService.check() and included in API responses.
 */
export interface CoherenceResult {
  outcome: CoherenceOutcome;
  contradictions: ContradictionDescriptor[];
  recommendations: CoherenceResolutionRecommendation[];
  staleness?: StalenessIndicator;
  metadata: CoherenceEvaluationMetadata;
  timedOut?: boolean;
}

/**
 * A conflict record returned by the coherence-conflicts API endpoint (P09).
 * Reflects conflicts stored in `session_notes.coherence_metadata`.
 */
export interface CoherenceConflictRecord {
  /** Unique identifier for this conflict record (same as noteId in Phase 1). */
  id: string;
  /** ID of the note that triggered the conflict. */
  noteId: string;
  /** ID of the note that the incoming note conflicted with. */
  conflictingNoteId: string;
  /** Classification of the conflict. */
  conflictType: CoherenceConflictType;
  /** Current resolution status of this conflict. */
  status: "open" | "resolved" | "escalated";
  /** ISO 8601 timestamp of when the conflict was detected. */
  detectedAt: string;
  /** ISO 8601 timestamp of when the conflict was resolved, if applicable. */
  resolvedAt?: string;
  /** The resolution applied, if any. */
  resolution?: string;
  /** Full coherence evaluation result for this conflict. */
  coherenceMetadata: CoherenceResult;
}

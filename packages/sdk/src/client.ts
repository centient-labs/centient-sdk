/**
 * Engram Memory Server SDK Client
 *
 * A typed TypeScript client for the Engram Memory Server REST API.
 */

import {
  EngramError,
  NetworkError,
  TimeoutError,
  parseApiError,
} from "./errors.js";
import { SessionsResource, NotesResource, EdgesResource, SessionLinksResource, CrystalsResource, TerrafirmaResource, ExportImportResource, EntitiesResource, ExtractionResource, EventsResource, AgentsResource, AmbientContextResource, FactsResource, MemorySpacesResource, UsersResource, AuditResource, SyncResource, GcResource, MaintenanceResource } from "./resources/index.js";
import type {
  AddRelationshipRequest,
  AddRelationshipResponse,
  AddSourceRequest,
  AddSourceResponse,
  AdminStatsResponse,
  AdvisorFeedbackRequest,
  AdvisorFeedbackResponse,
  AnalyzeTaskRequest,
  AnalyzeTaskResponse,
  BeginTaskRequest,
  BeginTaskResponse,
  BrainConfig,
  BrainConfigResponse,
  BrainContextRequest,
  BrainContextResponse,
  BrainEvolveRequest,
  BrainEvolveResponse,
  BrainHealthResponse,
  BrainSearchRequest,
  BrainSearchResponse,
  BrainStatsResponse,
  CausalChainResponse,
  CheckDuplicateRequest,
  CheckDuplicateResponse,
  CheckViolationRequest,
  CheckViolationResponse,
  Constraint,
  ConstraintsListResponse,
  CreateAlertRequest,
  CreateAlertResponse,
  CreateConstraintRequest,
  CreateGraphRelationshipRequest,
  CreateGraphRelationshipResponse,
  CreateNoteRequest,
  CreateSessionRequest,
  CrossProjectSearchResult,
  CuratorConfig,
  CuratorConfigResponse,
  CuratorStatsResponse,
  DetailedHealthResponse,
  DriftResponse,
  EndTaskRequest,
  EndTaskResponse,
  EngagementFeedbackRequest,
  EngagementFeedbackResponse,
  EngramClientConfig,
  ExpandQueryRequest,
  ExpandQueryResponse,
  GetConsiderationsRequest,
  GetConsiderationsResponse,
  GetContextResponse,
  GetEngagementStatusResponse,
  GetSourceResponse,
  GetTaskContextRequest,
  GetTaskContextResponse,
  GetUsageStatsResponse,
  GraphQueryRequest,
  GraphQueryResponse,
  HealthResponse,
  IdentifyGapsRequest,
  IdentifyGapsResponse,
  IngestRequest,
  IngestResponse,
  KnowledgeSource,
  LinkSessionsRequest,
  LinkSessionsResponse,
  ListAlertsResponse,
  ListMemoriesOptions,
  ListMemoriesResponse,
  ListSourcesResponse,
  ManualIngestRequest,
  ManualIngestResponse,
  MemoryBankProject,
  Note,
  NoteType,
  NotesListResponse,
  Pattern,
  PushToMemoryBankRequest,
  PushToMemoryBankResponse,
  RetrievalRequest,
  RetrievalResponse,
  SearchMemoryBankRequest,
  SearchMemoryBankResponse,
  SearchPatternsOptions,
  SearchPatternsResponse,
  SearchRequest,
  SearchResponse,
  SearchResult,
  Session,
  SessionDetails,
  SessionsListResponse,
  SuggestRequest,
  SuggestResponse,
  SynthesizeRequest,
  SynthesizeResponse,
  TaskContext,
  TrackPatternUsageRequest,
  TrackPatternUsageResponse,
  TrackUsageRequest,
  TrackUsageResponse,
  TriggerEvolutionRequest,
  TriggerEvolutionResponse,
  // Artifact types (ADR-020)
  ArtifactType,
  DownloadArtifactResponse,
  ListArtifactsResponse,
  ProjectIdentity,
  RegisterProjectRequest,
  RegisterProjectResponse,
  UploadArtifactRequest,
  UploadArtifactResponse,
  // Project linking types (Git-Aware Auto-Registration)
  LinkedProject,
  ProjectSuggestion,
  // Embedding types (API Proxy)
  EmbeddingRequest,
  EmbeddingResponse,
  BatchEmbeddingResponse,
  EmbeddingInfoResponse,
  EmbeddingModule,
  // Vector types (API Proxy)
  VectorSearchRequest,
  VectorSearchResponse,
  VectorUpsertRequest,
  VectorUpsertResponse,
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
  // Collection types (API Proxy)
  CreateCollectionRequest,
  CreateCollectionResponse,
  CollectionInfo,
  ListCollectionsResponse,
  UpdateCollectionRequest,
  UpdateCollectionResponse,
  DeleteCollectionResponse,
  // Chat types (API Proxy)
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatStreamEvent,
  // Secrets types
  ListSecretsResponse,
  GetSecretResponse,
  SetSecretRequest,
  SetSecretResponse,
  DeleteSecretResponse,
  ValidateSecretResponse,
} from "./types.js";

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;

/**
 * Minimum engram-server version required by this SDK.
 * Use `client.checkCompatibility()` to verify at runtime.
 */
export const MIN_SERVER_VERSION = "0.22.4";

/**
 * Engram Memory Server Client
 *
 * @example
 * ```typescript
 * const client = new EngramClient({
 *   baseUrl: "http://localhost:3100",
 *   apiKey: "your-api-key",
 * });
 *
 * // Create a session
 * const session = await client.createSession({
 *   sessionId: "my-session",
 *   projectPath: "/path/to/project",
 * });
 *
 * // Save a note
 * const note = await client.createNote("my-session", {
 *   type: "decision",
 *   content: "Using PostgreSQL for the database",
 * });
 *
 * // Search notes
 * const results = await client.search("my-session", {
 *   query: "database decisions",
 *   limit: 5,
 * });
 * ```
 */
export class EngramClient {
  /** @internal Used by EventsResource for SSE connections */
  public readonly baseUrl: string;
  /** @internal Used by EventsResource for auth header injection */
  public readonly apiKey?: string;
  private readonly userId?: string;
  private readonly timeout: number;
  private readonly retries: number;
  private readonly retryDelay: number;

  /**
   * Resource-based access to sessions (engram Knowledge API)
   */
  public readonly sessions: SessionsResource;

  /**
   * Resource-based access to notes (engram Knowledge API)
   */
  public readonly notes: NotesResource;

  /**
   * Resource-based access to knowledge crystal edges.
   * Supports all relationship types including 'contains' for hierarchy (ADR-055).
   */
  public readonly edges: EdgesResource;

  /**
   * Resource-based access to session links (engram Knowledge API)
   */
  public readonly sessionLinks: SessionLinksResource;

  /**
   * Resource-based access to unified knowledge crystal nodes (ADR-055).
   * This is the primary API for all node operations — both content nodes
   * (pattern, learning, decision, note, finding, constraint) and container
   * nodes (collection, session_artifact, project, domain, file_ref, directory).
   */
  public readonly crystals: CrystalsResource;

  /**
   * Resource-based access to terrafirma filesystem sync (ADR-049)
   */
  public readonly terrafirma: TerrafirmaResource;

  /**
   * Resource-based access to export/import (ADR-042)
   */
  public readonly exportImport: ExportImportResource;

  /**
   * Resource-based access to entity cards and the entity graph (ADR-062)
   */
  public readonly entities: EntitiesResource;

  /**
   * Resource-based access to entity extraction jobs, config, and stats (ADR-062)
   */
  public readonly extraction: ExtractionResource;

  /**
   * Resource-based access to real-time event streaming via SSE (P19).
   * Use `client.events.subscribe(types, callback)` to receive live updates.
   */
  public readonly events: EventsResource;

  /**
   * Resource-based access to agent identity management (P17 multi-agent shared memory).
   */
  public readonly agents: AgentsResource;

  /**
   * Resource-based access to role-biased ambient knowledge context.
   */
  public readonly ambientContext: AmbientContextResource;

  /**
   * Resource-based access to bi-temporal facts.
   */
  public readonly facts: FactsResource;

  /**
   * Resource-based access to multi-agent shared memory spaces (P17).
   */
  public readonly memorySpaces: MemorySpacesResource;

  /**
   * Resource-based access to user management.
   */
  public readonly users: UsersResource;

  /**
   * Resource-based access to audit event ingestion and querying.
   */
  public readonly audit: AuditResource;

  /**
   * Resource-based access to instance-to-instance sync (ADR-011).
   */
  public readonly sync: SyncResource;

  /**
   * Resource-based access to garbage collection.
   */
  public readonly gc: GcResource;

  /**
   * Resource-based access to database maintenance operations.
   */
  public readonly maintenance: MaintenanceResource;

  constructor(config: EngramClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.apiKey = config.apiKey;
    this.userId = config.userId;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.retries = config.retries ?? DEFAULT_RETRIES;
    this.retryDelay = config.retryDelay ?? DEFAULT_RETRY_DELAY;

    // Initialize resource accessors
    this.sessions = new SessionsResource(this);
    this.notes = new NotesResource(this);
    this.edges = new EdgesResource(this);
    this.sessionLinks = new SessionLinksResource(this);
    this.crystals = new CrystalsResource(this);
    this.terrafirma = new TerrafirmaResource(this);
    this.exportImport = new ExportImportResource(this);
    this.entities = new EntitiesResource(this);
    this.extraction = new ExtractionResource(this);
    this.events = new EventsResource(this);
    this.agents = new AgentsResource(this);
    this.ambientContext = new AmbientContextResource(this);
    this.facts = new FactsResource(this);
    this.memorySpaces = new MemorySpacesResource(this);
    this.users = new UsersResource(this);
    this.audit = new AuditResource(this);
    this.sync = new SyncResource(this);
    this.gc = new GcResource(this);
    this.maintenance = new MaintenanceResource(this);
  }

  /**
   * Check if the connected server meets the minimum version requirement.
   * Calls /health and compares the returned version against MIN_SERVER_VERSION.
   */
  async checkCompatibility(): Promise<{
    compatible: boolean;
    serverVersion: string;
    minRequired: string;
  }> {
    const health = await this.request<{ version?: string }>("GET", "/health");
    const serverVersion = health.version ?? "unknown";
    const compatible =
      serverVersion !== "unknown" &&
      this.isVersionGte(serverVersion, MIN_SERVER_VERSION);
    return { compatible, serverVersion, minRequired: MIN_SERVER_VERSION };
  }

  private isVersionGte(actual: string, required: string): boolean {
    const parse = (v: string) => v.split(".").map(s => parseInt(s, 10));
    const [aMaj = 0, aMin = 0, aPat = 0] = parse(actual);
    const [rMaj = 0, rMin = 0, rPat = 0] = parse(required);
    if ([aMaj, aMin, aPat].some(isNaN)) return false;
    if (aMaj !== rMaj) return aMaj > rMaj;
    if (aMin !== rMin) return aMin > rMin;
    return aPat >= rPat;
  }

  /**
   * Public request method for resources.
   * @internal This is for internal use by resource classes only.
   */
  public _request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.request<T>(method, path, body);
  }

  /**
   * Make a raw HTTP request, returning the Response object directly.
   * Used for binary streaming responses (e.g. export downloads).
   * Throws EngramError on non-2xx responses.
   * @internal This is for internal use by resource classes only.
   */
  public async _requestRaw(
    method: string,
    path: string,
    body?: unknown,
    attempt = 1,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }

    if (this.userId) {
      headers["X-User-ID"] = this.userId;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorData: unknown;
        try {
          errorData = await response.json();
        } catch {
          errorData = { error: { message: await response.text() } };
        }
        if (
          response.status >= 500 &&
          attempt < this.retries
        ) {
          await this.sleep(this.retryDelay * attempt);
          return this._requestRaw(method, path, body, attempt + 1);
        }
        parseApiError(response.status, errorData);
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === "AbortError") {
        throw new TimeoutError(this.timeout);
      }

      if (error instanceof EngramError) {
        throw error;
      }

      if (attempt < this.retries) {
        await this.sleep(this.retryDelay * attempt);
        return this._requestRaw(method, path, body, attempt + 1);
      }

      throw new NetworkError(
        `Failed to ${method} ${path}: ${error instanceof Error ? error.message : "Unknown error"}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Make an HTTP request with a FormData body, returning parsed JSON.
   * Used for multipart form data uploads (e.g. import). Does NOT set
   * Content-Type — fetch sets the multipart boundary automatically.
   * @internal This is for internal use by resource classes only.
   */
  public async _requestFormData<T>(
    method: string,
    path: string,
    formData: FormData,
    attempt = 1,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {};

    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }

    if (this.userId) {
      headers["X-User-ID"] = this.userId;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        if (response.status >= 500 && attempt < this.retries) {
          await this.sleep(this.retryDelay * attempt);
          return this._requestFormData<T>(method, path, formData, attempt + 1);
        }
        parseApiError(response.status, data);
      }

      return data as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === "AbortError") {
        throw new TimeoutError(this.timeout);
      }

      if (error instanceof EngramError) {
        throw error;
      }

      if (attempt < this.retries) {
        await this.sleep(this.retryDelay * attempt);
        return this._requestFormData<T>(method, path, formData, attempt + 1);
      }

      throw new NetworkError(
        `Failed to ${method} ${path}: ${error instanceof Error ? error.message : "Unknown error"}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  // ============================================
  // HTTP Helpers
  // ============================================

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    attempt = 1,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }

    if (this.userId) {
      headers["X-User-ID"] = this.userId;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      const data = await response.json();

      if (!response.ok) {
        parseApiError(response.status, data);
      }

      return data as T;
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle abort (timeout)
      if (error instanceof Error && error.name === "AbortError") {
        throw new TimeoutError(this.timeout);
      }

      // Re-throw Engram errors
      if (error instanceof EngramError) {
        // Retry on server errors if attempts remain
        if (
          error.statusCode &&
          error.statusCode >= 500 &&
          attempt < this.retries
        ) {
          await this.sleep(this.retryDelay * attempt);
          return this.request<T>(method, path, body, attempt + 1);
        }
        throw error;
      }

      // Handle network errors with retry
      if (attempt < this.retries) {
        await this.sleep(this.retryDelay * attempt);
        return this.request<T>(method, path, body, attempt + 1);
      }

      throw new NetworkError(
        `Failed to ${method} ${path}: ${error instanceof Error ? error.message : "Unknown error"}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================
  // Session Operations
  // ============================================

  /**
   * Create a new memory session
   */
  async createSession(request: CreateSessionRequest): Promise<Session> {
    return this.request<Session>("POST", "/v1/sessions", request);
  }

  /**
   * List all active sessions
   */
  async listSessions(): Promise<SessionsListResponse> {
    return this.request<SessionsListResponse>("GET", "/v1/sessions");
  }

  /**
   * Get session details
   */
  async getSession(sessionId: string): Promise<SessionDetails> {
    return this.request<SessionDetails>(
      "GET",
      `/v1/sessions/${encodeURIComponent(sessionId)}`,
    );
  }

  /**
   * Delete a session and all its data
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/v1/sessions/${encodeURIComponent(sessionId)}`,
    );
  }

  // ============================================
  // Note Operations
  // ============================================

  /**
   * Create a new note in a session
   */
  async createNote(sessionId: string, request: CreateNoteRequest): Promise<Note> {
    return this.request<Note>(
      "POST",
      `/v1/sessions/${encodeURIComponent(sessionId)}/notes`,
      request,
    );
  }

  /**
   * List notes in a session
   */
  async listNotes(
    sessionId: string,
    options?: { type?: NoteType; limit?: number },
  ): Promise<NotesListResponse> {
    const params = new URLSearchParams();
    if (options?.type) params.set("type", options.type);
    if (options?.limit) params.set("limit", options.limit.toString());

    const query = params.toString();
    const path = `/v1/sessions/${encodeURIComponent(sessionId)}/notes${query ? `?${query}` : ""}`;

    return this.request<NotesListResponse>("GET", path);
  }

  /**
   * Get a specific note by ID
   */
  async getNote(sessionId: string, noteId: number): Promise<SearchResult> {
    return this.request<SearchResult>(
      "GET",
      `/v1/sessions/${encodeURIComponent(sessionId)}/notes/${noteId}`,
    );
  }

  /**
   * Add a relationship between two notes
   */
  async addRelationship(
    sessionId: string,
    sourceNoteId: number,
    request: AddRelationshipRequest,
  ): Promise<AddRelationshipResponse> {
    return this.request<AddRelationshipResponse>(
      "POST",
      `/v1/sessions/${encodeURIComponent(sessionId)}/notes/${sourceNoteId}/relationships`,
      request,
    );
  }

  /**
   * Get causal chain for a note (traverse caused_by/preceded_by relationships)
   */
  async getCausalChain(
    sessionId: string,
    noteId: number,
    maxDepth = 5,
  ): Promise<CausalChainResponse> {
    return this.request<CausalChainResponse>(
      "GET",
      `/v1/sessions/${encodeURIComponent(sessionId)}/notes/${noteId}/causal-chain?maxDepth=${maxDepth}`,
    );
  }


  // ============================================
  // Search Operations
  // ============================================

  /**
   * Search session notes using semantic search
   */
  async search(sessionId: string, request: SearchRequest): Promise<SearchResponse> {
    return this.request<SearchResponse>(
      "POST",
      `/v1/sessions/${encodeURIComponent(sessionId)}/search`,
      request,
    );
  }

  /**
   * Check for duplicate work in a session
   */
  async checkDuplicate(
    sessionId: string,
    request: CheckDuplicateRequest,
  ): Promise<CheckDuplicateResponse> {
    return this.request<CheckDuplicateResponse>(
      "POST",
      `/v1/sessions/${encodeURIComponent(sessionId)}/duplicate-check`,
      request,
    );
  }

  // ============================================
  // Drift Operations
  // ============================================

  /**
   * Get drift analysis for a session
   */
  async getDrift(
    sessionId: string,
    options?: { includeHistory?: boolean; includePerTypeAnalysis?: boolean },
  ): Promise<DriftResponse> {
    const params = new URLSearchParams();
    if (options?.includeHistory !== undefined) {
      params.set("includeHistory", options.includeHistory.toString());
    }
    if (options?.includePerTypeAnalysis !== undefined) {
      params.set("includePerTypeAnalysis", options.includePerTypeAnalysis.toString());
    }

    const query = params.toString();
    const path = `/v1/sessions/${encodeURIComponent(sessionId)}/drift${query ? `?${query}` : ""}`;

    return this.request<DriftResponse>("GET", path);
  }

  // ============================================
  // Constraint Operations
  // ============================================

  /**
   * Track a new constraint for a session
   */
  async createConstraint(
    sessionId: string,
    request: CreateConstraintRequest,
  ): Promise<Constraint> {
    return this.request<Constraint>(
      "POST",
      `/v1/sessions/${encodeURIComponent(sessionId)}/constraints`,
      request,
    );
  }

  /**
   * List active constraints for a session
   */
  async listConstraints(sessionId: string): Promise<ConstraintsListResponse> {
    return this.request<ConstraintsListResponse>(
      "GET",
      `/v1/sessions/${encodeURIComponent(sessionId)}/constraints`,
    );
  }

  /**
   * Lift (deactivate) a constraint
   */
  async liftConstraint(sessionId: string, constraintId: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/v1/sessions/${encodeURIComponent(sessionId)}/constraints/${encodeURIComponent(constraintId)}`,
    );
  }

  /**
   * Check if an action would violate any active constraints
   */
  async checkViolation(
    sessionId: string,
    request: CheckViolationRequest,
  ): Promise<CheckViolationResponse> {
    return this.request<CheckViolationResponse>(
      "POST",
      `/v1/sessions/${encodeURIComponent(sessionId)}/check-violation`,
      request,
    );
  }

  // ============================================
  // Memory Bank Operations
  // ============================================

  /**
   * Search Memory Bank for project memories
   *
   * @example
   * ```typescript
   * const results = await client.searchMemoryBank({
   *   query: "authentication decisions",
   *   projectName: "my-project",
   *   topK: 5,
   * });
   * ```
   */
  async searchMemoryBank(request: SearchMemoryBankRequest): Promise<SearchMemoryBankResponse> {
    return this.request<SearchMemoryBankResponse>("POST", "/v1/memory-bank/search", request);
  }

  /**
   * List memories stored for a project
   *
   * @example
   * ```typescript
   * const memories = await client.listMemories("my-project", { limit: 50 });
   * ```
   */
  async listMemories(
    projectName: string,
    options?: ListMemoriesOptions,
  ): Promise<ListMemoriesResponse> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", options.limit.toString());

    const query = params.toString();
    const path = `/v1/memory-bank/${encodeURIComponent(projectName)}/memories${query ? `?${query}` : ""}`;

    return this.request<ListMemoriesResponse>("GET", path);
  }

  /**
   * Push a finalization pack to Memory Bank for persistent cross-session storage
   *
   * @example
   * ```typescript
   * const result = await client.pushToMemoryBank("my-project", {
   *   finalizationPackPath: "/path/to/finalization-pack.json",
   * });
   * ```
   */
  async pushToMemoryBank(
    projectName: string,
    request: PushToMemoryBankRequest,
  ): Promise<PushToMemoryBankResponse> {
    return this.request<PushToMemoryBankResponse>(
      "POST",
      `/v1/memory-bank/${encodeURIComponent(projectName)}/push`,
      request,
    );
  }

  /**
   * List all projects with memory banks
   *
   * Returns project names and their memory counts for dropdown/selection UIs.
   *
   * @example
   * ```typescript
   * const projects = await client.listMemoryBankProjects();
   * // [{ name: "centient", memoryCount: 42, crossProjectCount: 5 }, ...]
   * ```
   */
  async listMemoryBankProjects(): Promise<MemoryBankProject[]> {
    const response = await this.request<{ projects: MemoryBankProject[] }>(
      "GET",
      "/v1/memory-bank/projects",
    );
    return response.projects;
  }

  /**
   * Search across all projects for cross-project memories
   *
   * Searches only memories marked as crossProject: true across all projects.
   *
   * @example
   * ```typescript
   * const result = await client.searchCrossProjectMemories(
   *   "authentication patterns",
   *   { limit: 10 }
   * );
   * // result.memories contains memories from multiple projects
   * // Each memory has sourceProject set
   * ```
   */
  async searchCrossProjectMemories(
    query: string,
    options?: { limit?: number },
  ): Promise<CrossProjectSearchResult> {
    const params = new URLSearchParams();
    params.set("query", query);
    if (options?.limit) params.set("limit", options.limit.toString());

    const queryString = params.toString();
    const path = `/v1/memory-bank/cross-project/search?${queryString}`;

    return this.request<CrossProjectSearchResult>("GET", path);
  }

  /**
   * Mark a memory as cross-project (useful across all projects)
   *
   * Cross-project memories appear in cross-project searches and can be
   * surfaced when working on any project.
   *
   * @example
   * ```typescript
   * // Mark a memory as useful across projects
   * await client.markMemoryCrossProject("centient", "mem-123", true);
   *
   * // Remove cross-project flag
   * await client.markMemoryCrossProject("centient", "mem-123", false);
   * ```
   */
  async markMemoryCrossProject(
    projectName: string,
    memoryId: string,
    crossProject: boolean,
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      "PATCH",
      `/v1/memory-bank/${encodeURIComponent(projectName)}/memories/${encodeURIComponent(memoryId)}`,
      { crossProject },
    );
  }

  // ============================================
  // Pattern Operations
  // ============================================

  /**
   * Search patterns in the pattern library
   *
   * @example
   * ```typescript
   * const results = await client.searchPatterns({
   *   keyword: "authentication",
   *   category: "security",
   *   limit: 10,
   * });
   * ```
   */
  async searchPatterns(options?: SearchPatternsOptions): Promise<SearchPatternsResponse> {
    const params = new URLSearchParams();
    if (options?.keyword) params.set("keyword", options.keyword);
    if (options?.category) params.set("category", options.category);
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.includeExecutable) params.set("includeExecutable", "true");

    const query = params.toString();
    const path = `/v1/patterns/search${query ? `?${query}` : ""}`;

    return this.request<SearchPatternsResponse>("GET", path);
  }

  /**
   * Get a specific pattern by ID
   */
  async getPattern(
    patternId: string,
    options?: { includeCode?: boolean; version?: string },
  ): Promise<Pattern> {
    const params = new URLSearchParams();
    if (options?.includeCode) params.set("includeCode", "true");
    if (options?.version) params.set("version", options.version);

    const query = params.toString();
    const path = `/v1/patterns/${encodeURIComponent(patternId)}${query ? `?${query}` : ""}`;

    return this.request<Pattern>("GET", path);
  }

  /**
   * Track usage of a pattern
   */
  async trackPatternUsage(
    patternId: string,
    request: TrackPatternUsageRequest,
  ): Promise<TrackPatternUsageResponse> {
    return this.request<TrackPatternUsageResponse>(
      "POST",
      `/v1/patterns/${encodeURIComponent(patternId)}/usage`,
      request,
    );
  }

  // ============================================
  // Retrieval Operations
  // ============================================

  /**
   * Execute full retrieval pipeline (expand, search, rerank, synthesize)
   */
  async retrieve(request: RetrievalRequest): Promise<RetrievalResponse> {
    return this.request<RetrievalResponse>("POST", "/v1/retrieve", request);
  }

  /**
   * Expand a query into multiple related queries
   */
  async expandQuery(request: ExpandQueryRequest): Promise<ExpandQueryResponse> {
    return this.request<ExpandQueryResponse>("POST", "/v1/expand", request);
  }

  /**
   * Synthesize search results into a coherent answer
   */
  async synthesize(request: SynthesizeRequest): Promise<SynthesizeResponse> {
    return this.request<SynthesizeResponse>("POST", "/v1/synthesize", request);
  }

  // ============================================
  // Graph Operations
  // ============================================

  /**
   * Query the temporal graph
   *
   * @example
   * ```typescript
   * const result = await client.queryGraph({
   *   queryType: "causal_chain",
   *   sessionId: "my-session",
   *   startNode: 123,
   *   filters: { maxDepth: 5 },
   * });
   * ```
   */
  async queryGraph(request: GraphQueryRequest): Promise<GraphQueryResponse> {
    return this.request<GraphQueryResponse>("POST", "/v1/graph/query", request);
  }

  /**
   * Link two sessions with a typed relationship
   *
   * @example
   * ```typescript
   * await client.linkSessions({
   *   sourceSession: "2026-01-17-feature",
   *   targetSession: "2026-01-16-setup",
   *   relationship: "builds_on",
   *   projectPath: "/path/to/project",
   * });
   * ```
   */
  async linkSessions(request: LinkSessionsRequest): Promise<LinkSessionsResponse> {
    return this.request<LinkSessionsResponse>("POST", "/v1/graph/sessions/link", request);
  }

  /**
   * Create a relationship between notes in the graph
   *
   * @example
   * ```typescript
   * await client.createGraphRelationship(123, {
   *   sessionId: "my-session",
   *   targetNoteId: 456,
   *   relationship: "caused_by",
   * });
   * ```
   */
  async createGraphRelationship(
    noteId: number,
    request: CreateGraphRelationshipRequest,
  ): Promise<CreateGraphRelationshipResponse> {
    return this.request<CreateGraphRelationshipResponse>(
      "POST",
      `/v1/graph/notes/${noteId}/relationships`,
      request,
    );
  }

  // ============================================
  // Curator Operations (Knowledge Ingestion)
  // ============================================

  /**
   * Add a knowledge source for ingestion
   */
  async addSource(request: AddSourceRequest): Promise<AddSourceResponse> {
    return this.request<AddSourceResponse>("POST", "/v1/curator/sources", request);
  }

  /**
   * List all knowledge sources
   */
  async listSources(): Promise<ListSourcesResponse> {
    return this.request<ListSourcesResponse>("GET", "/v1/curator/sources");
  }

  /**
   * Get a specific source by ID
   */
  async getSource(sourceId: string): Promise<GetSourceResponse> {
    return this.request<GetSourceResponse>(
      "GET",
      `/v1/curator/sources/${encodeURIComponent(sourceId)}`,
    );
  }

  /**
   * Delete a knowledge source
   */
  async deleteSource(sourceId: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/v1/curator/sources/${encodeURIComponent(sourceId)}`,
    );
  }

  /**
   * Ingest content from configured sources
   */
  async ingest(request: IngestRequest): Promise<IngestResponse> {
    return this.request<IngestResponse>("POST", "/v1/curator/ingest", request);
  }

  /**
   * Ingest content manually (direct content)
   */
  async ingestManual(request: ManualIngestRequest): Promise<ManualIngestResponse> {
    return this.request<ManualIngestResponse>("POST", "/v1/curator/ingest/manual", request);
  }

  /**
   * Get curator statistics
   */
  async getCuratorStats(): Promise<CuratorStatsResponse> {
    return this.request<CuratorStatsResponse>("GET", "/v1/curator/stats");
  }

  /**
   * Get curator configuration
   */
  async getCuratorConfig(): Promise<CuratorConfigResponse> {
    return this.request<CuratorConfigResponse>("GET", "/v1/curator/config");
  }

  /**
   * Update curator configuration
   */
  async updateCuratorConfig(config: CuratorConfig): Promise<CuratorConfigResponse> {
    return this.request<CuratorConfigResponse>("PUT", "/v1/curator/config", config);
  }

  // ============================================
  // Advisor Operations (Proactive Assistance)
  // ============================================

  /**
   * Analyze a task and get proactive suggestions
   */
  async analyzeTask(request: AnalyzeTaskRequest): Promise<AnalyzeTaskResponse> {
    return this.request<AnalyzeTaskResponse>("POST", "/v1/advisor/analyze", request);
  }

  /**
   * Get relevant context for a task
   */
  async getAdvisorContext(request: TaskContext): Promise<GetContextResponse> {
    return this.request<GetContextResponse>("POST", "/v1/advisor/context", request);
  }

  /**
   * Get suggestions based on activity
   */
  async suggest(request: SuggestRequest): Promise<SuggestResponse> {
    return this.request<SuggestResponse>("POST", "/v1/advisor/suggest", request);
  }

  /**
   * Identify knowledge gaps
   */
  async identifyGaps(request: IdentifyGapsRequest): Promise<IdentifyGapsResponse> {
    return this.request<IdentifyGapsResponse>("POST", "/v1/advisor/gaps", request);
  }

  /**
   * Create an alert
   */
  async createAlert(request: CreateAlertRequest): Promise<CreateAlertResponse> {
    return this.request<CreateAlertResponse>("POST", "/v1/advisor/alerts", request);
  }

  /**
   * List active alerts
   */
  async listAlerts(): Promise<ListAlertsResponse> {
    return this.request<ListAlertsResponse>("GET", "/v1/advisor/alerts");
  }

  /**
   * Dismiss an alert
   */
  async dismissAlert(alertId: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/v1/advisor/alerts/${encodeURIComponent(alertId)}`,
    );
  }

  /**
   * Get considerations for a decision
   */
  async getConsiderations(request: GetConsiderationsRequest): Promise<GetConsiderationsResponse> {
    return this.request<GetConsiderationsResponse>("POST", "/v1/advisor/considerations", request);
  }

  /**
   * Record feedback on a suggestion
   */
  async recordAdvisorFeedback(request: AdvisorFeedbackRequest): Promise<AdvisorFeedbackResponse> {
    return this.request<AdvisorFeedbackResponse>("POST", "/v1/advisor/feedback", request);
  }

  // ============================================
  // Brain Operations (Unified Knowledge Layer)
  // ============================================

  /**
   * Search unified knowledge base
   */
  async brainSearch(request: BrainSearchRequest): Promise<BrainSearchResponse> {
    return this.request<BrainSearchResponse>("POST", "/v1/brain/search", request);
  }

  /**
   * Get task context from brain
   */
  async getBrainContext(request: BrainContextRequest): Promise<BrainContextResponse> {
    return this.request<BrainContextResponse>("POST", "/v1/brain/context", request);
  }

  /**
   * Track knowledge usage
   */
  async trackUsage(request: TrackUsageRequest): Promise<TrackUsageResponse> {
    return this.request<TrackUsageResponse>("POST", "/v1/brain/usage", request);
  }

  /**
   * Get usage statistics for a knowledge item
   */
  async getUsageStats(knowledgeId: string): Promise<GetUsageStatsResponse> {
    return this.request<GetUsageStatsResponse>(
      "GET",
      `/v1/brain/usage/${encodeURIComponent(knowledgeId)}`,
    );
  }

  /**
   * Trigger knowledge evolution
   */
  async evolveBrain(request?: BrainEvolveRequest): Promise<BrainEvolveResponse> {
    return this.request<BrainEvolveResponse>("POST", "/v1/brain/evolve", request ?? {});
  }

  /**
   * Get brain health metrics
   */
  async getBrainHealth(): Promise<BrainHealthResponse> {
    return this.request<BrainHealthResponse>("GET", "/v1/brain/health");
  }

  /**
   * Get brain statistics
   */
  async getBrainStats(): Promise<BrainStatsResponse> {
    return this.request<BrainStatsResponse>("GET", "/v1/brain/stats");
  }

  /**
   * Get brain configuration
   */
  async getBrainConfig(): Promise<BrainConfigResponse> {
    return this.request<BrainConfigResponse>("GET", "/v1/brain/config");
  }

  /**
   * Update brain configuration
   */
  async updateBrainConfig(config: BrainConfig): Promise<BrainConfigResponse> {
    return this.request<BrainConfigResponse>("PUT", "/v1/brain/config", config);
  }

  // ============================================
  // Engagement Operations (Pipeline Orchestration)
  // ============================================

  /**
   * Begin a new task with engagement pipeline
   */
  async beginTask(request: BeginTaskRequest): Promise<BeginTaskResponse> {
    return this.request<BeginTaskResponse>("POST", "/v1/engagement/begin", request);
  }

  /**
   * Get context for an active task
   */
  async getTaskContext(taskId: string): Promise<GetTaskContextResponse> {
    return this.request<GetTaskContextResponse>(
      "GET",
      `/v1/engagement/tasks/${encodeURIComponent(taskId)}/context`,
    );
  }

  /**
   * Refresh context for a task with options
   */
  async refreshTaskContext(
    taskId: string,
    request?: GetTaskContextRequest,
  ): Promise<GetTaskContextResponse> {
    return this.request<GetTaskContextResponse>(
      "POST",
      `/v1/engagement/tasks/${encodeURIComponent(taskId)}/context`,
      request ?? {},
    );
  }

  /**
   * End a task
   */
  async endTask(taskId: string, request: EndTaskRequest): Promise<EndTaskResponse> {
    return this.request<EndTaskResponse>(
      "POST",
      `/v1/engagement/tasks/${encodeURIComponent(taskId)}/end`,
      request,
    );
  }

  /**
   * Record suggestion feedback
   */
  async recordEngagementFeedback(
    request: EngagementFeedbackRequest,
  ): Promise<EngagementFeedbackResponse> {
    return this.request<EngagementFeedbackResponse>("POST", "/v1/engagement/feedback", request);
  }

  /**
   * Trigger evolution
   */
  async triggerEvolution(request: TriggerEvolutionRequest): Promise<TriggerEvolutionResponse> {
    return this.request<TriggerEvolutionResponse>("POST", "/v1/engagement/evolve", request);
  }

  /**
   * Get engagement status
   */
  async getEngagementStatus(): Promise<GetEngagementStatusResponse> {
    return this.request<GetEngagementStatusResponse>("GET", "/v1/engagement/status");
  }

  // ============================================
  // Admin Operations
  // ============================================

  /**
   * Get admin statistics
   */
  async getAdminStats(): Promise<AdminStatsResponse> {
    return this.request<AdminStatsResponse>("GET", "/v1/admin/stats");
  }


  // ============================================
  // Health Operations
  // ============================================

  /**
   * Check basic server health
   */
  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("GET", "/v1/health");
  }

  /**
   * Get detailed health information including dependency status
   */
  async healthDetailed(): Promise<DetailedHealthResponse> {
    return this.request<DetailedHealthResponse>("GET", "/v1/health/detailed");
  }

  // ============================================
  // Project Operations (ADR-020)
  // ============================================

  /**
   * Register a project for artifact storage
   *
   * @example
   * ```typescript
   * const result = await client.registerProject({
   *   id: "a1b2c3d4e5f6", // 12-char project ID hash
   *   name: "my-project",
   *   normalizedPath: "/users/dev/my-project",
   * });
   * ```
   */
  async registerProject(request: RegisterProjectRequest): Promise<RegisterProjectResponse> {
    return this.request<RegisterProjectResponse>("POST", "/v1/projects", request);
  }

  /**
   * Get a project by ID
   */
  async getProject(projectId: string): Promise<{ success: boolean; project: ProjectIdentity }> {
    return this.request<{ success: boolean; project: ProjectIdentity }>(
      "GET",
      `/v1/projects/${encodeURIComponent(projectId)}`,
    );
  }

  /**
   * List all registered projects
   */
  async listProjects(): Promise<{ success: boolean; projects: ProjectIdentity[]; total: number }> {
    return this.request<{ success: boolean; projects: ProjectIdentity[]; total: number }>(
      "GET",
      "/v1/projects",
    );
  }

  // ============================================
  // User Project Operations (Git-Aware Linking)
  // ============================================

  /**
   * Lookup user-ui project by Git remote or path
   *
   * Finds a project that matches the provided Git remote URL or filesystem path.
   * Use this to automatically link a local centient project to a user-ui project.
   *
   * @example
   * ```typescript
   * const result = await client.lookupProjectByIdentity({
   *   gitRemote: "github.com/user/repo",
   * });
   * if (result.project) {
   *   console.log(`Found project: ${result.project.name}`);
   * }
   * ```
   */
  async lookupProjectByIdentity(params: {
    gitRemote?: string;
    linkedPath?: string;
  }): Promise<{ project: LinkedProject | null; matchType: string }> {
    const query = new URLSearchParams();
    if (params.gitRemote) query.set("gitRemote", params.gitRemote);
    if (params.linkedPath) query.set("linkedPath", params.linkedPath);

    const res = await this.request<{ success: boolean; project: LinkedProject | null; matchType: string }>(
      "GET",
      `/v1/user/projects/lookup?${query.toString()}`,
    );
    return { project: res.project, matchType: res.matchType };
  }

  /**
   * Search for user-ui projects by name/slug
   *
   * Returns fuzzy matches sorted by similarity score.
   * Use this to suggest existing projects when no exact match is found.
   *
   * @example
   * ```typescript
   * const result = await client.searchUserProjects("my-project");
   * for (const suggestion of result.suggestions) {
   *   console.log(`${suggestion.name} (${suggestion.similarityScore})`);
   * }
   * ```
   */
  async searchUserProjects(search: string): Promise<{ suggestions: ProjectSuggestion[] }> {
    const res = await this.request<{ success: boolean; suggestions: ProjectSuggestion[] }>(
      "GET",
      `/v1/user/projects/lookup?search=${encodeURIComponent(search)}`,
    );
    return { suggestions: res.suggestions };
  }

  /**
   * Link a user-ui project to centient identity
   *
   * Stores the Git remote URL, filesystem path, and/or centient project ID
   * on the user-ui project for future automatic linking.
   *
   * @example
   * ```typescript
   * await client.linkUserProject("project-uuid", {
   *   gitRemote: "github.com/user/repo",
   *   linkedPath: "/users/dev/my-project",
   *   centientProjectId: "a1b2c3d4e5f6",
   * });
   * ```
   */
  async linkUserProject(projectId: string, identity: {
    linkedPath?: string;
    gitRemote?: string;
    centientProjectId?: string;
  }): Promise<{ linked: boolean }> {
    const res = await this.request<{ success: boolean; linked: boolean }>(
      "POST",
      `/v1/user/projects/${encodeURIComponent(projectId)}/link`,
      identity,
    );
    return { linked: res.linked };
  }

  /**
   * Get a user-ui project by ID
   *
   * Returns full project details including members and linking info.
   */
  async getUserProject(projectId: string): Promise<LinkedProject> {
    const res = await this.request<{
      success: boolean;
      id: string;
      name: string;
      slug: string;
      gitRemote?: string;
      linkedPath?: string;
      centientProjectId?: string;
    }>(
      "GET",
      `/v1/user/projects/${encodeURIComponent(projectId)}`,
    );
    return {
      id: res.id,
      name: res.name,
      slug: res.slug,
      gitRemote: res.gitRemote,
      linkedPath: res.linkedPath,
      centientProjectId: res.centientProjectId,
    };
  }

  /**
   * Create a new user-ui project
   *
   * Creates a project that the current user owns.
   *
   * @example
   * ```typescript
   * const project = await client.createUserProject({
   *   name: "My Project",
   *   slug: "my-project",
   *   description: "A new project",
   * });
   * ```
   */
  async createUserProject(params: {
    name: string;
    slug: string;
    description?: string;
  }): Promise<LinkedProject> {
    const res = await this.request<{
      success: boolean;
      id: string;
      name: string;
      slug: string;
      description?: string;
    }>(
      "POST",
      "/v1/user/projects",
      params,
    );
    return {
      id: res.id,
      name: res.name,
      slug: res.slug,
    };
  }

  // ============================================
  // Artifact Operations (ADR-020)
  // ============================================

  /**
   * Upload an artifact to the server
   *
   * @example
   * ```typescript
   * const result = await client.uploadArtifact({
   *   projectId: "a1b2c3d4e5f6",
   *   sessionId: "2026-01-19-feature",
   *   type: "finalization-pack",
   *   content: JSON.stringify(finalizationPack),
   * });
   * ```
   */
  async uploadArtifact(request: UploadArtifactRequest): Promise<UploadArtifactResponse> {
    return this.request<UploadArtifactResponse>("POST", "/v1/artifacts", request);
  }

  /**
   * Download an artifact by ID
   *
   * @example
   * ```typescript
   * const result = await client.downloadArtifact("abc123");
   * console.log(result.artifact.content);
   * ```
   */
  async downloadArtifact(artifactId: string): Promise<DownloadArtifactResponse> {
    return this.request<DownloadArtifactResponse>(
      "GET",
      `/v1/artifacts/${encodeURIComponent(artifactId)}`,
    );
  }

  /**
   * Delete an artifact
   */
  async deleteArtifact(artifactId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      "DELETE",
      `/v1/artifacts/${encodeURIComponent(artifactId)}`,
    );
  }

  /**
   * List artifacts for a project
   *
   * @example
   * ```typescript
   * const result = await client.listArtifacts("a1b2c3d4e5f6", {
   *   sessionId: "2026-01-19-feature",
   *   type: "finalization-pack",
   *   limit: 50,
   * });
   * ```
   */
  async listArtifacts(
    projectId: string,
    options?: {
      sessionId?: string;
      type?: ArtifactType;
      limit?: number;
      offset?: number;
    },
  ): Promise<ListArtifactsResponse> {
    const params = new URLSearchParams();
    if (options?.sessionId) params.set("sessionId", options.sessionId);
    if (options?.type) params.set("type", options.type);
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.offset) params.set("offset", options.offset.toString());

    const query = params.toString();
    const path = `/v1/artifacts/project/${encodeURIComponent(projectId)}${query ? `?${query}` : ""}`;

    return this.request<ListArtifactsResponse>("GET", path);
  }

  // ============================================
  // Embedding Operations (API Proxy)
  // ============================================

  /**
   * Generate a single embedding for text
   *
   * @example
   * ```typescript
   * const result = await client.generateEmbedding({
   *   text: "authentication flow",
   *   module: "session",
   * });
   * console.log(result.embedding.length); // 3072
   * ```
   */
  async generateEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    return this.request<EmbeddingResponse>("POST", "/v1/embeddings", request);
  }

  /**
   * Generate embeddings for multiple texts (up to 100)
   *
   * @example
   * ```typescript
   * const result = await client.generateBatchEmbeddings(
   *   ["text one", "text two"],
   *   "session"
   * );
   * console.log(result.count); // 2
   * ```
   */
  async generateBatchEmbeddings(
    texts: string[],
    module: EmbeddingModule = "search",
  ): Promise<BatchEmbeddingResponse> {
    return this.request<BatchEmbeddingResponse>("POST", "/v1/embeddings/batch", {
      texts,
      module,
    });
  }

  /**
   * Get embedding service info (availability, dimensions, cache stats)
   */
  async getEmbeddingInfo(): Promise<EmbeddingInfoResponse> {
    return this.request<EmbeddingInfoResponse>("GET", "/v1/embeddings/info");
  }

  // ============================================
  // Vector Operations (API Proxy)
  // ============================================

  /**
   * Search vectors using semantic similarity
   *
   * @example
   * ```typescript
   * const result = await client.vectorSearch({
   *   collection: "my-collection",
   *   vector: embedding,
   *   limit: 10,
   * });
   * ```
   */
  async vectorSearch(request: VectorSearchRequest): Promise<VectorSearchResponse> {
    return this.request<VectorSearchResponse>("POST", "/v1/vectors/search", request);
  }

  /**
   * Upsert vectors with payloads
   *
   * @example
   * ```typescript
   * await client.vectorUpsert({
   *   collection: "my-collection",
   *   points: [
   *     { id: "1", vector: embedding, payload: { content: "..." } },
   *   ],
   * });
   * ```
   */
  async vectorUpsert(request: VectorUpsertRequest): Promise<VectorUpsertResponse> {
    return this.request<VectorUpsertResponse>("POST", "/v1/vectors/upsert", request);
  }

  /**
   * Delete vectors by ID
   */
  async vectorDelete(
    collection: string,
    ids: Array<string | number>,
  ): Promise<{ deleted: number; collection: string; took: number }> {
    return this.request<{ deleted: number; collection: string; took: number }>(
      "POST",
      "/v1/vectors/delete",
      { collection, ids },
    );
  }

  /**
   * Scroll through vectors in a collection
   */
  async vectorScroll(request: VectorScrollRequest): Promise<VectorScrollResponse> {
    return this.request<VectorScrollResponse>("POST", "/v1/vectors/scroll", request);
  }

  /**
   * Get specific vectors by ID
   */
  async vectorGet(request: VectorGetRequest): Promise<VectorGetResponse> {
    return this.request<VectorGetResponse>("POST", "/v1/vectors/get", request);
  }

  /**
   * Create a payload index for efficient filtering
   *
   * @example
   * ```typescript
   * await client.createPayloadIndex({
   *   collection: "my-collection",
   *   fieldName: "type",
   *   fieldSchema: "keyword",
   * });
   * ```
   */
  async createPayloadIndex(request: CreatePayloadIndexRequest): Promise<CreatePayloadIndexResponse> {
    return this.request<CreatePayloadIndexResponse>("POST", "/v1/vectors/payload-index", request);
  }

  /**
   * Update payload on existing vectors
   *
   * @example
   * ```typescript
   * await client.setPayload({
   *   collection: "my-collection",
   *   payload: { status: "completed" },
   *   points: ["id1", "id2"],
   * });
   * ```
   */
  async setPayload(request: SetPayloadRequest): Promise<SetPayloadResponse> {
    return this.request<SetPayloadResponse>("POST", "/v1/vectors/payload", request);
  }

  /**
   * Count vectors matching a filter
   *
   * @example
   * ```typescript
   * const result = await client.vectorCount({
   *   collection: "my-collection",
   *   filter: { must: [{ key: "type", match: { value: "decision" } }] },
   * });
   * console.log(result.count);
   * ```
   */
  async vectorCount(request: VectorCountRequest): Promise<VectorCountResponse> {
    return this.request<VectorCountResponse>("POST", "/v1/vectors/count", request);
  }

  // ============================================
  // Collection Operations (API Proxy)
  // ============================================

  /**
   * List all collections
   */
  async listCollections(): Promise<ListCollectionsResponse> {
    return this.request<ListCollectionsResponse>("GET", "/v1/collections");
  }

  /**
   * Create a new collection
   *
   * @example
   * ```typescript
   * await client.createCollection({
   *   name: "my-collection",
   *   vectorSize: 3072,
   *   distance: "Cosine",
   * });
   * ```
   */
  async createCollection(request: CreateCollectionRequest): Promise<CreateCollectionResponse> {
    return this.request<CreateCollectionResponse>("POST", "/v1/collections", request);
  }

  /**
   * Get collection info
   */
  async getCollection(name: string): Promise<CollectionInfo> {
    return this.request<CollectionInfo>(
      "GET",
      `/v1/collections/${encodeURIComponent(name)}`,
    );
  }

  /**
   * Update collection configuration
   */
  async updateCollection(
    name: string,
    request: UpdateCollectionRequest,
  ): Promise<UpdateCollectionResponse> {
    return this.request<UpdateCollectionResponse>(
      "PATCH",
      `/v1/collections/${encodeURIComponent(name)}`,
      request,
    );
  }

  /**
   * Delete a collection
   */
  async deleteCollection(name: string): Promise<DeleteCollectionResponse> {
    return this.request<DeleteCollectionResponse>(
      "DELETE",
      `/v1/collections/${encodeURIComponent(name)}`,
    );
  }

  // ============================================
  // Chat/LLM Operations (API Proxy)
  // ============================================

  /**
   * Generate a chat completion (non-streaming)
   *
   * @example
   * ```typescript
   * const result = await client.chatComplete({
   *   model: "gpt-4o-mini",
   *   messages: [
   *     { role: "system", content: "You are helpful." },
   *     { role: "user", content: "Hello!" },
   *   ],
   * });
   * console.log(result.choices[0].message.content);
   * ```
   */
  async chatComplete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return this.request<ChatCompletionResponse>("POST", "/v1/chat/completions", {
      ...request,
      stream: false,
    });
  }

  /**
   * Generate a streaming chat completion
   *
   * Returns an async generator that yields stream events.
   *
   * @example
   * ```typescript
   * const stream = client.chatStream({
   *   model: "gpt-4o-mini",
   *   messages: [{ role: "user", content: "Tell me a story" }],
   * });
   *
   * for await (const event of stream) {
   *   if (event.type === "delta" && event.content) {
   *     process.stdout.write(event.content);
   *   }
   * }
   * ```
   */
  async *chatStream(
    request: Omit<ChatCompletionRequest, "stream">,
  ): AsyncGenerator<ChatStreamEvent> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };

    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }

    if (this.userId) {
      headers["X-User-ID"] = this.userId;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...request, stream: true }),
    });

    if (!response.ok) {
      const data = await response.json();
      parseApiError(response.status, data);
    }

    if (!response.body) {
      throw new NetworkError("No response body for streaming request");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    yield { type: "start" };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              yield { type: "end" };
              return;
            }

            try {
              const parsed = JSON.parse(data);
              if (parsed.error) {
                yield { type: "error", error: parsed.error.message };
                return;
              }

              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                yield { type: "delta", content };
              }
            } catch {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }

      yield { type: "end" };
    } finally {
      reader.releaseLock();
    }
  }

  // ============================================
  // Secrets Methods
  // ============================================

  /**
   * List all secrets with their status
   */
  async listSecrets(): Promise<ListSecretsResponse> {
    return this.request<ListSecretsResponse>("GET", "/v1/secrets");
  }

  /**
   * Get info about a specific secret
   */
  async getSecret(name: string): Promise<GetSecretResponse> {
    return this.request<GetSecretResponse>("GET", `/v1/secrets/${encodeURIComponent(name)}`);
  }

  /**
   * Create or update a secret
   */
  async setSecret(request: SetSecretRequest): Promise<SetSecretResponse> {
    return this.request<SetSecretResponse>("POST", "/v1/secrets", request);
  }

  /**
   * Delete a secret
   */
  async deleteSecret(name: string): Promise<DeleteSecretResponse> {
    return this.request<DeleteSecretResponse>("DELETE", `/v1/secrets/${encodeURIComponent(name)}`, { confirm: true });
  }

  /**
   * Validate a secret by testing its format or connection
   */
  async validateSecret(name: string): Promise<ValidateSecretResponse> {
    return this.request<ValidateSecretResponse>("POST", `/v1/secrets/${encodeURIComponent(name)}/validate`);
  }
}

/**
 * Create an Engram client from environment variables
 *
 * Uses:
 * - ENGRAM_URL (default: http://localhost:3100)
 * - ENGRAM_API_KEY
 */
export function createEngramClient(
  overrides?: Partial<EngramClientConfig>,
): EngramClient {
  const baseUrl = overrides?.baseUrl ?? process.env.ENGRAM_URL ?? "http://localhost:3100";
  const apiKey = overrides?.apiKey ?? process.env.ENGRAM_API_KEY;

  return new EngramClient({
    baseUrl,
    apiKey,
    ...overrides,
  });
}

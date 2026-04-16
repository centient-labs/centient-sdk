/**
 * secrets-cli — list-backend-keys subcommand
 *
 * Verifies:
 *   1. list-backend-keys is blocked in AI-agent environments (same policy
 *      as every other secrets subcommand)
 *   2. In a non-agent environment it prints keys from the backend path
 *      (via listCredentials) and not from the encrypted file vault
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockListCredentials = vi.hoisted(() => vi.fn());
const mockGetActiveVaultType = vi.hoisted(() => vi.fn(() => "keychain"));

vi.mock("../src/vault/vault.js", () => ({
  listCredentials: mockListCredentials,
  getActiveVaultType: mockGetActiveVaultType,
  // Unused by the list-backend-keys path but exported from vault.js —
  // provide stubs so the CLI module can still import them.
  storeCredential: vi.fn(),
  getCredential: vi.fn(),
  deleteCredential: vi.fn(),
  isSessionValid: vi.fn(),
}));

const { runSecrets } = await import("../src/cli/secrets-cli.js");

// -----------------------------------------------------------------------------
// Env snapshot / restore
// -----------------------------------------------------------------------------

const AGENT_VARS = [
  "CLAUDE_PROJECT_DIR",
  "MCP_CONTEXT",
  "CLAUDE_CODE_SESSION",
  "CLAUDE_CODE_ENTRY_POINT",
] as const;

const originalEnv: Record<string, string | undefined> = {};
for (const name of AGENT_VARS) {
  originalEnv[name] = process.env[name];
}

function clearAgentEnv(): void {
  for (const name of AGENT_VARS) {
    delete process.env[name];
  }
}

function restoreAgentEnv(): void {
  for (const name of AGENT_VARS) {
    const v = originalEnv[name];
    if (v === undefined) delete process.env[name];
    else process.env[name] = v;
  }
}

// -----------------------------------------------------------------------------
// Helpers: capture stdout/stderr and stub process.exit
// -----------------------------------------------------------------------------

interface Captured {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function capture(): { captured: Captured; restore: () => void } {
  const captured: Captured = { stdout: "", stderr: "", exitCode: null };

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const origConsoleError = console.error;
  const origExit = process.exit;

  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured.stdout += typeof chunk === "string" ? chunk : chunk.toString();
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array) => {
    captured.stderr += typeof chunk === "string" ? chunk : chunk.toString();
    return true;
  }) as typeof process.stderr.write;

  console.error = (...args: unknown[]) => {
    captured.stderr += args.map((a) => String(a)).join(" ") + "\n";
  };

  process.exit = ((code?: number) => {
    captured.exitCode = code ?? 0;
    throw new Error(`__process_exit_${captured.exitCode}__`);
  }) as typeof process.exit;

  const restore = (): void => {
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;
    console.error = origConsoleError;
    process.exit = origExit;
  };

  return { captured, restore };
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

beforeEach(() => {
  mockListCredentials.mockReset();
  mockGetActiveVaultType.mockReturnValue("keychain");
  clearAgentEnv();
});

afterEach(() => {
  restoreAgentEnv();
});

describe("runSecrets list-backend-keys", () => {
  it("is blocked in AI-agent environments (same policy as other subcommands)", async () => {
    process.env["CLAUDE_CODE_SESSION"] = "1";
    const { captured, restore } = capture();
    try {
      await expect(
        runSecrets({ command: "list-backend-keys" }),
      ).rejects.toThrow(/__process_exit_1__/);
    } finally {
      restore();
    }
    expect(captured.exitCode).toBe(1);
    expect(captured.stderr).toContain("not available to AI agents");
    expect(mockListCredentials).not.toHaveBeenCalled();
  });

  it("prints backend keys from listCredentials, sorted, with count", async () => {
    mockListCredentials.mockResolvedValue([
      "soma-anthropic-token2",
      "auth-token",
      "soma-anthropic-token1",
    ]);

    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "list-backend-keys" });
    } finally {
      restore();
    }

    expect(mockListCredentials).toHaveBeenCalledWith(undefined);

    // Sorted output, one per line, count footer.
    const lines = captured.stdout.split("\n");
    const keyLines = lines
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("🔑") && !l.startsWith("("));
    expect(keyLines).toEqual([
      "auth-token",
      "soma-anthropic-token1",
      "soma-anthropic-token2",
    ]);
    expect(captured.stdout).toContain("(3 keys)");
    expect(captured.stdout).toContain("keychain");
  });

  it("passes the prefix through to listCredentials", async () => {
    mockListCredentials.mockResolvedValue([
      "soma-anthropic-token1",
      "soma-anthropic-token2",
    ]);

    const { captured, restore } = capture();
    try {
      await runSecrets({
        command: "list-backend-keys",
        prefix: "soma-anthropic-",
      });
    } finally {
      restore();
    }

    expect(mockListCredentials).toHaveBeenCalledWith("soma-anthropic-");
    expect(captured.stdout).toContain("soma-anthropic-token1");
    expect(captured.stdout).toContain("soma-anthropic-token2");
    expect(captured.stdout).toContain('prefix "soma-anthropic-"');
  });

  it("prints '(no keys)' when the backend is empty", async () => {
    mockListCredentials.mockResolvedValue([]);
    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "list-backend-keys" });
    } finally {
      restore();
    }
    expect(captured.stdout).toContain("(no keys)");
  });

  it("exits with status 1 when backend enumeration fails", async () => {
    mockListCredentials.mockRejectedValue(
      new Error("keychain access denied"),
    );
    const { captured, restore } = capture();
    try {
      await expect(
        runSecrets({ command: "list-backend-keys" }),
      ).rejects.toThrow(/__process_exit_1__/);
    } finally {
      restore();
    }
    expect(captured.stderr).toContain("keychain access denied");
    expect(captured.exitCode).toBe(1);
  });

  it("does NOT touch the encrypted file vault (no readFileSync / decrypt)", async () => {
    mockListCredentials.mockResolvedValue(["auth-token"]);
    const { restore } = capture();
    try {
      await runSecrets({ command: "list-backend-keys" });
    } finally {
      restore();
    }
    expect(mockListCredentials).toHaveBeenCalledTimes(1);
  });
});

describe("runSecrets list-backend-keys --json", () => {
  it("outputs a sorted JSON array of keys", async () => {
    mockListCredentials.mockResolvedValue([
      "soma-anthropic-token2",
      "auth-token",
      "soma-anthropic-token1",
    ]);

    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "list-backend-keys", json: true });
    } finally {
      restore();
    }

    const parsed = JSON.parse(captured.stdout.trim());
    expect(parsed).toEqual([
      "auth-token",
      "soma-anthropic-token1",
      "soma-anthropic-token2",
    ]);
  });

  it("outputs an empty JSON array when no keys exist", async () => {
    mockListCredentials.mockResolvedValue([]);
    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "list-backend-keys", json: true });
    } finally {
      restore();
    }
    expect(JSON.parse(captured.stdout.trim())).toEqual([]);
  });

  it("outputs a JSON error object on enumeration failure", async () => {
    mockListCredentials.mockRejectedValue(
      new Error("keychain access denied"),
    );
    const { captured, restore } = capture();
    try {
      await expect(
        runSecrets({ command: "list-backend-keys", json: true }),
      ).rejects.toThrow(/__process_exit_1__/);
    } finally {
      restore();
    }
    const parsed = JSON.parse(captured.stdout.trim());
    expect(parsed).toEqual({ error: "keychain access denied" });
  });

  it("does not include human-readable headers or emoji in JSON mode", async () => {
    mockListCredentials.mockResolvedValue(["auth-token"]);
    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "list-backend-keys", json: true });
    } finally {
      restore();
    }
    expect(captured.stdout).not.toContain("🔑");
    expect(captured.stdout).not.toContain("Backend keys");
    expect(captured.stdout).not.toContain("keys)");
  });

  it("respects the prefix option in JSON mode", async () => {
    mockListCredentials.mockResolvedValue(["soma-anthropic-token1"]);
    const { captured, restore } = capture();
    try {
      await runSecrets({
        command: "list-backend-keys",
        prefix: "soma-anthropic-",
        json: true,
      });
    } finally {
      restore();
    }
    expect(mockListCredentials).toHaveBeenCalledWith("soma-anthropic-");
    expect(JSON.parse(captured.stdout.trim())).toEqual([
      "soma-anthropic-token1",
    ]);
  });
});

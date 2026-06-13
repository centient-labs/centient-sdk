/**
 * Tests for {@link resolveRealPathWithinRoots}.
 *
 * Uses an injected fake `fs.realpath` so symlink behavior is deterministic and
 * no real filesystem is touched. The fake maps a configured set of paths to
 * their "real" targets and raises ENOENT for anything unknown (mirroring the
 * deepest-existing-ancestor walk the guard performs).
 */

import { describe, expect, it } from "vitest";

import {
  resolveRealPathWithinRoots,
  RealpathGuardError,
  type RealpathFs,
} from "../src/index.js";

const ROOT = "/srv/app/data";

/** Build a fake realpath fs from an explicit path->realpath map. */
function fakeFs(map: Record<string, string>): RealpathFs {
  return {
    async realpath(p: string): Promise<string> {
      if (p in map) {
        return map[p] as string;
      }
      const err = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    },
  };
}

describe("resolveRealPathWithinRoots", () => {
  it("rejects lexical traversal before touching the filesystem", async () => {
    const result = await resolveRealPathWithinRoots(`${ROOT}/../etc`, {
      allowedRoots: [ROOT],
      fs: fakeFs({}),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRAVERSAL");
    }
  });

  it("accepts a path whose real target stays inside the root", async () => {
    const target = `${ROOT}/real/file.txt`;
    const result = await resolveRealPathWithinRoots(`${ROOT}/link/file.txt`, {
      allowedRoots: [ROOT],
      fs: fakeFs({ [`${ROOT}/link/file.txt`]: target }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Returns the lexically-resolved path, matching validateWithinRoots.
      expect(result.value).toBe(`${ROOT}/link/file.txt`);
    }
  });

  it("rejects when a symlink resolves OUTSIDE the root (the core threat)", async () => {
    // Lexically contained, but realpath points at /etc — classic symlink escape.
    const result = await resolveRealPathWithinRoots(`${ROOT}/evil`, {
      allowedRoots: [ROOT],
      fs: fakeFs({ [`${ROOT}/evil`]: "/etc/passwd" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("OUTSIDE_ROOTS");
    }
  });

  it("catches a symlinked INTERMEDIATE directory (missing leaf)", async () => {
    // The leaf doesn't exist, but its parent dir is a symlink out of the root.
    // The guard must walk up to the deepest existing ancestor and catch it.
    const result = await resolveRealPathWithinRoots(`${ROOT}/linkdir/new.txt`, {
      allowedRoots: [ROOT],
      fs: fakeFs({ [`${ROOT}/linkdir`]: "/var/elsewhere" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("OUTSIDE_ROOTS");
    }
  });

  it("allows a not-yet-existing leaf under a real in-root directory", async () => {
    // Nothing on the path exists except the root itself, which is in-root.
    const result = await resolveRealPathWithinRoots(`${ROOT}/sub/new.txt`, {
      allowedRoots: [ROOT],
      fs: fakeFs({ [ROOT]: ROOT }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(`${ROOT}/sub/new.txt`);
    }
  });

  it("propagates an unexpected fs error (EACCES), wrapped with probe context and original cause", async () => {
    // ENOENT/ENOTDIR drive the walk-up; any other errno is genuinely
    // unexpected and must surface (no silent degradation), not be treated as a
    // missing path. The guard wraps it with the failing probe and the original
    // error as `cause`.
    const fs: RealpathFs = {
      async realpath(p: string): Promise<string> {
        const err = new Error(`EACCES: ${p}`) as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      },
    };
    await expect(
      resolveRealPathWithinRoots(`${ROOT}/sub/new.txt`, {
        allowedRoots: [ROOT],
        fs,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("EACCES"),
      cause: expect.objectContaining({ code: "EACCES" }),
    });

    // The wrapped error is a typed RealpathGuardError carrying the failing
    // operation, the exact probe path, and the original errno code as
    // first-class properties (not just text) so callers can branch on them.
    const caught = await resolveRealPathWithinRoots(`${ROOT}/sub/new.txt`, {
      allowedRoots: [ROOT],
      fs,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(caught).toBeInstanceOf(RealpathGuardError);
    const guardErr = caught as RealpathGuardError;
    expect(guardErr.operation).toBe("realpath");
    expect(guardErr.probe).toBe(`${ROOT}/sub/new.txt`);
    expect(guardErr.code).toBe("EACCES");
  });

  it("propagates a non-errno fs error, wrapped with probe context and original cause", async () => {
    // A thrown value with no `code` is not an ErrnoException — it cannot be a
    // missing-path signal, so it must propagate (wrapped), never be swallowed.
    const boom = new Error("boom — not an errno");
    const fs: RealpathFs = {
      async realpath(): Promise<string> {
        throw boom;
      },
    };
    await expect(
      resolveRealPathWithinRoots(`${ROOT}/sub/new.txt`, {
        allowedRoots: [ROOT],
        fs,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("fs.realpath failed"),
      cause: boom,
    });

    // Non-errno path: code collapses to "unknown" but the typed wrapper still
    // names the operation and probe, and preserves the original via `cause`.
    const caught = await resolveRealPathWithinRoots(`${ROOT}/sub/new.txt`, {
      allowedRoots: [ROOT],
      fs,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(caught).toBeInstanceOf(RealpathGuardError);
    const guardErr = caught as RealpathGuardError;
    expect(guardErr.operation).toBe("realpath");
    expect(guardErr.probe).toBe(`${ROOT}/sub/new.txt`);
    expect(guardErr.code).toBe("unknown");
    expect(guardErr.cause).toBe(boom);
  });
});

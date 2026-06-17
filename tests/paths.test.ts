/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { slugify, ensureProjectDirs, resolveProjectDirectory } from "../src/utils/paths";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, existsSync } from "node:fs";

describe("slugify", () => {
  it("converts description to kebab-case slug", () => {
    expect(slugify("Build auth system")).toBe("build-auth-system");
  });

  it("truncates to 50 chars", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBe(50);
  });

  it("handles special characters", () => {
    expect(slugify("Auth & OAuth2!!!")).toBe("auth-oauth2");
  });
});

describe("ensureProjectDirs", () => {
  const tmpDir = join(tmpdir(), `oro-dirs-${Date.now()}`);

  it.afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates all three directories", () => {
    const dirs = ensureProjectDirs(tmpDir);
    expect(existsSync(dirs.plansDir)).toBe(true);
    expect(existsSync(dirs.todoDir)).toBe(true);
    expect(existsSync(dirs.missionsDir)).toBe(true);
  });
});

describe("resolveProjectDirectory", () => {
  it("finds parent above .opencode", () => {
    expect(resolveProjectDirectory("/home/user/project/.opencode/missions/foo.json", "/fallback")).toBe("/home/user/project");
  });

  it("falls back to workspace when no .opencode", () => {
    expect(resolveProjectDirectory("/home/user/project/src/main.ts", "/fallback")).toBe("/fallback");
  });
});

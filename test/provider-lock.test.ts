import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { lockProviderToOllama } from "../src/utils/provider-lock.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("provider-lock (no-op mode)", () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "provlock-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    if (originalHome) process.env.HOME = originalHome;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeOpencodeJson(content: any, pathParts: string[] = [".config", "opencode"]) {
    const dir = join(tmpDir, ...pathParts);
    const { mkdirSync } = require("node:fs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "opencode.json"), JSON.stringify(content), "utf-8");
  }

  it("never throws for any model or provider", async () => {
    writeOpencodeJson({
      model: "openai/gpt-4o",
      agent: {
        strategist: { model: "anthropic/claude-sonnet-4" },
        architect: { model: "google/gemini-2.5-pro" },
      },
    });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(lockProviderToOllama(null)).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("logs default model when set", async () => {
    writeOpencodeJson({ model: "ollama/deepseek-v4-pro" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await lockProviderToOllama(null);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Provider lock DISABLED"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("default: ollama/deepseek-v4-pro"));
    spy.mockRestore();
  });

  it("logs '(unset)' when no model configured", async () => {
    writeOpencodeJson({});
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await lockProviderToOllama(null);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("default: (unset"));
    spy.mockRestore();
  });

  it("logs per-agent models", async () => {
    writeOpencodeJson({
      agent: {
        strategist: { model: "a/b" },
        engineer: { model: "c/d" },
        helper: {}, // no model
      },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await lockProviderToOllama(null);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("strategist: a/b"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("engineer: c/d"));
    // 'helper' has no model → not logged
    const helperCall = spy.mock.calls.find((c) =>
      String(c[0]).includes("helper:")
    );
    expect(helperCall).toBeUndefined();
    spy.mockRestore();
  });

  it("handles missing config gracefully", async () => {
    // Don't write any opencode.json
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(lockProviderToOllama(null)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("(unset"));
    spy.mockRestore();
  });

  it("reads from ~/.opencode/ fallback when ~/.config/opencode/ missing", async () => {
    writeOpencodeJson({ model: "fallback-model" }, [".opencode"]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await lockProviderToOllama(null);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("fallback-model"));
    spy.mockRestore();
  });

  it("ignores malformed JSON silently", async () => {
    const dir = join(tmpDir, ".config", "opencode");
    const { mkdirSync } = require("node:fs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "opencode.json"), "not-json{", "utf-8");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(lockProviderToOllama(null)).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

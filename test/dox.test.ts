import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isDoxInitialized,
  doxInit,
  writeDoxRunHeader,
  appendDoxLog,
  doxCloseout,
  doxCheck,
  type DoxEnv,
} from "../src/utils/dox.js";

describe("isDoxInitialized", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "dox-init-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns false when .opencode/DOX does not exist", () => {
    expect(isDoxInitialized(tmpDir)).toBe(false);
  });

  it("returns true when .opencode/DOX exists", () => {
    mkdirSync(join(tmpDir, ".opencode", "DOX"), { recursive: true });
    expect(isDoxInitialized(tmpDir)).toBe(true);
  });

  it("returns true when DOX dir exists at project root", () => {
    mkdirSync(join(tmpDir, "DOX"), { recursive: true });
    expect(isDoxInitialized(tmpDir)).toBe(true);
  });
});

describe("doxInit", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "dox-init-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .opencode/DOX directory", () => {
    doxInit(tmpDir, "run-001");
    expect(existsSync(join(tmpDir, ".opencode", "DOX"))).toBe(true);
  });

  it("creates AGENTS.md with correct content", () => {
    doxInit(tmpDir, "run-001");
    const agentsMd = join(tmpDir, ".opencode", "AGENTS.md");
    expect(existsSync(agentsMd)).toBe(true);
    const content = readFileSync(agentsMd, "utf-8");
    expect(content).toContain("strategist");
    expect(content).toContain("architect");
    expect(content).toContain("engineer");
    expect(content).toContain("auditor");
    expect(content).toContain("specialist");
    expect(content).toContain("DOX Contract");
    expect(content).toContain("Max 3 concurrent workers");
  });

  it("returns correct paths", () => {
    const result = doxInit(tmpDir, "run-002");
    expect(result.doxDir).toBe(join(tmpDir, ".opencode", "DOX"));
    expect(result.runFile).toBe(join(tmpDir, ".opencode", "DOX", "run-002.md"));
  });

  it("is idempotent — does not overwrite existing AGENTS.md", () => {
    const customContent = "# Custom Contract\n\nHello.";
    mkdirSync(join(tmpDir, ".opencode"), { recursive: true });
    writeFileSync(join(tmpDir, ".opencode", "AGENTS.md"), customContent, "utf-8");

    doxInit(tmpDir, "run-003");
    const content = readFileSync(join(tmpDir, ".opencode", "AGENTS.md"), "utf-8");
    expect(content).toBe(customContent);
  });
});

describe("writeDoxRunHeader", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "dox-header-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes markdown with frontmatter, models list, tasks, files touched", () => {
    const env: DoxEnv = {
      projectDir: tmpDir,
      slug: "mission-001",
      missionId: "M-001",
      description: "Refactor auth module",
      startedAt: 1700000000000,
      status: "in_progress",
      todos: [
        { id: "TASK-001", description: "Break monolith", status: "pending" },
      ],
      modelsUsed: ["mistral", "codellama"],
      filesTouched: ["src/auth.ts", "tests/auth.test.ts"],
    };

    writeDoxRunHeader(env);
    const runFile = join(tmpDir, ".opencode", "DOX", "mission-001.md");
    expect(existsSync(runFile)).toBe(true);

    const content = readFileSync(runFile, "utf-8");
    expect(content).toContain("machine: opencode-orchestrator");
    expect(content).toContain("slug: mission-001");
    expect(content).toContain("status: in_progress");
    expect(content).toContain("# Refactor auth module");
    expect(content).toContain("- mistral");
    expect(content).toContain("- codellama");
    expect(content).toContain("- [ ] TASK-001: Break monolith");
    expect(content).toContain("src/auth.ts");
    expect(content).toContain("tests/auth.test.ts");
    expect(content).toContain("Evidence Log");
  });
});

describe("appendDoxLog", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "dox-log-"));
    mkdirSync(join(tmpDir, ".opencode", "DOX"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends timestamped line to existing run file", () => {
    const runFile = join(tmpDir, ".opencode", "DOX", "run-004.md");
    writeFileSync(runFile, "# Header\n\n", "utf-8");

    appendDoxLog(tmpDir, "run-004", "Engineer finished TASK-001");
    const content = readFileSync(runFile, "utf-8");
    expect(content).toContain("Engineer finished TASK-001");
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}T/); // ISO timestamp
  });

  it("is no-op when run file is missing", () => {
    // Should not throw even though run file does not exist
    expect(() => appendDoxLog(tmpDir, "run-missing", "oops")).not.toThrow();
    const runFile = join(tmpDir, ".opencode", "DOX", "run-missing.md");
    expect(existsSync(runFile)).toBe(false);
  });
});

describe("doxCloseout", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "dox-closeout-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends footer with ended_at, status, task counts", () => {
    const env: DoxEnv = {
      projectDir: tmpDir,
      slug: "closeout-run",
      missionId: "M-CO",
      description: "Finish things",
      startedAt: 1700000000000,
      status: "completed",
      todos: [
        { id: "T1", description: "A", status: "completed" },
        { id: "T2", description: "B", status: "completed" },
        { id: "T3", description: "C", status: "pending" },
      ],
      modelsUsed: ["llama"],
      filesTouched: [],
    };

    writeDoxRunHeader(env);
    doxCloseout(env);

    const runFile = join(tmpDir, ".opencode", "DOX", "closeout-run.md");
    const content = readFileSync(runFile, "utf-8");
    expect(content).toContain("ended_at:");
    expect(content).toContain("status: completed");
    expect(content).toContain("tasks_completed: 2/3");
  });

  it("updates AGENTS.md with run summary", () => {
    const env: DoxEnv = {
      projectDir: tmpDir,
      slug: "summary-run",
      missionId: "M-SUM",
      description: "Summary test",
      startedAt: 1700000000000,
      status: "failed",
      todos: [
        { id: "T1", description: "Only task", status: "failed" },
      ],
      modelsUsed: [],
      filesTouched: [],
    };

    writeDoxRunHeader(env);
    doxCloseout(env);

    const agentsMd = join(tmpDir, ".opencode", "AGENTS.md");
    const content = readFileSync(agentsMd, "utf-8");
    expect(content).toContain("### Run summary-run");
    expect(content).toContain("Status: failed");
    expect(content).toContain("Completed: 0/1");
  });
});

describe("doxCheck", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "dox-check-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns ok:true with empty missing/warnings when all present", () => {
    mkdirSync(join(tmpDir, ".opencode", "plans"), { recursive: true });
    mkdirSync(join(tmpDir, ".opencode", "todo"), { recursive: true });
    mkdirSync(join(tmpDir, ".opencode", "DOX"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".opencode", "AGENTS.md"),
      `# DOX Contract
## Agents
- **strategist**: Orchestrator primary
- **architect**: Planner subagent

## Runtimes
- State persistence: .opencode/plans/
`,
      "utf-8"
    );

    const result = doxCheck(tmpDir);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("detects missing directories", () => {
    const result = doxCheck(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("AGENTS.md contract");
    expect(result.missing).toContain("plans directory");
    expect(result.missing).toContain("todo directory");
    expect(result.missing).toContain("DOX directory");
  });

  it("warns when AGENTS.md missing orchestrator content", () => {
    mkdirSync(join(tmpDir, ".opencode", "plans"), { recursive: true });
    mkdirSync(join(tmpDir, ".opencode", "todo"), { recursive: true });
    mkdirSync(join(tmpDir, ".opencode", "DOX"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".opencode", "AGENTS.md"),
      `# Minimal Contract\n\nNo agents here.\n`,
      "utf-8"
    );

    const result = doxCheck(tmpDir);
    expect(result.warnings).toContain(
      "AGENTS.md missing orchestrator agent definitions"
    );
    expect(result.warnings).toContain(
      "AGENTS.md missing path references"
    );
  });
});

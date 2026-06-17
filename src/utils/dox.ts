/**
 * DOX Framework Integration — Automatic init / check / closeout
 *
 * DOX = "Documentation of Execution". OpenCode users place DOX config in:
 *   ~/.config/opencode/skills/dox-system/   (global)
 *   ~/.config/opencode/AGENTS.md            (global contract)
 *   {project}/.opencode/AGENTS.md         (project contract)
 *
 * Our plugin auto-integrates by:
 *   1. Detecting DOX presence (AGENTS.md or .opencode/DOX/)
 *   2. Auto-initializing DOX workspace on first mission
 *   3. Appending a run-record to .opencode/DOX/ on completion
 *   4. Updating AGENTS.md with orchestrator entries
 */
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

export interface DoxEnv {
	projectDir: string;
	slug: string;
	missionId: string;
	description: string;
	startedAt: number;
	endedAt?: number;
	status: string;
	todos: Array<{ id: string; description: string; status: string }>;
	modelsUsed: string[];
	tokens?: number;
	filesTouched: string[];
}

/**
 * Check if DOX framework is already initialized in the project.
 * Returns true if .opencode/DOX/ or DOX/ directory exists.
 */
export function isDoxInitialized(projectDir: string): boolean {
	return (
		existsSync(join(projectDir, ".opencode", "DOX")) ||
		existsSync(join(projectDir, "DOX"))
	);
}

/**
 * DOX init — create .opencode/DOX/ and seed first run record if missing.
 * Safe to call multiple times (idempotent).
 */
export function doxInit(
	projectDir: string,
	slug: string,
): { runFile: string; doxDir: string } {
	const doxDir = join(projectDir, ".opencode", "DOX");
	mkdirSync(doxDir, { recursive: true });

	// Seed AGENTS.md with orchestrator context if not present
	const agentsMd = join(projectDir, ".opencode", "AGENTS.md");
	if (!existsSync(agentsMd)) {
		writeFileSync(
			agentsMd,
			`# DOX Contract — ${basename(projectDir)}

## Agents
- **strategist**: Orchestrator primary — auto-detects missions, dispatches subagents.
- **architect**: Planner subagent — decomposes missions into tasks.
- **engineer**: Implementer subagent — writes code.
- **auditor**: Verifier subagent — checks critical-path outputs.
- **specialist**: Diagnostic subagent — unstuck recovery.

## Runtimes
- Max 3 concurrent workers (adjustable via plugin config)
- State persistence: .opencode/plans/ + .opencode/todo/ + .opencode/DOX/
`,
			"utf-8",
		);
	}

	const runFile = join(doxDir, `${slug}.md`);
	return { runFile, doxDir };
}

/**
 * Write the initial DOX run header.
 */
export function writeDoxRunHeader(env: DoxEnv) {
	const { runFile } = doxInit(env.projectDir, env.slug);
	const ts = new Date(env.startedAt).toISOString();
	const header = `---\nmachine: opencode-orchestrator\ncommand: automatic-mission\nslug: ${env.slug}\nstarted_at: ${ts}\nstatus: in_progress\n---\n\n# ${env.description}\n\n## Models\n${env.modelsUsed.map((m) => `- ${m}`).join("\n")}\n\n## Tasks\n${env.todos.map((t) => `- [ ] ${t.id}: ${t.description}`).join("\n")}\n\n## Files Touched\n${env.filesTouched.map((f) => `- ${f}`).join("\n")}\n\n## Evidence Log\n\n`;
	writeFileSync(runFile, header, "utf-8");
}

/**
 * Append a log line to the active DOX run.
 */
export function appendDoxLog(projectDir: string, slug: string, line: string) {
	const runFile = join(projectDir, ".opencode", "DOX", `${slug}.md`);
	if (existsSync(runFile)) {
		appendFileSync(
			runFile,
			`- ${new Date().toISOString()} — ${line}\n`,
			"utf-8",
		);
	}
}

/**
 * Closeout — finalize the DOX run and append summary to AGENTS.md.
 */
export function doxCloseout(env: DoxEnv) {
	const { runFile } = doxInit(env.projectDir, env.slug);
	const endTs = env.endedAt
		? new Date(env.endedAt).toISOString()
		: new Date().toISOString();

	const footer = `\n---\nended_at: ${endTs}\nstatus: ${env.status}\ntasks_completed: ${env.todos.filter((t) => t.status === "completed").length}/${env.todos.length}\n---\n`;
	appendFileSync(runFile, footer, "utf-8");

	// Append run summary to AGENTS.md
	const agentsMd = join(env.projectDir, ".opencode", "AGENTS.md");
	if (existsSync(agentsMd)) {
		const entry = `\n### Run ${env.slug}\n- Status: ${env.status}\n- Completed: ${env.todos.filter((t) => t.status === "completed").length}/${env.todos.length}\n- Ended: ${endTs}\n`;
		appendFileSync(agentsMd, entry, "utf-8");
	}
}

/**
 * Quick DOX check — verifies workspace integrity.
 */
export function doxCheck(projectDir: string): {
	ok: boolean;
	missing: string[];
	warnings: string[];
} {
	const checks: { path: string; label: string }[] = [
		{
			path: join(projectDir, ".opencode", "AGENTS.md"),
			label: "AGENTS.md contract",
		},
		{ path: join(projectDir, ".opencode", "plans"), label: "plans directory" },
		{ path: join(projectDir, ".opencode", "todo"), label: "todo directory" },
		{ path: join(projectDir, ".opencode", "DOX"), label: "DOX directory" },
	];

	const missing: string[] = [];
	const warnings: string[] = [];

	for (const c of checks) {
		if (!existsSync(c.path)) missing.push(c.label);
	}

	// Warn if AGENTS.md missing orchestrator section
	const agentsMd = join(projectDir, ".opencode", "AGENTS.md");
	if (existsSync(agentsMd)) {
		const content = readFileSync(agentsMd, "utf-8");
		if (!content.includes("strategist"))
			warnings.push("AGENTS.md missing orchestrator agent definitions");
		if (!content.includes(".opencode/plans"))
			warnings.push("AGENTS.md missing path references");
	}

	return { ok: missing.length === 0, missing, warnings };
}

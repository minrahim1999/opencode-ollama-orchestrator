/**
 * Structured JSON logger for production observability.
 * Logs to both stderr (for TUI visibility) and a daily-rotated JSON file.
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LEVELS: Record<LogLevel, number> = {
	trace: 0,
	debug: 1,
	info: 2,
	warn: 3,
	error: 4,
	fatal: 5,
};

interface LogEntry {
	ts: string;
	level: LogLevel;
	component: string;
	msg: string;
	meta?: Record<string, unknown>;
}

/** Simple in-memory buffer + periodic flush for minimal overhead */
class LoggerImpl {
	private minLevel: LogLevel = "info";
	private logDir: string | null = null;
	private buffer: LogEntry[] = [];
	private flushTimer: ReturnType<typeof setInterval> | null = null;
	private readonly BUFFER_LIMIT = 100;
	private readonly FLUSH_INTERVAL_MS = 5000;

	/** Initialize with project directory */
	init(projectDir: string, minLevel: LogLevel = "info") {
		this.minLevel = minLevel;
		this.logDir = join(projectDir, ".opencode", "logs");
		try {
			if (!existsSync(this.logDir)) {
				mkdirSync(this.logDir, { recursive: true });
			}
		} catch {
			this.logDir = null;
		}
		this.startFlushTimer();
	}

	private startFlushTimer() {
		if (this.flushTimer) return;
		this.flushTimer = setInterval(() => this.flush(), this.FLUSH_INTERVAL_MS);
	}

	/** Stop flush timer (for graceful shutdown) */
	stop() {
		if (this.flushTimer) {
			clearInterval(this.flushTimer);
			this.flushTimer = null;
		}
		this.flush();
	}

	log(
		level: LogLevel,
		component: string,
		msg: string,
		meta?: Record<string, unknown>,
	) {
		if (LEVELS[level] < LEVELS[this.minLevel]) return;

		const entry: LogEntry = {
			ts: new Date().toISOString(),
			level,
			component,
			msg,
			meta,
		};

		// Always emit to stderr for TUI visibility
		const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
		console.error(
			`[opencode-orchestrator] ${level.toUpperCase()} [${component}] ${msg}${metaStr}`,
		);

		// Buffer for file write
		this.buffer.push(entry);
		if (this.buffer.length >= this.BUFFER_LIMIT) {
			this.flush();
		}
	}

	private flush() {
		if (!this.logDir || this.buffer.length === 0) return;

		const lines = `${this.buffer.map((e) => JSON.stringify(e)).join("\n")}\n`;
		const date = new Date().toISOString().slice(0, 10);
		const logFile = join(this.logDir, `orchestrator-${date}.ndjson`);

		try {
			appendFileSync(logFile, lines);
			this.buffer = [];
		} catch (err) {
			// Can't write log — emit to stderr
			console.error(`[opencode-orchestrator] Logger flush failed:`, err);
		}
	}

	/** Rotate old log files (keep last 7 days) */
	rotate(projectDir: string): void {
		try {
			const dir = join(projectDir, ".opencode", "logs");
			const { readdirSync, statSync, rmSync } = require("node:fs");
			if (!existsSync(dir)) return;
			const now = Date.now();
			const MAX_AGE_DAYS = 7;
			const MS_PER_DAY = 24 * 60 * 60 * 1000;
			for (const entry of readdirSync(dir)) {
				const path = join(dir, entry);
				const stat = statSync(path);
				if (now - stat.mtimeMs > MAX_AGE_DAYS * MS_PER_DAY) {
					rmSync(path, { force: true });
				}
			}
		} catch {
			// Ignore rotation errors
		}
	}
}

export const Logger = new LoggerImpl();

// Convenience methods
export function logTrace(
	component: string,
	msg: string,
	meta?: Record<string, unknown>,
) {
	Logger.log("trace", component, msg, meta);
}
export function logDebug(
	component: string,
	msg: string,
	meta?: Record<string, unknown>,
) {
	Logger.log("debug", component, msg, meta);
}
export function logInfo(
	component: string,
	msg: string,
	meta?: Record<string, unknown>,
) {
	Logger.log("info", component, msg, meta);
}
export function logWarn(
	component: string,
	msg: string,
	meta?: Record<string, unknown>,
) {
	Logger.log("warn", component, msg, meta);
}
export function logError(
	component: string,
	msg: string,
	meta?: Record<string, unknown>,
) {
	Logger.log("error", component, msg, meta);
}
export function logFatal(
	component: string,
	msg: string,
	meta?: Record<string, unknown>,
) {
	Logger.log("fatal", component, msg, meta);
}

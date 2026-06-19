/**
 * Backup / Revert utility for the orchestrator.
 * Tries git first (stash or commit), falls back to directory snapshot.
 */
import { execFileSync, execSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { join } from "node:path";

interface BackupResult {
	type: "git_stash" | "git_commit" | "directory" | "none";
	path?: string;
	commitHash?: string;
}

const BACKUP_DIR = ".opencode-backups";
const MAX_BACKUPS = 10; // Keep last 10 mission backups

// Files/dirs to skip in both backup and restore (sensitive + non-essential)
const SKIP_NAMES = new Set([
	"node_modules",
	".git",
	BACKUP_DIR,
	".opencode",
	".env",
	".env.local",
	".env.production",
	".env.staging",
]);

/** Check if directory is inside a git repo */
function isGitRepo(dir: string): boolean {
	try {
		execSync("git rev-parse --git-dir", { cwd: dir, stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

/** Get current git status to see if there are uncommitted changes */
function hasUncommittedChanges(dir: string): boolean {
	try {
		const status = execSync("git status --porcelain", {
			cwd: dir,
			encoding: "utf-8",
			stdio: "pipe",
		});
		return status.trim().length > 0;
	} catch {
		return false;
	}
}

/** Create backup before mission execution */
export function createBackup(
	directory: string,
	missionSlug: string,
): BackupResult {
	const timestamp = Date.now();

	// Strategy 1: Git stash (if git repo and uncommitted changes)
	if (isGitRepo(directory)) {
		if (hasUncommittedChanges(directory)) {
			try {
				const stashMsg = `opencode-backup:${missionSlug}:${timestamp}`;
				execFileSync(
					"git",
					["stash", "push", "-m", stashMsg, "--include-untracked"],
					{ cwd: directory, stdio: "pipe" },
				);
				// Get stash ref
				const stashList = execFileSync("git", ["stash", "list"], {
					cwd: directory,
					encoding: "utf-8",
					stdio: "pipe",
				});
				const lines = stashList.trim().split("\n");
				const match = lines.find((l) => l.includes(stashMsg));
				const stashRef = match ? match.split(":")[0] : undefined;
				return { type: "git_stash", path: stashRef };
			} catch {
				// Stash failed — try strategy 2
			}
		}

		// Strategy 2: Git commit (if clean working tree, create empty commit as marker)
		try {
			execFileSync(
				"git",
				[
					"commit",
					"--allow-empty",
					"-m",
					`opencode-backup:${missionSlug}:${timestamp}`,
				],
				{ cwd: directory, stdio: "pipe" },
			);
			const hash = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: directory,
				encoding: "utf-8",
				stdio: "pipe",
			}).trim();
			return { type: "git_commit", commitHash: hash };
		} catch {
			// Commit failed — fall through
		}
	}

	// Strategy 3: Directory snapshot
	try {
		const backupRoot = join(directory, BACKUP_DIR);
		if (!existsSync(backupRoot)) mkdirSync(backupRoot, { recursive: true });

		// Clean old backups
		cleanupOldBackups(backupRoot);

		const snapshotDir = join(backupRoot, `${missionSlug}-${timestamp}`);
		mkdirSync(snapshotDir, { recursive: true });

		// Copy relevant files (skip sensitive + non-essential)
		const entries = readdirSync(directory, { withFileTypes: true });
		for (const entry of entries) {
			if (SKIP_NAMES.has(entry.name)) continue;
			const src = join(directory, entry.name);
			const dest = join(snapshotDir, entry.name);
			try {
				cpSync(src, dest, { recursive: true, force: true });
			} catch {
				// Skip files we can't copy
			}
		}

		return { type: "directory", path: snapshotDir };
	} catch {
		// Backup completely failed
		return { type: "none" };
	}
}

/** Revert to backup after mission */
export function revertBackup(directory: string, backup: BackupResult): boolean {
	if (backup.type === "none") return false;

	if (backup.type === "git_stash" && backup.path) {
		try {
			// Use execFileSync to avoid shell injection
			execFileSync("git", ["stash", "pop", backup.path], {
				cwd: directory,
				stdio: "pipe",
			});
			return true;
		} catch {
			return false;
		}
	}

	if (backup.type === "git_commit" && backup.commitHash) {
		try {
			// Hard reset to before the backup commit — reverts files too
			execFileSync("git", ["reset", "--hard", `${backup.commitHash}^`], {
				cwd: directory,
				stdio: "pipe",
			});
			return true;
		} catch {
			return false;
		}
	}

	if (backup.type === "directory" && backup.path) {
		try {
			// Copy snapshot files back to project directory
			const snapshotEntries = readdirSync(backup.path, { withFileTypes: true });
			const snapshotNames = new Set(snapshotEntries.map((e) => e.name));

			for (const entry of snapshotEntries) {
				if (SKIP_NAMES.has(entry.name)) continue;
				const src = join(backup.path, entry.name);
				const dest = join(directory, entry.name);
				try {
					cpSync(src, dest, { recursive: true, force: true });
				} catch {
					// Skip files we can't restore
				}
			}

			// Delete files that exist in project but NOT in snapshot (created during mission)
			const currentEntries = readdirSync(directory, { withFileTypes: true });
			for (const entry of currentEntries) {
				if (SKIP_NAMES.has(entry.name)) continue;
				if (!snapshotNames.has(entry.name)) {
					try {
						rmSync(join(directory, entry.name), {
							recursive: true,
							force: true,
						});
					} catch {
						// Ignore deletion errors
					}
				}
			}

			return true;
		} catch {
			return false;
		}
	}

	return false;
}

/** Delete a backup to free space */
export function deleteBackup(backup: BackupResult): void {
	if (backup.type === "directory" && backup.path && existsSync(backup.path)) {
		try {
			rmSync(backup.path, { recursive: true, force: true });
		} catch {
			// Ignore cleanup failures
		}
	}
}

/** Keep only the last N directory backups */
function cleanupOldBackups(backupRoot: string): void {
	try {
		const entries = readdirSync(backupRoot, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => ({
				name: e.name,
				path: join(backupRoot, e.name),
				mtime: statSync(join(backupRoot, e.name)).mtimeMs,
			}))
			.sort((a, b) => b.mtime - a.mtime); // newest first

		if (entries.length > MAX_BACKUPS) {
			for (const old of entries.slice(MAX_BACKUPS)) {
				try {
					rmSync(old.path, { recursive: true, force: true });
				} catch {
					// Ignore cleanup failures
				}
			}
		}
	} catch {
		// Ignore cleanup errors
	}
}

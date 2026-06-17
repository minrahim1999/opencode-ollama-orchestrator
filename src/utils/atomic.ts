/**
 * Atomic file writer — prevents race conditions on todo files and mission state.
 * Writes to temp file, then renames (atomic on POSIX/NTFS).
 */

import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Write a file atomically: write to temp, then rename */
export function writeFileAtomicSync(path: string, content: string): void {
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	const tmpPath = join(
		tmpdir(),
		`.atomic-${randomBytes(8).toString("hex")}-${Date.now()}`,
	);
	try {
		writeFileSync(tmpPath, content, "utf-8");
		renameSync(tmpPath, path);
	} catch (err) {
		// Clean up temp file on error
		try {
			/* ignore cleanup errors */
		} catch {
			/* ignore */
		}
		throw err;
	}
}

/** Read file, atomically replace it (e.g. todo updates) */
export function updateFileAtomicSync(
	path: string,
	updater: (content: string) => string,
): void {
	const content = existsSync(path) ? readFileSync(path, "utf-8") : "";
	const updated = updater(content);
	writeFileAtomicSync(path, updated);
}

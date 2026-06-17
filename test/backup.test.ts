import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackup, revertBackup, deleteBackup } from "../src/utils/backup.js";

describe("Backup — directory strategy", () => {
	function makeProject() {
		const dir = mkdtempSync(join(tmpdir(), "orbak-"));
		writeFileSync(join(dir, "readme.txt"), "original");
		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(join(dir, "src", "main.ts"), "export const x = 1;");
		return dir;
	}

	it("creates directory snapshot", () => {
		const dir = makeProject();
		const backup = createBackup(dir, "test-mission");
		expect(backup.type).toBe("directory");
		expect(backup.path).toBeTruthy();
		expect(existsSync(backup.path!)).toBe(true);
	});

	it("snapshot excludes node_modules and .git", () => {
		const dir = makeProject();
		mkdirSync(join(dir, "node_modules", "foo"), { recursive: true });
		writeFileSync(join(dir, "node_modules", "foo", "index.js"), "//ignore");
		mkdirSync(join(dir, ".git"), { recursive: true });
		writeFileSync(join(dir, ".git", "config"), "[core]");
		const backup = createBackup(dir, "exclude-mission");
		expect(backup.type).toBe("directory");
		const snapPath = backup.path!;
		expect(existsSync(join(snapPath, "node_modules"))).toBe(false);
		expect(existsSync(join(snapPath, ".git"))).toBe(false);
		expect(existsSync(join(snapPath, "readme.txt"))).toBe(true);
	});

	it("reverts directory snapshot", () => {
		const dir = makeProject();
		const backup = createBackup(dir, "rev-mission");
		expect(backup.type).toBe("directory");

		// Mutate originals
		writeFileSync(join(dir, "readme.txt"), "mutated");
		writeFileSync(join(dir, "src", "main.ts"), "export const y = 2;");

		// Revert
		const ok = revertBackup(dir, backup);
		expect(ok).toBe(true);
		expect(readFileSync(join(dir, "readme.txt"), "utf-8")).toBe("original");
		expect(readFileSync(join(dir, "src", "main.ts"), "utf-8")).toBe("export const x = 1;");
	});

	it("deletes backup directory", () => {
		const dir = makeProject();
		const backup = createBackup(dir, "del-mission");
		expect(existsSync(backup.path!)).toBe(true);
		deleteBackup(backup);
		expect(existsSync(backup.path!)).toBe(false);
	});

	it("returns 'none' when everything fails", () => {
		// Passing a non-existent directory forces failure at every strategy
		const backup = createBackup("/nonexistent/orbtest", "fail-mission");
		expect(backup.type).toBe("none");
	});

	it("revert of 'none' returns false", () => {
		const ok = revertBackup("/tmp", { type: "none" });
		expect(ok).toBe(false);
	});
});

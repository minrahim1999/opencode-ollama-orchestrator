import { describe, expect, it } from "vitest";
import {
	DEFAULT_PONYTAIL_LEVEL,
	getPonytailInstructions,
	normalizePonytailLevel,
} from "../src/core/ponytail.js";

describe("ponytail", () => {
	describe("normalizePonytailLevel", () => {
		it("returns 'full' as the default level", () => {
			expect(DEFAULT_PONYTAIL_LEVEL).toBe("full");
			expect(normalizePonytailLevel(undefined)).toBe("full");
			expect(normalizePonytailLevel("")).toBe("full");
		});

		it("normalizes valid levels case-insensitively", () => {
			expect(normalizePonytailLevel("off")).toBe("off");
			expect(normalizePonytailLevel("OFF")).toBe("off");
			expect(normalizePonytailLevel("lite")).toBe("lite");
			expect(normalizePonytailLevel("Lite")).toBe("lite");
			expect(normalizePonytailLevel("full")).toBe("full");
			expect(normalizePonytailLevel("FULL")).toBe("full");
			expect(normalizePonytailLevel("ultra")).toBe("ultra");
			expect(normalizePonytailLevel("Ultra")).toBe("ultra");
		});

		it("falls back to 'full' for invalid values", () => {
			expect(normalizePonytailLevel("invalid")).toBe("full");
			expect(normalizePonytailLevel("super")).toBe("full");
			expect(normalizePonytailLevel("123")).toBe("full");
		});

		it("trims whitespace before normalizing", () => {
			expect(normalizePonytailLevel("  ultra  ")).toBe("ultra");
			expect(normalizePonytailLevel(" full ")).toBe("full");
		});
	});

	describe("getPonytailInstructions", () => {
		it("returns empty string for 'off' level", () => {
			expect(getPonytailInstructions("off")).toBe("");
		});

		it("returns non-empty instructions for 'lite' level", () => {
			const instructions = getPonytailInstructions("lite");
			expect(instructions.length).toBeGreaterThan(100);
			expect(instructions).toContain("Lazy Senior Dev");
			expect(instructions).toContain("The Ladder");
			expect(instructions).toContain("lite");
		});

		it("returns non-empty instructions for 'full' level", () => {
			const instructions = getPonytailInstructions("full");
			expect(instructions.length).toBeGreaterThan(100);
			expect(instructions).toContain("Lazy Senior Dev");
			expect(instructions).toContain("The Ladder");
			expect(instructions).toContain("full");
		});

		it("returns non-empty instructions for 'ultra' level", () => {
			const instructions = getPonytailInstructions("ultra");
			expect(instructions.length).toBeGreaterThan(100);
			expect(instructions).toContain("Lazy Senior Dev");
			expect(instructions).toContain("The Ladder");
			expect(instructions).toContain("ultra");
			expect(instructions).toContain("YAGNI extremist");
		});

		it("includes the ladder rungs in all non-off levels", () => {
			for (const level of ["lite", "full", "ultra"] as const) {
				const instructions = getPonytailInstructions(level);
				expect(instructions).toContain("Does this need to exist at all?");
				expect(instructions).toContain("Stdlib does it?");
				expect(instructions).toContain("Native platform feature");
				expect(instructions).toContain("Already-installed dependency");
				expect(instructions).toContain("Can it be one line?");
				expect(instructions).toContain("Only then");
			}
		});

		it("includes 'When NOT to be lazy' safety section in all levels", () => {
			for (const level of ["lite", "full", "ultra"] as const) {
				const instructions = getPonytailInstructions(level);
				expect(instructions).toContain("When NOT to be lazy");
				expect(instructions).toContain("input validation");
				expect(instructions).toContain("security");
				expect(instructions).toContain("accessibility");
			}
		});

		it("includes intensity-specific sections", () => {
			expect(getPonytailInstructions("lite")).toContain(
				"Intensity: lite",
			);
			expect(getPonytailInstructions("full")).toContain(
				"Intensity: full",
			);
			expect(getPonytailInstructions("ultra")).toContain(
				"Intensity: ultra",
			);
		});

		it("does NOT include other intensity sections", () => {
			expect(getPonytailInstructions("lite")).not.toContain(
				"Intensity: ultra",
			);
			expect(getPonytailInstructions("full")).not.toContain(
				"Intensity: lite",
			);
			expect(getPonytailInstructions("ultra")).not.toContain(
				"Intensity: lite",
			);
		});

		it("includes ponytail comment marking rule", () => {
			for (const level of ["lite", "full", "ultra"] as const) {
				const instructions = getPonytailInstructions(level);
				expect(instructions).toContain("ponytail:");
			}
		});
	});
});
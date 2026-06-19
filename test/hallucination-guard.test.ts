import { describe, expect, it } from "vitest";
import {
	extractEvidence,
	injectGuardInstructions,
	validateWrite,
} from "../src/core/hallucination-guard.js";

describe("HallucinationGuard", () => {
	const tmpDir = "/tmp/hg-test";

	describe("extractEvidence", () => {
		it("extracts cited files", () => {
			const text =
				"Changed the auth logic in src/auth.ts and also updated tests in test/auth.test.ts";
			const ev = extractEvidence(text);
			expect(ev.claimedFiles).toContain("src/auth.ts");
			expect(ev.claimedFiles).toContain("test/auth.test.ts");
		});

		it("parses confidence percentage", () => {
			const ev = extractEvidence("Done. Confidence: 85%");
			expect(ev.confidenceEstimate).toBeCloseTo(0.85, 2);
		});

		it("parses confidence decimal", () => {
			const ev = extractEvidence("Done. Confidence: 0.92");
			expect(ev.confidenceEstimate).toBeCloseTo(0.92, 2);
		});

		it("defaults confidence to 0.5 when missing", () => {
			const ev = extractEvidence("Just some text");
			expect(ev.confidenceEstimate).toBe(0.5);
		});
	});

	describe("validateWrite", () => {
		it("approves response with evidence, files, and high confidence", () => {
			const text = `Fixed the bug in src/auth.ts. Evidence: corrected JWT validation.
Confidence: 95%`;
			const result = validateWrite(tmpDir, text, ["src/auth.ts"], 0.75);
			expect(result.approved).toBe(true);
			expect(result.recommendation).toBe("proceed");
			expect(result.violations.length).toBe(0);
		});

		it("flags missing evidence line", () => {
			const text = `Changed stuff in src/auth.ts. Confidence: 95%`;
			const result = validateWrite(tmpDir, text, ["src/auth.ts"], 0.75);
			expect(result.approved).toBe(false);
			expect(
				result.violations.some((v) => v.includes("Missing mandatory")),
			).toBe(true);
		});

		it("flags files outside scope that don't exist", () => {
			const text = `Fixed file imaginary.ts. Evidence: none. Confidence: 95%`;
			const result = validateWrite(tmpDir, text, [], 0.75);
			expect(result.violations.some((v) => v.includes("not found"))).toBe(true);
		});

		it("flags low self-reported confidence", () => {
			const text = `Fixed src/auth.ts. Evidence: corrected typo. Confidence: 40%`;
			const result = validateWrite(tmpDir, text, ["src/auth.ts"], 0.75);
			expect(result.violations.some((v) => v.includes("too low"))).toBe(true);
		});

		it("allows scope files even if not on disk", () => {
			const text = `Will create src/new.ts. Evidence: new module. Confidence: 90%`;
			const result = validateWrite(tmpDir, text, ["src/new.ts"], 0.75);
			expect(result.violations.some((v) => v.includes("not found"))).toBe(
				false,
			);
		});
	});

	describe("injectGuardInstructions", () => {
		it("adds guard block when required", () => {
			const enriched = injectGuardInstructions("Base prompt", true);
			expect(enriched).toContain("HALLUCINATION GUARD");
			expect(enriched).toContain("Base prompt");
		});

		it("returns unchanged when not required", () => {
			const prompt = "Base prompt only";
			expect(injectGuardInstructions(prompt, false)).toBe(prompt);
		});
	});
});

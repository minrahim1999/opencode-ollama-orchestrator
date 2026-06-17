/**
 * HallucinationGuard — runtime evidence validation for all agent writes.
 *
 * In FAST mode every write must pass pre-write audit:
 *   1. Evidence extraction — agent must cite file/content references
 *   2. Confidence scoring — estimate groundedness
 *   3. Grounding check — referenced files must exist (or be in the todo scope)
 *   4. Reject + escalate if threshold not met
 */

import { readFileSync, existsSync } from "node:fs";
import { Logger } from "../utils/logger.js";

export interface WriteEvidence {
  claimedFiles: string[];
  claimedChanges: string;
  confidenceEstimate: number; // agent self-assessed
}

export interface GuardResult {
  approved: boolean;
  confidence: number;
  violations: string[];
  recommendation: "proceed" | "revise" | "escalate" | "abort";
}

/** Extract evidence blocks from agent response text */
export function extractEvidence(responseText: string): WriteEvidence {
  const files = new Set<string>();

  // Match "(see src/foo.ts)" , "in src/foo.ts" , "from src/foo.ts"
  const filePattern = /(?:see|in|from|file|path)\s+[`"']?([^`'"'\n]+?\.[a-zA-Z0-9]+)[`"']?/gi;
  let m: RegExpExecArray | null;
  while ((m = filePattern.exec(responseText)) !== null) {
    files.add(m[1].trim());
  }

  // Also catch standalone file paths (e.g. "src/foo.ts", "./config.json", "test/auth.test.ts")
  const standalonePattern = /(?:^|\s)([~.]?[\w\-/]*(?:[\w\-]+\.)+[a-zA-Z0-9]+)(?:\s|$|[,;])/gi;
  let sm: RegExpExecArray | null;
  while ((sm = standalonePattern.exec(responseText)) !== null) {
    files.add(sm[1].trim());
  }

  // Match Evidence: ... markers
  const evidenceMatch = responseText.match(/Evidence:\s*([^\n]+)/i);

  // Confidence: N% or Confidence: 0.X
  const confMatch = responseText.match(/Confidence:\s*(\d+(?:\.\d+)?)\s*%?/i);
  const confidenceEstimate = confMatch ? parseFloat(confMatch[1]) / (confMatch[0].includes("%") ? 100 : 1) : 0.5;

  return {
    claimedFiles: Array.from(files),
    claimedChanges: evidenceMatch?.[1]?.trim() ?? "(none stated)",
    confidenceEstimate: Math.min(1, Math.max(0, confidenceEstimate)),
  };
}

/**
 * Validate a proposed write before execution.
 * @param workingDir  Project root (for file existence checks)
 * @param response    Agent response containing claimed changes
 * @param scopeFiles  Files declared in todo / plan scope
 * @param threshold   Minimum confidence (0.0–1.0)
 */
export function validateWrite(
  workingDir: string,
  response: string,
  scopeFiles: string[],
  threshold: number
): GuardResult {
  const evidence = extractEvidence(response);
  const violations: string[] = [];

  // 1. At least one cited file
  if (evidence.claimedFiles.length === 0) {
    violations.push("No files cited in response. Agent must reference affected files.");
  }

  // 2. Scope check — claimed files must be in plan or exist
  for (const f of evidence.claimedFiles) {
    const inScope = scopeFiles.some((s) => s.endsWith(f) || f.endsWith(s) || s === f);
    const exists = existsSync(`${workingDir}/${f}`) || existsSync(f);
    if (!inScope && !exists) {
      violations.push(`File '${f}' not found and not in planned scope. Possible hallucination.`);
    }
  }

  // 3. Self-confidence check
  if (evidence.confidenceEstimate < threshold * 0.8) {
    violations.push(`Self-reported confidence (${(evidence.confidenceEstimate * 100).toFixed(0)}%) is too low (threshold ${(threshold * 100).toFixed(0)}%).`);
  }

  // 4. Evidence must exist in response
  if (!response.includes("Evidence:") && !response.includes("evidence:")) {
    violations.push("Missing mandatory 'Evidence:' line. Required in fast mode.");
  }

  // Composite score
  const fileScore = evidence.claimedFiles.length > 0 ? 0.3 : 0;
  const scopeScore = violations.filter((v) => v.includes("not found")).length === 0 ? 0.3 : 0;
  const evidenceScore = response.includes("Evidence:") ? 0.2 : 0;
  const confidenceScore = evidence.confidenceEstimate * 0.2;

  const confidence = fileScore + scopeScore + evidenceScore + confidenceScore;

  let recommendation: GuardResult["recommendation"];
  if (confidence >= threshold && violations.length === 0) {
    recommendation = "proceed";
  } else if (confidence >= threshold * 0.6) {
    recommendation = "revise";
  } else if (confidence >= threshold * 0.3) {
    recommendation = "escalate";
  } else {
    recommendation = "abort";
  }

  const result: GuardResult = {
    approved: recommendation === "proceed",
    confidence: Math.round(confidence * 100) / 100,
    violations,
    recommendation,
  };

  Logger.log(
    result.approved ? "info" : "warn",
    "hallucination-guard",
    `Write audit: ${result.approved ? "approved" : result.recommendation} (confidence=${confidence.toFixed(2)})`,
    { claimedFiles: evidence.claimedFiles, violations }
  );

  return result;
}

/** Enrich agent prompt with hallucination guard instructions */
export function injectGuardInstructions(basePrompt: string, requireEvidence: boolean): string {
  if (!requireEvidence) return basePrompt;

  const guardInstructions = `
┌───────────────────────────────────────────────
│  HALLUCINATION GUARD (MANDATORY IN FAST MODE)
├───────────────────────────────────────────────
│  1. Every code change must cite the EXACT file path(s) affected.
│  2. Add an Evidence: line summarizing what you observed.
│  3. Add Confidence: N% estimating how certain you are.
│  4. Never invent file names — only reference files you read or that exist.
│  5. If unsure, say so instead of guessing.
└───────────────────────────────────────────────
`.trim();

  return `${guardInstructions}\n\n${basePrompt}`;
}

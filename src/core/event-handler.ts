/**
 * Automatic message handler — no commands needed.
 * Uses the OpenCode plugin SDK's `chat.message` hook to intercept new user messages
 * and trigger the full mission pipeline automatically.
 *
 * BUG FIX (v2.5.0): Previously used the `event` hook listening for `message.created`,
 * which does not exist in OpenCode 1.17.x+. The pipeline never fired. Now uses
 * `chat.message` which is the SDK's dedicated hook for new user messages.
 */
import type { MissionController } from "./mission-controller.js";

const VERSION = "2.5.0";

/**
 * Create a chat.message hook handler.
 *
 * The OpenCode plugin SDK calls this hook when a new user message is received,
 * providing the message and its parts directly — no event type guessing needed.
 *
 * @param input  - { sessionID, agent?, model?, messageID? }
 * @param output - { message: UserMessage, parts: Part[] }
 */
export function createChatMessageHandler(controller: MissionController) {
	return async (
		_input: {
			sessionID: string;
			agent?: string;
			model?: { providerID: string; modelID: string };
			messageID?: string;
		},
		output: {
			message: { role: string };
			parts: Array<{ type: string; text?: string }>;
		},
	) => {
		// Extract user text from the message parts
		const text = output.parts
			.filter((p) => p.type === "text" && p.text)
			.map((p) => p.text!)
			.join("\n");

		if (!text) return;

		// /btw sideline question — fire-and-forget, never a task request
		if (
			text.trim().toLowerCase().startsWith("/btw ") ||
			text.trim().toLowerCase().startsWith("btw ")
		) {
			const question = text.replace(/^\/(btw)\s+|^btw\s+/i, "").trim();
			if (question) {
				try {
					controller.spawnSideline(question);
				} catch (err) {
					console.error(
						`[opencode-orchestrator v${VERSION}] Sideline question failed:`,
						err,
					);
				}
			}
			return;
		}

		if (!shouldIgnore(text) && looksLikeTaskRequest(text)) {
			try {
				await controller.start(text, true); // always automatic
			} catch (err) {
				console.error(
					`[opencode-orchestrator v${VERSION}] Mission start failed:`,
					err,
				);
			}
		}
	};
}

/** Exported for testing. Heuristic: what counts as a task request vs casual chat */
export function looksLikeTaskRequest(text: string): boolean {
	const lower = text.toLowerCase().trim();

	// Fast reject: meta commands, very short, or explicit non-task prefixes
	const isMeta =
		lower.startsWith("/") ||
		lower.startsWith("opencode") ||
		lower.startsWith("hermes") ||
		lower.startsWith("@");
	if (isMeta || text.length < 15 || text.split(/\s+/).length < 3) return false;

	// Strong reject: these words mean the user is NOT asking for work
	const rejectionKeywords = [
		"cancel",
		"stop",
		"abort",
		"nevermind",
		"never mind",
		"disregard",
		"explain",
		"what is",
		"how does",
		"why is",
		"tell me",
		"describe",
		"ignore",
		"forget",
		"don't",
		"do not",
		"clear",
		"reset",
		"thanks",
		"thank you",
		"ok",
		"okay",
		"sure",
		"got it",
	];
	const hasRejection = rejectionKeywords.some((kw) => lower.includes(kw));
	if (hasRejection) return false;

	// Weak positive signals — only count if combined with a strong keyword
	const weakSignals = ["please", "help me", "can you"];
	const _hasWeakSignal = weakSignals.some((kw) => lower.includes(kw));

	// Strong positive signals — definitive task request words
	const strongKeywords = [
		"build",
		"create",
		"implement",
		"add",
		"refactor",
		"fix",
		"write",
		"generate",
		"convert",
		"migrate",
		"setup",
		"configure",
		"deploy",
		"integrate",
		"develop",
		"design",
		"optimize",
		"test",
		"update",
		"upgrade",
		"remove",
		"delete",
		"change",
		"modify",
		"check",
		"compare",
		"review",
		"audit",
		"sync",
		"align",
		"code:",
		"todo:",
		"mission:",
		"plan:",
		"feature:",
		"bug:",
		"need to",
		"want to",
		"should we",
		"let's",
		"lets",
	];
	const hasStrongKeyword = strongKeywords.some((kw) => lower.includes(kw));

	// Strong positive keyword is required to trigger a mission
	return hasStrongKeyword;
}

/** Exported for testing. */
export function shouldIgnore(text: string): boolean {
	const lower = text.toLowerCase().trim();
	const ignored = [
		"ok",
		"thanks",
		"thank you",
		"got it",
		"nice",
		"cool",
		"lol",
		"haha",
		"👍",
		"✅",
	];
	return ignored.includes(lower) || text.length < 10;
}

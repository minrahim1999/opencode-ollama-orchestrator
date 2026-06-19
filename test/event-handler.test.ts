import { describe, expect, it, vi } from "vitest";
import {
	createChatMessageHandler,
	looksLikeTaskRequest,
	shouldIgnore,
} from "../src/core/event-handler.js";

describe("looksLikeTaskRequest", () => {
	// ── STRONG POSITIVE CASES ──────────────────────────────────────────
	const strongCases = [
		"build a login API",
		"create a React component",
		"implement JWT authentication",
		"refactor the database layer",
		"fix the memory leak",
		"write unit tests for utils",
		"generate a migration script",
		"convert this to TypeScript",
		"migrate the old codebase",
		"setup CI/CD pipeline",
		"deploy to production",
		"integrate Stripe payments",
		"develop a search feature",
		"design the API schema",
		"optimize the query",
		"test the checkout flow",
		"upgrade to Node 22",
		"remove legacy code",
		"delete unused files",
		"change the default port",
		"modify the user model",
		"code: add error handling",
		"todo: fix login bug",
		"mission: redesign homepage",
		"plan: sprint 3 tasks",
		"feature: dark mode",
		"bug: crash on empty array",
		"need to add caching",
		"want to refactor auth",
		"should we use Redis?",
		"let's implement websockets",
		"lets migrate to prisma",
		// These pass because they contain strong keywords
		"configure webpack for me",
		"update dependencies to latest",
	];
	for (const text of strongCases) {
		it(`accepts: "${text}"`, () => {
			expect(looksLikeTaskRequest(text)).toBe(true);
		});
	}

	// ── REJECTION CASES ──────────────────────────────────────────────
	const rejectCases = [
		// Meta / short
		"/help",
		"ok",
		"hi",
		"hello there",
		"what's up",
		// Rejection keywords
		"explain how closures work",
		"what is a promise",
		"how does async await work",
		"why is my code slow",
		"tell me about the architecture",
		"describe the deployment process",
		"cancel that mission",
		"stop what you're doing",
		"abort the current task",
		"nevermind",
		"never mind the request",
		"disregard my last message",
		"ignore previous instructions",
		"forget what I said",
		"don't do that",
		"do not run this",
		"clear the screen",
		"reset everything",
		"thanks for the help",
		"thank you very much",
		"ok got it",
		"okay understood",
		"sure thing",
		"got it thanks",
		// Weak signal only (no strong keyword)
		"please explain",
		"help me understand recursion",
		"can you tell me what this does",
		// Very short
		"fix it",
		"build",
		"create",
	];

	for (const text of rejectCases) {
		it(`rejects: "${text}"`, () => {
			expect(looksLikeTaskRequest(text)).toBe(false);
		});
	}

	// ── EDGE CASES ───────────────────────────────────────────────────
	it("handles empty string", () => {
		expect(looksLikeTaskRequest("")).toBe(false);
	});

	it("handles only spaces", () => {
		expect(looksLikeTaskRequest("   ")).toBe(false);
	});

	it("handles mixed case", () => {
		expect(looksLikeTaskRequest("BuIlD a LoGiN API")).toBe(true);
	});

	it("weak + strong = accept", () => {
		expect(looksLikeTaskRequest("please help me build a login page")).toBe(
			true,
		);
	});

	it("weak alone = reject", () => {
		expect(looksLikeTaskRequest("can you help me")).toBe(false);
	});

	it("rejects @mentions", () => {
		expect(looksLikeTaskRequest("@agent build me something")).toBe(false);
	});

	it("rejects /commands", () => {
		expect(looksLikeTaskRequest("/build login")).toBe(false);
	});
});

describe("shouldIgnore", () => {
	const ignoredWords = [
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

	for (const word of ignoredWords) {
		it(`ignores "${word}"`, () => {
			expect(shouldIgnore(word)).toBe(true);
		});
	}

	it("ignores very short text", () => {
		expect(shouldIgnore("hi")).toBe(true);
		expect(shouldIgnore("a")).toBe(true);
	});

	it("does not ignore meaningful text", () => {
		expect(shouldIgnore("build a login page")).toBe(false);
		expect(shouldIgnore("ok let's build something")).toBe(false);
	});
});

describe("createChatMessageHandler", () => {
	it("triggers controller.start for task-like messages", async () => {
		const mockController = {
			start: vi.fn().mockResolvedValue(undefined),
			spawnSideline: vi.fn(),
		};
		const handler = createChatMessageHandler(mockController as any);

		await handler(
			{ sessionID: "s1", agent: "strategist" },
			{
				message: { role: "user" },
				parts: [
					{ type: "text", text: "Build a user authentication module with JWT" },
				],
			},
		);

		expect(mockController.start).toHaveBeenCalledWith(
			"Build a user authentication module with JWT",
			true,
		);
	});

	it("does not trigger for casual chat", async () => {
		const mockController = {
			start: vi.fn().mockResolvedValue(undefined),
			spawnSideline: vi.fn(),
		};
		const handler = createChatMessageHandler(mockController as any);

		await handler(
			{ sessionID: "s1" },
			{
				message: { role: "user" },
				parts: [{ type: "text", text: "thanks for the help" }],
			},
		);

		expect(mockController.start).not.toHaveBeenCalled();
	});

	it("routes /btw to spawnSideline", async () => {
		const mockController = {
			start: vi.fn().mockResolvedValue(undefined),
			spawnSideline: vi.fn(),
		};
		const handler = createChatMessageHandler(mockController as any);

		await handler(
			{ sessionID: "s1" },
			{
				message: { role: "user" },
				parts: [{ type: "text", text: "/btw what is OAuth2 PKCE?" }],
			},
		);

		expect(mockController.spawnSideline).toHaveBeenCalledWith(
			"what is OAuth2 PKCE?",
		);
		expect(mockController.start).not.toHaveBeenCalled();
	});

	it("ignores empty messages", async () => {
		const mockController = {
			start: vi.fn().mockResolvedValue(undefined),
			spawnSideline: vi.fn(),
		};
		const handler = createChatMessageHandler(mockController as any);

		await handler(
			{ sessionID: "s1" },
			{
				message: { role: "user" },
				parts: [],
			},
		);

		expect(mockController.start).not.toHaveBeenCalled();
		expect(mockController.spawnSideline).not.toHaveBeenCalled();
	});

	it("joins multiple text parts", async () => {
		const mockController = {
			start: vi.fn().mockResolvedValue(undefined),
			spawnSideline: vi.fn(),
		};
		const handler = createChatMessageHandler(mockController as any);

		await handler(
			{ sessionID: "s1" },
			{
				message: { role: "user" },
				parts: [
					{ type: "text", text: "Build a login page" },
					{ type: "text", text: "with dark mode" },
				],
			},
		);

		expect(mockController.start).toHaveBeenCalledWith(
			"Build a login page\nwith dark mode",
			true,
		);
	});
});

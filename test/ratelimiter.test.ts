import { describe, expect, it } from "vitest";
import { TokenBucket, createOllamaRateLimiter } from "../src/utils/ratelimiter.js";

describe("TokenBucket", () => {
	it("allows burst up to capacity", () => {
		const bucket = new TokenBucket({ capacity: 3, refillRate: 1 });
		expect(bucket.consume()).toBe(true);
		expect(bucket.consume()).toBe(true);
		expect(bucket.consume()).toBe(true);
		expect(bucket.consume()).toBe(false);
	});

	it("refills over time", async () => {
		const bucket = new TokenBucket({ capacity: 2, refillRate: 10 });
		bucket.consume();
		bucket.consume();
		expect(bucket.consume()).toBe(false);
		await new Promise((r) => setTimeout(r, 150));
		expect(bucket.consume()).toBe(true);
	});

	it("waitForTokens resolves when token available", async () => {
		const bucket = new TokenBucket({ capacity: 1, refillRate: 10 });
		bucket.consume();
		const ok = await bucket.waitForTokens(1, 10, 500);
		expect(ok).toBe(true);
	});

	it("waitForTokens respects maxWaitMs", async () => {
		const bucket = new TokenBucket({ capacity: 1, refillRate: 0.01 });
		bucket.consume();
		const ok = await bucket.waitForTokens(1, 10, 30);
		expect(ok).toBe(false);
	});
});

describe("createOllamaRateLimiter", () => {
	it("creates bucket scaled by workers", () => {
		const r1 = createOllamaRateLimiter(1);
		expect(r1.consume()).toBe(true);
		expect(r1.consume()).toBe(true);
		expect(r1.consume()).toBe(true); // capacity 3 for 1 worker
		expect(r1.consume()).toBe(false);

		const r3 = createOllamaRateLimiter(3);
		let i = 0;
		while (r3.consume()) i++;
		expect(i).toBe(6); // capacity 2*3=6
	});
});

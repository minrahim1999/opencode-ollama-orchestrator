/**
 * Simple token-bucket rate limiter for Ollama protection.
 * Prevents the orchestrator from overloading the local LLM.
 */

interface BucketOptions {
	/** Max tokens in the bucket */
	capacity: number;
	/** Tokens added per second */
	refillRate: number;
}

export class TokenBucket {
	private capacity: number;
	private tokens: number;
	private refillRate: number;
	private lastRefill: number;

	constructor(opts: BucketOptions) {
		this.capacity = opts.capacity;
		this.tokens = opts.capacity;
		this.refillRate = opts.refillRate;
		this.lastRefill = Date.now();
	}

	/** Try to consume N tokens. Returns false if insufficient. */
	consume(n = 1): boolean {
		this.refill();
		if (this.tokens >= n) {
			this.tokens -= n;
			return true;
		}
		return false;
	}

	/** Wait until N tokens are available */
	async waitForTokens(n = 1, pollMs = 50, maxWaitMs = 30000): Promise<boolean> {
		const deadline = Date.now() + maxWaitMs;
		while (Date.now() < deadline) {
			if (this.consume(n)) return true;
			await new Promise((r) => setTimeout(r, pollMs));
		}
		return false;
	}

	private refill() {
		const now = Date.now();
		const elapsed = (now - this.lastRefill) / 1000;
		this.tokens = Math.min(
			this.capacity,
			this.tokens + elapsed * this.refillRate,
		);
		this.lastRefill = now;
	}
}

/** Create a rate limiter based on maxParallelWorkers */
export function createOllamaRateLimiter(
	maxParallelWorkers: number,
): TokenBucket {
	// Conservative: 2x workers per second burst, steady at 1x per second
	return new TokenBucket({
		capacity: Math.max(maxParallelWorkers * 2, 3),
		refillRate: Math.max(maxParallelWorkers, 1),
	});
}

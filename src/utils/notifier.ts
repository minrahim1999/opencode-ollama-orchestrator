/**
 * Notification hooks for mission events.
 * Supports ntfy.sh webhooks and custom HTTP POST endpoints.
 */

export interface NotifyConfig {
	/** ntfy.sh topic or server URL */
	ntfyTopic?: string;
	/** Custom webhook URL */
	webhookUrl?: string;
	/** Only notify on these severities */
	minLevel?: "completed" | "failed" | "stuck";
	/** HTTP headers for webhook */
	headers?: Record<string, string>;
}

const DEFAULT_HEADERS = {
	"Content-Type": "application/json",
	"User-Agent": "opencode-orchestrator/2.1",
};

/**
 * Send notification for a mission event.
 * Silently swallows errors — notifications must never break the mission.
 */
export async function notify(
	config: NotifyConfig,
	event: {
		type:
			| "mission_started"
			| "mission_completed"
			| "mission_failed"
			| "mission_stuck"
			| "task_failed"
			| "backup_created";
		missionSlug: string;
		message: string;
		details?: Record<string, unknown>;
	},
): Promise<void> {
	const promises: Promise<void>[] = [];

	// ntfy.sh push notification
	if (config.ntfyTopic) {
		promises.push(sendNtfy(config.ntfyTopic, event));
	}

	// Custom webhook
	if (config.webhookUrl) {
		promises.push(sendWebhook(config.webhookUrl, config.headers ?? {}, event));
	}

	await Promise.allSettled(promises);
}

async function sendNtfy(topic: string, event: any): Promise<void> {
	const url = topic.startsWith("http") ? topic : `https://ntfy.sh/${topic}`;
	try {
		const resp = await fetch(url, {
			method: "POST",
			body: JSON.stringify({
				title: `Opencode: ${event.type}`,
				message: event.message,
				priority:
					event.type === "mission_failed" || event.type === "mission_stuck"
						? 5
						: 3,
				tags: [event.type, event.missionSlug],
			}),
			headers: { "Content-Type": "application/json" },
		});
		if (!resp.ok) {
			// Silently ignore ntfy errors
		}
	} catch {
		// Silently ignore network errors
	}
}

async function sendWebhook(
	url: string,
	headers: Record<string, string>,
	event: any,
): Promise<void> {
	try {
		const resp = await fetch(url, {
			method: "POST",
			body: JSON.stringify(event),
			headers: { ...DEFAULT_HEADERS, ...headers },
		});
		if (!resp.ok) {
			// Silently ignore webhook errors
		}
	} catch {
		// Silently ignore network errors
	}
}

/**
 * Automatic event handler — no commands needed.
 * Intercepts regular user messages and triggers the full mission pipeline automatically.
 */
import { MissionController } from "./mission-controller.js";
import type { EventHandlerDeps } from "./types.js";

const VERSION = "2.1.0";

export function createEventHandler(deps: EventHandlerDeps) {
  const controller = new MissionController(deps);

  return async (event: any) => {
    // OpenCode event format varies between versions. Try both conventions.
    // Convention A (older SDK): event.type === "message_create", payload in event.data
    // Convention B (newer SDK): event.type === "message.created", payload in event.data
    // Convention C (hook): the message itself is passed as argument
    const evtType: string | undefined = event?.type;
    const isMessageEvent =
      evtType === "message.created" ||
      evtType === "message_create" ||
      evtType === "MESSAGE_CREATED" ||
      evtType === "MESSAGE_CREATE";

    if (isMessageEvent) {
      const text: string = event.data?.text ?? event.data?.content ?? "";
      if (text && !shouldIgnore(text) && looksLikeTaskRequest(text)) {
        try {
          await controller.start(text, true); // always automatic
        } catch (err) {
          console.error(`[ollama-orchestrator v${VERSION}] Mission start failed:`, err);
        }
      }
      return event;
    }

    return event;
  };
}

/** Heuristic: what counts as a task request vs casual chat */
function looksLikeTaskRequest(text: string): boolean {
  const lower = text.toLowerCase().trim();

  // Contains task keywords
  const keywords = [
    "build", "create", "implement", "add", "refactor", "fix",
    "write", "generate", "convert", "migrate", "setup", "configure",
    "deploy", "integrate", "develop", "design", "optimize", "test",
    "update", "upgrade", "remove", "delete", "change", "modify",
    "code:", "todo:", "mission:", "plan:", "feature:", "bug:",
    "help me", "can you", "please", "need to", "want to",
  ];

  const hasKeyword = keywords.some((kw) => lower.includes(kw));

  // Must be substantive (not "ok" or "thanks")
  const isSubstantive = text.length >= 15 && text.split(" ").length >= 3;

  // Exclude system / meta messages
  const isMeta = lower.startsWith("/") || lower.startsWith("opencode") || lower.startsWith("hermes");

  return hasKeyword && isSubstantive && !isMeta;
}

function shouldIgnore(text: string): boolean {
  const lower = text.toLowerCase().trim();
  const ignored = ["ok", "thanks", "thank you", "got it", "nice", "cool", "lol", "haha", "👍", "✅"];
  return ignored.includes(lower) || text.length < 10;
}

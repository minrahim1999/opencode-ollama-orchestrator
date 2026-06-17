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

  // Fast reject: meta commands, very short, or explicit non-task prefixes
  const isMeta = lower.startsWith("/") || lower.startsWith("opencode") || lower.startsWith("hermes") || lower.startsWith("@");
  if (isMeta || text.length < 15 || text.split(/\s+/).length < 3) return false;

  // Strong reject: these words mean the user is NOT asking for work
  const rejectionKeywords = [
    "cancel", "stop", "abort", "nevermind", "never mind", "disregard",
    "explain", "what is", "how does", "why is", "tell me", "describe",
    "ignore", "forget", "don't", "do not", "clear", "reset",
    "thanks", "thank you", "ok", "okay", "sure", "got it",
  ];
  const hasRejection = rejectionKeywords.some((kw) => lower.includes(kw));
  if (hasRejection) return false;

  // Weak positive signals — only count if combined with a strong keyword
  const weakSignals = ["please", "help me", "can you"];
  const hasWeakSignal = weakSignals.some((kw) => lower.includes(kw));

  // Strong positive signals — definitive task request words
  const strongKeywords = [
    "build", "create", "implement", "add", "refactor", "fix",
    "write", "generate", "convert", "migrate", "setup", "configure",
    "deploy", "integrate", "develop", "design", "optimize", "test",
    "update", "upgrade", "remove", "delete", "change", "modify",
    "code:", "todo:", "mission:", "plan:", "feature:", "bug:",
    "need to", "want to", "should we", "let's", "lets",
  ];
  const hasStrongKeyword = strongKeywords.some((kw) => lower.includes(kw));

  // If user says "help me understand X" — that's weak + no strong keyword → reject
  // If user says "please help me build X" — that's weak + strong keyword → accept
  return hasStrongKeyword || (!hasWeakSignal && strongKeywords.some((kw) => lower.includes(kw)));
}

function shouldIgnore(text: string): boolean {
  const lower = text.toLowerCase().trim();
  const ignored = ["ok", "thanks", "thank you", "got it", "nice", "cool", "lol", "haha", "👍", "✅"];
  return ignored.includes(lower) || text.length < 10;
}

import type { Llm } from "../../ai/llm";
import type { Lang } from "../../core/i18n";
import type { DareType, Level, QuestionKind } from "./types";

const LEVEL_BRIEF: Record<Level, string> = {
  1: "Mild: light, silly and wholesome. Fine for anyone.",
  2: "Spicy: crushes, dating, exes, gossip, embarrassing moments, mild flirting.",
  3: "18+ (adults only): attraction, intimate experiences, sex life and fantasies, bold confessions. Suggestive and cheeky, never graphic.",
};

const DARE_FORMAT: Record<DareType, string> = {
  voice: "voice: say or perform something out loud on the voice call (sing a line, do an accent, read something in a funny voice)",
  post: "post: post something in the group chat (a photo from your camera roll, a screenshot, change your group nickname or profile photo for a while)",
  contact: "contact: message or call someone outside the group, then post a screenshot of the conversation",
};

const KIND_BRIEF: Record<QuestionKind, string> = {
  truth: "a TRUTH question the player must answer honestly out loud",
  dare: "a DARE the player must do right now",
  penalty:
    "a PENALTY dare: a noticeably harsher dare for someone who chickened out or lost the group vote. It must still be doable right now, and the player cannot refuse it",
};

const SYSTEM_PROMPT = [
  "You write prompts for a Truth or Dare party game.",
  "The players are adult friends in a Telegram group, together on a group voice call (audio only, no video).",
  "Each prompt is shown to one player at a time.",
  "Rules for every prompt:",
  "- One sentence, spoken directly to the player as \"you\". At most 60 Chinese characters or 30 English words.",
  "- Never name a specific person; when a prompt involves someone else, let the player pick (\"someone in the group\", \"your ex\", \"the 5th person in your contacts\").",
  "- Playful, never cruel or humiliating about appearance, identity or money troubles. Nothing illegal, dangerous, self-harming, or involving minors. No graphic sexual descriptions.",
  "- Doable from home with just a phone in under three minutes. No camera or video tasks.",
  "- Must be clearly different from every prompt in the already-used list, not a rephrasing.",
  "Reply with a JSON object only.",
].join("\n");

export interface AiQuestion {
  text: string;
  provider: string;
  type?: DareType;
}

export async function generateQuestion(
  llm: Llm,
  input: { kind: QuestionKind; level: Level; lang: Lang; dareTypes: DareType[]; avoid: string[] },
): Promise<AiQuestion> {
  const isDare = input.kind !== "truth";
  const lines = [
    `Write ${KIND_BRIEF[input.kind]}.`,
    `Intensity: ${LEVEL_BRIEF[input.level]}`,
  ];
  if (isDare) {
    lines.push("Allowed dare formats (use exactly one):", ...input.dareTypes.map((type) => `- ${DARE_FORMAT[type]}`));
  }
  lines.push(
    input.lang === "zh"
      ? "Language: Simplified Chinese, natural and colloquial, like friends talking."
      : "Language: English, casual and natural, like friends talking.",
  );
  if (input.avoid.length) {
    lines.push("Already used (do not repeat):", ...input.avoid.slice(-25).map((text) => `- ${text}`));
  }
  lines.push(
    isDare
      ? `Respond as JSON: {"question": "<the dare>", "type": "${input.dareTypes.join('" | "')}"}`
      : 'Respond as JSON: {"question": "<the question>"}',
  );

  const result = await llm.json({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: lines.join("\n") },
    ],
    schemaName: "truth_or_dare_prompt",
    schema: {
      type: "object",
      properties: {
        question: { type: "string" },
        ...(isDare ? { type: { type: "string", enum: input.dareTypes } } : {}),
      },
      required: isDare ? ["question", "type"] : ["question"],
    },
    maxTokens: 300,
  });

  const text = cleanQuestion(result.value.question);
  if (!text) throw new Error(`unusable question from ${result.provider}`);
  const type = isDare && input.dareTypes.includes(result.value.type as DareType) ? (result.value.type as DareType) : undefined;
  return { text, provider: result.provider, type };
}

/** Normalizes model output: single line, no wrapping quotes, sane length. */
export function cleanQuestion(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“「『']+|["”」』']+$/g, "")
    .trim();
  if (text.length < 4 || text.length > 220) return null;
  return text;
}

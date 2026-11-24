/** Accepts bare JSON or JSON wrapped in prose / code fences. */
export function parseJsonObject(content: string): Record<string, unknown> {
  const attempts = [content, content.match(/\{[\s\S]*\}/)?.[0]];
  for (const attempt of attempts) {
    if (!attempt) continue;
    try {
      const parsed: unknown = JSON.parse(attempt);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // try the next shape
    }
  }
  throw new Error(`not a JSON object: ${content.slice(0, 120)}`);
}

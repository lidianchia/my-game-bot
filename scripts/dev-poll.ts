/**
 * Local development without a public URL.
 *
 * Long-polls Telegram with a DEV bot token and forwards every update to the
 * local `wrangler dev` server exactly as Telegram's webhook would, secret
 * header included. Run `npm run dev` in one terminal and this in another:
 *
 *   npm run dev:poll                       # forwards to http://localhost:8787/webhook
 *   npm run dev:poll -- http://localhost:9000/webhook
 *
 * Reads BOT_TOKEN and WEBHOOK_SECRET from the environment or .dev.vars.
 * It deletes the bot's webhook first, so never point it at the production bot.
 */
import { existsSync, readFileSync } from "node:fs";

function loadDevVars(): Record<string, string> {
  if (!existsSync(".dev.vars")) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) vars[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
  return vars;
}

const devVars = loadDevVars();
const token = process.env.BOT_TOKEN ?? devVars.BOT_TOKEN;
const secret = process.env.WEBHOOK_SECRET ?? devVars.WEBHOOK_SECRET;
const target = process.argv[2] ?? "http://localhost:8787/webhook";
if (!token || !secret) {
  console.error("BOT_TOKEN and WEBHOOK_SECRET are required (env or .dev.vars).");
  process.exit(1);
}

const telegram = async <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const body = (await response.json()) as { ok: boolean; result: T; description?: string };
  if (!body.ok) throw new Error(`${method} failed: ${body.description}`);
  return body.result;
};

const me = await telegram<{ username: string }>("getMe");
await telegram("deleteWebhook");
console.log(`Polling as @${me.username}, forwarding to ${target}`);

let offset = 0;
for (;;) {
  try {
    const updates = await telegram<Array<{ update_id: number }>>("getUpdates", {
      offset,
      timeout: 30,
      allowed_updates: ["message", "callback_query", "my_chat_member"],
    });
    for (const update of updates) {
      offset = update.update_id + 1;
      const response = await fetch(target, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
        body: JSON.stringify(update),
      });
      console.log(`update ${update.update_id} -> ${response.status}`);
    }
  } catch (error) {
    console.error(error);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

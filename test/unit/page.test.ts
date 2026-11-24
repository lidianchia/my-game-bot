import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stringsFor } from "../../public/app/i18n.js";
import { POINTS } from "../../src/games/guess/types";
import { signed } from "../../src/ui/glyphs";

/**
 * The game page is served straight from public/ (no build step), so a typo in
 * a path only shows up as a blank page inside Telegram. Catch it here.
 */
describe("game page files", () => {
  it("are what wrangler serves as static assets", () => {
    const config = readFileSync("wrangler.jsonc", "utf8");
    expect(config).toMatch(/"assets":\s*\{\s*"directory":\s*"\.\/public"/);
    expect(existsSync("public/app.html")).toBe(true);
  });

  it("only reference files that exist", () => {
    const html = readFileSync("public/app.html", "utf8");
    const local = [...html.matchAll(/(?:src|href)="\/([^"]+)"/g)].map((match) => match[1]!);
    expect(local).toEqual(expect.arrayContaining(["app/app.css", "app/main.js"]));
    for (const path of local) expect(existsSync(`public/${path}`), path).toBe(true);

    for (const file of readdirSync("public/app").filter((name) => name.endsWith(".js"))) {
      const source = readFileSync(`public/app/${file}`, "utf8");
      for (const match of source.matchAll(/^import .* from "(\.[^"]+)";$/gm)) {
        expect(existsSync(`public/app/${match[1]}`), `${file} imports ${match[1]}`).toBe(true);
      }
    }
  });

  it("load Telegram's SDK before the page script", () => {
    const html = readFileSync("public/app.html", "utf8");
    expect(html.indexOf("telegram.org/js/telegram-web-app.js")).toBeGreaterThan(-1);
    expect(html.indexOf("telegram-web-app.js")).toBeLessThan(html.indexOf("/app/main.js"));
  });
});

describe("the lobby's how-to-play guide", () => {
  it("quotes the points the game actually gives", () => {
    for (const lang of ["zh", "en"]) {
      const { howModes } = stringsFor(lang);
      expect(howModes.taboo, lang).toContain(signed(POINTS.guessed));
      expect(POINTS.described, "the guide says guesser and lead get the same").toBe(POINTS.guessed);
      expect(howModes.taboo, lang).toContain(signed(POINTS.foul));
      expect(howModes.unique, lang).toContain(signed(POINTS.solved));
      expect(howModes.unique, lang).toContain(signed(POINTS.clue));
    }
  });
});

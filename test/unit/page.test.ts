import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import templatePage from "../../public/app/games/_template.js";
import guessPage from "../../public/app/games/guess.js";
import { GAMES } from "../../src/games";
import { templateGame } from "../../src/games/_template";
import { POINTS as TEMPLATE_POINTS } from "../../src/games/_template/types";
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

    for (const dir of ["public/app", "public/app/games"]) {
      for (const file of readdirSync(dir).filter((name) => name.endsWith(".js"))) {
        const source = readFileSync(`${dir}/${file}`, "utf8");
        for (const match of source.matchAll(/^import .* from "(\.[^"]+)";$/gm)) {
          expect(existsSync(`${dir}/${match[1]}`), `${file} imports ${match[1]}`).toBe(true);
        }
      }
    }
  });

  it("load Telegram's SDK before the page script", () => {
    const html = readFileSync("public/app.html", "utf8");
    expect(html.indexOf("telegram.org/js/telegram-web-app.js")).toBeGreaterThan(-1);
    expect(html.indexOf("telegram-web-app.js")).toBeLessThan(html.indexOf("/app/main.js"));
  });
});

/** Every game the page can be opened for: the registered ones, and the template. */
const webGames = [...GAMES, templateGame].filter((game) => game.web);

describe("game pages", () => {
  it("exist for every game played in the Mini App, and only for those", () => {
    const files = readdirSync("public/app/games").filter((name) => name.endsWith(".js"));
    expect(files.sort()).toEqual(webGames.map((game) => `${game.id}.js`).sort());
  });

  it("belong to game ids the shell will load", () => {
    // main.js only puts ids like these into a module path; they double as Telegram commands too.
    for (const game of [...GAMES, templateGame]) expect(game.id).toMatch(/^[a-z0-9_]{1,32}$/);
  });

  it("give the shell what it draws with, in both languages", async () => {
    for (const game of webGames) {
      const { default: page } = await import(`../../public/app/games/${game.id}.js`);
      expect(typeof page.play, game.id).toBe("function");
      expect(Object.keys(page.strings.en).sort(), game.id).toEqual(Object.keys(page.strings.zh).sort());
      if (page.styles) expect(existsSync(`public/app/games/${game.id}.css`), `${game.id}.css`).toBe(true);
    }
  });
});

describe("the lobby's rules", () => {
  it("quote the points the word game actually gives", () => {
    for (const lang of ["zh", "en"] as const) {
      const { howModes } = guessPage.strings[lang] as { howModes: { taboo: string; unique: string } };
      expect(howModes.taboo, lang).toContain(signed(POINTS.guessed));
      expect(POINTS.described, "the guide says guesser and lead get the same").toBe(POINTS.guessed);
      expect(howModes.taboo, lang).toContain(signed(POINTS.foul));
      expect(howModes.unique, lang).toContain(signed(POINTS.solved));
      expect(howModes.unique, lang).toContain(signed(POINTS.clue));
    }
  });

  it("quote the points the template game actually gives", () => {
    for (const lang of ["zh", "en"] as const) {
      const { rules } = templatePage.strings[lang] as { rules: string[][] };
      const text = rules.flat().join(" ");
      expect(text, lang).toContain(signed(TEMPLATE_POINTS.right));
      expect(text, lang).toContain(signed(TEMPLATE_POINTS.fooled));
    }
  });
});

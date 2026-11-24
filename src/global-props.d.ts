// Tells the Workers runtime types what the main module exports, so `ctx.exports`
// (and `exports` in tests) know about the default handler and the Durable Object.
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("./index");
    durableNamespaces: "ChatDurableObject";
  }
}

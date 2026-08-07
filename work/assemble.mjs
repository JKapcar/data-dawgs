import { readFileSync, writeFileSync } from "fs";
const base = readFileSync("../dawg-bot-worker.js", "utf8");
const block = readFileSync("mcp-block.js", "utf8");
const anchor = '    const url = new URL(request.url);';
if (!base.includes(anchor)) { console.error("anchor not found"); process.exit(1); }
const route = anchor + '\n    // /mcp is matched before ANY Origin-gated handler — see the block at the bottom.\n    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) return handleMcp(request, url, env);';
const out = base.replace(anchor, route) + "\n" + block;
writeFileSync("dawg-bot-worker.assembled.js", out);
console.log("assembled:", out.split("\n").length, "lines");

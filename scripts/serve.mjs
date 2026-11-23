import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import market from "../worker/index.mjs";

const port = Number(process.env.PORT || process.argv[2] || "3000");
const base = "http://127.0.0.1:" + port;
const types = {
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8", svg: "image/svg+xml", woff: "font/woff", woff2: "font/woff2", txt: "text/plain; charset=utf-8",
};

async function handle(request) {
  const {pathname} = new URL(request.url);
  if (pathname === "/api/market") return market.fetch(request);
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", {status: 405});
  const name = pathname === "/" ? "index.html" : pathname.slice(1);
  if (name !== "index.html" && !/^assets\/[\w.-]+$/.test(name)) return new Response("Not found", {status: 404});
  const type = types[name.split(".").at(-1)];
  if (!type) return new Response("Not found", {status: 404});
  try {
    const bytes = await readFile(fileURLToPath(new URL("../dist/" + name, import.meta.url)));
    return new Response(request.method === "HEAD" ? null : bytes, {
      headers: {"Content-Type": type, "Cache-Control": "no-cache"},
    });
  } catch {
    return new Response("Not found", {status: 404});
  }
}

createServer(async (incoming, outgoing) => {
  try {
    const request = new Request(new URL(incoming.url || "/", base), {method: incoming.method});
    const response = await handle(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500, {"Content-Type": "text/plain; charset=utf-8"});
    outgoing.end("Market request failed");
  }
}).listen(port, "127.0.0.1", () => console.log("美股市场观察 " + base));

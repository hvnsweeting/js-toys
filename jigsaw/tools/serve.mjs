import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".md": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff2": "font/woff2",
};
const gameFolders = new Set(["jigsaw", "flappywitch", "emoji2eng", "mydraw"]);
export function resolveRequest(rootPath, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath.split("?")[0]);
  } catch {
    return { status: 400 };
  }
  if (decoded.includes("\\") || decoded.includes("\0")) return { status: 403 };
  const segments = decoded.split("/");
  const privateSegment =
    segments.some((segment) => segment.startsWith(".") && segment !== "") ||
    segments.some((segment) =>
      ["node_modules", "tests", "test", "tools"].includes(segment),
    );
  const privateFile = [
    "package.json",
    "package-lock.json",
    "README.md",
    "Makefile",
  ].includes(segments.at(-1));
  if (privateSegment || privateFile) return { status: 403 };
  const normalized = path.posix.normalize(decoded);
  const relative = normalized.startsWith("/")
    ? normalized.slice(1)
    : normalized;
  const file = path.resolve(rootPath, relative || ".");
  const outside = path.relative(rootPath, file);
  if (outside.startsWith("..") || path.isAbsolute(outside))
    return { status: 403 };
  const route = relative.split(path.sep).join("/");
  if (gameFolders.has(route) || ["jigsaw/css", "jigsaw/js", "jigsaw/pictures"].includes(route))
    return { status: 301, location: `/${route}/` };
  const requestedFile = decoded.endsWith("/")
    ? path.join(file, "index.html")
    : file;
  const publicRoute = path.relative(rootPath, requestedFile).split(path.sep).join("/");
  const publicFile = publicRoute === "index.html" ||
    gameFolders.has(publicRoute.split("/")[0]);
  if (!publicFile) return { status: 403 };
  const allowed = new Set([
    ".html",
    ".css",
    ".js",
    ".json",
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".svg",
    ".ico",
    ".woff",
    ".woff2",
    ".mp3",
    ".wav",
    ".ogg",
    ".md",
    ".webmanifest",
  ]);
  if (!allowed.has(path.extname(requestedFile))) return { status: 403 };
  if (
    path.extname(requestedFile) === ".md" &&
    path.relative(rootPath, requestedFile) !==
      path.join("jigsaw", "pictures", "CREDITS.md")
  )
    return { status: 403 };
  return { status: 200, file: requestedFile };
}
export async function createServer(rootPath = root, beforeOpen = null) {
  const realRoot = await realpath(rootPath);
  return http.createServer(async (request, response) => {
    const resolved = resolveRequest(rootPath, request.url || "/");
    if (resolved.status === 301) {
      response.writeHead(301, { Location: resolved.location });
      response.end();
      return;
    }
    if (resolved.status !== 200) {
      response.writeHead(resolved.status);
      response.end();
      return;
    }
    try {
      let file = resolved.file;
      const info = await stat(file);
      if (info.isDirectory()) file = path.join(file, "index.html");
      const actual = await realpath(file);
      const relative = path.relative(realRoot, actual);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        response.writeHead(403);
        response.end();
        return;
      }
      if (resolveRequest(realRoot, "/" + relative.split(path.sep).join("/")).status !== 200) {
        response.writeHead(403);
        response.end();
        return;
      }
      const checked = await stat(actual);
      if (!checked.isFile() || checked.nlink > 1) {
        response.writeHead(403);
        response.end();
        return;
      }
      if (beforeOpen) await beforeOpen(actual);
      const handle = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW);
      let content;
      try {
        const opened = await handle.stat();
        if (opened.dev !== checked.dev || opened.ino !== checked.ino) {
          response.writeHead(403);
          response.end();
          return;
        }
        content = await handle.readFile();
      } finally {
        await handle.close();
      }
      response.writeHead(200, {
        "Content-Type":
          types[path.extname(actual)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      response.end(content);
    } catch (error) {
      response.writeHead(error.code === "ELOOP" ? 403 : 404);
      response.end();
    }
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const server = await createServer();
  server.listen(
    Number(process.env.PORT || 8091),
    process.env.HOST || "0.0.0.0",
    () =>
      console.log(
        `Jigsaw server on ${process.env.HOST || "0.0.0.0"}:${process.env.PORT || 8091}`,
      ),
  );
}

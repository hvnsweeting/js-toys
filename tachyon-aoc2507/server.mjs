import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promises as fs} from 'node:fs';
import {constants} from 'node:fs';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const publicPrefixes = ['src/', 'vendor/', 'assets/'];
const exactFiles = new Set(['index.html', 'style.css']);
function isPublic(relativeName) {
  return exactFiles.has(relativeName) ||
      publicPrefixes.some(prefix => relativeName.startsWith(prefix));
}
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

export function resolvePublicPath(root, rawUrl, pathApi = path) {
  const rawPath = rawUrl.split('?')[0].split('#')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return {status: 400};
  }
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0'))
    return {status: 400};
  if (decoded.split('/').includes('..')) return {status: 403};
  const relativeName = decoded === '/' ? 'index.html' : decoded.slice(1);
  if (!isPublic(relativeName)) return {status: 403};
  const file = pathApi.resolve(root, relativeName);
  const relative = pathApi.relative(pathApi.resolve(root), file);
  if (!relative || relative === '..' || relative.startsWith(`..${pathApi.sep}`) ||
      pathApi.isAbsolute(relative))
    return {status: 403};
  return {status: 200, file};
}

export async function resolveRealPublicPath(root, file) {
  const realRoot = await fs.realpath(root);
  const realFile = await fs.realpath(file);
  const relative = path.relative(realRoot, realFile);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) || !isPublic(relative))
    return {status: 403};
  return {status: 200, file: realFile};
}

export async function readPublicFile(root, file) {
  const checked = await resolveRealPublicPath(root, file);
  if (checked.status !== 200) return {status: 403};
  const expected = await fs.stat(checked.file);
  const handle = await fs.open(checked.file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    const checkedAgain = await resolveRealPublicPath(root, checked.file);
    const sameFile = opened.dev === expected.dev && opened.ino === expected.ino;
    const stillPublic = checkedAgain.status === 200 && checkedAgain.file === checked.file;
    if (!sameFile || !stillPublic || opened.nlink > 1) return {status: 403};
    return {status: 200, file: checked.file, data: await handle.readFile()};
  } finally {
    await handle.close();
  }
}

export function createServer(root = projectRoot) {
  return http.createServer(async (request, response) => {
    const result = resolvePublicPath(root, request.url ?? '/');
    if (result.status !== 200) {
      response.writeHead(result.status);
      response.end();
      return;
    }
    try {
      const checked = await readPublicFile(root, result.file);
      if (checked.status !== 200) {
        response.writeHead(403);
        response.end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': types[path.extname(checked.file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      response.end(checked.data);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : error.code === 'ELOOP' ? 403 : 500);
      response.end();
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 8000);
  createServer().listen(port, host, () => console.log(`Tachyon Cascade at http://${host}:${port}`));
}

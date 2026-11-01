import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

export function unexpectedBlockedRequests(blockedRequests, gamePath) {
  const workerScript = `${gamePath}sw.js`;
  return blockedRequests.filter(request => request.path !== workerScript || request.serviceWorker !== 'script');
}

// Serve a linked copy with Python's static-file handler. The single-threaded server emits a
// request event before serving each file, so the marker cannot overtake an earlier request.
export async function startObservedServer(gameRoot, gamePath, startProcess = spawn) {
  const scratch = path.join(gameRoot, '.scratch');
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'observed-server-'));
  let child;
  let proxy;
  try {
    const mountedGame = path.join(directory, gamePath.slice(1, -1));
    await mkdir(path.dirname(mountedGame), { recursive: true });
    await symlink(gameRoot, mountedGame);
    const program = `import http.server, sys, time, urllib.parse
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=sys.argv[1], **kwargs)
    def do_GET(self):
        print('REQUEST ' + self.path, flush=True)
        if urllib.parse.urlsplit(self.path).query == 'delay_request=1':
            time.sleep(0.2)
        super().do_GET()
server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
print('PORT ' + str(server.server_port), flush=True)
server.serve_forever()`;
    child = startProcess('python3', ['-u', '-c', program, directory], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '';
    let port;
    let failure;
    let recording = false;
    const requests = [];
    const seen = new Set();
    let notify;
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (line.startsWith('PORT ')) port = Number(line.slice(5));
        if (line.startsWith('REQUEST ')) {
          const requestPath = line.slice(8);
          seen.add(requestPath);
          if (recording && new URL(requestPath, 'http://127.0.0.1').pathname.startsWith(gamePath)) requests.push(requestPath);
        }
        notify?.();
      }
    });
    child.stderr.on('data', () => {});
    child.once('error', error => { failure = error; notify?.(); });
    child.once('exit', code => { failure ??= new Error(`Static server exited with ${code}`); notify?.(); });

    async function waitUntil(condition) {
      while (!condition()) {
        if (failure) throw failure;
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Static server response timed out')), 10000);
          notify = () => { clearTimeout(timeout); notify = undefined; resolve(); };
        });
      }
    }
    await waitUntil(() => Number.isInteger(port) && port > 0);
    const origin = `http://127.0.0.1:${port}`;
    let blocked = false;
    let heldFile;
    const blockedRequests = [];
    const forwardedPaths = [];
    proxy = http.createServer(async (request, response) => {
      let target;
      try { target = new URL(request.url); } catch { response.writeHead(400).end(); return; }
      if (target.origin !== origin) { response.writeHead(403).end(); return; }
      if (blocked) {
        blockedRequests.push({ path: target.pathname, serviceWorker: request.headers['service-worker'] ?? null });
        request.resume();
        response.writeHead(503).end();
        return;
      }
      if (heldFile?.path === target.pathname) {
        heldFile.requested = true;
        notify?.();
        await heldFile.releasePromise;
      }
      forwardedPaths.push(target.pathname);
      const upstream = http.request(target, { method: request.method, headers: request.headers }, incoming => {
        response.writeHead(incoming.statusCode, incoming.headers);
        incoming.pipe(response);
      });
      upstream.on('error', () => response.writeHead(502).end());
      request.pipe(upstream);
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    return {
      base: origin,
      proxy: `http://127.0.0.1:${proxy.address().port}`,
      get forwardedPaths() { return [...forwardedPaths]; },
      holdFile(requestPath) {
        if (heldFile) throw new Error('A file is already held');
        let release;
        const releasePromise = new Promise(resolve => { release = resolve; });
        heldFile = { path: requestPath, requested: false, releasePromise, release };
        return {
          waitForRequest: () => waitUntil(() => heldFile.requested),
          release: () => { heldFile = undefined; release(); },
        };
      },
      begin() { requests.length = 0; blockedRequests.length = 0; recording = true; blocked = true; },
      get blockedRequests() { return [...blockedRequests]; },
      async waitForRequest(requestPath) { await waitUntil(() => seen.has(requestPath)); },
      async end() {
        const marker = `/__offline_marker_${Date.now()}__`;
        await fetch(`http://127.0.0.1:${port}${marker}`);
        await waitUntil(() => seen.has(marker));
        recording = false;
        return [...requests];
      },
      async close() {
        if (heldFile) { heldFile.release(); heldFile = undefined; }
        await new Promise(resolve => proxy.close(resolve));
        if (child.pid && child.exitCode === null) {
          const exited = new Promise(resolve => child.once('exit', resolve));
          child.kill('SIGTERM');
          await exited;
        }
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (proxy?.listening) await new Promise(resolve => proxy.close(resolve));
    if (child?.pid && child.exitCode === null) child.kill('SIGTERM');
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

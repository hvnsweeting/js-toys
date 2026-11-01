import test from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIconStaging, replaceIconSet } from '../tools/icon-files.mjs';
import { makeIcons } from '../tools/make-icons.mjs';
import { gameRoutes } from '../tools/game-routes.mjs';
import { startObservedServer, unexpectedBlockedRequests } from '../tools/observed-server.mjs';
import { checkAndPrune, expiredRuns } from '../tools/shot-runs.mjs';
import { replaceWorkerFile } from '../tools/stamp-sw.mjs';
import { Browser, Page, prepareOfflineWorker } from '../tools/chromium.mjs';
import { createMutationScratch } from '../tools/mutation-scratch.mjs';
import { closeResources } from '../tools/close-resources.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.scratch');
const execFileAsync = promisify(execFile);

function renderedIconBrowser(close = async () => {}) {
  let viewport;
  return {
    createBrowserContext: async () => ({ newPage: async () => ({
      setViewport: async value => { viewport = value; },
      goto: async () => {},
      screenshot: async ({ path: output }) => {
        const image = Buffer.alloc(24);
        image.write('PNG', 1);
        image.writeUInt32BE(viewport.width, 16);
        image.writeUInt32BE(viewport.height, 20);
        await writeFile(output, image);
      },
    }) }),
    close,
  };
}

test('icon replacement comment describes retained backups after a failed restore', async () => {
  const source = await readFile(path.join(root, 'tools/icon-files.mjs'), 'utf8');
  assert.match(source, /If restoration fails, retain the backup for recovery on the next run\./);
  assert.doesNotMatch(source, /A failed replacement restores\s+every old file/);
});

test('game and arcade paths follow the configured base URL', () => {
  assert.deepEqual(gameRoutes('http://localhost:8080/js-toys/flappywitch/'), {
    gamePath: '/js-toys/flappywitch/',
    gameUrl: new URL('http://localhost:8080/js-toys/flappywitch/?seed=42&quality=low'),
    arcadePath: '/js-toys/index.html',
  });
  assert.equal(gameRoutes('http://localhost:8080/flappywitch/').arcadePath, '/index.html');
});

test('retention selects only generated timestamp directories', () => {
  const names = ['run-2020-notes', 'run-2026-13-01T00-00-00-000Z', 'run-2026-11-01T00-00-00-000Z', 'run-2026-11-02T00-00-00-000Z'];
  const entries = names.map(name => ({ name, isDirectory: () => true }));
  assert.deepEqual(expiredRuns(entries, 1), ['run-2026-11-01T00-00-00-000Z']);
});

test('failed browser mode still prunes its sixth run and reports the check failure', async () => {
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'retention-test-'));
  try {
    for (let day = 1; day <= 5; day++) {
      await mkdir(path.join(directory, `run-2026-11-0${day}T00-00-00-000Z`));
    }
    await assert.rejects(checkAndPrune(async () => {
      await mkdir(path.join(directory, 'run-2026-11-06T00-00-00-000Z'));
      throw new Error('injected browser failure');
    }, async () => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const name of expiredRuns(entries)) await rm(path.join(directory, name), { recursive: true });
    }), /injected browser failure/);
    assert.equal((await readdir(directory)).length, 5);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('default browser command prunes after Chromium startup fails', async () => {
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'browser-failure-test-'));
  const server = http.createServer((_request, response) => { response.writeHead(200); response.end('ready'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (let day = 1; day <= 5; day++) {
      await mkdir(path.join(directory, `run-2026-10-0${day}T00-00-00-000Z`));
    }
    await assert.rejects(execFileAsync(process.execPath, [path.join(root, 'tools/browser-check.mjs')], {
      cwd: root,
      env: { ...process.env, BASE_URL: `http://127.0.0.1:${server.address().port}/flappywitch/`,
        CHROME_PATH: path.join(directory, 'missing-chromium'), SHOTS_DIR: directory },
    }), /missing-chromium/);
    assert.equal((await readdir(directory)).filter(name => name.startsWith('run-')).length, 5);
    assert.equal(existsSync(path.join(directory, 'run-2026-10-01T00-00-00-000Z')), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('default browser command counts viewports separately from a later failure', async () => {
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'browser-count-test-'));
  const server = await startObservedServer(root, '/flappywitch/');
  try {
    await assert.rejects(execFileAsync(process.execPath, [path.join(root, 'tools/browser-check.mjs')], {
      cwd: root,
      env: { ...process.env, BASE_URL: `${server.base}/flappywitch/`, SHOTS_DIR: directory,
        BROWSER_CHECK_TEST_LATE_FAILURE: '1' },
    }), error => {
      assert.match(error.stdout, /8\/8 viewports passed/);
      assert.match(error.stderr, /injected non-viewport failure/);
      return true;
    });
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a failed icon replacement restores every original icon', async () => {
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'icon-test-'));
  const staging = path.join(directory, 'stage');
  const destination = path.join(directory, 'icons');
  await mkdir(staging);
  await mkdir(destination);
  try {
    for (const name of ['one.png', 'two.png']) {
      await writeFile(path.join(staging, name), `new ${name}`);
      await writeFile(path.join(destination, name), `old ${name}`);
    }
    let moves = 0;
    await assert.rejects(replaceIconSet(staging, destination, ['one.png', 'two.png'], async (from, to) => {
      if (++moves === 4) throw new Error('injected replacement failure');
      const { rename } = await import('node:fs/promises');
      await rename(from, to);
    }), /injected replacement failure/);
    for (const name of ['one.png', 'two.png']) {
      assert.equal(await readFile(path.join(destination, name), 'utf8'), `old ${name}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an icon backup remains after failed rollback and is recovered on the next run', async () => {
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'icon-recovery-test-'));
  const destination = path.join(directory, 'icons');
  await mkdir(destination);
  try {
    for (const name of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
      await writeFile(path.join(destination, name), `old ${name}`);
    }
    const browser = renderedIconBrowser(async () => { throw new Error('injected browser close failure'); });
    let moves = 0;
    let retainedStaging;
    await assert.rejects(makeIcons({ root: directory, launchBrowser: async () => browser, move: async (from, to) => {
      moves++;
      if (moves === 4 || moves === 5) throw new Error('injected rename failure');
      const { rename } = await import('node:fs/promises');
      await rename(from, to);
    } }), error => {
      retainedStaging = error.recoveryStaging;
      assert.ok(error.message.includes(retainedStaging));
      assert.match(error.cause.message, /injected browser close failure/);
      return true;
    });
    assert.equal(await readFile(path.join(retainedStaging, 'backup/icon-192.png'), 'utf8'), 'old icon-192.png');
    const marker = JSON.parse(await readFile(path.join(retainedStaging, 'needs-recovery'), 'utf8'));
    assert.equal(marker['icon-192.png'], createHash('sha256').update(await readFile(path.join(retainedStaging, 'icon-192.png'))).digest('hex'));
    const nextStaging = await createIconStaging(directory);
    assert.equal(existsSync(retainedStaging), false);
    assert.equal(await readFile(path.join(destination, 'icon-192.png'), 'utf8'), 'old icon-192.png');
    await rm(nextStaging, { recursive: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('recovery keeps a complete matching icon replacement', async () => {
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'icon-complete-recovery-test-'));
  const staging = path.join(directory, '.scratch', 'icons-stopped');
  const destination = path.join(directory, 'icons');
  await mkdir(path.join(staging, 'backup'), { recursive: true });
  await mkdir(destination);
  try {
    const expected = {};
    for (const name of ['one.png', 'two.png']) {
      const newIcon = `new ${name}`;
      await writeFile(path.join(destination, name), newIcon);
      await writeFile(path.join(staging, 'backup', name), `old ${name}`);
      expected[name] = createHash('sha256').update(newIcon).digest('hex');
    }
    await writeFile(path.join(staging, 'needs-recovery'), JSON.stringify(expected));
    const nextStaging = await createIconStaging(directory);
    for (const name of Object.keys(expected)) {
      assert.equal(await readFile(path.join(destination, name), 'utf8'), `new ${name}`);
    }
    assert.equal(existsSync(staging), false);
    await rm(nextStaging, { recursive: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a completed icon replacement stays installed if browser cleanup fails', async () => {
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'icon-complete-test-'));
  const destination = path.join(directory, 'icons');
  await mkdir(destination);
  const names = ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
  try {
    for (const name of names) await writeFile(path.join(destination, name), `old ${name}`);
    const browser = renderedIconBrowser(async () => { throw new Error('injected browser close failure'); });
    await assert.rejects(makeIcons({ root: directory, launchBrowser: async () => browser }), /injected browser close failure/);
    const nextStaging = await createIconStaging(directory);
    for (const name of names) {
      const image = await readFile(path.join(destination, name));
      assert.equal(image.subarray(1, 4).toString('latin1'), 'PNG');
    }
    await rm(nextStaging, { recursive: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed worker rename removes its temporary file', async () => {
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'stamp-test-'));
  const target = path.join(directory, 'sw.js');
  try {
    await writeFile(target, 'old');
    assert.throws(() => replaceWorkerFile(target, 'new', {
      openSync,
      writeFileSync,
      closeSync,
      renameSync: () => { throw new Error('injected rename failure'); },
      rmSync,
    }, () => 'rename-failure'), /injected rename failure/);
    assert.equal(existsSync(`${target}.rename-failure.new`), false);
    assert.equal(await readFile(target, 'utf8'), 'old');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('worker stamping rejects an existing symlink without changing its target', async () => {
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'stamp-symlink-test-'));
  const target = path.join(directory, 'sw.js');
  const other = path.join(directory, 'other.txt');
  const next = `${target}.collision.new`;
  try {
    await writeFile(target, 'old worker');
    await writeFile(other, 'keep this');
    await symlink(other, next);
    assert.throws(() => replaceWorkerFile(target, 'new worker', undefined, () => 'collision'), /EEXIST/);
    assert.equal(await readFile(target, 'utf8'), 'old worker');
    assert.equal(await readFile(other, 'utf8'), 'keep this');
    assert.equal(existsSync(next), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('new workers are cut off before their debugger is released', async () => {
  const commands = [];
  await prepareOfflineWorker({ send: async (method, settings) => commands.push({ method, settings }) }, 'worker');
  assert.deepEqual(commands.map(command => command.method), [
    'Network.enable', 'Network.emulateNetworkConditions', 'Runtime.runIfWaitingForDebugger',
  ]);
  assert.equal(commands[1].settings.offline, true);
});

test('offline mode auto-attaches paused workers before a reload', async () => {
  const calls = [];
  const connection = {
    listeners: new Map(),
    send: async (method, settings, sessionId) => { calls.push({ method, settings, sessionId }); },
  };
  const browser = new Browser(connection, {}, () => {});
  browser.offlineWorkerSetup = async () => 1;
  const page = new Page(connection, browser, 'page', 'page-session', 'context');
  assert.equal(await page.setOfflineEverywhere(true), 1);
  const attach = calls.find(call => call.method === 'Target.setAutoAttach');
  assert.deepEqual(attach.settings, {
    autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
    filter: [{ type: 'service_worker', exclude: false }],
  });
  connection.listeners.get('')('Target.attachedToTarget', {
    sessionId: 'worker-session',
    targetInfo: { type: 'service_worker', browserContextId: 'context', targetId: 'new-worker' },
  });
  await browser.offlineWorkers.get('new-worker');
  assert.deepEqual(calls.slice(-3).map(call => call.method), [
    'Network.enable', 'Network.emulateNetworkConditions', 'Runtime.runIfWaitingForDebugger',
  ]);
});

test('the static server records game-file requests during the offline window', async () => {
  const server = await startObservedServer(root, '/flappywitch/');
  try {
    server.begin();
    const response = await fetch(`${server.base}/flappywitch/index.html`);
    assert.equal(response.status, 200);
    assert.deepEqual(await server.end(), ['/flappywitch/index.html']);
  } finally {
    await server.close();
  }
});

test('request counting includes a game file whose response finishes after the marker starts', async () => {
  const server = await startObservedServer(root, '/flappywitch/');
  try {
    server.begin();
    const requestPath = '/flappywitch/index.html?delay_request=1';
    const delayed = fetch(`${server.base}${requestPath}`);
    await server.waitForRequest(requestPath);
    const observed = await server.end();
    assert.equal((await delayed).status, 200);
    assert.deepEqual(observed, [requestPath]);
  } finally {
    await server.close();
  }
});

test('the proxy forwards online files and blocks every offline game request', async () => {
  const server = await startObservedServer(root, '/flappywitch/');
  const proxy = new URL(server.proxy);
  const requestFile = () => new Promise((resolve, reject) => {
    http.get({ hostname: proxy.hostname, port: proxy.port, path: `${server.base}/flappywitch/index.html` }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
  });
  try {
    assert.equal(await requestFile(), 200);
    assert.deepEqual(server.forwardedPaths, ['/flappywitch/index.html']);
    server.begin();
    assert.equal(await requestFile(), 503);
    assert.deepEqual(await server.end(), []);
    assert.deepEqual(server.blockedRequests, [{ path: '/flappywitch/index.html', serviceWorker: null }]);
    assert.deepEqual(unexpectedBlockedRequests(server.blockedRequests, '/flappywitch/'), server.blockedRequests);
    assert.deepEqual(unexpectedBlockedRequests([
      { path: '/flappywitch/sw.js', serviceWorker: 'script' },
      { path: '/flappywitch/sw.js', serviceWorker: null },
    ], '/flappywitch/'), [{ path: '/flappywitch/sw.js', serviceWorker: null }]);
  } finally {
    await server.close();
  }
});

test('failed static-server startup removes its private directory', async () => {
  await mkdir(scratch, { recursive: true });
  const fixture = await mkdtemp(path.join(scratch, 'server-startup-test-'));
  try {
    await assert.rejects(startObservedServer(fixture, '/flappywitch/', () => {
      throw new Error('injected spawn failure');
    }), /injected spawn failure/);
    assert.deepEqual(await readdir(path.join(fixture, '.scratch')), []);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('a page-close error still closes the context and browser', async () => {
  const closed = [];
  await assert.rejects(closeResources([
    { close: async () => { closed.push('page'); throw new Error('page close failed'); } },
    { close: async () => { closed.push('context'); } },
    { close: async () => { closed.push('browser'); } },
    { close: async () => { closed.push('server'); } },
  ]), /page close failed/);
  assert.deepEqual(closed, ['page', 'context', 'browser', 'server']);
});

test('mutation checker creates the scratch parent in a fresh tree', async () => {
  await mkdir(scratch, { recursive: true });
  const fixture = await mkdtemp(path.join(scratch, 'fresh-tree-'));
  try {
    const created = await createMutationScratch(fixture);
    assert.ok(created.startsWith(path.join(fixture, '.scratch', 'mutation-')));
    assert.equal(existsSync(created), true);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('arcade serving has separate game and arcade pages', async () => {
  assert.equal(existsSync(path.join(root, 'server.mjs')), false);
  assert.equal(existsSync(path.join(root, 'test/server.test.mjs')), false);
  const game = await readFile(path.join(root, 'index.html'), 'utf8');
  const arcade = await readFile(path.join(root, '..', 'index.html'), 'utf8');
  assert.match(game, /id="arcade-back"[^>]*href="\.\.\/index\.html"/);
  assert.notEqual(game, arcade);
  // The game's own `make serve` serves the arcade root, so Back to arcade has a page to open.
  assert.match(await readFile(path.join(root, 'Makefile'), 'utf8'), /python3 -m http\.server .*--directory \.\.$/m);
});

test('vendor hook comment points to the existing mapping test', async () => {
  const hook = await readFile(path.join(root, 'tools/vendor-three-hooks.mjs'), 'utf8');
  assert.match(hook, /test\/vendor\.test\.mjs/);
  assert.doesNotMatch(hook, /test\/vendorHook\.test\.js/);
});

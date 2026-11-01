import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {link, mkdtemp, mkdir, symlink, writeFile, rm} from 'node:fs/promises';
import {createServer, resolvePublicPath, resolveRealPublicPath} from '../server.mjs';

for (const api of [path.posix, path.win32]) {
  test(`public route safety with ${api.sep} paths`, () => {
    const root = api.resolve('game');
    assert.equal(resolvePublicPath(root, '/', api).status, 200);
    assert.equal(resolvePublicPath(root, '/src/main.js', api).status, 200);
    assert.equal(resolvePublicPath(root, '/timeline-lab.html', api).status, 200);
    assert.equal(resolvePublicPath(root, '/timeline-lab.css', api).status, 403);
    for (const route
             of ['/package.json', '/src/../package.json', '/src/..%5cpackage.json', '/%E0%A4%A',
                 '/assets/../../index.html']) {
      assert.notEqual(resolvePublicPath(root, route, api).status, 200, route);
    }
  });
}

test('resolved symlinks must still point to public files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tachyon-server-'));
  try {
    await mkdir(path.join(root, 'assets'));
    await writeFile(path.join(root, '.env'), 'test only');
    await writeFile(path.join(root, 'style.css'), 'body {}');
    await symlink('../.env', path.join(root, 'assets', 'expose'));
    await symlink('../style.css', path.join(root, 'assets', 'public'));
    const hidden = resolvePublicPath(root, '/assets/expose');
    const publicFile = resolvePublicPath(root, '/assets/public');
    assert.equal(hidden.status, 200);
    assert.equal((await resolveRealPublicPath(root, hidden.file)).status, 403);
    assert.equal((await resolveRealPublicPath(root, publicFile.file)).status, 200);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

// Drives the real request handler, so removing a check from the server route fails here even when
// the path helpers above still pass.
test('server route blocks symlinked and hard-linked files and serves public ones', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tachyon-route-'));
  const server = createServer(root);
  try {
    await mkdir(path.join(root, 'assets'));
    await writeFile(path.join(root, '.env'), 'test only');
    await writeFile(path.join(root, 'style.css'), 'body {}');
    await writeFile(path.join(root, 'assets', 'shared.png'), 'png');
    await symlink('../.env', path.join(root, 'assets', 'expose'));
    await link(path.join(root, 'assets', 'shared.png'), path.join(root, 'assets', 'hard.png'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const statusOf = async route => (await fetch(base + route)).status;
    assert.equal(await statusOf('/style.css'), 200);
    assert.equal(await (await fetch(`${base}/style.css`)).text(), 'body {}');
    assert.equal(await statusOf('/assets/expose'), 403);
    assert.equal(await statusOf('/assets/hard.png'), 403);
    assert.equal(await statusOf('/.env'), 403);
    assert.equal(await statusOf('/assets/missing.png'), 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, {recursive: true, force: true});
  }
});

// Drives headless Chromium over the Chrome DevTools Protocol, so the browser check needs no
// package from npm. It offers the part of puppeteer-core's interface that tools/browser-check.mjs
// uses. The launch flags, viewport and touch emulation, and the mouse, key and touch events are
// copied from puppeteer-core 24.10's source, as is `evaluate` counting as a user gesture (so a
// sound may start, as with puppeteer). Two calls do less than puppeteer's: waitForNavigation waits
// for a new document only (not a History API or #anchor change), and waitForFunction resolves to
// true, not to a handle on the value. Two calls are not puppeteer's: appManifest() (the browser's
// reading of the page's web app manifest), setOfflineEverywhere() (offline for the page and its
// service workers), stopServiceWorkers() and clearHttpCache(). No other call is offered.
//
// The protocol runs over a pipe (--remote-debugging-pipe; puppeteer uses a local WebSocket port by
// default): the browser reads commands on its file descriptor 3 and writes replies and events on
// 4, each a JSON message ended by a NUL byte. The driver opens no debugging network port; the pipe
// is reachable only through this process and the browser (or a process allowed to read theirs).
//
// Protocol reference: https://chromedevtools.github.io/devtools-protocol/
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// puppeteer-core 24.10's default flags for headless Chromium, so pages behave as they did under it:
// no throttling of background timers or renderers, no extensions, sound muted.
const DEFAULT_FLAGS = [
  '--allow-pre-commit-input',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-breakpad',
  '--disable-client-side-phishing-detection',
  '--disable-component-extensions-with-background-pages',
  '--disable-crash-reporter',
  '--disable-default-apps',
  '--disable-dev-shm-usage',
  '--disable-hang-monitor',
  '--disable-infobars',
  '--disable-ipc-flooding-protection',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--disable-renderer-backgrounding',
  '--disable-search-engine-choice-screen',
  '--disable-sync',
  '--enable-automation',
  '--export-tagged-pdf',
  '--force-color-profile=srgb',
  '--generate-pdf-document-outline',
  '--metrics-recording-only',
  '--no-first-run',
  '--password-store=basic',
  '--use-mock-keychain',
  '--disable-features=Translate,AcceptCHFrame,MediaRouter,OptimizationHints,ProcessPerSiteUpToMainFrameThreshold,IsolateSandboxedIframes',
  '--enable-features=PdfOopif',
  '--headless=new',
  '--hide-scrollbars',
  '--mute-audio',
  '--disable-extensions',
];

// Starts Chromium with its own new profile folder, removed again by browser.close().
export async function launch({ executablePath, args = [] }) {
  // mkdtemp makes the folder readable by its owner only.
  const profile = mkdtempSync(join(tmpdir(), 'browser-check-profile-'));
  const flags = [...DEFAULT_FLAGS, `--user-data-dir=${profile}`, '--remote-debugging-pipe', ...args, 'about:blank'];
  const child = spawn(executablePath, flags, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  // The last part of the browser's own log, shown if it fails to start.
  let log = '';
  child.stderr.on('data', (chunk) => (log = (log + chunk).slice(-4000)));
  const connection = new Connection(child.stdio[3], child.stdio[4]);
  child.once('error', (error) => connection.stop(error));
  child.once('exit', () => connection.stop(new Error('the browser exited')));
  // If this script ends without closing the browser (an uncaught error), stop it and remove its
  // profile anyway. An exit handler cannot wait, so files the browser writes while it dies may stay.
  // A signal such as Ctrl-C ends Node without running exit handlers; the profile then stays.
  const removeProfile = () => {
    process.off('exit', killAndRemove);
    rmSync(profile, { recursive: true, force: true });
  };
  const killAndRemove = () => {
    child.kill('SIGKILL');
    removeProfile();
  };
  process.once('exit', killAndRemove);
  try {
    await connection.send('Browser.getVersion');
  } catch (error) {
    await stopProcess(child);
    removeProfile();
    throw new Error(`could not start ${executablePath}: ${error.message}\n${log}`);
  }
  return new Browser(connection, child, removeProfile);
}

// Resolves once the process has ended, killing it first if it is still running.
async function stopProcess(child) {
  const neverStarted = child.pid === undefined;
  const ended = child.exitCode !== null || child.signalCode !== null;
  if (neverStarted || ended) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGKILL');
  await exited;
}

// One message channel to the browser. Replies are matched to commands by id; events go to the
// listener registered for their session (a page), or to the browser's for events with none.
class Connection {
  constructor(toBrowser, fromBrowser) {
    this.toBrowser = toBrowser;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.stopped = null;
    this.onStop = () => {};
    let unread = Buffer.alloc(0);
    fromBrowser.on('data', (chunk) => {
      unread = Buffer.concat([unread, chunk]);
      let end;
      while ((end = unread.indexOf(0)) !== -1) {
        this.receive(JSON.parse(unread.subarray(0, end).toString('utf8')));
        unread = unread.subarray(end + 1);
      }
    });
    // A write to a browser that has exited fails here; the exit itself is reported by stop().
    toBrowser.on('error', () => {});
    fromBrowser.on('error', () => {});
  }

  send(method, params = {}, sessionId = undefined) {
    if (this.stopped) return Promise.reject(this.stopped);
    const id = this.nextId++;
    this.toBrowser.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }

  receive(message) {
    if (message.id === undefined) {
      this.listeners.get(message.sessionId ?? '')?.(message.method, message.params);
      return;
    }
    const call = this.pending.get(message.id);
    if (!call) return;
    this.pending.delete(message.id);
    if (message.error) call.reject(new Error(`${call.method}: ${message.error.message}`));
    else call.resolve(message.result);
  }

  stop(error) {
    this.stopped ??= error;
    for (const call of this.pending.values()) call.reject(error);
    this.pending.clear();
    this.onStop();
  }
}

class Browser {
  constructor(connection, child, removeProfile) {
    this.connection = connection;
    this.child = child;
    this.removeProfile = removeProfile;
    this.pages = new Map();
    // Browser contexts set offline by setOfflineEverywhere, and per context the service workers
    // cut off so far (those running then and those started since).
    this.offlineContexts = new Set();
    this.cutOffWorkers = new Map();
    this.watchingWorkers = false;
    connection.listeners.set('', (method, params) => {
      if (method === 'Target.detachedFromTarget') this.pages.get(params.sessionId)?.markClosed();
      if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'service_worker') this.onWorkerStarted(params);
    });
    // A browser that exits takes every page with it; their waits end at once instead of timing out.
    connection.onStop = () => {
      for (const page of this.pages.values()) page.markClosed();
    };
  }

  // From the first call on, every service worker that starts is held before its first line runs
  // (waitForDebuggerOnStart), so one in an offline context is cut off before it can fetch.
  async watchServiceWorkers() {
    if (this.watchingWorkers) return;
    this.watchingWorkers = true;
    const onlyWorkers = [{ type: 'service_worker', exclude: false }, { exclude: true }];
    await this.connection.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: onlyWorkers });
  }

  async onWorkerStarted({ sessionId, targetInfo, waitingForDebugger }) {
    const contextId = targetInfo.browserContextId;
    try {
      if (this.offlineContexts.has(contextId)) {
        await this.connection.send('Network.enable', {}, sessionId);
        await this.connection.send('Network.emulateNetworkConditions', OFFLINE, sessionId);
        if (!this.cutOffWorkers.has(contextId)) this.cutOffWorkers.set(contextId, new Set());
        this.cutOffWorkers.get(contextId).add(targetInfo.targetId);
      }
    } catch {
      // A worker that ended meanwhile needs no network setting.
    } finally {
      if (waitingForDebugger) await this.connection.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
    }
  }

  async createBrowserContext() {
    const { browserContextId } = await this.connection.send('Target.createBrowserContext');
    return new BrowserContext(this, browserContextId);
  }

  // Asks the browser to close, gives it 5 seconds, then kills it; the profile is removed only after
  // the process has ended, so the browser writes no file into it afterwards.
  async close() {
    const running = this.child.exitCode === null && this.child.signalCode === null;
    if (running) {
      const exited = new Promise((resolve) => this.child.once('exit', () => resolve(true)));
      let timer;
      const gaveUp = new Promise((resolve) => (timer = setTimeout(resolve, 5000, false)));
      this.connection.send('Browser.close').catch(() => {});
      const closedByItself = await Promise.race([exited, gaveUp]);
      clearTimeout(timer);
      if (!closedByItself) await stopProcess(this.child);
    }
    this.removeProfile();
  }
}

class BrowserContext {
  constructor(browser, id) {
    this.browser = browser;
    this.id = id;
  }

  async newPage() {
    const connection = this.browser.connection;
    const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank', browserContextId: this.id });
    const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(connection, targetId, sessionId, this.id, this.browser);
    this.browser.pages.set(sessionId, page);
    await page.start();
    return page;
  }

  // Closes every page in the context.
  async close() {
    await this.browser.connection.send('Target.disposeBrowserContext', { browserContextId: this.id });
  }
}

const OFFLINE = { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
const ONLINE = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };

// What page.goto, reload and waitForNavigation wait for, as Chromium's lifecycle event names.
const LIFECYCLE_EVENT = { load: 'load', domcontentloaded: 'DOMContentLoaded', networkidle0: 'networkIdle', networkidle2: 'networkAlmostIdle' };

// Emits 'request', 'console' and 'pageerror', with the same objects puppeteer's events give, cut
// down to the methods the browser check calls.
class Page extends EventEmitter {
  constructor(connection, targetId, sessionId, browserContextId, browser) {
    super();
    this.connection = connection;
    this.browser = browser;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.browserContextId = browserContextId;
    // Sessions on the context's service workers, by target id, made by setOfflineEverywhere.
    this.workerSessions = new Map();
    // Each running status the site's service workers reported ('stopped', 'starting', 'running'),
    // in order, once stopServiceWorkers has turned the reports on.
    this.workerStatuses = [];
    this.closed = false;
    // interceptionAsked is set when setRequestInterception starts, intercepting when the browser has it.
    this.interceptionAsked = false;
    this.intercepting = false;
    // The main frame's current document (its loader) and the lifecycle events each document reached.
    this.mainFrameId = null;
    this.loaderId = null;
    this.currentUrl = 'about:blank';
    this.lifecycle = new Map();
    this.waiters = new Set();
    // As puppeteer: changing the mobile or touch emulation reloads the page.
    this.emulation = { mobile: false, touch: false };
    this.keyboard = new Keyboard(this);
    this.mouse = new Mouse(this);
    this.touchscreen = new Touchscreen(this);
    connection.listeners.set(sessionId, (method, params) => this.onEvent(method, params));
  }

  send(method, params = {}) {
    return this.connection.send(method, params, this.sessionId);
  }

  async start() {
    await Promise.all([
      this.send('Page.enable'),
      this.send('Page.setLifecycleEventsEnabled', { enabled: true }),
      this.send('Runtime.enable'),
      this.send('Network.enable'),
      this.send('Log.enable'),
    ]);
    const { frameTree } = await this.send('Page.getFrameTree');
    this.mainFrameId = frameTree.frame.id;
    this.loaderId = frameTree.frame.loaderId;
    this.currentUrl = frameTree.frame.url;
  }

  onEvent(method, params) {
    switch (method) {
      case 'Page.frameNavigated':
        if (params.frame.id !== this.mainFrameId) return;
        this.loaderId = params.frame.loaderId;
        this.currentUrl = params.frame.url;
        this.checkWaiters();
        return;
      case 'Page.lifecycleEvent': {
        if (params.frameId !== this.mainFrameId) return;
        if (!this.lifecycle.has(params.loaderId)) this.lifecycle.set(params.loaderId, new Set());
        this.lifecycle.get(params.loaderId).add(params.name);
        this.checkWaiters();
        return;
      }
      case 'Runtime.exceptionThrown':
        this.emit('pageerror', new Error(exceptionMessage(params.exceptionDetails)));
        return;
      case 'Runtime.consoleAPICalled': {
        const type = params.type === 'warning' ? 'warn' : params.type;
        const text = params.args.map(remoteText).join(' ');
        const args = params.args.map((remote) => new Handle(this, remote, params.executionContextId));
        const url = params.stackTrace?.callFrames[0]?.url ?? '';
        this.emit('console', new ConsoleMessage(type, text, args, url));
        return;
      }
      case 'Log.entryAdded': {
        // Browser messages such as a failed load ("net::ERR_NAME_NOT_RESOLVED") come this way.
        const { level, text, source, url = '' } = params.entry;
        if (source === 'worker') return;
        const type = { warning: 'warn', verbose: 'debug' }[level] ?? level;
        this.emit('console', new ConsoleMessage(type, text, [], url));
        return;
      }
      case 'Network.requestWillBeSent':
        // While requests are intercepted, each is reported once, from Fetch.requestPaused.
        if (this.intercepting) return;
        this.emit('request', new Request(this, { url: params.request.url, frameId: params.frameId, resourceType: params.type, requestId: null }));
        return;
      case 'ServiceWorker.workerVersionUpdated':
        for (const version of params.versions) this.workerStatuses.push(version.runningStatus);
        return;
      case 'Fetch.requestPaused':
        this.emit('request', new Request(this, { url: params.request.url, frameId: params.frameId, resourceType: params.resourceType, requestId: params.requestId }));
        return;
    }
  }

  // Resolves when test() holds, checked after every navigation or lifecycle event.
  waitForState(test, timeout, what) {
    if (test()) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      const waiter = { test, resolve, reject };
      waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`waiting for ${what}: ${timeout} ms exceeded`));
      }, timeout);
      this.waiters.add(waiter);
    });
  }

  checkWaiters() {
    for (const waiter of this.waiters) {
      if (!waiter.test()) continue;
      clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.resolve(true);
    }
  }

  markClosed() {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('the page closed'));
    }
    this.waiters.clear();
  }

  // Waits until the main frame holds a new document that reached `waitUntil`.
  waitForNavigation({ waitUntil = 'load', timeout = 30000 } = {}) {
    const event = LIFECYCLE_EVENT[waitUntil];
    if (!event) throw new Error(`unknown waitUntil: ${waitUntil}`);
    const startingDocument = this.loaderId;
    const arrived = () => this.loaderId !== startingDocument && this.lifecycle.get(this.loaderId)?.has(event);
    return this.waitForState(arrived, timeout, `navigation (${waitUntil})`);
  }

  async goto(url, { waitUntil = 'load', timeout = 30000 } = {}) {
    const navigation = this.waitForNavigation({ waitUntil, timeout });
    // On an early error the wait is dropped; its own failure then needs no handler.
    navigation.catch(() => {});
    const { errorText } = await this.send('Page.navigate', { url, frameId: this.mainFrameId });
    if (errorText) throw new Error(`${errorText} at ${url}`);
    return navigation;
  }

  async reload({ waitUntil = 'load', timeout = 30000 } = {}) {
    const navigation = this.waitForNavigation({ waitUntil, timeout });
    navigation.catch(() => {});
    await this.send('Page.reload');
    return navigation;
  }

  // Runs fn(...args) in the page and returns its result, copied as JSON (plus NaN, Infinity and -0).
  // The arguments travel as JSON too, which is all the browser check passes.
  async evaluate(fn, ...args) {
    const argumentList = args.map((value) => JSON.stringify(value) ?? 'undefined').join(', ');
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression: `(${fn})(${argumentList})`,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (exceptionDetails) throw new PageException(exceptionMessage(exceptionDetails));
    return remoteValue(result);
  }

  async evaluateOnNewDocument(fn, ...args) {
    const argumentList = args.map((value) => JSON.stringify(value) ?? 'undefined').join(', ');
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${fn})(${argumentList})` });
  }

  // Polls fn in the page until it returns a true value. As with puppeteer, an exception thrown by
  // fn ends the wait at once; a page that is between documents is polled again. The value is
  // tested in the page, because fn may return an object that cannot be copied out as JSON (the
  // game object holds the three.js scene).
  async waitForFunction(fn, { timeout = 30000, polling = 100 } = {}, ...args) {
    const deadline = Date.now() + timeout;
    const isTrue = `async (...args) => Boolean(await (${fn})(...args))`;
    for (;;) {
      try {
        if (await this.evaluate(isTrue, ...args)) return true;
      } catch (error) {
        if (error instanceof PageException) throw error;
        if (this.closed) throw new Error(`waitForFunction: the page closed (${error.message})`);
      }
      if (Date.now() >= deadline) throw new Error(`waitForFunction: ${timeout} ms exceeded`);
      await new Promise((resolve) => setTimeout(resolve, polling));
    }
  }

  async setViewport({ width, height, deviceScaleFactor = 1, hasTouch = false, isMobile = false }) {
    await Promise.all([
      this.send('Emulation.setDeviceMetricsOverride', { mobile: isMobile, width, height, deviceScaleFactor, screenOrientation: { angle: 0, type: 'portraitPrimary' } }),
      this.send('Emulation.setTouchEmulationEnabled', { enabled: hasTouch }),
    ]);
    const needsReload = this.emulation.mobile !== isMobile || this.emulation.touch !== hasTouch;
    this.emulation = { mobile: isMobile, touch: hasTouch };
    if (needsReload) await this.reload();
  }

  // Cuts the page itself off from the network, as puppeteer's setOfflineMode does. A service
  // worker is a target of its own, so the requests it makes still reach the network: to test an
  // offline copy, use setOfflineEverywhere.
  async setOfflineMode(offline) {
    await this.send('Network.emulateNetworkConditions', offline ? OFFLINE : ONLINE);
  }

  // Cuts the page and the service workers of its browser context off from the network, so only
  // what a worker has stored can answer: those running now, and (while offline) any that starts,
  // which is held at its start until it is cut off. Returns the ids of the workers running now.
  async setOfflineEverywhere(offline) {
    const contexts = this.browser.offlineContexts;
    if (offline) contexts.add(this.browserContextId);
    else contexts.delete(this.browserContextId);
    await this.browser.watchServiceWorkers();
    await this.setOfflineMode(offline);
    const conditions = offline ? OFFLINE : ONLINE;
    const workers = await this.serviceWorkerIds();
    for (const targetId of workers) {
      if (!this.workerSessions.has(targetId)) {
        const { sessionId } = await this.connection.send('Target.attachToTarget', { targetId, flatten: true });
        this.workerSessions.set(targetId, sessionId);
      }
      const sessionId = this.workerSessions.get(targetId);
      await this.connection.send('Network.enable', {}, sessionId);
      await this.connection.send('Network.emulateNetworkConditions', conditions, sessionId);
      if (offline) this.cutOffWorkerIds().add(targetId);
    }
    return workers;
  }

  // Stops every running service worker of the site (the next request starts one again). From
  // here on, workerStatuses records their running status as it changes.
  async stopServiceWorkers() {
    await this.send('ServiceWorker.enable');
    await this.send('ServiceWorker.stopAllWorkers');
  }

  // Every service worker of this page's context cut off by setOfflineEverywhere so far.
  cutOffWorkerIds() {
    const all = this.browser.cutOffWorkers;
    if (!all.has(this.browserContextId)) all.set(this.browserContextId, new Set());
    return all.get(this.browserContextId);
  }

  // The target ids of the service workers running in this page's browser context.
  async serviceWorkerIds() {
    const { targetInfos } = await this.connection.send('Target.getTargets');
    return targetInfos.filter((target) => target.type === 'service_worker' && target.browserContextId === this.browserContextId).map((target) => target.targetId);
  }

  // Empties the browser's ordinary HTTP cache (not a service worker's stored files), which would
  // otherwise answer some requests even offline.
  async clearHttpCache() {
    await this.send('Network.clearBrowserCache');
  }

  // How the browser reads the page's manifest: { url, errors, data } (errors is a list of
  // { message, critical }), from Page.getAppManifest.
  async appManifest() {
    return await this.send('Page.getAppManifest');
  }

  async emulateMediaFeatures(features) {
    await this.send('Emulation.setEmulatedMedia', { features });
  }

  // As puppeteer, the cache is off while requests are intercepted. The switch is made once the
  // browser has it, so a request sent meanwhile is still reported (from Network.requestWillBeSent,
  // as one that can no longer be held: see Request.resolve).
  async setRequestInterception(enabled) {
    this.interceptionAsked = enabled;
    await this.send('Network.setCacheDisabled', { cacheDisabled: enabled });
    if (enabled) await this.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    else await this.send('Fetch.disable');
    this.intercepting = enabled;
  }

  // Clicks the middle of the first element matching selector, scrolled into view first if it is not.
  async click(selector) {
    const point = await this.evaluate((selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const inView = box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight && box.right <= innerWidth;
      if (!inView) element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const shown = element.getBoundingClientRect();
      return { x: shown.left + shown.width / 2, y: shown.top + shown.height / 2 };
    }, selector);
    if (!point) throw new Error(`no element matches ${selector}`);
    await this.mouse.click(point.x, point.y);
  }

  async screenshot({ path }) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(data, 'base64'));
  }

  url() {
    return this.currentUrl;
  }

  // The main frame's id; request.frame() returns the same kind of id, so the two compare.
  mainFrame() {
    return this.mainFrameId;
  }

  isClosed() {
    return this.closed;
  }

  async close() {
    await this.connection.send('Target.closeTarget', { targetId: this.targetId });
    this.markClosed();
  }
}

// An exception thrown by the page's own code, as opposed to a protocol error.
class PageException extends Error {}

// The first line of what was thrown, without the "TypeError: " in front, as puppeteer reports it.
function exceptionMessage(details) {
  const description = details.exception?.description ?? details.exception?.value ?? details.text;
  const firstLine = String(description).split('\n')[0];
  const className = details.exception?.className;
  const prefix = `${className}: `;
  return className && firstLine.startsWith(prefix) ? firstLine.slice(prefix.length) : firstLine;
}

function remoteValue(remote) {
  if (remote.unserializableValue === undefined) return remote.value;
  // NaN, Infinity, -Infinity and -0 are not JSON; a BigInt is written with a trailing n.
  const text = remote.unserializableValue;
  return text.endsWith('n') ? BigInt(text.slice(0, -1)) : Number(text);
}

function remoteText(remote) {
  if (remote.value !== undefined) return String(remote.value);
  return remote.unserializableValue ?? remote.description ?? '';
}

// location().url is the address the message is about: the script that logged it, or for a
// browser message such as a failed load, the resource that failed.
class ConsoleMessage {
  constructor(type, text, args, url) {
    this.messageType = type;
    this.messageText = text;
    this.messageArgs = args;
    this.messageUrl = url;
  }
  location() {
    return { url: this.messageUrl };
  }
  type() {
    return this.messageType;
  }
  text() {
    return this.messageText;
  }
  args() {
    return this.messageArgs;
  }
}

// One value passed to console.*, still in the page.
class Handle {
  constructor(page, remote, executionContextId) {
    this.page = page;
    this.remote = remote;
    this.executionContextId = executionContextId;
  }

  async evaluate(fn) {
    const { objectId, value, unserializableValue } = this.remote;
    const argument = objectId ? { objectId } : unserializableValue ? { unserializableValue } : { value };
    const target = objectId ? { objectId } : { executionContextId: this.executionContextId };
    const { result, exceptionDetails } = await this.page.send('Runtime.callFunctionOn', {
      functionDeclaration: String(fn),
      ...target,
      arguments: [argument],
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) throw new PageException(exceptionMessage(exceptionDetails));
    return remoteValue(result);
  }
}

// The protocol's name for each abort reason the browser check uses.
const ABORT_REASONS = { failed: 'Failed', internetdisconnected: 'InternetDisconnected' };

// A request the page made. Without interception it can only be read; with it, the listener must
// let it continue, answer it, or fail it, and the page waits until one of them does.
class Request {
  constructor(page, { url, frameId, resourceType, requestId }) {
    this.page = page;
    this.address = url;
    this.frameId = frameId;
    this.resourceType = resourceType;
    this.requestId = requestId;
    this.handled = false;
  }

  url() {
    return this.address;
  }

  isNavigationRequest() {
    return this.resourceType === 'Document';
  }

  frame() {
    return this.frameId;
  }

  isInterceptResolutionHandled() {
    return this.handled;
  }

  continue() {
    return this.resolve('Fetch.continueRequest', {});
  }

  respond({ status = 200, contentType = null, body = '' }) {
    const responseHeaders = contentType ? [{ name: 'content-type', value: contentType }] : [];
    return this.resolve('Fetch.fulfillRequest', { responseCode: status, responseHeaders, body: Buffer.from(body).toString('base64') });
  }

  abort(reason = 'failed') {
    const errorReason = ABORT_REASONS[reason];
    if (!errorReason) throw new Error(`unknown abort reason: ${reason}`);
    return this.resolve('Fetch.failRequest', { errorReason });
  }

  resolve(method, params) {
    if (this.handled) throw new Error('the request is already handled');
    this.handled = true;
    // A request reported while interception was being switched on has already gone to the network;
    // only one the browser holds (it has a Fetch request id) can be answered.
    if (this.requestId === null && this.page.interceptionAsked) return Promise.resolve();
    if (this.requestId === null) throw new Error('requests are not being intercepted');
    // The page may close before the browser takes the answer; that request is gone anyway.
    return this.page.send(method, { requestId: this.requestId, ...params }).catch(() => {});
  }
}

// puppeteer's definitions of the keys the browser check presses: letters, Space, Enter, Tab and Control.
const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r', location: 0 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9, text: '', location: 0 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ', location: 0 },
  Control: { key: 'Control', code: 'ControlLeft', keyCode: 17, text: '', location: 1 },
};
for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
  KEYS[letter] = { key: letter, code: `Key${letter.toUpperCase()}`, keyCode: letter.toUpperCase().charCodeAt(0), text: letter, location: 0 };
}
const CONTROL_BIT = 2;

class Keyboard {
  constructor(page) {
    this.page = page;
    this.modifiers = 0;
    this.pressed = new Set();
  }

  definition(name) {
    const key = KEYS[name];
    if (!key) throw new Error(`unknown key: ${name}`);
    return key;
  }

  async down(name) {
    const key = this.definition(name);
    // A key sent again while held is a key repeat, as a held key sends.
    const autoRepeat = this.pressed.has(key.code);
    this.pressed.add(key.code);
    if (key.key === 'Control') this.modifiers |= CONTROL_BIT;
    // With Control held a letter types no text, as on a real keyboard.
    const text = this.modifiers ? '' : key.text;
    await this.page.send('Input.dispatchKeyEvent', {
      type: text ? 'keyDown' : 'rawKeyDown',
      modifiers: this.modifiers,
      windowsVirtualKeyCode: key.keyCode,
      code: key.code,
      key: key.key,
      text,
      unmodifiedText: text,
      autoRepeat,
      location: key.location,
      isKeypad: false,
    });
  }

  async up(name) {
    const key = this.definition(name);
    if (key.key === 'Control') this.modifiers &= ~CONTROL_BIT;
    this.pressed.delete(key.code);
    await this.page.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      modifiers: this.modifiers,
      key: key.key,
      windowsVirtualKeyCode: key.keyCode,
      code: key.code,
      location: key.location,
    });
  }

  async press(name) {
    await this.down(name);
    await this.up(name);
  }
}

// The left mouse button only: the browser check uses no other.
class Mouse {
  constructor(page) {
    this.page = page;
    this.x = 0;
    this.y = 0;
    this.buttonDown = false;
  }

  dispatch(type, extra = {}) {
    return this.page.send('Input.dispatchMouseEvent', {
      type,
      x: this.x,
      y: this.y,
      modifiers: this.page.keyboard.modifiers,
      buttons: this.buttonDown ? 1 : 0,
      ...extra,
    });
  }

  // Moves in `steps` equal steps from where the mouse is, as a hand would.
  async move(x, y, { steps = 1 } = {}) {
    const fromX = this.x;
    const fromY = this.y;
    for (let step = 1; step <= steps; step++) {
      this.x = fromX + (x - fromX) * (step / steps);
      this.y = fromY + (y - fromY) * (step / steps);
      await this.dispatch('mouseMoved', { button: this.buttonDown ? 'left' : 'none' });
    }
  }

  async down() {
    if (this.buttonDown) throw new Error('the mouse button is already down');
    this.buttonDown = true;
    await this.dispatch('mousePressed', { button: 'left', clickCount: 1 });
  }

  async up() {
    if (!this.buttonDown) throw new Error('the mouse button is not down');
    this.buttonDown = false;
    await this.dispatch('mouseReleased', { button: 'left', clickCount: 1 });
  }

  async click(x, y) {
    await this.move(x, y);
    await this.down();
    await this.up();
  }

  async wheel({ deltaX = 0, deltaY = 0 } = {}) {
    await this.dispatch('mouseWheel', { pointerType: 'mouse', deltaX, deltaY });
  }
}

// One finger at a time, which is all the browser check uses.
class Touchscreen {
  constructor(page) {
    this.page = page;
    this.nextId = 0;
    this.touches = [];
  }

  dispatch(type, touch) {
    return this.page.send('Input.dispatchTouchEvent', { type, touchPoints: [touch], modifiers: this.page.keyboard.modifiers });
  }

  async touchStart(x, y) {
    const touch = { x: Math.round(x), y: Math.round(y), radiusX: 0.5, radiusY: 0.5, force: 0.5, id: this.nextId++ };
    this.touches.push(touch);
    await this.dispatch('touchStart', touch);
  }

  async touchMove(x, y) {
    const touch = this.touches[0];
    if (!touch) throw new Error('no touch has started');
    touch.x = Math.round(x);
    touch.y = Math.round(y);
    await this.dispatch('touchMove', touch);
  }

  async touchEnd() {
    const touch = this.touches.shift();
    if (!touch) throw new Error('no touch has started');
    await this.dispatch('touchEnd', touch);
  }

  async tap(x, y) {
    await this.touchStart(x, y);
    await this.touchEnd();
  }
}

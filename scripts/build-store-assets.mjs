// Regenerates the Chrome Web Store screenshots and promo tile.
//
//   npm run store-assets
//
// The point of generating these rather than hand-capturing them is that the
// popup in every shot is the real dist/popup, and the "after" panes are
// produced by running the real dist/content.js against demo/index.html. A
// hand-made mockup drifts from the product silently; this cannot, because it
// is the product. Rebuild after any change to the popup, the heuristics or
// the demo page.
//
// Chrome writes the PNG and then declines to exit in old-headless mode, so
// each capture is killed on a timer once the file lands. That is expected,
// not a failure.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm, cp, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const WORK = join(ROOT, '.store-build');
const OUT = join(ROOT, 'store', 'screenshots');
const PORT = Number(process.env.STORE_PORT ?? 8731);
const CHROME = process.env.CHROME_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SHOTS = [
  ['stage1.html', '01-hero.png', 1280, 800],
  ['stage2.html', '02-cookies.png', 1280, 800],
  ['stage3.html', '03-newsletter.png', 1280, 800],
  ['stage4.html', '04-pause.png', 1280, 800],
  ['tile.html', 'promo-tile-440x280.png', 440, 280],
];

// The content script expects exactly one API. Everything else it does is real.
const STUB = `
<script>
chrome = { storage: { sync: { get: async (s) => Object.assign({}, s, { pausedSites: [] }) } } };
</script>
<script src="/ext/content.js"></script>
`;

// popup.js reaches for three chrome calls before it will render. Query params
// drive the two states the screenshots need: default, and paused on a host.
const POPUP_STUB = `<script>
(function () {
  const p = new URLSearchParams(location.search);
  const paused = p.get('paused') === '1';
  const host = p.get('host') || 'example.com';
  chrome = {
    storage: {
      sync: { get: async (shape) => Object.assign({}, shape, { pausedSites: paused ? [host] : [] }), set: async () => {} },
      local: { get: async (shape) => shape },
    },
    tabs: { query: async () => [{ url: 'https://' + host + '/' }] },
  };
})();
</script>
`;

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
                '.json': 'application/json', '.png': 'image/png' };

async function stage() {
  await rmQuiet(WORK);
  await mkdir(WORK, { recursive: true });
  await cp(join(ROOT, 'dist'), join(WORK, 'ext'), { recursive: true });
  await cp(join(ROOT, 'demo'), join(WORK, 'demo'), { recursive: true });
  await cp(join(ROOT, 'store', 'stages'), WORK, { recursive: true });

  // The popup harness must live beside the real popup so that popup.css and
  // ../icons/* resolve exactly as they do inside the extension.
  const popup = await readFile(join(WORK, 'ext/popup/popup.html'), 'utf8');
  const marker = '<script type="module" src="popup.js"></script>';
  if (!popup.includes(marker)) throw new Error('popup.html no longer loads popup.js as expected');
  await writeText(join(WORK, 'ext/popup/harness.html'), popup.replace(marker, POPUP_STUB + marker));

  const demo = await readFile(join(WORK, 'demo/index.html'), 'utf8');
  await writeText(join(WORK, 'demo/after.html'), demo + STUB);
}

const writeText = (path, text) => writeFile(path, text, 'utf8');

// A killed Chrome keeps flushing its profile directory for a moment, so a
// prompt rmdir loses the race with ENOTEMPTY.
async function rmQuiet(path, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try { return await rm(path, { recursive: true, force: true }); }
    catch { await new Promise((r) => setTimeout(r, 250)); }
  }
}

// The store rejects a screenshot that is not exactly 1280x800 or 640x400, and
// it rejects it at submit time — after the listing is filled in. Cheaper to
// read the IHDR here. Width and height are big-endian uint32 at bytes 16 and
// 20 of every PNG.
async function pngSize(path) {
  const head = await readFile(path);
  return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) };
}

function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    try {
      const body = await readFile(join(WORK, path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

function capture(url, dest, w, h) {
  return new Promise((resolve) => {
    const child = spawn(CHROME, [
      '--headless=old', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      `--window-size=${w},${h}`, `--screenshot=${dest}`,
      '--virtual-time-budget=6000', `--user-data-dir=${join(WORK, 'profile-' + w + 'x' + h)}`,
      url,
    ], { stdio: 'ignore' });
    const done = () => { child.kill(); resolve(); };
    child.on('exit', () => resolve());
    setTimeout(done, 20_000);
  });
}

const server = await stage().then(serve);
await mkdir(OUT, { recursive: true });

let failed = 0;
for (const [page, name, w, h] of SHOTS) {
  const dest = join(OUT, name);
  await rm(dest, { force: true });
  await capture(`http://localhost:${PORT}/${page}`, dest, w, h);
  const wrote = await stat(dest).then((s) => s.size > 0).catch(() => false);
  if (!wrote) { console.error(`FAIL  ${name} — no file written`); failed++; continue; }
  const got = await pngSize(dest);
  if (got.w !== w || got.h !== h) {
    console.error(`FAIL  ${name} — got ${got.w}x${got.h}, need ${w}x${h}`);
    failed++; continue;
  }
  console.log(`ok    ${name}  ${got.w}x${got.h}`);
}

server.close();
await rmQuiet(WORK);
if (failed) process.exit(1);
console.log(`\n${SHOTS.length - failed} assets in store/screenshots/`);

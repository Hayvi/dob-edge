import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'https://sportsbook.forzza1x2.com/';
const outPath = process.argv[3] || path.resolve(process.cwd(), `forzza-ws-capture-${Date.now()}.jsonl`);
const maxPayloadChars = Number(process.env.FORZZA_CAPTURE_MAX_PAYLOAD_CHARS || 200000);

function nowIso() {
  return new Date().toISOString();
}

function clip(s, n = 2000) {
  const str = typeof s === 'string' ? s : JSON.stringify(s);
  if (str.length <= n) return str;
  return str.slice(0, n) + `...<truncated ${str.length - n} chars>`;
}

async function main() {
  // Lazy import so script can exist even before install.
  const { chromium } = await import('playwright');

  const out = fs.createWriteStream(outPath, { flags: 'a' });
  const write = (obj) => out.write(JSON.stringify(obj) + '\n');

  write({ ts: nowIso(), type: 'start', url });

  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  const wsSeen = new Map();

  page.on('websocket', (ws) => {
    const wsUrl = ws.url();
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    wsSeen.set(id, { url: wsUrl, openedAt: Date.now() });

    write({ ts: nowIso(), type: 'ws_open', id, wsUrl });

    ws.on('framesent', (frame) => {
      write({ ts: nowIso(), type: 'ws_send', id, wsUrl, payload: clip(frame.payload, maxPayloadChars) });
    });

    ws.on('framereceived', (frame) => {
      write({ ts: nowIso(), type: 'ws_recv', id, wsUrl, payload: clip(frame.payload, maxPayloadChars) });
    });

    ws.on('close', () => {
      write({ ts: nowIso(), type: 'ws_close', id, wsUrl });
    });
  });

  page.on('response', async (resp) => {
    const rurl = resp.url();
    const ct = resp.headers()['content-type'] || '';
    if (ct.includes('application/json') && /api|socket|ws/i.test(rurl)) {
      write({ ts: nowIso(), type: 'http_json', url: rurl, status: resp.status() });
    }
  });

  const startMs = Date.now();
  write({ ts: nowIso(), type: 'goto', url });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  write({ ts: nowIso(), type: 'domcontentloaded', msSinceStart: Date.now() - startMs });

  // Give the app some time to initialize and open sockets.
  await page.waitForTimeout(15000);

  // Best-effort attempt: click something that looks like a sport name.
  // This is intentionally defensive; if selectors don't match, it just skips.
  const candidates = ['Football', 'Soccer', 'Live', 'Prematch'];
  for (const text of candidates) {
    try {
      const loc = page.getByText(text, { exact: false });
      const count = await loc.count();
      if (count > 0) {
        write({ ts: nowIso(), type: 'ui_click_attempt', text });
        await loc.first().click({ timeout: 2000 }).catch(() => null);
        await page.waitForTimeout(5000);
        break;
      }
    } catch {
      // ignore
    }
  }

  try {
    const eventLinks = page.locator('a[href*="event-view"]');
    const linkCount = await eventLinks.count();
    if (linkCount > 0) {
      write({ ts: nowIso(), type: 'ui_click_attempt', text: 'event-view link' });
      await eventLinks.first().click({ timeout: 5000 }).catch(() => null);
      await page.waitForTimeout(15000);

      const tabCandidates = ['All', 'Match', 'Totals', 'Handicaps', 'Halves', '1st Half', '2nd Half'];
      for (const text of tabCandidates) {
        try {
          const loc = page.getByText(text, { exact: false });
          const count = await loc.count();
          if (count > 0) {
            write({ ts: nowIso(), type: 'ui_click_attempt', text: `tab:${text}` });
            await loc.first().click({ timeout: 2000 }).catch(() => null);
            await page.waitForTimeout(2000);
          }
        } catch {
          // ignore
        }
      }

      for (let i = 0; i < 8; i++) {
        try {
          write({ ts: nowIso(), type: 'ui_scroll', step: i });
          await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.9)));
          await page.waitForTimeout(1500);
        } catch {
          // ignore
        }
      }

      for (let i = 0; i < 5; i++) {
        try {
          const oddsBtn = page.getByRole('button', { name: /\b\d+\.\d+\b/ }).first();
          if (await oddsBtn.count()) {
            write({ ts: nowIso(), type: 'ui_click_attempt', text: 'odds_button' });
            await oddsBtn.click({ timeout: 2000 }).catch(() => null);
            await page.waitForTimeout(1500);
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  await page.waitForTimeout(10000);

  write({ ts: nowIso(), type: 'done', wsCount: wsSeen.size, outPath });

  await context.close();
  await browser.close();
  out.end();

  // Print where to find the capture.
  console.log(`WS capture written to: ${outPath}`);
}

main().catch((e) => {
  console.error('forzzaWsCapture failed:', e);
  process.exit(1);
});

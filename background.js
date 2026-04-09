import { mergeOrders } from './lib/schema.js';
import { parseCapture } from './lib/parsers.js';

const STORAGE_KEY = 'orders_v1';
const META_KEY = 'meta_v1';

/** Paths to try as same-origin JSON from the Swiggy tab (MAIN world + cookies). */
const SWIGGY_FETCH_PATHS = [
  '/mapi/order/all',
  '/mapi/order/all?limit=100',
  '/dapi/order/all',
  '/api/order/all',
  '/api/orders',
  '/api/v1/orders',
  '/api/v2/orders',
  '/gateway/order/all',
  '/mapi/consumer/order/all',
  '/mapi/consumer/orders',
  '/dapi/consumer/order/all',
];

async function loadOrders() {
  const { [STORAGE_KEY]: raw } = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(raw) ? raw : [];
}

async function saveOrders(orders) {
  const meta = {
    lastCaptureAt: new Date().toISOString(),
    orderCount: orders.length,
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: orders, [META_KEY]: meta });
}

async function mergeParsedOrders(parsed) {
  if (!parsed.length) {
    const cur = await loadOrders();
    return { total: cur.length, added: 0 };
  }
  const existing = await loadOrders();
  const before = existing.length;
  const merged = mergeOrders(existing, parsed);
  await saveOrders(merged);
  return { total: merged.length, added: merged.length - before };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'RAW_CAPTURE') {
    (async () => {
      const parsed = parseCapture(msg.platform, msg.url, msg.data);
      const r = await mergeParsedOrders(parsed);
      sendResponse({ ok: true, added: r.added, total: r.total });
    })();
    return true;
  }

  if (msg?.type === 'GET_ORDERS') {
    loadOrders().then((orders) => sendResponse({ orders }));
    return true;
  }

  if (msg?.type === 'CLEAR_DATA') {
    chrome.storage.local.remove([STORAGE_KEY, META_KEY]).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg?.type === 'IMPORT_ORDERS') {
    (async () => {
      const incoming = Array.isArray(msg.orders) ? msg.orders : [];
      const existing = await loadOrders();
      const merged = mergeOrders(existing, incoming);
      await saveOrders(merged);
      sendResponse({ ok: true, total: merged.length });
    })();
    return true;
  }

  if (msg?.type === 'SWIGGY_PAGE_FETCH') {
    (async () => {
      const tabId = msg.tabId;
      if (tabId == null) {
        sendResponse({ ok: false, error: 'no_tab' });
        return;
      }
      try {
        const [injected] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          args: [SWIGGY_FETCH_PATHS],
          func: async (paths) => {
            const origin = location.origin;
            const out = [];
            for (const p of paths) {
              const url = p.startsWith('http') ? p : origin + p;
              try {
                const r = await fetch(url, {
                  credentials: 'include',
                  headers: { Accept: 'application/json, text/plain, */*' },
                });
                const txt = await r.text();
                if (!r.ok) continue;
                let data = null;
                try {
                  data = JSON.parse(txt);
                } catch {
                  continue;
                }
                if (data && typeof data === 'object') out.push({ url, data });
              } catch {
                /* ignore */
              }
            }
            return out;
          },
        });
        const countBefore = (await loadOrders()).length;
        const payloads = injected?.result || [];
        let combined = [];
        for (const { url, data } of payloads) {
          combined = combined.concat(parseCapture('swiggy', url, data));
        }
        await mergeParsedOrders(combined);
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            files: ['injected/swiggy-autoscroll-main.js'],
          });
          const [domRun] = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () =>
              typeof window.__foodScrapeSwiggyDomOrders === 'function' ? window.__foodScrapeSwiggyDomOrders() : [],
          });
          const domOrders = domRun?.result || [];
          if (Array.isArray(domOrders) && domOrders.length) await mergeParsedOrders(domOrders);
        } catch {
          /* DOM scrape optional */
        }
        const countAfter = (await loadOrders()).length;
        sendResponse({
          ok: true,
          endpointsHit: payloads.length,
          parsedCandidates: combined.length,
          newOrders: countAfter - countBefore,
          totalInStorage: countAfter,
        });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }

  if (msg?.type === 'SWIGGY_AUTO_SCROLL') {
    (async () => {
      const tabId = msg.tabId;
      if (tabId == null) {
        sendResponse({ ok: false, error: 'no_tab' });
        return;
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          files: ['injected/swiggy-autoscroll-main.js'],
        });
        const [run] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: () => {
            const fn = window.__foodSwiggyAutoScroll;
            return typeof fn === 'function' ? fn() : Promise.resolve({ ok: false, clicks: 0, error: 'no_fn' });
          },
        });
        const result = run?.result || { ok: false, clicks: 0 };
        let scrapedAdded = 0;
        let totalInStorage = (await loadOrders()).length;
        const scraped = Array.isArray(result.scraped) ? result.scraped : [];
        if (scraped.length) {
          const r = await mergeParsedOrders(scraped);
          scrapedAdded = r.added;
          totalInStorage = r.total;
        }
        sendResponse({
          ok: true,
          result: {
            clicks: result.clicks ?? 0,
            uniqueScraped: result.uniqueScraped ?? scraped.length,
            scrapedAdded,
            totalInStorage,
          },
        });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }

  return false;
});

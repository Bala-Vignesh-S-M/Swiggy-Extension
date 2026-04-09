/**
 * MAIN world: real clicks for React + DOM scraping (backup when API hooks miss pagination).
 * Scrapes after each "show more" and merges by id so virtualized lists still accumulate orders.
 */
(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function norm(t) {
    return String(t || '')
      .replace(/\s+/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
  }

  function visible(el) {
    if (!(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return false;
    return r.width > 2 && r.height > 2 && r.bottom > -20 && r.top < window.innerHeight + 800;
  }

  function queryDeepAll(selector, root) {
    const out = [];
    function walk(node) {
      if (!node) return;
      try {
        node.querySelectorAll(selector).forEach((el) => out.push(el));
        node.querySelectorAll('*').forEach((el) => {
          if (el.shadowRoot) walk(el.shadowRoot);
        });
      } catch (_) {}
    }
    walk(root || document);
    return out;
  }

  function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
    return 'd' + (h >>> 0).toString(16);
  }

  /** Parse visible Swiggy order cards from DOM (Total Paid + Delivered on). */
  function scrapeOrderCardsOnce() {
    const matches = [];
    for (const el of queryDeepAll('div, article, section', document)) {
      const t = el.innerText || '';
      if (!/Total\s+Paid/i.test(t) || !/Delivered\s+on/i.test(t)) continue;
      if (t.length < 45 || t.length > 9000) continue;
      matches.push(el);
    }

    const innermost = matches.filter((el) => !matches.some((o) => o !== el && el.contains(o)));

    const orders = [];
    for (const el of innermost) {
      const t = el.innerText || '';
      const totalM = t.match(/Total\s+Paid:\s*[₹Rs.,\s]*(\d+)/i) || t.match(/Total\s+Paid\s*[₹]?\s*(\d+)/i);
      if (!totalM) continue;
      const total = parseInt(totalM[1], 10);
      if (!Number.isFinite(total) || total < 1) continue;

      const orderNumM = t.match(/#\s*(\d{8,})/);
      const dateM =
        t.match(/Delivered\s+on\s+([^\n]+)/i) ||
        t.match(/Placed\s+on\s*,?\s*([^\n]+)/i) ||
        t.match(/(\w{3},\s*\w+\s+\d{1,2},\s*\d{4}[^\n]*)/);

      let orderedAt = new Date().toISOString();
      if (dateM) {
        const parsed = Date.parse(dateM[1].replace(/\s+/g, ' ').trim());
        if (!Number.isNaN(parsed)) orderedAt = new Date(parsed).toISOString();
      }

      const lines = t
        .split('\n')
        .map((l) => norm(l))
        .filter(Boolean);

      let restaurant = 'Unknown';
      for (const line of lines.slice(0, 12)) {
        if (line.length < 3 || line.length > 72) continue;
        if (/delivered|total paid|reorder|help|view details|show more|orders?$/i.test(line)) continue;
        if (/^#?\d{10,}$/.test(line.replace(/\s/g, ''))) continue;
        if (/^₹?\s*\d+$/.test(line)) continue;
        if (/^[x×]\s*\d+$/i.test(line)) continue;
        restaurant = line;
        break;
      }

      const items = [];
      for (const line of lines) {
        const im = line.match(/^(.+?)\s*[x×]\s*(\d+)\s*$/i);
        if (im && line.length < 140 && !/total|paid|delivered|reorder/i.test(line)) {
          items.push({ name: im[1].trim().slice(0, 120), qty: parseInt(im[2], 10) || 1 });
        }
      }

      const sig = [orderNumM && orderNumM[1], restaurant, String(total), orderedAt, items.map((i) => i.name).join('|')]
        .filter(Boolean)
        .join('::');
      const id = orderNumM ? `swiggy:${orderNumM[1]}` : 'swiggy:dom:' + hashStr(sig);

      orders.push({
        id,
        platform: 'swiggy',
        restaurant,
        total,
        orderedAt,
        items,
      });
    }
    return orders;
  }

  function firePointerClick(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + Math.min(r.width / 2, 80);
    const y = r.top + Math.min(r.height / 2, 24);
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x + window.screenX,
      screenY: y + window.screenY,
    };
    try {
      el.dispatchEvent(
        new PointerEvent('pointerdown', {
          ...base,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          buttons: 1,
        })
      );
      el.dispatchEvent(new MouseEvent('mousedown', { ...base, button: 0, buttons: 1 }));
      el.dispatchEvent(
        new PointerEvent('pointerup', {
          ...base,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          buttons: 0,
        })
      );
      el.dispatchEvent(new MouseEvent('mouseup', { ...base, button: 0, buttons: 0 }));
      el.dispatchEvent(new MouseEvent('click', { ...base, button: 0, buttons: 0, detail: 1 }));
    } catch (_) {}
    try {
      el.click();
    } catch (_) {}
  }

  function clickWithAncestors(el) {
    let n = el;
    for (let i = 0; i < 6 && n; i++) {
      firePointerClick(n);
      n = n.parentElement;
    }
  }

  const reExact = /^show\s+more\s+orders$/i;
  const reLoose = /show\s+more\s+orders|load\s+more\s+orders|^show\s+more$/i;

  function scoreShowMore(el) {
    if (!visible(el)) return 0;
    const t = norm(el.innerText);
    const aria = norm(el.getAttribute('aria-label') || '');
    if (t.length > 56 || t.length < 6) {
      if (!reLoose.test(aria)) return 0;
    }
    if (reExact.test(t) || reExact.test(aria)) return 100;
    if (reLoose.test(t) && t.length <= 40) return 80;
    if (reLoose.test(aria)) return 70;
    return 0;
  }

  function pickBestTarget() {
    const sel = 'button, a, [role="button"], div, span, p, strong, li, h2, h3';
    const els = queryDeepAll(sel, document);
    const candidates = [];
    for (const el of els) {
      const s = scoreShowMore(el);
      if (s >= 70) candidates.push({ el, s });
    }
    if (!candidates.length) return null;
    const maxS = Math.max(...candidates.map((c) => c.s));
    const top = candidates.filter((c) => c.s === maxS);
    return top[top.length - 1].el;
  }

  function mergeInto(map, list) {
    for (const o of list) map.set(o.id, o);
  }

  window.__foodScrapeSwiggyDomOrders = function () {
    return scrapeOrderCardsOnce();
  };

  window.__foodSwiggyAutoScroll = async function () {
    let clicks = 0;
    let lastHeight = 0;
    let stableRounds = 0;
    const byId = new Map();

    mergeInto(byId, scrapeOrderCardsOnce());

    for (let i = 0; i < 120; i++) {
      mergeInto(byId, scrapeOrderCardsOnce());

      const target = pickBestTarget();
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'auto' });
        await sleep(280);
        clickWithAncestors(target);
        clicks++;
        await sleep(2600);
        mergeInto(byId, scrapeOrderCardsOnce());
      }

      window.scrollTo(0, document.documentElement.scrollHeight);
      try {
        document.documentElement.scrollTop = document.documentElement.scrollHeight;
        document.body.scrollTop = document.body.scrollHeight;
      } catch (_) {}

      await sleep(500);

      const h = document.documentElement.scrollHeight;
      if (Math.abs(h - lastHeight) < 12) stableRounds++;
      else stableRounds = 0;
      lastHeight = h;

      if (!target && stableRounds >= 12) break;
    }

    await sleep(3200);
    mergeInto(byId, scrapeOrderCardsOnce());

    const scraped = Array.from(byId.values());
    return { ok: true, clicks, scraped, uniqueScraped: scraped.length };
  };
})();

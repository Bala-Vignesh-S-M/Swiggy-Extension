import { computeAnalytics } from '../lib/analytics.js';

const chartDefaults = {
  color: '#a1a1aa',
  grid: 'rgba(255,255,255,0.06)',
};

const SWIGGY_URL_PATTERNS = [
  'https://*.swiggy.com/*',
  'https://www.swiggy.com/*',
  'https://swiggy.com/*',
];

function destroyChart(ch) {
  if (ch) ch.destroy();
}

function rupee(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

let charts = {};
/** @type {ReturnType<typeof computeAnalytics> | null} */
let lastAnalytics = null;

function onlySwiggyOrders(orders) {
  return (orders || []).filter((o) => o && o.platform !== 'zomato');
}

async function getOrders() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_ORDERS' }, (res) => {
      resolve(res?.orders || []);
    });
  });
}

async function pickSwiggyTab() {
  const raw = await chrome.tabs.query({ url: SWIGGY_URL_PATTERNS });
  const seen = new Set();
  const tabs = raw.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs.find((t) => t.id === active?.id) || tabs[0] || null;
}

function getActivePanelTab() {
  const t = document.querySelector('.tab.active');
  return t?.dataset?.tab || 'overview';
}

function destroyAllCharts() {
  Object.values(charts).forEach(destroyChart);
  charts = {};
}

const commonOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: chartDefaults.color } } },
  scales: {},
};

function buildOverviewCharts(a) {
  const xLabels = a.monthChartLabels?.length ? a.monthChartLabels : a.monthLabels;

  const months = document.getElementById('chartMonths');
  if (months && a.monthLabels.length) {
    charts.months = new Chart(months, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: [
          {
            label: 'Spend (₹)',
            data: a.monthValues,
            borderColor: '#f97316',
            backgroundColor: 'rgba(249,115,22,0.15)',
            fill: true,
            tension: 0.35,
          },
        ],
      },
      options: {
        ...commonOpts,
        scales: {
          x: { ticks: { color: chartDefaults.color, maxRotation: 45 }, grid: { color: chartDefaults.grid } },
          y: { ticks: { color: chartDefaults.color }, grid: { color: chartDefaults.grid } },
        },
      },
    });
  }

  const wd = document.getElementById('chartWeekday');
  if (wd) {
    charts.wd = new Chart(wd, {
      type: 'bar',
      data: {
        labels: a.weekdayLabels,
        datasets: [
          {
            label: 'Orders',
            data: a.weekdayValues,
            backgroundColor: 'rgba(34,211,238,0.55)',
            borderRadius: 6,
          },
        ],
      },
      options: {
        ...commonOpts,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: chartDefaults.color }, grid: { display: false } },
          y: { ticks: { color: chartDefaults.color }, grid: { color: chartDefaults.grid } },
        },
      },
    });
  }

  const cu = document.getElementById('chartCuisine');
  if (cu && a.cuisineLabels.length) {
    charts.cu = new Chart(cu, {
      type: 'doughnut',
      data: {
        labels: a.cuisineLabels,
        datasets: [
          {
            data: a.cuisineValues,
            backgroundColor: [
              '#f97316',
              '#22d3ee',
              '#a78bfa',
              '#34d399',
              '#fb7185',
              '#fbbf24',
              '#94a3b8',
              '#38bdf8',
            ],
          },
        ],
      },
      options: {
        ...commonOpts,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } },
      },
    });
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      Object.values(charts).forEach((c) => c && c.resize());
    });
  });
}

function renderMonthTable(a) {
  const tbody = document.getElementById('monthTableBody');
  const empty = document.getElementById('monthEmptyHint');
  const table = document.getElementById('monthTable');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!a.monthSpendRows?.length) {
    if (table) table.hidden = true;
    if (empty) empty.hidden = a.orderCount === 0;
    return;
  }
  if (table) table.hidden = false;
  if (empty) empty.hidden = true;
  for (const row of a.monthSpendRows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(row.label)}</td><td class="num">${rupee(row.amount)}</td>`;
    tbody.appendChild(tr);
  }
}

function renderRankedList(elId, entries, valueFn) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = '';
  for (const [name, val] of entries) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="rank-name">${escapeHtml(name)}</span><span class="rank-val">${valueFn(val)}</span>`;
    el.appendChild(li);
  }
}

function renderLists(a) {
  renderRankedList('listRestSpend', a.topRestaurantsBySpend, (v) => rupee(v));
  renderRankedList('listRestFreq', a.topRestaurantsByFreq, (v) => `${v} orders`);
  renderRankedList('listDishes', a.topDishes, (v) => `${v}×`);
}

function updateEmptyHints(a) {
  const set = (id, show) => {
    const n = document.getElementById(id);
    if (n) n.hidden = !show;
  };
  set('restEmptyHint', a.orderCount > 0 && a.topRestaurantsBySpend.length === 0);
  set('dishEmptyHint', a.orderCount > 0 && a.topDishes.length === 0);
}

function setTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tab;
      document.querySelectorAll('.tab').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      document.querySelectorAll('.panel').forEach((p) => {
        const on = p.id === `panel-${id}`;
        p.classList.toggle('active', on);
        p.hidden = !on;
      });
      if (id === 'overview') {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            Object.values(charts).forEach((c) => c && c.resize());
          });
        });
      }
    });
  });
}

function renderInsights(lines) {
  const ul = document.getElementById('insightList');
  ul.innerHTML = '';
  for (const line of lines) {
    const li = document.createElement('li');
    li.className = line.mood === 'fun' ? 'mood-fun' : '';
    li.innerHTML = `<h3>${escapeHtml(line.title)}</h3><p>${escapeHtml(line.body)}</p>`;
    ul.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function demoOrders() {
  const now = new Date();
  const mk = (i, rest, total, dish, daysAgo) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    return {
      platform: 'swiggy',
      restaurant: rest,
      total,
      orderedAt: d.toISOString(),
      items: [{ name: dish, qty: 1 + (i % 2), price: total * 0.4 }],
    };
  };
  return [
    mk(0, 'Nagarjuna Andhra Style', 420, 'Chicken biryani', 2),
    mk(1, 'Leon’s Burgers', 310, 'Classic cheese burger', 35),
    mk(2, 'MTR 1924', 180, 'Masala dosa', 5),
    mk(3, 'Nagarjuna Andhra Style', 390, 'Mutton biryani', 9),
    mk(4, 'Chinese Wok', 560, 'Hakka noodles', 62),
    mk(5, 'Third Wave Coffee', 240, 'Cold brew', 14),
    mk(6, 'MTR 1924', 165, 'Rava idli', 22),
    mk(7, 'Behrouz Biryani', 520, 'Shahi biryani', 28),
    mk(8, 'Chinese Wok', 480, 'Dim sum platter', 95),
    mk(9, 'Third Wave Coffee', 260, 'Avocado toast', 120),
  ];
}

async function refresh() {
  const raw = await getOrders();
  const orders = onlySwiggyOrders(raw);
  lastAnalytics = computeAnalytics(orders);
  const a = lastAnalytics;

  document.getElementById('totalSpend').textContent = orders.length ? rupee(a.totalSpend) : '—';
  document.getElementById('orderCount').textContent = orders.length ? String(a.orderCount) : '—';
  document.getElementById('aov').textContent = orders.length ? rupee(a.aov) : '—';

  document.getElementById('hint').style.display = raw.length ? 'none' : 'block';

  const meta = await chrome.storage.local.get('meta_v1');
  const cap = meta.meta_v1?.lastCaptureAt;
  document.getElementById('metaLine').textContent = cap
    ? `Last merge: ${new Date(cap).toLocaleString()} · Local only`
    : 'Data stays on this device';

  updateEmptyHints(a);
  renderMonthTable(a);
  renderLists(a);
  renderInsights(a.insights);

  destroyAllCharts();
  buildOverviewCharts(a);
  if (getActivePanelTab() === 'overview') {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        Object.values(charts).forEach((c) => c && c.resize());
      });
    });
  }
}

async function runPageFetch() {
  const status = document.getElementById('syncStatus');
  status.textContent = '';
  const tab = await pickSwiggyTab();
  if (!tab?.id) {
    status.textContent = 'Open Swiggy in a Chrome tab (logged in), then try again.';
    return;
  }
  status.textContent = 'Fetching…';
  chrome.runtime.sendMessage({ type: 'SWIGGY_PAGE_FETCH', tabId: tab.id }, (res) => {
    if (chrome.runtime.lastError) {
      status.textContent = chrome.runtime.lastError.message;
      return;
    }
    if (!res?.ok) {
      status.textContent = res?.error || 'Could not run fetch. Reload the Swiggy tab and retry.';
      return;
    }
    status.textContent = `JSON from ${res.endpointsHit} path(s), +${res.newOrders} new orders (${res.totalInStorage} stored).`;
    refresh();
  });
}

async function runAutoScroll() {
  const status = document.getElementById('syncStatus');
  status.textContent = '';
  const tab = await pickSwiggyTab();
  if (!tab?.id) {
    status.textContent = 'Open Swiggy in a tab first.';
    return;
  }
  status.textContent =
    'Running in the Swiggy tab (MAIN page) — keep that tab visible. May take up to ~1 min.';
  chrome.runtime.sendMessage({ type: 'SWIGGY_AUTO_SCROLL', tabId: tab.id }, (res) => {
    if (chrome.runtime.lastError) {
      status.textContent = chrome.runtime.lastError.message;
      return;
    }
    if (!res?.ok) {
      status.textContent = res?.error || 'Failed. Reload Swiggy (Ctrl+Shift+R) and try again.';
      return;
    }
    const { clicks: c, uniqueScraped, scrapedAdded, totalInStorage } = res.result || {};
    const clicksN = c ?? 0;
    const scrapedN = uniqueScraped ?? 0;
    const addedN = scrapedAdded ?? 0;
    if (clicksN > 0 || scrapedN > 0) {
      status.textContent = `${clicksN} show-more click(s), ${scrapedN} order card(s) read from page, +${addedN} new in storage (${totalInStorage ?? '—'} total). Refreshing…`;
      setTimeout(() => refresh(), 1200);
    } else {
      status.textContent =
        'No show-more clicks and no order cards found. Open the orders list, retry, or use Fetch from page.';
    }
  });
}

function wireToolbar() {
  document.getElementById('btnFetchPage')?.addEventListener('click', () => runPageFetch());
  document.getElementById('btnAutoScroll')?.addEventListener('click', () => runAutoScroll());
  document.getElementById('btnRefresh')?.addEventListener('click', () => refresh());
}

function wireImport() {
  const status = document.getElementById('importStatus');
  document.getElementById('btnImport').addEventListener('click', () => {
    status.textContent = '';
    let parsed;
    try {
      parsed = JSON.parse(document.getElementById('importJson').value || '[]');
    } catch {
      status.textContent = 'Invalid JSON.';
      return;
    }
    if (!Array.isArray(parsed)) {
      status.textContent = 'JSON must be an array of orders.';
      return;
    }
    chrome.runtime.sendMessage({ type: 'IMPORT_ORDERS', orders: parsed }, (res) => {
      status.textContent = res?.ok ? `Merged. ${res.total} orders in storage.` : 'Import failed.';
      refresh();
    });
  });

  document.getElementById('btnSample').addEventListener('click', () => {
    document.getElementById('importJson').value = JSON.stringify(demoOrders(), null, 2);
    status.textContent = 'Demo JSON loaded — click Merge import.';
  });

  document.getElementById('btnClear').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_DATA' }, () => {
      status.textContent = 'Cleared.';
      refresh();
    });
  });
}

setTabs();
wireToolbar();
wireImport();
refresh();

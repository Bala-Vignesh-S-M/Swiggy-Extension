const NIGHT_START = 22;
const NIGHT_END = 5;

function dishKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9\u0900-\u097F\s]/gi, '')
    .trim()
    .slice(0, 80);
}

function cuisineGuess(restaurant) {
  const r = String(restaurant).toLowerCase();
  const rules = [
    ['pizza', 'Italian'],
    ['burger', 'American'],
    ['biryani', 'Biryani / Mughlai'],
    ['kebab', 'Mughlai'],
    ['dosa', 'South Indian'],
    ['idli', 'South Indian'],
    ['south', 'South Indian'],
    ['north indian', 'North Indian'],
    ['thali', 'Indian'],
    ['chinese', 'Chinese'],
    ['momos', 'Chinese'],
    ['sushi', 'Japanese'],
    ['cafe', 'Cafe'],
    ['coffee', 'Cafe'],
    ['ice cream', 'Dessert'],
    ['sweet', 'Dessert'],
    ['bakery', 'Bakery'],
    ['healthy', 'Healthy'],
    ['salad', 'Healthy'],
  ];
  for (const [kw, label] of rules) {
    if (r.includes(kw)) return label;
  }
  return 'Mixed / other';
}

/** Swiggy sometimes sends unix seconds; storage may use ISO strings. */
export function parseOrderDate(orderedAt) {
  if (orderedAt == null) return null;
  if (typeof orderedAt === 'number') {
    const ms = orderedAt < 1e12 ? orderedAt * 1000 : orderedAt;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(orderedAt);
  if (!Number.isNaN(d.getTime())) return d;
  const n = Number(orderedAt);
  if (!Number.isNaN(n)) {
    const ms = n < 1e12 ? n * 1000 : n;
    const d2 = new Date(ms);
    return Number.isNaN(d2.getTime()) ? null : d2;
  }
  return null;
}

function ymKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function formatMonthLabel(key) {
  if (key === 'unknown') return 'Date unavailable';
  const [y, m] = String(key).split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return String(key);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString('en-IN', { month: 'short', year: 'numeric' });
}

/**
 * @param {import('./schema.js').NormalizedOrder[]} orders
 */
export function computeAnalytics(orders) {
  const list = (orders || []).filter((o) => o && o.total >= 0 && !Number.isNaN(Number(o.total)));
  const totalSpend = list.reduce((s, o) => s + o.total, 0);
  const count = list.length;
  const aov = count ? totalSpend / count : 0;

  const byMonth = new Map();
  const restaurantSpend = new Map();
  const restaurantCount = new Map();
  const dishCount = new Map();
  const dishSpend = new Map();
  const cuisineCount = new Map();
  const weekdayCount = Array(7).fill(0);
  let nightOrders = 0;
  let maxOrder = null;
  let minOrder = null;

  for (const o of list) {
    const d = parseOrderDate(o.orderedAt);
    if (d) {
      const ym = ymKey(d);
      byMonth.set(ym, (byMonth.get(ym) || 0) + o.total);
      const wd = d.getDay();
      if (wd >= 0 && wd <= 6) weekdayCount[wd] += 1;
      const h = d.getHours();
      if (h >= NIGHT_START || h < NIGHT_END) nightOrders += 1;
    } else {
      byMonth.set('unknown', (byMonth.get('unknown') || 0) + o.total);
    }

    const r = o.restaurant || 'Unknown';
    restaurantSpend.set(r, (restaurantSpend.get(r) || 0) + o.total);
    restaurantCount.set(r, (restaurantCount.get(r) || 0) + 1);

    const cuisine = cuisineGuess(r);
    cuisineCount.set(cuisine, (cuisineCount.get(cuisine) || 0) + 1);

    if (!maxOrder || o.total > maxOrder.total) maxOrder = o;
    if (!minOrder || (o.total > 0 && o.total < minOrder.total)) minOrder = o;

    for (const it of o.items || []) {
      const key = dishKey(it.name);
      if (!key) continue;
      const q = it.qty || 1;
      dishCount.set(key, (dishCount.get(key) || 0) + q);
      const line = (it.price != null ? it.price : o.total / Math.max(o.items.length, 1)) * q;
      dishSpend.set(key, (dishSpend.get(key) || 0) + line);
    }
  }

  const topRestaurantsBySpend = [...restaurantSpend.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const topRestaurantsByFreq = [...restaurantCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const topDishes = [...dishCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);

  const monthKeys = [...byMonth.keys()].filter((k) => byMonth.get(k) > 0).sort();
  const unknownIdx = monthKeys.indexOf('unknown');
  if (unknownIdx > -1) {
    monthKeys.splice(unknownIdx, 1);
    monthKeys.push('unknown');
  }
  const monthLabels = monthKeys;
  const monthValues = monthKeys.map((k) => byMonth.get(k));
  const monthSpendRows = monthKeys.map((k) => ({
    key: k,
    label: formatMonthLabel(k),
    amount: byMonth.get(k),
  }));
  const monthChartLabels = monthKeys.map((k) => formatMonthLabel(k));

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const insights = buildInsights({
    list,
    totalSpend,
    count,
    aov,
    nightOrders,
    maxOrder,
    minOrder,
    topRestaurantsBySpend,
    topDishes,
    weekdayCount,
  });

  return {
    totalSpend,
    orderCount: count,
    aov,
    monthLabels,
    monthChartLabels,
    monthValues,
    monthSpendRows,
    topRestaurantsBySpend,
    topRestaurantsByFreq,
    topDishes,
    cuisineLabels: [...cuisineCount.keys()],
    cuisineValues: [...cuisineCount.keys()].map((k) => cuisineCount.get(k)),
    weekdayLabels: dayNames,
    weekdayValues: weekdayCount,
    nightOrderShare: count ? nightOrders / count : 0,
    maxOrder,
    minOrder,
    insights,
    lastUpdated: new Date().toISOString(),
  };
}

function buildInsights(ctx) {
  const { list, totalSpend, count, aov, nightOrders, maxOrder, topRestaurantsBySpend, topDishes, weekdayCount } = ctx;
  const lines = [];

  if (!count) {
    lines.push({
      title: 'No Swiggy orders yet',
      body: 'Open swiggy.com orders, use Fetch from page or Auto-scroll, then Refresh.',
      mood: 'neutral',
    });
    return lines;
  }

  const fav = topRestaurantsBySpend[0];
  if (fav) {
    const pct = ((fav[1] / totalSpend) * 100).toFixed(0);
    lines.push({
      title: 'Restaurant you fund the most',
      body: `${fav[0]} — about ${pct}% of your tracked spend (₹${fav[1].toFixed(0)}).`,
      mood: 'fun',
    });
  }

  const dish = topDishes[0];
  if (dish) {
    lines.push({
      title: 'Your repeat craving',
      body: `"${dish[0]}" shows up most often in line items (${dish[1]}×).`,
      mood: 'fun',
    });
  }

  const nightPct = count ? Math.round((nightOrders / count) * 100) : 0;
  if (nightPct >= 25) {
    lines.push({
      title: 'Night owl fuel',
      body: `${nightPct}% of orders are between 10pm–5am — snacks or shift meals?`,
      mood: 'fun',
    });
  }

  let bestD = 0;
  let bestC = 0;
  for (let i = 0; i < 7; i++) {
    if (weekdayCount[i] > bestC) {
      bestC = weekdayCount[i];
      bestD = i;
    }
  }
  if (bestC > 0) {
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    lines.push({
      title: 'Busiest order day',
      body: `${names[bestD]} sees the most orders (${bestC}).`,
      mood: 'neutral',
    });
  }

  if (maxOrder) {
    lines.push({
      title: 'Splurge order',
      body: `Largest tracked bill: ₹${maxOrder.total.toFixed(0)} at ${maxOrder.restaurant}.`,
      mood: 'neutral',
    });
  }

  if (aov > 0) {
    lines.push({
      title: 'Average order value',
      body: `About ₹${aov.toFixed(0)} per order — useful for monthly food budgeting.`,
      mood: 'neutral',
    });
  }

  const dated = list.filter((o) => parseOrderDate(o.orderedAt));
  if (dated.length >= 2) {
    const sorted = [...dated].sort((a, b) => parseOrderDate(a.orderedAt) - parseOrderDate(b.orderedAt));
    const gapDays =
      (parseOrderDate(sorted[sorted.length - 1].orderedAt) - parseOrderDate(sorted[0].orderedAt)) /
      (86400000 * Math.max(count - 1, 1));
    lines.push({
      title: 'Ordering rhythm',
      body: `Across dated orders, you average roughly one order every ${gapDays.toFixed(1)} days.`,
      mood: 'neutral',
    });
  }

  return lines.slice(0, 8);
}

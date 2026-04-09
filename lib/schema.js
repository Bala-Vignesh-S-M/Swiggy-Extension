/** @typedef {{ id: string, platform: 'swiggy'|'zomato', restaurant: string, items: { name: string, qty?: number, price?: number }[], total: number, currency: string, orderedAt: string }} NormalizedOrder */

export function makeOrderId(platform, rawId) {
  return `${platform}:${String(rawId)}`;
}

/** @param {Partial<NormalizedOrder>} o */
export function normalizeOrder(o) {
  if (!o || !o.platform) return null;
  const id = o.id || makeOrderId(o.platform, `${o.restaurant}-${o.orderedAt}-${o.total}`);
  const restaurant = String(o.restaurant || 'Unknown').trim() || 'Unknown';
  const items = Array.isArray(o.items) ? o.items : [];
  const total = Number(o.total) || 0;
  const orderedAt = o.orderedAt ? new Date(o.orderedAt).toISOString() : new Date().toISOString();
  return {
    id,
    platform: o.platform,
    restaurant,
    items: items.map((it) => ({
      name: String(it.name || '').trim() || 'Item',
      qty: it.qty != null ? Number(it.qty) : 1,
      price: it.price != null ? Number(it.price) : undefined,
    })),
    total,
    currency: o.currency || 'INR',
    orderedAt,
  };
}

export function mergeOrders(existing, incoming) {
  const map = new Map();
  for (const o of existing || []) map.set(o.id, o);
  for (const o of incoming || []) {
    const n = normalizeOrder(o);
    if (n) map.set(n.id, n);
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.orderedAt) - new Date(a.orderedAt)
  );
}

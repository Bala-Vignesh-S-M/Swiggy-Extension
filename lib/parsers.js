import { normalizeOrder, makeOrderId } from './schema.js';

function walk(obj, visitor, seen = new Set()) {
  if (obj == null || typeof obj !== 'object') return;
  if (seen.has(obj)) return;
  seen.add(obj);
  if (Array.isArray(obj)) {
    for (const x of obj) walk(x, visitor, seen);
    return;
  }
  visitor(obj);
  for (const k of Object.keys(obj)) walk(obj[k], visitor, seen);
}

/** Heuristic: find order-like objects inside arbitrary JSON */
export function parseSwiggyLikeJson(data) {
  /** @type {import('./schema.js').NormalizedOrder[]} */
  const out = [];
  const seenIds = new Set();

  walk(data, (node) => {
    if (!node || typeof node !== 'object') return;
    const orderId =
      node.order_id ||
      node.orderId ||
      node.order_id_str ||
      node.order_job_id ||
      node.orderJobId ||
      node.customer_order_id ||
      node.customerOrderId ||
      node.id;
    const rest =
      node.restaurant_name ||
      node.restaurantName ||
      node.restaurant?.name ||
      node.restaurant?.restaurant_name ||
      node.restaurant?.restaurantName ||
      node.meta_info?.restaurant_name ||
      node.metaInfo?.restaurantName ||
      node.vendor_name ||
      node.vendorName ||
      node.outlet_name ||
      node.outletName ||
      node.brand_name ||
      node.brandName ||
      node.res_name ||
      node.resName;
    const total =
      node.order_total ||
      node.orderTotal ||
      node.bill_total ||
      node.billTotal ||
      node.total_amount ||
      node.totalAmount ||
      node.total ||
      node.order_total_amount ||
      node.orderTotalAmount ||
      node.final_amount ||
      node.finalAmount ||
      node.payable_amount ||
      node.payableAmount ||
      node.grand_total ||
      node.grandTotal ||
      node.amount_paid ||
      node.amountPaid ||
      node.order_amount ||
      node.orderAmount ||
      node.meta_info?.order_total ||
      node.metaInfo?.orderTotal;
    const time =
      node.order_time ||
      node.orderTime ||
      node.order_date ||
      node.orderDate ||
      node.created_at ||
      node.createdAt ||
      node.order_created_time ||
      node.orderCreatedTime ||
      node.delivered_time ||
      node.deliveredTime ||
      node.order_delivered_time ||
      node.orderDeliveredTime;

    if (!rest || total == null) return;
    const rawId = orderId != null ? String(orderId) : `${rest}-${total}-${time}`;
    const id = makeOrderId('swiggy', rawId);
    if (seenIds.has(id)) return;
    seenIds.add(id);

    let items = [];
    const cart =
      node.order_items ||
      node.orderItems ||
      node.items ||
      node.cart_items ||
      node.cartItems ||
      node.order_line_items ||
      node.orderLineItems;
    if (Array.isArray(cart)) {
      items = cart.map((it) => ({
        name:
          it.name ||
          it.title ||
          it.item_name ||
          it.itemName ||
          it.dish_name ||
          it.dishName ||
          it.display_name ||
          it.displayName ||
          it.variation_name ||
          it.variationName ||
          'Item',
        qty: it.quantity || it.qty || it.count || 1,
        price: it.final_price || it.finalPrice || it.price || it.item_price || it.itemPrice,
      }));
    }

    if (items.length === 0) {
      const guess =
        node.order_title ||
        node.orderTitle ||
        node.order_name ||
        node.orderName ||
        node.primary_item_name ||
        node.primaryItemName ||
        node.order_item_name ||
        node.orderItemName ||
        node.meal_name ||
        node.mealName ||
        node.description;
      if (guess) items = [{ name: String(guess).slice(0, 120), qty: 1 }];
    }

    const orderedAt = time
      ? new Date(typeof time === 'number' && time < 1e12 ? time * 1000 : time).toISOString()
      : new Date().toISOString();

    const n = normalizeOrder({
      id,
      platform: 'swiggy',
      restaurant: String(rest),
      items,
      total: Number(total),
      currency: 'INR',
      orderedAt,
    });
    if (n) out.push(n);
  });

  return out;
}

export function parseCapture(_platform, _url, data) {
  return parseSwiggyLikeJson(data);
}

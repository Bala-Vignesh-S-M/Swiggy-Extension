const EVENT = 'food-analytics-sw';

function inject() {
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('injected/swiggy-hook.js');
  s.onload = () => s.remove();
  (document.documentElement || document.head).appendChild(s);
}

inject();

let bound = false;
function bind() {
  if (bound) return;
  const el = document.documentElement;
  if (!el) return;
  bound = true;
  el.addEventListener(EVENT, (e) => {
    const detail = e.detail;
    if (!detail || !detail.data) return;
    chrome.runtime.sendMessage({
      type: 'RAW_CAPTURE',
      platform: 'swiggy',
      url: detail.url,
      data: detail.data,
    });
  });
}

if (document.documentElement) bind();
else {
  const tryBind = () => bind();
  document.addEventListener('readystatechange', tryBind);
  document.addEventListener('DOMContentLoaded', tryBind, { once: true });
}

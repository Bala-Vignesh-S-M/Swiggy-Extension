/**
 * Fallback: Swiggy often embeds state in __NEXT_DATA__ or loads after hydration.
 * Runs in isolated world — can read the same DOM as the page.
 */
function sendPayload(data, label) {
  if (!data || typeof data !== 'object') return;
  chrome.runtime.sendMessage({
    type: 'RAW_CAPTURE',
    platform: 'swiggy',
    url: label,
    data,
  });
}

function scrapeNextData() {
  const el = document.getElementById('__NEXT_DATA__');
  if (!el || !el.textContent) return;
  try {
    sendPayload(JSON.parse(el.textContent), 'dom:__NEXT_DATA__');
  } catch (_) {}
}

function scrapeJsonScripts() {
  for (const s of document.querySelectorAll('script[type="application/json"][id]')) {
    try {
      const t = s.textContent && s.textContent.trim();
      if (!t || (!t.startsWith('{') && !t.startsWith('['))) continue;
      sendPayload(JSON.parse(t), `dom:script#${s.id || 'json'}`);
    } catch (_) {}
  }
}

function runScrape() {
  scrapeNextData();
  scrapeJsonScripts();
}

runScrape();

let ticks = 0;
const timer = setInterval(() => {
  runScrape();
  if (++ticks >= 20) clearInterval(timer);
}, 1500);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') runScrape();
});

(function () {
  const EVENT = 'food-analytics-sw';

  function resolveUrl(raw) {
    if (raw == null) return '';
    const s = String(raw);
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    try {
      return new URL(s, location.href).href;
    } catch {
      return s;
    }
  }

  function shouldCapture(rawUrl) {
    const resolved = resolveUrl(rawUrl);
    const u = resolved.toLowerCase();
    let path = '';
    try {
      path = new URL(resolved).pathname.toLowerCase();
    } catch {
      path = u.startsWith('/') ? u : '';
    }

    const onSwiggySite = /swiggy\.com|swiggy\.in/i.test(location.hostname);
    const hostHasSwiggy = /swiggy\.com|swiggy\.in/i.test(u);
    const sameOriginRelative =
      onSwiggySite && (String(rawUrl).startsWith('/') || (!/^https?:/i.test(String(rawUrl)) && !String(rawUrl).includes('://')));

    if (!hostHasSwiggy && !sameOriginRelative) return false;

    const hay = u + ' ' + path;
    const interesting =
      /dapi|mapi|\/api\/|graphql|\/order|orders|history|account|my.?orders|consumer|cart\/|checkout|cursor|offset|pagination|page|next|older|past|widget|listing|feed/i.test(
        hay
      );
    const blocked =
      /login|oauth|\/static|assets\/|\.css|\.woff|\.woff2|\.png|\.jpg|\.jpeg|\.gif|\.svg|\.ico|google-analytics|googletagmanager|doubleclick|facebook\.net|hotjar|sentry|newrelic|clarity|segment\.io|fonts\.google/i.test(
        hay
      );
    return interesting && !blocked;
  }

  async function safeJson(res) {
    try {
      const clone = res.clone();
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('json')) return await clone.json();
      const text = (await clone.text()).trim();
      if (text.startsWith('{') || text.startsWith('[')) return JSON.parse(text);
    } catch (_) {}
    return null;
  }

  const emit = (url, data) => {
    const fire = () => {
      try {
        const el = document.documentElement || document.body;
        if (el) el.dispatchEvent(new CustomEvent(EVENT, { detail: { url, data }, bubbles: true }));
      } catch (_) {}
    };
    if (document.documentElement || document.body) fire();
    else requestAnimationFrame(fire);
  };

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    const req = args[0];
    const url = typeof req === 'string' ? req : req && req.url;
    if (!shouldCapture(url)) return p;
    return p.then((res) => {
      if (res && res.ok)
        safeJson(res).then((data) => {
          if (data && typeof data === 'object') emit(url, data);
        });
      return res;
    });
  };

  const OrigXHR = window.XMLHttpRequest;
  function WrappedXHR() {
    const xhr = new OrigXHR();
    let _url = '';
    const open = xhr.open;
    xhr.open = function (method, url, ...rest) {
      _url = String(url || '');
      return open.call(this, method, url, ...rest);
    };
    xhr.addEventListener('load', function () {
      if (!shouldCapture(_url) || xhr.status < 200 || xhr.status >= 300) return;
      try {
        const ct = (xhr.getResponseHeader('content-type') || '').toLowerCase();
        const text = xhr.responseText;
        if (!text || !text.trim()) return;
        let data = null;
        if (ct.includes('json')) data = JSON.parse(text);
        else if (text.trim().startsWith('{') || text.trim().startsWith('[')) data = JSON.parse(text);
        if (data && typeof data === 'object') emit(_url, data);
      } catch (_) {}
    });
    return xhr;
  }
  WrappedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = WrappedXHR;
})();

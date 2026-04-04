self.onmessage = function (event) {
  const { type, records } = event.data || {};
  if (type !== 'build-index') return;
  const start = Date.now();
  const termSet = new Set();
  (records || []).forEach((r) => {
    const blob = `${r.title || ''} ${r.res || ''} ${r.eu || ''} ${r.case || ''} ${r.cat || ''}`.toLowerCase();
    blob.replace(/[^a-z0-9+#\s]/g, ' ').split(/\s+/).filter(Boolean).forEach((t) => termSet.add(t));
  });
  self.postMessage({ type: 'index-ready', vocab: Array.from(termSet), elapsedMs: Date.now() - start });
};

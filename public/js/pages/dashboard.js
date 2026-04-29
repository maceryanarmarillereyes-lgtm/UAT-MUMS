(window.Pages = window.Pages || {}, window.Pages.dashboard = function (root) {
  if (!root) return;
  root.innerHTML = '';

  const prevCleanup = root._cleanup;
  root._cleanup = () => {
    try { if (prevCleanup) prevCleanup(); } catch (_) { }
  };
});

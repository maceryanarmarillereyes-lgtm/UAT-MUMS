export function createVisibilityAwarePoller(task, intervalMs = 30000) {
  const pollMs = Math.max(30000, Number(intervalMs) || 30000);
  let timer = null;
  let inFlight = null;

  const run = async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (inFlight) inFlight.abort();
    const controller = new AbortController();
    inFlight = controller;
    try {
      await task({ signal: controller.signal });
    } catch (_) {
      // noop by design; caller decides retry/reporting
    }
  };

  const tick = () => {
    run();
    timer = setTimeout(tick, pollMs);
  };

  const onVisibility = () => {
    if (typeof document === 'undefined') return;
    if (!document.hidden) run();
  };

  return {
    start() {
      if (timer) return;
      tick();
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibility);
      }
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (inFlight) inFlight.abort();
      inFlight = null;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    }
  };
}

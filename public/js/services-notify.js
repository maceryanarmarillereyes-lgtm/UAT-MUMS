/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

(function () {
  function ensureContainer() {
    var c = document.getElementById('notify-container');
    if (c) return c;
    c = document.createElement('div');
    c.id = 'notify-container';
    c.className = 'notify-container';
    document.body.appendChild(c);
    return c;
  }

  var Notify = {
    show: function (type, title, message, duration) {
      duration = duration || 4000;
      var id = 'n' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      var icons = { success: '✓', error: '✕', info: 'ℹ', loading: '⟳', warning: '⚠' };
      var toast = document.createElement('div');
      toast.className = 'notify-toast notify-' + type;
      toast.id = id;
      toast.innerHTML =
        '<div class="notify-icon">' + (icons[type] || 'ℹ') + '</div>' +
        '<div class="notify-content">' +
          '<div class="notify-title">' + String(title || '') + '</div>' +
          '<div class="notify-message">' + String(message || '') + '</div>' +
        '</div>' +
        '<div class="notify-progress"></div>';

      ensureContainer().appendChild(toast);
      setTimeout(function () { toast.classList.add('show'); }, 10);
      if (type !== 'loading') setTimeout(function () { Notify.hide(id); }, duration);
      return id;
    },

    hide: function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.classList.add('hide');
      setTimeout(function () {
        var node = document.getElementById(id);
        if (node) node.remove();
      }, 300);
    },

    update: function (id, message) {
      var el = document.getElementById(id);
      if (!el) return;
      var msg = el.querySelector('.notify-message');
      if (msg) msg.textContent = message;
    }
  };

  window.Notify = Notify;
})();

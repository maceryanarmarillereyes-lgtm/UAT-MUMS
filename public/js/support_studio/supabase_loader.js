(function(){
  var sources = [
    '/functions/vendor/supabase.js',
    '/api/vendor/supabase.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.0/dist/umd/supabase.min.js'
  ];
  function loadAt(i) {
    if (i >= sources.length) return;
    var s = document.createElement('script');
    s.src = sources[i];
    s.onload = function() {
      try { window.__MUMS_SUPABASE_SRC = sources[i]; } catch(_) {}
      try { window.dispatchEvent(new CustomEvent('mums:supabase_ready')); } catch(_) {}
    };
    s.onerror = function() { loadAt(i + 1); };
    document.head.appendChild(s);
  }
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    try { window.dispatchEvent(new CustomEvent('mums:supabase_ready')); } catch(_) {}
  } else {
    loadAt(0);
  }
})();

  // Support Studio — expose loaded QB records globally so row-click fallbacks and YCT can resolve data.
  // FIX v1.1: Intercepts /api/studio/qb_monitoring AND /api/studio/qb_data.
  // my_quickbase.js main report load is redirected to qb_monitoring (not qb_data),
  // so the old patch missed all main-report fetches — __studioQbRecords was always empty.
  (function() {
    var _origFetch = window.fetch;
    if (typeof _origFetch !== 'function') return;
    window.fetch = function(resource, init) {
      var result = _origFetch.apply(this, arguments);
      var url = (resource && typeof resource === 'object' && resource.url)
        ? resource.url : String(resource || '');
      var isQbData       = url.indexOf('/api/studio/qb_data') !== -1;
      var isQbMonitoring = url.indexOf('/api/studio/qb_monitoring') !== -1
                        || url.indexOf('/api/quickbase/monitoring') !== -1;
      if (isQbData || isQbMonitoring) {
        result.then(function(r) {
          return r.clone().json().then(function(data) {
            var records = null;
            var columns = null;
            if (data && data.ok && Array.isArray(data.records) && data.records.length > 0) {
              records = data.records;
              columns = Array.isArray(data.columns) ? data.columns : [];
            }
            if (records) {
              // Plain assignment — avoid defineProperty conflicts downstream
              window.__studioQbRecords = records;
              window.__studioQbColumns = columns;
              // Fire callback if YCT registered one
              if (typeof window.__studioQbRecordsLoaded === 'function') {
                try { window.__studioQbRecordsLoaded(records, columns); } catch(_) {}
              }
            }
          }).catch(function() {});
        }).catch(function() {});
      }
      return result;
    };
  })();

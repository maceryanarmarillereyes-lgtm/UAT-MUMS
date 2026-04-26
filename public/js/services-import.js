/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

(function () {
  // ─────────────────────────────────────────────────────────────────────────────
  // services-import.js  — v1
  //
  // Two responsibilities:
  //   A) window.svcToast  — app-wide toast notification system
  //   B) Import pipeline  — XLSX / CSV → column mapping → bulk upsert
  //
  // Depends on (already loaded):
  //   window.XLSX          (SheetJS CDN, loaded in services.html <head>)
  //   window.servicesDB    (services-supabase.js)
  //   window.servicesGrid  (services-grid.js) — for getState() / saveAllRows()
  //
  // Does NOT touch: auth, realtime channels, RLS, any existing module logic.
  // ─────────────────────────────────────────────────────────────────────────────

  /* ═══════════════════════════════════════════════════════════════════════════
     A.  TOAST NOTIFICATION SYSTEM
         window.Notify && window.Notify.show(type, title, message, duration?)
         window.svcToast.pulse()   ← called by auto-save (subtle, no text)
  ═══════════════════════════════════════════════════════════════════════════ */
  var toastContainer = document.getElementById('svcToastContainer');
  var syncChip       = document.getElementById('svcSyncIndicator');
  var _pulseTimer    = null;

  window.svcToast = {
    // type: 'success' | 'error' | 'warning' | 'info'
    show: function (type, title, message, duration) {
      if (!toastContainer) return;
      duration = duration || 4000;

      var toast = document.createElement('div');
      toast.className = 'svc-toast svc-toast-' + type;

      var icon = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' }[type] || 'ℹ';
      toast.innerHTML =
        '<span class="svc-toast-icon">' + icon + '</span>' +
        '<div class="svc-toast-body">' +
          '<strong class="svc-toast-title">' + _esc(title) + '</strong>' +
          '<span class="svc-toast-msg">' + _esc(message) + '</span>' +
        '</div>' +
        '<button class="svc-toast-close" title="Dismiss">✕</button>';

      toast.querySelector('.svc-toast-close').addEventListener('click', function () {
        _dismissToast(toast);
      });

      toastContainer.appendChild(toast);
      // Force reflow then add visible class for CSS transition
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { toast.classList.add('svc-toast-visible'); });
      });

      setTimeout(function () { _dismissToast(toast); }, duration);
    },

    // Subtle sync-chip pulse for auto-saves (no popup toast)
    pulse: function () {
      if (!syncChip) return;
      clearTimeout(_pulseTimer);
      syncChip.classList.add('svc-sync-pulse');
      _pulseTimer = setTimeout(function () {
        syncChip.classList.remove('svc-sync-pulse');
      }, 1200);
    }
  };

  function _dismissToast(toast) {
    toast.classList.remove('svc-toast-visible');
    toast.classList.add('svc-toast-exit');
    setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 320);
  }

  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     B.  IMPORT PIPELINE
  ═══════════════════════════════════════════════════════════════════════════ */

  var uploadBtn      = document.getElementById('svcUploadBtn');
  var modal          = document.getElementById('svcImportModal');
  var closeBtn       = document.getElementById('svcImportClose');
  var dropZone       = document.getElementById('svcImportDrop');
  var fileInput      = document.getElementById('svcImportFile');
  var previewPanel   = document.getElementById('svcImportPreview');
  var fileInfoEl     = document.getElementById('svcImportFileInfo');
  var mappingEl      = document.getElementById('svcImportMapping');
  var tableWrapEl    = document.getElementById('svcImportTableWrap');
  var previewCountEl = document.getElementById('svcImportPreviewCount');
  var confirmBtn     = document.getElementById('svcImportConfirm');
  var resetBtn       = document.getElementById('svcImportReset');
  var progressWrap   = document.getElementById('svcImportProgress');
  var progressBar    = document.getElementById('svcImportProgressBar');
  var progressLabel  = document.getElementById('svcImportProgressLabel');

  var _parsedRows    = [];   // raw array of objects from file
  var _fileHeaders   = [];   // ordered headers from file
  var _colMapping    = {};   // { fileHeader: colKey | null }

  // ── Open / close modal ───────────────────────────────────────────────────────
  function openModal() {
    var state = window.servicesGrid && window.servicesGrid.getState();
    if (!state) {
      window.Notify && window.Notify.show('warning', 'No Sheet Open', 'Select a sheet first, then import.');
      return;
    }
    _resetModal();
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
    _resetModal();
  }

  function _resetModal() {
    dropZone.hidden    = false;
    previewPanel.hidden = true;
    if (progressWrap) progressWrap.hidden = true;
    if (fileInput) fileInput.value = '';
    _parsedRows   = [];
    _fileHeaders  = [];
    _colMapping   = {};
  }

  if (uploadBtn) uploadBtn.addEventListener('click', openModal);
  if (closeBtn)  closeBtn.addEventListener('click', closeModal);

  // Close on backdrop click
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });
    // ESC key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) closeModal();
    });
  }

  if (resetBtn) resetBtn.addEventListener('click', function () {
    dropZone.hidden     = false;
    previewPanel.hidden = true;
    if (fileInput) fileInput.value = '';
  });

  // ── Drag-and-drop ────────────────────────────────────────────────────────────
  if (dropZone) {
    dropZone.addEventListener('dragover',  function (e) { e.preventDefault(); dropZone.classList.add('svc-drop-over'); });
    dropZone.addEventListener('dragleave', function ()  { dropZone.classList.remove('svc-drop-over'); });
    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.classList.remove('svc-drop-over');
      var file = e.dataTransfer && e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', function () {
      if (fileInput.files[0]) handleFile(fileInput.files[0]);
    });
  }

  // ── File dispatcher ──────────────────────────────────────────────────────────
  function handleFile(file) {
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
      parseXLSX(file);
    } else if (ext === 'csv') {
      parseCSV(file);
    } else {
      window.Notify && window.Notify.show('error', 'Unsupported File', 'Please upload a .xlsx, .xls, or .csv file.');
    }
  }

  // ── XLSX parser (via SheetJS) ────────────────────────────────────────────────
  function parseXLSX(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var wb  = window.XLSX.read(e.target.result, { type: 'binary', cellDates: true });
        var ws  = wb.Sheets[wb.SheetNames[0]];
        var raw = window.XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (!raw.length) { window.Notify && window.Notify.show('warning', 'Empty File', 'The file has no data rows.'); return; }
        _fileHeaders = Object.keys(raw[0]);
        _parsedRows  = raw;
        showPreview(file.name, file.size);
      } catch (err) {
        window.Notify && window.Notify.show('error', 'Parse Error', 'Could not read XLSX: ' + err.message);
      }
    };
    reader.onerror = function () { window.Notify && window.Notify.show('error', 'Read Error', 'Failed to read the file.'); };
    reader.readAsBinaryString(file);
  }

  // ── CSV parser (no dependency) ───────────────────────────────────────────────
  function parseCSV(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var lines = e.target.result.split(/\r?\n/).filter(function (l) { return l.trim(); });
        if (lines.length < 2) { window.Notify && window.Notify.show('warning', 'Empty File', 'CSV needs at least a header and one data row.'); return; }
        var headers = splitCSVLine(lines[0]);
        var rows = [];
        for (var i = 1; i < lines.length; i++) {
          var vals = splitCSVLine(lines[i]);
          var obj  = {};
          headers.forEach(function (h, hi) { obj[h] = (vals[hi] != null ? vals[hi] : '').trim(); });
          if (Object.values(obj).some(function (v) { return v !== ''; })) rows.push(obj);
        }
        if (!rows.length) { window.Notify && window.Notify.show('warning', 'Empty File', 'CSV has headers but no data rows.'); return; }
        _fileHeaders = headers;
        _parsedRows  = rows;
        showPreview(file.name, file.size);
      } catch (err) {
        window.Notify && window.Notify.show('error', 'Parse Error', 'Could not read CSV: ' + err.message);
      }
    };
    reader.onerror = function () { window.Notify && window.Notify.show('error', 'Read Error', 'Failed to read the file.'); };
    reader.readAsText(file);
  }

  function splitCSVLine(line) {
    var result = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        result.push(cur.trim()); cur = '';
      } else {
        cur += ch;
      }
    }
    result.push(cur.trim());
    return result;
  }

  // ── Auto-map headers to column_defs ─────────────────────────────────────────
  // Normalise: lowercase, strip non-alphanumeric, match against col labels
  function autoMap(fileHeaders, columnDefs) {
    var map = {};
    function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
    fileHeaders.forEach(function (fh) {
      var fn = norm(fh);
      var match = columnDefs.find(function (cd) { return norm(cd.label) === fn; });
      map[fh] = match ? match.key : null;
    });
    return map;
  }

  // ── Preview ──────────────────────────────────────────────────────────────────
  function showPreview(filename, filesize) {
    var state = window.servicesGrid.getState();
    if (!state) { window.Notify && window.Notify.show('warning', 'No Sheet', 'Open a sheet first.'); return; }

    var colDefs = state.sheet.column_defs || [];
    _colMapping = autoMap(_fileHeaders, colDefs);

    // File info bar
    fileInfoEl.innerHTML =
      '<span class="svc-import-fname">📄 ' + _esc(filename) + '</span>' +
      '<span class="svc-import-fsize">' + (filesize / 1024).toFixed(1) + ' KB &nbsp;·&nbsp; ' + _parsedRows.length + ' rows</span>';

    // Mapping chips
    var mappedCount = Object.values(_colMapping).filter(Boolean).length;
    var mappingHtml = '<div class="svc-mapping-chips">';
    _fileHeaders.forEach(function (fh) {
      var targetKey   = _colMapping[fh];
      var targetLabel = targetKey
        ? (colDefs.find(function (c) { return c.key === targetKey; }) || {}).label || targetKey
        : null;
      var cls = targetLabel ? 'svc-chip-mapped' : 'svc-chip-skip';
      var txt = targetLabel
        ? ('&ldquo;' + _esc(fh) + '&rdquo; → ' + _esc(targetLabel))
        : ('&ldquo;' + _esc(fh) + '&rdquo; <em>(skip)</em>');
      mappingHtml += '<span class="svc-mapping-chip ' + cls + '">' + txt + '</span>';
    });
    mappingHtml += '</div>';
    if (mappedCount === 0) {
      mappingHtml += '<p class="svc-mapping-warn">⚠ No headers matched sheet columns. Rename your file headers to match column labels, or add matching columns first.</p>';
    }
    mappingEl.innerHTML = mappingHtml;

    // Preview table (first 5 rows)
    var previewRows = _parsedRows.slice(0, 5);
    previewCountEl.textContent = '(first ' + previewRows.length + ' of ' + _parsedRows.length + ')';
    var tHtml = '<table class="svc-import-table"><thead><tr>';
    _fileHeaders.forEach(function (h) {
      var mapped = _colMapping[h] ? ' (mapped)' : ' (skip)';
      var cls    = _colMapping[h] ? 'col-mapped' : 'col-skip';
      tHtml += '<th class="' + cls + '">' + _esc(h) + '<small>' + mapped + '</small></th>';
    });
    tHtml += '</tr></thead><tbody>';
    previewRows.forEach(function (row) {
      tHtml += '<tr>';
      _fileHeaders.forEach(function (h) {
        tHtml += '<td>' + _esc(String(row[h] != null ? row[h] : '')) + '</td>';
      });
      tHtml += '</tr>';
    });
    tHtml += '</tbody></table>';
    tableWrapEl.innerHTML = tHtml;

    dropZone.hidden     = true;
    previewPanel.hidden = false;
    if (progressWrap) progressWrap.hidden = true;
  }

  // ── Confirm import ───────────────────────────────────────────────────────────
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async function () {
      var state = window.servicesGrid && window.servicesGrid.getState();
      if (!state) { window.Notify && window.Notify.show('warning', 'No Sheet', 'Open a sheet first.'); return; }

      var mapped = Object.values(_colMapping).filter(Boolean);
      if (!mapped.length) {
        window.Notify && window.Notify.show('error', 'Nothing Mapped', 'No file columns matched sheet columns. Cannot import.');
        return;
      }

      // Determine start index based on mode
      var modeEl = document.querySelector('input[name="importMode"]:checked');
      var mode   = modeEl ? modeEl.value : 'append';

      var startIdx;
      if (mode === 'overwrite') {
        startIdx = 0;
      } else {
        // Append: start after the last existing row
        var existingRows = state.rows || [];
        var maxIdx = existingRows.reduce(function (m, r) { return Math.max(m, r.row_index); }, -1);
        startIdx = maxIdx + 1;
      }

      // Build rows payload
      var payload = [];
      _parsedRows.forEach(function (fileRow, i) {
        var data = {};
        _fileHeaders.forEach(function (fh) {
          var key = _colMapping[fh];
          if (key) data[key] = String(fileRow[fh] != null ? fileRow[fh] : '');
        });
        // Skip fully-empty mapped rows
        if (Object.values(data).some(function (v) { return v !== ''; })) {
          payload.push({ row_index: startIdx + i, data: data });
        }
      });

      if (!payload.length) {
        window.Notify && window.Notify.show('warning', 'No Data', 'All rows were empty after mapping.');
        return;
      }

      // Show progress bar
      confirmBtn.disabled = true;
      if (resetBtn) resetBtn.disabled = true;
      if (progressWrap) { progressWrap.hidden = false; progressBar.style.width = '0%'; progressLabel.textContent = 'Importing…'; }

      try {
        // Animate progress bar while awaiting
        var fakeProgress = 0;
        var fakeTimer = setInterval(function () {
          fakeProgress = Math.min(fakeProgress + 8, 80);
          if (progressBar) progressBar.style.width = fakeProgress + '%';
        }, 120);

        var result = await window.servicesDB.bulkUpsertRows(state.sheet.id, payload);
        clearInterval(fakeTimer);

        if (result && result.error) throw new Error(result.error.message || 'DB write error');

        if (progressBar)   progressBar.style.width = '100%';
        if (progressLabel) progressLabel.textContent = 'Done!';

        // Reload the grid to reflect imported data
        await window.servicesGrid.load(state.sheet);

        setTimeout(function () {
          closeModal();
          window.Notify && window.Notify.show(
            'success',
            '✓ Import Complete',
            payload.length + ' row' + (payload.length !== 1 ? 's' : '') + ' imported & saved to Supabase.',
            5000
          );
        }, 400);

      } catch (err) {
        if (progressWrap) progressWrap.hidden = true;
        window.Notify && window.Notify.show('error', 'Import Failed', err.message || 'Check your connection.');
        console.error('[services-import] bulkUpsertRows failed:', err);
      } finally {
        confirmBtn.disabled = false;
        if (resetBtn) resetBtn.disabled = false;
      }
    });
  }

  window.servicesImport = { openModal: openModal };
})();

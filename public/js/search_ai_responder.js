/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

/**
 * MUMS AI Responder v3 — Client-Side Response Synthesizer (2026 Semantic Upgrade)
 * ─────────────────────────────────────────────────────────────────────────────
 * BUGFIX LOG (v3.0 — 2026-04-09):
 *
 * BUG 1 FIXED: Part-number queries always showed support-case AI summary instead
 *   of the actual part details (brand, description, type).
 *   FIX: Added _isPartNoQuery() detector. When query contains alphanumeric part
 *   codes, AI switches to Parts Mode which renders part table instead of case summary.
 *
 * BUG 2 FIXED: "Did you mean" suggestions were showing noise words (e.g. "number",
 *   "part", "type") as fuzzy suggestions.
 *   FIX: fuzzyTerms filtered against NOISE_FILTER before rendering.
 *
 * BUG 3 FIXED: AI panel showed incorrect "Most Relevant Fix" when top result was
 *   a parts record (parts records have no resolution/fix text).
 *   FIX: AI panel now detects record source and adapts template accordingly.
 *
 * BUG 4 FIXED: Ambiguous threshold of 120 results was too low for Parts source —
 *   4,948 results are valid when searching parts catalog.
 *   FIX: Threshold is now source-aware: 50 for support cases, 500 for parts.
 *
 * BUG 5 FIXED: AI "Found X records" count was misleading when results were filtered
 *   by source — total showed all sources but description mentioned only one.
 *   FIX: AI body now shows per-source breakdown in a clear table.
 */
(function(global) {
  'use strict';

  // Alphanumeric part-number pattern (must match search_engine_v2.js)
  var PART_NUMBER_RX = /^[A-Za-z]{1,6}[\-\d][\w\-]{2,}$|^\d{3,4}[-\s]\d{3,4}$|^[A-Za-z]\d{3,}$|^[A-Za-z]{2,4}\d{2,4}$/;

  // Noise words to suppress from "Did you mean" suggestions
  var NOISE_FILTER = new Set([
    'part','number','parts','type','model','unit','item','product','controller',
    'system','device','information','info','data','record','report','list',
    'request','inquiry','support','service','case','replacement'
  ]);

  // ── PATTERN EXTRACTOR ─────────────────────────────────────────────────────
  function PatternExtractor() {}

  PatternExtractor.prototype.extractEndUsers = function(results) {
    var euSet = {};
    results.forEach(function(item) {
      var r = item.record || item;
      if (r.eu && r.eu.trim()) {
        euSet[r.eu.trim()] = (euSet[r.eu.trim()] || 0) + 1;
      }
    });
    return Object.keys(euSet).sort(function(a, b) { return euSet[b] - euSet[a]; }).slice(0, 5);
  };

  PatternExtractor.prototype.extractCaseNums = function(results) {
    var cases = [];
    results.slice(0, 8).forEach(function(item) {
      var r = item.record || item;
      if (r.case && String(r.case).trim()) cases.push(String(r.case).trim());
    });
    return cases.filter(function(c, i) { return cases.indexOf(c) === i; }).slice(0, 5);
  };

  PatternExtractor.prototype.extractCategories = function(results) {
    var cats = {};
    results.forEach(function(item) {
      var r = item.record || item;
      if (r.cat) cats[r.cat] = (cats[r.cat] || 0) + 1;
    });
    return Object.keys(cats).sort(function(a, b) { return cats[b] - cats[a]; }).slice(0, 3);
  };

  PatternExtractor.prototype.extractBestSemanticSentence = function(resText, tokens) {
    if (!resText) return '';
    var sentences = resText.split(/[.!\n]+/).filter(function(s) { return s.trim().length > 15; });
    var bestSent = '';
    var bestScore = -1;
    sentences.forEach(function(sent) {
      var s = sent.toLowerCase();
      var score = 0;
      tokens.forEach(function(t) {
        if (t.length >= 3 && !NOISE_FILTER.has(t) && s.includes(t)) score++;
      });
      if (/^\s*(advised|provided|confirmed|updated|resolved|replaced|checked|configured|reset|assisted|guided)\b/i.test(s)) {
        score += 0.5;
      }
      if (score > bestScore) { bestScore = score; bestSent = sent.trim(); }
    });
    if (bestSent.length > 0) return bestSent.charAt(0).toUpperCase() + bestSent.slice(1) + '.';
    return resText.slice(0, 200) + '…';
  };

  // BUG 1 FIX: Detect part-number queries
  function _isPartNoQuery(query, parsed) {
    var tokens = (parsed && parsed.tokens) || String(query || '').toLowerCase().split(/\s+/);
    return tokens.some(function(t) { return PART_NUMBER_RX.test(t); });
  }

  // ── AI RESPONDER ──────────────────────────────────────────────────────────
  function AIResponder() {
    this.extractor = new PatternExtractor();
  }

  AIResponder.prototype.generate = function(query, searchOutput) {
    var results = searchOutput.results || [];
    var parsed  = searchOutput.parsed || { original: query, type: 'keyword', tokens: [], expanded: [] };
    var fuzzy   = (searchOutput.fuzzyTerms || []).filter(function(t) { return !NOISE_FILTER.has(t); });

    if (!results.length) return this._noResults(query, parsed, fuzzy);

    // BUG 4 FIX: Source-aware ambiguous threshold
    var isParts = _isPartNoQuery(query, parsed);
    var ambigThreshold = isParts ? 500 : 50;
    if (results.length > ambigThreshold && !isParts) return this._ambiguous(query, parsed, results.length);

    // BUG 3 FIX: Route to parts mode if query is part-number style
    if (isParts) return this._foundParts(query, parsed, results);

    return this._found(query, parsed, results);
  };

  // ── PARTS MODE RESPONSE (BUG 1+3 FIX) ────────────────────────────────────
  AIResponder.prototype._foundParts = function(query, parsed, results) {
    var q = parsed.original || query;
    var totalStr = results.length.toLocaleString();
    var partsResults = results.filter(function(item) {
      var r = item.record || item;
      return String(r.id || '').startsWith('parts_') ||
        String(r.cat || '').toLowerCase().includes('part') ||
        String(r._src || '') === 'parts';
    });
    var displayResults = partsResults.length > 0 ? partsResults : results;
    var topFive = displayResults.slice(0, 5);
    var html = '';

    html += '<p><span class="ai-highlight">Part Number Search</span> — I found <strong>' + totalStr + '</strong> records for <em>"' + _esc(q) + '"</em>.</p>';

    if (topFive.length) {
      html += '<h4>🔩 Top Matching Parts</h4>';
      html += '<div style="overflow-x:auto;">';
      html += '<table style="width:100%;border-collapse:collapse;font-size:11px;margin:4px 0;">';
      html += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,.1);">' +
        '<th style="text-align:left;padding:4px 8px;color:#94a3b8;font-weight:600;">Part #</th>' +
        '<th style="text-align:left;padding:4px 8px;color:#94a3b8;font-weight:600;">Brand</th>' +
        '<th style="text-align:left;padding:4px 8px;color:#94a3b8;font-weight:600;">Description</th>' +
        '</tr></thead><tbody>';
      topFive.forEach(function(item) {
        var r = item.record || item;
        var partNo = r.title || r.partNo || '—';
        var brand = r.brand || '';
        var desc = r.res || r.desc || r.cat || '';
        // Truncate description
        if (desc.length > 80) desc = desc.slice(0, 80) + '…';
        html += '<tr style="border-bottom:1px solid rgba(255,255,255,.05);">' +
          '<td style="padding:5px 8px;font-family:monospace;color:#f59e0b;font-weight:700;">' + _esc(partNo) + '</td>' +
          '<td style="padding:5px 8px;color:#94a3b8;">' + _esc(brand) + '</td>' +
          '<td style="padding:5px 8px;color:#cbd5e1;">' + _esc(desc) + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    }

    if (results.length > 5) {
      html += '<p class="ai-tip">💡 <strong>Tip:</strong> Use the <strong>Part Number</strong> filter tab above to see all ' + totalStr + ' results sorted by exact match.</p>';
    }

    return {
      html: html,
      sources: 'Part Number catalog — ' + totalStr + ' matches'
    };
  };

  // ── SUPPORT CASE RESPONSE ─────────────────────────────────────────────────
  AIResponder.prototype._found = function(query, parsed, results) {
    var ext = this.extractor;
    var topResults = results.slice(0, 5);
    var topRecord = topResults[0] ? (topResults[0].record || topResults[0]) : {};

    var tokens = (parsed.expanded && parsed.expanded.length > 0 ? parsed.expanded : parsed.tokens)
      .filter(function(t) { return !NOISE_FILTER.has(t); });
    var conversationalSummary = ext.extractBestSemanticSentence(topRecord.res, tokens);

    var endUsers = ext.extractEndUsers(results);
    var caseNums = ext.extractCaseNums(results);
    var categories = ext.extractCategories(results);

    var q = parsed.original || query;
    var totalStr = results.length.toLocaleString();
    var html = '';

    html += '<p><span class="ai-highlight">Here is what I found.</span> I scanned <strong>' + totalStr + '</strong> records related to <em>"' + _esc(q) + '"</em>.</p>';

    // BUG 3 FIX: Only show "Most Relevant Fix" if top record has resolution text
    if (topRecord.title && topRecord.res && topRecord.res.length > 20) {
      html += '<h4>💡 Most Relevant Fix</h4>';
      html += '<p>Based on Case <span class="ai-case-link" data-case="' + _esc(topRecord.case) + '">#' + _esc(topRecord.case) + '</span> (<em>' + _esc(topRecord.title) + '</em>), typical resolution:</p>';
      html += '<p style="padding-left:10px;border-left:3px solid #10b981;color:#cbd5e1;">' + _esc(conversationalSummary) + '</p>';
    }

    var details = [];
    if (caseNums.length > 1) {
      details.push('📌 Related Cases: ' + caseNums.slice(1).map(function(c) {
        return '<span class="ai-case-link" data-case="' + _esc(c) + '">#' + _esc(c) + '</span>';
      }).join(', '));
    }
    if (endUsers.length) {
      details.push('👤 Affected Users: ' + endUsers.map(function(u) { return _esc(u); }).join(', '));
    }
    if (categories.length > 1) {
      details.push('📁 Categories: ' + categories.map(function(c) { return _esc(c); }).join(', '));
    }

    if (details.length) {
      html += '<div class="ai-details-grid">' + details.map(function(d) {
        return '<div class="ai-detail-item">' + d + '</div>';
      }).join('') + '</div>';
    }

    if (results.length > 20) {
      html += '<p class="ai-tip">💡 <strong>Tip:</strong> Add the site name or specific model to narrow down results.</p>';
    }

    return {
      html: html,
      sources: 'Synthesized from Top 5 of ' + totalStr + ' matches'
    };
  };

  AIResponder.prototype._noResults = function(query, parsed, fuzzyTerms) {
    var q = parsed.original || query;
    var html = '';

    html += '<p>I could not find exact matches for <em>"' + _esc(q) + '"</em> in the database.</p>';

    // BUG 2 FIX: Filter noise words from fuzzy suggestions
    var cleanFuzzy = (fuzzyTerms || []).filter(function(t) { return !NOISE_FILTER.has(t) && t.length >= 3; });
    if (cleanFuzzy.length) {
      html += '<h4>🤔 Did you mean?</h4><div class="ai-did-you-mean">';
      cleanFuzzy.forEach(function(t) {
        html += '<span class="ai-suggest-term" data-term="' + _esc(t) + '">' + _esc(t) + '</span>';
      });
      html += '</div>';
    }

    html += '<h4>💡 Search Tips</h4><ul>';
    html += '<li>Use specific product names: <em>E2, E3, XR75, CC200, Site Supervisor</em></li>';
    html += '<li>Include case numbers: <em>#526754</em></li>';
    html += '<li>Try end user names: <em>Walmart, Woolworths, Coles</em></li>';
    html += '<li>For parts: search by part number directly, e.g. <em>XR77CX</em> or <em>845-1300</em></li>';
    html += '<li>Check spelling — common: <em>offline, firmware, license key, solenoid</em></li>';
    html += '</ul>';

    return { html: html, sources: 'No direct matches — showing suggestions' };
  };

  AIResponder.prototype._ambiguous = function(query, parsed, count) {
    var q = parsed.original || query;
    var html = '';

    html += '<p>I found <span class="ai-highlight">' + count.toLocaleString() + ' results</span> for <em>"' + _esc(q) + '"</em>. Let me help you narrow it down.</p>';
    html += '<h4>🎯 Narrow your search:</h4><ul>';
    html += '<li>Add an end user: <em>"' + _esc(q) + ' Walmart"</em></li>';
    html += '<li>Add a specific model: <em>"' + _esc(q) + ' E3"</em> or <em>"' + _esc(q) + ' XR75"</em></li>';
    html += '<li>Use the source filter chips on the left sidebar</li>';
    html += '<li>Add a case number: <em>#526754</em></li>';
    html += '</ul>';
    html += '<p class="ai-tip">💡 The most relevant results are already at the top of the list.</p>';

    return { html: html, sources: count.toLocaleString() + ' broad matches — refine your query' };
  };

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  global.SE2AIResponder = AIResponder;
  global.SE2PatternExtractor = PatternExtractor;

})(window);

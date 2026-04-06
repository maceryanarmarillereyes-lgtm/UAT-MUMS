/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

/**
 * MUMS AI Responder v2 — Client-Side Response Synthesizer
 * Generates conversational, AI-like summaries from search results.
 * Zero external APIs — pure pattern extraction and template generation.
 */
(function(global) {
  'use strict';

  // ── PATTERN EXTRACTOR ─────────────────────────────────────────────────────
  function PatternExtractor() {
    // Action verb patterns found in MUMS resolution text
    this.actionRx = /(?:^|[.!?]\s+|\n)([A-Z][a-z]+(?:ed|d|d|ing)?\s[^.!?\n]{10,100})/g;
    this.stepRx = /\b(advised|provided|confirmed|updated|assisted|resolved|replaced|checked|verified|escalated|assigned|forwarded|recommended|guided|instructed|notified|informed|configured|reset|restarted|upgraded|downloaded|installed|re-programmed|re-programing|re-programming)\b/gi;
    this.techRx = /\b([A-Z]{2,}\d{1,4}(?:\.\d+)?|v\d+\.\d+(?:\.\d+)?|\d+\.\d+\.\d+(?:\.\d+)?|\b(?:E[23]|XR\d{2}|CC\d{3}|XM\d{3})\b)/g;
    this.caseNumRx = /\b(\d{5,7})\b/g;
  }

  PatternExtractor.prototype.extractSteps = function(resText) {
    if (!resText) return [];
    var steps = [];
    var text = String(resText);
    // Look for sentence-starting action verbs
    var matches = text.match(/(?:^|(?<=[.!\n])\s*)([A-Z][a-z]+(?:ed|d)?\s.{10,120})/gm) || [];
    matches.forEach(function(m) {
      var clean = m.trim();
      if (clean.length > 15 && clean.length < 150) steps.push(clean);
    });
    // Fallback: split on periods and find sentences with action verbs
    if (!steps.length) {
      text.split(/[.!\n]+/).forEach(function(sent) {
        var s = sent.trim();
        if (s.length > 20 && /\b(advised|provided|confirmed|updated|resolved|replaced|checked|configured|reset|assisted|guided)\b/i.test(s)) {
          steps.push(s.charAt(0).toUpperCase() + s.slice(1));
        }
      });
    }
    return steps.slice(0, 5);
  };

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

  PatternExtractor.prototype.extractTechTerms = function(resText) {
    if (!resText) return [];
    var found = resText.match(/\b([A-Z]{2,}\d{1,4}(?:\.\d+)?|v\d+\.\d+(?:\.\d+)?|\d+\.\d+\.\d+)\b/g) || [];
    return found.filter(function(t, i) { return found.indexOf(t) === i; }).slice(0, 4);
  };

  PatternExtractor.prototype.getBestResolution = function(results) {
    // Find the result with the longest, most detailed resolution
    var best = results[0];
    results.slice(0, 5).forEach(function(item) {
      var r = item.record || item;
      if ((r.res || '').length > ((best.record || best).res || '').length) best = item;
    });
    return (best.record || best).res || '';
  };

  // ── AI RESPONDER ──────────────────────────────────────────────────────────
  function AIResponder() {
    this.extractor = new PatternExtractor();
  }

  AIResponder.prototype.generate = function(query, searchOutput) {
    var results = searchOutput.results || [];
    var parsed  = searchOutput.parsed || { original: query, type: 'keyword' };
    var fuzzy   = searchOutput.fuzzyTerms || [];

    if (!results.length) return this._noResults(query, parsed, fuzzy);
    if (results.length > 120) return this._ambiguous(query, parsed, results.length);
    return this._found(query, parsed, results);
  };

  AIResponder.prototype._found = function(query, parsed, results) {
    var ext = this.extractor;
    var topResults = results.slice(0, 5);
    var bestRes = ext.getBestResolution(topResults);
    var steps = ext.extractSteps(bestRes);
    var endUsers = ext.extractEndUsers(results);
    var caseNums = ext.extractCaseNums(results);
    var categories = ext.extractCategories(results);
    var techTerms = ext.extractTechTerms(bestRes);
    var topRecord = topResults[0] ? (topResults[0].record || topResults[0]) : {};

    var q = parsed.original || query;
    var totalStr = results.length.toLocaleString();

    var html = '';

    // Quick summary
    html += '<p><span class="ai-highlight">Found ' + totalStr + ' match' + (results.length !== 1 ? 'es' : '') + '</span> related to <em>"' + _esc(q) + '"</em>';
    if (categories.length) {
      html += ' — primarily in <strong>' + _esc(categories[0]) + '</strong>';
    }
    html += '.</p>';

    // Quick answer from best match
    if (topRecord.title) {
      html += '<h4>🔍 Best Match</h4>';
      html += '<p><em>' + _esc(topRecord.title) + '</em>';
      if (topRecord.eu) html += ' · <strong>' + _esc(topRecord.eu) + '</strong>';
      html += '</p>';
    }

    // Resolution steps
    if (steps.length) {
      html += '<h4>📋 Common Resolution Steps</h4><ul>';
      steps.forEach(function(s) { html += '<li>' + _esc(s) + '</li>'; });
      html += '</ul>';
    } else if (bestRes) {
      // Just show snippet
      html += '<h4>📋 Key Resolution</h4>';
      html += '<p>' + _esc(bestRes.slice(0, 200)) + (bestRes.length > 200 ? '…' : '') + '</p>';
    }

    // Supporting details
    var details = [];
    if (caseNums.length) {
      details.push('📌 Cases: ' + caseNums.map(function(c) {
        return '<span class="ai-case-link" data-case="' + _esc(c) + '">#' + _esc(c) + '</span>';
      }).join(', '));
    }
    if (endUsers.length) {
      details.push('👤 End Users: ' + endUsers.map(function(u) { return _esc(u); }).join(', '));
    }
    if (categories.length > 1) {
      details.push('📁 Categories: ' + categories.map(function(c) { return _esc(c); }).join(', '));
    }
    if (techTerms.length) {
      details.push('⚙️ Tech: ' + techTerms.map(function(t) { return '<code>' + _esc(t) + '</code>'; }).join(', '));
    }

    if (details.length) {
      html += '<div class="ai-details-grid">' + details.map(function(d) {
        return '<div class="ai-detail-item">' + d + '</div>';
      }).join('') + '</div>';
    }

    // Tip for large result sets
    if (results.length > 20) {
      html += '<p class="ai-tip">💡 <strong>Tip:</strong> Use the category filter above or add an end user name to narrow results (e.g., <em>"' + _esc(q) + ' Walmart"</em>).</p>';
    }

    return {
      html: html,
      sources: 'Based on ' + Math.min(results.length, 5) + ' of ' + totalStr + ' matched records'
    };
  };

  AIResponder.prototype._noResults = function(query, parsed, fuzzyTerms) {
    var q = parsed.original || query;
    var html = '';

    html += '<p>I couldn\'t find exact matches for <em>"' + _esc(q) + '"</em>.</p>';

    if (fuzzyTerms.length) {
      html += '<h4>🤔 Did you mean?</h4><div class="ai-did-you-mean">';
      fuzzyTerms.forEach(function(t) {
        html += '<span class="ai-suggest-term" data-term="' + _esc(t) + '">' + _esc(t) + '</span>';
      });
      html += '</div>';
    }

    html += '<h4>💡 Search Tips</h4><ul>';
    html += '<li>Use specific product names: <em>E2, E3, XR75, CC200, Site Supervisor</em></li>';
    html += '<li>Include case numbers: <em>#526754</em></li>';
    html += '<li>Try end user names: <em>Walmart, Woolworths, Coles</em></li>';
    html += '<li>Use fewer or shorter keywords</li>';
    html += '<li>Check spelling — common terms: <em>offline, firmware, license key, solenoid</em></li>';
    html += '</ul>';

    // Suggest synonyms from query terms
    var synSuggestions = [];
    if (parsed.tokens) {
      parsed.tokens.slice(0, 3).forEach(function(tok) {
        var synMap = window.SE2SynonymMap || {};
        Object.keys(synMap).forEach(function(key) {
          if (key.includes(tok) || tok.includes(key)) {
            synSuggestions = synSuggestions.concat(synMap[key].slice(0, 2));
          }
        });
      });
    }
    if (synSuggestions.length) {
      html += '<h4>🔗 Related Terms</h4><div class="ai-did-you-mean">';
      synSuggestions.slice(0, 6).forEach(function(t) {
        html += '<span class="ai-suggest-term" data-term="' + _esc(t) + '">' + _esc(t) + '</span>';
      });
      html += '</div>';
    }

    html += '<p style="margin-top:10px;">📁 Browse by category above to explore all available records.</p>';

    return {
      html: html,
      sources: 'No direct matches found — showing suggestions'
    };
  };

  AIResponder.prototype._ambiguous = function(query, parsed, count) {
    var q = parsed.original || query;
    var html = '';

    html += '<p>Your search returned <span class="ai-highlight">' + count.toLocaleString() + ' results</span> for <em>"' + _esc(q) + '"</em> — this is a broad query.</p>';
    html += '<h4>🎯 Narrow Your Results</h4><ul>';
    html += '<li>Add an end user: <em>"' + _esc(q) + ' Walmart"</em></li>';
    html += '<li>Add a product: <em>"' + _esc(q) + ' E3"</em> or <em>"' + _esc(q) + ' XR75"</em></li>';
    html += '<li>Use quotes for exact phrase: <em>"' + _esc(q) + '"</em></li>';
    html += '<li>Use <kbd>+</kbd> / <kbd>-</kbd> operators: <em>+' + _esc(q.split(' ')[0]) + ' -azure</em></li>';
    html += '<li>Click a category filter above to scope results</li>';
    html += '</ul>';
    html += '<p class="ai-tip">💡 The most relevant results appear at the top — relevance score shown on each card.</p>';

    return {
      html: html,
      sources: count.toLocaleString() + ' results — try narrowing your query'
    };
  };

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Expose
  global.SE2AIResponder = AIResponder;
  global.SE2PatternExtractor = PatternExtractor;

})(window);

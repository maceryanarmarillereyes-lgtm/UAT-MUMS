/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

/**
 * MUMS AI Responder v2 — Client-Side Response Synthesizer (2026 Semantic Upgrade)
 * Generates conversational, AI-like summaries from search results using TF Extraction.
 * Zero external APIs — pure pattern extraction and template generation.
 */
(function(global) {
  'use strict';

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

  PatternExtractor.prototype.extractTechTerms = function(resText) {
    if (!resText) return [];
    var found = resText.match(/\b([A-Z]{2,}\d{1,4}(?:\.\d+)?|v\d+\.\d+(?:\.\d+)?|\d+\.\d+\.\d+)\b/g) || [];
    return found.filter(function(t, i) { return found.indexOf(t) === i; }).slice(0, 4);
  };

  // Semantic Sentence Extractor: Finds the most relevant sentence based on query terms
  PatternExtractor.prototype.extractBestSemanticSentence = function(resText, tokens) {
    if (!resText) return "";
    var sentences = resText.split(/[.!\n]+/).filter(function(s) { return s.trim().length > 15; });
    var bestSent = "";
    var bestScore = -1;

    sentences.forEach(function(sent) {
      var s = sent.toLowerCase();
      var score = 0;
      tokens.forEach(function(t) { if (s.includes(t)) score++; });
      // Boost sentences that start with action verbs
      if (/^\s*(advised|provided|confirmed|updated|resolved|replaced|checked|configured|reset|assisted|guided)\b/i.test(s)) {
        score += 0.5;
      }
      if (score > bestScore) {
        bestScore = score;
        bestSent = sent.trim();
      }
    });

    if (bestSent.length > 0) {
      return bestSent.charAt(0).toUpperCase() + bestSent.slice(1) + ".";
    }
    return resText.slice(0, 200) + "...";
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
    var topRecord = topResults[0] ? (topResults[0].record || topResults[0]) : {};
    
    var tokens = parsed.expanded && parsed.expanded.length > 0 ? parsed.expanded : parsed.tokens;
    var conversationalSummary = ext.extractBestSemanticSentence(topRecord.res, tokens);
    
    var endUsers = ext.extractEndUsers(results);
    var caseNums = ext.extractCaseNums(results);
    var categories = ext.extractCategories(results);
    var techTerms = ext.extractTechTerms(topRecord.res);

    var q = parsed.original || query;
    var totalStr = results.length.toLocaleString();

    var html = '';

    // Conversational Intro
    html += '<p><span class="ai-highlight">Here is what I found.</span> I scanned ' + totalStr + ' records related to <em>"' + _esc(q) + '"</em>.</p>';

    // Semantic Answer
    if (topRecord.title) {
      html += '<h4>💡 The Most Relevant Fix</h4>';
      html += '<p>Based on Case <span class="ai-case-link" data-case="' + _esc(topRecord.case) + '">#' + _esc(topRecord.case) + '</span> (<em>' + _esc(topRecord.title) + '</em>), here is the usual resolution:</p>';
      html += '<p style="padding-left: 10px; border-left: 3px solid #10b981; color: #cbd5e1;">' + _esc(conversationalSummary) + '</p>';
    }

    // Supporting details
    var details = [];
    if (caseNums.length > 1) {
      details.push('📌 Other Cases: ' + caseNums.slice(1).map(function(c) {
        return '<span class="ai-case-link" data-case="' + _esc(c) + '">#' + _esc(c) + '</span>';
      }).join(', '));
    }
    if (endUsers.length) {
      details.push('👤 Affected Users: ' + endUsers.map(function(u) { return _esc(u); }).join(', '));
    }
    if (categories.length > 1) {
      details.push('📁 Categories: ' + categories.map(function(c) { return _esc(c); }).join(', '));
    }
    if (techTerms.length) {
      details.push('⚙️ Tech Terms: ' + techTerms.map(function(t) { return '<code>' + _esc(t) + '</code>'; }).join(', '));
    }

    if (details.length) {
      html += '<div class="ai-details-grid">' + details.map(function(d) {
        return '<div class="ai-detail-item">' + d + '</div>';
      }).join('') + '</div>';
    }

    if (results.length > 20) {
      html += '<p class="ai-tip">💡 <strong>Tip:</strong> If this isn\'t exactly it, try adding the site name or specific model to your search.</p>';
    }

    return {
      html: html,
      sources: 'Synthesized from Top 5 out of ' + totalStr + ' matches'
    };
  };

  AIResponder.prototype._noResults = function(query, parsed, fuzzyTerms) {
    var q = parsed.original || query;
    var html = '';

    html += '<p>I couldn\'t find exact matches for <em>"' + _esc(q) + '"</em> in our database.</p>';

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
    html += '<li>Check spelling — common terms: <em>offline, firmware, license key, solenoid</em></li>';
    html += '</ul>';

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

    return {
      html: html,
      sources: 'No direct matches found — showing suggestions'
    };
  };

  AIResponder.prototype._ambiguous = function(query, parsed, count) {
    var q = parsed.original || query;
    var html = '';

    html += '<p>I found <span class="ai-highlight">' + count.toLocaleString() + ' results</span> for <em>"' + _esc(q) + '"</em>. That is quite a lot!</p>';
    html += '<h4>🎯 How to narrow this down:</h4><ul>';
    html += '<li>Add an end user: <em>"' + _esc(q) + ' Walmart"</em></li>';
    html += '<li>Add a specific model: <em>"' + _esc(q) + ' E3"</em> or <em>"' + _esc(q) + ' XR75"</em></li>';
    html += '<li>Click a category filter (e.g. Parts, Controllers) above</li>';
    html += '</ul>';
    html += '<p class="ai-tip">💡 Scroll down to see the most relevant results at the top.</p>';

    return {
      html: html,
      sources: count.toLocaleString() + ' broad matches — try narrowing your query'
    };
  };

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Expose
  global.SE2AIResponder = AIResponder;
  global.SE2PatternExtractor = PatternExtractor;

})(window);
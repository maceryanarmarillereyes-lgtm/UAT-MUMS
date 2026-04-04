(function (global) {
  'use strict';

  class PatternExtractor {
    static splitSentences(text) {
      return String(text || '').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    }

    static extract(resolution) {
      const sents = this.splitSentences(resolution);
      const actionSteps = sents.filter((s) => /^(advised|provided|confirmed|updated|checked|reset|configured|verified|assigned|forwarded|looped|recommended)/i.test(s));
      const statuses = sents.filter((s) => /(resolved|closed|escalated|pending|in progress|open)/i.test(s));
      const contacts = sents.filter((s) => /(assigned to|forwarded to|looped in|contacted|emailed)/i.test(s));
      const technical = (resolution.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[0-9A-F]{2}(?::[0-9A-F]{2}){5}\b|v?\d+\.\d+(?:\.\d+)?|\b[A-Z]{2,}-\d{2,}\b/gi) || []).slice(0, 8);
      return { actionSteps, statuses, contacts, technical };
    }
  }

  class AIResponder {
    constructor(synonyms) {
      this.synonyms = synonyms || {};
    }

    summarizeSteps(results) {
      const pool = [];
      results.forEach((r) => {
        const ex = PatternExtractor.extract(r.res || '');
        pool.push(...ex.actionSteps);
      });
      return Array.from(new Set(pool)).slice(0, 4);
    }

    generateNoResult(query, fuzzyTerms) {
      const seed = query.toLowerCase().split(/\s+/).find((x) => this.synonyms[x]);
      const related = seed ? this.synonyms[seed].slice(0, 4) : [];
      return {
        html: `<h4>Walang exact match for "${this.escape(query)}"</h4>
          <p>Try natin i-narrow or i-correct yung query mo.</p>
          <h4>🤔 Did you mean</h4>
          <ul>${fuzzyTerms.map((t) => `<li class="ai-highlight">${this.escape(t)}</li>`).join('') || '<li>Try fewer keywords</li>'}</ul>
          <h4>💡 Suggested terms</h4>
          <ul>${related.map((t) => `<li>${this.escape(t)}</li>`).join('') || '<li>Use product name + symptom (e.g. E3 offline)</li>'}</ul>
          <h4>📝 Search tips</h4>
          <ul><li>Use case number format: #526754</li><li>Use +mustterm -excludeterm operators</li><li>Check spelling ng end user names</li></ul>`,
        sources: 'Sources: no direct matches'
      };
    }

    generateBroad(query) {
      return {
        html: `<h4>Maraming results for "${this.escape(query)}"</h4>
          <p>Broad masyado. Narrow down para mas precise.</p>
          <ul>
            <li>Add end user: <span class="ai-highlight">${this.escape(query)} + walmart</span></li>
            <li>Add product: <span class="ai-highlight">${this.escape(query)} + e3</span></li>
            <li>Use category cards or advanced filters.</li>
          </ul>`,
        sources: 'Sources: broad match guidance'
      };
    }

    generateResponse(query, topResults, fuzzyTerms) {
      if (!topResults.length) return this.generateNoResult(query, fuzzyTerms || []);
      if (topResults.length > 100) return this.generateBroad(query);
      const sample = topResults.slice(0, 5);
      const best = sample[0] || {};
      const steps = this.summarizeSteps(sample);
      const cases = sample.map((r) => r.case).filter(Boolean).slice(0, 5);
      const eus = Array.from(new Set(sample.map((r) => r.eu).filter(Boolean))).slice(0, 4);
      const cats = Array.from(new Set(sample.map((r) => r.cat).filter(Boolean))).slice(0, 3);
      const quick = (best.res || 'No resolution text available.').split(/(?<=[.!?])\s+/)[0];

      return {
        html: `<h4>🔍 Quick Answer</h4>
          <p>${this.escape(quick)}</p>
          <h4>📋 Common Steps</h4>
          <ul>${(steps.length ? steps : ['Review logs and validate connectivity before escalation.']).map((s) => `<li>${this.escape(s)}</li>`).join('')}</ul>
          <h4>📌 Related Cases</h4>
          <p>${cases.map((c) => `<span class="ai-case-link">#${this.escape(c)}</span>`).join(', ') || 'N/A'}</p>
          <h4>👤 Affected End Users</h4>
          <p>${eus.map((x) => this.escape(x)).join(', ') || 'N/A'}</p>
          <h4>📁 Category</h4>
          <p>${cats.map((x) => this.escape(x)).join(', ') || 'N/A'}</p>
          <p><strong>💡 Tip:</strong> I-validate muna latest controller status and communication path para iwas repeat case.</p>`,
        sources: `Sources: ${sample.map((r) => `#${r.case || 'N/A'}`).join(', ')}`
      };
    }

    typewrite(targetEl, html, speed) {
      const plain = html.replace(/<[^>]+>/g, '');
      targetEl.innerHTML = '';
      let i = 0;
      const cursor = '<span class="ai-cursor"></span>';
      return new Promise((resolve) => {
        const tick = () => {
          if (i >= plain.length) {
            targetEl.innerHTML = html;
            resolve();
            return;
          }
          targetEl.innerHTML = `${this.escape(plain.slice(0, i + 1))}${cursor}`;
          i += 1;
          setTimeout(tick, speed || 15);
        };
        tick();
      });
    }

    escape(s) {
      return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }
  }

  global.PatternExtractor = PatternExtractor;
  global.AIResponder = AIResponder;
})(window);

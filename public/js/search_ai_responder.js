/**
 * Search AI Responder v3.0 (2026)
 * Conversational AI response generator for Search Engine 2.
 * Source-aware rendering for ALL 8 catalog types.
 */

(function(global) {
  'use strict';

  const AI_VERSION = '3.0.0';

  const CONFIDENCE = {
    part_number: 500, product_controllers: 400, contact_info: 300,
    support_records: 50, knowledge_base: 80, connect_plus: 60,
    quickbase: 40, deep_search: 40
  };

  const LABELS = {
    part_number: '🔩 Part Number', product_controllers: '🎛️ Product Controllers',
    contact_info: '📇 Contact Information', support_records: '🎫 Support Records',
    knowledge_base: '📚 Knowledge Base', connect_plus: '🔗 Connect+',
    quickbase: '⚡ QuickBase', deep_search: '🔍 Deep Search'
  };

  const NOISE_FILTER = new Set([
    'part','number','type','model','product','unit','item','record',
    'what','how','where','when','why','who','which','is','are','the',
    'a','an','of','in','on','at','to','for','with','by','from','and','or'
  ]);

  function esc(str) {
    return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function detectIntent(qMeta) {
    const raw = (qMeta.raw||'').toLowerCase();
    return {
      isPartQuery:       qMeta.hasPartCode || raw.includes('part') || raw.includes('sku'),
      isControllerQuery: raw.includes('controller')||raw.includes('firmware')||raw.includes('model'),
      isContactQuery:    raw.includes('contact')||raw.includes('email')||raw.includes('phone')||raw.includes('who is'),
      isKBQuery:         raw.includes('how to')||raw.includes('guide')||raw.includes('manual'),
      isSupportQuery:    raw.includes('case')||raw.includes('ticket')||raw.includes('issue')||raw.includes('fix'),
      isQuestion:        qMeta.isQuestion
    };
  }

  function buildGreeting(rawQuery, intent, total) {
    if (!total) return '';
    const q = esc(rawQuery);
    let msg = '';
    if (intent.isQuestion)         msg = `I found <strong>${total}</strong> result(s) for your question: <em>"${q}"</em>`;
    else if (intent.isPartQuery)   msg = `Here are matching parts for <em>"${q}"</em> — <strong>${total}</strong> result(s).`;
    else if (intent.isContactQuery)msg = `Looking up contacts for <em>"${q}"</em>…`;
    else                           msg = `Showing <strong>${total}</strong> result(s) for <em>"${q}"</em>.`;
    return `<div class="se2-ai-greeting">${msg}</div>`;
  }

  function buildPartTable(parts) {
    const rows = parts.map(p => {
      const r = p.record||{};
      return `<tr>
        <td><strong>${esc(r.partNo||r.part_no||r.sku||r.id||'')}</strong></td>
        <td>${esc(r.brand||r.manufacturer||'')}</td>
        <td>${esc(r.type||r.category||'')}</td>
        <td>${esc(r.description||r.title||r.name||'')}</td>
      </tr>`;
    }).join('');
    return `<div class="se2-section">
      <h4>${LABELS.part_number}</h4>
      <table class="se2-table">
        <thead><tr><th>Part No.</th><th>Brand</th><th>Type</th><th>Description</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function buildCards(items, label, fields) {
    fields = fields || ['title','description'];
    const cards = items.map(item => {
      const r = item.record||{};
      const title = r[fields[0]]||r.title||r.name||r.subject||'Record';
      const sub   = r.id||r.recordId||r.caseId||'';
      const body  = String(r[fields[1]]||r.description||r.content||r.resolution||'').substring(0,200);
      return `<div class="se2-card">
        <div class="se2-card-title">${esc(title)}</div>
        ${sub?`<div class="se2-card-badge">${esc(sub)}</div>`:''}
        <div class="se2-card-body">${esc(body)}</div>
      </div>`;
    }).join('');
    return `<div class="se2-section"><h4>${esc(label)}</h4><div class="se2-cards">${cards}</div></div>`;
  }

  function buildContactCards(contacts) {
    const cards = contacts.map(c => {
      const r = c.record||{};
      return `<div class="se2-card se2-contact-card">
        <div class="se2-card-title">${esc(r.name||r.fullName||'Contact')}</div>
        <div class="se2-card-meta">${esc(r.title||r.role||'')} · ${esc(r.department||'')}</div>
        <div class="se2-card-body">${esc(r.email||'')} · ${esc(r.phone||'')}</div>
      </div>`;
    }).join('');
    return `<div class="se2-section"><h4>${LABELS.contact_info}</h4><div class="se2-cards">${cards}</div></div>`;
  }

  function noResults(rawQuery) {
    return { html: `<div class="se2-no-results">
      <p>Sorry, I couldn't find anything for <em>"${esc(rawQuery)}"</em>. Tips:</p>
      <ul><li>Try shorter keywords</li><li>Check spelling</li>
      <li>Use part number format: XR77 or 845-1300</li>
      <li>Try brand name or model number</li></ul></div>`,
      summary:'No results found.', intent:{}, topSources:[], total:0 };
  }

  function generateResponse(searchResult, rawQuery) {
    const { query, results, total } = searchResult;
    const intent = detectIntent(query);

    if (!results || !results.length) return noResults(rawQuery);

    const bySource = {};
    results.forEach(r => { const s=r.sourceType||'unknown'; if(!bySource[s])bySource[s]=[]; bySource[s].push(r); });

    let html = '';
    const summaryLines = [];

    if (intent.isPartQuery && bySource.part_number) {
      const pts = bySource.part_number;
      html += buildPartTable(pts.slice(0,10));
      summaryLines.push(`Found **${pts.length}** part(s).`);
    }
    if (intent.isControllerQuery && bySource.product_controllers) {
      const c = bySource.product_controllers;
      html += buildCards(c.slice(0,5), LABELS.product_controllers, ['title','description']);
      summaryLines.push(`Found **${c.length}** controller(s).`);
    }
    if (intent.isContactQuery && bySource.contact_info) {
      html += buildContactCards(bySource.contact_info.slice(0,6));
      summaryLines.push(`Found **${bySource.contact_info.length}** contact(s).`);
    }
    if (bySource.support_records && !intent.isPartQuery) {
      const conf = (bySource.support_records||[]).filter(r => r.score >= CONFIDENCE.support_records);
      if (conf.length) { html += buildCards(conf.slice(0,5), LABELS.support_records, ['title','resolution']); summaryLines.push(`Found **${conf.length}** case(s).`); }
    }
    if (bySource.knowledge_base) {
      const kb = bySource.knowledge_base.filter(r => r.score >= CONFIDENCE.knowledge_base);
      if (kb.length) html += buildCards(kb.slice(0,4), LABELS.knowledge_base, ['title','content']);
    }
    if (bySource.connect_plus) {
      const c = bySource.connect_plus.filter(r => r.score >= CONFIDENCE.connect_plus);
      if (c.length) html += buildCards(c.slice(0,4), LABELS.connect_plus);
    }
    if (bySource.quickbase) {
      const q = bySource.quickbase.filter(r => r.score >= CONFIDENCE.quickbase);
      if (q.length) html += buildCards(q.slice(0,4), LABELS.quickbase);
    }
    if (bySource.deep_search) {
      const d = bySource.deep_search.filter(r => r.score >= CONFIDENCE.deep_search);
      if (d.length) html += buildCards(d.slice(0,4), LABELS.deep_search);
    }

    if (!html) html = buildCards(results.slice(0,5), 'Results');

    html = buildGreeting(rawQuery, intent, total) + html;

    return { html, summary: summaryLines.join(' '), intent, topSources: Object.keys(bySource), total };
  }

  global.SE2Responder = { generateResponse, detectIntent, AI_VERSION };

})(typeof window !== 'undefined' ? window : global);

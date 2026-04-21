// Bulk Quickbase lookup for Services Workspace - 1-2 seconds
async function bulkLookupQuickbase() {
  const updateBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Update'));
  if (updateBtn) updateBtn.disabled = true;

  try {
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    const cases = rows.map(tr => {
      const caseCell = tr.querySelector('td:nth-child(2)');
      return caseCell?.innerText?.trim();
    }).filter(Boolean);

    if (cases.length === 0) {
      alert('No cases found');
      return;
    }

    console.time('QB bulk');

    const cached = (() => {
      try {
        const c = JSON.parse(localStorage.getItem('qb_last_lookup') || '{}');
        if (c.ts && Date.now() - c.ts < 60000) return c.data;
      } catch {}
      return null;
    })();

    if (cached && Object.keys(cached).length >= cases.length * 0.9) {
      applyLookupToGrid(cached);
      console.timeEnd('QB bulk');
      showToast(`Loaded from cache (${cases.length} cases)`);
      return;
    }

    const resp = await fetch('/api/quickbase/bulk-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cases })
    });

    const json = await resp.json();
    if (!json.ok) throw new Error(json.error);

    applyLookupToGrid(json.data);

    localStorage.setItem('qb_last_lookup', JSON.stringify({
      ts: Date.now(),
      data: json.data
    }));

    console.timeEnd('QB bulk');
    showToast(`✓ Lookup updated in ${json.duration_ms}ms for ${json.count} cases`);

  } catch (err) {
    console.error(err);
    alert('Quickbase lookup failed: ' + err.message);
  } finally {
    if (updateBtn) updateBtn.disabled = false;
  }
}

function applyLookupToGrid(dataMap) {
  const rows = Array.from(document.querySelectorAll('table tbody tr'));

  rows.forEach(tr => {
    const caseCell = tr.querySelector('td:nth-child(2)');
    const statusCell = tr.querySelector('td:nth-child(5)');
    const trackingCell = tr.querySelector('td:nth-child(6)');

    const caseId = caseCell?.innerText?.trim();
    const qb = dataMap[caseId];

    if (qb && statusCell && trackingCell) {
      statusCell.innerText = qb.status;
      statusCell.style.color = '#5eead4';
      statusCell.style.fontStyle = 'italic';

      trackingCell.innerText = qb.tracking;
      trackingCell.style.color = '#5eead4';
      trackingCell.style.fontStyle = 'italic';
    }
  });
}

function showToast(msg) {
  console.log(msg);
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#0f172a;color:#fff;padding:12px 20px;border-radius:8px;z-index:9999;font-size:14px;';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

document.addEventListener('DOMContentLoaded', () => {
  const updateBtn = Array.from(document.querySelectorAll('button')).find(b =>
    b.textContent.includes('Update')
  );

  if (updateBtn) {
    updateBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      bulkLookupQuickbase();
    });
  }
});

window.bulkLookupQuickbase = bulkLookupQuickbase;

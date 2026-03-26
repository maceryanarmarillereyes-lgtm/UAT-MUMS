export interface ParsedQuickbaseUrl {
  appId?: string;
  tableId?: string;
  qid?: string;
}

export function parseQuickbaseReportUrl(url: string): ParsedQuickbaseUrl | null {
  const value = String(url || '').trim();
  if (!value) return null;

  try {
    const u = new URL(value);
    const qidRaw = u.searchParams.get('qid') ?? undefined;
    const qidMatch = String(qidRaw || '').trim().match(/-?\d+/);
    const qid = qidMatch && qidMatch[0] ? qidMatch[0] : undefined;

    const segments = u.pathname.split('/').filter(Boolean);
    const appIndex = segments.findIndex((segment) => segment.toLowerCase() === 'app');
    const tableIndex = segments.findIndex((segment) => segment.toLowerCase() === 'table');
    const appId = appIndex >= 0 ? (segments[appIndex + 1] || '').trim() || undefined : undefined;
    const tableId = tableIndex >= 0
      ? (segments[tableIndex + 1] || '').trim() || undefined
      : (() => {
        const dbIndex = segments.findIndex((segment) => segment.toLowerCase() === 'db');
        return dbIndex >= 0 ? (segments[dbIndex + 1] || '').trim() || undefined : undefined;
      })();

    if (!appId && !tableId && !qid) return null;
    return { appId, tableId, qid };
  } catch {
    return null;
  }
}

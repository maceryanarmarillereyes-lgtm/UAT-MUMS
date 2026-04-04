import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Zap, Database, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import SearchBar from "../components/search/SearchBar";
import SearchFilters from "../components/search/SearchFilters";
import SearchResults from "../components/search/SearchResults";
import SearchStats from "../components/search/SearchStats";
import { searchRecords, countBySource, countTotalBySource } from "../lib/searchEngine";

const PAGE_SIZE = 50;
const BATCH_SIZE = 500;

export default function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [allRecords, setAllRecords] = useState([]);
  const [loadingState, setLoadingState] = useState({
    status: 'idle',
    loaded: 0,
    total: null,
    batchesCompleted: 0,
    error: null,
  });

  const isFetchingRef = useRef(false);

  const [recentSearches, setRecentSearches] = useState(() => {
    const saved = localStorage.getItem('mums_recent_searches');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    async function loadAll() {
      setLoadingState({ status: 'loading', loaded: 0, total: null, batchesCompleted: 0, error: null });

      try {
        const firstBatch = await base44.entities.SupportRecord.list('-created_date', BATCH_SIZE, 0);

        if (firstBatch.length === 0) {
          setAllRecords([]);
          setLoadingState(s => ({ ...s, status: 'done', loaded: 0, total: 0 }));
          return;
        }

        setAllRecords(firstBatch);
        setLoadingState(s => ({ ...s, loaded: firstBatch.length, batchesCompleted: 1 }));

        if (firstBatch.length < BATCH_SIZE) {
          setLoadingState(s => ({ ...s, status: 'done', loaded: firstBatch.length, total: firstBatch.length }));
          return;
        }

        let skip = BATCH_SIZE;
        let allData = [...firstBatch];
        let keepFetching = true;

        while (keepFetching) {
          const PARALLEL = 4;
          const promises = [];
          for (let i = 0; i < PARALLEL; i++) {
            promises.push(
              base44.entities.SupportRecord.list('-created_date', BATCH_SIZE, skip + i * BATCH_SIZE)
            );
          }

          const results = await Promise.all(promises);
          let batchCount = 0;

          for (const batch of results) {
            if (batch && batch.length > 0) {
              allData = allData.concat(batch);
              batchCount++;
            }
            if (!batch || batch.length < BATCH_SIZE) {
              keepFetching = false;
              break;
            }
          }

          setAllRecords([...allData]);
          setLoadingState(s => ({
            ...s,
            loaded: allData.length,
            batchesCompleted: s.batchesCompleted + batchCount,
          }));

          skip += PARALLEL * BATCH_SIZE;
          if (batchCount === 0) keepFetching = false;
        }

        setLoadingState(s => ({ ...s, status: 'done', total: allData.length }));

      } catch (err) {
        console.error('Failed to load records:', err);
        setLoadingState(s => ({ ...s, status: 'error', error: err.message }));
      }
    }

    loadAll();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setActiveQuery(query);
      setVisibleCount(PAGE_SIZE);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const searchResults = useMemo(() => {
    if (!activeQuery) return [];
    return searchRecords(allRecords, activeQuery);
  }, [allRecords, activeQuery]);

  const filteredResults = useMemo(() => {
    let results = activeTab === 'all'
      ? searchResults
      : searchResults.filter(r => r.source_tab === activeTab);

    results = [...results].sort((a, b) => {
      const dateA = new Date(a.created_date).getTime();
      const dateB = new Date(b.created_date).getTime();
      return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });
    return results;
  }, [searchResults, activeTab, sortOrder]);

  const tabCounts = useMemo(() => countBySource(searchResults), [searchResults]);
  const totalCounts = useMemo(() => countTotalBySource(allRecords), [allRecords]);
  const visibleResults = filteredResults.slice(0, visibleCount);

  const handleSearch = useCallback((term) => {
    if (!term.trim()) return;
    setActiveQuery(term);
    setVisibleCount(PAGE_SIZE);
    setRecentSearches(prev => {
      const updated = [term, ...prev.filter(s => s !== term)].slice(0, 10);
      localStorage.setItem('mums_recent_searches', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleClearRecent = () => {
    setRecentSearches([]);
    localStorage.removeItem('mums_recent_searches');
  };

  useEffect(() => {
    const handleScroll = () => {
      if (window.innerHeight + document.documentElement.scrollTop >= document.documentElement.offsetHeight - 300) {
        if (visibleCount < filteredResults.length) {
          setVisibleCount(prev => prev + PAGE_SIZE);
        }
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [visibleCount, filteredResults.length]);

  const isLoading = loadingState.status === 'loading';
  const isDone = loadingState.status === 'done';
  const loadPercent = loadingState.total
    ? Math.min(100, Math.round((loadingState.loaded / loadingState.total) * 100))
    : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Zap className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-foreground leading-none">MUMS Support Studio</h1>
                <span className="text-[10px] text-muted-foreground">Global Search Engine v2</span>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {isLoading && (
                <span className="flex items-center gap-1.5 text-xs text-amber-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Loading {loadingState.loaded.toLocaleString()} records…
                </span>
              )}
              {isDone && (
                <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <CheckCircle2 className="w-3 h-3" />
                  {allRecords.length.toLocaleString()} records indexed
                </span>
              )}
              {loadingState.status === 'error' && (
                <span className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertCircle className="w-3 h-3" />
                  Load error
                </span>
              )}
            </div>
          </div>

          {isLoading && (
            <div className="w-full h-1 bg-border rounded-full mb-3 overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300 rounded-full"
                style={{ width: loadPercent ? `${loadPercent}%` : '15%', animation: !loadPercent ? 'pulse 1.5s infinite' : 'none' }}
              />
            </div>
          )}

          <SearchBar
            query={query}
            onQueryChange={setQuery}
            onSearch={handleSearch}
            isSearching={isLoading && allRecords.length === 0}
            totalResults={filteredResults.length}
            recentSearches={recentSearches}
            onClearRecent={handleClearRecent}
          />

          {activeQuery && (
            <div className="mt-3">
              <SearchFilters
                activeTab={activeTab}
                onTabChange={setActiveTab}
                counts={tabCounts}
                allRecords={allRecords}
              />
            </div>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {!activeQuery && (
          <div className="mb-6">
            <DataMonitor loadingState={loadingState} allRecords={allRecords} totalCounts={totalCounts} />
          </div>
        )}

        <SearchResults
          results={visibleResults}
          query={activeQuery}
          totalResults={filteredResults.length}
          isSearching={isLoading && allRecords.length === 0 && !!activeQuery}
          sortOrder={sortOrder}
          onSortChange={() => setSortOrder(prev => prev === 'newest' ? 'oldest' : 'newest')}
        />

        {visibleCount < filteredResults.length && (
          <div className="flex justify-center mt-6">
            <span className="text-xs text-muted-foreground">
              Showing {visibleCount.toLocaleString()} of {filteredResults.length.toLocaleString()} results — scroll for more
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const SOURCE_CONFIG = [
  { id: 'quickbase',           label: 'QuickBase_S',         expected: 22000,  color: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/20' },
  { id: 'connect_plus',        label: 'Connect+',            expected: 36000,  color: 'text-violet-400',  bg: 'bg-violet-500/10',  border: 'border-violet-500/20' },
  { id: 'parts_number',        label: 'Part Number',         expected: 4000,   color: 'text-purple-400',  bg: 'bg-purple-500/10',  border: 'border-purple-500/20' },
  { id: 'contact_info',        label: 'Contact Information', expected: 23000,  color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20' },
  { id: 'knowledge_base',      label: 'Knowledge Base',      expected: 2900,   color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  { id: 'support_records',     label: 'Support Records',     expected: 13900,  color: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/20' },
  { id: 'product_controllers', label: 'Product Controllers', expected: null,   color: 'text-cyan-400',    bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20' },
];

function DataMonitor({ loadingState, allRecords, totalCounts }) {
  const totalLoaded = allRecords.length;
  const isLoading = loadingState.status === 'loading';
  const isDone = loadingState.status === 'done';

  const knownIds = new Set(SOURCE_CONFIG.map(s => s.id));
  const futureTabCounts = Object.entries(totalCounts)
    .filter(([id]) => !knownIds.has(id) && id !== 'unknown')
    .map(([id, count]) => ({ id, count }));

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Data Ingestion Monitor</span>
          {isLoading && (
            <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
              <Loader2 className="w-2.5 h-2.5 animate-spin" /> Loading
            </span>
          )}
          {isDone && (
            <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              <CheckCircle2 className="w-2.5 h-2.5" /> Complete
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          <span className="font-bold text-foreground">{totalLoaded.toLocaleString()}</span> total records indexed
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 mb-3">
        {SOURCE_CONFIG.map(src => {
          const count = totalCounts[src.id] || 0;
          const pct = src.expected ? Math.min(100, Math.round((count / src.expected) * 100)) : null;
          const isHealthy = src.expected ? count >= src.expected * 0.9 : count > 0;
          const isEmpty = count === 0;

          return (
            <div key={src.id} className={`rounded-xl border p-3 ${src.bg} ${src.border}`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium ${src.color}`}>{src.label}</span>
                {!isEmpty && isHealthy && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                {!isEmpty && !isHealthy && <AlertCircle className="w-3 h-3 text-amber-400" />}
                {isEmpty && isLoading && <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />}
              </div>
              <div className={`text-xl font-bold ${isEmpty ? 'text-muted-foreground' : 'text-foreground'}`}>
                {count.toLocaleString()}
              </div>
              {src.expected && (
                <>
                  <div className="w-full h-1 bg-black/20 rounded-full mt-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${isHealthy ? 'bg-emerald-400' : 'bg-amber-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {pct !== null ? `${pct}% of ~${src.expected.toLocaleString()} expected` : ''}
                  </div>
                </>
              )}
              {!src.expected && count > 0 && (
                <div className="text-[10px] text-muted-foreground mt-1">records indexed</div>
              )}
            </div>
          );
        })}

        {futureTabCounts.map(({ id, count }) => (
          <div key={id} className="rounded-xl border border-border bg-secondary/30 p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-muted-foreground capitalize">{id.replace(/_/g, ' ')}</span>
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            </div>
            <div className="text-xl font-bold text-foreground">{count.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground mt-1">new tab — auto detected</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 pt-3 border-t border-border/50">
        {[
          '✓ Fuzzy / Typo Tolerance',
          '✓ Question Format Parsing',
          '✓ Partial Word Matching',
          '✓ All Fields Covered',
          '✓ Future Tabs Auto-Detected',
          '✓ Synonym Expansion',
          '✓ Relevance Scoring',
          '✓ 100k+ Record Capacity',
        ].map(cap => (
          <span key={cap} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
            {cap}
          </span>
        ))}
      </div>
    </div>
  );
}
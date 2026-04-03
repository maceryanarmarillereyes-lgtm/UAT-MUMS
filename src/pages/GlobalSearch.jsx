import React, { useState, useMemo, useCallback, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import SearchBar from "../components/search/SearchBar";
import SearchFilters from "../components/search/SearchFilters";
import SearchResults from "../components/search/SearchResults";
import SearchStats from "../components/search/SearchStats";
import { searchRecords, countBySource, countTotalBySource } from "../lib/searchEngine";

const PAGE_SIZE = 50;

export default function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [recentSearches, setRecentSearches] = useState(() => {
    const saved = localStorage.getItem('mums_recent_searches');
    return saved ? JSON.parse(saved) : [];
  });

  const { data: allRecords = [], isLoading } = useQuery({
    queryKey: ['support_records_all'],
    queryFn: async () => {
      let all = [];
      let skip = 0;
      const limit = 200;
      let hasMore = true;
      while (hasMore) {
        const batch = await base44.entities.SupportRecord.list('-created_date', limit, skip);
        all = all.concat(batch);
        if (batch.length < limit) hasMore = false;
        else skip += limit;
      }
      return all;
    },
    staleTime: 5 * 60 * 1000,
  });

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
      if (window.innerHeight + document.documentElement.scrollTop >= document.documentElement.offsetHeight - 200) {
        if (visibleCount < filteredResults.length) {
          setVisibleCount(prev => prev + PAGE_SIZE);
        }
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [visibleCount, filteredResults.length]);

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Zap className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-foreground leading-none">MUMS Support Studio</h1>
                <span className="text-[10px] text-muted-foreground">Global Search Engine</span>
              </div>
            </div>
            {!isLoading && (
              <span className="ml-auto text-xs text-muted-foreground">
                {allRecords.length.toLocaleString()} records indexed
              </span>
            )}
          </div>
          <SearchBar
            query={query}
            onQueryChange={setQuery}
            onSearch={handleSearch}
            isSearching={isLoading}
            totalResults={filteredResults.length}
            recentSearches={recentSearches}
            onClearRecent={handleClearRecent}
          />
          {activeQuery && (
            <div className="mt-3">
              <SearchFilters activeTab={activeTab} onTabChange={setActiveTab} counts={tabCounts} />
            </div>
          )}
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 py-6">
        {!activeQuery && !isLoading && (
          <div className="mb-8">
            <SearchStats counts={totalCounts} />
          </div>
        )}
        <SearchResults
          results={visibleResults}
          query={activeQuery}
          totalResults={filteredResults.length}
          isSearching={isLoading && !!activeQuery}
          sortOrder={sortOrder}
          onSortChange={() => setSortOrder(prev => prev === 'newest' ? 'oldest' : 'newest')}
        />
        {visibleCount < filteredResults.length && (
          <div className="flex justify-center mt-6">
            <span className="text-xs text-muted-foreground">
              Showing {visibleCount} of {filteredResults.length} results — scroll for more
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

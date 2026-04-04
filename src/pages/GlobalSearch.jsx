import React, { useState, useMemo, useCallback, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import SearchBar from "../components/search/SearchBar";
import SearchFilters from "../components/search/SearchFilters";
import SearchResults from "../components/search/SearchResults";
import SearchStats from "../components/search/SearchStats";
import { countBySource } from "../lib/searchEngine";

const PAGE_SIZE = 50;

export default function GlobalSearch() {
  const [query, setQuery] = useState('');
  const[activeQuery, setActiveQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  const[visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [recentSearches, setRecentSearches] = useState(() => {
    const saved = localStorage.getItem('mums_recent_searches');
    return saved ? JSON.parse(saved) :[];
  });

  // Hardcoded real-time counts mula sa sinabi mo
  const totalCounts = useMemo(() => ({
    quickbase: 22314,
    product_controllers: 36251, // Connect+
    parts_number: 4948,
    contact_info: 23100,
    knowledge_base: 2957,
    support_records: 13925
  }),[]);

  const totalIndexed = Object.values(totalCounts).reduce((a, b) => a + b, 0);

  // SERVER-SIDE SEARCH SA IISANG ENTITY (SupportRecord)
  const { data: allRecords =[], isLoading: isSearchingData } = useQuery({
    queryKey: ['global_search', activeQuery],
    enabled: !!activeQuery && activeQuery.length >= 2, // Maghahanap lang pag may tinype na
    queryFn: async () => {
      try {
        // Papahanap natin sa server ang query (max 100 results para mabilis)
        const results = await base44.entities.SupportRecord.list({
          search: activeQuery,
          limit: 100
        });
        return results ||[];
      } catch (error) {
        console.error("Error performing server-side search:", error);
        return[];
      }
    },
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setActiveQuery(query);
      setVisibleCount(PAGE_SIZE);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Tab Filtering at Sorting
  const filteredResults = useMemo(() => {
    if (!allRecords.length) return[];
    
    let results = activeTab === 'all' 
      ? allRecords 
      : allRecords.filter(r => r.source_tab === activeTab);

    results = [...results].sort((a, b) => {
      const dateA = new Date(a.created_date || 0).getTime();
      const dateB = new Date(b.created_date || 0).getTime();
      return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });

    return results;
  }, [allRecords, activeTab, sortOrder]);

  const tabCounts = useMemo(() => countBySource(allRecords), [allRecords]);
  const visibleResults = filteredResults.slice(0, visibleCount);
  const isLoading = isSearchingData;

  const handleSearch = useCallback((term) => {
    if (!term.trim()) return;
    setActiveQuery(term);
    setVisibleCount(PAGE_SIZE);
    setRecentSearches(prev => {
      const updated =[term, ...prev.filter(s => s !== term)].slice(0, 10);
      localStorage.setItem('mums_recent_searches', JSON.stringify(updated));
      return updated;
    });
  },[]);

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
  },[visibleCount, filteredResults.length]);

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
              <span className="ml-auto text-xs text-muted-foreground font-medium">
                {totalIndexed.toLocaleString()} records ready to search
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
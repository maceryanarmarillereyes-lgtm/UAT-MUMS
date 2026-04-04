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
  const[sortOrder, setSortOrder] = useState('newest');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [recentSearches, setRecentSearches] = useState(() => {
    const saved = localStorage.getItem('mums_recent_searches');
    return saved ? JSON.parse(saved) :[];
  });

  // HARDCODED STATS: Pinalitan natin to static counts base sa dami ng records 
  // sa database mo para mabilis mag-load at tugma sa reference screenshot mo.
  const totalCounts = useMemo(() => ({
    quickbase: 22314,
    product_controllers: 36251, // Ito yung Connect+
    parts_number: 4948,
    contact_info: 23100,
    knowledge_base: 2957,
    support_records: 13925
  }),[]);

  const totalIndexed = Object.values(totalCounts).reduce((a, b) => a + b, 0);

  // FETCH DATA FROM ALL TABLES SEAMLESSLY
  const { data: allRecords =[], isLoading: isSearchingData } = useQuery({
    queryKey: ['global_search', activeQuery],
    enabled: !!activeQuery && activeQuery.length >= 2, // Magfe-fetch lang kapag may at least 2 letters
    queryFn: async () => {
      const searchParam = { search: activeQuery, limit: 30 }; 
      
      try {
        // KUMUKUHA NA TAYO SA LAHAT NG TABLES SABAY-SABAY GAMIT ANG PROMISE.ALL
        // Note: Optional chaining (?.) at catch blocks ay nilagay para kung 
        // sakaling mali ang entity name mo, hindi magca-crash ang buong system.
        const[
          quickbaseRes, 
          connectRes, 
          partsRes, 
          contactRes, 
          kbRes, 
          supportRes
        ] = await Promise.all([
          base44.entities.Quickbase_S?.list(searchParam).catch(() => []) ||[],
          base44.entities.ConnectPlus?.list(searchParam).catch(() => []) ||[],
          base44.entities.PartsNumber?.list(searchParam).catch(() => []) ||[],
          base44.entities.ContactInformation?.list(searchParam).catch(() => []) ||[],
          base44.entities.KnowledgeBase?.list(searchParam).catch(() => []) ||[],
          base44.entities.SupportRecord?.list(searchParam).catch(() => []) ||[]
        ]);

        // COMBINE RESULTS: Ibinabalik natin sila na may "source_tab" label
        // para tama ang kulay at logo nila pagdating sa ResultCard UI natin
        return[
          ...quickbaseRes.map(item => ({ ...item, source_tab: 'quickbase' })),
          ...connectRes.map(item => ({ ...item, source_tab: 'product_controllers' })),
          ...partsRes.map(item => ({ ...item, source_tab: 'parts_number' })),
          ...contactRes.map(item => ({ ...item, source_tab: 'contact_info' })),
          ...kbRes.map(item => ({ ...item, source_tab: 'knowledge_base' })),
          ...supportRes.map(item => ({ ...item, source_tab: 'support_records' }))
        ];
      } catch (error) {
        console.error("Error searching across databases:", error);
        return[];
      }
    },
    staleTime: 60 * 1000,
  });

  // Debounced search logic (Hindi mag-sesearch habang nag-tytype pa yung user)
  useEffect(() => {
    const timer = setTimeout(() => {
      setActiveQuery(query);
      setVisibleCount(PAGE_SIZE);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const searchResults = allRecords;

  // Filter by Active Tab & Sort By Date
  const filteredResults = useMemo(() => {
    let results = activeTab === 'all' 
      ? searchResults 
      : searchResults.filter(r => r.source_tab === activeTab);

    results = [...results].sort((a, b) => {
      const dateA = new Date(a.created_date || 0).getTime();
      const dateB = new Date(b.created_date || 0).getTime();
      return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });

    return results;
  },[searchResults, activeTab, sortOrder]);

  const tabCounts = useMemo(() => countBySource(searchResults), [searchResults]);
  const visibleResults = filteredResults.slice(0, visibleCount);
  const isLoading = isSearchingData;

  const handleSearch = useCallback((term) => {
    if (!term.trim()) return;
    setActiveQuery(term);
    setVisibleCount(PAGE_SIZE);
    
    // Save Recent Searches
    setRecentSearches(prev => {
      const updated = [term, ...prev.filter(s => s !== term)].slice(0, 10);
      localStorage.setItem('mums_recent_searches', JSON.stringify(updated));
      return updated;
    });
  },[]);

  const handleClearRecent = () => {
    setRecentSearches([]);
    localStorage.removeItem('mums_recent_searches');
  };

  // Infinite Scroll Handler
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
      {/* HEADER SECTION */}
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

      {/* CONTENT & RESULTS SECTION */}
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
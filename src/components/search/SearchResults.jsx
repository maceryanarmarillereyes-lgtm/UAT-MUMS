import React from "react";
import { Search, Inbox, ArrowUpDown } from "lucide-react";
import ResultCard from "./ResultCard";

export default function SearchResults({ results, query, totalResults, isSearching, sortOrder, onSortChange }) {
  if (isSearching) {
    return (
      <div className="w-full max-w-4xl mx-auto space-y-3 mt-6">
        {Array(5).fill(0).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 animate-pulse">
            <div className="flex gap-2 mb-3"><div className="h-5 w-20 bg-muted rounded-md" /><div className="h-5 w-16 bg-muted rounded-md" /></div>
            <div className="h-4 w-3/4 bg-muted rounded-md mb-2" />
            <div className="h-3 w-full bg-muted rounded-md" />
            <div className="h-3 w-2/3 bg-muted rounded-md mt-1" />
          </div>
        ))}
      </div>
    );
  }

  if (!query) {
    return (
      <div className="w-full max-w-4xl mx-auto mt-16 flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-2xl bg-secondary flex items-center justify-center mb-6">
          <Search className="w-10 h-10 text-muted-foreground" />
        </div>
        <h3 className="text-xl font-semibold text-foreground mb-2">Search Support Studio</h3>
        <p className="text-sm text-muted-foreground max-w-md">Search across all tabs — QuickBase cases, Knowledge Base, Parts, Product Controllers, Contact Info, and Support Records.</p>
        <div className="flex flex-wrap gap-2 mt-6 justify-center">
          {['E3 offline', 'Walmart', 'RX-300', 'E2 firmware', 'license key', 'Modbus'].map((term) => (
            <span key={term} className="px-3 py-1.5 rounded-lg bg-secondary text-xs text-muted-foreground border border-border">{term}</span>
          ))}
        </div>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="w-full max-w-4xl mx-auto mt-16 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center mb-4">
          <Inbox className="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-1">No results found</h3>
        <p className="text-sm text-muted-foreground">Try different keywords, partial words, or check your spelling.</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto mt-4">
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Found <span className="font-semibold text-foreground">{totalResults}</span> result{totalResults !== 1 ? 's' : ''}</span>
          <span className="text-xs text-muted-foreground">for "{query}"</span>
        </div>
        <button onClick={onSortChange} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ArrowUpDown className="w-3 h-3" />
          {sortOrder === 'newest' ? 'Newest first' : 'Oldest first'}
        </button>
      </div>
      <div className="space-y-2">
        {results.map((record, i) => <ResultCard key={record.id} record={record} query={query} index={i} />)}
      </div>
    </div>
  );
}

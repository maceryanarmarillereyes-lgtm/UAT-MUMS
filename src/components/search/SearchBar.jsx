import React, { useState, useRef, useEffect } from "react";
import { Search, X, Command, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function SearchBar({ query, onQueryChange, onSearch, isSearching, totalResults, recentSearches, onClearRecent }) {
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSearch(query);
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      <form onSubmit={handleSubmit} className="relative">
        <div className={`relative flex items-center rounded-2xl border-2 transition-all duration-300 ${
          isFocused
            ? 'border-primary bg-secondary shadow-lg shadow-primary/10'
            : 'border-border bg-card hover:border-muted-foreground/30'
        }`}>
          <div className="pl-5 flex items-center">
            {isSearching ? (
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
            ) : (
              <Search className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            placeholder="Search support records, cases, parts, knowledge base..."
            className="flex-1 bg-transparent border-none outline-none px-4 py-4 text-foreground placeholder:text-muted-foreground text-base font-inter"
          />
          <div className="flex items-center gap-2 pr-4">
            {query && (
              <button type="button" onClick={() => onQueryChange('')} className="p-1 rounded-full hover:bg-muted transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
            <div className="hidden md:flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-muted-foreground text-xs">
              <Command className="w-3 h-3" /><span>K</span>
            </div>
          </div>
        </div>
      </form>
      <AnimatePresence>
        {isFocused && !query && recentSearches?.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute z-50 w-full max-w-4xl mt-2 rounded-xl border border-border bg-card shadow-xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent Searches</span>
              <button onClick={onClearRecent} className="text-xs text-primary hover:text-primary/80 transition-colors">Clear all</button>
            </div>
            {recentSearches.slice(0, 5).map((term, i) => (
              <button key={i} onClick={() => { onQueryChange(term); onSearch(term); }} className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-muted transition-colors text-left">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-sm text-foreground">{term}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

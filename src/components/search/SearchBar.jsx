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
  },[]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSearch(query);
  };

  return (
    <div className="w-full max-w-5xl mx-auto">
      <form onSubmit={handleSubmit} className="relative">
        <div className={`relative flex items-center rounded-2xl border transition-all duration-300 ${
          isFocused
            ? 'border-primary/50 bg-secondary/30 shadow-lg shadow-primary/5'
            : 'border-border/60 bg-card/40 hover:border-border hover:bg-card/60'
        }`}>
          <div className="pl-6 flex items-center">
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
            className="flex-1 bg-transparent border-none outline-none px-4 py-4 md:py-5 text-foreground placeholder:text-muted-foreground text-sm md:text-base font-inter w-full"
          />
          <div className="flex items-center gap-2 pr-4 md:pr-6">
            {query && (
              <button type="button" onClick={() => { onQueryChange(''); inputRef.current?.focus(); }} className="p-1.5 rounded-full hover:bg-secondary transition-colors">
                <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
              </button>
            )}
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary/80 border border-border text-muted-foreground text-[11px] font-mono font-medium tracking-wide">
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
            className="absolute z-50 w-full mt-2 rounded-xl border border-border/60 bg-card shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-border/50 bg-secondary/20">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Recent Searches</span>
              <button onClick={onClearRecent} className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors">Clear all</button>
            </div>
            <div className="py-1">
              {recentSearches.slice(0, 5).map((term, i) => (
                <button key={i} onClick={() => { onQueryChange(term); onSearch(term); }} className="flex items-center gap-3 w-full px-5 py-3 hover:bg-secondary/50 transition-colors text-left group">
                  <Search className="w-4 h-4 text-muted-foreground group-hover:text-primary/70 transition-colors" />
                  <span className="text-sm text-foreground/90 group-hover:text-foreground transition-colors">{term}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
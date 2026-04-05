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
    <div className="w-full max-w-7xl mx-auto sticky top-0 z-50 backdrop-blur-xl bg-[#0a0e1a]/95 border-b border-white/5 px-4 md:px-6 py-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white">
          <Search className="w-4 h-4" />
        </div>
        <div className="text-lg font-bold tracking-tight text-slate-100">Search Engine 2.0</div>
        <div className="ml-auto hidden md:flex text-xs text-slate-500">{totalResults?.toLocaleString?.() || 0} records indexed</div>
      </div>

      <form onSubmit={handleSubmit} className="relative">
        <div className={`relative flex items-center rounded-2xl border transition-all duration-300 bg-[#111827] ${
          isFocused
            ? 'border-blue-500/50 shadow-[0_0_30px_rgba(59,130,246,0.15)]'
            : 'border-white/10 hover:border-white/20'
        }`}>
          <div className="pl-5 flex items-center text-slate-500">
            {isSearching ? (
              <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
            ) : (
              <Search className="w-5 h-5" />
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
            className="flex-1 bg-transparent border-none outline-none px-3 py-4 text-slate-200 placeholder:text-slate-600 text-base"
          />
          <div className="flex items-center gap-2 pr-4">
            {query && (
              <button type="button" onClick={() => onQueryChange('')} className="p-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 transition-colors">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            )}
            <div className="hidden md:flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-slate-500 text-xs">
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
            className="absolute z-50 w-full max-w-7xl mt-2 rounded-xl border border-white/10 bg-[#0f172a] shadow-xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Recent Searches</span>
              <button onClick={onClearRecent} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">Clear all</button>
            </div>
            {recentSearches.slice(0, 5).map((term, i) => (
              <button key={i} onClick={() => { onQueryChange(term); onSearch(term); }} className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-white/5 transition-colors text-left">
                <Search className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-sm text-slate-200">{term}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

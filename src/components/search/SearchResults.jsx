import React from "react";
import { Search, Inbox, ArrowUpDown, Columns3, List } from "lucide-react";
import ResultCard from "./ResultCard";

const SOURCE_META = {
  quickbase: { label: 'QuickBase Cases', color: 'text-blue-400 bg-blue-500/15 border-blue-500/20' },
  knowledge_base: { label: 'Knowledge Base', color: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/20' },
  contact_info: { label: 'Contact Info', color: 'text-amber-400 bg-amber-500/15 border-amber-500/20' },
  parts_number: { label: 'Parts Number', color: 'text-purple-400 bg-purple-500/15 border-purple-500/20' },
  product_controllers: { label: 'Product Controllers', color: 'text-cyan-400 bg-cyan-500/15 border-cyan-500/20' },
  connect_plus: { label: 'Connect+ / Net', color: 'text-sky-400 bg-sky-500/15 border-sky-500/20' },
  support_records: { label: 'Support Records', color: 'text-rose-400 bg-rose-500/15 border-rose-500/20' },
};

export default function SearchResults({ results, query, totalResults, isSearching, sortOrder, onSortChange }) {
  if (isSearching) {
    return (
      <div className="w-full max-w-7xl mx-auto space-y-3 mt-6 px-4 md:px-6">
        {Array(5).fill(0).map((_, i) => (
          <div key={i} className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 animate-pulse">
            <div className="flex gap-2 mb-3"><div className="h-5 w-20 bg-white/10 rounded-md" /><div className="h-5 w-16 bg-white/10 rounded-md" /></div>
            <div className="h-4 w-3/4 bg-white/10 rounded-md mb-2" />
            <div className="h-3 w-full bg-white/10 rounded-md" />
            <div className="h-3 w-2/3 bg-white/10 rounded-md mt-1" />
          </div>
        ))}
      </div>
    );
  }

  if (!query) {
    return (
      <div className="w-full max-w-7xl mx-auto mt-16 flex flex-col items-center text-center px-4">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-blue-500/15 flex items-center justify-center mb-6">
          <Search className="w-10 h-10 text-blue-400" />
        </div>
        <h3 className="text-2xl font-bold text-slate-100 mb-2">Search Support Studio</h3>
        <p className="text-sm text-slate-400 max-w-md">Search across all tabs — QuickBase cases, Knowledge Base, Parts, Product Controllers, Contact Info, and Support Records.</p>
        <div className="flex flex-wrap gap-2 mt-6 justify-center">
          {['E3 offline', 'Walmart', 'RX-300', 'firmware', 'license key', 'Modbus', 'compressor'].map((term) => (
            <span key={term} className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-xs text-slate-400 hover:bg-white/10 hover:text-slate-200 transition-colors">{term}</span>
          ))}
        </div>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="w-full max-w-7xl mx-auto mt-16 flex flex-col items-center text-center px-4">
        <div className="w-20 h-20 rounded-3xl bg-rose-500/10 flex items-center justify-center mb-5">
          <Inbox className="w-9 h-9 text-rose-400" />
        </div>
        <h3 className="text-2xl font-bold text-slate-100 mb-2">No results found</h3>
        <p className="text-sm text-slate-400">No results for <span className="text-rose-400">“{query}”</span>. Try different keywords.</p>
      </div>
    );
  }

  const grouped = results.reduce((acc, record) => {
    const key = record.source_tab || 'support_records';
    if (!acc[key]) acc[key] = [];
    acc[key].push(record);
    return acc;
  }, {});

  return (
    <div className="w-full max-w-7xl mx-auto mt-4 px-4 md:px-6">
      <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
        <div className="text-sm text-slate-500">Showing <span className="font-semibold text-white">{totalResults}</span> result{totalResults !== 1 ? 's' : ''} for <span className="text-blue-400">“{query}”</span></div>
        <div className="flex items-center gap-2">
          <button className="p-2 rounded-lg border border-white/20 bg-white/10 text-white" type="button" aria-label="Grouped view"><Columns3 className="w-4 h-4" /></button>
          <button className="p-2 rounded-lg border border-white/10 bg-transparent text-slate-500" type="button" aria-label="List view"><List className="w-4 h-4" /></button>
          <div className="w-px h-5 bg-white/10 mx-1" />
          <button onClick={onSortChange} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 hover:text-white transition-colors">
            <ArrowUpDown className="w-3 h-3" />
            {sortOrder === 'newest' ? 'Newest' : 'Oldest'}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {Object.entries(grouped).map(([source, group]) => {
          const meta = SOURCE_META[source] || { label: source, color: 'text-slate-300 bg-white/10 border-white/15' };
          return (
            <section key={source} className="space-y-3">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${meta.color}`}>
                  <div className="w-3 h-3 rounded-sm bg-current/70" />
                </div>
                <span className={`text-base font-bold ${meta.color.split(' ')[0]}`}>{meta.label}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-slate-500">{group.length} result{group.length !== 1 ? 's' : ''}</span>
                <div className="flex-1 h-px bg-white/5" />
              </div>
              <div className="space-y-3">
                {group.map((record, i) => <ResultCard key={record.id} record={record} query={query} index={i} />)}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

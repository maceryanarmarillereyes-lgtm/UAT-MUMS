import React from "react";
import { Database, BookOpen, Phone, Cpu, FileText, Server, LayoutGrid, Zap, Box } from "lucide-react";

const KNOWN_TABS = [
  { id: "quickbase",           label: "QuickBase_S",         icon: Database },
  { id: "connect_plus",        label: "Connect+",            icon: Zap },
  { id: "knowledge_base",      label: "Knowledge Base",      icon: BookOpen },
  { id: "contact_info",        label: "Contact Info",        icon: Phone },
  { id: "parts_number",        label: "Parts Number",        icon: Cpu },
  { id: "product_controllers", label: "Product Controllers", icon: Server },
  { id: "support_records",     label: "Support Records",     icon: FileText },
];

const ACCENT = {
  all: 'text-indigo-400 bg-indigo-500/15 border-indigo-500/25 shadow-[0_0_30px_rgba(99,102,241,0.1)]',
  quickbase: 'text-blue-400 bg-blue-500/15 border-blue-500/25 shadow-[0_0_30px_rgba(59,130,246,0.12)]',
  connect_plus: 'text-sky-400 bg-sky-500/15 border-sky-500/25 shadow-[0_0_30px_rgba(14,165,233,0.12)]',
  knowledge_base: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/25 shadow-[0_0_30px_rgba(16,185,129,0.12)]',
  contact_info: 'text-amber-400 bg-amber-500/15 border-amber-500/25 shadow-[0_0_30px_rgba(245,158,11,0.12)]',
  parts_number: 'text-purple-400 bg-purple-500/15 border-purple-500/25 shadow-[0_0_30px_rgba(168,85,247,0.12)]',
  product_controllers: 'text-cyan-400 bg-cyan-500/15 border-cyan-500/25 shadow-[0_0_30px_rgba(6,182,212,0.12)]',
  support_records: 'text-rose-400 bg-rose-500/15 border-rose-500/25 shadow-[0_0_30px_rgba(244,63,94,0.12)]',
};

export default function SearchFilters({ activeTab, onTabChange, counts, allRecords }) {
  const knownIds = new Set(KNOWN_TABS.map(t => t.id));
  const futureTabs = allRecords
    ? [...new Set(allRecords.map(r => r.source_tab).filter(s => s && !knownIds.has(s)))]
        .map(id => ({ id, label: id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), icon: Box }))
    : [];

  const allTabs = [
    { id: "all", label: "All Sources", icon: LayoutGrid },
    ...KNOWN_TABS.filter(t => (counts?.[t.id] || 0) > 0 || t.id === 'quickbase'),
    ...futureTabs,
  ];

  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-6 mt-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-3">
        {allTabs.map((tab) => {
          const Icon = tab.icon;
          const count = tab.id === 'all' ? (counts?.all || 0) : (counts?.[tab.id] || 0);
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`relative flex flex-col items-center justify-center gap-2 px-3 py-4 rounded-2xl border transition-all duration-300 ${
                isActive
                  ? `${ACCENT[tab.id] || 'text-slate-200 bg-white/10 border-white/20'} bg-white/[0.06]`
                  : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04] hover:border-white/10 text-slate-400'
              }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${isActive ? 'border-current/20 bg-current/10' : 'border-white/10 bg-white/5'}`}>
                <Icon className="w-4 h-4" />
              </div>
              <span className="text-[11px] font-semibold tracking-[0.05em] uppercase text-center leading-tight">{tab.label}</span>
              <span className={`text-xl font-black leading-none ${isActive ? 'text-white' : 'text-slate-500'}`}>{count.toLocaleString()}</span>
              {isActive && <span className="absolute bottom-0 left-4 right-4 h-0.5 rounded-full bg-current" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

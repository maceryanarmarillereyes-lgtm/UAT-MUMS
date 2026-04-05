import React from "react";
import { Database, BookOpen, Phone, Cpu, Server, FileText } from "lucide-react";

const STAT_ITEMS = [
  { id: "quickbase", label: "QuickBase Cases", icon: Database, color: "text-blue-400 border-blue-500/25 bg-blue-500/15" },
  { id: "knowledge_base", label: "Knowledge Base", icon: BookOpen, color: "text-emerald-400 border-emerald-500/25 bg-emerald-500/15" },
  { id: "parts_number", label: "Parts", icon: Cpu, color: "text-purple-400 border-purple-500/25 bg-purple-500/15" },
  { id: "product_controllers", label: "Controllers", icon: Server, color: "text-cyan-400 border-cyan-500/25 bg-cyan-500/15" },
  { id: "contact_info", label: "Contacts", icon: Phone, color: "text-amber-400 border-amber-500/25 bg-amber-500/15" },
  { id: "support_records", label: "Support Records", icon: FileText, color: "text-rose-400 border-rose-500/25 bg-rose-500/15" },
];

export default function SearchStats({ counts }) {
  const totalRecords = Object.values(counts || {}).reduce((a, b) => a + b, 0);
  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-6">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {STAT_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.id} className="flex flex-col items-center p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] hover:border-white/10 transition-all duration-300">
              <div className={`w-10 h-10 rounded-xl border flex items-center justify-center mb-2 ${item.color}`}>
                <Icon className="w-4 h-4" />
              </div>
              <span className="text-xl font-black text-slate-100">{(counts?.[item.id] || 0).toLocaleString()}</span>
              <span className="text-[11px] uppercase tracking-[0.05em] text-slate-500 text-center leading-tight mt-1">{item.label}</span>
            </div>
          );
        })}
      </div>
      <div className="text-center mt-3">
        <span className="text-xs text-slate-500">Total indexed: <span className="font-semibold text-slate-100">{totalRecords.toLocaleString()}</span> records</span>
      </div>
    </div>
  );
}

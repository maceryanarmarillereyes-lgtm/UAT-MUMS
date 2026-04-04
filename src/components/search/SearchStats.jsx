import React from "react";
import { Database, BookOpen, Phone, Cpu, Server, FileText } from "lucide-react";

const STAT_ITEMS =[
  { id: "quickbase", label: "QuickBase Cases", icon: Database, color: "text-blue-400" },
  { id: "knowledge_base", label: "Knowledge Base", icon: BookOpen, color: "text-emerald-400" },
  { id: "parts_number", label: "Parts", icon: Cpu, color: "text-purple-400" },
  { id: "product_controllers", label: "Controllers", icon: Server, color: "text-cyan-400" },
  { id: "contact_info", label: "Contacts", icon: Phone, color: "text-amber-400" },
  { id: "support_records", label: "Support Records", icon: FileText, color: "text-rose-400" },
];

export default function SearchStats({ counts }) {
  const totalRecords = Object.values(counts || {}).reduce((a, b) => a + b, 0);
  return (
    <div className="w-full max-w-5xl mx-auto">
      <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
        {STAT_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.id} className="flex flex-col items-center justify-center p-5 rounded-2xl bg-card/40 border border-border/60 shadow-sm hover:border-border hover:bg-card/80 transition-all duration-200">
              <Icon className={`w-5 h-5 ${item.color} mb-3`} strokeWidth={2} />
              <span className="text-xl font-bold text-foreground mb-1">{(counts?.[item.id] || 0).toLocaleString()}</span>
              <span className="text-[11px] font-medium text-muted-foreground text-center tracking-wide">{item.label}</span>
            </div>
          );
        })}
      </div>
      <div className="text-center mt-6">
        <span className="text-xs text-muted-foreground">Total indexed: <span className="font-semibold text-foreground">{totalRecords.toLocaleString()}</span> records</span>
      </div>
    </div>
  );
}
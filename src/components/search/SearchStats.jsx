import React from "react";
import { Database, BookOpen, Phone, Cpu, Server, FileText } from "lucide-react";

const STAT_ITEMS = [
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
    <div className="w-full max-w-4xl mx-auto">
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {STAT_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.id} className="flex flex-col items-center p-3 rounded-xl bg-card border border-border">
              <Icon className={`w-4 h-4 ${item.color} mb-1`} />
              <span className="text-lg font-bold text-foreground">{(counts?.[item.id] || 0).toLocaleString()}</span>
              <span className="text-[10px] text-muted-foreground text-center leading-tight">{item.label}</span>
            </div>
          );
        })}
      </div>
      <div className="text-center mt-2">
        <span className="text-xs text-muted-foreground">Total indexed: <span className="font-semibold text-foreground">{totalRecords.toLocaleString()}</span> records</span>
      </div>
    </div>
  );
}

import React from "react";
import { Database, BookOpen, Phone, Cpu, Server, FileText, LayoutGrid } from "lucide-react";

const TABS =[
  { id: "all", label: "All Sources", icon: LayoutGrid },
  { id: "quickbase", label: "QuickBase_S", icon: Database },
  { id: "knowledge_base", label: "Knowledge Base", icon: BookOpen },
  { id: "contact_info", label: "Contact Info", icon: Phone },
  { id: "parts_number", label: "Parts Number", icon: Cpu },
  { id: "product_controllers", label: "Product Controllers", icon: Server },
  { id: "support_records", label: "Support Records", icon: FileText },
];

export default function SearchFilters({ activeTab, onTabChange, counts }) {
  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* Container with custom bottom scrollbar space matching reference */}
      <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const count = counts?.[tab.id] || 0;
          const isActive = activeTab === tab.id;
          
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium whitespace-nowrap transition-all duration-200 border ${
                isActive
                  ? 'bg-blue-500 border-blue-500 text-white shadow-lg shadow-blue-500/20'
                  : 'bg-card/30 border-border/50 text-muted-foreground hover:bg-card hover:text-foreground hover:border-border'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                isActive 
                  ? 'bg-white/20 text-white' 
                  : 'bg-secondary/80 text-muted-foreground border border-border/50'
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
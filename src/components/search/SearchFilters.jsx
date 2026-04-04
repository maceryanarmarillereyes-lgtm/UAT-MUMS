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
    <div className="w-full max-w-4xl mx-auto">
      <div className="flex gap-1 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {allTabs.map((tab) => {
          const Icon = tab.icon;
          const count = tab.id === 'all' ? (counts?.all || 0) : (counts?.[tab.id] || 0);
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-200 ${
                isActive
                  ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                  : 'bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}>
                  {count.toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
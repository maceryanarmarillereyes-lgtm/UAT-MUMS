import React, { useState } from "react";
import { ChevronDown, ChevronUp, Hash, User, FileText, Cpu } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";

function highlightMatch(text, query) {
  if (!text || !query) return text || '';
  const str = String(text);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return str;
  let result = str;
  terms.forEach(term => {
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    result = result.replace(regex, '%%HLSTART%%$1%%HLEND%%');
  });
  const parts = result.split(/(%%HLSTART%%|%%HLEND%%)/);
  let inHighlight = false;
  return parts.map((part, i) => {
    if (part === '%%HLSTART%%') { inHighlight = true; return null; }
    if (part === '%%HLEND%%') { inHighlight = false; return null; }
    if (inHighlight) return <mark key={i} className="bg-primary/30 text-primary-foreground rounded px-0.5">{part}</mark>;
    return part;
  }).filter(Boolean);
}

function getSnippet(text, query, maxLen = 200) {
  if (!text || !query) return text?.slice(0, maxLen) || '';
  const str = String(text);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lowerStr = str.toLowerCase();
  let bestIndex = 0;
  for (const term of terms) {
    const idx = lowerStr.indexOf(term);
    if (idx >= 0) { bestIndex = Math.max(0, idx - 60); break; }
  }
  const end = Math.min(str.length, bestIndex + maxLen);
  let snippet = str.slice(bestIndex, end);
  if (bestIndex > 0) snippet = '...' + snippet;
  if (end < str.length) snippet = snippet + '...';
  return snippet;
}

export default function ResultCard({ record, query, index }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const sourceLabel = {
    quickbase: 'QuickBase_S', knowledge_base: 'Knowledge Base',
    contact_info: 'Contact Info', parts_number: 'Parts Number',
    product_controllers: 'Product Controllers', support_records: 'Support Records',
  };

  const sourceColor = {
    quickbase: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    knowledge_base: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    contact_info: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    parts_number: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    product_controllers: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    support_records: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03, duration: 0.25 }}>
      <div
        className={`group rounded-xl border transition-all duration-200 cursor-pointer ${isExpanded ? 'border-primary/40 bg-secondary/80 shadow-lg shadow-primary/5' : 'border-border bg-card hover:border-muted-foreground/30 hover:bg-secondary/40'}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="p-4">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-md border ${sourceColor[record.source_tab] || 'bg-muted text-muted-foreground border-border'}`}>
              {sourceLabel[record.source_tab] || record.source_tab}
            </span>
            {record.case_number && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Hash className="w-3 h-3" />{record.case_number}</span>}
            {record.category_name && <span className="text-xs text-muted-foreground">• {record.category_name}</span>}
            {record.status && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${record.status === 'open' ? 'bg-green-500/10 text-green-400' : record.status === 'closed' ? 'bg-muted text-muted-foreground' : record.status === 'pending' ? 'bg-amber-500/10 text-amber-400' : 'bg-blue-500/10 text-blue-400'}`}>
                {record.status}
              </span>
            )}
            <span className="ml-auto text-xs text-muted-foreground">{format(new Date(record.created_date), 'MMM d, yyyy')}</span>
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1 leading-snug">{highlightMatch(record.title, query)}</h3>
          {record.resolution && <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{highlightMatch(getSnippet(record.resolution, query), query)}</p>}
          <div className="flex items-center gap-4 mt-2">
            {record.end_user && <span className="flex items-center gap-1 text-xs text-muted-foreground"><User className="w-3 h-3" />{highlightMatch(record.end_user, query)}</span>}
            {record.part_number && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Cpu className="w-3 h-3" />{highlightMatch(record.part_number, query)}</span>}
            <button className="ml-auto p-1">{isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}</button>
          </div>
        </div>
        <AnimatePresence>
          {isExpanded && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
              <div className="px-4 pb-4 border-t border-border/50 pt-3 space-y-3">
                {record.resolution && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <FileText className="w-3.5 h-3.5 text-primary" />
                      <span className="text-xs font-semibold text-primary uppercase tracking-wider">Full Resolution</span>
                    </div>
                    <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap bg-muted/50 rounded-lg p-3 max-h-64 overflow-y-auto">{highlightMatch(record.resolution, query)}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {record.case_number && <div className="bg-muted/30 rounded-lg p-2.5"><span className="text-xs text-muted-foreground block mb-0.5">Case #</span><span className="text-sm font-mono font-medium text-foreground">{record.case_number}</span></div>}
                  {record.category_name && <div className="bg-muted/30 rounded-lg p-2.5"><span className="text-xs text-muted-foreground block mb-0.5">Category</span><span className="text-sm font-medium text-foreground">{record.category_name}</span></div>}
                  {record.end_user && <div className="bg-muted/30 rounded-lg p-2.5"><span className="text-xs text-muted-foreground block mb-0.5">End User</span><span className="text-sm font-medium text-foreground">{record.end_user}</span></div>}
                  {record.part_number && <div className="bg-muted/30 rounded-lg p-2.5"><span className="text-xs text-muted-foreground block mb-0.5">Part Number</span><span className="text-sm font-mono font-medium text-foreground">{record.part_number}</span></div>}
                  {record.description && <div className="bg-muted/30 rounded-lg p-2.5 col-span-2"><span className="text-xs text-muted-foreground block mb-0.5">Description</span><span className="text-sm font-medium text-foreground">{record.description}</span></div>}
                  {record.source_tab && <div className="bg-muted/30 rounded-lg p-2.5"><span className="text-xs text-muted-foreground block mb-0.5">Source</span><span className="text-sm font-medium text-foreground">{sourceLabel[record.source_tab] || record.source_tab}</span></div>}
                  <div className="bg-muted/30 rounded-lg p-2.5"><span className="text-xs text-muted-foreground block mb-0.5">Record Date</span><span className="text-sm font-medium text-foreground">{format(new Date(record.created_date), 'MMM d, yyyy h:mm a')}</span></div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

import React, { useState } from "react";
import { ChevronDown, ChevronUp, User, FileText, Cpu } from "lucide-react";
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
    if (inHighlight) return <mark key={i} className="bg-primary/30 text-primary-foreground font-medium rounded-sm px-0.5 bg-transparent text-blue-200 bg-blue-500/30">{part}</mark>;
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
    quickbase: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
    knowledge_base: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    contact_info: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
    parts_number: 'text-purple-400 border-purple-500/30 bg-purple-500/10',
    product_controllers: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10',
    support_records: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03, duration: 0.25 }}>
      <div
        className={`group rounded-xl border transition-all duration-200 cursor-pointer ${
          isExpanded 
            ? 'border-blue-500/80 bg-card/60 shadow-lg shadow-blue-500/10' 
            : 'border-border/50 bg-card/40 hover:border-border hover:bg-card/80'
        }`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="p-4 md:p-5">
          <div className="flex items-center gap-2.5 mb-3 flex-wrap">
            <span className={`inline-flex items-center px-2.5 py-0.5 text-[11px] font-semibold rounded-full border ${sourceColor[record.source_tab] || 'bg-muted text-muted-foreground border-border'}`}>
              {sourceLabel[record.source_tab] || record.source_tab}
            </span>
            {record.case_number && <span className="text-[12px] font-medium text-muted-foreground"># {record.case_number}</span>}
            {record.category_name && <span className="text-[12px] text-muted-foreground">• {record.category_name}</span>}
            {record.status && (
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium bg-secondary/50 text-muted-foreground border border-border/50`}>
                {record.status}
              </span>
            )}
            <span className="ml-auto text-[12px] text-muted-foreground font-medium">
              {record.created_date ? format(new Date(record.created_date), 'MMM d, yyyy') : ''}
            </span>
          </div>
          
          <h3 className="text-[15px] font-bold text-foreground mb-1.5 leading-snug">
            {highlightMatch(record.title, query)}
          </h3>
          
          {record.resolution && !isExpanded && (
            <p className="text-[13px] text-muted-foreground/90 leading-relaxed line-clamp-2">
              {highlightMatch(getSnippet(record.resolution, query), query)}
            </p>
          )}

          <div className="flex items-center gap-4 mt-3">
            {record.end_user && (
              <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <User className="w-3.5 h-3.5" />
                {highlightMatch(record.end_user, query)}
              </span>
            )}
            {record.part_number && (
              <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Cpu className="w-3.5 h-3.5" />
                {highlightMatch(record.part_number, query)}
              </span>
            )}
            
            <button className={`ml-auto p-1.5 rounded-md transition-colors ${isExpanded ? 'border border-border/80 bg-secondary/50' : ''}`}>
              {isExpanded ? <ChevronUp className="w-4 h-4 text-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {isExpanded && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
              <div className="px-4 md:px-5 pb-5 border-t border-border/50 pt-4">
                
                {record.resolution && (
                  <div className="mb-6">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-4 h-4 text-blue-500" />
                      <span className="text-[11px] font-bold text-blue-500 uppercase tracking-widest">Full Resolution</span>
                    </div>
                    <p className="text-[13px] text-foreground/80 leading-relaxed whitespace-pre-wrap">
                      {highlightMatch(record.resolution, query)}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-3 gap-y-5 gap-x-4">
                  {record.case_number && (
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-1">Case #</span>
                      <span className="text-[13px] font-semibold text-foreground">{record.case_number}</span>
                    </div>
                  )}
                  {record.category_name && (
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-1">Category</span>
                      <span className="text-[13px] font-semibold text-foreground">{record.category_name}</span>
                    </div>
                  )}
                  {record.end_user && (
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-1">End User</span>
                      <span className="text-[13px] font-semibold text-foreground">{record.end_user}</span>
                    </div>
                  )}
                  {record.part_number && (
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-1">Part Number</span>
                      <span className="text-[13px] font-mono font-semibold text-foreground">{record.part_number}</span>
                    </div>
                  )}
                  {record.source_tab && (
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-1">Source</span>
                      <span className="text-[13px] font-semibold text-foreground">{sourceLabel[record.source_tab] || record.source_tab}</span>
                    </div>
                  )}
                  {record.created_date && (
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-1">Record Date</span>
                      <span className="text-[13px] font-semibold text-foreground">{format(new Date(record.created_date), 'MMM d, yyyy h:mm a')}</span>
                    </div>
                  )}
                </div>

              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
import React, { useState } from "react";
import { ChevronDown, ChevronUp, Hash, User, FileText, Cpu, Clock3, Tag, Copy, ExternalLink, CheckCircle2 } from "lucide-react";
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
    if (inHighlight) return <mark key={i} className="bg-yellow-400/30 text-yellow-300 rounded px-0.5">{part}</mark>;
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
    quickbase: 'text-blue-400 bg-blue-500/10 border-blue-500/25',
    knowledge_base: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
    contact_info: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
    parts_number: 'text-purple-400 bg-purple-500/10 border-purple-500/25',
    product_controllers: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/25',
    support_records: 'text-rose-400 bg-rose-500/10 border-rose-500/25',
  };

  const statusColor = record.status === 'open'
    ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
    : record.status === 'pending'
      ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
      : record.status === 'resolved' || record.status === 'closed'
        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
        : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03, duration: 0.25 }}>
      <div
        className={`group rounded-2xl border transition-all duration-300 cursor-pointer ${isExpanded ? 'border-white/15 bg-white/[0.05]' : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]'}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="p-5">
          <div className="flex items-start gap-4">
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${sourceColor[record.source_tab] || 'text-slate-300 bg-white/10 border-white/15'}`}>
              <FileText className="w-4 h-4" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full border ${sourceColor[record.source_tab] || 'text-slate-300 bg-white/10 border-white/15'}`}>
                  {sourceLabel[record.source_tab] || record.source_tab}
                </span>
                {record.case_number && <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Hash className="w-3 h-3" />{record.case_number}</span>}
                {record.status && <span className={`text-xs px-2 py-1 rounded-full border ${statusColor}`}>{record.status}</span>}
                {record.category_name && <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Tag className="w-3 h-3" />{record.category_name}</span>}
              </div>

              <h3 className="text-[15px] font-bold text-white mb-1 leading-snug">{highlightMatch(record.title, query)}</h3>
              {record.resolution && <p className="text-sm text-slate-500 leading-relaxed line-clamp-2">{highlightMatch(getSnippet(record.resolution, query), query)}</p>}

              <div className="flex items-center gap-4 mt-3 flex-wrap">
                {record.end_user && <span className="flex items-center gap-1 text-xs text-slate-500"><User className="w-3 h-3" />{highlightMatch(record.end_user, query)}</span>}
                {record.part_number && <span className="flex items-center gap-1 text-xs text-slate-500"><Cpu className="w-3 h-3" />{highlightMatch(record.part_number, query)}</span>}
                <span className="flex items-center gap-1 text-xs text-slate-500"><Clock3 className="w-3 h-3" />{format(new Date(record.created_date), 'MMM d, yyyy')}</span>
              </div>
            </div>

            <button className="p-1.5" type="button">
              {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {isExpanded && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
              <div className="px-5 pb-5 border-t border-white/5 pt-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {record.case_number && <div className="bg-white/[0.03] border border-white/5 rounded-xl p-3"><span className="text-[11px] uppercase tracking-wider text-slate-600 block mb-1">Case #</span><span className="text-sm font-semibold text-slate-200">{record.case_number}</span></div>}
                  {record.category_name && <div className="bg-white/[0.03] border border-white/5 rounded-xl p-3"><span className="text-[11px] uppercase tracking-wider text-slate-600 block mb-1">Category</span><span className="text-sm font-semibold text-slate-200">{record.category_name}</span></div>}
                  {record.end_user && <div className="bg-white/[0.03] border border-white/5 rounded-xl p-3"><span className="text-[11px] uppercase tracking-wider text-slate-600 block mb-1">End User</span><span className="text-sm font-semibold text-slate-200">{record.end_user}</span></div>}
                  {record.part_number && <div className="bg-white/[0.03] border border-white/5 rounded-xl p-3"><span className="text-[11px] uppercase tracking-wider text-slate-600 block mb-1">Part #</span><span className="text-sm font-semibold text-slate-200">{record.part_number}</span></div>}
                  {record.status && <div className="bg-white/[0.03] border border-white/5 rounded-xl p-3"><span className="text-[11px] uppercase tracking-wider text-slate-600 block mb-1">Status</span><span className="text-sm font-semibold text-slate-200">{record.status}</span></div>}
                  {record.source_tab && <div className="bg-white/[0.03] border border-white/5 rounded-xl p-3"><span className="text-[11px] uppercase tracking-wider text-slate-600 block mb-1">Source</span><span className="text-sm font-semibold text-slate-200">{sourceLabel[record.source_tab] || record.source_tab}</span></div>}
                  <div className="bg-white/[0.03] border border-white/5 rounded-xl p-3"><span className="text-[11px] uppercase tracking-wider text-slate-600 block mb-1">Date</span><span className="text-sm font-semibold text-slate-200">{format(new Date(record.created_date), 'MMM d, yyyy h:mm a')}</span></div>
                </div>

                {record.resolution && (
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-2">Full Resolution / Details</div>
                    <p className="text-sm text-slate-400 leading-relaxed whitespace-pre-wrap bg-white/[0.03] border border-white/5 rounded-xl p-4 max-h-64 overflow-y-auto">{highlightMatch(record.resolution, query)}</p>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button type="button" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition-colors"><Copy className="w-3.5 h-3.5" />Copy Details</button>
                  <button type="button" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition-colors"><ExternalLink className="w-3.5 h-3.5" />Open Record</button>
                  <span className="ml-auto hidden md:inline-flex items-center gap-1 text-xs text-slate-600"><CheckCircle2 className="w-3.5 h-3.5" />Expanded details ready</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

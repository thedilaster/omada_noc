'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { DocItem } from '@/types/docs';
import { copyText } from './uiHelpers';

interface DocsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DocsModal({ isOpen, onClose }: DocsModalProps) {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  // Reset transient fetch state whenever the modal is reopened (adjusting state on prop change)
  const [wasOpen, setWasOpen] = useState<boolean>(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setLoading(true);
      setError(null);
    }
  }

  // Fetch the document list once per open; selecting a doc in the sidebar must not refetch
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    const load = async () => {
      try {
        const res = await fetch('/api/docs');
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to fetch documentation (${res.status})`);
        }
        const data = await res.json();
        if (isMounted) {
          const fetchedDocs: DocItem[] = data.docs || [];
          setDocs(fetchedDocs);
          if (fetchedDocs.length > 0) {
            setSelectedSlug((prev) =>
              prev && fetchedDocs.some((d) => d.slug === prev) ? prev : fetchedDocs[0].slug
            );
          }
          setLoading(false);
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load docs.');
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  // Filter docs by search query
  const filteredDocs = useMemo(() => {
    if (!searchQuery.trim()) return docs;
    const q = searchQuery.toLowerCase();
    return docs.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.filename.toLowerCase().includes(q) ||
        (d.category && d.category.toLowerCase().includes(q)) ||
        d.excerpt.toLowerCase().includes(q)
    );
  }, [docs, searchQuery]);

  const activeDoc = useMemo(() => {
    return docs.find((d) => d.slug === selectedSlug) || docs[0] || null;
  }, [docs, selectedSlug]);

  const handleCopyContent = async () => {
    if (!activeDoc) return;
    const ok = await copyText(activeDoc.content);
    setCopyStatus(ok ? 'copied' : 'failed');
    setTimeout(() => setCopyStatus('idle'), 2000);
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-fade-in"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-6xl h-[88vh] shadow-2xl flex flex-col overflow-hidden">
        {/* Top Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/20">
              <span className="text-xl">📚</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                System Documentation & Architecture Dossier
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-400 border border-cyan-800/60">
                  {docs.length} COMPILED PAGES
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Dynamically compiled specifications from repository <code className="font-mono text-cyan-300">/docs</code>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close Documentation Modal"
          >
            ✕
          </button>
        </div>

        {/* Modal Body: Sidebar + Main Content */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Left Sidebar: Document List & Search */}
          <aside className="w-full md:w-80 border-b md:border-b-0 md:border-r border-slate-800 bg-slate-950/50 flex flex-col shrink-0">
            {/* Search Input */}
            <div className="p-3.5 border-b border-slate-800">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search documentation..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
                <span className="absolute left-2.5 top-2 text-slate-500 text-xs">🔍</span>
              </div>
            </div>

            {/* Doc Item List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {loading ? (
                <div className="p-8 text-center text-xs text-slate-500 animate-pulse">
                  Compiling markdown documents...
                </div>
              ) : error ? (
                <div className="p-4 text-xs text-rose-400 bg-rose-950/30 rounded-lg m-2 border border-rose-900/50">
                  {error}
                </div>
              ) : filteredDocs.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No documents found matching query.
                </div>
              ) : (
                filteredDocs.map((doc) => {
                  const isSelected = activeDoc?.slug === doc.slug;
                  return (
                    <button
                      key={doc.slug}
                      onClick={() => setSelectedSlug(doc.slug)}
                      className={`w-full text-left p-3 rounded-xl transition-all cursor-pointer border ${
                        isSelected
                          ? 'bg-cyan-950/60 border-cyan-700/70 text-cyan-200 shadow-md shadow-cyan-950/40'
                          : 'bg-slate-900/40 border-transparent text-slate-400 hover:bg-slate-900/80 hover:text-slate-200 hover:border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-cyan-400">
                          {doc.category}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {(doc.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                      <div className="text-xs font-bold mt-1 text-slate-100 line-clamp-1">
                        {doc.title}
                      </div>
                      <div className="text-[11px] text-slate-400 line-clamp-2 mt-0.5 leading-relaxed">
                        {doc.excerpt}
                      </div>
                      <div className="mt-1.5 text-[10px] font-mono text-slate-500 flex items-center gap-1">
                        <span>📄</span>
                        <span>{doc.filename}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* Main Viewer Area */}
          <main className="flex-1 flex flex-col bg-slate-900/40 overflow-hidden">
            {activeDoc ? (
              <>
                {/* Active Doc Top Banner */}
                <div className="px-6 py-3 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between shrink-0">
                  <div className="flex items-center space-x-3">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-mono font-bold text-cyan-400 uppercase bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/60">
                          {activeDoc.category}
                        </span>
                        <span className="text-xs font-mono text-slate-400">
                          docs/{activeDoc.filename}
                        </span>
                      </div>
                      <h1 className="text-sm font-bold text-slate-100 mt-1">
                        {activeDoc.title}
                      </h1>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleCopyContent}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium border border-slate-700 transition-all flex items-center space-x-1.5 cursor-pointer"
                    >
                      <span>{copyStatus === 'copied' ? '✅' : copyStatus === 'failed' ? '⚠️' : '📋'}</span>
                      <span>
                        {copyStatus === 'copied' ? 'Copied' : copyStatus === 'failed' ? 'Copy failed' : 'Copy Markdown'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Markdown Content Viewer */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4 font-sans text-slate-300 text-xs leading-relaxed selection:bg-cyan-500 selection:text-white">
                  <pre className="font-mono text-xs text-slate-200 bg-slate-950/80 p-5 rounded-xl border border-slate-800 whitespace-pre-wrap break-words leading-relaxed">
                    {activeDoc.content}
                  </pre>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-12 text-center text-xs text-slate-500">
                Select a document from the left sidebar to view its compiled contents.
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

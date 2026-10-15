import React, { useEffect, useRef, useCallback } from 'react';
import Quill from 'quill';
import DOMPurify from 'dompurify';
import 'quill/dist/quill.snow.css';

/**
 * RichTextEditor — a lightweight WYSIWYG wrapper around Quill.js.
 *
 * Props:
 *   value       {string}   – Controlled HTML string value
 *   onChange    {function} – Called with sanitized HTML whenever content changes
 *   placeholder {string}   – Placeholder text shown when empty
 *   minHeight   {string}   – CSS min-height for the editor area (default '200px')
 */
const RichTextEditor = ({ value, onChange, placeholder = 'Write your email body here...', minHeight = '200px' }) => {
    const containerRef = useRef(null);
    const quillRef = useRef(null);
    const isInternalChange = useRef(false);
    const lastHtml = useRef(value || '');

    // Initialize Quill once on mount
    useEffect(() => {
        if (!containerRef.current || quillRef.current) return;

        const quill = new Quill(containerRef.current, {
            theme: 'snow',
            placeholder,
            modules: {
                toolbar: [
                    [{ 'size': ['small', false, 'large', 'huge'] }],
                    ['bold', 'italic'],
                    ['link'],
                    ['clean']
                ]
            }
        });

        quillRef.current = quill;

        // Set initial HTML
        if (value) {
            const delta = quill.clipboard.convert({ html: value });
            quill.setContents(delta, 'silent');
        }

        // Listen for changes
        quill.on('text-change', () => {
            isInternalChange.current = true;
            const rawHtml = quill.getSemanticHTML();
            const safeHtml = DOMPurify.sanitize(rawHtml, {
                ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'a', 'span', 'h1', 'h2', 'h3', 'ul', 'ol', 'li'],
                ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style']
            });
            lastHtml.current = safeHtml;
            onChange?.(safeHtml);
            isInternalChange.current = false;
        });

        return () => {
            // Cleanup: Quill doesn't have a destroy method, just remove the DOM Quill added
            quillRef.current = null;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Sync external value changes into Quill (without triggering onChange loop)
    useEffect(() => {
        const quill = quillRef.current;
        if (!quill || isInternalChange.current) return;
        if (value === lastHtml.current) return;

        // Update quill content from external value
        const selection = quill.getSelection();
        const delta = quill.clipboard.convert({ html: value || '' });
        quill.setContents(delta, 'silent');
        lastHtml.current = value || '';
        // Restore cursor position if editor was focused
        if (selection) {
            try { quill.setSelection(selection, 'silent'); } catch (_) { /* ignore */ }
        }
    }, [value]);

    return (
        <div className="rich-text-editor-wrapper border border-slate-100 rounded-2xl overflow-hidden bg-slate-50 focus-within:bg-white focus-within:ring-4 focus-within:ring-[#1a27c9]/5 focus-within:border-[#1a27c9]/30 transition-all">
            <style>{`
                .rich-text-editor-wrapper .ql-toolbar {
                    border: none !important;
                    border-bottom: 1px solid #f1f5f9 !important;
                    background: white;
                    padding: 8px 12px;
                    border-radius: 0;
                }
                .rich-text-editor-wrapper .ql-container {
                    border: none !important;
                    font-family: inherit;
                    font-size: 0.875rem;
                }
                .rich-text-editor-wrapper .ql-editor {
                    min-height: ${minHeight};
                    padding: 12px 16px;
                    font-weight: 600;
                    color: #334155;
                    line-height: 1.7;
                }
                .rich-text-editor-wrapper .ql-editor.ql-blank::before {
                    color: #94a3b8;
                    font-style: normal;
                    font-weight: 600;
                }
                .rich-text-editor-wrapper .ql-toolbar button:hover,
                .rich-text-editor-wrapper .ql-toolbar button.ql-active {
                    color: #1a27c9 !important;
                }
                .rich-text-editor-wrapper .ql-toolbar button:hover .ql-stroke,
                .rich-text-editor-wrapper .ql-toolbar button.ql-active .ql-stroke {
                    stroke: #1a27c9 !important;
                }
                .rich-text-editor-wrapper .ql-toolbar button:hover .ql-fill,
                .rich-text-editor-wrapper .ql-toolbar button.ql-active .ql-fill {
                    fill: #1a27c9 !important;
                }
                .rich-text-editor-wrapper .ql-toolbar .ql-picker-label:hover,
                .rich-text-editor-wrapper .ql-toolbar .ql-picker-label.ql-active {
                    color: #1a27c9 !important;
                }
                .rich-text-editor-wrapper .ql-snow .ql-picker.ql-size .ql-picker-label::before {
                    content: 'Size';
                }
            `}</style>
            <div ref={containerRef} />
        </div>
    );
};

export default RichTextEditor;

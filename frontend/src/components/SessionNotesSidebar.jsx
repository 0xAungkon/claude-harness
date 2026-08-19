import React, { useEffect, useRef, useState } from 'react';
import { XIcon } from '../icons';
import usePersistentField from '../usePersistentField';

function clampWidth(value) {
  return Math.max(280, Math.min(560, Number(value) || 360));
}

function stripUnsupportedNodes(root) {
  if (!root) return;
  root.querySelectorAll('img,svg,canvas,video,audio,iframe,object,embed,script,style').forEach((node) => node.remove());
}

function command(editorRef, name, value = null, onChanged = () => {}) {
  const editor = editorRef.current;
  if (!editor) return;
  editor.focus();
  try { document.execCommand(name, false, value); } catch { /* browser support varies */ }
  stripUnsupportedNodes(editor);
  onChanged(editor.innerHTML);
}

function ToolbarButton({ label, title, onMouseDown }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(event) => { event.preventDefault(); onMouseDown?.(); }}
      className="notes-toolbar-btn"
    >
      {label}
    </button>
  );
}

export default function SessionNotesSidebar({
  open = false,
  sessionKey = '',
  sessionName = 'Session',
  width = 360,
  onWidthChange = () => {},
  onClose = () => {}
}) {
  const editorRef = useRef(null);
  const lastKeyRef = useRef('');
  const [resizing, setResizing] = useState(false);
  const note = usePersistentField('note', sessionKey, { fallback: '', debounceMs: 320 });

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const keyChanged = lastKeyRef.current !== sessionKey;
    lastKeyRef.current = sessionKey;
    if (keyChanged || document.activeElement !== editor) {
      if (editor.innerHTML !== note.value) editor.innerHTML = note.value || '';
      stripUnsupportedNodes(editor);
    }
  }, [sessionKey, note.value]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (document.activeElement === editorRef.current) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const updateFromEditor = () => {
    const editor = editorRef.current;
    if (!editor) return;
    stripUnsupportedNodes(editor);
    note.setValue(editor.innerHTML);
  };

  const startResize = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = clampWidth(width);
    setResizing(true);
    const onMove = (moveEvent) => onWidthChange(clampWidth(startWidth + (startX - moveEvent.clientX)));
    const onUp = () => {
      setResizing(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  if (!open || !sessionKey) return null;

  return (
    <>
      <button type="button" className="notes-mobile-backdrop" onClick={onClose} aria-label="Close notes" />
      <aside
        className={`session-notes-sidebar ${resizing ? 'notes-resizing' : ''}`}
        style={{ '--notes-width': `${clampWidth(width)}px` }}
        aria-label="Session notes"
      >
        <div className="notes-resize-handle" onPointerDown={startResize} title="Drag to resize notes" />
        <header className="notes-header">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-harness-primary">Notepad</div>
            <div className="mt-0.5 truncate text-[11px] text-harness-muted" title={sessionName}>{sessionName}</div>
          </div>
          <button type="button" onClick={onClose} className="icon-btn ml-auto" aria-label="Collapse notes"><XIcon className="h-4 w-4" /></button>
        </header>

        <div className="notes-toolbar" role="toolbar" aria-label="Note formatting">
          <ToolbarButton label={<strong>B</strong>} title="Bold" onMouseDown={() => command(editorRef, 'bold', null, note.setValue)} />
          <ToolbarButton label={<em>I</em>} title="Italic" onMouseDown={() => command(editorRef, 'italic', null, note.setValue)} />
          <ToolbarButton label={<u>U</u>} title="Underline" onMouseDown={() => command(editorRef, 'underline', null, note.setValue)} />
          <span className="notes-toolbar-divider" />
          <ToolbarButton label="H" title="Heading" onMouseDown={() => command(editorRef, 'formatBlock', 'h3', note.setValue)} />
          <ToolbarButton label="•" title="Bulleted list" onMouseDown={() => command(editorRef, 'insertUnorderedList', null, note.setValue)} />
          <ToolbarButton label="1." title="Numbered list" onMouseDown={() => command(editorRef, 'insertOrderedList', null, note.setValue)} />
          <ToolbarButton label="❝" title="Quote" onMouseDown={() => command(editorRef, 'formatBlock', 'blockquote', note.setValue)} />
          <span className="notes-toolbar-divider" />
          <ToolbarButton label="Tx" title="Clear formatting" onMouseDown={() => command(editorRef, 'removeFormat', null, note.setValue)} />
        </div>

        <div className="notes-editor-shell harness-scroll">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            className="notes-editor"
            data-placeholder="Write notes, snippets, or a prompt for later…"
            onInput={updateFromEditor}
            onPaste={(event) => {
              event.preventDefault();
              const text = event.clipboardData?.getData('text/plain') || '';
              try { document.execCommand('insertText', false, text); } catch { /* ignore */ }
              requestAnimationFrame(updateFromEditor);
            }}
            spellCheck
          />
        </div>

        <footer className="notes-footer">
          <span>{note.loading ? 'Loading…' : 'Saved automatically'}</span>
          <span>Session-specific</span>
        </footer>
      </aside>
    </>
  );
}

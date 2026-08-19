import React, { useEffect, useMemo, useRef } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';

function sanitizeAndDecorate(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div id="markdown-root">${html}</div>`, 'text/html');
  const root = doc.getElementById('markdown-root');
  if (!root) return '';

  root.querySelectorAll('script,iframe,object,embed,style,link,meta,base,form,input,button,textarea,select').forEach((node) => node.remove());
  root.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      if ((name === 'href' || name === 'src') && (value.startsWith('javascript:') || value.startsWith('data:text/html'))) {
        el.removeAttribute(attr.name);
      }
    });
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noreferrer noopener');
    }
  });

  root.querySelectorAll('pre').forEach((pre) => {
    pre.classList.add('code-shell');
    const code = pre.querySelector('code');
    if (!code) return;
    const langClass = [...code.classList].find((name) => name.startsWith('language-'));
    const lang = langClass ? langClass.slice(9) : 'code';

    const header = doc.createElement('div');
    header.className = 'code-toolbar';

    const label = doc.createElement('span');
    label.textContent = lang;
    header.appendChild(label);

    const copy = doc.createElement('button');
    copy.type = 'button';
    copy.className = 'code-copy';
    copy.textContent = 'Copy';
    header.appendChild(copy);

    pre.insertBefore(header, code);
  });

  return root.innerHTML;
}

export default function Markdown({ children = '' }) {
  const ref = useRef(null);
  const html = useMemo(() => {
    const rendered = marked.parse(String(children || ''), { gfm: true, breaks: true });
    return sanitizeAndDecorate(rendered);
  }, [children]);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.querySelectorAll('pre code').forEach((node) => {
      try { hljs.highlightElement(node); } catch { /* ignore */ }
    });
  }, [html]);

  const onClick = async (event) => {
    const button = event.target.closest('.code-copy');
    if (!button || !ref.current?.contains(button)) return;
    const code = button.closest('pre')?.querySelector('code')?.innerText || '';
    try {
      await navigator.clipboard.writeText(code);
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = 'Copy'; }, 1100);
    } catch {
      button.textContent = 'Failed';
      setTimeout(() => { button.textContent = 'Copy'; }, 1100);
    }
  };

  return <div ref={ref} onClick={onClick} className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

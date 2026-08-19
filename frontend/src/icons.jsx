import React from 'react';

export function ClaudeMark({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2.4c.8 0 1.45.65 1.45 1.45v4.2l3.64-2.1a1.45 1.45 0 1 1 1.45 2.51l-3.64 2.1 3.64 2.1a1.45 1.45 0 0 1-1.45 2.51l-3.64-2.1v4.2a1.45 1.45 0 1 1-2.9 0v-4.2l-3.64 2.1a1.45 1.45 0 1 1-1.45-2.51l3.64-2.1-3.64-2.1a1.45 1.45 0 1 1 1.45-2.51l3.64 2.1v-4.2C10.55 3.05 11.2 2.4 12 2.4Z" fill="currentColor"/>
    </svg>
  );
}

const icon = (paths) => function Icon({ className = 'h-4 w-4' }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>;
};

export const SearchIcon = icon(<><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>);
export const SlidersIcon = icon(<><path d="M4 6h10"/><path d="M18 6h2"/><circle cx="16" cy="6" r="2"/><path d="M4 12h2"/><path d="M10 12h10"/><circle cx="8" cy="12" r="2"/><path d="M4 18h8"/><path d="M16 18h4"/><circle cx="14" cy="18" r="2"/></>);
export const PlusIcon = icon(<><path d="M12 5v14M5 12h14"/></>);
export const SettingsIcon = icon(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1a1.7 1.7 0 0 0 1.1 1.5 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.13.36.34.7.6 1 .3.28.68.43 1.1.4H21v4h-.1a1.7 1.7 0 0 0-1.5.6Z"/></>);
export const FolderIcon = icon(<><path d="M3 6.5h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11Z"/><path d="M3 10h18"/></>);
export const ChevronRight = icon(<path d="m9 18 6-6-6-6"/>);
export const ChevronDown = icon(<path d="m6 9 6 6 6-6"/>);
export const MoreIcon = icon(<><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></>);
export const CopyIcon = icon(<><rect x="9" y="9" width="10" height="10" rx="2"/><path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/></>);
export const ForkIcon = icon(<><circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="18" cy="17" r="2"/><path d="M8 5h2a4 4 0 0 1 4 4v6"/><path d="M14 9a4 4 0 0 1 4-4"/><path d="M14 15a4 4 0 0 0 4 4"/></>);
export const TrashIcon = icon(<><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m6 7 1 13h10l1-13"/><path d="M10 11v5M14 11v5"/></>);
export const RefreshIcon = icon(<><path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 1-2-5"/></>);
export const SendIcon = icon(<><path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/></>);
export const StopIcon = icon(<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/>);
export const ToolIcon = icon(<><path d="M14.7 6.3a4 4 0 0 0-5-5l2.1 2.1-2.8 2.8-2.1-2.1a4 4 0 0 0 5 5l6.2 6.2a2 2 0 0 0 2.8-2.8l-6.2-6.2Z"/><path d="m5 19 4-4"/></>);
export const XIcon = icon(<><path d="m6 6 12 12M18 6 6 18"/></>);
export const InfoIcon = icon(<><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>);
export const SidebarIcon = icon(<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></>);
export const PanelRightIcon = icon(<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></>);
export const ListIcon = icon(<><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none"/></>);
export const TreeIcon = icon(<><path d="M5 4v12a2 2 0 0 0 2 2h3"/><path d="M5 9h5"/><path d="M5 14h5"/><rect x="10" y="6" width="9" height="5" rx="1"/><rect x="10" y="13" width="9" height="5" rx="1"/></>);
export const FileIcon = icon(<><path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5"/></>);

export const JavaScriptFileIcon = icon(<><path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5"/><path d="M8 13h2v3.2c0 .9-.5 1.3-1.3 1.3H8"/><path d="M12.5 17.4c.5.3 1 .5 1.6.5.8 0 1.4-.4 1.4-1 0-.7-.6-.9-1.4-1.2-.9-.3-1.5-.8-1.5-1.7 0-1.1.9-1.8 2.2-1.8.7 0 1.2.2 1.6.4"/></>);
export const PythonFileIcon = icon(<><path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5"/><path d="M9 14.2v-1.1c0-.8.5-1.3 1.3-1.3h2.4c.8 0 1.3.5 1.3 1.3v1.4h-3.3c-.8 0-1.3.5-1.3 1.3v1.1c0 .8.5 1.3 1.3 1.3h2.2"/><path d="M15 15.8v1.1c0 .8-.5 1.3-1.3 1.3h-2.4c-.8 0-1.3-.5-1.3-1.3v-1.4h3.3c.8 0 1.3-.5 1.3-1.3v-1.1c0-.8-.5-1.3-1.3-1.3h-2.2"/><circle cx="11" cy="13" r=".35" fill="currentColor" stroke="none"/><circle cx="13" cy="17" r=".35" fill="currentColor" stroke="none"/></>);
export const MarkdownFileIcon = icon(<><path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5"/><path d="M8 17v-4l2 2 2-2v4"/><path d="M14 13v4m0 0-1.3-1.3M14 17l1.3-1.3"/></>);
export const TextFileIcon = icon(<><path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5"/><path d="M8 12h8M8 15h8M8 18h5"/></>);
export const ImageFileIcon = icon(<><path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5"/><circle cx="10" cy="12" r="1"/><path d="m8 18 3-3 2 2 1.5-1.5L17 18"/></>);

export const SunIcon = icon(<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></>);
export const MoonIcon = icon(<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5Z"/>);
export const MenuIcon = icon(<><path d="M4 7h16M4 12h16M4 17h16"/></>);
export const DownloadIcon = icon(<><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>);

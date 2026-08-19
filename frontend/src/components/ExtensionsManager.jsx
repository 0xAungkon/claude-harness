import React, { useEffect, useMemo, useState } from 'react';

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

function Empty({ children }) { return <div className="py-14 text-center text-[13px] text-harness-muted">{children}</div>; }
function Badge({ children, tone = '' }) { return <span className={`extension-badge ${tone}`}>{children}</span>; }

function SkillsPanel({ workspacePath, onNotice }) {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const load = async () => {
    setLoading(true);
    try { const body = await requestJson(`/api/extensions/skills?${new URLSearchParams({ workspacePath })}`); setSkills(body.skills || []); }
    catch (error) { onNotice(error.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [workspacePath]);
  const filtered = useMemo(() => skills.filter((item) => !query || `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase())), [skills, query]);
  const changeState = async (item, state) => {
    try {
      const body = await requestJson('/api/extensions/skills/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspacePath, name: item.name, state, scope: item.scope === 'project' ? 'project' : 'user' }) });
      setSkills(body.skills || skills); onNotice(`${item.name}: ${state}`);
    } catch (error) { onNotice(error.message); }
  };
  return (
    <div>
      <input className="extension-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search skills…" />
      {loading ? <Empty>Loading skills…</Empty> : filtered.length ? <div className="mt-3 grid gap-2">{filtered.map((item) => (
        <div key={`${item.scope}:${item.name}`} className="extension-row">
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{item.name}</span><Badge>{item.scope}</Badge></div><div className="mt-1 line-clamp-2 text-[12px] leading-5 text-harness-muted">{item.description || item.path}</div></div>
          {item.locked ? <span className="extension-badge" title={`Managed by plugin ${item.plugin || ''}`}>managed by plugin</span> : <select className="extension-select" value={item.state || 'on'} onChange={(e) => changeState(item, e.target.value)}><option value="on">On</option><option value="name-only">Name only</option><option value="user-invocable-only">Manual only</option><option value="off">Off</option></select>}
        </div>
      ))}</div> : <Empty>No matching skills.</Empty>}
    </div>
  );
}

function PluginsPanel({ workspacePath, onNotice }) {
  const [subtab, setSubtab] = useState('installed');
  const [items, setItems] = useState([]);
  const [marketplaces, setMarketplaces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [installId, setInstallId] = useState('');
  const [marketSource, setMarketSource] = useState('');
  const [scope, setScope] = useState('user');

  const load = async () => {
    setLoading(true);
    try {
      if (subtab === 'marketplaces') {
        const body = await requestJson(`/api/extensions/plugins?${new URLSearchParams({ workspacePath, mode: 'marketplaces' })}`);
        setMarketplaces(body.marketplaces || []);
      } else {
        const mode = subtab === 'discover' ? 'available' : 'installed';
        const body = await requestJson(`/api/extensions/plugins?${new URLSearchParams({ workspacePath, mode })}`);
        let plugins = body.plugins || [];
        if (subtab === 'errors') plugins = plugins.filter((item) => Array.isArray(item.errors) ? item.errors.length : item.errors);
        setItems(plugins);
      }
    } catch (error) { onNotice(error.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [workspacePath, subtab]);

  const act = async (action, plugin) => {
    try { const body = await requestJson('/api/extensions/plugins/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspacePath, action, plugin, scope }) }); onNotice(body.output || `${action} completed`); await load(); }
    catch (error) { onNotice(error.message); }
  };
  const marketplaceAct = async (action, source) => {
    try { const body = await requestJson('/api/extensions/plugins/marketplace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspacePath, action, source, scope }) }); onNotice(body.output || 'Marketplace updated'); setMarketSource(''); await load(); }
    catch (error) { onNotice(error.message); }
  };
  const filtered = items.filter((item) => !query || `${item.name} ${item.id} ${item.description || ''}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div>
      <div className="extension-subtabs">{[['discover','Discover'],['installed','Installed'],['marketplaces','Marketplaces'],['errors','Errors']].map(([id,label]) => <button key={id} data-active={subtab === id} onClick={() => setSubtab(id)}>{label}</button>)}</div>
      {subtab === 'marketplaces' ? (
        <div className="mt-3">
          <div className="extension-inline-form"><input value={marketSource} onChange={(e) => setMarketSource(e.target.value)} placeholder="Marketplace source, e.g. owner/repo" /><select value={scope} onChange={(e) => setScope(e.target.value)}><option value="user">User</option><option value="project">Project</option><option value="local">Local</option></select><button onClick={() => marketSource.trim() && marketplaceAct('add', marketSource.trim())}>Add</button></div>
          {loading ? <Empty>Loading marketplaces…</Empty> : marketplaces.length ? <div className="mt-3 grid gap-2">{marketplaces.map((item, index) => { const name = item.name || item.id || item.repo || item.url || `Marketplace ${index + 1}`; return <div key={`${name}:${index}`} className="extension-row"><div className="min-w-0 flex-1"><div className="font-medium">{name}</div><div className="mt-1 truncate text-[12px] text-harness-muted">{item.repo || item.url || item.path || item.source || ''}</div></div><button className="extension-btn danger" onClick={() => marketplaceAct('remove', name)}>Remove</button></div>; })}</div> : <Empty>No configured marketplaces.</Empty>}
        </div>
      ) : (
        <div className="mt-3">
          <div className="flex flex-col gap-2 sm:flex-row"><input className="extension-search flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search plugins…" /><select className="extension-select" value={scope} onChange={(e) => setScope(e.target.value)}><option value="user">User scope</option><option value="project">Project scope</option><option value="local">Local scope</option></select></div>
          {subtab !== 'discover' && <div className="extension-inline-form mt-2"><input value={installId} onChange={(e) => setInstallId(e.target.value)} placeholder="plugin@marketplace" /><button onClick={() => installId.trim() && act('install', installId.trim())}>Install</button></div>}
          {loading ? <Empty>Loading plugins…</Empty> : filtered.length ? <div className="mt-3 grid gap-2">{filtered.map((item, index) => { const baseId = item.id || item.name; const id = String(baseId || '').includes('@') || !item.marketplace ? baseId : `${baseId}@${item.marketplace}`; const installed = Boolean(subtab !== 'discover' || item.installed === true || item.isInstalled === true || item.installPath || item.installLocation); const enabled = item.enabled !== false && item.disabled !== true; return (
            <div key={`${id}:${index}`} className="extension-row items-start"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{item.name || id}</span>{item.version && <Badge>{item.version}</Badge>}{installed && <Badge tone={enabled ? 'success' : ''}>{enabled ? 'enabled' : 'disabled'}</Badge>}</div><div className="mt-1 line-clamp-2 text-[12px] leading-5 text-harness-muted">{item.description || item.marketplace || item.source || id}</div>{item.errors && <div className="mt-2 text-[12px] text-red-600">{Array.isArray(item.errors) ? item.errors.map((e) => e.message || e.code || String(e)).join(' · ') : String(item.errors)}</div>}</div><div className="flex shrink-0 flex-wrap justify-end gap-1.5">{subtab === 'discover' && !installed ? <button className="extension-btn primary" onClick={() => act('install', id)}>Install</button> : <>{enabled ? <button className="extension-btn" onClick={() => act('disable', id)}>Disable</button> : <button className="extension-btn" onClick={() => act('enable', id)}>Enable</button>}<button className="extension-btn" onClick={() => act('update', id)}>Update</button><button className="extension-btn danger" onClick={() => act('uninstall', id)}>Remove</button></>}</div></div>
          ); })}</div> : <Empty>No plugins found.</Empty>}
        </div>
      )}
    </div>
  );
}

function McpPanel({ workspacePath, onNotice }) {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [transport, setTransport] = useState('http');
  const [target, setTarget] = useState('');
  const [args, setArgs] = useState('');
  const [scope, setScope] = useState('local');
  const load = async () => { setLoading(true); try { const body = await requestJson(`/api/extensions/mcp?${new URLSearchParams({ workspacePath })}`); setServers(body.servers || []); } catch (error) { onNotice(error.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [workspacePath]);
  const add = async () => {
    if (!name.trim() || !target.trim()) return;
    try {
      const payload = transport === 'http' ? { action: 'add-http', name: name.trim(), url: target.trim() } : { action: 'add-stdio', name: name.trim(), command: target.trim(), args: args.trim() ? args.trim().split(/\s+/) : [] };
      const body = await requestJson('/api/extensions/mcp/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspacePath, scope, ...payload }) });
      onNotice(body.output || 'MCP server added'); setName(''); setTarget(''); setArgs(''); await load();
    } catch (error) { onNotice(error.message); }
  };
  const remove = async (server) => { try { const body = await requestJson('/api/extensions/mcp/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspacePath, action: 'remove', name: server.name, scope }) }); onNotice(body.output || 'MCP server removed'); await load(); } catch (error) { onNotice(error.message); } };
  return (
    <div>
      <div className="extension-form-grid">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Server name" />
        <select value={transport} onChange={(e) => setTransport(e.target.value)}><option value="http">HTTP</option><option value="stdio">stdio</option></select>
        <select value={scope} onChange={(e) => setScope(e.target.value)}><option value="local">Local</option><option value="user">User</option><option value="project">Project</option></select>
        <input className="sm:col-span-2" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={transport === 'http' ? 'https://server.example/mcp' : '/path/to/server-command'} />
        {transport === 'stdio' && <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="Arguments" />}
        <button onClick={add}>Add server</button>
      </div>
      {loading ? <Empty>Checking MCP connections…</Empty> : servers.length ? <div className="mt-3 grid gap-2">{servers.map((server, index) => <div key={`${server.name}:${index}`} className="extension-row"><span className={`mcp-dot ${server.status}`} /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-medium">{server.name}</span><Badge tone={server.status === 'connected' ? 'success' : server.status === 'failed' ? 'danger' : ''}>{server.status}</Badge></div><div className="mt-1 truncate text-[12px] text-harness-muted" title={server.detail}>{server.detail || server.statusText}</div></div><button className="extension-btn danger" onClick={() => remove(server)}>Remove</button></div>)}</div> : <Empty>No MCP servers configured.</Empty>}
    </div>
  );
}

export default function ExtensionsManager({ initialTab = 'skills', workspacePath = '', onClose = () => {}, onNotice = () => {} }) {
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  return (
    <div className="extensions-view harness-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-44 pt-5 sm:px-6 sm:pt-7 lg:px-8">
      <div className="mx-auto w-full max-w-[980px]">
        <div className="mb-4 flex items-center gap-3"><div className="min-w-0 flex-1"><h2 className="text-[20px] font-semibold tracking-[-.025em]">Claude Code extensions</h2><p className="mt-1 truncate text-[13px] text-harness-muted" title={workspacePath}>{workspacePath}</p></div><button className="stats-action" onClick={onClose}>Close</button></div>
        <div className="stats-card rounded-2xl border p-3 sm:p-4">
          <div className="extension-tabs mb-4">{[['skills','Skills'],['plugins','Plugins'],['mcp','MCP']].map(([id,label]) => <button key={id} data-active={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
          {tab === 'skills' && <SkillsPanel workspacePath={workspacePath} onNotice={onNotice} />}
          {tab === 'plugins' && <PluginsPanel workspacePath={workspacePath} onNotice={onNotice} />}
          {tab === 'mcp' && <McpPanel workspacePath={workspacePath} onNotice={onNotice} />}
        </div>
      </div>
    </div>
  );
}

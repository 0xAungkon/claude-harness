import React, { useMemo, useState } from 'react';

function compactNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 1 : 2)}b`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}m`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 1 : 2)}k`;
  return Math.round(n).toLocaleString();
}

function percent(value) {
  const n = Number(value || 0);
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
}

function duration(ms) {
  const n = Number(ms || 0);
  if (!n) return '—';
  const days = Math.floor(n / 86400000);
  const hours = Math.floor((n % 86400000) / 3600000);
  const mins = Math.floor((n % 3600000) / 60000);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${mins}m`;
  return `${Math.max(1, mins)}m`;
}

function StatCard({ label, value, note }) {
  return (
    <div className="stats-card rounded-2xl border p-4 sm:p-5">
      <div className="text-[12px] font-semibold uppercase tracking-[0.11em] text-harness-muted">{label}</div>
      <div className="mt-2 text-[25px] font-semibold tracking-[-0.04em] text-harness-primary">{value}</div>
      {note && <div className="mt-1 truncate text-[12px] text-harness-muted" title={note}>{note}</div>}
    </div>
  );
}

function ContextGauge({ value, size = 126 }) {
  const pct = percent(value);
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--border)" strokeWidth="9" />
        <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--accent)" strokeWidth="9" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[25px] font-semibold tracking-[-0.04em]">{Math.round(pct)}%</div>
        <div className="text-[11px] text-harness-muted">context</div>
      </div>
    </div>
  );
}

function CompositionBar({ parts }) {
  const total = Math.max(1, parts.reduce((sum, item) => sum + Number(item.value || 0), 0));
  return (
    <>
      <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-harness-hover">
        {parts.map((item, index) => (
          <div key={item.label} title={`${item.label}: ${compactNumber(item.value)}`} style={{ width: `${(Number(item.value || 0) / total) * 100}%`, background: item.color || `color-mix(in srgb, var(--accent) ${92 - index * 16}%, var(--bg-hover))` }} />
        ))}
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {parts.map((item, index) => (
          <div key={item.label} className="flex items-center gap-2 text-[13px]">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color || `color-mix(in srgb, var(--accent) ${92 - index * 16}%, var(--bg-hover))` }} />
            <span className="text-harness-muted">{item.label}</span>
            <span className="ml-auto font-medium text-harness-primary">{compactNumber(item.value)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function ActivityHeatmap({ days, range }) {
  const count = range === 30 ? 35 : range === 90 ? 91 : 365;
  const lookup = useMemo(() => new Map((days || []).map((item) => [item.date, item])), [days]);
  const values = useMemo(() => {
    const result = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const d = new Date(today);
      d.setDate(today.getDate() - offset);
      const key = d.toISOString().slice(0, 10);
      result.push({ key, ...lookup.get(key) });
    }
    return result;
  }, [lookup, count]);
  const max = Math.max(1, ...values.map((item) => Number(item.tokens || item.messages || 0)));

  return (
    <div className="harness-scroll overflow-x-auto pb-1">
      <div className="grid min-w-[560px] grid-flow-col grid-rows-7 gap-[4px]" style={{ gridAutoColumns: '11px' }}>
        {values.map((item) => {
          const ratio = Number(item.tokens || item.messages || 0) / max;
          const level = ratio <= 0 ? 0 : ratio < .12 ? 1 : ratio < .35 ? 2 : ratio < .66 ? 3 : 4;
          return <div key={item.key} className={`activity-cell activity-level-${level}`} title={`${item.key} · ${compactNumber(item.tokens || 0)} tokens · ${item.messages || 0} messages`} />;
        })}
      </div>
    </div>
  );
}

function ModelBars({ models }) {
  const max = Math.max(1, ...(models || []).slice(0, 6).map((item) => Number(item.tokens || 0)));
  if (!models?.length) return <div className="py-8 text-center text-[13px] text-harness-muted">Model usage will appear as transcript token metadata becomes available.</div>;
  return (
    <div className="grid gap-3">
      {models.slice(0, 6).map((item) => (
        <div key={item.id}>
          <div className="mb-1.5 flex items-center gap-3 text-[13px]"><span className="min-w-0 flex-1 truncate font-medium">{item.id}</span><span className="text-harness-muted">{compactNumber(item.tokens)}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-harness-hover"><div className="h-full rounded-full bg-harness-accent" style={{ width: `${Math.max(2, (Number(item.tokens || 0) / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function StatsView({ stats, loading = false, error = '', onRefresh = () => {}, onManage = () => {}, projectPath = '' }) {
  const [range, setRange] = useState(90);
  const session = stats?.session || {};
  const overall = stats?.overall || {};
  const context = session.context_window || {};
  const usage = context.current_usage || {};
  const used = percent(context.used_percentage);
  const windowSize = Number(context.context_window_size || 200000);
  const usedTokens = Math.round((used / 100) * windowSize) || Number(context.total_input_tokens || 0);
  const model = session.model?.display_name || session.model?.id || overall.favoriteModel || 'Unknown model';
  const parts = [
    { label: 'Fresh input', value: usage.input_tokens || 0, color: 'var(--accent)' },
    { label: 'Cache read', value: usage.cache_read_input_tokens || 0, color: 'color-mix(in srgb, var(--accent) 68%, #8f72ac)' },
    { label: 'Cache write', value: usage.cache_creation_input_tokens || 0, color: 'color-mix(in srgb, var(--accent) 52%, #c18354)' },
    { label: 'Generated output', value: usage.output_tokens || 0, color: 'color-mix(in srgb, var(--accent) 35%, #79a37a)' }
  ];
  const allDays = overall.firstDay && overall.lastDay ? Math.max(1, Math.round((new Date(overall.lastDay) - new Date(overall.firstDay)) / 86400000) + 1) : 0;

  return (
    <div className="stats-view harness-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-44 pt-5 sm:px-6 sm:pt-7 lg:px-8">
      <div className="mx-auto w-full max-w-[1080px] space-y-4 sm:space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <h2 className="text-[20px] font-semibold tracking-[-0.025em]">Session & usage stats</h2>
            <p className="mt-1 text-[13px] text-harness-muted">Context health, activity and Claude Code extensions in one view.</p>
          </div>
          <button type="button" onClick={onRefresh} className="stats-action ml-auto">{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>}

        <section className="stats-card rounded-2xl border p-4 sm:p-5">
          <div className="flex flex-col gap-5 md:flex-row md:items-center">
            <ContextGauge value={used} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <div className="text-[18px] font-semibold">{model}</div>
                {session.estimated && <span className="rounded-full bg-harness-hover px-2 py-0.5 text-[11px] text-harness-muted">estimated</span>}
              </div>
              <div className="mt-1 text-[14px] text-harness-muted"><span className="font-medium text-harness-primary">{compactNumber(usedTokens)}</span> / {compactNumber(windowSize)} tokens · {Math.round(used)}% used</div>
              <CompositionBar parts={parts} />
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Sessions" value={compactNumber(overall.sessions)} note={`${overall.activeDays || 0}/${allDays || overall.activeDays || 0} active days`} />
          <StatCard label="Total tokens" value={compactNumber(overall.totalTokens)} note={`Input ${compactNumber(overall.input)} · Output ${compactNumber(overall.output)}`} />
          <StatCard label="Longest session" value={duration(overall.longestSessionMs)} note={`${compactNumber(overall.toolCalls)} tool calls recorded`} />
          <StatCard label="Current streak" value={`${overall.currentStreak || 0}d`} note={`Longest ${overall.longestStreak || 0} days`} />
        </div>

        <section className="stats-card rounded-2xl border p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div><div className="text-[15px] font-semibold">Activity</div><div className="mt-0.5 text-[12px] text-harness-muted">Token activity across all discovered sessions</div></div>
            <div className="ml-auto flex rounded-lg bg-harness-hover p-0.5">
              {[30, 90, 365].map((value) => <button key={value} type="button" className={`stats-range ${range === value ? 'is-active' : ''}`} onClick={() => setRange(value)}>{value === 365 ? '1 year' : `${value} days`}</button>)}
            </div>
          </div>
          <ActivityHeatmap days={overall.days || []} range={range} />
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div><div className="text-[11px] uppercase tracking-[.1em] text-harness-muted">Most active day</div><div className="mt-1 text-[14px] font-medium">{overall.mostActiveDay?.date || '—'} <span className="text-harness-muted">· {compactNumber(overall.mostActiveDay?.tokens || 0)}</span></div></div>
            <div><div className="text-[11px] uppercase tracking-[.1em] text-harness-muted">Favorite model</div><div className="mt-1 truncate text-[14px] font-medium" title={overall.favoriteModel || ''}>{overall.favoriteModel || '—'}</div></div>
            <div><div className="text-[11px] uppercase tracking-[.1em] text-harness-muted">Active days</div><div className="mt-1 text-[14px] font-medium">{overall.activeDays || 0}</div></div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="stats-card rounded-2xl border p-4 sm:p-5">
            <div className="mb-4"><div className="text-[15px] font-semibold">Token mix</div><div className="mt-0.5 text-[12px] text-harness-muted">All-time transcript usage discovered by Harness</div></div>
            <CompositionBar parts={[
              { label: 'Input', value: overall.input || 0, color: 'var(--accent)' },
              { label: 'Output', value: overall.output || 0, color: 'color-mix(in srgb, var(--accent) 62%, #78a078)' },
              { label: 'Cache read', value: overall.cacheRead || 0, color: 'color-mix(in srgb, var(--accent) 58%, #876aa5)' },
              { label: 'Cache write', value: overall.cacheWrite || 0, color: 'color-mix(in srgb, var(--accent) 42%, #b8784f)' }
            ]} />
          </section>
          <section className="stats-card rounded-2xl border p-4 sm:p-5">
            <div className="mb-4"><div className="text-[15px] font-semibold">Models</div><div className="mt-0.5 text-[12px] text-harness-muted">Models ranked by observed token volume</div></div>
            <ModelBars models={overall.models || []} />
          </section>
        </div>

        <section className="stats-card rounded-2xl border p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold">Claude Code environment</div>
              <div className="mt-1 truncate text-[12px] text-harness-muted" title={projectPath}>{session.version ? `Claude Code ${session.version} · ` : ''}{projectPath || session.workspace?.current_dir || 'Workspace'}</div>
              <div className="mt-2 grid gap-1 text-[12px] text-harness-muted sm:grid-cols-2">
                <div>Session ID <span className="font-mono text-harness-primary">{session.session_id || '—'}</span></div>
                <div>Kind <span className="text-harness-primary">{session.session_kind || 'interactive/headless'}</span></div>
                <div>Auth <span className="text-harness-primary">{stats?.environment?.authTokenEnv || 'default Claude login'}</span></div>
                <div className="truncate" title={stats?.environment?.anthropicBaseUrl || ''}>Base URL <span className="text-harness-primary">{stats?.environment?.anthropicBaseUrl || 'default'}</span></div>
              </div>
              {stats?.environment?.settingSources?.length > 0 && <div className="mt-2 text-[11px] text-harness-muted">Settings: {stats.environment.settingSources.join(' · ')}</div>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => onManage('skills')} className="stats-action">Skills</button>
              <button type="button" onClick={() => onManage('plugins')} className="stats-action">Plugins</button>
              <button type="button" onClick={() => onManage('mcp')} className="stats-action">MCP</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export { compactNumber, percent };

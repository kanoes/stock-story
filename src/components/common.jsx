import { useEffect, useState } from 'react';

import { TAB_ITEMS } from '../lib/trade/index.js';
import { buildScopeOptions } from '../lib/view-models.js';

let chartRuntimePromise = null;

async function loadChartRuntime() {
  if (!chartRuntimePromise) {
    chartRuntimePromise = Promise.all([
      import('chart.js'),
      import('react-chartjs-2')
    ]).then(([chartJs, chartReact]) => {
      const {
        ArcElement,
        BarElement,
        CategoryScale,
        Chart: ChartJS,
        Filler,
        Legend,
        LinearScale,
        LineElement,
        PointElement,
        Tooltip
      } = chartJs;

      ChartJS.register(
        ArcElement,
        BarElement,
        CategoryScale,
        Filler,
        Legend,
        LinearScale,
        LineElement,
        PointElement,
        Tooltip
      );

      return {
        Bar: chartReact.Bar,
        Line: chartReact.Line
      };
    });
  }

  return chartRuntimePromise;
}

export function Icon({ name }) {
  if (name === 'home') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="currentColor" d="M12 3.3 3.5 10v10.2h6.2v-5.8h4.6v5.8h6.2V10z" />
      </svg>
    );
  }

  if (name === 'list') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="currentColor" d="M5 5h2v2H5zm4 0h10v2H9zm-4 6h2v2H5zm4 0h10v2H9zm-4 6h2v2H5zm4 0h10v2H9z" />
      </svg>
    );
  }

  if (name === 'bars') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="currentColor" d="M5 9h3v10H5zm5-5h4v15h-4zm6 8h3v7h-3z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path fill="currentColor" d="M12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7m7.4-2.5c.1-.3.1-.6.1-1s0-.7-.1-1l2.1-1.6c.2-.1.2-.4.1-.6l-2-3.5c-.1-.2-.4-.3-.6-.2l-2.5 1c-.5-.4-1.1-.7-1.7-1l-.4-2.6A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.4l-.4 2.6c-.6.3-1.2.6-1.7 1l-2.5-1c-.2-.1-.5 0-.6.2l-2 3.5c-.1.2-.1.5.1.6L4.5 11c-.1.3-.1.6-.1 1s0 .7.1 1l-2.1 1.6c-.2.1-.2.4-.1.6l2 3.5c.1.2.4.3.6.2l2.5-1c.5.4 1.1.7 1.7 1l.4 2.6c0 .2.2.4.5.4h4c.3 0 .5-.2.5-.4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.5c.1-.2.1-.5-.1-.6z" />
    </svg>
  );
}

export function DeferredChart({ kind, data, options, fallbackTitle = '图表加载中' }) {
  const [runtime, setRuntime] = useState(null);

  useEffect(() => {
    let active = true;
    loadChartRuntime()
      .then((nextRuntime) => {
        if (active) setRuntime(nextRuntime);
      })
      .catch(() => {
        if (active) setRuntime({ failed: true });
      });

    return () => {
      active = false;
    };
  }, []);

  if (!runtime) {
    return <div className="chart-loading">{fallbackTitle}</div>;
  }

  if (runtime.failed) {
    return <div className="chart-loading">图表暂时不可用</div>;
  }

  const ChartComponent = kind === 'bar' ? runtime.Bar : runtime.Line;
  return <ChartComponent data={data} options={options} />;
}

export function StatusBadge({ tone, children }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

export function SegmentedControl({ value, onChange, options, className = '', compact = false }) {
  return (
    <div
      className={`segment-control ${compact ? 'compact' : ''} ${className}`.trim()}
      style={{ '--segment-count': options.length }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`segment-btn ${value === option.value ? 'active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ScopeToggle({ value, onChange, className = '' }) {
  return (
    <SegmentedControl
      value={value}
      onChange={onChange}
      className={className}
      options={buildScopeOptions()}
    />
  );
}

export function AppTopBar({ title, trailing, actions }) {
  return (
    <header className="topbar">
      <div className="topbar-main">
        <h1>{title}</h1>
        {trailing ? <div className="topbar-side">{trailing}</div> : null}
      </div>
      {actions ? <div className="topbar-actions">{actions}</div> : null}
    </header>
  );
}

export function StatCard({ label, value, note, tone = 'neutral', emphasis = false }) {
  return (
    <article className={`stat-card ${emphasis ? 'emphasis' : ''}`}>
      <span className="stat-label">{label}</span>
      <strong className={`stat-value ${tone}`}>{value}</strong>
      {note ? <span className="stat-note">{note}</span> : null}
    </article>
  );
}

export function CollapsibleSection({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="card">
      <button type="button" className="section-toggle" onClick={() => setOpen((current) => !current)}>
        <h2>{title}</h2>
        <span>{open ? '收起' : '展开'}</span>
      </button>
      {open ? <div className="section-body">{children}</div> : null}
    </section>
  );
}

export function EmptyState({ title, body = '' }) {
  return (
    <div className="empty-state">
      <div className="empty-title">{title}</div>
      {body ? <div className="empty-body">{body}</div> : null}
    </div>
  );
}

export function Toast({ toast }) {
  if (!toast) return null;
  return <div className={`toast-banner ${toast.tone}`}>{toast.text}</div>;
}

export function BottomNav({ activeTab, onChange }) {
  return (
    <nav className="bottom-tab-bar" aria-label="底部导航">
      {TAB_ITEMS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
          aria-current={activeTab === tab.id ? 'page' : undefined}
          onClick={() => onChange(tab.id)}
        >
          <Icon name={tab.icon} />
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

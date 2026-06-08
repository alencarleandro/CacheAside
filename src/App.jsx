import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Play,
  Trash2
} from 'lucide-react';
import { apiFetch, CACHE_UPDATED_EVENT } from './api.js';
import CacheAsideMark from './CacheAsideMark.jsx';

const INITIAL_BENCHMARK_REPETITIONS = 1;
const N8N_WORKFLOW_URL = 'https://n8n-kupm.onrender.com/workflow/W2MPm1fzBxBnbjHo?new=true';

function formatMs(value) {
  const milliseconds = Number(value || 0);
  const absolute = Math.abs(milliseconds);
  const units = [
    { limit: 1_000, divisor: 1, suffix: 'ms' },
    { limit: 60_000, divisor: 1_000, suffix: 's' },
    { limit: 3_600_000, divisor: 60_000, suffix: 'min' },
    { limit: 86_400_000, divisor: 3_600_000, suffix: 'h' },
    { limit: Infinity, divisor: 86_400_000, suffix: 'd' }
  ];
  const unit = units.find((item) => absolute < item.limit);
  const scaled = milliseconds / unit.divisor;
  const decimals = unit.suffix === 'ms' || Math.abs(scaled) >= 10 ? 1 : 2;
  return `${scaled.toFixed(decimals)} ${unit.suffix}`;
}

function formatSpeedup(value) {
  return `${Number(value || 0).toFixed(1)}x`;
}

function benchmarkSpeedup(benchmark) {
  if (benchmark?.speedupFactor) return benchmark.speedupFactor;

  const withoutCache = benchmark?.withoutCache?.avgMs ?? 0;
  const withCache = benchmark?.withCache?.avgMs ?? 0;
  return withCache ? withoutCache / withCache : 0;
}

function benchmarkTotalMs(phase) {
  if (phase?.totalMs !== undefined) return phase.totalMs;
  return Number(phase?.avgMs ?? 0) * Number(phase?.requests ?? 0);
}

function groupReadsBySearch(reads) {
  const groups = new Map();

  for (const read of reads) {
    const readNumber = read.readNumber ?? 1;

    if (!groups.has(readNumber)) {
      groups.set(readNumber, {
        readNumber,
        reads: [],
        totalMs: 0
      });
    }

    const group = groups.get(readNumber);
    group.reads.push(read);
    group.totalMs += Number(read.elapsedMs || 0);
  }

  return Array.from(groups.values()).sort((current, next) => current.readNumber - next.readNumber);
}

function readStudentLabel(read) {
  return read.studentName ? `${read.studentId} - ${read.studentName}` : read.studentId;
}

function formatCacheValue(value) {
  if (value === undefined) return '-';
  return JSON.stringify(value, null, 2);
}

function BenchmarkSearchCards({ groups }) {
  return (
    <div className="benchmark-search-list">
      {groups.map((group) => (
        <article className="benchmark-search-card" key={group.readNumber}>
          <header>
            <div>
              <strong>Busca {group.readNumber}</strong>
              <span>{group.reads.length} itens</span>
            </div>
            <b>{formatMs(group.totalMs)}</b>
          </header>

          <div className="benchmark-search-items">
            {group.reads.map((read) => (
              <div className="benchmark-search-item" key={`${read.phase}-${read.readNumber}-${read.studentId}`}>
                <span>{readStudentLabel(read)}</span>
                <strong>{formatMs(read.elapsedMs)}</strong>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function FocusNote({ measure, result }) {
  return (
    <div className="focus-note">
      <p><strong>Como mede:</strong> {measure}</p>
      <p><strong>O que observar:</strong> {result}</p>
    </div>
  );
}

function App() {
  const [students, setStudents] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [cache, setCache] = useState({ enabled: true, size: 0, keys: [], entries: [] });
  const [benchmark, setBenchmark] = useState(null);
  const [benchmarkExpanded, setBenchmarkExpanded] = useState(false);
  const [withoutCacheExpanded, setWithoutCacheExpanded] = useState(true);
  const [withCacheExpanded, setWithCacheExpanded] = useState(true);
  const [iterations, setIterations] = useState(INITIAL_BENCHMARK_REPETITIONS);
  const [loading, setLoading] = useState(false);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [error, setError] = useState('');

  const benchmarkScale = useMemo(() => {
    const withoutCache = benchmark?.withoutCache?.avgMs ?? 0;
    const withCache = benchmark?.withCache?.avgMs ?? 0;
    return Math.max(withoutCache, withCache, 1);
  }, [benchmark]);

  async function loadMetrics() {
    const [metricsPayload, cachePayload] = await Promise.all([
      apiFetch('/metrics', { syncCache: false }),
      apiFetch('/cache', { syncCache: false })
    ]);
    setMetrics(metricsPayload.data);
    setCache(cachePayload.data);
  }

  async function loadStudents() {
    const payload = await apiFetch('/students');
    setStudents(payload.data);
    await loadMetrics();
  }

  async function refreshDashboard() {
    setError('');
    try {
      await loadStudents();
      await executeBenchmark(INITIAL_BENCHMARK_REPETITIONS);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    function updateCacheFromRequest(event) {
      setCache(event.detail);
    }

    window.addEventListener(CACHE_UPDATED_EVENT, updateCacheFromRequest);
    refreshDashboard();

    return () => {
      window.removeEventListener(CACHE_UPDATED_EVENT, updateCacheFromRequest);
    };
  }, []);

  async function handleAction(action) {
    setLoading(true);
    setError('');

    try {
      await action();
      await loadMetrics();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function executeBenchmark(nextIterations = iterations) {
    setBenchmarkLoading(true);

    try {
      await handleAction(async () => {
        const payload = await apiFetch('/benchmark', {
          method: 'POST',
          body: { iterations: nextIterations }
        });
        setBenchmark(payload.data);
      });
    } finally {
      setBenchmarkLoading(false);
    }
  }

  async function runBenchmark() {
    await executeBenchmark(iterations);
  }

  async function clearCurrentCache() {
    setCacheLoading(true);

    try {
      await handleAction(async () => {
        const payload = await apiFetch('/cache/clear', { method: 'POST' });
        setCache(payload.data);
      });
    } finally {
      setCacheLoading(false);
    }
  }

  const benchmarkReads = benchmark?.reads ?? [];
  const withoutCacheReads = benchmarkReads.filter((read) => read.phase === 'sem cache');
  const withCacheReads = benchmarkReads.filter((read) => read.phase === 'com cache');
  const withoutCacheGroups = groupReadsBySearch(withoutCacheReads);
  const withCacheGroups = groupReadsBySearch(withCacheReads);
  const benchmarkTableHits = benchmarkReads.length
    ? benchmarkReads.filter((read) => read.cacheMatch === 'hit').length
    : 0;
  const benchmarkTableMisses = benchmarkReads.length
    ? benchmarkReads.filter((read) => read.cacheMatch === 'miss' && read.phase === 'com cache').length
    : 0;
  const benchmarkTableHitRate = benchmarkTableHits + benchmarkTableMisses
    ? (benchmarkTableHits / (benchmarkTableHits + benchmarkTableMisses)) * 100
    : 0;
  const totalBenchmarkRequests = (benchmark?.withoutCache?.requests ?? 0) + (benchmark?.withCache?.requests ?? 0);
  const benchmarkSpeedupFactor = benchmarkSpeedup(benchmark);
  const withoutCacheTotalMs = benchmarkTotalMs(benchmark?.withoutCache);
  const withCacheTotalMs = benchmarkTotalMs(benchmark?.withCache);
  const totalImprovementMs = withoutCacheTotalMs - withCacheTotalMs;
  const cacheEntries = cache.entries?.length
    ? cache.entries
    : (cache.keys ?? []).map((key) => ({
        key,
        value: undefined,
        ttlMs: null
      }));
  const cacheBackendLabel = cache.backend === 'redis' ? 'Redis' : 'Memoria';
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-title">
          <CacheAsideMark className="cache-aside-mark" />
          <div>
            <h1>Cache Aside</h1>
          </div>
        </div>
      </header>

      {error && <div className="alert">{error}</div>}

      <main className="workspace">
        <section className={`surface benchmark-panel ${benchmarkLoading ? 'is-loading' : ''}`} aria-busy={benchmarkLoading}>
          {benchmarkLoading && (
            <div className="benchmark-loading" role="status" aria-live="polite">
              <div className="benchmark-spinner" />
              <strong>Executando benchmark</strong>
              <span>Medindo as leituras com e sem cache...</span>
            </div>
          )}
          <div className="section-heading">
            <div>
              <span className="eyebrow">Benchmark</span>
              <h2>Benchmark</h2>
            </div>
            <div className="inline-controls">
              <label>
                Repetições
                <input
                  type="number"
                  min="0"
                  max="60"
                  value={iterations}
                  onChange={(event) => setIterations(event.target.value)}
                />
              </label>
              <button className="primary-button" onClick={runBenchmark} disabled={loading} title="Executar benchmark">
                <Play size={18} />
                Executar
              </button>
            </div>
          </div>
          <FocusNote
            measure="Busca todos os alunos individualmente: 1 leitura base mais a quantidade de repeticoes, primeiro com cache desligado, depois com cache ligado."
            result="Compare as barras. A diferenca e o ganho de latencia do Cache Aside."
          />

          <div className="comparison-bars">
            <div className="bar-row">
              <span>Sem cache</span>
              <div className="bar-content">
                <div className="bar-track">
                  <div
                    className="bar-fill no-cache"
                    style={{ width: `${((benchmark?.withoutCache?.avgMs ?? 0) / benchmarkScale) * 100}%` }}
                  />
                </div>
                <div className="bar-metric">
                  <span>Media: <strong>{formatMs(benchmark?.withoutCache?.avgMs)}</strong></span>
                  <span>Total: <strong>{formatMs(withoutCacheTotalMs)}</strong></span>
                </div>
              </div>
            </div>
            <div className="bar-row">
              <span>Com cache</span>
              <div className="bar-content">
                <div className="bar-track">
                  <div
                    className="bar-fill with-cache"
                    style={{ width: `${((benchmark?.withCache?.avgMs ?? 0) / benchmarkScale) * 100}%` }}
                  />
                </div>
                <div className="bar-metric">
                  <span>Media: <strong>{formatMs(benchmark?.withCache?.avgMs)}</strong></span>
                  <span>Total: <strong>{formatMs(withCacheTotalMs)}</strong></span>
                </div>
              </div>
            </div>
          </div>

          <div className="benchmark-summary">
            <div>
              <span>Leituras</span>
              <strong>{totalBenchmarkRequests}</strong>
            </div>
            <div>
              <span>Ganho medio</span>
              <strong>{formatMs(benchmark?.improvementMs)}</strong>
            </div>
            <div>
              <span>Ganho total</span>
              <strong>{formatMs(totalImprovementMs)}</strong>
            </div>
            <div>
              <span>Vezes mais rapida</span>
              <strong>{formatSpeedup(benchmarkSpeedupFactor)}</strong>
            </div>
          </div>

          <div className="benchmark-details">
              <div className="benchmark-table-meta">
                <span>{benchmarkReads.length} registros</span>
                <span>{benchmarkTableHits} hits</span>
                <span>{benchmarkTableMisses} misses</span>
                <span>{benchmarkTableHitRate.toFixed(1)}% hit</span>
                {benchmarkReads.length > 0 && (!withoutCacheExpanded || !withCacheExpanded) && (
                  <div className="benchmark-collapsed-actions">
                    {!withoutCacheExpanded && (
                      <button
                        className="table-toggle"
                        type="button"
                        onClick={() => setWithoutCacheExpanded(true)}
                        aria-expanded={withoutCacheExpanded}
                      >
                        <strong>Sem cache</strong>
                        <ChevronDown size={16} />
                      </button>
                    )}
                    {!withCacheExpanded && (
                      <button
                        className="table-toggle"
                        type="button"
                        onClick={() => setWithCacheExpanded(true)}
                        aria-expanded={withCacheExpanded}
                      >
                        <strong>Com cache</strong>
                        <ChevronDown size={16} />
                      </button>
                    )}
                  </div>
                )}
                <button
                  className="details-toggle"
                  type="button"
                  onClick={() => setBenchmarkExpanded((current) => !current)}
                  aria-expanded={benchmarkExpanded}
                  title={benchmarkExpanded ? 'Recolher detalhes' : 'Expandir detalhes'}
                >
                  {benchmarkExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
              </div>
              <div className={`benchmark-detail-body ${benchmarkExpanded ? 'is-open' : 'is-closed'}`}>
                <div className="benchmark-detail-content">
                  {benchmarkReads.length && (withoutCacheExpanded || withCacheExpanded) ? (
                    <div className={`benchmark-table-grid ${withoutCacheExpanded && withCacheExpanded ? '' : 'has-single-table'}`}>
                      {withoutCacheExpanded && (
                        <div className="benchmark-table-card">
                          <button
                            className="table-toggle"
                            type="button"
                            onClick={() => setWithoutCacheExpanded(false)}
                            aria-expanded={withoutCacheExpanded}
                          >
                            <strong>Sem cache</strong>
                            <ChevronUp size={16} />
                          </button>
                          <BenchmarkSearchCards groups={withoutCacheGroups} />
                        </div>
                      )}

                      {withCacheExpanded && (
                        <div className="benchmark-table-card">
                          <button
                            className="table-toggle"
                            type="button"
                            onClick={() => setWithCacheExpanded(false)}
                            aria-expanded={withCacheExpanded}
                          >
                            <strong>Com cache</strong>
                            <ChevronUp size={16} />
                          </button>
                          <BenchmarkSearchCards groups={withCacheGroups} />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="benchmark-empty-state">Sem leituras ainda</div>
                  )}
                </div>
              </div>
          </div>
        </section>

        <section className="surface cache-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Cache</span>
              <h2>Dados atuais em cache</h2>
            </div>
            <button
              className="primary-button"
              type="button"
              onClick={clearCurrentCache}
              disabled={loading || cache.size === 0}
              title="Limpar todas as chaves do cache"
            >
              <Trash2 size={18} />
              {cacheLoading ? 'Limpando...' : 'Limpar cache'}
            </button>
          </div>

          <div className="cache-overview">
            <div>
              <span>Backend</span>
              <strong>{cacheBackendLabel}</strong>
            </div>
            <div>
              <span>Chaves</span>
              <strong>{cache.size}</strong>
            </div>
            <div>
              <span>TTL padrao</span>
              <strong>{formatMs(cache.ttlMs)}</strong>
            </div>
          </div>

          {cacheEntries.length ? (
            <div className="cache-entry-list" aria-live="polite">
              {cacheEntries.map((entry) => (
                <article className="cache-entry" key={entry.key}>
                  <header>
                    <span>Expira em {entry.ttlMs ? formatMs(entry.ttlMs) : '-'}</span>
                  </header>
                  <div className="cache-entry-field">
                    <span>Key</span>
                    <code>{entry.key}</code>
                  </div>
                  <div className="cache-entry-field is-value">
                    <span>Value</span>
                    <pre>{formatCacheValue(entry.value)}</pre>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="cache-empty-state" aria-live="polite">
              Nenhum dado armazenado no cache.
            </div>
          )}
        </section>

        <section className="surface consistency-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Tradeoff</span>
              <h2>n8n workflow</h2>
            </div>
            <a
              className="primary-button n8n-open-link"
              href={N8N_WORKFLOW_URL}
              target="_blank"
              rel="noreferrer"
              title="Abrir workflow no n8n"
            >
              <ExternalLink size={18} />
              Abrir n8n
            </a>
          </div>
          <div className="tradeoff-workflow-shell">
            <iframe
              title="Workflow n8n do tradeoff"
              src={N8N_WORKFLOW_URL}
            />
          </div>
        </section>


      </main>
    </div>
  );
}

export default App;


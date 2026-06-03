import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Database,
  PencilLine,
  Play,
  RefreshCcw,
  Send,
  Server
} from 'lucide-react';
import { apiFetch } from './api.js';
import CacheAsideMark from './CacheAsideMark.jsx';

const INITIAL_BENCHMARK_REPETITIONS = 1;

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

function formatGrade(value) {
  return Number(value ?? 0).toFixed(1);
}

function nextDemoGrade(value) {
  const grade = Number(value ?? 0);
  return Number((grade >= 9.8 ? grade - 0.4 : grade + 0.4).toFixed(1));
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
  const [cache, setCache] = useState({ enabled: true, size: 0, keys: [] });
  const [benchmark, setBenchmark] = useState(null);
  const [benchmarkExpanded, setBenchmarkExpanded] = useState(false);
  const [withoutCacheExpanded, setWithoutCacheExpanded] = useState(true);
  const [withCacheExpanded, setWithCacheExpanded] = useState(true);
  const [staleDemo, setStaleDemo] = useState(null);
  const [demoGradeInput, setDemoGradeInput] = useState('9.9');
  const [iterations, setIterations] = useState(INITIAL_BENCHMARK_REPETITIONS);
  const [loading, setLoading] = useState(false);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [tradeoffLoading, setTradeoffLoading] = useState(false);
  const [error, setError] = useState('');

  const benchmarkScale = useMemo(() => {
    const withoutCache = benchmark?.withoutCache?.avgMs ?? 0;
    const withCache = benchmark?.withCache?.avgMs ?? 0;
    return Math.max(withoutCache, withCache, 1);
  }, [benchmark]);

  async function loadMetrics() {
    const payload = await apiFetch('/metrics');
    setMetrics(payload.data);
    setCache(payload.data.cache);
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
    refreshDashboard();
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

  async function resetTradeoffMap() {
    setTradeoffLoading(true);

    try {
      await handleAction(async () => {
        const payload = await apiFetch('/cache/clear', { method: 'POST' });
        setCache(payload.data);
        setStaleDemo(null);
        setDemoGradeInput('9.9');
      });
    } finally {
      setTradeoffLoading(false);
    }
  }

  async function primeTradeoffCache() {
    setTradeoffLoading(true);

    try {
      await handleAction(async () => {
        const payload = await apiFetch('/cache/stale-demo/prime', {
          method: 'POST',
          body: { studentId: staleDemo?.studentId }
        });
        const nextGrade = nextDemoGrade(payload.data.primedRead.gradeAverage);
        setStaleDemo(payload.data);
        setDemoGradeInput(formatGrade(nextGrade));
        setCache((current) => ({ ...current, enabled: true }));
      });
    } finally {
      setTradeoffLoading(false);
    }
  }

  async function editTradeoffDatabase() {
    const studentId = staleDemo?.studentId;
    if (!studentId) return;

    setTradeoffLoading(true);

    try {
      await handleAction(async () => {
        const payload = await apiFetch('/cache/stale-demo/edit', {
          method: 'POST',
          body: {
            studentId,
            gradeAverage: demoGradeInput
          }
        });
        setStaleDemo((current) => ({
          ...(current ?? {}),
          ...payload.data,
          stale: false
        }));
      });
    } finally {
      setTradeoffLoading(false);
    }
  }

  async function requestTradeoffAgain() {
    const studentId = staleDemo?.studentId;
    if (!studentId) return;

    setTradeoffLoading(true);

    try {
      await handleAction(async () => {
        const payload = await apiFetch('/cache/stale-demo/read', {
          method: 'POST',
          body: { studentId }
        });
        setStaleDemo((current) => ({
          ...(current ?? {}),
          ...payload.data
        }));
      });
    } finally {
      setTradeoffLoading(false);
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
  const hasPrimedRead = Boolean(staleDemo?.primedRead);
  const hasDatabaseWrite = Boolean(staleDemo?.databaseWrite);
  const hasCacheRead = Boolean(staleDemo?.cacheRead);
  const hasStaleRisk = Boolean(staleDemo?.stale);
  const targetStudent = staleDemo?.student
    ?? staleDemo?.databaseStudent
    ?? students.find((student) => student.id === staleDemo?.studentId)
    ?? students[0];
  const targetStudentLabel = targetStudent ? `${targetStudent.id} - ${targetStudent.name}` : '-';
  const tradeoffCacheKey = staleDemo?.cacheKey ?? (targetStudent ? `students:${targetStudent.id}` : '-');
  const primedGrade = hasPrimedRead
    ? formatGrade(staleDemo.primedRead.gradeAverage)
    : targetStudent
      ? formatGrade(targetStudent.gradeAverage)
      : '-';
  const cachedGrade = hasCacheRead
    ? formatGrade(staleDemo.cacheRead.gradeAverage)
    : hasPrimedRead
      ? formatGrade(staleDemo.primedRead.gradeAverage)
      : '-';
  const writtenGrade = hasDatabaseWrite ? formatGrade(staleDemo.databaseWrite.gradeAverage) : '-';
  const databaseGrade = staleDemo?.databaseRead
    ? formatGrade(staleDemo.databaseRead.gradeAverage)
    : hasDatabaseWrite
      ? writtenGrade
      : primedGrade;
  const gradeDelta = staleDemo?.databaseRead && staleDemo?.cacheRead
    ? Math.abs(Number(staleDemo.databaseRead.gradeAverage) - Number(staleDemo.cacheRead.gradeAverage)).toFixed(1)
    : '0.0';
  const tradeoffStage = hasStaleRisk
    ? 'stale'
    : hasCacheRead
      ? 'checked'
      : hasDatabaseWrite
        ? 'edited'
        : hasPrimedRead
          ? 'primed'
          : 'idle';
  const staleStatus = {
    idle: 'Comece no banco',
    primed: 'Redis preenchido',
    edited: 'Banco editado',
    checked: 'Consistente',
    stale: 'Cache antigo'
  }[tradeoffStage];
  const tradeoffOutcomeTitle = {
    idle: 'Clique no bloco 1 para carregar o registro padrao.',
    primed: 'Primeira requisicao buscou no banco e gravou no Redis.',
    edited: 'Banco mudou, mas o Redis ainda guarda o CR antigo.',
    checked: 'A nova requisicao esta consistente.',
    stale: 'Tradeoff visivel: a API retornou o dado antigo do Redis.'
  }[tradeoffStage];
  const tradeoffOutcomeText = {
    idle: 'O mapa mostra o caminho cache aside sem executar tudo de uma vez.',
    primed: `Chave ${tradeoffCacheKey} preenchida com CR ${primedGrade}.`,
    edited: `Banco agora esta em CR ${writtenGrade}; Redis continua em CR ${cachedGrade}.`,
    checked: staleDemo?.explanation ?? 'Cache e banco retornaram o mesmo valor.',
    stale: `Redis respondeu CR ${cachedGrade}, banco esta em CR ${databaseGrade}; diferenca de ${gradeDelta} CR.`
  }[tradeoffStage];

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

        <section className={`surface consistency-panel ${tradeoffLoading ? 'is-loading' : ''}`} aria-busy={tradeoffLoading}>
          {tradeoffLoading && (
            <div className="benchmark-loading tradeoff-loading" role="status" aria-live="polite">
              <div className="benchmark-spinner" />
              <strong>Movendo o mapa</strong>
              <span>Executando a etapa selecionada...</span>
            </div>
          )}
          <div className="section-heading">
            <div>
              <span className="eyebrow">Tradeoff</span>
              <h2>Mapa cache aside</h2>
            </div>
            <button onClick={resetTradeoffMap} disabled={loading} title="Reiniciar mapa">
              <RefreshCcw size={18} />
              Reiniciar
            </button>
          </div>

          <div className={`tradeoff-status ${hasStaleRisk ? 'is-stale' : tradeoffStage === 'checked' ? 'is-ok' : ''}`}>
            <div>
              <span>Aluno</span>
              <strong>{targetStudentLabel}</strong>
            </div>
            <div>
              <span>Chave Redis</span>
              <strong>{tradeoffCacheKey}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong>{staleStatus}</strong>
            </div>
          </div>

          <div className="tradeoff-map">
            <article className={`map-node is-database ${tradeoffStage === 'idle' ? 'is-active' : ''} ${hasPrimedRead ? 'is-done' : ''}`}>
              <header>
                <span>1</span>
                <Database size={20} />
                <b>Banco</b>
              </header>
              <strong>Registro padrao</strong>
              <p title={targetStudentLabel}>{targetStudentLabel}</p>
              <div className="map-value">
                <span>CR</span>
                <strong>{primedGrade}</strong>
              </div>
              <button className="primary-button map-action" onClick={primeTradeoffCache} disabled={loading || !students.length} title="Buscar no banco e preencher o Redis">
                <Play size={17} />
                {hasPrimedRead ? 'Buscar de novo' : 'Pegar do banco'}
              </button>
            </article>

            <div className={`map-arrow ${hasPrimedRead ? 'is-active' : ''}`} aria-hidden="true">
              <ArrowRight size={26} />
              <span>miss + set</span>
            </div>

            <article className={`map-node is-redis ${hasPrimedRead ? 'is-done' : ''} ${hasStaleRisk ? 'is-stale' : ''}`}>
              <header>
                <span>2</span>
                <Server size={20} />
                <b>Redis</b>
              </header>
              <strong>Cache preenchido</strong>
              <p title={tradeoffCacheKey}>{tradeoffCacheKey}</p>
              <div className="map-value">
                <span>CR salvo</span>
                <strong>{cachedGrade}</strong>
              </div>
              <div className="map-chip">{hasPrimedRead ? 'hit pronto' : 'vazio'}</div>
            </article>

            <div className={`map-arrow ${hasDatabaseWrite ? 'is-active' : ''}`} aria-hidden="true">
              <ArrowRight size={26} />
              <span>banco muda</span>
            </div>

            <article className={`map-node is-edit ${hasPrimedRead && !hasDatabaseWrite ? 'is-active' : ''} ${hasDatabaseWrite ? 'is-done' : ''}`}>
              <header>
                <span>3</span>
                <PencilLine size={20} />
                <b>Editar</b>
              </header>
              <strong>Alterar so no banco</strong>
              <p>Redis nao invalida nessa etapa.</p>
              <div className="map-editor">
                <label>
                  Novo CR
                  <input
                    type="number"
                    min="0"
                    max="10"
                    step="0.1"
                    value={demoGradeInput}
                    onChange={(event) => setDemoGradeInput(event.target.value)}
                    disabled={!hasPrimedRead || loading}
                  />
                </label>
                <button className="map-action" onClick={editTradeoffDatabase} disabled={loading || !hasPrimedRead} title="Editar o CR direto no banco">
                  <PencilLine size={17} />
                  Editar
                </button>
              </div>
              <div className="map-value">
                <span>Banco</span>
                <strong>{writtenGrade}</strong>
              </div>
            </article>

            <div className={`map-arrow ${hasCacheRead ? 'is-active' : ''}`} aria-hidden="true">
              <ArrowRight size={26} />
              <span>request</span>
            </div>

            <article className={`map-node is-request ${hasDatabaseWrite && !hasCacheRead ? 'is-active' : ''} ${hasCacheRead && !hasStaleRisk ? 'is-done' : ''} ${hasStaleRisk ? 'is-stale' : ''}`}>
              <header>
                <span>4</span>
                <Send size={20} />
                <b>API</b>
              </header>
              <strong>Requisitar de novo</strong>
              <p>{hasCacheRead ? `Fonte: ${staleDemo.cacheRead.source}` : 'A API consulta a mesma chave.'}</p>
              <div className="map-value">
                <span>Retorno</span>
                <strong>{hasCacheRead ? cachedGrade : '-'}</strong>
              </div>
              <button className="primary-button map-action" onClick={requestTradeoffAgain} disabled={loading || !hasDatabaseWrite} title="Consultar a mesma chave novamente">
                <Send size={17} />
                Requisitar
              </button>
            </article>
          </div>

          <div className={`tradeoff-callout ${hasStaleRisk ? 'is-stale' : tradeoffStage === 'checked' ? 'is-ok' : ''}`}>
            {hasStaleRisk ? <AlertTriangle size={22} /> : <Server size={22} />}
            <div>
              <strong>{tradeoffOutcomeTitle}</strong>
              <span>{tradeoffOutcomeText}</span>
            </div>
          </div>
        </section>


      </main>
    </div>
  );
}

export default App;


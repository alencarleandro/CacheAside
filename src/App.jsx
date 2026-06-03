import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Code2,
  Play,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Trash2
} from 'lucide-react';
import { apiFetch } from './api.js';
import CacheAsideMark from './CacheAsideMark.jsx';

const emptyForm = {
  name: '',
  email: '',
  course: 'Engenharia de Software',
  period: 5,
  gradeAverage: 8
};

const hiddenEventTypes = new Set(['redis', 'redis-error', 'database', 'database-error']);

const cacheAsideSnippet = `const cached = await client.get(cacheKey);
if (cached) {
  recordCacheHit(label);
  return JSON.parse(cached);
}

recordCacheMiss(label);
const data = await loader();
await client.set(cacheKey, JSON.stringify(data), { EX: ttl });`;

const invalidationSnippet = `await client.del([
  "students:list",
  \`students:\${id}\`
]);

// Toda escrita invalida o cache relacionado
// para evitar leitura de dado antigo.`;

function formatMs(value) {
  return `${Number(value || 0).toFixed(1)} ms`;
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

function sourceLabel(meta) {
  if (meta?.source === 'cache') return 'cache';
  if (meta?.source === 'database') return 'banco';
  return 'api';
}

function CodeBlock({ title, children }) {
  return (
    <article className="code-card">
      <div>
        <Code2 size={18} />
        <strong>{title}</strong>
      </div>
      <pre>
        <code>{children}</code>
      </pre>
    </article>
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

function ConsistencyValue({ label, value, tone = 'neutral' }) {
  return (
    <div className={`consistency-value tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function App() {
  const [students, setStudents] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [cache, setCache] = useState({ enabled: true, size: 0, keys: [] });
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [lastRequest, setLastRequest] = useState(null);
  const [benchmark, setBenchmark] = useState(null);
  const [benchmarkExpanded, setBenchmarkExpanded] = useState(false);
  const [staleDemo, setStaleDemo] = useState(null);
  const [iterations, setIterations] = useState(12);
  const [loading, setLoading] = useState(false);
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
    setLastRequest(payload.meta);
    await loadMetrics();
  }

  async function refreshDashboard() {
    setError('');
    try {
      await loadStudents();
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refreshDashboard();
  }, []);

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function startEdit(student) {
    setEditingId(student.id);
    setForm({
      name: student.name,
      email: student.email,
      course: student.course,
      period: student.period,
      gradeAverage: student.gradeAverage
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

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

  async function saveStudent(event) {
    event.preventDefault();
    await handleAction(async () => {
      const path = editingId ? `/students/${editingId}` : '/students';
      const method = editingId ? 'PUT' : 'POST';
      await apiFetch(path, { method, body: form });
      resetForm();
      await loadStudents();
    });
  }

  async function deleteStudent(id) {
    await handleAction(async () => {
      await apiFetch(`/students/${id}`, { method: 'DELETE' });
      if (selectedStudent?.id === id) setSelectedStudent(null);
      await loadStudents();
    });
  }

  async function patchGrade(student) {
    await handleAction(async () => {
      const nextGrade = Math.min(10, Number(student.gradeAverage) + 0.1).toFixed(1);
      await apiFetch(`/students/${student.id}`, {
        method: 'PATCH',
        body: { gradeAverage: nextGrade }
      });
      await loadStudents();
    });
  }

  async function fetchHotStudent() {
    const target = students[0]?.id;
    if (!target) return;

    await handleAction(async () => {
      const payload = await apiFetch(`/students/${target}`);
      setSelectedStudent(payload.data);
      setLastRequest(payload.meta);
    });
  }

  async function runBurst() {
    const target = students[0]?.id;
    if (!target) return;

    await handleAction(async () => {
      let lastPayload = null;
      for (let index = 0; index < 6; index += 1) {
        lastPayload = await apiFetch(`/students/${target}`);
      }
      setSelectedStudent(lastPayload.data);
      setLastRequest(lastPayload.meta);
    });
  }

  async function clearCurrentCache() {
    await handleAction(async () => {
      const payload = await apiFetch('/cache/clear', { method: 'POST' });
      setCache(payload.data);
      setStaleDemo((current) => (current ? { ...current, repaired: true } : current));
    });
  }

  async function resetMetrics() {
    await handleAction(async () => {
      const payload = await apiFetch('/metrics/reset', { method: 'POST' });
      setMetrics(payload.data);
      setCache(payload.data.cache);
      setBenchmark(null);
      setStaleDemo(null);
      setLastRequest(null);
    });
  }

  async function runBenchmark() {
    await handleAction(async () => {
      const payload = await apiFetch('/benchmark', {
        method: 'POST',
        body: { iterations }
      });
      setBenchmark(payload.data);
      await loadMetrics();
    });
  }

  async function runStaleDemo() {
    await handleAction(async () => {
      const payload = await apiFetch('/cache/stale-demo', {
        method: 'POST',
        body: {}
      });
      setStaleDemo(payload.data);
      await loadMetrics();
      setCache((current) => ({ ...current, enabled: true }));
    });
  }

  const visibleEvents = (metrics?.events ?? []).filter((event) => !hiddenEventTypes.has(event.type));
  const benchmarkDetailEvents = (metrics?.events ?? [])
    .filter((event) => ['cache-hit', 'cache-miss', 'database-read'].includes(event.type))
    .slice(0, 12);
  const totalBenchmarkRequests = (benchmark?.withoutCache?.requests ?? 0) + (benchmark?.withCache?.requests ?? 0);
  const benchmarkSpeedupFactor = benchmarkSpeedup(benchmark);
  const staleStatus = staleDemo?.repaired ? 'Cache limpo' : staleDemo?.stale ? 'Inconsistencia detectada' : 'Aguardando teste';

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
        <section className="surface benchmark-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Comparativo</span>
              <h2>Benchmark controlado</h2>
            </div>
            <div className="inline-controls">
              <label>
                Repetições
                <input
                  type="number"
                  min="4"
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
            measure="Roda as mesmas leituras duas vezes: primeiro com cache desligado, depois com cache ligado."
            result="Compare as barras. A diferenca e o ganho de latencia do Cache Aside."
          />

          <div className="comparison-bars">
            <div className="bar-row">
              <span>Sem cache</span>
              <div className="bar-track">
                <div
                  className="bar-fill no-cache"
                  style={{ width: `${((benchmark?.withoutCache?.avgMs ?? 0) / benchmarkScale) * 100}%` }}
                />
              </div>
              <strong>{formatMs(benchmark?.withoutCache?.avgMs)}</strong>
            </div>
            <div className="bar-row">
              <span>Com cache</span>
              <div className="bar-track">
                <div
                  className="bar-fill with-cache"
                  style={{ width: `${((benchmark?.withCache?.avgMs ?? 0) / benchmarkScale) * 100}%` }}
                />
              </div>
              <strong>{formatMs(benchmark?.withCache?.avgMs)}</strong>
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
              <span>Vezes mais rapida</span>
              <strong>{formatSpeedup(benchmarkSpeedupFactor)}</strong>
            </div>
          </div>

          <button
            className="expand-button"
            type="button"
            onClick={() => setBenchmarkExpanded((current) => !current)}
            aria-expanded={benchmarkExpanded}
            title={benchmarkExpanded ? 'Recolher detalhes' : 'Expandir detalhes'}
          >
            {benchmarkExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>

          {benchmarkExpanded && (
            <div className="benchmark-details">
              <div className="detail-metrics">
                <div>
                  <span>Sem cache</span>
                  <strong>{benchmark?.withoutCache?.requests ?? 0}</strong>
                </div>
                <div>
                  <span>Com cache</span>
                  <strong>{benchmark?.withCache?.requests ?? 0}</strong>
                </div>
                <div>
                  <span>Cache hits</span>
                  <strong>{metrics?.cacheHits ?? 0}</strong>
                </div>
                <div>
                  <span>Cache misses</span>
                  <strong>{metrics?.cacheMisses ?? 0}</strong>
                </div>
                <div>
                  <span>Taxa hit</span>
                  <strong>{Number(metrics?.cacheHitRate ?? 0).toFixed(1)}%</strong>
                </div>
                <div>
                  <span>Backend</span>
                  <strong>{cache.backend ?? 'cache'}</strong>
                </div>
              </div>

              <ol className="benchmark-trace">
                {benchmarkDetailEvents.map((event) => (
                  <li key={event.id}>
                    <span className={`event-dot event-${event.type}`} />
                    <div>
                      <strong>{event.message}</strong>
                      <time>{new Date(event.at).toLocaleTimeString('pt-BR')}</time>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>

        <section className="surface consistency-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Inconsistencia</span>
              <h2>Trade-off: performance x consistencia</h2>
            </div>
            <button className="primary-button" onClick={runStaleDemo} disabled={loading || !students.length} title="Simular cache inconsistente">
              <AlertTriangle size={18} />
              Simular
            </button>
          </div>

          <FocusNote
            measure="Cacheia um aluno, altera o banco direto sem invalidar e consulta a mesma chave novamente."
            result="O ganho de velocidade vem com um custo: se a invalidacao falhar, o cache pode entregar dado antigo."
          />

          <div className="tradeoff-summary">
            <div>
              <strong>Ganho</strong>
              <span>menos latencia e menos leitura no banco</span>
            </div>
            <div>
              <strong>Custo</strong>
              <span>risco de dado antigo ate invalidar, limpar ou expirar o TTL</span>
            </div>
          </div>

          <div className={`stale-banner ${staleDemo?.stale && !staleDemo?.repaired ? 'is-stale' : ''}`}>
            <strong>{staleStatus}</strong>
            <span>{staleDemo?.cacheKey ?? 'Clique em simular para criar uma inconsistencia controlada.'}</span>
          </div>

          <div className="consistency-values">
            <ConsistencyValue
              label="Cache respondeu"
              value={staleDemo ? `CR ${Number(staleDemo.cacheRead.gradeAverage).toFixed(1)}` : '-'}
              tone={staleDemo?.stale && !staleDemo?.repaired ? 'stale' : 'neutral'}
            />
            <ConsistencyValue
              label="Banco esta"
              value={staleDemo ? `CR ${Number(staleDemo.databaseRead.gradeAverage).toFixed(1)}` : '-'}
              tone="fresh"
            />
          </div>

          <div className="consistency-flow">
            <span>1. Leitura preenche o cache</span>
            <span>2. Banco muda sem invalidar</span>
            <span>3. Cache pode devolver dado antigo</span>
          </div>

          <button className="repair-button" onClick={clearCurrentCache} disabled={loading || !staleDemo} title="Limpar cache e corrigir a inconsistencia">
            <Trash2 size={18} />
            Corrigir limpando cache
          </button>
        </section>

        <section className="surface controls-panel">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">Operação</span>
              <h2>API em tempo real</h2>
            </div>
            <span className={`source-pill source-${lastRequest?.source ?? 'api'} backend-${lastRequest?.cacheBackend ?? 'none'}`}>
              {sourceLabel(lastRequest)}
              {lastRequest?.elapsedMs ? ` · ${formatMs(lastRequest.elapsedMs)}` : ''}
            </span>
          </div>

          <div className="command-grid">
            <button onClick={loadStudents} disabled={loading} title="Listar alunos">
              <RefreshCcw size={18} />
              Listar
            </button>
            <button onClick={fetchHotStudent} disabled={loading || !students.length} title="Consultar aluno individual">
              <Search size={18} />
              Buscar aluno
            </button>
            <button onClick={runBurst} disabled={loading || !students.length} title="Gerar leituras repetidas">
              <BarChart3 size={18} />
              Leituras repetidas
            </button>
            <button onClick={clearCurrentCache} disabled={loading} title="Limpar cache">
              <Trash2 size={18} />
              Limpar cache
            </button>
            <button onClick={resetMetrics} disabled={loading} title="Zerar metricas">
              <RefreshCcw size={18} />
              Zerar métricas
            </button>
          </div>

          <div className="cache-state">
            <div>
              <span>Chaves no cache</span>
              <strong>{cache.size ?? 0}</strong>
            </div>
            <div>
              <span>Invalidações</span>
              <strong>{metrics?.invalidations ?? 0}</strong>
            </div>
            <div>
              <span>TTL</span>
              <strong>{cache.ttlSeconds ?? 45}s</strong>
            </div>
          </div>

          {selectedStudent && (
            <div className="selected-student">
              <span>Aluno consultado</span>
              <strong>{selectedStudent.name}</strong>
              <small>{selectedStudent.course}</small>
            </div>
          )}
        </section>

        <section className="surface form-panel">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">CRUD</span>
              <h2>{editingId ? 'Editar aluno' : 'Cadastrar aluno'}</h2>
            </div>
          </div>
          <form onSubmit={saveStudent} className="student-form">
            <label>
              Nome
              <input value={form.name} onChange={(event) => updateForm('name', event.target.value)} required />
            </label>
            <label>
              E-mail
              <input type="email" value={form.email} onChange={(event) => updateForm('email', event.target.value)} required />
            </label>
            <label>
              Curso
              <input value={form.course} onChange={(event) => updateForm('course', event.target.value)} required />
            </label>
            <div className="form-pair">
              <label>
                Período
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={form.period}
                  onChange={(event) => updateForm('period', event.target.value)}
                />
              </label>
              <label>
                CR
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  value={form.gradeAverage}
                  onChange={(event) => updateForm('gradeAverage', event.target.value)}
                />
              </label>
            </div>
            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={loading} title={editingId ? 'Salvar com PUT' : 'Cadastrar com POST'}>
                {editingId ? <Save size={18} /> : <Plus size={18} />}
                {editingId ? 'Salvar PUT' : 'Cadastrar POST'}
              </button>
              {editingId && (
                <button type="button" onClick={resetForm} disabled={loading} title="Cancelar edicao">
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="surface students-panel">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">Dados</span>
              <h2>Alunos</h2>
            </div>
            <span>{students.length} registros</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Curso</th>
                  <th>Período</th>
                  <th>CR</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id}>
                    <td>
                      <strong>{student.name}</strong>
                      <span>{student.email}</span>
                    </td>
                    <td>{student.course}</td>
                    <td>{student.period}</td>
                    <td>{Number(student.gradeAverage).toFixed(1)}</td>
                    <td>
                      <div className="row-actions">
                        <button onClick={() => startEdit(student)} disabled={loading} title="Editar aluno">
                          <Save size={16} />
                        </button>
                        <button onClick={() => patchGrade(student)} disabled={loading} title="PATCH no CR">
                          <Activity size={16} />
                        </button>
                        <button onClick={() => deleteStudent(student.id)} disabled={loading} title="Remover aluno">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="surface events-panel">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">Observabilidade</span>
              <h2>Eventos</h2>
            </div>
          </div>
          <ol className="event-list">
            {visibleEvents.map((event) => (
              <li key={event.id}>
                <span className={`event-dot event-${event.type}`} />
                <div>
                  <strong>{event.message}</strong>
                  <time>{new Date(event.at).toLocaleTimeString('pt-BR')}</time>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="surface code-panel">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">Implementacao</span>
              <h2>Onde as metricas nascem</h2>
            </div>
          </div>
          <div className="code-grid">
            <CodeBlock title="Leitura com cache">
              {cacheAsideSnippet}
            </CodeBlock>
            <CodeBlock title="Invalidacao apos escrita">
              {invalidationSnippet}
            </CodeBlock>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;

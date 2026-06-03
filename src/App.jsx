import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Code2,
  Database,
  Gauge,
  Layers,
  Play,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Trash2,
  Zap
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

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatInteger(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function sourceLabel(meta) {
  if (meta?.source === 'cache') return 'cache';
  if (meta?.source === 'database') return 'banco';
  return 'api';
}

function MetricTile({ icon: Icon, label, value, tone = 'neutral' }) {
  return (
    <article className={`metric-tile tone-${tone}`}>
      <div className="metric-icon">
        <Icon size={19} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function StatusPill({ label, value }) {
  return (
    <div className="status-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FlowStep({ number, title, detail, tone = 'default' }) {
  return (
    <article className={`flow-step tone-${tone}`}>
      <span>{number}</span>
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
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

function ModuleNote({ measure, meaning }) {
  return (
    <div className="module-note">
      <div>
        <strong>Como mede</strong>
        <span>{measure}</span>
      </div>
      <div>
        <strong>O que mostra</strong>
        <span>{meaning}</span>
      </div>
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

  async function toggleCache() {
    await handleAction(async () => {
      const payload = await apiFetch('/cache', {
        method: 'PATCH',
        body: { enabled: !cache.enabled }
      });
      setCache(payload.data);
    });
  }

  async function clearCurrentCache() {
    await handleAction(async () => {
      const payload = await apiFetch('/cache/clear', { method: 'POST' });
      setCache(payload.data);
    });
  }

  async function resetMetrics() {
    await handleAction(async () => {
      const payload = await apiFetch('/metrics/reset', { method: 'POST' });
      setMetrics(payload.data);
      setCache(payload.data.cache);
      setBenchmark(null);
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

  const responseWithCache = benchmark?.withCache?.avgMs ?? metrics?.responses?.cacheOn?.avgMs ?? 0;
  const responseWithoutCache = benchmark?.withoutCache?.avgMs ?? metrics?.responses?.cacheOff?.avgMs ?? 0;
  const liveImprovement = responseWithoutCache
    ? ((responseWithoutCache - responseWithCache) / responseWithoutCache) * 100
    : benchmark?.improvementPercent ?? 0;
  const visibleEvents = (metrics?.events ?? []).filter((event) => !hiddenEventTypes.has(event.type));
  const totalBenchmarkRequests = (benchmark?.withoutCache?.requests ?? 0) + (benchmark?.withCache?.requests ?? 0);
  const estimatedDbReadsAvoided = metrics?.cacheHits ?? 0;
  const cacheBackendLabel = cache.backend === 'redis' ? 'Redis' : 'Memória';
  const databaseBackendLabel = metrics?.database?.backend === 'postgres' ? 'Postgres' : 'JSON local';
  const benchmarkReadiness = benchmark
    ? `${formatInteger(totalBenchmarkRequests)} leituras medidas`
    : 'Execute o benchmark';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-title">
          <CacheAsideMark className="cache-aside-mark" />
          <div>
            <h1>Cache Aside</h1>
          </div>
        </div>

        <button className={`cache-toggle ${cache.enabled ? 'is-on' : ''}`} onClick={toggleCache} disabled={loading} title="Ativar ou desativar cache">
          <span className="toggle-track">
            <span className="toggle-thumb" />
          </span>
          <span>{cache.enabled ? 'Cache ligado' : 'Cache desligado'}</span>
        </button>
      </header>

      {error && <div className="alert">{error}</div>}

      <section className="metrics-grid" aria-label="Metricas principais">
        <MetricTile icon={Gauge} label="Media com cache" value={formatMs(responseWithCache)} tone="red" />
        <MetricTile icon={Database} label="Media sem cache" value={formatMs(responseWithoutCache)} tone="dark" />
        <MetricTile icon={Zap} label="Melhoria" value={formatPercent(liveImprovement)} tone="yellow" />
        <MetricTile icon={Activity} label="Hit rate" value={formatPercent(metrics?.cacheHitRate)} tone="red" />
        <MetricTile icon={Layers} label="Hits / misses" value={`${metrics?.cacheHits ?? 0} / ${metrics?.cacheMisses ?? 0}`} tone="pink" />
        <MetricTile icon={Database} label="Consultas ao banco" value={metrics?.dbReads ?? 0} tone="neutral" />
      </section>

      <section className="surface metrics-explanation">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">Resumo das metricas</span>
            <h2>Como ler os numeros principais</h2>
          </div>
        </div>
        <ModuleNote
          measure="Os cards acumulam respostas reais da API; depois do benchmark, as medias com e sem cache usam as fases controladas do teste."
          meaning="Mostra latencia, hit rate, misses, leituras no banco e quanto o cache reduziu o tempo medio das consultas."
        />
      </section>

      <section className="presentation-grid">
        <section className="surface architecture-panel">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">Arquitetura</span>
              <h2>Cache Aside em execução</h2>
            </div>
            <span className="source-pill">{benchmarkReadiness}</span>
          </div>
          <ModuleNote
            measure="Cada GET passa por uma chave de cache; hits, misses e leituras no banco sao registrados pela API."
            meaning="Mostra o fluxo do padrao: consultar cache, buscar no banco no miss, preencher cache e responder rapido no hit."
          />

          <div className="status-grid">
            <StatusPill label="Cache ativo" value={cache.enabled ? 'Sim' : 'Não'} />
            <StatusPill label="Backend do cache" value={cacheBackendLabel} />
            <StatusPill label="Banco principal" value={databaseBackendLabel} />
            <StatusPill label="Leituras evitadas" value={formatInteger(estimatedDbReadsAvoided)} />
          </div>

          <div className="flow-grid">
            <FlowStep number="1" title="API consulta o cache" detail="GET /students ou /students/:id monta a chave da leitura." />
            <FlowStep number="2" title="Cache miss" detail="Se a chave não existe, a API busca no banco." tone="miss" />
            <FlowStep number="3" title="Preenche o cache" detail="O resultado vai para o cache com TTL configurado." tone="fill" />
            <FlowStep number="4" title="Cache hit" detail="As próximas leituras retornam do cache e poupam o banco." tone="hit" />
          </div>
        </section>

        <section className="surface interpretation-panel">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">Leitura dos dados</span>
              <h2>O que mostrar para a turma</h2>
            </div>
          </div>
          <ModuleNote
            measure="Este modulo resume os sinais da execucao: origem da resposta, repeticao de leitura e invalidacao apos escrita."
            meaning="Ajuda a explicar o trade-off: o cache melhora performance, mas exige controle de consistencia e observabilidade."
          />

          <div className="talking-points">
            <div>
              <strong>Sem cache</strong>
              <span>Cada consulta repetida acessa o banco, aumentando latência e carga.</span>
            </div>
            <div>
              <strong>Com cache</strong>
              <span>A primeira leitura gera miss; as próximas viram hit e retornam muito mais rápido.</span>
            </div>
            <div>
              <strong>Consistência</strong>
              <span>POST, PUT, PATCH e DELETE invalidam as chaves afetadas para evitar dado antigo.</span>
            </div>
          </div>
        </section>
      </section>

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
          <ModuleNote
            measure="O endpoint /api/benchmark executa duas fases: cache desligado e cache ligado, repetindo as mesmas leituras de aluno e lista."
            meaning="As barras exibem tempo medio por requisicao. O ganho medio e a diferenca entre as duas fases."
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
              <span>Requisições</span>
              <strong>{(benchmark?.withoutCache?.requests ?? 0) + (benchmark?.withCache?.requests ?? 0)}</strong>
            </div>
            <div>
              <span>Ganho médio</span>
              <strong>{formatMs(benchmark?.improvementMs)}</strong>
            </div>
            <div>
              <span>Percentual</span>
              <strong>{formatPercent(benchmark?.improvementPercent)}</strong>
            </div>
          </div>
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

          <ModuleNote
            measure="Cada botao dispara uma chamada real na API. O selo no canto mostra a origem da ultima resposta e o tempo da requisicao."
            meaning="Demonstra miss na primeira leitura, hit nas repetidas, limpeza manual e diferenca quando o cache esta desligado."
          />

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
          <ModuleNote
            measure="POST, PUT, PATCH e DELETE gravam no banco e invalidam as chaves de lista e aluno individual."
            meaning="Mostra a consistencia do Cache Aside: depois de mudar dados, a proxima leitura nao pode usar cache antigo."
          />

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
          <ModuleNote
            measure="A tabela vem de GET /api/students. A primeira listagem tende a gerar miss; as proximas tendem a vir do cache."
            meaning="Mostra a entidade real do dominio e a consulta repetida que mais se beneficia do Cache Aside."
          />

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
          <ModuleNote
            measure="A API registra eventos de cache hit, cache miss, consulta ao banco, escrita, invalidacao e benchmark."
            meaning="Funciona como uma linha do tempo para provar o comportamento do padrao durante a apresentacao."
          />

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
          <ModuleNote
            measure="Os trechos abaixo sao os pontos onde a API mede hit/miss e onde remove cache apos escrita."
            meaning="Conecta os numeros do dashboard com as decisoes de arquitetura implementadas no backend."
          />
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

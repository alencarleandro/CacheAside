<div align="center">

<p>
  <img src="https://raw.githubusercontent.com/alencarleandro/CacheAside/3c6f78e9676709f4743b6cdfd8c57bafb1f9b090/docs/redis-cache-aside.svg" width="100" alt="Redis Cache Aside" />
</p>

# Cache Aside

API REST + dashboard React para demonstrar, medir e explicar o padrao arquitetural Cache Aside em uma aplicacao academica.

![Cache Aside](https://img.shields.io/badge/Cache%20Aside-Arquitetura-D92D20?style=for-the-badge)
![React](https://img.shields.io/badge/React-Frontend-111827?style=for-the-badge&logo=react)
![Node.js](https://img.shields.io/badge/Node.js-API-2B211F?style=for-the-badge&logo=node.js)
![Redis](https://img.shields.io/badge/Redis%20Compatible-Cache-D92D20?style=for-the-badge&logo=redis)
![Postgres](https://img.shields.io/badge/Postgres-Banco-725F5B?style=for-the-badge&logo=postgresql)

[Deploy no Render](https://cacheaside.onrender.com)

</div>

---

## Visao Geral

Este projeto foi criado para uma apresentacao de Engenharia de Software sobre **Cache Aside** e performance de APIs.

A aplicacao simula uma API academica de alunos com CRUD completo e mostra, em tempo real, a diferenca entre consultas com cache e sem cache. O foco nao e apenas "ter cache", mas demonstrar o impacto arquitetural em latencia, carga no banco, consistencia e invalidacao.

<p align="center">
  <img src="img/Site.png" width="1100" alt="Tela do laboratorio Cache Aside com benchmark, dados do Redis e workflow n8n" />
</p>

## O Que Da Para Demonstrar

- CRUD REST completo com `POST`, `GET`, `PUT`, `PATCH` e `DELETE`.
- Cache Aside em consultas frequentes de lista e aluno individual.
- Controle por aluno para usar cache ou forcar cache miss durante a apresentacao.
- Benchmark comparando tempo medio com cache e sem cache.
- Contadores de cache hit, cache miss, leituras no banco e invalidacoes.
- Invalidação de cache apos escrita para evitar dado antigo.
- Uso de Redis/Key Value quando configurado, com fallback em memoria.
- Uso de Postgres/Supabase como banco principal, com fallback para JSON local.

## Arquitetura

<p align="center">
  <img src="img/diagramaArquitetural.PNG" width="900" alt="Diagrama arquitetural com Web e Mobile acessando o servico de alunos e o n8n no Render, integrados ao Supabase e Redis" />
</p>

## Como o Cache Aside Funciona Aqui

1. A API recebe uma consulta, por exemplo `GET /api/students`.
2. Se o cache estiver ligado, a API consulta primeiro a chave `students:list`.
3. Se encontrar o dado, ocorre **cache hit** e a resposta volta sem acessar o banco.
4. Se nao encontrar, ocorre **cache miss**.
5. A API consulta o banco, salva o resultado no cache com TTL e retorna ao usuario.
6. Em `POST`, `PUT`, `PATCH` ou `DELETE`, as chaves relacionadas sao invalidadas.

## Trecho Principal do Cache

Arquivo: `server/cache.js`

```js
const cached = await client.get(fullKey);

if (cached) {
  recordCacheHit(label);
  return {
    data: JSON.parse(cached),
    source: 'cache',
    cacheBackend: 'redis',
    cacheKey: key
  };
}

recordCacheMiss(label);
const data = await loader();

await client.set(fullKey, JSON.stringify(data), {
  EX: DEFAULT_TTL_SECONDS
});
```

## Invalidação Apos Escrita

Arquivo: `server/studentsService.js`

```js
async function invalidateStudentCache(id, reason) {
  await invalidateKeys(['students:list', `students:${id}`], reason);
}
```

Essa decisao e importante porque Cache Aside melhora desempenho, mas exige cuidado com consistencia. Toda escrita remove as leituras antigas do cache.

## Rodando Localmente

```bash
npm install
npm run dev
```

URLs locais:

- Frontend: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:3001/api`

Para servir o build de producao pela propria API:

```bash
npm run build
npm run start
```

## Variaveis de Ambiente

Crie um arquivo `.env` com base no `.env.example`.

```env
REDIS_URL=redis://localhost:6379
CACHE_TTL_SECONDS=45
CACHE_NAMESPACE=cache-aside:students
CACHE_DIRECT_PATTERNS=students:*,redis:students:*
DATABASE_URL=postgresql://postgres.PROJECT_REF:SUA_SENHA@HOST_POOLER_SUPABASE:6543/postgres?pgbouncer=true
DATABASE_SSL=true
DATABASE_ALLOW_JSON_FALLBACK=false
```

### Observacoes

- Se `REDIS_URL` nao estiver configurada ou falhar, o projeto usa cache em memoria.
- `CACHE_DIRECT_PATTERNS=students:*,redis:students:*` faz o painel tambem enxergar chaves salvas direto pelo n8n, como `students:1`, alem das chaves internas com namespace.
- Se `DATABASE_URL` nao estiver configurada, o projeto usa o JSON local em `server/data/students.json`.
- Se `DATABASE_URL` estiver configurada e falhar, a API nao usa JSON local por padrao. Para liberar fallback em dev, defina `DATABASE_ALLOW_JSON_FALLBACK=true`.
- No Render com Supabase, use a connection string do **pooler** do Supabase. A URL direta `db.<projeto>.supabase.co:5432` pode falhar por IPv6.

## Deploy no Render

Configuracao recomendada para **Web Service**:

| Campo | Valor |
| --- | --- |
| Language | `Node` |
| Branch | `main` |
| Root Directory | vazio |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm run start` |

Variaveis no Render:

```env
REDIS_URL=URL_DO_KEY_VALUE_DO_RENDER
REDIS_USERNAME=
REDIS_PASSWORD=SENHA_DO_KEY_VALUE_DO_RENDER
CACHE_TTL_SECONDS=45
CACHE_NAMESPACE=cache-aside:students
CACHE_DIRECT_PATTERNS=students:*,redis:students:*
DATABASE_URL=postgresql://postgres.PROJECT_REF:SUA_SENHA@HOST_POOLER_SUPABASE:6543/postgres?pgbouncer=true
DATABASE_SSL=true
DATABASE_ALLOW_JSON_FALLBACK=false
```

Se a URL do Redis ja incluir usuario e senha, deixe `REDIS_USERNAME` e `REDIS_PASSWORD` vazios.
Se nao quiser Redis externo no Render, deixe `REDIS_URL` vazio e o app usa memoria.

## Endpoints Principais

| Metodo | Endpoint | Objetivo |
| --- | --- | --- |
| `GET` | `/api/health` | Verificar status da API, cache e banco |
| `GET` | `/api/students` | Listar alunos com Cache Aside |
| `GET` | `/api/students/:id` | Consultar aluno individual |
| `POST` | `/api/students` | Criar aluno e invalidar cache |
| `PUT` | `/api/students/:id` | Substituir aluno e invalidar cache |
| `PATCH` | `/api/students/:id` | Atualizar parte do aluno e invalidar cache |
| `DELETE` | `/api/students/:id` | Remover aluno e invalidar cache |
| `PATCH` | `/api/cache` | Ligar ou desligar cache |
| `POST` | `/api/cache/clear` | Limpar cache manualmente |
| `GET` | `/api/metrics` | Consultar metricas da demonstracao |
| `POST` | `/api/benchmark` | Executar comparativo com e sem cache |

## Roteiro Para Apresentacao

1. Abra o dashboard.
2. Clique em **Zerar metricas**.
3. Clique em **Listar** uma vez e mostre o cache miss.
4. Clique em **Listar** de novo e mostre o cache hit.
5. Use **Leituras repetidas** para aumentar o hit rate.
6. Rode o **Benchmark controlado** e compare as barras.
7. Edite um aluno com `PATCH` e mostre a invalidacao.
8. Rode a consulta de novo e explique por que o primeiro acesso volta ao banco.

## Discussao Arquitetural

| Tema | O que discutir |
| --- | --- |
| Performance | Leituras repetidas deixam de bater no banco |
| Consistencia | Escritas invalidam chaves relacionadas |
| Complexidade | O sistema precisa controlar TTL, falhas e invalidacao |
| Resiliencia | Redis e Postgres possuem fallback para manter a demo ativa |
| Observabilidade | O painel mostra hit, miss, tempo medio e consultas ao banco |

## Tecnologias

- React
- Vite
- Node.js
- Express
- Redis compatible cache
- Postgres/Supabase
- Render

---

<div align="center">

**Tema visual:** vermelho inspirado no ecossistema Redis, aplicado ao dashboard e aos indicadores de cache.

</div>

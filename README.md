# Cache Aside e Performance de APIs

Projeto academico em React + Node.js para demonstrar o padrao arquitetural Cache Aside em uma API RESTful de alunos.

## Como rodar

```bash
npm install
npm run dev
```

- Frontend: http://127.0.0.1:5173
- API: http://127.0.0.1:3001/api

Para usar Redis local, configure o arquivo `.env` com:

```bash
REDIS_URL=redis://localhost:6379
CACHE_TTL_SECONDS=45
CACHE_NAMESPACE=cache-aside:students
```

Para usar Supabase/Postgres como banco principal, configure:

```bash
DATABASE_URL=postgres://postgres:SUA_SENHA@db.seu-projeto.supabase.co:5432/postgres
DATABASE_SSL=true
```

## O que o projeto demonstra

- CRUD completo de alunos com `POST`, `GET`, `PUT`, `PATCH` e `DELETE`.
- Cache Aside em consultas frequentes de lista e aluno individual usando Redis, com fallback em memoria.
- Banco principal em Postgres/Supabase, com fallback para JSON local.
- Alternancia entre cache ligado e cache desligado.
- Cache hit, cache miss e invalidacao apos escrita.
- Tempo medio com cache e sem cache.
- Quantidade de consultas atendidas pelo cache e pelo banco.
- Benchmark comparativo com leituras repetidas.

## Arquitetura

```mermaid
flowchart LR
  UI[React Dashboard] --> API[Node.js / Express API]
  API --> C{Cache ligado?}
  C -->|Sim| M[Redis / fallback em memoria]
  M -->|Hit| API
  M -->|Miss| DB[Postgres / fallback JSON]
  C -->|Nao| DB
  DB --> API
  API --> UI
```

O banco principal pode ser o Postgres do Supabase. O JSON local fica como fallback para a apresentacao continuar funcionando se a rede ou o banco externo estiverem indisponiveis. O cache usa Redis quando configurado e tambem possui fallback em memoria.

## Endpoints principais

- `GET /api/students`
- `GET /api/students/:id`
- `POST /api/students`
- `PUT /api/students/:id`
- `PATCH /api/students/:id`
- `DELETE /api/students/:id`
- `PATCH /api/cache`
- `POST /api/cache/clear`
- `GET /api/metrics`
- `POST /api/metrics/reset`
- `POST /api/benchmark`

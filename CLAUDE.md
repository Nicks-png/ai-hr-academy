# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Visão geral

Plataforma B2B de recrutamento com IA para o **Pullman Ibirapuera** (hotel SP). Realiza triagem automatizada de candidatos via LLM, gestão de candidatos via banco SQLite (Turso/libSQL) e disparo de mensagens pelo WhatsApp (Baileys).

## Comandos

```bash
npm install
npm start          # node server.js — porta definida em .env (PORT=3000) ou fallback 3002
npm run tunnel     # Tunnel Cloudflare (Windows)
```

**Credenciais de desenvolvimento:** `admin@pullman.com` / `admin123` (role: `admin`) — novo install. DB existente mantém `admin@accor.com`.

## Estrutura do projeto

```
ai-hr-academy/
├── server.js              # Entry point Express (porta 3000 local / 10000 Render)
├── db.js                  # SQLite via better-sqlite3 + migrações automáticas
├── wa.js                  # Conector WhatsApp Baileys (raiz — não usado pelo server)
├── render.yaml            # Config de deploy no Render
├── public/
│   ├── login.html         # Autenticação JWT
│   ├── intranet.html      # Hub principal pós-login (pipeline, stats, ferramentas)
│   ├── triagem.html       # Triagem de candidatos (SSE streaming)
│   ├── email.html         # Formalizar e-mail de processo seletivo via IA
│   ├── contato.html       # Comunicação com candidatos aprovados
│   ├── whatsapp.html      # Painel WhatsApp (respostas, grupos por vaga)
│   ├── cursos.html        # Catálogo de cursos gratuitos de IA
│   ├── curriculo.html     # Avaliador de CV individual via IA
│   ├── candidato.html     # Portal público de inscrição orgânica
│   ├── selecao.html       # Gestão de candidatos no funil
│   ├── admin.html         # Painel admin (usuários, permissões, moderação)
│   ├── vagas-abertas.html # Portal público de vagas abertas
│   ├── css/base.css       # Design system global (vars, botões, inputs, nav, orbs)
│   └── js/
│       ├── auth.js        # Funções client-side: requireAuth, getUser, authHeaders, logout
│       ├── intranet.js    # Hub: pipeline widget, stats, greeting, Outlook PKCE
│       ├── triagem.js     # Triagem (PDF, IA, SSE, batch drop, histórico sidebar)
│       ├── email.js       # Formalizar e-mail
│       ├── contato.js     # Aba contato (cards, mensagem WA, confirmar/recusar manual)
│       ├── whatsapp.js    # Painel WA (grupos por vaga, ranking, busca, collapse)
│       ├── admin.js       # Painel admin
│       └── cursos.js      # Grid de cursos, filtros, modal YouTube
└── src/
    ├── data/vagas.js      # Catálogo de vagas, PROVIDERS de IA, calcScore, extractJSON
    ├── middleware/auth.js  # Middleware JWT: auth(), requireRole(...roles)
    └── routes/
        ├── auth.js        # POST /api/auth/login, GET /api/auth/me
        ├── intranet.js    # Rotas da intranet: posts, docs, usuários, permissões, pipeline
        ├── screen.js      # POST /api/screen (SSE); POST /api/ocr
        ├── email.js       # POST /api/email/gerar
        ├── selecao.js     # Candidatos: listar, promover, phone, observação, advance
        ├── vagas.js       # GET /api/vagas[/:id]
        ├── whatsapp.js    # Rotas WhatsApp, webhook, SSE
        ├── curriculo.js   # POST /api/curriculo/avaliar
        ├── export.js      # GET /api/shortlist/excel
        └── vagas-abertas.js
```

## Banco de dados (SQLite via Turso/libSQL)

Acesso via `@libsql/client` (`db.js`). Em produção usa `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (banco remoto persistente, sobrevive a redeploys). Sem essas envs, cai para `file:recruitment.db` local. Migrações (ALTER/CREATE idempotentes) rodam automaticamente em `db.js` `init()` no startup — não existe mais fluxo via `better-sqlite3` nem `scripts/run_migration.js` (legado, não usado).

### Tabelas

- **candidates** — candidatos triados (name, phone, job_position, job_id, status, scores, dimensões, cv_text)
- **screenings** — sessões de triagem IA (vaga_id, vaga_titulo, total, resultado, created_at)
- **messages_sent** / **messages_received** — histórico de mensagens WhatsApp
- **intranet_users** — usuários da plataforma (name, email, password_hash, role, department, is_active)
- **tool_permissions** — controle de acesso por role (role, tool_key, is_enabled)
- **vagas** — vagas cadastradas dinamicamente (gerenciadas via `src/data/vagas.js`)

### Coluna `phone`

`phone TEXT` — **sem NOT NULL, sem UNIQUE global**. Candidatos sem telefone ficam com `phone = NULL`.
Nunca gerar placeholder `triagem_...`.

**Unicidade é por vaga, não global:** índice `idx_candidates_phone_job` em `(phone, job_id)` — a mesma pessoa pode se candidatar a vagas diferentes com o mesmo telefone, mas não duas vezes à mesma vaga. Até 2026-07-30 o campo tinha `UNIQUE` global, o que bloqueava silenciosamente qualquer candidato que já existisse no banco (por qualquer vaga anterior) de se candidatar a uma vaga nova — corrigido via `scripts/migrate_phone_unique_per_vaga.js`. Rotas que buscam candidato por `phone` sozinho (ex: `processIncomingMessage` em `whatsapp.js`) precisam desambiguar entre múltiplas linhas.

### Normalização de phone (`normalizePhone` em `selecao.js`)

- Remove tudo que não é dígito → 10/11 dígitos: adiciona DDI `55` → 12–13 dígitos com `55`: usa direto → < 10: retorna `null`

## Auth e roles

JWT com expiração de 8h. Secret via `JWT_SECRET` no `.env` (fallback: `'accor-dev-secret'`).

Roles: `admin` · `rh` · `manager` · `employee`

`requireRole(...roles)` em `src/middleware/auth.js` retorna array `[auth, roleCheck]` — usar com spread: `...requireRole('admin')`.

`tool_permissions` define quais tools cada role acessa. Admin bypassa todas as verificações de tool. O JWT inclui apenas `id, name, email, role, department` — ferramentas disponíveis são resolvidas no login via `getTools(role)`.

**Bug crítico:** No `intranet.js`, funções síncronas chamadas dentro do IIFE async (ex: `renderGreeting`) devem estar em `try/catch` individuais — um erro nelas impede `loadPipeline()` de ser chamado, deixando o widget em loading infinito.

## Provedores de IA

Definidos em `src/data/vagas.js`. Detecta automaticamente qual key está configurada (prioridade: Gemini → Groq → OpenRouter):

| Provedor   | Modelo padrão                         | Env var              |
|------------|---------------------------------------|----------------------|
| Gemini     | `gemini-flash-latest`                 | `GEMINI_API_KEY`     |
| Groq       | `openai/gpt-oss-120b`                 | `GROQ_API_KEY`       |
| OpenRouter | `deepseek/deepseek-chat-v3-0324:free` | `OPENROUTER_API_KEY` |

`screen.js` e `email.js` têm fallback automático Gemini → Groq → OpenRouter.
OCR (`/api/ocr`) exige `GEMINI_API_KEY` — não funciona com Groq/OpenRouter.

**Modelos descontinuados (2026-08-18):** `gemini-2.0-flash`/`gemini-2.0-flash-lite` e `llama-3.3-70b-versatile` pararam de existir nas APIs (404) — toda triagem em produção falhava silenciosamente e revertia candidatos pra `status='Pendente'`. Trocado por aliases estáveis (`gemini-flash-latest`, `gemini-flash-lite-latest`) que a Google remapeia automaticamente, evitando repetir o problema. Se a IA voltar a falhar em massa, primeiro suspeitar de deprecação de modelo — rodar `GET https://generativelanguage.googleapis.com/v1beta/models?key=...` e `GET https://api.groq.com/openai/v1/models` pra ver o catálogo atual.

## Variáveis de ambiente (.env)

```
GEMINI_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
AI_MODEL=          # sobrescreve modelo do OpenRouter
PORT=3000
AZURE_CLIENT_ID=   # para integração Outlook PKCE
# NODE_ENV=production  # definido pelo Render
```

## API principal

| Método | Rota                             | Auth         | Descrição                                      |
|--------|----------------------------------|--------------|------------------------------------------------|
| POST   | `/api/auth/login`                | —            | Login, retorna JWT + user + tools              |
| GET    | `/api/auth/me`                   | auth         | Dados do usuário atual                         |
| GET    | `/api/status`                    | —            | Provedor ativo, modelo, total de vagas         |
| GET    | `/api/vagas[/:id]`               | —            | Vagas (lista ou detalhe)                       |
| POST   | `/api/screen`                    | —            | Triagem via IA (SSE streaming)                 |
| POST   | `/api/ocr`                       | —            | OCR de PDF digitalizado (Gemini Vision)        |
| POST   | `/api/email/gerar`               | auth         | Gera e-mail formal via IA                      |
| POST   | `/api/curriculo/avaliar`         | auth         | Avalia CV individual via IA                    |
| GET    | `/api/screenings[/:id]`          | —            | Histórico de triagens                          |
| DELETE | `/api/screenings/:id`            | —            | Remove triagem                                 |
| GET    | `/api/selecao/candidates`        | auth         | Lista candidatos com scores                    |
| POST   | `/api/selecao/from-triagem`      | auth         | Salva aprovados da triagem no banco            |
| POST   | `/api/selecao/promote/:id`       | auth         | Avança status do candidato                     |
| PATCH  | `/api/candidates/:id/phone`      | auth         | Atualiza telefone                              |
| PATCH  | `/api/candidates/:id/observacao` | auth         | Salva observação                               |
| DELETE | `/api/candidates/:id`            | auth         | Remove candidato                               |
| POST   | `/api/candidates/advance`        | auth         | Dispara WhatsApp para lista                    |
| GET    | `/api/intranet/pipeline`         | rh, admin    | Resumo do funil (contagens por status)         |
| GET    | `/api/intranet/stats`            | rh, admin    | KPIs gerais                                    |
| GET    | `/api/intranet/posts`            | auth         | Posts/comunicados da intranet                  |
| GET    | `/api/intranet/users`            | admin        | Lista usuários                                 |
| POST   | `/api/intranet/users`            | admin        | Cria usuário                                   |
| PATCH  | `/api/intranet/permissions`      | admin        | Atualiza permissão de tool por role            |
| GET    | `/api/shortlist/excel`           | auth         | Exporta shortlist XLSX                         |
| GET    | `/api/whatsapp/status`           | —            | Status da conexão WhatsApp                     |
| POST   | `/webhook/whatsapp`              | —            | Webhook Evolution API                          |

## Score de triagem

Calculado em `calcScore()` com 5 dimensões ponderadas:

| Dimensão        | Peso | Nota                                            |
|-----------------|------|-------------------------------------------------|
| tecnico         | 25%  |                                                 |
| aderencia       | 20%  | Comparação item a item com os requisitos obrigatórios da vaga |
| experiencia     | 20%  |                                                 |
| **estabilidade**| 20%  | Tempo médio nos empregos — **não** disponibilidade |
| qualificacao    | 15%  | Formação/cursos/certificações explícitos no currículo |

**Histórico:** até 2026-07-03 as dimensões eram `heartist` (cultura/vocação) e `potencial`, substituídas por serem subjetivas demais — a IA dava notas confiantes mesmo sem nenhuma evidência real no currículo. As novas dimensões só pontuam o que está literalmente escrito no texto.

A IA também retorna `nivel_ingles` e `telefone` (extraídos do CV).

## Vagas cadastradas

IDs na tabela `vagas`: `recepcionista`, `camareira`, `gerente`, `chef`, `supervisorFB`, `manutencao`, `trainee`, `steward`, `chefConfeitaria`, `subChef`, `auxiliarCozinha`, `garcom`.

## WhatsApp (Baileys)

- `src/wa.js` inicializa Baileys apenas quando `NODE_ENV !== 'production'`
- Credenciais persistidas em `.wa-auth/`
- **Extração de phone do JID:** usar regex `.replace(/@(s\.whatsapp\.net|lid|c\.us|g\.us)$/i, '')` — Baileys entrega JIDs `@lid` para alguns números BR; nunca usar só `.replace('@s.whatsapp.net', '')`
- **AgentService (`src/agents/agentService.js`) NÃO deve ser usado** — agente de recrutamento tech incompatível com contexto Accor/hotelaria

### Envio simulado vs real

`sendWhatsApp(phone, text)`: phone que não bate `/^\d{10,15}$/` (incluindo `null`) → `{ simulated: true }`.

### Fluxo de mensagem recebida

Baileys `messages.upsert` → `processIncomingMessage(phone, text)` → busca candidato → insere em `messages_received` → se status `'Contato enviado'`: `sim`/`s` → `'Confirmado'`, `nao`/`n` → `'Recusado'`, else → `'Resposta manual'` → broadcast SSE.

## Funcionalidades chave

**Triagem (`triagem.html`):** batch drop de PDFs, OCR automático para PDFs digitalizados (< 80 chars extraídos), shortlist modal com 3 abas (Dashboard / Candidatos / Dimensões), exportação XLSX, revisão Tinder.

**E-mail (`email.html`):** sempre 3 candidatos top, nomes completos, campo "total de CVs recebidos" obrigatório, markdown removido da resposta IA.

**Contato (`contato.html`):** candidatos com status `'Aprovado na Triagem'` ou `'Triado'`, template WA Accor (benefícios + GPTW), agendamento em slots de 30min, endereço: **Rua Joinville, 515 - Vila Mariana**.

**Intranet Hub (`intranet.html`):** pipeline widget (sidebar direita) visível só para `admin`/`rh`, integração Outlook via PKCE manual (sem MSAL), timeout de 10s no pipeline fetch.

**OCR:** `POST /api/ocr` usa Gemini Vision com `inlineData` + `mimeType: application/pdf`. Limite de body: 20mb.

## Design System (base.css)

`--bg: #09091f` · `--purple-d: #7c3aed` · `--cyan-d: #06b6d4` · `--green: #10b981` · `--red: #f43f5e` · `--glass: rgba(255,255,255,0.055)`

Botões: `.btn-primary` (gradiente) · `.btn-ghost` · `.btn-green` · `.btn-danger` · `.btn-wa` · `.btn-sm` / `.btn-lg`

## Deploy (Render)

- Node ≥ 18, build: `npm install`, start: `node server.js`
- Sem disco persistente no Render Free — por isso o banco é Turso (remoto), não mais SQLite local; dados sobrevivem a redeploys
- Render Free "dorme" após ~15min sem tráfego — primeiro request após inatividade pode demorar dezenas de segundos (cold start). `public/js/vaga.js` e `candidato.js` fazem retry com backoff (4 tentativas) para lidar com isso
- Deploy automático ao push em `master`

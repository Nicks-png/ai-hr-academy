# CLAUDE.md — AI-HR Academy

## Visão geral

Plataforma B2B de recrutamento com IA para a **Accor Brasil**. Realiza triagem automatizada de candidatos via LLM, gestão de candidatos via banco SQLite e disparo de mensagens pelo WhatsApp (Baileys).

## Estrutura do projeto

```
ai-hr-academy/
├── server.js              # Entry point Express (porta 3000 / 10000 no Render)
├── db.js                  # SQLite via better-sqlite3 + migrações automáticas
├── wa.js                  # Conector WhatsApp Baileys (raiz — não usado pelo server)
├── render.yaml            # Config de deploy no Render
├── public/                # Frontend estático servido pelo Express
│   ├── index.html         # Landing page
│   ├── triagem.html       # Triagem de candidatos (SSE streaming)
│   ├── email.html         # Formalizar e-mail de processo seletivo via IA
│   ├── contato.html       # Aba de comunicação com candidatos aprovados
│   ├── whatsapp.html      # Painel WhatsApp (respostas, grupos por vaga)
│   ├── cursos.html        # Catálogo de cursos gratuitos de IA
│   ├── vagas-abertas.html # Portal público de vagas abertas
│   ├── css/
│   │   ├── base.css       # Design system global (vars, botões, inputs, nav, orbs)
│   │   ├── triagem.css
│   │   ├── email.css      # Estilos da página de e-mail
│   │   ├── contato.css
│   │   ├── whatsapp.css
│   │   ├── cursos.css
│   │   └── vagas-abertas.css
│   └── js/
│       ├── triagem.js     # Triagem (PDF, IA, SSE, batch drop, histórico sidebar)
│       ├── email.js       # Formalizar e-mail (triagem → e-mail profissional)
│       ├── contato.js     # Aba contato (cards, mensagem WA, confirmar/recusar manual)
│       ├── whatsapp.js    # Painel WA (grupos por vaga, ranking, busca, collapse)
│       ├── cursos.js      # Grid de cursos, filtros, modal YouTube
│       ├── vagas-abertas.js
│       └── theme.js
└── src/
    ├── data/
    │   └── vagas.js       # Catálogo de vagas, PROVIDERS de IA, calcScore, extractJSON
    ├── routes/
    │   ├── screen.js      # POST /api/screen — triagem via IA com SSE; POST /api/ocr — OCR de PDFs
    │   ├── email.js       # POST /api/email/gerar — gera e-mail formal via IA
    │   ├── selecao.js     # Rotas de seleção/candidatos (promote, from-triagem, phone…)
    │   ├── vagas.js       # GET /api/vagas[/:id]
    │   ├── whatsapp.js    # Rotas WhatsApp, webhook, SSE, advance
    │   ├── export.js      # Exportação Excel
    │   └── vagas-abertas.js
    └── wa.js              # Helper de conexão Baileys (usado pelo server.js)
```

## Banco de dados (SQLite)

Arquivo: `recruitment.db` (criado automaticamente na raiz).

### Tabelas

- **candidates** — candidatos triados (nome, telefone, cargo, status, scores, dimensões)
- **messages_sent** — histórico de mensagens enviadas via WhatsApp
- **messages_received** — mensagens recebidas dos candidatos
- **screenings** — histórico de sessões de triagem IA (exibido na sidebar da triagem)
- **vagas** — vagas cadastradas dinamicamente

### Coluna `phone`

`phone TEXT UNIQUE` — **sem NOT NULL**. Candidatos sem telefone no CV ficam com `phone = NULL`.
Nunca gerar placeholder `triagem_...`. A migração para nullable está em `db.js` e converte automaticamente qualquer placeholder antigo para NULL.

### Normalização de phone (`normalizePhone` em `selecao.js`)

- Remove tudo que não é dígito
- 10 ou 11 dígitos → adiciona DDI `55`
- 12–13 dígitos começando com `55` → usa direto
- Menos de 10 dígitos → retorna `null`

## Provedores de IA

Definidos em `src/data/vagas.js`. O servidor detecta automaticamente qual API key está configurada (ordem de prioridade):

| Provedor     | Modelo padrão                             | Env var               |
|--------------|-------------------------------------------|-----------------------|
| Gemini       | `gemini-2.0-flash`                        | `GEMINI_API_KEY`      |
| Groq         | `llama-3.3-70b-versatile`                 | `GROQ_API_KEY`        |
| OpenRouter   | `deepseek/deepseek-chat-v3-0324:free`     | `OPENROUTER_API_KEY`  |

Somente uma key é necessária. Para trocar de modelo no OpenRouter, use `AI_MODEL=<model-id>`.

`screen.js` e `email.js` têm fallback automático entre os três provedores (Gemini → Groq → OpenRouter).

## Variáveis de ambiente (.env)

```
# Obrigatório — ao menos uma das três:
GEMINI_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=

# Opcional — sobrescreve o modelo do OpenRouter
AI_MODEL=

# Definido automaticamente no Render
NODE_ENV=production
PORT=10000
```

## Comandos

```bash
npm install
npm start          # node server.js, porta 3000
npm run tunnel     # Tunnel Cloudflare (Windows)
```

## API principal

| Método | Rota                               | Descrição                                               |
|--------|------------------------------------|---------------------------------------------------------|
| GET    | `/api/status`                      | Provedor ativo, modelo e total de vagas                 |
| GET    | `/api/vagas`                       | Lista resumida de vagas                                 |
| GET    | `/api/vagas/:id`                   | Detalhe completo da vaga                                |
| POST   | `/api/screen`                      | Triagem de candidatos via IA (SSE streaming)            |
| POST   | `/api/ocr`                         | OCR de PDF digitalizado via Gemini Vision               |
| POST   | `/api/email/gerar`                 | Gera e-mail formal de processo seletivo via IA          |
| GET    | `/api/screenings`                  | Lista histórico de triagens (sem resultado completo)    |
| GET    | `/api/screenings/:id`              | Detalhe de triagem com resultado completo               |
| DELETE | `/api/screenings/:id`              | Remove triagem do histórico                             |
| GET    | `/api/whatsapp/status`             | Status da conexão WhatsApp                              |
| GET    | `/api/whatsapp/qr`                 | QR code para conectar WhatsApp                          |
| GET    | `/api/selecao/candidates`          | Lista candidatos com scores e dimensões                 |
| POST   | `/api/selecao/from-triagem`        | Salva candidatos aprovados na triagem → banco           |
| POST   | `/api/selecao/promote/:id`         | Avança status do candidato                              |
| PATCH  | `/api/candidates/:id/phone`        | Atualiza telefone manualmente                           |
| PATCH  | `/api/candidates/:id/observacao`   | Salva observação do recrutador                          |
| DELETE | `/api/candidates/:id`              | Remove candidato                                        |
| POST   | `/api/candidates/advance`          | Dispara WhatsApp para lista de candidatos               |
| GET    | `/api/responses`                   | Mensagens recebidas dos candidatos                      |
| POST   | `/webhook/whatsapp`                | Webhook Evolution API (mensagens recebidas)             |
| POST   | `/webhook/test`                    | Simula resposta de candidato (testes locais)            |
| GET    | `/api/shortlist/excel`             | Exporta shortlist em XLSX                               |

## Score de triagem

Calculado em `calcScore()` com 5 dimensões ponderadas (soma = 100):

| Dimensão        | Peso | Descrição                                      |
|-----------------|------|------------------------------------------------|
| tecnico         | 25%  | Habilidades técnicas para a vaga               |
| heartist        | 20%  | Alinhamento com a cultura Accor (Heartist®)    |
| experiencia     | 20%  | Experiência relevante na área                  |
| **estabilidade**| 20%  | Tempo médio nos empregos anteriores (não disponibilidade) |
| potencial       | 15%  | Potencial de crescimento                       |

**IMPORTANTE:** A dimensão é `estabilidade`, nunca `disponibilidade`. A IA também retorna `nivel_ingles` (evidenciado no currículo) e `telefone` (extraído automaticamente).

## Vagas cadastradas

As vagas ficam na tabela `vagas` do SQLite (gerenciadas via `src/data/vagas.js`).
IDs: `recepcionista`, `camareira`, `gerente`, `chef`, `supervisorFB`, `manutencao`, `trainee`, `steward`, `chefConfeitaria`, `subChef`, `auxiliarCozinha`, `garcom`.

### Vaga `garcom`
- Título: Garçom / Garçonete | Marca: Pullman
- Salário: `A consultar` (não constava no documento de descrição de cargo)
- Regime: CLT · Escala 6x1 · Turnos rotativos

## OCR de PDFs digitalizados (`/api/ocr`)

Quando `parsePDF` (frontend) extrai menos de 80 caracteres de um PDF, ele detecta que é um PDF digitalizado (imagem) e chama `POST /api/ocr` automaticamente.

- Backend usa Gemini Vision (`inlineData` com `mimeType: application/pdf`) para transcrever o texto
- Requer `GEMINI_API_KEY` — OCR não funciona com Groq/OpenRouter
- Limite do body do servidor: **20mb** (aumentado de 2mb para suportar PDFs em base64)
- Fluxo transparente: o texto retornado pelo OCR entra no fluxo normal de triagem

## Formalizar E-mail (`email.html` / `src/routes/email.js`)

Ferramenta que transforma dados de uma triagem em e-mail profissional via IA.

### Regras fixas (sempre aplicadas)
1. **Total de currículos recebidos** — campo obrigatório; e-mail não é gerado sem ele
2. **Nomes completos** — nunca abreviados
3. **Exatamente 3 candidatos** recomendados — os top 3 com recomendação "Avançar" por score; sem resumo ou análise individual
4. Markdown é removido automaticamente da resposta da IA (`limparMarkdown`)

### Seleção dos 3 candidatos
- Filtra candidatos com recomendação "Avançar", ordena por `scoreTotal` DESC, pega os 3 primeiros
- Se não houver 3 com "Avançar", completa com os melhores scores disponíveis

### Fallback de provedores
Gemini → Groq → OpenRouter. Se o JSON retornado for inválido, `parsearTextoLivre` tenta extrair assunto/corpo de texto livre.

### Exibição do e-mail gerado
- Fundo branco + texto escuro (evita problema de texto branco ao copiar para cliente de e-mail)
- Botão "Copiar" usa `navigator.clipboard.writeText` (plain text, sem styling)

### Permissões
- `tool_key = 'email'` cadastrado em `tool_permissions` para roles `admin`, `rh`, `manager`
- `requireAuth()` sem tool-key — qualquer usuário logado acessa (não exige permissão específica no JWT)

## Histórico de triagens (sidebar)

- **Fonte**: `/api/screenings` (banco SQLite) — sempre disponível, independente de localStorage
- **Restaurar**: tenta localStorage primeiro (instantâneo); se não encontrar, busca `/api/screenings/:id` + `/api/vagas/:id` em paralelo
- **Excluir**: remove do banco via `DELETE /api/screenings/:id` e limpa localStorage simultaneamente

## WhatsApp (Baileys)

- `src/wa.js` inicializa Baileys apenas quando `NODE_ENV !== 'production'`
- Credenciais persistidas em `.wa-auth/`
- **Extração de phone do JID:** sempre usar regex `.replace(/@(s\.whatsapp\.net|lid|c\.us|g\.us)$/i, '')` — o Baileys entrega JIDs no formato `@lid` para alguns números brasileiros; nunca usar só `.replace('@s.whatsapp.net', '')`
- Mensagens de números não cadastrados são ignoradas silenciosamente
- **AgentService (`src/agents/agentService.js`) NÃO deve ser usado** — é um agente de recrutamento tech (programação) incompatível com o contexto Accor/hotelaria. Não reintroduzir no fluxo de mensagens

### Fluxo de mensagem recebida

1. Baileys `messages.upsert` → extrai phone (regex completo) + text
2. Chama `processIncomingMessage(phone, text)` em `whatsapp.js`
3. Busca candidato por phone exato → se não encontrar, ignora
4. Insere em `messages_received`
5. Se status == `'Contato enviado'` e texto == `sim`/`s` → `'Confirmado'`; `nao`/`n` → `'Recusado'`; else → `'Resposta manual'`
6. Broadcast SSE para o frontend

### Envio simulado vs real

`sendWhatsApp(phone, text)` em `whatsapp.js`:
- `phone` que não bate `/^\d{10,15}$/` (incluindo `null`) → `{ simulated: true }` — não envia, não muda status
- Phone real → chama `wa.sendMessage()` diretamente — falha real é propagada

## Aba Contato (`contato.html` / `contato.js`)

- Lista candidatos com status `'Aprovado na Triagem'` ou `'Triado'`
- Gera mensagem WhatsApp automática com template Accor (benefícios, GPTW, endereço)
- **Botão "Adicionar Telefone"** para candidatos sem phone (chama `PATCH /api/candidates/:id/phone`)
- **Botões "✓ Confirmar" / "✗ Recusar"** para candidatos com status `'Contato enviado'` — permite atualização manual quando a resposta chega por outro canal
- Agendamento de entrevistas com slots de 30 min salvo em localStorage
- Endereço das entrevistas: **Rua Joinville, 515 - Vila Mariana**

### Template da mensagem WhatsApp

Começa com `Olá, [nome]! 😊`, inclui data/hora da entrevista, escala, salário, lista completa de benefícios Accor, conquistas GPTW (28 anos), diversidade e inclusão, e endereço.

## Aba WhatsApp (`whatsapp.html` / `whatsapp.js`)

- Candidatos agrupados por vaga, ordenados por score DESC dentro de cada grupo
- Ranking (#1, #2…) e score visíveis em cada linha
- Busca por nome ou vaga (input + select)
- Collapse/expand por grupo (clica no header)
- SSE em tempo real para novas respostas recebidas

## Triagem (`triagem.html` / `triagem.js`)

- Upload PDF, DOCX, TXT com extração automática de texto
- **PDFs digitalizados** → fallback automático para OCR via `/api/ocr` (Gemini Vision)
- Batch drop zone: múltiplos PDFs → cada arquivo = um candidato (**sem limite de candidatos**)
- Detecção automática de nome no CV (label "Nome:" + fallback por padrão de nome próprio)
- Sidebar esquerda: histórico de triagens carregado do banco (sempre disponível)
  - Clicando no item do histórico restaura todos os cards e análise sem refazer a triagem
  - Se dados detalhados estiverem em localStorage, usa diretamente; senão busca da API
- **Botão "★ Shortlist Geral"** — abre modal in-app com 3 abas:
  - **Dashboard**: 6 KPIs (Total, Avançar, Aguardar, Dispensar, Score Médio, Maior Score) + tabela de ranking
  - **Candidatos**: tabela completa (nome, telefone, inglês, score, recomendação, resumo, pontos fortes, atenção, 5 dimensões)
  - **Dimensões**: tabela com score total e 5 dimensões por candidato + linha de Média Geral
- **Botão "Exportar Excel"** — gera planilha XLSX com scores, dimensões e coluna Inglês evidenciada
- Botão "Revisão Rápida" (modo Tinder) — review card a card com swipe/teclado
- Após análise, botão "Avançar para Comunicação" salva aprovados via `POST /api/selecao/from-triagem`
- O objeto enviado inclui `telefone` extraído pela IA do CV — o backend normaliza e salva

## Design System (base.css)

| Variável       | Valor            | Uso                              |
|----------------|------------------|----------------------------------|
| `--bg`         | `#09091f`        | Fundo principal (azul-índigo)    |
| `--grad`       | roxo → ciano     | Gradiente primário               |
| `--purple-d`   | `#7c3aed`        | Roxo escuro                      |
| `--cyan-d`     | `#06b6d4`        | Ciano escuro                     |
| `--green`      | `#10b981`        | Aprovado / positivo              |
| `--red`        | `#f43f5e`        | Recusado / erro                  |
| `--glass`      | rgba branco 5.5% | Glassmorphism                    |
| `--modal-blur` | `blur(14px)`     | Backdrop dos modais              |

### Classes de botão

| Classe           | Uso                              |
|------------------|----------------------------------|
| `.btn-primary`   | Ação principal (gradiente)       |
| `.btn-ghost`     | Ação secundária                  |
| `.btn-green`     | Exportar / confirmar             |
| `.btn-danger`    | Excluir / rejeitar               |
| `.btn-wa`        | Ação WhatsApp                    |
| `.btn-sm`        | Tamanho pequeno                  |
| `.btn-lg`        | Tamanho grande                   |
| `.ctbtn-confirm` | Confirmar candidato (verde)      |
| `.ctbtn-reject`  | Recusar candidato (vermelho)     |

## Deploy (Render)

- Runtime: Node ≥ 18
- Build: `npm install`
- Start: `node server.js`
- `GEMINI_API_KEY` configurada no dashboard do Render
- Sem disco persistente no Render Free — banco SQLite recriado a cada deploy com seed data
- Deploy automático ao push em `master`

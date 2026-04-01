# CLAUDE.md — AI-HR Academy

## Visão geral

Plataforma B2B de recrutamento com IA para a **Accor Brasil**. Realiza triagem automatizada de candidatos via LLM, gestão de candidatos via banco SQLite e disparo de mensagens pelo WhatsApp (Baileys).

## Estrutura do projeto

```
ai-hr-academy/
├── server.js              # Entry point Express (porta 3000 / 10000 no Render)
├── db.js                  # SQLite via better-sqlite3, 3 tabelas
├── wa.js                  # Conector WhatsApp Baileys (só roda fora de produção)
├── render.yaml            # Config de deploy no Render
├── public/                # Frontend estático servido pelo Express
│   ├── index.html         # Landing page
│   ├── triagem.html       # Triagem de candidatos (SSE streaming)
│   ├── whatsapp.html      # Painel de recrutamento por WhatsApp
│   ├── cursos.html        # Catálogo de cursos
│   ├── css/
│   └── js/
└── src/
    ├── data/
    │   └── vagas.js       # Catálogo de vagas, PROVIDERS de IA, calcScore, extractJSON
    ├── routes/
    │   ├── screen.js      # POST /screen — triagem via IA com SSE
    │   ├── vagas.js       # GET /api/vagas[/:id]
    │   └── whatsapp.js    # Rotas WhatsApp + lógica de envio de candidatos
    └── wa.js              # Helper de conexão Baileys
```

## Banco de dados (SQLite)

Arquivo: `recruitment.db` (criado automaticamente na raiz).

- **candidates** — candidatos importados (nome, telefone, cargo, status)
- **messages_sent** — histórico de mensagens enviadas via WhatsApp
- **messages_received** — mensagens recebidas dos candidatos

## Provedores de IA

Definidos em `src/data/vagas.js`. O servidor detecta automaticamente qual API key está configurada (ordem de prioridade):

| Provedor     | Modelo padrão                   | Env var               |
|--------------|---------------------------------|-----------------------|
| Gemini       | `gemini-2.5-flash`              | `GEMINI_API_KEY`      |
| Groq         | `llama-3.3-70b-versatile`       | `GROQ_API_KEY`        |
| OpenRouter   | `google/gemini-2.0-flash-exp:free` (override via `AI_MODEL`) | `OPENROUTER_API_KEY` |

Somente uma key é necessária. Para trocar de modelo no OpenRouter, use `AI_MODEL=<model-id>`.

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
# Instalar dependências
npm install

# Rodar localmente
npm start                # node server.js, porta 3000

# Tunnel Cloudflare (Windows)
npm run tunnel

# Deploy — feito automaticamente pelo Render ao push em master
```

## API principal

| Método | Rota              | Descrição                                      |
|--------|-------------------|------------------------------------------------|
| GET    | `/api/status`     | Provedor ativo, modelo e total de vagas        |
| GET    | `/api/vagas`      | Lista resumida de vagas                        |
| GET    | `/api/vagas/:id`  | Detalhe completo da vaga                       |
| POST   | `/screen`         | Triagem de candidatos via IA (SSE streaming)   |

### POST /screen

```json
{
  "vagaId": "recepcionista",
  "candidatos": [
    { "nome": "Ana Lima", "curriculo": "..." }
  ]
}
```

Limites: máximo 10 candidatos por requisição. Currículo truncado em 12.000 chars.

Eventos SSE emitidos: `start`, `progress`, `candidato`, `done`.

## Score de triagem

Calculado em `calcScore()` com 5 dimensões ponderadas (soma = 100):

| Dimensão       | Peso |
|----------------|------|
| tecnico        | 25%  |
| heartist       | 20%  |
| experiencia    | 20%  |
| disponibilidade| 20%  |
| potencial      | 15%  |

Cada dimensão recebe score 0–10 pela IA. Score final 0–100.

## Vagas cadastradas

`recepcionista`, `camareira`, `gerente`, `chef`, `supervisorFB`, `manutencao`, `trainee`

Para adicionar uma vaga, edite o objeto `VAGAS` em `src/data/vagas.js`.

## WhatsApp (Baileys)

- Só inicializa quando `NODE_ENV !== 'production'`
- QR code exibido no terminal no primeiro uso
- Credenciais persistidas localmente (pasta `auth_info_baileys/`)
- No Render (produção) o WhatsApp é gerenciado via painel web sem Baileys

## Deploy (Render)

- Runtime: Node ≥ 18
- Build: `npm install`
- Start: `node server.js`
- Variável `GEMINI_API_KEY` configurada no dashboard do Render (não exposta no `render.yaml`)
- Sem disco persistente no Render Free — o banco SQLite é recriado a cada deploy com seed data

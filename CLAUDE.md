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
│   ├── index.html         # Landing page com scroll reveal e status de IA/WhatsApp
│   ├── triagem.html       # Triagem de candidatos (SSE streaming)
│   ├── whatsapp.html      # Painel de recrutamento por WhatsApp
│   ├── cursos.html        # Catálogo de cursos gratuitos de IA
│   ├── css/
│   │   ├── base.css       # Design system global (vars, botões, inputs, nav, orbs)
│   │   ├── triagem.css    # Estilos da página de triagem
│   │   ├── whatsapp.css   # Estilos do painel WhatsApp
│   │   └── cursos.css     # Estilos do catálogo de cursos
│   └── js/
│       ├── triagem.js     # Lógica de triagem (PDF, IA, SSE, batch drop)
│       ├── whatsapp.js    # Lógica do painel WhatsApp (candidatos, status, stats)
│       └── cursos.js      # Grid de cursos, filtros, busca, modal YouTube
└── src/
    ├── data/
    │   └── vagas.js       # Catálogo de vagas, PROVIDERS de IA, calcScore, extractJSON
    ├── routes/
    │   ├── screen.js      # POST /screen — triagem via IA com SSE
    │   ├── vagas.js       # GET /api/vagas[/:id]
    │   └── whatsapp.js    # Rotas WhatsApp + filtro de números cadastrados
    └── wa.js              # Helper de conexão Baileys
```

## Banco de dados (SQLite)

Arquivo: `recruitment.db` (criado automaticamente na raiz).

- **candidates** — candidatos importados (nome, telefone, cargo, status)
- **messages_sent** — histórico de mensagens enviadas via WhatsApp
- **messages_received** — mensagens recebidas dos candidatos

## Provedores de IA

Definidos em `src/data/vagas.js`. O servidor detecta automaticamente qual API key está configurada (ordem de prioridade):

| Provedor     | Modelo padrão                      | Env var               |
|--------------|------------------------------------|-----------------------|
| Gemini       | `gemini-2.5-flash`                 | `GEMINI_API_KEY`      |
| Groq         | `llama-3.3-70b-versatile`          | `GROQ_API_KEY`        |
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

| Método | Rota                    | Descrição                                      |
|--------|-------------------------|------------------------------------------------|
| GET    | `/api/status`           | Provedor ativo, modelo e total de vagas        |
| GET    | `/api/vagas`            | Lista resumida de vagas                        |
| GET    | `/api/vagas/:id`        | Detalhe completo da vaga                       |
| POST   | `/screen`               | Triagem de candidatos via IA (SSE streaming)   |
| GET    | `/api/whatsapp/status`  | Status da conexão WhatsApp                     |
| GET    | `/api/candidates`       | Lista de candidatos cadastrados                |
| POST   | `/api/send-whatsapp`    | Disparo de mensagem WhatsApp para candidato    |

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

| Dimensão        | Peso |
|-----------------|------|
| tecnico         | 25%  |
| heartist        | 20%  |
| experiencia     | 20%  |
| disponibilidade | 20%  |
| potencial       | 15%  |

Cada dimensão recebe score 0–10 pela IA. Score final 0–100.

## Vagas cadastradas

`recepcionista`, `camareira`, `gerente`, `chef`, `supervisorFB`, `manutencao`, `trainee`

Para adicionar uma vaga, edite o objeto `VAGAS` em `src/data/vagas.js`.

## WhatsApp (Baileys)

- Só inicializa quando `NODE_ENV !== 'production'`
- QR code exibido no terminal no primeiro uso
- Credenciais persistidas localmente (pasta `auth_info_baileys/`)
- No Render (produção) o WhatsApp é gerenciado via painel web sem Baileys
- **Filtro de números:** mensagens de números não cadastrados no banco são ignoradas silenciosamente (`src/routes/whatsapp.js`)

## Design System (base.css)

Variáveis CSS globais definidas em `:root`:

| Variável       | Valor            | Uso                              |
|----------------|------------------|----------------------------------|
| `--bg`         | `#09091f`        | Fundo principal (azul-índigo)    |
| `--grad`       | roxo → ciano     | Gradiente primário               |
| `--purple-d`   | `#7c3aed`        | Roxo escuro (destaque)           |
| `--cyan-d`     | `#06b6d4`        | Ciano escuro                     |
| `--green`      | `#10b981`        | Aprovado / positivo              |
| `--red`        | `#f43f5e`        | Recusado / erro                  |
| `--glass`      | rgba branco 5.5% | Fundo glassmorphism              |
| `--modal-blur` | `blur(14px)`     | Backdrop dos modais              |

### Classes de botão

| Classe         | Uso                        |
|----------------|----------------------------|
| `.btn-primary` | Ação principal (gradiente) |
| `.btn-ghost`   | Ação secundária            |
| `.btn-green`   | Exportar / confirmar       |
| `.btn-danger`  | Excluir / rejeitar         |
| `.btn-wa`      | Ação WhatsApp              |
| `.btn-sm`      | Tamanho pequeno            |
| `.btn-lg`      | Tamanho grande             |

## Funcionalidades do Frontend

### Triagem (`triagem.js`)
- Upload de PDF, DOCX e TXT com extração automática de texto
- **Batch drop zone**: arraste múltiplos PDFs → cada arquivo vira um candidato separado (máx. 10)
- **Detecção de nome** em 2 passagens: busca label "Nome:" e fallback por padrão de nome próprio
- **Autofill visual**: campo de nome fica com borda roxa ao ser preenchido automaticamente
- Score ring com cor dinâmica via CSS custom property `--ring-color`
- Expansão suave dos cards via `max-height` transition (0 → 900px)
- Animação das barras de dimensão via CSS `--pct` custom property

### WhatsApp (`whatsapp.js`)
- Dashboard de estatísticas: total / confirmados / pendentes / recusados
- SSE em tempo real para novas mensagens recebidas
- Detecção automática de resposta SIM/NÃO nas mensagens

### Cursos (`cursos.js`)
- Grid de 18 cursos com filtro por categoria e busca com debounce
- Cores das thumbnails via `data-cat` attribute (sem inline styles)
- Badge de nível via `data-level` attribute
- Botão de limpar busca com exibição condicional
- Modal YouTube com `youtube-nocookie.com` e autoplay

## Deploy (Render)

- Runtime: Node ≥ 18
- Build: `npm install`
- Start: `node server.js`
- Variável `GEMINI_API_KEY` configurada no dashboard do Render (não exposta no `render.yaml`)
- Sem disco persistente no Render Free — o banco SQLite é recriado a cada deploy com seed data
- Deploy automático ao push no branch `master`

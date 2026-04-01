# 🤖 Smart HR Agent - Guia de Implementação

## 📋 Visão Geral

Agente de IA para triagem automatizada de candidatos via WhatsApp. O agente intercepta mensagens, extrai dados não estruturados e atualiza o banco de dados em tempo real.

## 🚀 Funcionalidades

### 1. Parsing Inteligente
- Extrai **anos de experiência** de textos como: "5 anos de XP", "experiência de 3 anos"
- Extrai **pretensão salarial** de formatos: "8k", "R$ 5.000", "pretensão 10 mil"
- Salva automaticamente no SQLite em colunas dedicadas

### 2. Logs Coloridos no Terminal
```
[SISTEMA] -> Mensagens do servidor/banco (azul)
[WHATSAPP] -> Status da conexão (verde)
[AGENTE-IA] 🤖 -> Pensamentos e respostas do bot (magenta)
[ALERTA] -> Avisos (amarelo)
[ERRO] -> Erros críticos (vermelho)
```

### 3. Protocolo de Segurança
- **Human-overtake**: Detecta pedidos de humano ou frustração → `ai_enabled = 0`
- **Escopolimit**: Tópicos fora de recrutamento (clima, política, religião) → transfere
- **Graceful degradation**: Erros de IA caem para operador humano sem derrubar socket

### 4. Simulação Humana
- Delay de 1.5 a 3.5 segundos antes de responder
- Evita detecção de bot pelo WhatsApp

## 📦 Estrutura de Arquivos

```
ai-hr-academy/
├── src/
│   └── agents/
│       └── agentService.js      # Serviço principal do agente
├── tests/
│   └── smoke_test.js            # Testes automatizados
├── migrations/
│   └── 001_add_agent_columns.sql
├── scripts/
│   └── run_migration.js         # Aplica migrações
└── AGENT_README.md              # Este arquivo
```

## ⚙️ Instalação

### 1. Instalar dependência (chalk já está no package.json)
```bash
npm install
```

### 2. Aplicar migração no banco de dados
```bash
npm run migrate
```

Isso adiciona as colunas no `recruitment.db`:
- `ai_enabled` INTEGER (1=ativo, 0=transferido)
- `anos_xp` INTEGER (anos de experiência extraídos)
- `pretensao` INTEGER (pretensão salarial em R$)

## 🧪 Testes

Execute o **smoke test** completo:

```bash
npm run test:agent
```

### Cobertura dos Testes
1. ✅ **Fora do Escopo** → "Qual a previsão do tempo?" → transfere
2. ✅ **Triagem** → "Tenho 5 anos de XP" + "Quero ganhar 8k" → salva `anos_xp=5, pretensao=8000`
3. ✅ **Intervenção** → "Quero falar com uma pessoa" → desabilita IA

## 🔧 Como Funciona

### Fluxo de Mensagem

```
WhatsApp → wa.js → AgentService.interceptMessage()
                                   ↓
                Verifica: candidate existe? + ai_enabled=1?
                                   ↓
                Delay humano (1.5-3.5s)
                                   ↓
            Classifica intenção + extrai dados
                                   ↓
                Salva no SQLite (anos_xp, pretensao)
                                   ↓
                Gera resposta com System Prompt
                                   ↓
                Envia via WhatsApp socket
```

### System Prompt (Recrutadora Tech)

> "Você é uma recrutadora tech especializada em vagas de programação. Seja cordial, mas objetiva. Confirme sempre: anos de experiência e pretensão salarial. Se o candidato mencionar algo fora do escopo (política, religião, problemas pessoais), responda: 'Entendi, vou anotar isso para o recrutador humano analisar' e encerre."

## 🎯 Regras de Ouro

| Situação | Resposta | Ação no Banco |
|----------|----------|---------------|
| Fora do escopo (clima, política) | "Entendi, vou anotar..." | `ai_enabled = 0` |
| Pedido de humano/frustração | "Vou transferir..." | `ai_enabled = 0` |
| Extrai XP e/ou salário | Confirmação + pergunta | Atualiza `anos_xp` / `pretensao` |
| Erro de IA | "Problemas técnicos..." | `ai_enabled = 0` |

## 📊 Monitoramento

Logs em tempo real coloridos no terminal (`iniciar.bat`):

```
[AGENTE-IA] 🤖 Interceptando mensagem de 5511999888777
[AGENTE-IA] 🤖 Simulando digitação (2s)...
[AGENTE-IA] 🤖 Dados extraídos: {"anos_xp":5,"pretensao":0}
[SISTEMA] Candidado ID 12 atualizado: UPDATE candidates SET anos_xp = ? WHERE id = ?
[WHATSAPP] ✓ Conectado com sucesso!
```

## 🔌 Integração

### wa.js (integração mínima)

```javascript
const db = require('./db');
const AgentService = require('./src/agents/agentService');

// Dentro de connect()
agentService = new AgentService(db, sock);

// No eventos de mensagem
sock.ev.on('messages.upsert', async ({ messages, type }) => {
  // ... código existente ...
  if (phone && text) {
    onMsg?.(phone, text);

    // Interceptação não-bloqueante
    if (agentService) {
      agentService.interceptMessage(msg).catch(console.error);
    }
  }
});
```

## 🛡️ Zero-Breaking Change

- ✅ **Não modifica** `server.js` ou rotas existentes
- ✅ **Não altera** UI/CSS
- ✅ **Adição apenas** de `agentService.js` e Migration
- ✅ **Compatível** com 12 sessões WhatsApp simultâneas
- ✅ **Rollback automático** para humano em erros

## 📈 Dashboard

Os dados extraídos aparecem automaticamente no banco:

```sql
SELECT phone, name, anos_xp, pretensao, ai_enabled
FROM candidates
WHERE anos_xp > 0 OR pretensao > 0;
```

Use para filtros no dashboard de recrutamento.

## 🐛 Troubleshooting

| Problema | Solução |
|----------|---------|
| `chalk.magenta is not a function` | Usar `require('chalk').default` (v5+) |
| `no such column: "now"` | Usar `datetime('now')` ou passar data do Node |
| FK constraint ao deletar | Deletar `messages_sent` e `messages_received` primeiro |
| Agente não responde | Verificar `ai_enabled = 1` e `waSocket` conectado |

## 📝 Notas de Implementação

- **State Management**: Compartilha socket existente sem criar conexões extras
- **Rate Limiting**: Delay de 2-3s simula digitação humana (evita shadowban)
- **Contextual Memory**: Consulta `recruitment.db` antes de cada resposta
- **Graceful Degradation**: `try/catch` em todas as operações de IA

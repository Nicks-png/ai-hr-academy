/**
 * Smart HR Agent - Serviço de IA para triagem automatizada de candidatos
 *
 * Funcionalidades:
 * - Parsing inteligente de dados não estruturados
 * - Logs coloridos no terminal
 * - Interceptação não intrusiva de mensagens
 * - Fallback seguro para operador humano
 */

const chalk = require('chalk').default;

class AgentService {
  constructor(db, waSocket) {
    this.db = db;
    this.waSocket = waSocket;
    this.aiEnabled = true;

    // Sistema de Logs Coloridos (chalk v5 usa funções)
    this.log = {
      system: (msg) => console.log(chalk.cyan(`[SISTEMA] ${msg}`)),
      whatsapp: (msg) => console.log(chalk.green(`[WHATSAPP] ${msg}`)),
      agent: (msg) => console.log(chalk.magenta(`[AGENTE-IA] 🤖 ${msg}`)),
      error: (msg) => console.log(chalk.red(`[ERRO] ${msg}`)),
      warning: (msg) => console.log(chalk.yellow(`[ALERTA] ${msg}`))
    };

    // Prompt do Sistema - Recrutadora Tech
    this.systemPrompt = `Você é uma recrutadora tech especializada em vagas de programação. Seja cordial, mas objetiva.

REGRA CRÍTICA:
- Se o candidato mencionar algo fora do escopo (política, religião, problemas pessoais, salário de outros, benefícios), responda EXATAMENTE: "Entendi, vou anotar isso para o recrutador humano analisar" e encerre sua participação.

CONFIRMAÇÕES OBRIGATÓRIAS:
1. Anos de experiência total em programação
2. Pretensão salarial (em R$)

Se o candidato pedir para falar com humano ou mostrar frustração, transfira imediatamente.

FORMATO:
- Use emojis para humanizar (✅ ⚠️ ❌)
- Máximo 3 frases por resposta
- Seja direta e técnica
- Sempre termine com uma pergunta sobre XP ou salário`;
  }

  /**
   * Intercepta mensagens do WhatsApp e decide se o agente deve responder
   */
  async interceptMessage(msg) {
    const sessionId = msg.from.substring(0, 8);
    this.log.agent(`Interceptando mensagem de ${msg.from} (Sessão: ${sessionId})`);

    try {
      // 1. Verificar se candidato existe no banco
      const candidate = await this.getCandidateByPhone(msg.from);
      if (!candidate) {
        this.log.warning(`Candidato não encontrado: ${msg.from}`);
        return;
      }

      // 2. Verificar se AI está habilitada
      if (candidate.ai_enabled === 0) {
        this.log.agent(`IA desabilitada para ${msg.from} - pulando`);
        return;
      }

      // 3. Simular delay humano (1.5s a 3.5s)
      const delay = 1500 + Math.random() * 2000;
      this.log.agent(`Simulando digitação (${Math.round(delay/1000)}s)...`);
      await this.sleep(delay);

      // 4. Processar mensagem com IA
      const response = await this.processMessage(msg.text, candidate);

      // 5. Salvar resposta no banco
      await this.saveAgentResponse(candidate.id, response);

      // 6. Enviar resposta
      this.waSocket.sendMessage(msg.from, response);
      this.log.agent(`Resposta enviada para ${msg.from}`);

    } catch (error) {
      this.log.error(`Erro no agente: ${error.message}`);
      this.handleCriticalError(msg.from, error);
    }
  }

  /**
   * Processa a mensagem do candidato com IA
   */
  async processMessage(messageText, candidate) {
    const normalized = messageText.toLowerCase().trim();
    this.log.agent(`Processando: "${normalized.substring(0, 50)}..."`);

    // 1. Detectar tópicos fora do escopo
    const outOfScopePatterns = [
      // Política/religião
      /política|eleição|partido|candidato|presidente/i,
      /religião|deus|jesus|igreja|crença/i,
      // Problemas pessoais
      /problemas pessoais|família|doença|mãe|pai|filho/i,
      // Benefícios/salário de outros
      /salário de outros|benefício|vt|vr|va|vale-transporte|vale-refeição/i,
      // Reclamações/frustração
      /reclamação|reclamar|insatisfeito|frustrado|burocracia/i,
      // Tópicos não relacionados a recrutamento
      /clima|tempo|previsão|trânsito|notícia|futebol|esporte|jogo/i,
      // Matemática/horóscopo/etc
      /conta|calculadora|horóscopo|signo/i
    ];

    if (outOfScopePatterns.some(pattern => pattern.test(normalized))) {
      this.log.warning(`Tópico fora do escopo detectado - transferindo para humano`);
      await this.disableAI(candidate.id);
      return 'Entendi, vou anotar isso para o recrutador humano analisar. Obrigada pela sua mensagem!';
    }

    // 2. Detectar pedido de transferência/frustração
    const transferPatterns = [
      /humano|pessoa|atendente|suporte/i,
      /falar com|quero um|preciso de ajuda/i,
      /frustrado|insatisfeito|não entendo|estress/i
    ];

    if (transferPatterns.some(pattern => pattern.test(normalized))) {
      this.log.warning(`Pedido de transferência detectado - desabilitando IA`);
      await this.disableAI(candidate.id);
      return 'Entendi, vou transferir sua conversa para um recrutador humano. Obrigada pela sua paciência!';
    }

    // 3. Extrair dados estruturados da mensagem
    const extractedData = this.extractStructuredData(normalized);
    this.log.agent(`Dados extraídos: ${JSON.stringify(extractedData)}`);

    // 4. Salvar dados extraídos no banco
    if (extractedData.anos_xp > 0 || extractedData.pretensao > 0) {
      await this.updateCandidateData(candidate.id, extractedData);
    }

    // 5. Gerar resposta baseada no contexto
    const response = this.generateResponse(candidate, extractedData, normalized);
    return response;
  }

  /**
   * Extrai dados estruturados de texto não estruturado
   * Ex: "Tenho uns 5 anos de XP e quero ganhar 8k" -> {anos_xp: 5, pretensao: 8000}
   */
  extractStructuredData(text) {
    const result = { anos_xp: 0, pretensao: 0 };

    // Extrair anos de experiência
    const xpPatterns = [
      /(\d+(?:[.,]\d+)?)\s*(?:anos?|anos de experiência|xplicê?ncia|tempo)/i,
      /experiência de (\d+(?:[.,]\d+)?)/i,
      / há (\d+(?:[.,]\d+)?)\s*anos?/i
    ];

    for (const pattern of xpPatterns) {
      const match = text.match(pattern);
      if (match) {
        const value = parseFloat(match[1].replace(',', '.'));
        if (value > 0 && value < 50) { // Sanity check: max 50 anos
          result.anos_xp = Math.round(value);
          break;
        }
      }
    }

    // Extrair pretensão salarial
    const salaryPatterns = [
      // Padrão explícito: "pretensão: 5000", "salário 8k", etc.
      /(?:pretensão|salário|remuneração|ganhar|querendo)\s*(?:de\s+)?(?:r?\$?\s*)?(\d+(?:[.,]\d+)?)(?:\s*(?:mil|k|milh[ãa]o))?/i,
      // Padrão com R$: "R$ 5.000" ou "R\$5000"
      /r\$?\s*(\d+(?:[.,]\d+)?)(?:\s*(?:mil|k|milh[ãa]o))?(?:\s*(?:mensal|por mês|ao mês))?/i,
      // Padrão separado: número seguido de k/mil
      /(\d+(?:[.,]\d+)?)\s*(?:mil|k)\b/i
    ];

    for (const pattern of salaryPatterns) {
      const match = text.match(pattern);
      if (match) {
        let value = parseFloat(match[1].replace(',', '.'));

        // Detectar sufixo "mil" ou "k" no texto
        if (/(\d+)\s*k\b/i.test(text) || /(\d+)\s*mil\b/i.test(text)) {
          // Se o número já foi multiplicado? Verifica se o valor está baixo
          if (value < 1000) {
            value *= 1000;
          }
        }

        // Sanity check: entre 500 e 100000
        if (value >= 500 && value <= 100000) {
          result.pretensao = Math.round(value);
          break;
        }
      }
    }

    return result;
  }

  /**
   * Atualiza dados do candidato no banco
   */
  async updateCandidateData(candidateId, data) {
    const updates = [];
    const values = [];

    if (data.anos_xp > 0) {
      updates.push('anos_xp = ?');
      values.push(data.anos_xp);
    }

    if (data.pretensao > 0) {
      updates.push('pretensao = ?');
      values.push(data.pretensao);
    }

    if (updates.length > 0) {
      values.push(candidateId);
      const sql = `UPDATE candidates SET ${updates.join(', ')} WHERE id = ?`;
      this.db.prepare(sql).run(...values);
      this.log.system(`Candidado ID ${candidateId} atualizado: ${sql}`);
    }
  }

  /**
   * Gera resposta contextual baseada no estado do candidato
   */
  generateResponse(candidate, extractedData, normalized) {
    const hasXP = extractedData.anos_xp > 0 || candidate.anos_xp > 0;
    const hasSalary = extractedData.pretensao > 0 || candidate.pretensao > 0;

    // Se já temos ambos os dados
    if (hasXP && hasSalary) {
      const xp = extractedData.anos_xp > 0 ? extractedData.anos_xp : candidate.anos_xp;
      const salary = extractedData.pretensao > 0 ? extractedData.pretensao : candidate.pretensao;

      return `✅ Perfeito! Consultei aqui e vi que você tem ${xp} anos de experiência e pretensão de R$ ${salary.toLocaleString('pt-BR')}. \n\nVou encaminhar seu perfil para análise do recrutador. Em breve entraremos em contato! \n\nHá mais alguma informação que queira acrescentar?`;
    }

    // Se só tem XP
    if (hasXP) {
      const xp = extractedData.anos_xp > 0 ? extractedData.anos_xp : candidate.anos_xp;
      return `✅ Vi que você tem ${xp} anos de experiência. \n\nPara finalizar, preciso saber sua pretensão salarial em R$. Qual o valor que você está buscando?`;
    }

    // Se só tem salário
    if (hasSalary) {
      const salary = extractedData.pretensao > 0 ? extractedData.pretensao : candidate.pretensao;
      return `✅ Anotado sua pretensão de R$ ${salary.toLocaleString('pt-BR')}. \n\nAgora preciso saber quantos anos de experiência você tem em programação. Pode me informar?`;
    }

    // Se não tem nenhum dados ainda
    return `Olá! Sou a recrutadora tech da empresa. \n\nPara avaliar seu perfil, preciso saber: \n1. Quantos anos de experiência você tem em programação? \n2. Qual sua pretensão salarial (em R$)?`;
  }

  /**
   * Salva a resposta do agente no banco (auditoria)
   */
  async saveAgentResponse(candidateId, response) {
    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const stmt = this.db.prepare(
      'INSERT INTO messages_sent (candidate_id, message, sent_at, success) VALUES (?, ?, ?, 1)'
    );
    stmt.run(candidateId, response, now);
    this.log.system(`Resposta salva no banco para candidato ID ${candidateId}`);
  }

  /**
   * Desabilitar IA e transferir para humano
   */
  async disableAI(candidateId) {
    const stmt = this.db.prepare(
      'UPDATE candidates SET ai_enabled = 0 WHERE id = ?'
    );
    stmt.run(candidateId);
    this.log.warning(`AI desabilitada para candidato ID ${candidateId}`);
  }

  /**
   * Tratamento de erros críticos
   */
  async handleCriticalError(phone, error) {
    this.log.error(`Erro crítico com ${phone}: ${error.message}`);

    try {
      // Buscar candidato
      const candidate = await this.getCandidateByPhone(phone);
      if (candidate) {
        await this.disableAI(candidate.id);
        this.waSocket.sendMessage(phone,
          '⚠️ Estou enfrentando problemas técnicos no momento. Vou transferir você para um recrutador humano. Por favor, aguarde.'
        );
      }
    } catch (fallbackError) {
      this.log.error(`Erro no fallback: ${fallbackError.message}`);
    }
  }

  /**
   * Busca candidato pelo telefone
   */
  getCandidateByPhone(phone) {
    // Remove @s.whatsapp.net se presente
    const cleanPhone = phone.replace('@s.whatsapp.net', '');

    const stmt = this.db.prepare(
      'SELECT * FROM candidates WHERE phone = ? OR phone LIKE ?'
    );
    const candidate = stmt.get(cleanPhone, `%${cleanPhone}%`);

    return candidate || null;
  }

  /**
   * Utilitário de delay
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Status do agente
   */
  getStatus() {
    return {
      enabled: this.aiEnabled,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = AgentService;

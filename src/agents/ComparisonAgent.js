
'use strict'
const { getProvider, PROVIDERS, extractJSON, calcScore } = require('../data/vagas');

class ComparisonAgent {
  constructor() {
    if (!getProvider()) {
      console.warn('[ComparisonAgent] Nenhuma API key configurada no .env. A comparação será simulada.');
    }
  }

  async analyze(candidateData, jobDescription, vagaInfo) {
    if (!getProvider()) {
      return this._simulateAnalysis(candidateData, jobDescription);
    }

    const systemTechnical = `Você é um avaliador técnico especializado na área de TI/Programação. Sua tarefa é analisar as habilidades técnicas de um candidato em relação a uma descrição de vaga e fornecer um score de 0 a 10 para o critério 'tecnico' e uma justificativa concisa. Foque APENAS nas hard skills e experiência relevante.`;
    const systemCulture = `Você é um avaliador cultural e de soft skills, especializado em identificar alinhamento com a cultura Heartist® do Pullman Ibirapuera. Analise o perfil do candidato e a descrição da vaga, focando em soft skills, proatividade, trabalho em equipe e estabilidade profissional. Forneça scores de 0 a 10 para 'heartist', 'experiencia', 'estabilidade' e 'potencial' com justificativas concisas.`;

    const userPrompt = `DADOS DO CANDIDATO:
Nome: ${candidateData.nome}
Contato: ${candidateData.contato}
Habilidades Técnicas: ${candidateData.skills.join(', ')}

INFORMAÇÕES DA VAGA:
Cargo: ${vagaInfo.titulo}
Descrição: ${vagaInfo.descricao}
Requisitos: ${vagaInfo.requisitos ? JSON.parse(vagaInfo.requisitos).join(', ') : 'N/A'}
Diferenciais: ${vagaInfo.diferenciais ? JSON.parse(vagaInfo.diferenciais).join(', ') : 'N/A'}
Competências: ${vagaInfo.competencias ? JSON.parse(vagaInfo.competencias).join(', ') : 'N/A'}
Faixa Salarial: ${vagaInfo.salario}
Regime: ${vagaInfo.regime}

Com base nessas informações e na descrição da vaga, me forneça uma análise objetiva e um JSON com os scores e justificativas conforme seu papel.`;

    // Análise Técnica
    const technicalAnalysis = await this._callLLM(systemTechnical, userPrompt);
    const techResult = extractJSON(technicalAnalysis);

    // Análise Cultural e Soft Skills
    const cultureAnalysis = await this._callLLM(systemCulture, userPrompt);
    const cultureResult = extractJSON(cultureAnalysis);

    const dimensoes = {
      heartist: cultureResult.heartist || { score: 0, justificativa: "" },
      tecnico: techResult.tecnico || { score: 0, justificativa: "" },
      estabilidade: cultureResult.estabilidade || { score: 0, justificativa: "" },
      experiencia: cultureResult.experiencia || { score: 0, justificativa: "" },
      potencial: cultureResult.potencial || { score: 0, justificativa: "" },
    };

    const scoreTotal = calcScore(dimensoes);

    // Combina recomendações e pontos fortes/de atenção
    // Esta parte pode ser melhorada com uma sumarização via LLM, mas para começar, vamos agregar
    const pontosFortes = [...(techResult.pontosFortes || []), ...(cultureResult.pontosFortes || [])];
    const pontosAtencao = [...(techResult.pontosAtencao || []), ...(cultureResult.pontosAtencao || [])];
    const recomendacao = this._getOverallRecommendation(dimensoes);
    const resumo = `Análise combinada: Técnico (${dimensoes.tecnico.score}), Cultural (${dimensoes.heartist.score}). Recomendação: ${recomendacao}.`;

    return {
      dimensoes,
      scoreTotal,
      pontosFortes,
      pontosAtencao,
      recomendacao,
      resumo
    };
  }

  async _callLLM(system, user) {
    const provider = getProvider();
    const cfg = PROVIDERS[provider];

    let content;
    if (provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.key()}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: 'application/json' },
        }),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`gemini ${resp.status}: ${txt.slice(0, 200)}`);
      }
      const data = await resp.json();
      const candidate = data.candidates?.[0];
      if (!candidate || candidate?.finishReason === 'SAFETY') {
        const reason = data.promptFeedback?.blockReason || 'SAFETY';
        throw new Error(`Conteúdo bloqueado pelo filtro de segurança (${reason}).`);
      }
      content = candidate?.content?.parts?.map(p => p.text || '').join('').trim();
    } else {
      // OpenAI-compatible (Groq, OpenRouter)
      const resp = await fetch(`${cfg.base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.key()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.1,
          max_tokens: 1000,
        }),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`${provider} ${resp.status}: ${txt.slice(0, 200)}`);
      }
      const data = await resp.json();
      content = data.choices?.[0]?.message?.content?.trim();
    }
    if (!content) throw new Error('Resposta vazia da IA.');
    return content;
  }

  _simulateAnalysis(candidateData, jobDescription) {
    console.warn('[ComparisonAgent] Simulando análise de candidato (sem LLM). Certifique-se de que uma API key esteja configurada no .env para resultados reais.');
    const score = Math.floor(Math.random() * 100);
    let recomendacao = 'Aguardar';
    if (score > 70) recomendacao = 'Avançar';
    if (score < 30) recomendacao = 'Dispensar';

    const dimensoes = {
      heartist: { score: Math.round(score/10), justificativa: "Simulado" },
      tecnico: { score: Math.round(score/10), justificativa: "Simulado" },
      estabilidade: { score: Math.round(score/10), justificativa: "Simulado" },
      experiencia: { score: Math.round(score/10), justificativa: "Simulado" },
      potencial: { score: Math.round(score/10), justificativa: "Simulado" },
    };

    return {
      dimensoes,
      scoreTotal: score,
      pontosFortes: ["Habilidade simulada", "Outra habilidade"],
      pontosAtencao: ["Ponto de atenção simulado"],
      recomendacao,
      resumo: `Análise simulada: Score ${score}. Recomendação: ${recomendacao}.`
    };
  }

  _getOverallRecommendation(dimensoes) {
    const avgScore = Object.values(dimensoes).reduce((sum, d) => sum + d.score, 0) / Object.keys(dimensoes).length;
    if (avgScore >= 8) return 'Avançar';
    if (avgScore >= 5) return 'Aguardar';
    return 'Dispensar';
  }
}

module.exports = ComparisonAgent;

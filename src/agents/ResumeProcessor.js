
'use strict'
const { getProvider, PROVIDERS, extractJSON } = require('../data/vagas');

class ResumeProcessor {
  constructor() {
    if (!getProvider()) {
      console.warn('[ResumeProcessor] Nenhuma API key configurada no .env. O processamento de currículos será simulado.');
    }
  }

  async parseResume(resumeText) {
    if (!getProvider()) {
      // Simulação de extração sem LLM
      return this._simulateExtraction(resumeText);
    }

    const system = `Você é um extrator de informações de currículos. Sua tarefa é analisar o texto do currículo e extrair o nome completo, informações de contato (email, telefone se disponível) e uma lista de habilidades técnicas relevantes. Priorize informações que pareçam mais profissionais. Seja conciso e não inclua texto explicativo fora o JSON.`;
    const user = `CURRÍCULO:
${resumeText.trim().slice(0, 10000)} -- TRUNCADO PARA ECONOMIZAR TOKENS CASO SEJA MUITO GRANDE

Retorne APENAS o JSON abaixo, sem texto adicional, no formato:
{
  "nome": "<Nome Completo>",
  "contato": "<melhor contato: email ou telefone>",
  "skills": ["<skill1>", "<skill2>", "<skillN>"]
}`; // Trunca para evitar overflow de tokens

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
      const finish = candidate?.finishReason;

      if (!candidate || finish === 'SAFETY') {
        const reason = data.promptFeedback?.blockReason || 'SAFETY';
        throw new Error(`Conteúdo bloqueado pelo filtro de segurança (${reason}).`);
      }
      if (finish === 'MAX_TOKENS') {
        throw new Error('Conteúdo muito longo para processamento. Reduza o texto do currículo.');
      }
      if (finish && finish !== 'STOP') {
        throw new Error(`Resposta incompleta da IA (${finish}).`);
      }
      const parts = candidate?.content?.parts || [];
      content = parts.map(p => p.text || '').join('').trim();
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

    if (!content) throw new Error('Resposta vazia da IA na extração de currículo.');

    const clean = content.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    return extractJSON(clean);
  }

  _simulateExtraction(resumeText) {
    console.warn('[ResumeProcessor] Simulando extração de currículo (sem LLM). Certifique-se de que uma API key esteja configurada no .env para resultados reais.');
    const lines = resumeText.split('\n');
    let name = 'Nome Extraído (Simulado)';
    let contact = 'contato.simulado@exemplo.com';
    const skills = ['Simulated Skill 1', 'Simulated Skill 2'];

    // Tenta extrair nome e contato de forma simples
    for (const line of lines) {
      if (line.trim().length > 5 && line.trim().length < 50 && line.toUpperCase() === line) {
        name = line.trim(); // Assume que o nome pode estar em MAIÚSCULAS
        break;
      }
    }
    for (const line of lines) {
      if (line.includes('@') && line.includes('.')) {
        contact = line.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0] || contact;
        break;
      }
    }

    // Adiciona algumas skills baseado na presença de palavras-chave
    if (resumeText.toLowerCase().includes('javascript')) skills.push('JavaScript');
    if (resumeText.toLowerCase().includes('python')) skills.push('Python');
    if (resumeText.toLowerCase().includes('react')) skills.push('React');

    return {
      nome: name,
      contato: contact,
      skills: Array.from(new Set(skills)) // Remove duplicatas
    };
  }
}

module.exports = ResumeProcessor;

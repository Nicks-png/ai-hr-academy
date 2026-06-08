'use strict'

const express = require('express')
const router  = express.Router()
const { PROVIDERS, getProvider } = require('../data/vagas')

const SYSTEM_PROMPT = `Você é Sofia, assistente virtual especialista em RH da Pullman Ibirapuera.
Responda SEMPRE em português do Brasil, de forma natural, calorosa e concisa — máximo 3 frases curtas por resposta.
Você domina completamente:
- CLT: férias (30 dias após 12 meses), 13º salário (pago em duas parcelas), FGTS (8% do salário), horas extras (50% a mais ou 100% em feriados), jornada máxima de 8h/dia e 44h/semana, aviso prévio (mínimo 30 dias), rescisão (TRCT, multa de 40% do FGTS), licença maternidade (120 dias), licença paternidade (5 dias), adicional noturno (20% entre 22h-5h), intervalo intrajornada mínimo de 1h para jornadas acima de 6h.
- Cultura Pullman Ibirapuera / Heartist: filosofia que transforma colaboradores em embaixadores da hospitalidade, valorização do bem-estar, programas de desenvolvimento interno como Académie Pullman, política de promoção interna (Talent & Culture), benefícios padrão (vale refeição, vale transporte, plano de saúde, seguro de vida, PLR).
- RH geral: recrutamento e seleção por competências, onboarding estruturado, avaliação de desempenho 360°, plano de desenvolvimento individual (PDI), feedback contínuo, gestão de conflitos, demissão humanizada.
Quando houver contexto de página, use-o para personalizar a resposta ao que o usuário está fazendo agora.
Fale como em uma ligação telefônica — direto, humano, sem markdown, sem listas com traços ou asteriscos.`

router.post('/api/voice-chat', async (req, res) => {
  const { messages = [], context = {} } = req.body

  if (!messages.length) {
    return res.status(400).json({ error: 'messages obrigatório' })
  }

  const providerName = getProvider()
  if (!providerName) {
    return res.status(503).json({ error: 'Nenhum provedor de IA configurado' })
  }
  const cfg = PROVIDERS[providerName]

  // Montar contexto de página
  let contextMsg = ''
  if (context.page === 'triagem') {
    contextMsg = 'Contexto: o usuário está na tela de Triagem de Currículos'
    if (context.vaga)       contextMsg += `, avaliando candidatos para a vaga de ${context.vaga}`
    if (context.step)       contextMsg += `, na etapa ${context.step} do fluxo`
    if (context.candidatos) contextMsg += `, com ${context.candidatos} candidato(s) adicionado(s)`
  } else if (context.page === 'whatsapp') {
    contextMsg = 'Contexto: o usuário está no painel WhatsApp Recruiter'
    if (context.total)    contextMsg += ` com ${context.total} candidato(s) cadastrado(s)`
    if (context.pendentes != null) contextMsg += `, sendo ${context.pendentes} pendente(s) de resposta`
  } else if (context.page === 'cursos') {
    contextMsg = 'Contexto: o usuário está navegando no catálogo de cursos gratuitos de IA para RH'
  } else if (context.page === 'home') {
    contextMsg = 'Contexto: o usuário está na página inicial da plataforma AI-HR Academy'
  }

  const systemFull = contextMsg
    ? `${SYSTEM_PROMPT}\n\n${contextMsg}.`
    : SYSTEM_PROMPT

  // Últimas 10 mensagens para manter contexto sem estourar tokens
  const history = messages.slice(-10)

  try {
    let reply = ''

    if (providerName === 'gemini') {
      const geminiHistory = history.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.key()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemFull }] },
            contents: geminiHistory,
            generationConfig: { temperature: 0.75, maxOutputTokens: 300 },
          }),
        }
      )
      const data = await r.json()
      reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''
    } else {
      const r = await fetch(`${cfg.base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.key()}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [{ role: 'system', content: systemFull }, ...history],
          temperature: 0.75,
          max_tokens: 300,
        }),
      })
      const data = await r.json()
      reply = data.choices?.[0]?.message?.content?.trim() || ''
    }

    if (!reply) return res.status(502).json({ error: 'Resposta vazia da IA' })
    res.json({ reply })
  } catch (err) {
    console.error('[Voice] Erro:', err.message)
    res.status(500).json({ error: 'Erro ao consultar IA' })
  }
})

module.exports = router

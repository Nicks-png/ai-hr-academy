'use strict'
const express  = require('express')
const router   = express.Router()
const { PROVIDERS, getProvider, extractJSON } = require('../data/vagas')
const { auth } = require('../middleware/auth')

// POST /api/curriculo/avaliar
router.post('/curriculo/avaliar', auth, async (req, res) => {
  const { cvText, vaga } = req.body || {}

  if (!cvText?.trim() || cvText.trim().length < 80)
    return res.status(400).json({ error: 'Texto do currículo muito curto. Envie o CV completo.' })
  if (!getProvider())
    return res.status(500).json({ error: 'Nenhuma API key configurada.' })

  const vagaCtx = vaga?.trim() ? `\nCONTEXTO DE VAGA: O candidato está se candidatando para "${vaga.trim()}".` : ''

  const prompt = `Você é um especialista em RH e coach de carreira com 15 anos de experiência avaliando currículos no mercado brasileiro.

Analise o currículo abaixo e retorne um JSON estruturado com uma avaliação detalhada, honesta e construtiva.${vagaCtx}

CURRÍCULO:
"""
${cvText.slice(0, 6000)}
"""

Retorne SOMENTE o JSON abaixo, sem markdown, sem texto antes ou depois:

{
  "nota": <número de 0 a 100>,
  "nivel": "<Iniciante | Intermediário | Sênior | Especialista>",
  "resumo": "<2 frases resumindo o perfil do candidato>",
  "qualidades": ["<ponto forte 1>", "<ponto forte 2>", "<ponto forte 3>"],
  "pontos_fracos": ["<fraqueza 1>", "<fraqueza 2>", "<fraqueza 3>"],
  "melhorias": ["<sugestão prática 1>", "<sugestão prática 2>", "<sugestão prática 3>", "<sugestão prática 4>"],
  "formatacao": "<Excelente | Boa | Regular | Precisa melhorar>",
  "nivel_ingles": "<nível de inglês mencionado ou evidenciado, ou 'Não mencionado'>",
  "dica_destaque": "<uma dica personalizada e específica para este candidato se destacar>"
}`

  try {
    const texto = await chamarIA(prompt)
    const json  = extractJSON(texto)
    if (typeof json.nota !== 'number' || !Array.isArray(json.qualidades))
      throw new Error('Resposta incompleta da IA.')
    res.json(json)
  } catch (e) {
    console.error('[curriculo] Erro:', e.message)
    res.status(500).json({ error: 'Não foi possível avaliar o currículo. Tente novamente.' })
  }
})

async function chamarIA(prompt) {
  const ORDER = ['gemini', 'groq', 'openrouter'].filter(p => PROVIDERS[p].key())
  if (!ORDER.length) throw new Error('Nenhuma API key configurada.')

  for (const provider of ORDER) {
    const cfg = PROVIDERS[provider]
    try {
      let resp
      if (provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${cfg.key()}`
        resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 2048, responseMimeType: 'application/json' }
          })
        })
      } else {
        resp = await fetch(`${cfg.base}/chat/completions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cfg.key()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: cfg.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.4,
            max_tokens: 2048
          })
        })
      }

      if (resp.status === 429) { console.warn(`[curriculo] ${provider} 429, próximo`); continue }
      if (!resp.ok) { console.warn(`[curriculo] ${provider} ${resp.status}`); continue }

      const data = await resp.json()
      const text = provider === 'gemini'
        ? data.candidates?.[0]?.content?.parts?.[0]?.text
        : data.choices?.[0]?.message?.content
      if (text) { console.log(`[curriculo] OK via ${provider}`); return text }
    } catch (e) {
      console.warn(`[curriculo] ${provider} erro:`, e.message)
    }
  }
  throw new Error('Todos os provedores falharam.')
}

module.exports = router

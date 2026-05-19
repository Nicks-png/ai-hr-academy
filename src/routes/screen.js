'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../../db')
const { auth } = require('../middleware/auth')
const { getVagaById, PROVIDERS, getProvider, calcScore, extractJSON } = require('../data/vagas')
const { analisarCandidato } = require('../services/triarCandidato')

// POST /api/screen — SSE streaming
router.post('/screen', auth, async (req, res) => {
  const { vagaId, candidatos } = req.body || {}

  if (!vagaId)
    return res.status(400).json({ error: 'vagaId inválido.' })
  if (!Array.isArray(candidatos) || candidatos.length === 0)
    return res.status(400).json({ error: 'Envie ao menos um candidato.' })
  if (!getProvider())
    return res.status(500).json({ error: 'Nenhuma API key configurada no .env (GEMINI_API_KEY, GROQ_API_KEY ou OPENROUTER_API_KEY).' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const sse = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const vaga = await getVagaById(vagaId)
  if (!vaga) return res.status(400).json({ error: 'Vaga não encontrada.' })
  sse('start', { total: candidatos.length, vaga: vaga.titulo })

  const resultados = []

  for (let i = 0; i < candidatos.length; i++) {
    const c = candidatos[i]
    if (!c.nome?.trim() || !c.curriculo?.trim()) {
      sse('candidato', { index: i, nome: c.nome || `Candidato ${i + 1}`, erro: 'Nome ou currículo vazio.' })
      continue
    }

    sse('progress', { index: i, nome: c.nome, status: 'analisando' })

    if (i > 0) await new Promise(r => setTimeout(r, 7000))

    try {
      const analise = await analisarCandidato(vaga, c)
      if (analise.dimensoes) {
        if (!analise.dimensoes.estabilidade?.score && analise.dimensoes.disponibilidade?.score)
          analise.dimensoes.estabilidade = analise.dimensoes.disponibilidade
        delete analise.dimensoes.disponibilidade
      }
      const nomeReal = analise.nome_detectado?.trim() || c.nome
      resultados.push({ nome: nomeReal, curriculo: c.curriculo, ...analise })
    } catch (err) {
      sse('candidato', { index: i, nome: c.nome, erro: err.message })
    }
  }

  sse('progress', { index: -1, nome: '', status: 'comparando' })

  let rankMap = {}
  try {
    const raw = await rankearComparativamente(vaga, resultados)
    Object.entries(raw).forEach(([k, v]) => { rankMap[k.trim().toLowerCase()] = v })
  } catch (e) {
    console.warn('[screen] Ranking comparativo falhou, usando calcScore:', e.message)
  }

  const norm = s => (s || '').trim().toLowerCase()

  const candidatosRankeados = resultados.map((r, i) => {
    const scoreTotal = rankMap[norm(r.nome)] ?? calcScore(r.dimensoes)
    const resultado  = { ...r, scoreTotal }
    delete resultado.curriculo
    sse('candidato', { index: i, nome: r.nome, resultado })
    return resultado
  })

  const ranking = candidatosRankeados
    .sort((a, b) => b.scoreTotal - a.scoreTotal)
    .map((r, pos) => ({ ...r, posicao: pos + 1 }))

  sse('done', { ranking })

  if (ranking.length) {
    try {
      // Busca o time ativo do usuário (primeiro time que ele pertence)
      const userTeam = await db.get(
        'SELECT t.id, t.name FROM teams t JOIN user_teams ut ON t.id = ut.team_id WHERE ut.user_id = ? LIMIT 1',
        [req.user.id]
      )
      await db.run(
        `INSERT INTO screenings
          (vaga_id, vaga_titulo, total, resultado, created_by_user_id, created_by_name, team_id, team_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [vagaId, vaga.titulo, ranking.length, JSON.stringify(ranking),
         req.user.id, req.user.name,
         userTeam?.id || null, userTeam?.name || null]
      )
    } catch (e) {
      console.warn('[screen] Erro ao salvar histórico:', e.message)
    }
  }

  res.end()
})

// POST /api/ocr
router.post('/ocr', async (req, res) => {
  const { data, mimeType } = req.body || {}
  if (!data || !mimeType) return res.status(400).json({ error: 'Dados inválidos.' })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'Gemini API Key não configurada. OCR requer Gemini.' })

  const prompt = `Transcreva TODO o texto deste currículo exatamente como está escrito. Não analise, não interprete — apenas transcreva fielmente nome, contatos, experiências, formação, cursos e habilidades.`

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { inlineData: { mimeType, data } },
          { text: prompt }
        ]}],
        generationConfig: { temperature: 0, maxOutputTokens: 8192 }
      })
    })

    if (!resp.ok) {
      const err = await resp.text()
      return res.status(500).json({ error: `OCR falhou: ${err.slice(0, 200)}` })
    }

    const json = await resp.json()
    const texto = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    if (!texto) return res.status(500).json({ error: 'OCR retornou texto vazio.' })

    console.log(`[OCR] Extraídos ${texto.length} chars via Gemini Vision`)
    res.json({ texto })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/screenings
router.get('/screenings', auth, async (req, res) => {
  try {
    let rows
    if (req.user.role === 'admin') {
      rows = await db.all(
        'SELECT id, vaga_id, vaga_titulo, total, created_at, created_by_name, team_id, team_name FROM screenings ORDER BY created_at DESC'
      )
    } else {
      // rh/manager: só vê triagens do próprio time
      const userTeams = await db.all(
        'SELECT team_id FROM user_teams WHERE user_id = ?', [req.user.id]
      )
      if (!userTeams.length) {
        // sem time: vê só as próprias triagens
        rows = await db.all(
          'SELECT id, vaga_id, vaga_titulo, total, created_at, created_by_name, team_id, team_name FROM screenings WHERE created_by_user_id = ? ORDER BY created_at DESC',
          [req.user.id]
        )
      } else {
        const ids = userTeams.map(r => r.team_id)
        const placeholders = ids.map(() => '?').join(',')
        rows = await db.all(
          `SELECT id, vaga_id, vaga_titulo, total, created_at, created_by_name, team_id, team_name
           FROM screenings WHERE team_id IN (${placeholders}) ORDER BY created_at DESC`,
          ids
        )
      }
    }
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/screenings/:id
router.get('/screenings/:id', auth, async (req, res) => {
  try {
    const row = await db.get('SELECT * FROM screenings WHERE id = ?', [req.params.id])
    if (!row) return res.status(404).json({ error: 'Não encontrado.' })
    row.resultado = JSON.parse(row.resultado || '[]')
    res.json(row)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/screenings/:id
router.delete('/screenings/:id', auth, async (req, res) => {
  try {
    const info = await db.run('DELETE FROM screenings WHERE id = ?', [req.params.id])
    if (info.changes === 0) return res.status(404).json({ error: 'Não encontrado.' })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/candidates/:id
router.delete('/candidates/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!id) return res.status(400).json({ error: 'ID inválido.' })
    const cand = await db.get('SELECT id FROM candidates WHERE id = ?', [id])
    if (!cand) return res.status(404).json({ error: 'Candidato não encontrado.' })
    await db.run('DELETE FROM messages_sent WHERE candidate_id = ?', [id])
    await db.run('DELETE FROM messages_received WHERE candidate_id = ?', [id])
    await db.run('DELETE FROM candidates WHERE id = ?', [id])
    res.json({ ok: true, message: 'Candidato removido com sucesso.' })
  } catch (err) {
    console.error('[API] Erro ao deletar candidato:', err)
    res.status(500).json({ error: 'Erro interno do servidor.' })
  }
})

// analisarCandidato importado de src/services/triarCandidato.js

async function rankearComparativamente(vaga, candidatos) {
  const blocos = candidatos.map((c, i) =>
    `=== CANDIDATO ${i + 1}: ${c.nome} ===\n${(c.curriculo || '').trim().slice(0, 2500)}`
  ).join('\n\n')

  const n = candidatos.length
  const prompt = `Você é especialista em Talent & Culture da Accor Brasil.\n\nVAGA: ${vaga.titulo} | ${vaga.marca}\nRequisitos: ${JSON.parse(vaga.requisitos).join(' · ')}\nCompetências-chave: ${JSON.parse(vaga.competencias).join(' · ')}\n\nAbaixo estão ${n} currículos. Leia TODOS e depois atribua um score de 0-100 para cada um.\n\nREGRAS OBRIGATÓRIAS:\n- Scores devem refletir a diferença REAL entre os candidatos\n- NENHUM candidato pode ter o mesmo score que outro\n- O melhor candidato deve ter score significativamente maior que o pior\n- Seja criterioso: use toda a faixa de 0-100\n\n${blocos}\n\nRetorne APENAS este JSON, sem texto adicional:\n[\n  { "nome": "<nome exato>", "score": <0-100> },\n  ...\n]`

  const PROVIDER_ORDER = ['gemini', 'groq', 'openrouter'].filter(p => PROVIDERS[p].key())
  const GEMINI_MODELS  = ['gemini-2.0-flash', 'gemini-2.0-flash-lite']
  const OR_MODELS      = [process.env.AI_MODEL, 'google/gemma-4-31b-it:free', 'nousresearch/hermes-3-llama-3.1-405b:free', 'meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-oss-20b:free'].filter(Boolean).filter((v,i,a) => a.indexOf(v)===i)

  for (const provider of PROVIDER_ORDER) {
    const cfg    = PROVIDERS[provider]
    const models = provider === 'gemini' ? GEMINI_MODELS : provider === 'openrouter' ? OR_MODELS : [cfg.model]

    for (const modelAtual of models) {
      try {
        let resp, text
        if (provider === 'gemini') {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelAtual}:generateContent?key=${cfg.key()}`
          resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.2, maxOutputTokens: 512, responseMimeType: 'application/json' }
            })
          })
          if (!resp.ok) continue
          const data = await resp.json()
          text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
        } else {
          resp = await fetch(`${cfg.base}/chat/completions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${cfg.key()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 512 })
          })
          if (!resp.ok) continue
          const data = await resp.json()
          text = data.choices?.[0]?.message?.content || ''
        }

        const arr = extractJSON(text)
        if (!Array.isArray(arr) || arr.length !== n) continue
        const scores = arr.map(x => Number(x.score))
        const unicos = new Set(scores)
        if (unicos.size < n) arr.forEach((x, i) => { x.score = Number(x.score) + (n - i) * 0.1 })

        const map = {}
        arr.forEach(x => { map[x.nome] = Number(x.score) })
        console.log('[screen] Ranking comparativo:', JSON.stringify(map))
        return map
      } catch (e) {
        console.warn(`[screen] rankear ${provider}/${modelAtual}:`, e.message)
        continue
      }
    }
  }
  throw new Error('Ranking comparativo falhou em todos os provedores.')
}

module.exports = router

'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { getVagaById, PROVIDERS, getProvider, calcScore, extractJSON } = require('../data/vagas')

// POST /api/screen — SSE streaming
router.post('/screen', async (req, res) => {
  const { vagaId, candidatos } = req.body || {}

  if (!vagaId)
    return res.status(400).json({ error: 'vagaId inválido.' })
  if (!Array.isArray(candidatos) || candidatos.length === 0)
    return res.status(400).json({ error: 'Envie ao menos um candidato.' })
  if (candidatos.length > 10)
    return res.status(400).json({ error: 'Máximo de 10 candidatos por triagem.' })
  if (!getProvider())
    return res.status(500).json({ error: 'Nenhuma API key configurada no .env (GEMINI_API_KEY, GROQ_API_KEY ou OPENROUTER_API_KEY).' })

  // SSE headers
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

    try {
      const dimensoes  = await analisarCandidato(vaga, c)
      const scoreTotal = calcScore(dimensoes.dimensoes)
      const resultado  = { ...dimensoes, scoreTotal }
      resultados.push({ nome: c.nome, ...resultado })
      sse('candidato', { index: i, nome: c.nome, resultado })
    } catch (err) {
      sse('candidato', { index: i, nome: c.nome, erro: err.message })
    }
  }

  // Ranking final — só quem tem scoreTotal
  const ranking = resultados
    .sort((a, b) => b.scoreTotal - a.scoreTotal)
    .map((r, pos) => ({ ...r, posicao: pos + 1 }))

  sse('done', { ranking })
  res.end()
})

// POST /api/screen/save-candidate — salva resultado da triagem no banco
router.post('/screen/save-candidate', (req, res) => {
  const { nome, vagaId, status, curriculo, scoreTotal, recomendacao, resumo, dimensoes, pontosFort, pontosAtencao } = req.body || {}
  if (!nome?.trim() || !vagaId) return res.status(400).json({ error: 'nome e vagaId obrigatórios.' })

  const vaga = db.prepare('SELECT titulo FROM vagas WHERE id = ?').get(vagaId)
  const jobPosition = vaga?.titulo || vagaId

  // Skills = pontos fortes como fallback
  const skills = JSON.stringify(pontosFort || [])
  const dimsJson = dimensoes ? JSON.stringify(dimensoes) : null

  try {
    // Usa nome como chave de upsert dentro da mesma vaga
    const existing = db.prepare('SELECT id FROM candidates WHERE name = ? AND job_id = ?').get(nome.trim(), vagaId)
    if (existing) {
      db.prepare(`UPDATE candidates SET
        status = ?, ai_score_total = ?, ai_recomendacao = ?, ai_resumo = ?,
        ai_dimensoes = ?, ai_pontos_fortes = ?, ai_pontos_atencao = ?,
        skills = ?, updated_at = datetime('now','localtime')
        WHERE id = ?`).run(
        status, scoreTotal ?? null, recomendacao ?? null, resumo ?? null,
        dimsJson, JSON.stringify(pontosFort || []), JSON.stringify(pontosAtencao || []),
        skills, existing.id
      )
      db.prepare('INSERT INTO candidate_history (candidate_id, old_status, new_status) VALUES (?,?,?)').run(existing.id, null, status)
      return res.json({ ok: true, id: existing.id, updated: true })
    }

    const r = db.prepare(`INSERT INTO candidates
      (name, phone, job_position, job_id, status, ai_score_total, ai_recomendacao, ai_resumo,
       ai_dimensoes, ai_pontos_fortes, ai_pontos_atencao, skills)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      nome.trim(), '', jobPosition, vagaId, status,
      scoreTotal ?? null, recomendacao ?? null, resumo ?? null,
      dimsJson, JSON.stringify(pontosFort || []), JSON.stringify(pontosAtencao || []),
      skills
    )
    db.prepare('INSERT INTO candidate_history (candidate_id, old_status, new_status) VALUES (?,?,?)').run(r.lastInsertRowid, null, status)
    res.json({ ok: true, id: r.lastInsertRowid })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/candidates/:id — deleta candidato e suas mensagens
router.delete('/candidates/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!id) return res.status(400).json({ error: 'ID inválido.' })

    // Verifica se candidato existe
    const cand = db.prepare('SELECT id FROM candidates WHERE id = ?').get(id)
    if (!cand) return res.status(404).json({ error: 'Candidato não encontrado.' })

    // Deleta mensagens primeiro (FK constraints)
    db.prepare('DELETE FROM messages_sent WHERE candidate_id = ?').run(id)
    db.prepare('DELETE FROM messages_received WHERE candidate_id = ?').run(id)
    db.prepare('DELETE FROM candidates WHERE id = ?').run(id)

    res.json({ ok: true, message: 'Candidato removido com sucesso.' })
  } catch (err) {
    console.error('[API] Erro ao deletar candidato:', err)
    res.status(500).json({ error: 'Erro interno do servidor.' })
  }
})

// ─── IA — análise individual ──────────────────────────────────────────────────

async function analisarCandidato(vaga, candidato) {
  const system = `Você é especialista em Talent & Culture da Accor Brasil.

CONTEXTO DA EMPRESA:
Accor Brasil — 330+ hotéis, 50.000+ colaboradores, maior rede hoteleira da América do Sul.
Filosofia Heartist®: colaboradores que unem coração e arte no atendimento. Autenticidade e paixão pela hospitalidade são inegociáveis.
Desafio crítico do setor: turnover de 52% — disponibilidade para escala 6x1 é fator eliminatório.
Regime: CLT brasileiro. Avalie disponibilidade para fins de semana, feriados e turnos rotativos.

VAGA EM ABERTO:
Cargo: ${vaga.titulo} | Marca: ${vaga.marca}
Descrição: ${vaga.descricao}
Requisitos obrigatórios: ${JSON.parse(vaga.requisitos).join(' · ')}
Diferenciais valorizados: ${JSON.parse(vaga.diferenciais).join(' · ')}
Competências-chave: ${JSON.parse(vaga.competencias).join(' · ')}
Faixa salarial: ${vaga.salario} | Regime: ${vaga.regime}

REGRA: Baseie-se exclusivamente no que está escrito no currículo. Não invente informações.`

  // Trunca CV a 12.000 chars para não estourar o limite de tokens
  const cvTexto = candidato.curriculo.trim().slice(0, 12000)

  const user = `CANDIDATO: ${candidato.nome}

CURRÍCULO:
${cvTexto}

Retorne APENAS o JSON abaixo, sem texto adicional:
{
  "dimensoes": {
    "heartist":       { "score": <0-10>, "justificativa": "<1 frase direta>" },
    "tecnico":        { "score": <0-10>, "justificativa": "<1 frase direta>" },
    "disponibilidade":{ "score": <0-10>, "justificativa": "<1 frase direta>" },
    "experiencia":    { "score": <0-10>, "justificativa": "<1 frase direta>" },
    "potencial":      { "score": <0-10>, "justificativa": "<1 frase direta>" }
  },
  "pontosFort":   ["<ponto objetivo>", "<ponto objetivo>"],
  "pontosAtencao":["<ponto objetivo>", "<ponto objetivo>"],
  "recomendacao": "<Avançar|Aguardar|Dispensar>",
  "resumo":       "<2-3 frases objetivas para o gestor>"
}`

  const provider = getProvider()
  const cfg      = PROVIDERS[provider]

  let content
  if (provider === 'gemini') {
    // API nativa do Gemini (maior cota no plano gratuito)
    const url  = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.key()}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.15, maxOutputTokens: 8192, responseMimeType: 'application/json' },
      }),
    })
    if (!resp.ok) {
      const txt = await resp.text()
      throw new Error(`gemini ${resp.status}: ${txt.slice(0, 200)}`)
    }
    const data      = await resp.json()
    const candidate = data.candidates?.[0]
    const finish    = candidate?.finishReason

    if (!candidate || finish === 'SAFETY') {
      const reason = data.promptFeedback?.blockReason || 'SAFETY'
      throw new Error(`Conteúdo bloqueado pelo filtro de segurança (${reason}).`)
    }
    if (finish === 'MAX_TOKENS') {
      throw new Error('Currículo muito longo. Reduza o texto e tente novamente.')
    }
    if (finish && finish !== 'STOP') {
      throw new Error(`Resposta incompleta da IA (${finish}).`)
    }

    const parts = candidate?.content?.parts || []
    content = parts.map(p => p.text || '').join('').trim()
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
          { role: 'user',   content: user },
        ],
        temperature: 0.15,
        max_tokens: 700,
      }),
    })
    if (!resp.ok) {
      const txt = await resp.text()
      throw new Error(`${provider} ${resp.status}: ${txt.slice(0, 200)}`)
    }
    const data = await resp.json()
    content = data.choices?.[0]?.message?.content?.trim()
  }

  if (!content) throw new Error('Resposta vazia da IA.')

  const clean = content.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()
  return extractJSON(clean)
}

// POST /api/shortlist/xlsx — gera planilha XLSX da shortlist
router.post('/shortlist/xlsx', (req, res) => {
  const XLSX = require('xlsx')
  const { vaga, candidatos } = req.body || {}
  if (!Array.isArray(candidatos) || !candidatos.length)
    return res.status(400).json({ error: 'candidatos[] obrigatório.' })

  const DIM_LABELS = {
    heartist: 'Heartist®', tecnico: 'Técnico',
    disponibilidade: 'Disponibilidade', experiencia: 'Experiência', potencial: 'Potencial',
  }

  const rows = candidatos.map((r, i) => {
    const row = {
      '#':           i + 1,
      'Nome':        r.nome || r.name || '—',
      'Score':       r.scoreTotal ?? '—',
      'Recomendação':r.recomendacao || '—',
      'Resumo':      r.resumo || '',
    }
    Object.entries(DIM_LABELS).forEach(([k, l]) => {
      row[l] = r.dimensoes?.[k]?.score ?? '—'
    })
    row['Pontos Fortes']    = (r.pontosFort    || []).join(' | ')
    row['Pontos de Atenção'] = (r.pontosAtencao || []).join(' | ')
    return row
  })

  const wb  = XLSX.utils.book_new()
  const ws  = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, `Shortlist — ${(vaga?.titulo || 'Candidatos').slice(0,28)}`)

  const buf  = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const slug = (vaga?.titulo || 'shortlist').toLowerCase().replace(/\s+/g, '-')
  const nome = `shortlist-${slug}-${new Date().toISOString().slice(0,10)}.xlsx`
  res.set({
    'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${nome}"`,
  })
  res.send(buf)
})

module.exports = router

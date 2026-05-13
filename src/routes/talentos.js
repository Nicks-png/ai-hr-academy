'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../../db')
const { requireRole }                          = require('../middleware/auth')
const { getVagaById, PROVIDERS, getProvider, extractJSON } = require('../data/vagas')

// GET /api/talentos — pool completo com dados do candidato
router.get('/talentos', ...requireRole('admin', 'rh'), (req, res) => {
  const rows = db.prepare(`
    SELECT
      tp.id, tp.candidate_id, tp.tags, tp.notas, tp.added_by, tp.added_at,
      c.name, c.phone, c.job_position, c.job_id, c.status,
      c.ai_score_total, c.ai_resumo, c.ai_pontos_fortes, c.ai_dimensoes, c.email,
      COALESCE(v.titulo, c.job_position) AS vaga_titulo
    FROM talent_pool tp
    JOIN candidates c ON c.id = tp.candidate_id
    LEFT JOIN vagas v ON c.job_id = v.id
    ORDER BY tp.added_at DESC
  `).all()
  res.json(rows)
})

// POST /api/talentos — adicionar ao pool
router.post('/talentos', ...requireRole('admin', 'rh'), (req, res) => {
  const { candidate_id, tags, notas } = req.body
  if (!candidate_id) return res.status(400).json({ error: 'candidate_id obrigatório.' })

  const c = db.prepare('SELECT id FROM candidates WHERE id = ?').get(candidate_id)
  if (!c) return res.status(404).json({ error: 'Candidato não encontrado.' })

  const name = req.user.name || req.user.email
  try {
    db.prepare(
      'INSERT INTO talent_pool (candidate_id, tags, notas, added_by) VALUES (?,?,?,?)'
    ).run(candidate_id, tags || null, notas || null, name)
    res.json({ ok: true })
  } catch (err) {
    if (err.message.includes('UNIQUE'))
      return res.status(409).json({ error: 'Candidato já está no banco de talentos.' })
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/talentos/:candidate_id — atualizar tags/notas
router.patch('/talentos/:candidate_id', ...requireRole('admin', 'rh'), (req, res) => {
  const { tags, notas } = req.body
  const r = db.prepare(
    'UPDATE talent_pool SET tags = ?, notas = ? WHERE candidate_id = ?'
  ).run(tags ?? null, notas ?? null, req.params.candidate_id)
  if (r.changes === 0) return res.status(404).json({ error: 'Não encontrado no banco.' })
  res.json({ ok: true })
})

// DELETE /api/talentos/:candidate_id — remover do pool
router.delete('/talentos/:candidate_id', ...requireRole('admin', 'rh'), (req, res) => {
  const r = db.prepare('DELETE FROM talent_pool WHERE candidate_id = ?').run(req.params.candidate_id)
  if (r.changes === 0) return res.status(404).json({ error: 'Não encontrado no banco.' })
  res.json({ ok: true })
})

// POST /api/talentos/match/:vaga_id — ranking de compatibilidade IA
router.post('/talentos/match/:vaga_id', ...requireRole('admin', 'rh'), async (req, res) => {
  if (!getProvider())
    return res.status(503).json({ error: 'Nenhuma API key de IA configurada.' })

  const vaga = await getVagaById(req.params.vaga_id)
  if (!vaga) return res.status(404).json({ error: 'Vaga não encontrada.' })

  const talentos = db.prepare(`
    SELECT tp.candidate_id, tp.tags, tp.notas,
           c.name, c.job_position, c.ai_resumo, c.ai_pontos_fortes, c.ai_score_total, c.phone
    FROM talent_pool tp
    JOIN candidates c ON c.id = tp.candidate_id
  `).all()

  if (!talentos.length)
    return res.json({ ok: true, vaga: vaga.titulo, ranking: [] })

  const candidateList = talentos.map(t => {
    const desc = [
      t.ai_resumo        ? `Resumo: ${t.ai_resumo}`                  : null,
      t.ai_pontos_fortes ? `Pontos fortes: ${t.ai_pontos_fortes}`     : null,
      t.tags             ? `Tags: ${t.tags}`                          : null,
      t.job_position     ? `Última vaga: ${t.job_position}`           : null,
    ].filter(Boolean).join(' | ')
    return `ID:${t.candidate_id} | ${t.name}\n${desc}`
  }).join('\n---\n')

  const reqs = (() => { try { return JSON.parse(vaga.requisitos).join(', ') } catch { return vaga.requisitos || '' } })()

  const prompt = `Você é especialista em recrutamento da Accor Brasil.

VAGA: ${vaga.titulo}
Descrição: ${vaga.descricao}
Requisitos: ${reqs}

Avalie a compatibilidade de cada candidato abaixo para esta vaga.
Retorne SOMENTE JSON válido, sem texto adicional:
{"ranking":[{"id":NUMBER,"score":0-100,"razao":"até 15 palavras"},...]}
Inclua todos os candidatos ordenados do mais ao menos compatível.

CANDIDATOS:
${candidateList}`

  try {
    const text = await callAI(prompt)
    const data = extractJSON(text)
    const map  = {}
    talentos.forEach(t => { map[t.candidate_id] = t })

    const ranking = (data.ranking || []).map(r => ({
      candidate_id:   r.id,
      name:           map[r.id]?.name || '—',
      score:          Math.max(0, Math.min(100, Number(r.score) || 0)),
      razao:          r.razao || '',
      phone:          map[r.id]?.phone || null,
      ai_score_total: map[r.id]?.ai_score_total || null,
      tags:           map[r.id]?.tags || null,
    })).filter(r => r.candidate_id)

    res.json({ ok: true, vaga: vaga.titulo, ranking })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

async function callAI(prompt) {
  const provider = getProvider()
  const cfg      = PROVIDERS[provider]
  const resp     = await fetch(`${cfg.base}/chat/completions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key()}` },
    body: JSON.stringify({
      model:      cfg.model,
      messages:   [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens:  1200,
    }),
  })
  if (!resp.ok) throw new Error(`IA retornou ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
  const json = await resp.json()
  return json.choices?.[0]?.message?.content?.trim() || ''
}

module.exports = router

'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../../db')
const { requireRole }                          = require('../middleware/auth')
const { getVagaById, PROVIDERS, getProvider, extractJSON } = require('../data/vagas')

// GET /api/talentos
router.get('/talentos', ...requireRole('admin', 'rh'), async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT
        tp.id, tp.candidate_id, tp.tags, tp.notas, tp.added_by, tp.added_at,
        c.name, c.phone, c.job_position, c.job_id, c.status,
        c.ai_score_total, c.ai_resumo, c.ai_pontos_fortes, c.ai_dimensoes, c.email,
        COALESCE(v.titulo, c.job_position) AS vaga_titulo
      FROM talent_pool tp
      JOIN candidates c ON c.id = tp.candidate_id
      LEFT JOIN vagas v ON c.job_id = v.id
      ORDER BY tp.added_at DESC
    `)
    res.json(rows)
  } catch (err) {
    console.error('[talentos GET]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// POST /api/talentos
router.post('/talentos', ...requireRole('admin', 'rh'), async (req, res) => {
  try {
    const { candidate_id, tags, notas } = req.body
    if (!candidate_id) return res.status(400).json({ error: 'candidate_id obrigatório.' })

    const c = await db.get('SELECT id FROM candidates WHERE id = ?', [candidate_id])
    if (!c) return res.status(404).json({ error: 'Candidato não encontrado.' })

    const name = req.user.name || req.user.email
    try {
      await db.run(
        'INSERT INTO talent_pool (candidate_id, tags, notas, added_by) VALUES (?,?,?,?)',
        [candidate_id, tags || null, notas || null, name]
      )
      res.json({ ok: true })
    } catch (err) {
      if (err.message?.includes('UNIQUE'))
        return res.status(409).json({ error: 'Candidato já está no banco de talentos.' })
      throw err
    }
  } catch (err) {
    console.error('[talentos POST]', err)
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/talentos/:candidate_id
router.patch('/talentos/:candidate_id', ...requireRole('admin', 'rh'), async (req, res) => {
  try {
    const { tags, notas } = req.body
    const r = await db.run(
      'UPDATE talent_pool SET tags = ?, notas = ? WHERE candidate_id = ?',
      [tags ?? null, notas ?? null, req.params.candidate_id]
    )
    if (r.changes === 0) return res.status(404).json({ error: 'Não encontrado no banco.' })
    res.json({ ok: true })
  } catch (err) {
    console.error('[talentos PATCH]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// DELETE /api/talentos/:candidate_id
router.delete('/talentos/:candidate_id', ...requireRole('admin', 'rh'), async (req, res) => {
  try {
    const r = await db.run('DELETE FROM talent_pool WHERE candidate_id = ?', [req.params.candidate_id])
    if (r.changes === 0) return res.status(404).json({ error: 'Não encontrado no banco.' })
    res.json({ ok: true })
  } catch (err) {
    console.error('[talentos DELETE]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// POST /api/talentos/match/:vaga_id
router.post('/talentos/match/:vaga_id', ...requireRole('admin', 'rh'), async (req, res) => {
  try {
    if (!getProvider())
      return res.status(503).json({ error: 'Nenhuma API key de IA configurada.' })

    const vaga = await getVagaById(req.params.vaga_id)
    if (!vaga) return res.status(404).json({ error: 'Vaga não encontrada.' })

    const talentos = await db.all(`
      SELECT tp.candidate_id, tp.tags, tp.notas,
             c.name, c.job_position, c.ai_resumo, c.ai_pontos_fortes, c.ai_score_total, c.phone
      FROM talent_pool tp
      JOIN candidates c ON c.id = tp.candidate_id
    `)

    if (!talentos.length)
      return res.json({ ok: true, vaga: vaga.titulo, ranking: [] })

    const candidateList = talentos.map(t => {
      const desc = [
        t.ai_resumo        ? `Resumo: ${t.ai_resumo}`              : null,
        t.ai_pontos_fortes ? `Pontos fortes: ${t.ai_pontos_fortes}` : null,
        t.tags             ? `Tags: ${t.tags}`                      : null,
        t.job_position     ? `Última vaga: ${t.job_position}`       : null,
      ].filter(Boolean).join(' | ')
      return `ID:${t.candidate_id} | ${t.name}\n${desc}`
    }).join('\n---\n')

    const reqs = (() => { try { return JSON.parse(vaga.requisitos).join(', ') } catch { return vaga.requisitos || '' } })()

    const prompt = `Você é especialista em recrutamento do Pullman Ibirapuera.\n\nVAGA: ${vaga.titulo}\nDescrição: ${vaga.descricao}\nRequisitos: ${reqs}\n\nAvalie a compatibilidade de cada candidato abaixo para esta vaga.\nRetorne SOMENTE JSON válido, sem texto adicional:\n{"ranking":[{"id":NUMBER,"score":0-100,"razao":"até 15 palavras"},...]}\nInclua todos os candidatos ordenados do mais ao menos compatível.\n\nCANDIDATOS:\n${candidateList}`

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
  } catch (err) {
    console.error('[talentos/match]', err)
    res.status(500).json({ error: err.message })
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

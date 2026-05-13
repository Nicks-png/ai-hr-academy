'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../../db')
const { requireRole } = require('../middleware/auth')

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

module.exports = router

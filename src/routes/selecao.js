
'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../../db')
const { getVagaById } = require('../data/vagas')

// Retorna todos os candidatos
router.get('/api/selecao/candidates', async (_req, res) => {
  const candidates = db.prepare(`
    SELECT
      c.id, c.name, c.phone, c.job_position, c.status,
      c.ai_enabled, c.anos_xp, c.pretensao, c.job_id,
      c.skills, c.ai_score_total, c.ai_recomendacao, c.ai_resumo,
      c.created_at, c.contacted_at, c.confirmed_at,
      v.titulo AS vaga_titulo
    FROM candidates c
    LEFT JOIN vagas v ON c.job_id = v.id
    ORDER BY c.created_at DESC
  `).all()

  // Parse JSON fields
  candidates.forEach(c => {
    if (c.skills) c.skills = JSON.parse(c.skills)
  });

  res.json(candidates)
})

// Promove um candidato para a próxima fase (ex: Ativo -> Contato Enviado -> ...)
router.post('/api/selecao/promote/:id', async (req, res) => {
  const { id } = req.params
  const { nextStatus } = req.body

  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id)
  if (!candidate) return res.status(404).json({ error: 'Candidato não encontrado.' })

  // Adicionar lógica de transição de status mais robusta aqui se necessário
  const oldStatus = candidate.status;
  db.prepare(`UPDATE candidates SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(nextStatus, id);
  db.prepare('INSERT INTO candidate_history (candidate_id, old_status, new_status) VALUES (?, ?, ?)').run(id, oldStatus, nextStatus);

  res.json({ ok: true, newStatus: nextStatus })
})

// Transfere um candidato para intervenção humana
router.post('/api/selecao/transfer-human/:id', async (req, res) => {
  const { id } = req.params

  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id)
  if (!candidate) return res.status(404).json({ error: 'Candidato não encontrado.' })

  const oldStatus = candidate.status;
  db.prepare(`UPDATE candidates SET ai_enabled = 0, status = 'Intervenção Humana', updated_at = datetime('now','localtime') WHERE id = ?`).run(id);
  db.prepare('INSERT INTO candidate_history (candidate_id, old_status, new_status) VALUES (?, ?, ?)').run(id, oldStatus, 'Intervenção Humana');

  res.json({ ok: true, message: 'Candidato transferido para intervenção humana.' })
})

module.exports = router

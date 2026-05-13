'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { auth } = require('../middleware/auth')

// POST /api/feedback — criar ou atualizar scorecard
router.post('/feedback', auth, (req, res) => {
  const { candidate_id, pontualidade, apresentacao, comunicacao, tecnico, fit_cultural, notas } = req.body
  if (!candidate_id) return res.status(400).json({ error: 'candidate_id obrigatório.' })

  const vals = [pontualidade, apresentacao, comunicacao, tecnico, fit_cultural].filter(v => v != null)
  if (vals.some(v => v < 1 || v > 5))
    return res.status(400).json({ error: 'Scores devem ser entre 1 e 5.' })

  const existing = db.prepare('SELECT id FROM interview_feedback WHERE candidate_id = ?').get(candidate_id)
  const name = req.user.name || req.user.email

  if (existing) {
    db.prepare(`
      UPDATE interview_feedback
      SET interviewer=?, pontualidade=?, apresentacao=?, comunicacao=?, tecnico=?, fit_cultural=?, notas=?,
          created_at=datetime('now','localtime')
      WHERE candidate_id=?
    `).run(name, pontualidade||null, apresentacao||null, comunicacao||null, tecnico||null, fit_cultural||null, notas||null, candidate_id)
  } else {
    db.prepare(`
      INSERT INTO interview_feedback (candidate_id, interviewer, pontualidade, apresentacao, comunicacao, tecnico, fit_cultural, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(candidate_id, name, pontualidade||null, apresentacao||null, comunicacao||null, tecnico||null, fit_cultural||null, notas||null)
  }

  res.json({ ok: true })
})

// GET /api/feedback — todos os scorecards (para pre-carregar no frontend)
router.get('/feedback', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM interview_feedback').all())
})

// GET /api/feedback/:candidate_id — scorecard de um candidato
router.get('/feedback/:candidate_id', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM interview_feedback WHERE candidate_id = ?').get(req.params.candidate_id) || null)
})

module.exports = router

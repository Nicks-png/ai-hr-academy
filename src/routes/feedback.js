'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { auth } = require('../middleware/auth')

// POST /api/feedback — criar ou atualizar scorecard
router.post('/feedback', auth, async (req, res) => {
  try {
    const { candidate_id, pontualidade, apresentacao, comunicacao, tecnico, fit_cultural, notas } = req.body
    if (!candidate_id) return res.status(400).json({ error: 'candidate_id obrigatório.' })

    const vals = [pontualidade, apresentacao, comunicacao, tecnico, fit_cultural].filter(v => v != null)
    if (vals.some(v => v < 1 || v > 5))
      return res.status(400).json({ error: 'Scores devem ser entre 1 e 5.' })

    const existing = await db.get('SELECT id FROM interview_feedback WHERE candidate_id = ?', [candidate_id])
    const name = req.user.name || req.user.email

    if (existing) {
      await db.run(`
        UPDATE interview_feedback
        SET interviewer=?, pontualidade=?, apresentacao=?, comunicacao=?, tecnico=?, fit_cultural=?, notas=?,
            created_at=datetime('now','localtime')
        WHERE candidate_id=?
      `, [name, pontualidade||null, apresentacao||null, comunicacao||null, tecnico||null, fit_cultural||null, notas||null, candidate_id])
    } else {
      await db.run(`
        INSERT INTO interview_feedback (candidate_id, interviewer, pontualidade, apresentacao, comunicacao, tecnico, fit_cultural, notas)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [candidate_id, name, pontualidade||null, apresentacao||null, comunicacao||null, tecnico||null, fit_cultural||null, notas||null])
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('[feedback POST]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// GET /api/feedback — todos os scorecards
router.get('/feedback', auth, async (req, res) => {
  try {
    res.json(await db.all('SELECT * FROM interview_feedback'))
  } catch (err) {
    console.error('[feedback GET]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// GET /api/feedback/:candidate_id
router.get('/feedback/:candidate_id', auth, async (req, res) => {
  try {
    res.json(await db.get('SELECT * FROM interview_feedback WHERE candidate_id = ?', [req.params.candidate_id]) || null)
  } catch (err) {
    console.error('[feedback/:id GET]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

module.exports = router

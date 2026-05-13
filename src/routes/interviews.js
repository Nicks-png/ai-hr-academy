'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../../db')
const { auth, requireRole } = require('../middleware/auth')

// GET /api/interviews/schedule — retorna o agendamento ativo (última linha) ou null
router.get('/interviews/schedule', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM interview_schedule ORDER BY id DESC LIMIT 1').get()
  res.json({ schedule: row || null })
})

// POST /api/interviews/schedule — cria ou substitui o agendamento
router.post('/interviews/schedule', ...requireRole('admin', 'rh'), (req, res) => {
  const { date, start_time, num_slots, local } = req.body
  if (!date || !start_time || !num_slots) {
    return res.status(400).json({ error: 'date, start_time e num_slots são obrigatórios.' })
  }
  if (Number(num_slots) < 1 || Number(num_slots) > 50) {
    return res.status(400).json({ error: 'num_slots deve ser entre 1 e 50.' })
  }

  const name = req.user.name || req.user.email
  db.prepare('DELETE FROM interview_schedule').run()
  db.prepare(
    'INSERT INTO interview_schedule (date, start_time, num_slots, local, created_by) VALUES (?,?,?,?,?)'
  ).run(date, start_time, Number(num_slots), local || null, name)

  const row = db.prepare('SELECT * FROM interview_schedule ORDER BY id DESC LIMIT 1').get()
  res.json({ ok: true, schedule: row })
})

// DELETE /api/interviews/schedule — limpa o agendamento
router.delete('/interviews/schedule', ...requireRole('admin', 'rh'), (req, res) => {
  db.prepare('DELETE FROM interview_schedule').run()
  res.json({ ok: true })
})

module.exports = router

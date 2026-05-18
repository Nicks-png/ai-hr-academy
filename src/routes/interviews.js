'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../../db')
const { auth, requireRole } = require('../middleware/auth')

// GET /api/interviews/schedule
router.get('/interviews/schedule', auth, async (req, res) => {
  try {
    const row = await db.get('SELECT * FROM interview_schedule ORDER BY id DESC LIMIT 1')
    res.json({ schedule: row || null })
  } catch (err) {
    console.error('[interviews/schedule GET]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// POST /api/interviews/schedule
router.post('/interviews/schedule', ...requireRole('admin', 'rh'), async (req, res) => {
  try {
    const { date, start_time, num_slots, local } = req.body
    if (!date || !start_time || !num_slots)
      return res.status(400).json({ error: 'date, start_time e num_slots são obrigatórios.' })
    if (Number(num_slots) < 1 || Number(num_slots) > 50)
      return res.status(400).json({ error: 'num_slots deve ser entre 1 e 50.' })

    const name = req.user.name || req.user.email
    await db.run('DELETE FROM interview_schedule')
    await db.run(
      'INSERT INTO interview_schedule (date, start_time, num_slots, local, created_by) VALUES (?,?,?,?,?)',
      [date, start_time, Number(num_slots), local || null, name]
    )

    const row = await db.get('SELECT * FROM interview_schedule ORDER BY id DESC LIMIT 1')
    res.json({ ok: true, schedule: row })
  } catch (err) {
    console.error('[interviews/schedule POST]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// DELETE /api/interviews/schedule
router.delete('/interviews/schedule', ...requireRole('admin', 'rh'), async (req, res) => {
  try {
    await db.run('DELETE FROM interview_schedule')
    res.json({ ok: true })
  } catch (err) {
    console.error('[interviews/schedule DELETE]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

module.exports = router

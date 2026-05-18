'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../../db')
const { VAGAS } = require('../data/vagas')

// GET /api/vagas-public
router.get('/api/vagas-public', (_req, res) => {
  const list = Object.entries(VAGAS).map(([id, v]) => ({
    id,
    titulo:    v.titulo,
    marca:     v.marca,
    descricao: v.descricao,
    salario:   v.salario,
    regime:    v.regime,
    perguntas: v.perguntas || [],
  }))
  res.json(list)
})

// POST /api/candidatos/submit
router.post('/api/candidatos/submit', async (req, res) => {
  try {
    const { vagaId, nome, telefone, email = '', cvText, answers = [] } = req.body

    if (!vagaId || !VAGAS[vagaId])
      return res.status(400).json({ ok: false, error: 'Vaga inválida.' })
    if (!nome?.trim())
      return res.status(400).json({ ok: false, error: 'Nome é obrigatório.' })

    const digits = (telefone || '').replace(/\D/g, '')
    if (digits.length < 10)
      return res.status(400).json({ ok: false, error: 'Telefone inválido (mínimo 10 dígitos).' })
    if (!cvText?.trim())
      return res.status(400).json({ ok: false, error: 'Currículo é obrigatório.' })

    const phone = (digits.length === 10 || digits.length === 11) ? '55' + digits : digits

    const existing = await db.get('SELECT id FROM candidates WHERE phone = ?', [phone])
    if (existing)
      return res.status(409).json({ ok: false, error: 'Telefone já cadastrado neste processo.' })

    try {
      await db.run(`
        INSERT INTO candidates (name, phone, job_position, source, email, cv_text, answers)
        VALUES (?, ?, ?, 'organico', ?, ?, ?)
      `, [nome.trim(), phone, VAGAS[vagaId].titulo, email.trim() || null,
          cvText.trim(), JSON.stringify(answers)])
      res.json({ ok: true })
    } catch (err) {
      if (err.message?.includes('UNIQUE'))
        return res.status(409).json({ ok: false, error: 'Telefone já cadastrado neste processo.' })
      throw err
    }
  } catch (err) {
    console.error('[candidato] Erro ao inserir:', err.message)
    res.status(500).json({ ok: false, error: 'Erro interno ao salvar candidatura.' })
  }
})

module.exports = router

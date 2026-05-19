'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../../db')
const { VAGAS } = require('../data/vagas')
const { auth, requireRole } = require('../middleware/auth')
const { triarEPersistir } = require('../services/triarCandidato')

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
    const { vagaId, nome, telefone, email = '', cvText, cvPdf, answers = [] } = req.body

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
      const { lastInsertRowid } = await db.run(`
        INSERT INTO candidates (name, phone, job_position, job_id, source, email, cv_text, cv_pdf, answers, status)
        VALUES (?, ?, ?, ?, 'organico', ?, ?, ?, ?, 'Triando')
      `, [
        nome.trim(),
        phone,
        VAGAS[vagaId].titulo,
        vagaId,
        email.trim() || null,
        cvText.trim(),
        cvPdf || null,
        JSON.stringify(answers),
      ])
      res.json({ ok: true })

      // Triagem automática em background — não bloqueia a resposta ao candidato
      triarEPersistir(lastInsertRowid).catch(err =>
        console.error('[candidato] triagem automática falhou:', err.message)
      )
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

// POST /api/organico/:id/retriar — dispara triagem novamente para um candidato
router.post('/api/organico/:id/retriar', ...requireRole('rh', 'admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    const c  = await db.get('SELECT id, status FROM candidates WHERE id = ? AND source = ?', [id, 'organico'])
    if (!c) return res.status(404).json({ error: 'Candidato não encontrado.' })
    if (c.status === 'Triando') return res.status(409).json({ error: 'Triagem já em andamento.' })

    await db.run("UPDATE candidates SET status = 'Triando', ai_score_total = 0 WHERE id = ?", [id])
    res.json({ ok: true })

    triarEPersistir(id).catch(err =>
      console.error('[retriar] falhou:', err.message)
    )
  } catch (err) {
    console.error('[retriar]', err.message)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// GET /api/organico — lista candidatos orgânicos agrupados por vaga
router.get('/api/organico', ...requireRole('rh', 'admin'), async (req, res) => {
  try {
    const { job } = req.query
    const args = job ? [job] : []
    const where = job
      ? "WHERE source='organico' AND job_id = ?"
      : "WHERE source='organico'"

    const rows = await db.all(`
      SELECT
        id, name, phone, email, job_position, job_id, status, created_at,
        ai_score_total, ai_recomendacao, ai_dimensoes,
        substr(cv_text, 1, 200) as cv_preview,
        CASE WHEN cv_pdf IS NOT NULL THEN 1 ELSE 0 END as has_pdf
      FROM candidates
      ${where}
      ORDER BY job_id, created_at DESC
    `, args)

    res.json(rows)
  } catch (err) {
    console.error('[organico] Erro ao listar:', err.message)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// GET /api/organico/:id/cv — retorna cv_text e cv_pdf de um candidato
router.get('/api/organico/:id/cv', auth, async (req, res) => {
  try {
    const row = await db.get(
      'SELECT cv_text, cv_pdf FROM candidates WHERE id = ? AND source = ?',
      [req.params.id, 'organico']
    )
    if (!row) return res.status(404).json({ error: 'Candidato não encontrado.' })
    res.json({ cv_text: row.cv_text || '', cv_pdf: row.cv_pdf || null })
  } catch (err) {
    console.error('[organico] Erro ao buscar CV:', err.message)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

module.exports = router


'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../../db')
const { getVagaById } = require('../data/vagas')
const jwt     = require('jsonwebtoken')
const { auth } = require('../middleware/auth')

function changedBy(req) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '')
    if (!token) return 'RH'
    const user = jwt.verify(token, process.env.JWT_SECRET || 'accor-dev-secret')
    return user.name || user.email || 'RH'
  } catch { return 'RH' }
}

async function recordHistory(candidate_id, old_status, new_status, by, note) {
  await db.run(
    'INSERT INTO candidate_history (candidate_id, old_status, new_status, changed_by, note) VALUES (?,?,?,?,?)',
    [candidate_id, old_status || null, new_status, by || 'Sistema', note || null]
  )
}

function normalizePhone(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 11) return `55${digits}`
  if (digits.length === 10) return `55${digits}`
  if (digits.length === 13 && digits.startsWith('55')) return digits
  if (digits.length === 12 && digits.startsWith('55')) return digits
  return digits.length >= 10 ? digits : null
}

// Retorna todos os candidatos
router.get('/selecao/candidates', auth, async (_req, res) => {
  try {
    const candidates = await db.all(`
      SELECT
        c.id, c.name, c.phone, c.job_position, c.status,
        c.ai_enabled, c.anos_xp, c.pretensao, c.job_id,
        c.skills, c.ai_score_total, c.ai_recomendacao, c.ai_resumo,
        c.ai_pontos_fortes,
        c.created_at, c.contacted_at, c.confirmed_at, c.observacao,
        v.titulo AS vaga_titulo
      FROM candidates c
      LEFT JOIN vagas v ON c.job_id = v.id
      ORDER BY c.created_at DESC
    `)
    candidates.forEach(c => {
      if (c.skills) c.skills = JSON.parse(c.skills)
    })
    res.json(candidates)
  } catch (err) {
    console.error('[selecao/candidates]', err)
    res.status(500).json({ error: err.message })
  }
})

const VALID_STATUSES = [
  'Pendente', 'Aprovado na Triagem', 'Triado', 'Contato enviado',
  'Confirmado', 'Recusado', 'Intervenção Humana', 'Resposta manual',
]

// Promove um candidato
router.post('/selecao/promote/:id', auth, async (req, res) => {
  try {
    const { id } = req.params
    const { nextStatus } = req.body
    if (!nextStatus || !VALID_STATUSES.includes(nextStatus))
      return res.status(400).json({ error: 'Status inválido.' })
    const candidate = await db.get('SELECT * FROM candidates WHERE id = ?', [id])
    if (!candidate) return res.status(404).json({ error: 'Candidato não encontrado.' })
    const oldStatus = candidate.status
    await db.run('UPDATE candidates SET status = ? WHERE id = ?', [nextStatus, id])
    await recordHistory(id, oldStatus, nextStatus, changedBy(req))
    res.json({ ok: true, newStatus: nextStatus })
  } catch (err) {
    console.error('[selecao/promote]', err)
    res.status(500).json({ error: err.message })
  }
})

// Transfere para intervenção humana
router.post('/selecao/transfer-human/:id', auth, async (req, res) => {
  try {
    const { id } = req.params
    const candidate = await db.get('SELECT * FROM candidates WHERE id = ?', [id])
    if (!candidate) return res.status(404).json({ error: 'Candidato não encontrado.' })
    const oldStatus = candidate.status
    await db.run("UPDATE candidates SET ai_enabled = 0, status = 'Intervenção Humana' WHERE id = ?", [id])
    await recordHistory(id, oldStatus, 'Intervenção Humana', changedBy(req))
    res.json({ ok: true, message: 'Candidato transferido para intervenção humana.' })
  } catch (err) {
    console.error('[selecao/transfer-human]', err)
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/candidates/:id/observacao
router.patch('/candidates/:id/observacao', auth, async (req, res) => {
  try {
    const { observacao } = req.body || {}
    await db.run('UPDATE candidates SET observacao = ? WHERE id = ?', [observacao ?? '', req.params.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/candidates/:id/phone
router.patch('/candidates/:id/phone', auth, async (req, res) => {
  try {
    const { phone } = req.body || {}
    if (!phone?.trim()) return res.status(400).json({ error: 'Telefone inválido.' })
    const digits = String(phone).replace(/\D/g, '')
    let normalized = digits
    if (digits.length === 11) normalized = `55${digits}`
    else if (digits.length === 10) normalized = `55${digits}`
    if (normalized.length < 10) return res.status(400).json({ error: 'Telefone deve ter ao menos 10 dígitos.' })
    try {
      const r = await db.run('UPDATE candidates SET phone = ? WHERE id = ?', [normalized, req.params.id])
      if (r.changes === 0) return res.status(404).json({ error: 'Candidato não encontrado.' })
      res.json({ ok: true, phone: normalized })
    } catch (err) {
      if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Esse número já está cadastrado para outro candidato.' })
      throw err
    }
  } catch (err) {
    console.error('[candidates/phone PATCH]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// Salva candidatos vindos da triagem IA → status "Aprovado na Triagem"
router.post('/selecao/from-triagem', auth, async (req, res) => {
  try {
    const { vagaId, candidatos } = req.body || {}
    if (!vagaId) return res.status(400).json({ error: 'vagaId é obrigatório.' })
    if (!Array.isArray(candidatos) || !candidatos.length)
      return res.status(400).json({ error: 'Nenhum candidato enviado.' })

    const vagaInfo = await db.get('SELECT titulo FROM vagas WHERE id = ?', [vagaId])
    const titulo   = vagaInfo?.titulo || vagaId || 'Vaga'

    const inseridos = []
    for (const c of candidatos) {
      const nome  = c.nome || 'Candidato'
      const phone = normalizePhone(c.telefone) || null
      // Prefer phone lookup to avoid merging two candidates with the same name
      let existing = null
      if (phone) {
        existing = await db.get(
          'SELECT id, phone, status FROM candidates WHERE phone = ? AND job_id = ?',
          [phone, vagaId || null]
        )
      }
      if (!existing) {
        existing = await db.get(
          'SELECT id, phone, status FROM candidates WHERE name = ? AND job_id = ?',
          [nome, vagaId || null]
        )
      }
      if (existing) {
        const updatePhone = !existing.phone && phone
        const oldStatus = existing.status
        if (updatePhone) {
          await db.run(`
            UPDATE candidates SET
              status          = 'Aprovado na Triagem',
              job_position    = ?,
              ai_score_total  = ?,
              ai_recomendacao = ?,
              ai_resumo       = ?,
              ai_dimensoes    = ?,
              interview_slot  = ?,
              phone           = ?
            WHERE id = ?
          `, [titulo, c.scoreTotal || 0, c.recomendacao || '', c.resumo || '',
              c.dimensoes ? JSON.stringify(c.dimensoes) : null,
              c.interview_slot || null, phone, existing.id])
        } else {
          await db.run(`
            UPDATE candidates SET
              status          = 'Aprovado na Triagem',
              job_position    = ?,
              ai_score_total  = ?,
              ai_recomendacao = ?,
              ai_resumo       = ?,
              ai_dimensoes    = ?,
              interview_slot  = ?
            WHERE id = ?
          `, [titulo, c.scoreTotal || 0, c.recomendacao || '', c.resumo || '',
              c.dimensoes ? JSON.stringify(c.dimensoes) : null,
              c.interview_slot || null, existing.id])
        }
        if (oldStatus !== 'Aprovado na Triagem')
          await recordHistory(existing.id, oldStatus, 'Aprovado na Triagem', 'Triagem IA')
      } else {
        const r = await db.run(`
          INSERT INTO candidates (name, phone, job_position, job_id, status, ai_score_total, ai_recomendacao, ai_resumo, ai_dimensoes, interview_slot)
          VALUES (?, ?, ?, ?, 'Aprovado na Triagem', ?, ?, ?, ?, ?)
        `, [nome, phone, titulo, vagaId || null, c.scoreTotal || 0, c.recomendacao || '',
            c.resumo || '', c.dimensoes ? JSON.stringify(c.dimensoes) : null, c.interview_slot || null])
        await recordHistory(r.lastInsertRowid, null, 'Aprovado na Triagem', 'Triagem IA')
      }
      inseridos.push(nome)
    }

    res.json({ ok: true, inseridos })
  } catch (err) {
    console.error('[selecao/from-triagem]', err)
    res.status(500).json({ error: err.message })
  }
})


// GET /api/candidates/:id/history
router.get('/candidates/:id/history', auth, async (req, res) => {
  try {
    const rows = await db.all(
      'SELECT * FROM candidate_history WHERE candidate_id = ? ORDER BY changed_at ASC',
      [req.params.id]
    )
    res.json(rows)
  } catch (err) {
    console.error('[candidates/history]', err)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

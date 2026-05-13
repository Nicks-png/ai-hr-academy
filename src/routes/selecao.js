
'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../../db')
const { getVagaById } = require('../data/vagas')
const jwt     = require('jsonwebtoken')

function changedBy(req) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '')
    if (!token) return 'RH'
    const user = jwt.verify(token, process.env.JWT_SECRET || 'accor-dev-secret')
    return user.name || user.email || 'RH'
  } catch { return 'RH' }
}

function recordHistory(candidate_id, old_status, new_status, by, note) {
  db.prepare(
    'INSERT INTO candidate_history (candidate_id, old_status, new_status, changed_by, note) VALUES (?,?,?,?,?)'
  ).run(candidate_id, old_status || null, new_status, by || 'Sistema', note || null)
}

function normalizePhone(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (!digits) return null
  // Adiciona DDI 55 (Brasil) se não tiver
  if (digits.length === 11) return `55${digits}`   // 11 + 9 dígitos
  if (digits.length === 10) return `55${digits}`   // 11 + 8 dígitos (fixo)
  if (digits.length === 13 && digits.startsWith('55')) return digits
  if (digits.length === 12 && digits.startsWith('55')) return digits
  return digits.length >= 10 ? digits : null
}

// Retorna todos os candidatos
router.get('/selecao/candidates', async (_req, res) => {
  const candidates = db.prepare(`
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
  `).all()

  // Parse JSON fields
  candidates.forEach(c => {
    if (c.skills) c.skills = JSON.parse(c.skills)
  });

  res.json(candidates)
})

// Promove um candidato para a próxima fase (ex: Ativo -> Contato Enviado -> ...)
router.post('/selecao/promote/:id', async (req, res) => {
  const { id } = req.params
  const { nextStatus } = req.body

  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id)
  if (!candidate) return res.status(404).json({ error: 'Candidato não encontrado.' })

  // Adicionar lógica de transição de status mais robusta aqui se necessário
  const oldStatus = candidate.status;
  db.prepare(`UPDATE candidates SET status = ? WHERE id = ?`).run(nextStatus, id);
  recordHistory(id, oldStatus, nextStatus, changedBy(req))

  res.json({ ok: true, newStatus: nextStatus })
})

// Transfere um candidato para intervenção humana
router.post('/selecao/transfer-human/:id', async (req, res) => {
  const { id } = req.params

  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id)
  if (!candidate) return res.status(404).json({ error: 'Candidato não encontrado.' })

  const oldStatus = candidate.status;
  db.prepare(`UPDATE candidates SET ai_enabled = 0, status = 'Intervenção Humana' WHERE id = ?`).run(id);
  recordHistory(id, oldStatus, 'Intervenção Humana', changedBy(req))

  res.json({ ok: true, message: 'Candidato transferido para intervenção humana.' })
})

// PATCH /api/candidates/:id/observacao
router.patch('/candidates/:id/observacao', (req, res) => {
  const { observacao } = req.body || {}
  db.prepare('UPDATE candidates SET observacao = ? WHERE id = ?').run(observacao ?? '', req.params.id)
  res.json({ ok: true })
})

// PATCH /api/candidates/:id/phone
router.patch('/candidates/:id/phone', (req, res) => {
  const { phone } = req.body || {}
  if (!phone?.trim()) return res.status(400).json({ error: 'Telefone inválido.' })
  const digits = String(phone).replace(/\D/g, '')
  let normalized = digits
  if (digits.length === 11) normalized = `55${digits}`
  else if (digits.length === 10) normalized = `55${digits}`
  if (normalized.length < 10) return res.status(400).json({ error: 'Telefone deve ter ao menos 10 dígitos.' })
  try {
    const r = db.prepare('UPDATE candidates SET phone = ? WHERE id = ?').run(normalized, req.params.id)
    if (r.changes === 0) return res.status(404).json({ error: 'Candidato não encontrado.' })
    res.json({ ok: true, phone: normalized })
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Esse número já está cadastrado para outro candidato.' })
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// Salva candidatos vindos da triagem IA → status "Aprovado na Triagem"
router.post('/selecao/from-triagem', (req, res) => {
  const { vagaId, candidatos } = req.body || {}
  if (!Array.isArray(candidatos) || !candidatos.length)
    return res.status(400).json({ error: 'Nenhum candidato enviado.' })

  const vagaInfo = db.prepare('SELECT titulo FROM vagas WHERE id = ?').get(vagaId)
  const titulo   = vagaInfo?.titulo || vagaId || 'Vaga'

  const inseridos = db.transaction(() => {
    return candidatos.map(c => {
      const nome  = c.nome || 'Candidato'
      const phone = normalizePhone(c.telefone) || null
      const existing = db.prepare('SELECT id, phone, status FROM candidates WHERE name = ? AND job_id = ?').get(nome, vagaId || null)
      if (existing) {
        const updatePhone = !existing.phone && phone
        const oldStatus = existing.status
        db.prepare(`
          UPDATE candidates SET
            status          = 'Aprovado na Triagem',
            job_position    = ?,
            ai_score_total  = ?,
            ai_recomendacao = ?,
            ai_resumo       = ?,
            ai_dimensoes    = ?,
            interview_slot  = ?
            ${updatePhone ? ', phone = ?' : ''}
          WHERE id = ?
        `).run(
          titulo, c.scoreTotal || 0, c.recomendacao || '', c.resumo || '',
          c.dimensoes ? JSON.stringify(c.dimensoes) : null,
          c.interview_slot || null,
          ...(updatePhone ? [phone] : []),
          existing.id
        )
        if (oldStatus !== 'Aprovado na Triagem')
          recordHistory(existing.id, oldStatus, 'Aprovado na Triagem', 'Triagem IA')
      } else {
        const r = db.prepare(`
          INSERT INTO candidates (name, phone, job_position, job_id, status, ai_score_total, ai_recomendacao, ai_resumo, ai_dimensoes, interview_slot)
          VALUES (?, ?, ?, ?, 'Aprovado na Triagem', ?, ?, ?, ?, ?)
        `).run(nome, phone, titulo, vagaId || null, c.scoreTotal || 0, c.recomendacao || '', c.resumo || '', c.dimensoes ? JSON.stringify(c.dimensoes) : null, c.interview_slot || null)
        recordHistory(r.lastInsertRowid, null, 'Aprovado na Triagem', 'Triagem IA')
      }
      return nome
    })
  })()

  res.json({ ok: true, inseridos })
})

// DELETE /api/candidates/:id
router.delete('/candidates/:id', (req, res) => {
  const result = db.prepare('DELETE FROM candidates WHERE id = ?').run(req.params.id)
  if (result.changes === 0) return res.status(404).json({ error: 'Candidato não encontrado.' })
  res.json({ ok: true })
})

// GET /api/candidates/:id/history
router.get('/candidates/:id/history', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM candidate_history WHERE candidate_id = ? ORDER BY changed_at ASC'
  ).all(req.params.id)
  res.json(rows)
})

module.exports = router

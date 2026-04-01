
'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../../db')

// ── Criar tabela de webhooks se não existir ──────────────────────────────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS webhooks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    url        TEXT    NOT NULL,
    label      TEXT,
    active     INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run()

// ── Helper: dispara webhooks ativos ─────────────────────────────────────────
async function fireWebhooks(eventType, payload) {
  const hooks = db.prepare('SELECT * FROM webhooks WHERE active = 1').all()
  for (const hook of hooks) {
    try {
      await fetch(hook.url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ event: eventType, timestamp: new Date().toISOString(), ...payload }),
        signal:  AbortSignal.timeout(5000),
      })
    } catch (e) {
      console.error(`[WEBHOOK] Falha ao disparar ${hook.url}:`, e.message)
    }
  }
}

// ── Candidatos ───────────────────────────────────────────────────────────────
router.get('/api/selecao/candidates', (_req, res) => {
  const candidates = db.prepare(`
    SELECT
      c.id, c.name, c.phone, c.job_position, c.status,
      c.ai_enabled, c.anos_xp, c.pretensao, c.job_id,
      c.skills, c.ai_score_total, c.ai_recomendacao, c.ai_resumo, c.ai_dimensoes,
      c.created_at, c.contacted_at, c.confirmed_at,
      v.titulo AS vaga_titulo
    FROM candidates c
    LEFT JOIN vagas v ON c.job_id = v.id
    ORDER BY c.created_at DESC
  `).all()

  candidates.forEach(c => {
    try { if (c.skills)      c.skills      = JSON.parse(c.skills)      } catch { c.skills = [] }
    try { if (c.ai_dimensoes) c.ai_dimensoes = JSON.parse(c.ai_dimensoes) } catch { c.ai_dimensoes = {} }
  })

  res.json(candidates)
})

// ── Promover candidato ────────────────────────────────────────────────────────
router.post('/api/selecao/promote/:id', async (req, res) => {
  const { id }         = req.params
  const { nextStatus } = req.body
  if (!nextStatus) return res.status(400).json({ error: 'nextStatus obrigatório.' })

  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id)
  if (!candidate) return res.status(404).json({ error: 'Candidato não encontrado.' })

  const oldStatus = candidate.status
  db.prepare(`UPDATE candidates SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
    .run(nextStatus, id)
  db.prepare('INSERT INTO candidate_history (candidate_id, old_status, new_status) VALUES (?, ?, ?)')
    .run(id, oldStatus, nextStatus)

  fireWebhooks('status_changed', {
    candidate_id: Number(id),
    name:         candidate.name,
    old_status:   oldStatus,
    new_status:   nextStatus,
    job_id:       candidate.job_id,
  }).catch(() => {})

  res.json({ ok: true, newStatus: nextStatus })
})

// ── Transferir para humano ────────────────────────────────────────────────────
router.post('/api/selecao/transfer-human/:id', async (req, res) => {
  const { id } = req.params

  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id)
  if (!candidate) return res.status(404).json({ error: 'Candidato não encontrado.' })

  const oldStatus = candidate.status
  db.prepare(`UPDATE candidates SET ai_enabled = 0, status = 'Intervenção Humana', updated_at = datetime('now','localtime') WHERE id = ?`)
    .run(id)
  db.prepare('INSERT INTO candidate_history (candidate_id, old_status, new_status) VALUES (?, ?, ?)')
    .run(id, oldStatus, 'Intervenção Humana')

  fireWebhooks('human_intervention', {
    candidate_id: Number(id),
    name:         candidate.name,
    old_status:   oldStatus,
    new_status:   'Intervenção Humana',
    job_id:       candidate.job_id,
  }).catch(() => {})

  res.json({ ok: true, message: 'Candidato transferido para intervenção humana.' })
})

// ── Webhooks CRUD ─────────────────────────────────────────────────────────────
router.get('/api/webhooks', (_req, res) => {
  res.json(db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all())
})

router.post('/api/webhooks', (req, res) => {
  const { url, label } = req.body
  if (!url || !url.startsWith('http')) return res.status(400).json({ error: 'URL inválida.' })
  const result = db.prepare('INSERT INTO webhooks (url, label) VALUES (?, ?)').run(url, label || '')
  res.json({ ok: true, id: result.lastInsertRowid })
})

router.delete('/api/webhooks/:id', (req, res) => {
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

router.post('/api/webhooks/test/:id', async (req, res) => {
  const hook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id)
  if (!hook) return res.status(404).json({ error: 'Webhook não encontrado.' })
  try {
    await fetch(hook.url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ event: 'test', timestamp: new Date().toISOString(), message: 'Teste de integração AI-HR Academy' }),
      signal:  AbortSignal.timeout(5000),
    })
    res.json({ ok: true })
  } catch (e) {
    res.status(502).json({ error: `Falha: ${e.message}` })
  }
})

module.exports = router

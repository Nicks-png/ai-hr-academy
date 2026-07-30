'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../../db')
const { getVagas, getVagaById } = require('../data/vagas')
const { auth, requireRole } = require('../middleware/auth')
const { triarEPersistir } = require('../services/triarCandidato')

// In-memory rate limiter: max 10 submissions per IP per hour
const _rlStore = new Map()
function submitRateLimit(req, res, next) {
  const ip    = req.ip || req.socket?.remoteAddress || 'unknown'
  const now   = Date.now()
  const entry = _rlStore.get(ip) || { count: 0, resetAt: now + 3_600_000 }
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 3_600_000 }
  entry.count++
  _rlStore.set(ip, entry)
  if (entry.count > 10)
    return res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde antes de enviar outra candidatura.' })
  next()
}

function parseVaga(v) {
  const out = { ...v }
  for (const k of ['requisitos', 'diferenciais', 'competencias', 'perguntas']) {
    try { out[k] = JSON.parse(out[k]) } catch { out[k] = [] }
  }
  return out
}

// GET /api/vagas-public — vagas ativas para portais públicos (candidato.html)
router.get('/api/vagas-public', async (_req, res) => {
  try {
    const vagas = await getVagas()
    const list = vagas.map(v => ({
      id:        v.id,
      titulo:    v.titulo,
      marca:     v.marca,
      descricao: v.descricao,
      salario:   v.salario,
      regime:    v.regime,
      perguntas: (() => { try { return JSON.parse(v.perguntas) } catch { return [] } })(),
    }))
    res.json(list)
  } catch (err) {
    console.error('[vagas-public]', err.message)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// GET /api/vaga-pub/:id — dados completos de uma vaga pública (para /vaga/:id)
router.get('/api/vaga-pub/:id', async (req, res) => {
  try {
    const vaga = await getVagaById(req.params.id)
    if (!vaga || vaga.status === 'inactive') {
      return res.status(404).json({ error: 'Vaga não encontrada.' })
    }
    res.json(parseVaga(vaga))
  } catch (err) {
    console.error('[vaga-pub]', err.message)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// POST /api/candidatos/submit
router.post('/api/candidatos/submit', submitRateLimit, async (req, res) => {
  try {
    const { vagaId, nome, telefone, email = '', cvText, cvPdf, answers = [] } = req.body

    const vaga = vagaId ? await getVagaById(vagaId) : null
    if (!vaga || vaga.status === 'inactive') {
      return res.status(400).json({ ok: false, error: 'Vaga inválida ou não disponível.' })
    }
    if (vaga.status === 'paused') {
      return res.status(400).json({ ok: false, error: 'Esta vaga não está recebendo candidaturas no momento.' })
    }
    if (!nome?.trim()) {
      return res.status(400).json({ ok: false, error: 'Nome é obrigatório.' })
    }

    const digits = (telefone || '').replace(/\D/g, '')
    if (digits.length < 10) {
      return res.status(400).json({ ok: false, error: 'Telefone inválido (mínimo 10 dígitos).' })
    }
    if (!cvText?.trim()) {
      return res.status(400).json({ ok: false, error: 'Currículo é obrigatório.' })
    }

    const phone = (digits.length === 10 || digits.length === 11) ? '55' + digits : digits

    const existing = await db.get('SELECT id FROM candidates WHERE phone = ? AND job_id = ?', [phone, vagaId])
    if (existing) {
      return res.status(409).json({ ok: false, error: 'Você já se candidatou a esta vaga com este telefone.' })
    }

    try {
      const { lastInsertRowid } = await db.run(`
        INSERT INTO candidates (name, phone, job_position, job_id, source, email, cv_text, cv_pdf, answers, status)
        VALUES (?, ?, ?, ?, 'organico', ?, ?, ?, ?, 'Triando')
      `, [
        nome.trim(),
        phone,
        vaga.titulo,
        vagaId,
        email.trim() || null,
        cvText.trim(),
        cvPdf || null,
        JSON.stringify(answers),
      ])
      res.json({ ok: true })

      triarEPersistir(lastInsertRowid).catch(err =>
        console.error('[candidato] triagem automática falhou:', err.message)
      )
    } catch (err) {
      if (err.message?.includes('UNIQUE')) {
        return res.status(409).json({ ok: false, error: 'Você já se candidatou a esta vaga com este telefone.' })
      }
      throw err
    }
  } catch (err) {
    console.error('[candidato] Erro ao inserir:', err.message)
    res.status(500).json({ ok: false, error: 'Erro interno ao salvar candidatura.' })
  }
})

// POST /api/organico/:id/retriar — dispara triagem novamente
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
    const args  = job ? [job] : []
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

// GET /api/organico/:id/detalhes — dados completos do candidato (score, resumo, respostas, CV)
router.get('/api/organico/:id/detalhes', auth, async (req, res) => {
  try {
    const row = await db.get(`
      SELECT
        id, name, phone, email, job_position, job_id, status, created_at,
        ai_score_total, ai_recomendacao, ai_resumo,
        ai_pontos_fortes, ai_pontos_atencao, ai_dimensoes,
        answers, cv_text, cv_pdf
      FROM candidates WHERE id = ? AND source = 'organico'
    `, [req.params.id])
    if (!row) return res.status(404).json({ error: 'Candidato não encontrado.' })

    for (const k of ['ai_pontos_fortes', 'ai_pontos_atencao', 'ai_dimensoes', 'answers']) {
      try { row[k] = JSON.parse(row[k]) } catch { row[k] = k === 'ai_dimensoes' ? {} : [] }
    }
    res.json(row)
  } catch (err) {
    console.error('[organico] Erro ao buscar detalhes:', err.message)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

module.exports = router

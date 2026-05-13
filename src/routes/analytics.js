'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../../db')
const { requireRole } = require('../middleware/auth')

// GET /api/analytics/funil — distribuição de status + KPIs gerais
router.get('/analytics/funil', ...requireRole('admin', 'rh'), (req, res) => {
  const counts = db.prepare('SELECT status, COUNT(*) as count FROM candidates GROUP BY status').all()
  const total  = counts.reduce((s, r) => s + r.count, 0)

  const map = {}
  counts.forEach(r => { map[r.status] = r.count })

  const STAGE_ORDER = [
    'Aprovado na Triagem', 'Triado', 'Contato enviado',
    'Resposta manual', 'Confirmado', 'Recusado',
    'Intervenção Humana', 'Pendente',
  ]

  const stages = STAGE_ORDER
    .filter(s => map[s] > 0)
    .map(s => ({
      status: s,
      count:  map[s],
      pct:    total ? Math.round(map[s] / total * 100) : 0,
    }))

  const avgRow = db.prepare(
    'SELECT AVG(ai_score_total) as v FROM candidates WHERE ai_score_total > 0'
  ).get()

  const confirmados   = map['Confirmado']    || 0
  const contatoTotal  = (map['Contato enviado'] || 0) + confirmados + (map['Recusado'] || 0) + (map['Resposta manual'] || 0)
  const taxaConfirmacao = contatoTotal ? Math.round(confirmados / contatoTotal * 100) : 0

  const vagasComCands = db.prepare(
    'SELECT COUNT(DISTINCT job_id) as n FROM candidates WHERE job_id IS NOT NULL'
  ).get().n

  res.json({
    stages,
    total,
    kpis: {
      total,
      confirmados,
      taxa_confirmacao: taxaConfirmacao,
      score_medio: avgRow.v ? Math.round(avgRow.v) : null,
      vagas_ativas: vagasComCands,
    },
  })
})

// GET /api/analytics/vagas — métricas por vaga
router.get('/analytics/vagas', ...requireRole('admin', 'rh'), (req, res) => {
  const rows = db.prepare(`
    SELECT
      c.job_id,
      COALESCE(v.titulo, c.job_position, c.job_id) AS titulo,
      COUNT(*)                                      AS total,
      SUM(CASE WHEN c.status = 'Confirmado' THEN 1 ELSE 0 END)      AS confirmados,
      SUM(CASE WHEN c.status = 'Recusado'   THEN 1 ELSE 0 END)      AS recusados,
      SUM(CASE WHEN c.status = 'Contato enviado' THEN 1 ELSE 0 END) AS aguardando,
      ROUND(AVG(CASE WHEN c.ai_score_total > 0 THEN c.ai_score_total END), 1) AS score_medio
    FROM candidates c
    LEFT JOIN vagas v ON c.job_id = v.id
    WHERE c.job_id IS NOT NULL
    GROUP BY c.job_id
    ORDER BY total DESC
  `).all()

  res.json(rows.map(r => ({
    ...r,
    taxa_confirmacao: r.total ? Math.round(r.confirmados / r.total * 100) : 0,
  })))
})

// GET /api/analytics/tempo — fontes + time-to-hire
router.get('/analytics/tempo', ...requireRole('admin', 'rh'), (req, res) => {
  // Fontes
  const fontes = db.prepare(`
    SELECT
      CASE WHEN source = 'organico' THEN 'Orgânico' ELSE 'Triagem IA' END AS fonte,
      COUNT(*) AS count
    FROM candidates
    GROUP BY fonte
    ORDER BY count DESC
  `).all()

  const totalFontes = fontes.reduce((s, r) => s + r.count, 0)
  const fontesComPct = fontes.map(r => ({
    ...r,
    pct: totalFontes ? Math.round(r.count / totalFontes * 100) : 0,
  }))

  // Time-to-hire por vaga
  const tth = db.prepare(`
    SELECT
      c.job_id,
      COALESCE(v.titulo, c.job_position, c.job_id) AS titulo,
      COUNT(*) AS count,
      ROUND(AVG(JULIANDAY(c.confirmed_at) - JULIANDAY(c.created_at)), 1) AS media_dias
    FROM candidates c
    LEFT JOIN vagas v ON c.job_id = v.id
    WHERE c.status = 'Confirmado'
      AND c.confirmed_at IS NOT NULL
      AND c.created_at   IS NOT NULL
    GROUP BY c.job_id
    HAVING media_dias > 0
    ORDER BY media_dias ASC
  `).all()

  const mediaGeral = tth.length
    ? Math.round(tth.reduce((s, r) => s + r.media_dias * r.count, 0) / tth.reduce((s, r) => s + r.count, 0) * 10) / 10
    : null

  res.json({ fontes: fontesComPct, tth, media_geral: mediaGeral })
})

module.exports = router

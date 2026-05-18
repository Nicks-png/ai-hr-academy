'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../../db')
const { requireRole } = require('../middleware/auth')

// GET /api/analytics/funil
router.get('/analytics/funil', ...requireRole('admin', 'rh'), async (req, res) => {
  try {
    const counts = await db.all('SELECT status, COUNT(*) as count FROM candidates GROUP BY status')
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

    const avgRow = await db.get(
      'SELECT AVG(ai_score_total) as v FROM candidates WHERE ai_score_total > 0'
    )

    const confirmados   = map['Confirmado']    || 0
    const contatoTotal  = (map['Contato enviado'] || 0) + confirmados + (map['Recusado'] || 0) + (map['Resposta manual'] || 0)
    const taxaConfirmacao = contatoTotal ? Math.round(confirmados / contatoTotal * 100) : 0

    const vagasRow = await db.get(
      'SELECT COUNT(DISTINCT job_id) as n FROM candidates WHERE job_id IS NOT NULL'
    )

    res.json({
      stages,
      total,
      kpis: {
        total,
        confirmados,
        taxa_confirmacao: taxaConfirmacao,
        score_medio: avgRow?.v ? Math.round(avgRow.v) : null,
        vagas_ativas: vagasRow?.n ?? 0,
      },
    })
  } catch (err) {
    console.error('[analytics/funil]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// GET /api/analytics/vagas
router.get('/analytics/vagas', ...requireRole('admin', 'rh'), async (req, res) => {
  try {
    const rows = await db.all(`
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
    `)

    res.json(rows.map(r => ({
      ...r,
      taxa_confirmacao: r.total ? Math.round(r.confirmados / r.total * 100) : 0,
    })))
  } catch (err) {
    console.error('[analytics/vagas]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// GET /api/analytics/tempo
router.get('/analytics/tempo', ...requireRole('admin', 'rh'), async (req, res) => {
  try {
    const fontes = await db.all(`
      SELECT
        CASE WHEN source = 'organico' THEN 'Orgânico' ELSE 'Triagem IA' END AS fonte,
        COUNT(*) AS count
      FROM candidates
      GROUP BY fonte
      ORDER BY count DESC
    `)

    const totalFontes = fontes.reduce((s, r) => s + r.count, 0)
    const fontesComPct = fontes.map(r => ({
      ...r,
      pct: totalFontes ? Math.round(r.count / totalFontes * 100) : 0,
    }))

    const tth = await db.all(`
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
    `)

    const mediaGeral = tth.length
      ? Math.round(tth.reduce((s, r) => s + r.media_dias * r.count, 0) / tth.reduce((s, r) => s + r.count, 0) * 10) / 10
      : null

    res.json({ fontes: fontesComPct, tth, media_geral: mediaGeral })
  } catch (err) {
    console.error('[analytics/tempo]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

module.exports = router

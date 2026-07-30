'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../../db')
const { requireRole } = require('../middleware/auth')

// GET /api/vagas-abertas
router.get('/api/vagas-abertas', ...requireRole('rh', 'admin'), async (_req, res) => {
  try {
    const candidates = await db.all(`
      SELECT
        c.id, c.name, c.phone, c.job_position, c.job_id, c.status,
        c.ai_score_total, c.ai_recomendacao, c.ai_resumo,
        c.contacted_at, c.confirmed_at, c.created_at,
        (SELECT COUNT(*) FROM messages_received mr WHERE mr.candidate_id = c.id) AS total_respostas,
        (SELECT mr.message    FROM messages_received mr WHERE mr.candidate_id = c.id ORDER BY mr.received_at DESC LIMIT 1) AS ultima_resposta,
        (SELECT mr.received_at FROM messages_received mr WHERE mr.candidate_id = c.id ORDER BY mr.received_at DESC LIMIT 1) AS ultima_resposta_at
      FROM candidates c
      WHERE c.ai_score_total > 0
         OR c.contacted_at IS NOT NULL
         OR c.status NOT IN ('Pendente')
      ORDER BY c.job_position COLLATE NOCASE, c.ai_score_total DESC, c.name
    `)

    const allScreenings = await db.all(`
      SELECT vaga_id, vaga_titulo, total, created_at,
             ROW_NUMBER() OVER (PARTITION BY vaga_id ORDER BY created_at DESC) AS rn
      FROM screenings
      WHERE created_at >= datetime('now', '-60 days', 'localtime')
    `)
    const screenings = allScreenings.filter(s => s.rn === 1)

    const byVaga = {}

    candidates.forEach(c => {
      const key = c.job_id || c.job_position || '_sem_vaga'
      if (!byVaga[key]) {
        byVaga[key] = {
          job_id:    c.job_id,
          titulo:    c.job_position || 'Sem vaga definida',
          candidatos: [],
          tem_triagem: false,
          ultima_triagem: null,
        }
      }
      byVaga[key].candidatos.push({
        id:              c.id,
        name:            c.name,
        phone:           c.phone,
        status:          c.status,
        ai_score_total:  c.ai_score_total,
        ai_recomendacao: c.ai_recomendacao,
        ai_resumo:       c.ai_resumo,
        contacted_at:    c.contacted_at,
        confirmed_at:    c.confirmed_at,
        created_at:      c.created_at,
        respondeu:       c.total_respostas > 0,
        aceitou:         c.status === 'Confirmado' || !!c.confirmed_at,
        ultima_resposta: c.ultima_resposta,
        ultima_resposta_at: c.ultima_resposta_at,
      })
    })

    screenings.forEach(s => {
      const key = s.vaga_id
      if (byVaga[key]) {
        byVaga[key].tem_triagem    = true
        byVaga[key].ultima_triagem = s.created_at
      } else {
        byVaga[key] = {
          job_id:        s.vaga_id,
          titulo:        s.vaga_titulo,
          candidatos:    [],
          tem_triagem:   true,
          ultima_triagem: s.created_at,
        }
      }
    })

    const result = Object.values(byVaga).map(v => {
      const cands       = v.candidatos
      const confirmados  = cands.filter(c => c.aceitou).length
      const responderam  = cands.filter(c => c.respondeu).length
      const contactados  = cands.filter(c => c.contacted_at).length
      return {
        ...v,
        total:       cands.length,
        confirmados,
        responderam,
        contactados,
        aguardando:  contactados - confirmados - cands.filter(c => c.status === 'Recusado').length,
        recusados:   cands.filter(c => c.status === 'Recusado').length,
      }
    }).sort((a, b) => b.total - a.total)

    res.json(result)
  } catch (err) {
    console.error('[vagas-abertas]', err)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

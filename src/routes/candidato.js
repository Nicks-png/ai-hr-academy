'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../../db')
const { getVagas, getVagaById } = require('../data/vagas')
const { auth, requireRole } = require('../middleware/auth')
const { triarEPersistir } = require('../services/triarCandidato')
const { pushToSheetsBackup } = require('../services/sheetsBackup')
const { ocrTranscribe } = require('../services/ocr')

// In-memory rate limiter: max 60 submissions por IP por hora.
// Propositalmente generoso: em feiras de emprego e no quiosque do hotel, várias
// pessoas se candidatam a partir do mesmo Wi-Fi/IP compartilhado. A proteção real
// contra abuso é o índice único (phone, job_id) — não vale a pena barrar gente de
// verdade por IP quando o duplicado já é bloqueado por telefone+vaga.
const _rlStore = new Map()
function submitRateLimit(req, res, next) {
  const ip    = req.ip || req.socket?.remoteAddress || 'unknown'
  const now   = Date.now()
  const entry = _rlStore.get(ip) || { count: 0, resetAt: now + 3_600_000 }
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 3_600_000 }
  entry.count++
  _rlStore.set(ip, entry)
  if (entry.count > 60) {
    logSubmission({ req, success: false, errorMsg: 'rate_limited' })
    return res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde antes de enviar outra candidatura.' })
  }
  next()
}

// "Pergunta: resposta | Pergunta2: resposta2" — formato compacto e legível numa
// célula de planilha. Usado tanto no backup em Sheets quanto poderia ser reutilizado
// em outras exportações futuras.
function formatRespostas(answers) {
  if (!Array.isArray(answers) || !answers.length) return ''
  return answers
    .map(a => `${a?.pergunta || '?'}: ${a?.resposta?.trim() || '(sem resposta)'}`)
    .join(' | ')
    .slice(0, 1000)
}

// Registra toda tentativa de candidatura (sucesso ou falha) em submission_log,
// independente da tabela candidates — é a trilha auditável que permite provar
// pro cliente quantas inscrições chegaram e o que houve com cada uma.
// `vaga` (quando resolvida) e `cvTextOverride` (texto final pós-OCR) deixam o
// backup em Sheets com os mesmos dados completos que ficam no sistema.
async function logSubmission({ req, success, errorMsg = null, candidateId = null, vaga = null, cvTextOverride = null }) {
  const body   = req.body || {}
  const ip     = req.ip || req.socket?.remoteAddress || 'unknown'
  const digits = (body.telefone || '').replace(/\D/g, '')
  const phone  = digits ? ((digits.length === 10 || digits.length === 11) ? '55' + digits : digits) : null

  try {
    await db.run(`
      INSERT INTO submission_log (vaga_id, nome, phone, ip, success, error_msg, candidate_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [body.vagaId || null, (body.nome || '').trim() || null, phone, ip, success ? 1 : 0, errorMsg, candidateId])
  } catch (err) {
    console.error('[submission_log] falhou ao registrar tentativa:', err.message)
  }

  // Fire-and-forget: não atrasa a resposta nem derruba o fluxo se o Sheets falhar.
  pushToSheetsBackup({
    vagaId:     body.vagaId,
    vagaTitulo: vaga?.titulo || '',
    nome:       (body.nome || '').trim(),
    phone,
    email:      (body.email || '').trim(),
    respostas:  formatRespostas(body.answers),
    cvPreview:  (cvTextOverride ?? body.cvText ?? '').trim().slice(0, 500),
    success,
    errorMsg,
  })
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

// GET /api/candidatos/backup-config — expõe (não-sensível) a URL do webhook do
// Google Sheets pra o navegador disparar a cópia "Garantia" direto, sem depender
// do servidor estar de pé. Sem SHEETS_WEBHOOK_URL configurada, o client só não dispara.
router.get('/api/candidatos/backup-config', (_req, res) => {
  res.json({
    url:    process.env.SHEETS_WEBHOOK_URL || null,
    secret: process.env.SHEETS_WEBHOOK_SECRET || '',
  })
})

// POST /api/candidatos/submit
router.post('/api/candidatos/submit', submitRateLimit, async (req, res) => {
  try {
    const { vagaId, nome, telefone, email = '', cvText, cvPdf, answers = [] } = req.body

    const vaga = vagaId ? await getVagaById(vagaId) : null
    if (!vaga || vaga.status === 'inactive') {
      await logSubmission({ req, success: false, errorMsg: 'vaga_invalida_ou_inativa' })
      return res.status(400).json({ ok: false, error: 'Vaga inválida ou não disponível.' })
    }
    if (vaga.status === 'paused') {
      await logSubmission({ req, success: false, errorMsg: 'vaga_pausada', vaga })
      return res.status(400).json({ ok: false, error: 'Esta vaga não está recebendo candidaturas no momento.' })
    }
    if (!nome?.trim()) {
      await logSubmission({ req, success: false, errorMsg: 'nome_ausente', vaga })
      return res.status(400).json({ ok: false, error: 'Nome é obrigatório.' })
    }

    const digits = (telefone || '').replace(/\D/g, '')
    if (digits.length < 10) {
      await logSubmission({ req, success: false, errorMsg: 'telefone_invalido', vaga })
      return res.status(400).json({ ok: false, error: 'Telefone inválido (mínimo 10 dígitos).' })
    }
    // Fallback de OCR: PDF digitalizado/fotografado (comum em candidatura de celular,
    // sem scanner) extrai pouco ou nenhum texto selecionável no PDF.js do navegador.
    // Antes de rejeitar como "currículo ausente", tenta transcrever via Gemini Vision
    // aqui no servidor — mesmo limiar de "parece digitalizado" usado em triagem.js.
    let finalCvText = (cvText || '').trim()
    if (finalCvText.length < 80 && cvPdf) {
      try {
        finalCvText = (await ocrTranscribe(cvPdf, 'application/pdf')).trim()
      } catch (err) {
        console.warn('[candidato] OCR fallback falhou:', err.message)
      }
    }

    if (!finalCvText) {
      await logSubmission({ req, success: false, errorMsg: 'curriculo_ausente', vaga })
      return res.status(400).json({ ok: false, error: 'Currículo é obrigatório.' })
    }

    const phone = (digits.length === 10 || digits.length === 11) ? '55' + digits : digits

    const existing = await db.get('SELECT id FROM candidates WHERE phone = ? AND job_id = ?', [phone, vagaId])
    if (existing) {
      await logSubmission({ req, success: false, errorMsg: 'duplicado_phone_vaga', candidateId: existing.id, vaga })
      return res.status(409).json({ ok: false, error: 'Já existe uma candidatura para esta vaga com este telefone. Se não foi você quem se candidatou (ex: número compartilhado ou reaproveitado), tente novamente com outro número.' })
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
        finalCvText,
        cvPdf || null,
        JSON.stringify(answers),
      ])
      await logSubmission({ req, success: true, candidateId: lastInsertRowid, vaga, cvTextOverride: finalCvText })
      res.json({ ok: true })

      triarEPersistir(lastInsertRowid).catch(err =>
        console.error('[candidato] triagem automática falhou:', err.message)
      )
    } catch (err) {
      if (err.message?.includes('UNIQUE')) {
        await logSubmission({ req, success: false, errorMsg: 'duplicado_unique_constraint', vaga })
        return res.status(409).json({ ok: false, error: 'Já existe uma candidatura para esta vaga com este telefone. Se não foi você quem se candidatou (ex: número compartilhado ou reaproveitado), tente novamente com outro número.' })
      }
      throw err
    }
  } catch (err) {
    console.error('[candidato] Erro ao inserir:', err.message)
    await logSubmission({ req, success: false, errorMsg: `erro_interno: ${err.message}`.slice(0, 500) })
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

// GET /api/organico/stats — trilha de auditoria: quantas candidaturas chegaram
// (sucesso/falha) hoje, nos últimos 7 dias e no total, + falhas recentes para
// investigação manual. Fonte de verdade pra reconciliar com a contagem do cliente.
router.get('/api/organico/stats', ...requireRole('rh', 'admin'), async (_req, res) => {
  try {
    const [hoje, semana, total, falhasRecentes] = await Promise.all([
      db.get(`
        SELECT
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS sucesso,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS falha
        FROM submission_log
        WHERE date(created_at) = date('now', 'localtime')
      `),
      db.get(`
        SELECT
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS sucesso,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS falha
        FROM submission_log
        WHERE created_at >= datetime('now', '-7 days', 'localtime')
      `),
      db.get(`
        SELECT
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS sucesso,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS falha
        FROM submission_log
      `),
      db.all(`
        SELECT id, vaga_id, nome, phone, ip, error_msg, created_at
        FROM submission_log
        WHERE success = 0 AND created_at >= datetime('now', '-7 days', 'localtime')
        ORDER BY created_at DESC
        LIMIT 30
      `),
    ])

    const num = v => Number(v ?? 0)
    res.json({
      hoje:   { sucesso: num(hoje?.sucesso),   falha: num(hoje?.falha) },
      semana: { sucesso: num(semana?.sucesso), falha: num(semana?.falha) },
      total:  { sucesso: num(total?.sucesso),  falha: num(total?.falha) },
      falhasRecentes,
    })
  } catch (err) {
    console.error('[organico/stats] Erro:', err.message)
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

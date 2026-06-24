'use strict'

const express = require('express')
const router  = express.Router()
const ExcelJS = require('exceljs')
const { auth } = require('../middleware/auth')
const db = require('../../db')

const DIM_LABELS = {
  heartist:        'Heartist®',
  tecnico:         'Técnico',
  estabilidade:    'Estabilidade',
  experiencia:     'Experiência',
  potencial:       'Potencial',
}

function scoreHex(s) {
  if (s >= 75) return 'FF10b981'
  if (s >= 50) return 'FFFBBF24'
  return 'FFf43f5e'
}
function recColor(rec) {
  const n = (rec || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  if (n.includes('avan'))  return { bg: 'FFd1fae5', fg: 'FF065f46' }
  if (n.includes('aguar')) return { bg: 'FFfef9c3', fg: 'FF713f12' }
  return { bg: 'FFfee2e2', fg: 'FF7f1d1d' }
}
const fill  = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const thin  = { style: 'thin', color: { argb: 'FFd1d5db' } }
const border = { top: thin, left: thin, bottom: thin, right: thin }

// POST /api/export-xlsx
router.post('/export-xlsx', auth, async (req, res) => {
  const { vagaData, resultados } = req.body || {}
  if (!Array.isArray(resultados) || !resultados.length)
    return res.status(400).json({ error: 'Sem dados para exportar.' })

  const wb = new ExcelJS.Workbook()
  wb.creator = 'AI-HR Academy — Pullman Ibirapuera'
  wb.created = new Date()

  const sorted = [...resultados].sort((a, b) => b.scoreTotal - a.scoreTotal)

  // ══════════════════════════════════════════════════════════════════════════════
  // ABA 1 — TRIAGEM PULLMAN (padrão visual + dados IA)
  // ══════════════════════════════════════════════════════════════════════════════
  const sh = wb.addWorksheet('Triagem Pullman', {
    views: [{ state: 'frozen', ySplit: 2, showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  })

  // ── Linha de título ───────────────────────────────────────────────────────────
  sh.mergeCells('A1:Q1')
  const titleCell = sh.getCell('A1')
  titleCell.value = `TRIAGEM DE CANDIDATOS — ${(vagaData?.titulo || 'VAGA').toUpperCase()}  ·  ${vagaData?.marca || ''}  ·  ${new Date().toLocaleDateString('pt-BR')}`
  titleCell.font      = { bold: true, size: 12, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
  titleCell.fill      = fill('FF4a1d96')   // roxo
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  sh.getRow(1).height = 28

  // ── Cabeçalho (cinza escuro) ──────────────────────────────────────────────────
  const HEADERS = [
    { label: 'Foto\nPerfil',          width: 9  },
    { label: 'Nome',                  width: 24 },
    { label: 'Idade',                 width: 7  },
    { label: 'Telefone',              width: 15 },
    { label: 'LinkedIn',              width: 28 },
    { label: 'Inglês',                width: 14 },
    { label: 'Score\nAI',             width: 8  },
    { label: 'Recomendação',          width: 14 },
    { label: 'Resumo de Experiência', width: 42 },
    { label: 'Pontos Fortes',         width: 30 },
    { label: 'Pontos de\nAtenção',    width: 30 },
    { label: 'Heartist®\n(0-10)',     width: 11 },
    { label: 'Técnico\n(0-10)',       width: 11 },
    { label: 'Estabilidade\n(0-10)',  width: 12 },
    { label: 'Experiência\n(0-10)',   width: 12 },
    { label: 'Potencial\n(0-10)',     width: 11 },
    { label: 'Pretensão\nSalarial',   width: 13 },
    { label: 'Entrevista\nP&C',       width: 13 },
    { label: 'Próxima\nEtapa',        width: 14 },
    { label: 'Observação',            width: 22 },
  ]

  const HDR_FILL = fill('FF404040')   // cinza escuro
  const HDR_FONT = { bold: true, size: 9, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }

  HEADERS.forEach((h, i) => {
    const col  = i + 1
    const cell = sh.getCell(2, col)
    cell.value     = h.label
    cell.font      = HDR_FONT
    cell.fill      = HDR_FILL
    cell.border    = border
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    sh.getColumn(col).width = h.width
  })
  sh.getRow(2).height = 32

  // Auto-filtro no cabeçalho
  sh.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: HEADERS.length } }

  // ── Linhas de dados ───────────────────────────────────────────────────────────
  sorted.forEach((r, idx) => {
    const rowNum = 3 + idx
    const bgArgb = idx % 2 === 0 ? 'FFF5F5F5' : 'FFFFFFFF'   // zebra cinza / branco
    const row    = sh.getRow(rowNum)
    row.height   = 75

    const rc = recColor(r.recomendacao)

    const values = [
      '',                                                              // Foto (vazia)
      r.nome,                                                          // Nome
      r.idade    ?? '',                                                // Idade
      r.telefone ?? '',                                                // Telefone
      r.linkedin      ?? '',                                           // LinkedIn
      r.nivel_ingles  ?? '',                                           // Inglês
      r.scoreTotal,                                                    // Score
      r.recomendacao || '',                                            // Recomendação
      r.resumo || '',                                                  // Resumo de experiência
      (r.pontosFort    || []).map(p => `✔ ${p}`).join('\n'),          // Pontos fortes
      (r.pontosAtencao || []).map(p => `⚠ ${p}`).join('\n'),          // Pontos atenção
      r.dimensoes?.heartist?.score        ?? '',
      r.dimensoes?.tecnico?.score         ?? '',
      r.dimensoes?.estabilidade?.score     ?? '',
      r.dimensoes?.experiencia?.score     ?? '',
      r.dimensoes?.potencial?.score       ?? '',
      '',   // Pretensão salarial (manual)
      '',   // Entrevista P&C (manual)
      '',   // Próxima etapa (manual)
      '',   // Observação (manual)
    ]

    values.forEach((v, ci) => {
      const cell = row.getCell(ci + 1)
      cell.value  = v
      cell.font   = { size: 9, name: 'Calibri', color: { argb: 'FF1f1f1f' } }
      cell.fill   = fill(bgArgb)
      cell.border = border
      cell.alignment = { vertical: 'top', wrapText: true,
        horizontal: (ci === 1 || ci >= 4) ? 'left' : 'center' }

      // LinkedIn clicável (col 4)
      if (ci === 4 && v) {
        cell.value = { text: v, hyperlink: v }
        cell.font  = { size: 9, name: 'Calibri', color: { argb: 'FF1d4ed8' }, underline: true }
      }

      // Score colorido (col 6)
      if (ci === 6 && v !== '') {
        cell.font = { bold: true, size: 11, name: 'Calibri', color: { argb: scoreHex(v) } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
      }

      // Recomendação com badge colorido (col 7)
      if (ci === 7 && v) {
        cell.fill = fill(rc.bg)
        cell.font = { bold: true, size: 9, name: 'Calibri', color: { argb: rc.fg } }
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false }
      }

      // Dimensões coloridas (cols 11-15)
      if (ci >= 11 && ci <= 15 && v !== '') {
        const pct = (v / 10) * 100
        cell.font = { bold: true, size: 10, name: 'Calibri', color: { argb: scoreHex(pct) } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
      }
    })
  })

  // ══════════════════════════════════════════════════════════════════════════════
  // ABA 2 — DASHBOARD (KPIs resumidos)
  // ══════════════════════════════════════════════════════════════════════════════
  const dash = wb.addWorksheet('Dashboard', {
    views: [{ showGridLines: false }],
  })

  const total    = sorted.length
  const avancar  = sorted.filter(r => (r.recomendacao||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes('avan')).length
  const aguardar = sorted.filter(r => (r.recomendacao||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes('aguar')).length
  const dispensar = total - avancar - aguardar
  const media    = Math.round(sorted.reduce((s,r) => s + (r.scoreTotal||0), 0) / total)
  const melhor   = Math.max(...sorted.map(r => r.scoreTotal||0))

  dash.mergeCells('A1:F1')
  const dTitle = dash.getCell('A1')
  dTitle.value = `DASHBOARD — ${(vagaData?.titulo || '').toUpperCase()}`
  dTitle.font  = { bold: true, size: 14, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
  dTitle.fill  = fill('FF4a1d96')
  dTitle.alignment = { horizontal: 'center', vertical: 'middle' }
  dash.getRow(1).height = 34

  const kpis = [
    { label: 'Total Triados',  value: total,        color: 'FF6d28d9' },
    { label: 'Avançar',        value: avancar,      color: 'FF059669' },
    { label: 'Aguardar',       value: aguardar,     color: 'FFd97706' },
    { label: 'Dispensar',      value: dispensar,    color: 'FFdc2626' },
    { label: 'Score Médio',    value: `${media}/100`, color: 'FF0891b2' },
    { label: 'Maior Score',    value: `${melhor}/100`, color: 'FF7c3aed' },
  ]
  kpis.forEach((k, i) => {
    const col = i + 1
    dash.getColumn(col).width = 16
    const lbl = dash.getCell(3, col)
    lbl.value = k.label
    lbl.font  = { bold: true, size: 9, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
    lbl.fill  = fill(k.color)
    lbl.alignment = { horizontal: 'center', vertical: 'middle' }
    dash.getRow(3).height = 20

    const val = dash.getCell(4, col)
    val.value = k.value
    val.font  = { bold: true, size: 24, color: { argb: k.color }, name: 'Calibri' }
    val.alignment = { horizontal: 'center', vertical: 'middle' }
    dash.getRow(4).height = 48
  })

  // Tabela de ranking
  dash.getRow(6).height = 8
  const rHdr = ['#', 'Candidato', 'Score', 'Recomendação', 'Inglês', 'Pontos Fortes', 'Resumo']
  const rCols = [4, 24, 9, 16, 13, 34, 44]
  rHdr.forEach((h, i) => {
    const cell = dash.getCell(7, i + 1)
    cell.value = h
    cell.font  = { bold: true, size: 9, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
    cell.fill  = fill('FF404040')
    cell.border = border
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    dash.getColumn(i + 1).width = rCols[i]
  })
  dash.getRow(7).height = 22

  sorted.forEach((r, idx) => {
    const rowN = 8 + idx
    const bg   = idx % 2 === 0 ? 'FFF5F5F5' : 'FFFFFFFF'
    const rc   = recColor(r.recomendacao)
    const row  = dash.getRow(rowN)
    row.height = 40

    const vals = [
      idx + 1, r.nome, r.scoreTotal, r.recomendacao || '',
      r.nivel_ingles || '—', (r.pontosFort || []).join(' · '), r.resumo || '',
    ]
    vals.forEach((v, ci) => {
      const cell = row.getCell(ci + 1)
      cell.value = v
      cell.font  = { size: 9, name: 'Calibri', color: { argb: 'FF1f1f1f' } }
      cell.fill  = fill(bg)
      cell.border = border
      cell.alignment = { vertical: 'top', wrapText: true, horizontal: ci <= 1 ? 'left' : 'center' }
      if (ci === 2) cell.font = { bold: true, size: 11, name: 'Calibri', color: { argb: scoreHex(v) } }
      if (ci === 3 && v) { cell.fill = fill(rc.bg); cell.font = { bold: true, size: 9, name: 'Calibri', color: { argb: rc.fg } } }
    })
  })

  // ══════════════════════════════════════════════════════════════════════════════
  // ABA 3 — DIMENSÕES
  // ══════════════════════════════════════════════════════════════════════════════
  const dimSh = wb.addWorksheet('Dimensões', {
    views: [{ state: 'frozen', ySplit: 2, showGridLines: false }],
  })

  dimSh.mergeCells('A1:H1')
  const dimTitle = dimSh.getCell('A1')
  dimTitle.value = `ANÁLISE POR DIMENSÃO — ${(vagaData?.titulo || '').toUpperCase()}`
  dimTitle.font  = { bold: true, size: 12, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
  dimTitle.fill  = fill('FF0e7490')
  dimTitle.alignment = { horizontal: 'center', vertical: 'middle' }
  dimSh.getRow(1).height = 28

  const dimHdrs = ['Candidato', 'Score Total', ...Object.values(DIM_LABELS)]
  const dimWidths = [24, 12, 14, 14, 14, 16, 13]
  dimHdrs.forEach((h, i) => {
    const cell = dimSh.getCell(2, i + 1)
    cell.value = h
    cell.font  = { bold: true, size: 9, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
    cell.fill  = fill('FF404040')
    cell.border = border
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    dimSh.getColumn(i + 1).width = dimWidths[i]
  })
  dimSh.getRow(2).height = 26

  sorted.forEach((r, idx) => {
    const rowN = 3 + idx
    const bg   = idx % 2 === 0 ? 'FFf0fdfa' : 'FFFFFFFF'
    const row  = dimSh.getRow(rowN)
    row.height = 22

    const vals = [
      r.nome, r.scoreTotal,
      ...Object.keys(DIM_LABELS).map(k => r.dimensoes?.[k]?.score ?? ''),
    ]
    vals.forEach((v, ci) => {
      const cell = row.getCell(ci + 1)
      cell.value = v
      cell.font  = { size: 9, name: 'Calibri', color: { argb: 'FF1f1f1f' } }
      cell.fill  = fill(bg)
      cell.border = border
      cell.alignment = { horizontal: ci === 0 ? 'left' : 'center', vertical: 'middle' }
      if (ci === 1) cell.font = { bold: true, size: 10, name: 'Calibri', color: { argb: scoreHex(v) } }
      if (ci >= 2 && v !== '') {
        const pct = (v / 10) * 100
        cell.font = { bold: true, size: 10, name: 'Calibri', color: { argb: scoreHex(pct) } }
      }
    })
  })

  // Linha de médias
  const avgRow = dimSh.rowCount + 2
  dimSh.getCell(avgRow, 1).value = 'MÉDIA GERAL'
  dimSh.getCell(avgRow, 1).font  = { bold: true, size: 9, name: 'Calibri', color: { argb: 'FFFFFFFF' } }
  dimSh.getCell(avgRow, 1).fill  = fill('FF0e7490')
  dimSh.getCell(avgRow, 2).value = Math.round(sorted.reduce((s,r) => s + (r.scoreTotal||0), 0) / sorted.length)
  dimSh.getCell(avgRow, 2).font  = { bold: true, size: 10, name: 'Calibri' }
  dimSh.getCell(avgRow, 2).fill  = fill('FFf0fdfa')
  Object.keys(DIM_LABELS).forEach((k, i) => {
    const avg  = sorted.reduce((s,r) => s + (r.dimensoes?.[k]?.score||0), 0) / sorted.length
    const cell = dimSh.getCell(avgRow, 3 + i)
    cell.value = parseFloat(avg.toFixed(1))
    cell.font  = { bold: true, size: 10, name: 'Calibri', color: { argb: scoreHex((avg/10)*100) } }
    cell.fill  = fill('FFf0fdfa')
    cell.border = border
    cell.alignment = { horizontal: 'center' }
  })

  // ── Resposta ──────────────────────────────────────────────────────────────────
  const vaga = (vagaData?.titulo || 'candidatos').toLowerCase().replace(/\s+/g, '-')
  const filename = `triagem-pullman-${vaga}-${new Date().toISOString().slice(0,10)}.xlsx`

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  await wb.xlsx.write(res)
  res.end()
})

// POST /api/organico/export — XLSX de candidatos orgânicos de uma vaga
router.post('/organico/export', auth, async (req, res) => {
  try {
  const { vagaId } = req.body || {}
  if (!vagaId) return res.status(400).json({ error: 'vagaId é obrigatório.' })

  const candidates = await db.all(
    `SELECT id, name, phone, email, job_position, job_id, status, created_at,
            ai_score_total, ai_recomendacao, ai_resumo, ai_pontos_fortes,
            ai_pontos_atencao, ai_dimensoes, substr(cv_text,1,400) as cv_preview
     FROM candidates
     WHERE source='organico' AND job_id = ?
     ORDER BY ai_score_total DESC, created_at DESC`,
    [vagaId]
  )

  if (!candidates.length)
    return res.status(404).json({ error: 'Nenhum candidato orgânico para esta vaga.' })

  const triados   = candidates.filter(c => c.ai_score_total > 0)
  const pendentes = candidates.filter(c => !c.ai_score_total)

  const wb = new ExcelJS.Workbook()
  wb.creator = 'AI-HR Academy — Pullman Ibirapuera'
  wb.created = new Date()

  const vagaTitulo = candidates[0]?.job_position || vagaId
  const dateStr    = new Date().toLocaleDateString('pt-BR')

  // ── ABA: Candidatos Triados (formato completo) ────────────────────────────────
  if (triados.length) {
    const sh = wb.addWorksheet('Triados', {
      views: [{ state: 'frozen', ySplit: 2, showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
    })

    sh.mergeCells('A1:Q1')
    const t = sh.getCell('A1')
    t.value     = `CANDIDATOS ORGÂNICOS TRIADOS — ${vagaTitulo.toUpperCase()}  ·  ${dateStr}`
    t.font      = { bold: true, size: 12, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
    t.fill      = fill('FF4a1d96')
    t.alignment = { horizontal: 'center', vertical: 'middle' }
    sh.getRow(1).height = 28

    const HDRS = [
      { label: 'Nome',                  width: 24 },
      { label: 'Telefone',              width: 15 },
      { label: 'E-mail',                width: 22 },
      { label: 'Data Candidatura',      width: 16 },
      { label: 'Status',                width: 18 },
      { label: 'Score AI',              width: 10 },
      { label: 'Recomendação',          width: 14 },
      { label: 'Resumo de Experiência', width: 42 },
      { label: 'Pontos Fortes',         width: 30 },
      { label: 'Pontos de Atenção',     width: 30 },
      { label: 'Heartist® (0-10)',      width: 14 },
      { label: 'Técnico (0-10)',        width: 13 },
      { label: 'Estabilidade (0-10)',   width: 14 },
      { label: 'Experiência (0-10)',    width: 14 },
      { label: 'Potencial (0-10)',      width: 13 },
    ]

    HDRS.forEach((h, i) => {
      const cell = sh.getCell(2, i + 1)
      cell.value     = h.label
      cell.font      = { bold: true, size: 9, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
      cell.fill      = fill('FF404040')
      cell.border    = border
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      sh.getColumn(i + 1).width = h.width
    })
    sh.getRow(2).height = 30

    triados.forEach((c, idx) => {
      const rowNum = 3 + idx
      const bgArgb = idx % 2 === 0 ? 'FFF5F5F5' : 'FFFFFFFF'
      const row    = sh.getRow(rowNum)
      row.height   = 60

      let dims = {}
      try { dims = c.ai_dimensoes ? JSON.parse(c.ai_dimensoes) : {} } catch (_) {}
      let pontosFort = [], pontosAtencao = []
      try { pontosFort    = c.ai_pontos_fortes  ? JSON.parse(c.ai_pontos_fortes)  : [] } catch (_) {}
      try { pontosAtencao = c.ai_pontos_atencao ? JSON.parse(c.ai_pontos_atencao) : [] } catch (_) {}

      const rc = recColor(c.ai_recomendacao)
      const vals = [
        c.name,
        c.phone || '',
        c.email || '',
        c.created_at ? new Date(c.created_at).toLocaleDateString('pt-BR') : '',
        c.status || '',
        c.ai_score_total || '',
        c.ai_recomendacao || '',
        c.ai_resumo || '',
        pontosFort.map(p => `✔ ${p}`).join('\n'),
        pontosAtencao.map(p => `⚠ ${p}`).join('\n'),
        dims.heartist?.score     ?? '',
        dims.tecnico?.score      ?? '',
        dims.estabilidade?.score ?? '',
        dims.experiencia?.score  ?? '',
        dims.potencial?.score    ?? '',
      ]
      vals.forEach((v, ci) => {
        const cell = row.getCell(ci + 1)
        cell.value     = v
        cell.font      = { size: 9, name: 'Calibri', color: { argb: 'FF1f1f1f' } }
        cell.fill      = fill(bgArgb)
        cell.border    = border
        cell.alignment = { vertical: 'top', wrapText: true, horizontal: ci === 0 ? 'left' : 'center' }
        if (ci === 5 && v !== '') {
          cell.font = { bold: true, size: 11, name: 'Calibri', color: { argb: scoreHex(v) } }
          cell.alignment = { horizontal: 'center', vertical: 'middle' }
        }
        if (ci === 6 && v) {
          cell.fill = fill(rc.bg)
          cell.font = { bold: true, size: 9, name: 'Calibri', color: { argb: rc.fg } }
        }
        if (ci >= 10 && v !== '') {
          const pct = (v / 10) * 100
          cell.font = { bold: true, size: 10, name: 'Calibri', color: { argb: scoreHex(pct) } }
          cell.alignment = { horizontal: 'center', vertical: 'middle' }
        }
      })
    })
  }

  // ── ABA: Pendentes (sem triagem) ─────────────────────────────────────────────
  if (pendentes.length) {
    const ps = wb.addWorksheet('Pendentes', {
      views: [{ state: 'frozen', ySplit: 2, showGridLines: false }],
    })

    ps.mergeCells('A1:G1')
    const pt = ps.getCell('A1')
    pt.value     = `CANDIDATOS AGUARDANDO TRIAGEM — ${vagaTitulo.toUpperCase()}  ·  ${dateStr}`
    pt.font      = { bold: true, size: 12, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
    pt.fill      = fill('FF0e7490')
    pt.alignment = { horizontal: 'center', vertical: 'middle' }
    ps.getRow(1).height = 28

    const PHDRS = [
      { label: 'Nome',              width: 24 },
      { label: 'Telefone',          width: 15 },
      { label: 'E-mail',            width: 22 },
      { label: 'Data Candidatura',  width: 16 },
      { label: 'Status',            width: 18 },
      { label: 'Vaga',              width: 22 },
      { label: 'Trecho do CV',      width: 50 },
    ]
    PHDRS.forEach((h, i) => {
      const cell = ps.getCell(2, i + 1)
      cell.value     = h.label
      cell.font      = { bold: true, size: 9, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
      cell.fill      = fill('FF404040')
      cell.border    = border
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      ps.getColumn(i + 1).width = h.width
    })
    ps.getRow(2).height = 26

    pendentes.forEach((c, idx) => {
      const rowNum = 3 + idx
      const bg     = idx % 2 === 0 ? 'FFF5F5F5' : 'FFFFFFFF'
      const row    = ps.getRow(rowNum)
      row.height   = 40
      const vals   = [
        c.name,
        c.phone || '',
        c.email || '',
        c.created_at ? new Date(c.created_at).toLocaleDateString('pt-BR') : '',
        c.status || 'Pendente',
        c.job_position || '',
        c.cv_preview || '',
      ]
      vals.forEach((v, ci) => {
        const cell = row.getCell(ci + 1)
        cell.value     = v
        cell.font      = { size: 9, name: 'Calibri', color: { argb: 'FF1f1f1f' } }
        cell.fill      = fill(bg)
        cell.border    = border
        cell.alignment = { vertical: 'top', wrapText: true, horizontal: ci === 0 ? 'left' : 'center' }
      })
    })
  }

  const slug     = vagaTitulo.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  const filename = `organico-${slug}-${new Date().toISOString().slice(0,10)}.xlsx`
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  await wb.xlsx.write(res)
  res.end()
  } catch (err) {
    console.error('[organico/export]', err)
    if (!res.headersSent) res.status(500).json({ error: 'Erro ao gerar exportação.' })
  }
})

module.exports = router

'use strict'

const express = require('express')
const router  = express.Router()
const ExcelJS = require('exceljs')
const { auth } = require('../middleware/auth')

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
  wb.creator = 'AI-HR Academy — Accor Brasil'
  wb.created = new Date()

  const sorted = [...resultados].sort((a, b) => b.scoreTotal - a.scoreTotal)

  // ══════════════════════════════════════════════════════════════════════════════
  // ABA 1 — TRIAGEM ACCOR (padrão visual Accor + dados IA)
  // ══════════════════════════════════════════════════════════════════════════════
  const sh = wb.addWorksheet('Triagem Accor', {
    views: [{ state: 'frozen', ySplit: 2, showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  })

  // ── Linha de título ───────────────────────────────────────────────────────────
  sh.mergeCells('A1:Q1')
  const titleCell = sh.getCell('A1')
  titleCell.value = `TRIAGEM DE CANDIDATOS — ${(vagaData?.titulo || 'VAGA').toUpperCase()}  ·  ${vagaData?.marca || ''}  ·  ${new Date().toLocaleDateString('pt-BR')}`
  titleCell.font      = { bold: true, size: 12, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
  titleCell.fill      = fill('FF4a1d96')   // roxo Accor
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  sh.getRow(1).height = 28

  // ── Cabeçalho (estilo Accor: cinza escuro) ────────────────────────────────────
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

  const HDR_FILL = fill('FF404040')   // cinza escuro Accor
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
  const filename = `triagem-accor-${vaga}-${new Date().toISOString().slice(0,10)}.xlsx`

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  await wb.xlsx.write(res)
  res.end()
})

module.exports = router

'use strict'

if (typeof requireAuth === 'function' && !requireAuth()) throw new Error('not auth')

// PDF.js worker
if (typeof pdfjsLib !== 'undefined')
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

let cvText = ''

// ── Auth badge ───────────────────────────────────────────────────────────────
;(function initBadge() {
  const user  = typeof getUser === 'function' ? getUser() : null
  const avatar = document.getElementById('sidebarAvatar')
  const nameEl = document.getElementById('sidebarName')
  const roleEl = document.getElementById('sidebarRole')
  if (avatar && user) avatar.textContent = (user.name || '?')[0].toUpperCase()
  const mobAvatar = document.getElementById('mobTopbarAvatar')
  if (mobAvatar && user) mobAvatar.textContent = (user.name || '?')[0].toUpperCase()
  if (typeof injectUserBadge === 'function') injectUserBadge(nameEl, roleEl)
})()

// ── Drag & drop ───────────────────────────────────────────────────────────────
function handleDragOver(e) {
  e.preventDefault()
  document.getElementById('dropZone').classList.add('drag-over')
}
function handleDragLeave(e) {
  document.getElementById('dropZone').classList.remove('drag-over')
}
function handleDrop(e) {
  e.preventDefault()
  document.getElementById('dropZone').classList.remove('drag-over')
  const file = e.dataTransfer.files?.[0]
  if (file) processFile(file)
}
// Aliases para os handlers inline do HTML
const onDragOver  = handleDragOver
const onDragLeave = handleDragLeave
const onDrop      = handleDrop
function handleFileSelect(e) {
  const file = e.target.files?.[0]
  if (file) processFile(file)
}

// ── File processing ───────────────────────────────────────────────────────────
async function processFile(file) {
  const allowed = ['application/pdf','text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword']
  if (!allowed.includes(file.type) && !file.name.match(/\.(pdf|txt|docx|doc)$/i)) {
    showToast('Formato não suportado. Use PDF, DOCX ou TXT.', true); return
  }

  setStatus('Lendo arquivo...')

  try {
    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      cvText = await parsePDF(file)
      if (cvText.trim().length < 80) {
        cvText = await ocrPDF(file)
      }
    } else if (file.name.match(/\.(docx|doc)$/i)) {
      cvText = await parseDOCX(file)
    } else {
      cvText = await file.text()
    }
  } catch (err) {
    clearStatus()
    showToast('Erro ao ler o arquivo. Tente outro formato.', true)
    return
  }

  clearStatus()

  if (!cvText?.trim() || cvText.trim().length < 80) {
    showToast('Não foi possível extrair texto suficiente do arquivo.', true)
    return
  }

  const zone = document.getElementById('dropZone')
  zone.classList.add('has-file')
  document.getElementById('cvFileName').textContent = '✓ ' + file.name
  document.getElementById('uploadIcon').textContent = '✅'
  document.getElementById('uploadTitle').textContent = 'Arquivo carregado!'
  document.getElementById('uploadSub').textContent = `${(cvText.length / 1000).toFixed(1)}k caracteres extraídos`
  document.getElementById('btnAvaliar').disabled = false
  document.getElementById('btnLimpar').style.display = 'inline-flex'
}

async function parsePDF(file) {
  const buf    = await file.arrayBuffer()
  const pdf    = await pdfjsLib.getDocument({ data: buf }).promise
  const pages  = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map(it => it.str).join(' '))
  }
  return pages.join('\n')
}

async function ocrPDF(file) {
  const b64 = await fileToBase64(file)
  const r   = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ pdfBase64: b64 })
  })
  if (!r.ok) throw new Error('OCR falhou')
  const data = await r.json()
  return data.text || ''
}

async function parseDOCX(file) {
  const buf   = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  const text  = []
  const str   = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const matches = str.matchAll(/<w:t[^>]*>([^<]+)<\/w:t>/g)
  for (const m of matches) text.push(m[1])
  return text.join(' ') || await file.text()
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload  = () => res(r.result.split(',')[1])
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

// ── Avaliar ───────────────────────────────────────────────────────────────────
async function avaliar() {
  if (!cvText?.trim()) { showToast('Envie um currículo primeiro.', true); return }

  const vaga = document.getElementById('vagaInput')?.value?.trim() || ''

  document.getElementById('btnAvaliar').disabled = true
  setStatus('A IA está analisando seu currículo...')

  try {
    const r = await fetch('/api/curriculo/avaliar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ cvText, vaga })
    })
    const data = await r.json()
    if (!r.ok) throw new Error(data.error || 'Erro na análise.')
    clearStatus()
    renderResult(data)
  } catch (err) {
    clearStatus()
    document.getElementById('btnAvaliar').disabled = false
    showToast(err.message, true)
  }
}

// ── Render result ─────────────────────────────────────────────────────────────
function renderResult(d) {
  document.getElementById('cvEmpty').style.display  = 'none'
  const result = document.getElementById('cvResult')
  result.classList.add('on')

  // Score ring
  const nota   = Math.min(100, Math.max(0, d.nota || 0))
  const circum = 2 * Math.PI * 40
  const offset = circum * (1 - nota / 100)
  const fill   = document.getElementById('ringFill')
  const color  = nota >= 75 ? '#10b981' : nota >= 50 ? '#06b6d4' : nota >= 30 ? '#f59e0b' : '#f43f5e'

  fill.style.stroke = color
  setTimeout(() => { fill.style.strokeDashoffset = offset }, 80)
  document.getElementById('ringScore').textContent = nota

  document.getElementById('scoreNota').textContent  = `Nota: ${nota}/100`

  const nivelRaw = (d.nivel || 'Intermediário').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
  const nivelKey = nivelRaw.includes('inicia') ? 'iniciante'
                 : nivelRaw.includes('senior') || nivelRaw.includes('sênior') ? 'senior'
                 : nivelRaw.includes('especial') ? 'especialista'
                 : 'intermediario'
  const nivelEl = document.getElementById('scoreNivel')
  nivelEl.textContent  = d.nivel || 'Intermediário'
  nivelEl.className    = `cv-score-nivel ${nivelKey}`

  document.getElementById('scoreResumo').textContent = d.resumo || ''

  // Lists
  renderList('listQualidades', d.qualidades || [], '✓')
  renderList('listFracos',     d.pontos_fracos || [], '✗')
  renderList('listMelhorias',  d.melhorias || [], '→')

  // Meta badges
  const meta = document.getElementById('cvMeta')
  meta.innerHTML = ''
  if (d.formatacao) meta.innerHTML += badge('🖨️', 'Formatação', d.formatacao)
  if (d.nivel_ingles) meta.innerHTML += badge('🌐', 'Inglês', d.nivel_ingles)

  // Dica
  document.getElementById('cvDicaTxt').textContent = d.dica_destaque || ''
  document.getElementById('btnAvaliar').disabled = false
}

function renderList(id, items, symbol) {
  const el = document.getElementById(id)
  el.innerHTML = (items || []).map(item => `
    <div class="cv-list-item">
      <div class="cv-list-dot">${symbol}</div>
      <div>${esc(item)}</div>
    </div>`).join('')
}

function badge(icon, label, value) {
  return `<div class="cv-meta-badge">${icon} ${label}: <span>${esc(value)}</span></div>`
}

// ── Limpar ────────────────────────────────────────────────────────────────────
function limpar() {
  cvText = ''
  document.getElementById('dropZone').classList.remove('has-file')
  document.getElementById('cvFileName').textContent = ''
  document.getElementById('uploadIcon').textContent = '📄'
  document.getElementById('uploadTitle').textContent = 'Envie seu Currículo'
  document.getElementById('uploadSub').textContent = 'Arraste aqui ou clique para selecionar\nPDF, DOCX ou TXT'
  document.getElementById('cvFile').value = ''
  document.getElementById('btnAvaliar').disabled = true
  document.getElementById('btnLimpar').style.display = 'none'
  document.getElementById('cvEmpty').style.display = 'block'
  document.getElementById('cvResult').classList.remove('on')
}

// ── Status helpers ────────────────────────────────────────────────────────────
function setStatus(txt) {
  const el = document.getElementById('cvStatus')
  document.getElementById('cvStatusTxt').textContent = txt
  el.classList.add('on')
}
function clearStatus() {
  document.getElementById('cvStatus').classList.remove('on')
}

// ── Sidebar mobile ────────────────────────────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('open')
  document.getElementById('sidebarOverlay')?.classList.toggle('on')
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return (s || '').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

let toastT
function showToast(msg, err = false) {
  clearTimeout(toastT)
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg
  t.className   = err ? 'err show' : 'show'
  toastT = setTimeout(() => t.classList.remove('show'), 4000)
}

'use strict'

// ── State ─────────────────────────────────────────────────────────────────────
let vagas           = []
let selectedVaga    = null   // { id, titulo, perguntas[] }
let cvText          = ''
let cvPdfBase64     = null   // PDF original em base64 (sem prefixo data:...)
let currentStep     = 1
let backupCfg       = null   // { url, secret } — backup externo (Google Sheets), ver loadBackupConfig()

// ── PDF.js ────────────────────────────────────────────────────────────────────
const PDFJS_CDN    = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
let pdfLoaded = false

async function loadPDFJS() {
  if (pdfLoaded) return
  await loadScript(PDFJS_CDN)
  window['pdfjs-dist/build/pdf'].GlobalWorkerOptions.workerSrc = PDFJS_WORKER
  pdfLoaded = true
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = reject
    document.head.appendChild(s)
  })
}

// ── Init ──────────────────────────────────────────────────────────────────────
;(async () => {
  goStep(1)
  loadBackupConfig() // não bloqueia o carregamento das vagas
  await loadVagas()
  // Auto-selecionar vaga via query param (?vaga=VAGA_ID)
  const preVaga = new URLSearchParams(window.location.search).get('vaga')
  if (preVaga) {
    const found = vagas.find(v => v.id === preVaga)
    if (found) selectVaga(found.id)
  }
})()

// ── Backup externo (Google Sheets, aba "Garantia") ───────────────────────────
// Dispara direto do navegador pro Apps Script, ANTES do POST real pro backend —
// sobrevive mesmo se o Render estiver fora do ar. Best-effort: nunca bloqueia
// nem falha o envio da candidatura de verdade.
async function loadBackupConfig() {
  try {
    backupCfg = await fetch('/api/candidatos/backup-config').then(r => r.json())
  } catch { backupCfg = null }
}

function backupToSheets({ vagaId, nome, phone }) {
  if (!backupCfg?.url) return
  try {
    const digits = (phone || '').replace(/\D/g, '')
    const normPhone = digits ? ((digits.length === 10 || digits.length === 11) ? '55' + digits : digits) : ''
    const payload = JSON.stringify({
      secret: backupCfg.secret || '',
      aba:    'garantia',
      vagaId: vagaId || '',
      nome:   nome || '',
      phone:  normPhone,
    })
    if (navigator.sendBeacon) {
      navigator.sendBeacon(backupCfg.url, new Blob([payload], { type: 'text/plain' }))
    } else {
      fetch(backupCfg.url, { method: 'POST', mode: 'no-cors', keepalive: true, body: payload })
    }
  } catch { /* best-effort — nunca deve travar o envio real */ }
}

// ── Load vagas ────────────────────────────────────────────────────────────────
async function loadVagas() {
  const grid = document.getElementById('vagasGrid')
  grid.innerHTML = '<div class="vagas-loading">Carregando vagas...</div>'

  // Retry com backoff — lida com cold start do servidor (Render Free)
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 12000)
      const resp = await fetch('/api/vagas-public', { signal: controller.signal })
      clearTimeout(timeout)
      vagas = await resp.json()
      renderVagaCards()
      return
    } catch {
      if (attempt < 4) {
        grid.innerHTML = `<div class="vagas-loading">⏳ Conectando ao servidor... aguarde (tentativa ${attempt}/3)</div>`
        await new Promise(r => setTimeout(r, attempt * 4000))
      } else {
        grid.innerHTML = '<div class="vagas-loading">Servidor indisponível. Recarregue a página e tente novamente.</div>'
      }
    }
  }
}

function renderVagaCards() {
  const grid = document.getElementById('vagasGrid')
  grid.innerHTML = vagas.map(v => `
    <div class="vaga-card" onclick="selectVaga('${esc(v.id)}')">
      <div class="vaga-arrow">→</div>
      <div class="vaga-marca">${esc(v.marca)}</div>
      <div class="vaga-titulo">${esc(v.titulo)}</div>
      <div class="vaga-desc">${esc(v.descricao)}</div>
      <div class="vaga-meta">
        <span class="vaga-pill regime">${esc(v.regime)}</span>
        <a class="vaga-pill vaga-details-link" href="/vaga/${esc(v.id)}" target="_blank" onclick="event.stopPropagation()">Ver detalhes →</a>
      </div>
    </div>
  `).join('')
}

// ── Step navigation ───────────────────────────────────────────────────────────
function goStep(n) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'))
  document.getElementById('step' + n)?.classList.add('active')
  currentStep = n
  updateProgressBar(n)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function updateProgressBar(n) {
  document.querySelectorAll('.prog-dot').forEach((dot, i) => {
    dot.classList.remove('active', 'done')
    if (i + 1 < n)  dot.classList.add('done')
    if (i + 1 === n) dot.classList.add('active')
  })
  document.querySelectorAll('.prog-line').forEach((line, i) => {
    line.classList.toggle('done', i + 1 < n)
  })
}

// ── Select vaga ───────────────────────────────────────────────────────────────
function selectVaga(id) {
  selectedVaga = vagas.find(v => v.id === id)
  if (!selectedVaga) return

  // Update heading
  document.getElementById('vagaSelectedTitle').textContent = selectedVaga.titulo

  // Reset state
  cvText = ''
  document.getElementById('cvFileName').style.display = 'none'
  document.getElementById('cvTextarea').value = ''
  document.getElementById('formError').classList.remove('show')

  // Render questions
  renderQuestions(selectedVaga.perguntas || [])

  // Clear personal fields
  ;['formNome','formTelefone','formEmail'].forEach(id => {
    const el = document.getElementById(id)
    if (el) { el.value = ''; el.classList.remove('error') }
  })

  goStep(2)
}

// ── Questions ─────────────────────────────────────────────────────────────────
function renderQuestions(perguntas) {
  const container = document.getElementById('questionsContainer')
  const section   = document.getElementById('questionSection')
  if (!perguntas.length) {
    container.innerHTML = ''
    if (section) section.style.display = 'none'
    return
  }
  if (section) section.style.display = 'block'

  container.innerHTML = perguntas.map((q, i) => `
    <div class="question-block" id="qblock-${i}">
      <div class="question-num">Pergunta ${i + 1}</div>
      <div class="question-text">${esc(q)}</div>
      <textarea class="field-input" id="qresp-${i}" placeholder="Escreva sua resposta aqui..." rows="3"></textarea>
    </div>
  `).join('')
}

// ── CV Upload ─────────────────────────────────────────────────────────────────
function setupCVDrop() {
  const drop = document.getElementById('cvDrop')
  const inp  = document.getElementById('cvFileInput')

  drop.addEventListener('click', () => inp.click())
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag-over') })
  drop.addEventListener('dragleave', ()  => drop.classList.remove('drag-over'))
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('drag-over')
    const file = e.dataTransfer.files[0]
    if (file) processCVFile(file)
  })
  inp.addEventListener('change', () => {
    if (inp.files[0]) processCVFile(inp.files[0])
  })

  document.getElementById('cvTextarea').addEventListener('input', function() {
    cvText = this.value.trim()
    if (cvText) document.getElementById('cvFileName').style.display = 'none'
  })
}

async function processCVFile(file) {
  const name  = file.name.toLowerCase()
  const label = document.getElementById('cvFileName')

  label.textContent = `📄 ${file.name} — extraindo texto...`
  label.style.display = 'block'
  cvPdfBase64 = null

  try {
    if (name.endsWith('.pdf')) {
      cvText = await extractPDF(file)
      // Guarda PDF original em base64 para download posterior pelo gestor
      cvPdfBase64 = await fileToBase64(file)
    } else if (name.endsWith('.docx')) {
      cvText = await extractDOCX(file)
    } else {
      cvText = await file.text()
    }
    // PDF digitalizado/foto (sem texto selecionável): quase nada extraído aqui — o
    // servidor tenta OCR automaticamente no envio, então não bloqueamos nem alarmamos.
    if (name.endsWith('.pdf') && cvText.length < 80) {
      label.textContent = `📄 ${file.name} (parece digitalizado — será processado ao enviar)`
    } else {
      label.textContent = `✓ ${file.name} (${Math.round(cvText.length / 100) / 10}k chars)`
    }
    document.getElementById('cvTextarea').value = cvText
  } catch (err) {
    label.textContent = `⚠ Erro ao ler ${file.name}. Cole o texto abaixo.`
    cvText = ''
    cvPdfBase64 = null
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result.split(',')[1]) // remove "data:...;base64,"
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function extractPDF(file) {
  await loadPDFJS()
  const lib = window['pdfjs-dist/build/pdf']
  const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise
  let text  = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i)
    const content = await page.getTextContent()
    text += content.items.map(item => item.str).join(' ') + '\n'
  }
  return text.trim()
}

async function extractDOCX(file) {
  // Simple extraction: try mammoth if loaded, else raw text
  if (window.mammoth) {
    const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return result.value
  }
  return await file.text()
}

// ── Submit ────────────────────────────────────────────────────────────────────
async function submitForm() {
  const nome      = document.getElementById('formNome').value.trim()
  const telefone  = document.getElementById('formTelefone').value.trim()
  const email     = document.getElementById('formEmail').value.trim()
  const textareaCV = document.getElementById('cvTextarea').value.trim()
  const finalCV   = cvText || textareaCV

  // Clear errors
  document.getElementById('formError').classList.remove('show')
  ;['formNome','formTelefone','cvTextarea'].forEach(id =>
    document.getElementById(id)?.classList.remove('error'))

  // Validate — PDF digitalizado sem texto selecionável ainda tem cvPdfBase64;
  // o servidor tenta OCR no envio, então não bloqueamos aqui.
  let errMsg = ''
  if (!nome)       { errMsg = 'Por favor, informe seu nome completo.'; markError('formNome') }
  else if (!telefone || telefone.replace(/\D/g,'').length < 10) {
    errMsg = 'Por favor, informe um telefone válido (com DDD).'
    markError('formTelefone')
  } else if (!finalCV && !cvPdfBase64) {
    errMsg = 'Por favor, envie seu currículo (arquivo ou cole o texto).'
    markError('cvTextarea')
  }

  if (errMsg) return showFormError(errMsg)

  // Dispara ANTES do fetch real: garante o registro mesmo se o backend cair aqui.
  backupToSheets({ vagaId: selectedVaga.id, nome, phone: telefone })

  // Collect answers
  const perguntas = selectedVaga?.perguntas || []
  const answers   = perguntas.map((q, i) => ({
    pergunta: q,
    resposta: document.getElementById(`qresp-${i}`)?.value.trim() || '',
  }))

  const btn = document.getElementById('btnSubmit')
  btn.disabled = true
  btn.textContent = 'Enviando...'

  try {
    const d = await submitToServer({
      vagaId:   selectedVaga.id,
      nome,
      telefone,
      email:    email || undefined,
      cvText:   finalCV,
      cvPdf:    cvPdfBase64 || undefined,
      answers,
    }, n => { btn.textContent = `Tentando novamente... (${n}/3)` })

    if (!d.ok) {
      showFormError(d.error || 'Erro ao enviar candidatura.')
      btn.disabled = false
      btn.textContent = 'Enviar candidatura →'
      return
    }

    goStep(3)
  } catch (err) {
    showFormError('Erro de conexão. O servidor pode estar iniciando — aguarde 30 segundos e clique em "Enviar candidatura" novamente.')
    btn.disabled = false
    btn.textContent = 'Enviar candidatura →'
  }
}

// Reenvia com backoff (Render Free pode estar acordando) — numa retentativa, um
// "já se candidatou" (409) costuma significar que a tentativa anterior teve sucesso
// no servidor mas a resposta se perdeu na rede, não um duplicado de verdade.
async function submitToServer(payload, onRetry, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 20000)
      const r = await fetch('/api/candidatos/submit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  controller.signal,
      })
      clearTimeout(timeout)
      const d = await r.json()
      if (d.ok) return d
      if (attempt > 1 && r.status === 409) return { ok: true }
      return d
    } catch (err) {
      if (attempt === maxAttempts) throw err
      onRetry?.(attempt + 1)
      await new Promise(res => setTimeout(res, attempt * 5000))
    }
  }
}

function markError(id) {
  document.getElementById(id)?.classList.add('error')
}

function showFormError(msg) {
  const el = document.getElementById('formError')
  el.textContent = msg
  el.classList.add('show')
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return (s || '').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ── Setup CV drop after DOM is ready ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', setupCVDrop)
if (document.readyState !== 'loading') setupCVDrop()

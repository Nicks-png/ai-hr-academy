'use strict'

const PDFJS_CDN    = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
let pdfLoaded = false
let vagaData  = null
let cvText    = ''
let cvPdfBase64 = null

// ── Init ──────────────────────────────────────────────────────────────────────
;(async () => {
  // Extrai o ID da vaga do path: /vaga/recepcionista
  const id = location.pathname.split('/').filter(Boolean).pop()
  if (!id) return showNotFound()

  show('stateLoading')

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 12000)
      const resp = await fetch(`/api/vaga-pub/${encodeURIComponent(id)}`, { signal: controller.signal })
      clearTimeout(timeout)

      if (resp.status === 404) return showNotFound()
      if (!resp.ok) throw new Error('Servidor indisponível')
      vagaData = await resp.json()
      renderVaga(vagaData)
      return
    } catch (err) {
      if (err.name === 'AbortError' || attempt < 4) {
        const msgEl = document.querySelector('#stateLoading p')
        if (msgEl) msgEl.textContent = `⏳ Conectando ao servidor... aguarde (tentativa ${attempt}/3)`
        await sleep(attempt * 4000)
      } else {
        showNotFound()
      }
    }
  }
})()

function renderVaga(v) {
  document.title = `${v.titulo} — Pullman Ibirapuera`

  // Badge
  if (v.status === 'paused') {
    show('vagaBadgePaused')
  } else {
    show('vagaBadge')
  }

  // Hero
  document.getElementById('vagaMarca').textContent    = v.marca || ''
  document.getElementById('vagaTitulo').textContent   = v.titulo || ''
  document.getElementById('vagaDescricao').textContent = v.descricao || ''

  // Ícone baseado no cargo
  const icons = { chef: '🍳', camareira: '🛏️', gerente: '🏢', garcom: '🍽️',
                  manutencao: '🔧', trainee: '🎓', steward: '🧹' }
  const icon  = Object.entries(icons).find(([k]) => v.id?.includes(k))?.[1] || '🏨'
  document.getElementById('vagaIcon').textContent = icon

  // Diferenciais
  const difArr = v.diferenciais || []
  if (difArr.length) {
    document.getElementById('vagaDiferenciais').innerHTML = difArr.map(d => `<li>${esc(d)}</li>`).join('')
    show('sDiferenciais')
  }

  // Se pausada: esconde botão de candidatura
  if (v.status === 'paused') {
    document.getElementById('ctaSection').style.display = 'none'
  }

  show('stateContent')
  hide('stateLoading')

  setupCVDrop()
}

function showNotFound() {
  hide('stateLoading')
  show('stateNotFound')
}

// ── Revelar formulário ────────────────────────────────────────────────────────
function showForm() {
  hide('ctaSection')
  show('formSection')

  // Renderizar perguntas
  const perguntas = vagaData?.perguntas || []
  const container = document.getElementById('questionsContainer')
  const section   = document.getElementById('questionSection')
  if (perguntas.length) {
    container.innerHTML = perguntas.map((q, i) => `
      <div class="question-block">
        <div class="question-num">Pergunta ${i + 1}</div>
        <div class="question-text">${esc(q)}</div>
        <textarea class="field-input" id="qresp-${i}" placeholder="Escreva sua resposta aqui..." rows="3"></textarea>
      </div>
    `).join('')
    section.style.display = 'block'
  }

  document.getElementById('formSection').scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// ── Submit ────────────────────────────────────────────────────────────────────
async function submitForm() {
  const nome      = document.getElementById('formNome').value.trim()
  const telefone  = document.getElementById('formTelefone').value.trim()
  const email     = document.getElementById('formEmail').value.trim()
  const textareaCV = document.getElementById('cvTextarea').value.trim()
  const finalCV   = cvText || textareaCV

  document.getElementById('formError').classList.remove('show')
  ;['formNome','formTelefone','cvTextarea'].forEach(id =>
    document.getElementById(id)?.classList.remove('error'))

  let errMsg = ''
  if (!nome) {
    errMsg = 'Por favor, informe seu nome completo.'; markError('formNome')
  } else if (!telefone || telefone.replace(/\D/g,'').length < 10) {
    errMsg = 'Por favor, informe um telefone válido (com DDD).'; markError('formTelefone')
  } else if (!finalCV) {
    errMsg = 'Por favor, envie seu currículo (arquivo ou cole o texto).'; markError('cvTextarea')
  }
  if (errMsg) return showFormError(errMsg)

  const perguntas = vagaData?.perguntas || []
  const answers   = perguntas.map((q, i) => ({
    pergunta: q,
    resposta: document.getElementById(`qresp-${i}`)?.value.trim() || '',
  }))

  const btn = document.getElementById('btnSubmit')
  btn.disabled = true
  btn.textContent = 'Enviando...'

  try {
    const r = await fetch('/api/candidatos/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        vagaId:   vagaData.id,
        nome, telefone,
        email:    email || undefined,
        cvText:   finalCV,
        cvPdf:    cvPdfBase64 || undefined,
        answers,
      }),
    })
    const d = await r.json()

    if (!d.ok) {
      showFormError(d.error || 'Erro ao enviar candidatura.')
      btn.disabled = false
      btn.textContent = 'Enviar candidatura →'
      return
    }

    hide('formSection')
    show('successSection')
    document.getElementById('successSection').scrollIntoView({ behavior: 'smooth' })
  } catch {
    showFormError('Erro de conexão. Aguarde 30 segundos e tente novamente.')
    btn.disabled = false
    btn.textContent = 'Enviar candidatura →'
  }
}

// ── CV Upload ─────────────────────────────────────────────────────────────────
function setupCVDrop() {
  const drop = document.getElementById('cvDrop')
  const inp  = document.getElementById('cvFileInput')

  drop.addEventListener('click', () => inp.click())
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag-over') })
  drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'))
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('drag-over')
    if (e.dataTransfer.files[0]) processCVFile(e.dataTransfer.files[0])
  })
  inp.addEventListener('change', () => { if (inp.files[0]) processCVFile(inp.files[0]) })

  document.getElementById('cvTextarea').addEventListener('input', function () {
    cvText = this.value.trim()
    if (cvText) document.getElementById('cvFileName').style.display = 'none'
  })
}

async function processCVFile(file) {
  const label = document.getElementById('cvFileName')
  label.innerHTML = `<span class="cv-file-icon">📄</span><span class="cv-file-name">${file.name}</span><span class="cv-file-loading">lendo...</span>`
  label.style.display = 'flex'
  cvPdfBase64 = null
  cvText = ''

  try {
    const name = file.name.toLowerCase()
    if (name.endsWith('.pdf')) {
      cvText = await extractPDF(file)
      cvPdfBase64 = await fileToBase64(file)
    } else {
      cvText = await file.text()
    }
    label.innerHTML = `<span class="cv-file-icon">📄</span><span class="cv-file-name">${file.name}</span><span class="cv-file-ok">✓ anexado</span>`
  } catch {
    label.innerHTML = `<span class="cv-file-icon">⚠️</span><span class="cv-file-name">${file.name}</span><span class="cv-file-err">erro ao ler — cole o texto abaixo</span>`
    cvText = ''
    cvPdfBase64 = null
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function extractPDF(file) {
  if (!pdfLoaded) {
    await loadScript(PDFJS_CDN)
    window['pdfjs-dist/build/pdf'].GlobalWorkerOptions.workerSrc = PDFJS_WORKER
    pdfLoaded = true
  }
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

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src; s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function show(id) {
  const el = document.getElementById(id)
  if (el) el.style.display = ''
}
function hide(id) {
  const el = document.getElementById(id)
  if (el) el.style.display = 'none'
}
function markError(id) { document.getElementById(id)?.classList.add('error') }
function showFormError(msg) {
  const el = document.getElementById('formError')
  el.textContent = msg; el.classList.add('show')
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}
function esc(s) {
  return (s || '').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

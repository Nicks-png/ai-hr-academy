'use strict'

// ── State ─────────────────────────────────────────────────────────────────────
let vagas           = []
let selectedVaga    = null   // { id, titulo, perguntas[] }
let videoRecordings = {}     // index → { blob, url, stream }
let cvText          = ''
let cvPdfBase64     = null   // PDF original em base64 (sem prefixo data:...)
let currentStep     = 1

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
  await loadVagas()
  // Auto-selecionar vaga via query param (?vaga=VAGA_ID)
  const preVaga = new URLSearchParams(window.location.search).get('vaga')
  if (preVaga) {
    const found = vagas.find(v => v.id === preVaga)
    if (found) selectVaga(found.id)
  }
})()

// ── Load vagas ────────────────────────────────────────────────────────────────
async function loadVagas() {
  const grid = document.getElementById('vagasGrid')
  grid.innerHTML = '<div class="vagas-loading">Carregando vagas...</div>'
  try {
    vagas = await fetch('/api/vagas-public').then(r => r.json())
    renderVagaCards()
  } catch {
    grid.innerHTML = '<div class="vagas-loading">Erro ao carregar vagas. Tente novamente.</div>'
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
        <span class="vaga-pill">${esc(v.salario)}</span>
        <span class="vaga-pill regime">${esc(v.regime)}</span>
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
  videoRecordings = {}
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
      <div class="question-actions">
        <button type="button" class="btn-video" id="btnVideo-${i}" onclick="toggleVideo(${i})">
          🎥 Gravar vídeo resposta (opcional)
        </button>
        <span class="video-timer" id="timer-${i}">
          <span class="timer-dot"></span>
          <span id="timerCount-${i}">0:60</span>
        </span>
      </div>
      <div class="video-preview" id="vpreview-${i}">
        <video id="video-${i}" controls></video>
        <div class="video-meta">Vídeo gravado ✓ · disponível nesta sessão</div>
        <button type="button" class="btn-video" style="margin-top:6px" onclick="regravVideo(${i})">↺ Regravar</button>
      </div>
    </div>
  `).join('')
}

// ── Video recording ───────────────────────────────────────────────────────────
async function toggleVideo(i) {
  const rec = videoRecordings[i]
  if (rec?.recorder?.state === 'recording') {
    stopVideoRecording(i)
  } else {
    await startVideoRecording(i)
  }
}

async function startVideoRecording(i) {
  const btn = document.getElementById(`btnVideo-${i}`)
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    const recorder = new MediaRecorder(stream)
    const chunks   = []

    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop())
      const blob = new Blob(chunks, { type: 'video/webm' })
      const url  = URL.createObjectURL(blob)
      videoRecordings[i] = { blob, url }

      const preview = document.getElementById(`vpreview-${i}`)
      const video   = document.getElementById(`video-${i}`)
      video.src     = url
      preview.style.display = 'block'

      btn.textContent = '🎥 Gravar vídeo resposta (opcional)'
      btn.classList.remove('recording')
      stopTimer(i)
    }

    videoRecordings[i] = { recorder, stream }
    recorder.start()
    btn.textContent = '⏹ Parar gravação'
    btn.classList.add('recording')
    startTimer(i, 60, () => stopVideoRecording(i))
  } catch (err) {
    showFormError('Câmera não disponível: ' + (err.message || 'permissão negada.'))
  }
}

function stopVideoRecording(i) {
  const rec = videoRecordings[i]
  if (rec?.recorder?.state === 'recording') rec.recorder.stop()
}

function regravVideo(i) {
  if (videoRecordings[i]?.url) URL.revokeObjectURL(videoRecordings[i].url)
  delete videoRecordings[i]
  document.getElementById(`vpreview-${i}`).style.display = 'none'
  document.getElementById(`video-${i}`).src = ''
}

// ── Timer ─────────────────────────────────────────────────────────────────────
let timerIntervals = {}

function startTimer(i, seconds, onEnd) {
  let remaining = seconds
  const display = document.getElementById(`timerCount-${i}`)
  const timerEl = document.getElementById(`timer-${i}`)
  timerEl.classList.add('active')

  timerIntervals[i] = setInterval(() => {
    remaining--
    const m = Math.floor(remaining / 60)
    const s = remaining % 60
    display.textContent = `${m}:${s.toString().padStart(2, '0')}`
    if (remaining <= 0) { stopTimer(i); onEnd?.() }
  }, 1000)
}

function stopTimer(i) {
  clearInterval(timerIntervals[i])
  delete timerIntervals[i]
  const timerEl = document.getElementById(`timer-${i}`)
  if (timerEl) timerEl.classList.remove('active')
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
    label.textContent = `✓ ${file.name} (${Math.round(cvText.length / 100) / 10}k chars)`
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

  // Validate
  let errMsg = ''
  if (!nome)       { errMsg = 'Por favor, informe seu nome completo.'; markError('formNome') }
  else if (!telefone || telefone.replace(/\D/g,'').length < 10) {
    errMsg = 'Por favor, informe um telefone válido (com DDD).'
    markError('formTelefone')
  } else if (!finalCV) {
    errMsg = 'Por favor, envie seu currículo (arquivo ou cole o texto).'
    markError('cvTextarea')
  }

  if (errMsg) return showFormError(errMsg)

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
    const r = await fetch('/api/candidatos/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vagaId:   selectedVaga.id,
        nome,
        telefone,
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

    // Stop any active recordings
    Object.keys(videoRecordings).forEach(i => {
      if (videoRecordings[i]?.recorder?.state === 'recording')
        videoRecordings[i].recorder.stop()
    })

    goStep(3)
  } catch (err) {
    showFormError('Erro de conexão. Verifique sua internet e tente novamente.')
    btn.disabled = false
    btn.textContent = 'Enviar candidatura →'
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

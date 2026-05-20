'use strict'

let vagasData    = []
let qrInstance   = null
let qrVagaId     = null

// ── Auth guard ────────────────────────────────────────────────────────────────
;(async () => {
  if (typeof requireAuth === 'function') requireAuth()
  await checkAPI()
  await load()
  setupUploadDrop()
})()

async function checkAPI() {
  try {
    const d = await fetch('/api/status').then(r => r.json())
    const dot = document.getElementById('apiDot')
    const txt = document.getElementById('apiTxt')
    if (dot) dot.style.background = d.ok ? 'var(--green)' : 'var(--amber)'
    if (txt) txt.textContent = d.ok ? d.provider : 'sem IA'
  } catch {}
}

// ── Load vagas ────────────────────────────────────────────────────────────────
async function load() {
  const list = document.getElementById('vagasList')
  list.innerHTML = '<div class="va-loading">Carregando vagas...</div>'

  try {
    const headers = typeof authHeaders === 'function' ? authHeaders() : {}
    const rows    = await fetch('/api/vagas/manage', { headers }).then(r => {
      if (r.status === 401) { location.href = 'login.html'; return [] }
      return r.json()
    })
    vagasData = Array.isArray(rows) ? rows : []
    renderStats()
    renderVagas()
  } catch (err) {
    list.innerHTML = `<div class="va-loading">Erro ao carregar vagas: ${err.message}</div>`
  }
}

function renderStats() {
  const stats = document.getElementById('vaStats')
  const ativas   = vagasData.filter(v => v.status === 'active').length
  const pausadas = vagasData.filter(v => v.status === 'paused').length
  const totalCand = vagasData.reduce((s, v) => s + (v.candidatos || 0), 0)
  stats.innerHTML = `
    <div class="va-stat"><div class="va-stat-val">${vagasData.length}</div><div class="va-stat-lbl">Total de vagas</div></div>
    <div class="va-stat"><div class="va-stat-val green">${ativas}</div><div class="va-stat-lbl">Ativas</div></div>
    <div class="va-stat"><div class="va-stat-val amber">${pausadas}</div><div class="va-stat-lbl">Pausadas</div></div>
    <div class="va-stat"><div class="va-stat-val" style="-webkit-text-fill-color:var(--purple);background:none">${totalCand}</div><div class="va-stat-lbl">Candidatos orgânicos</div></div>
  `
}

function renderVagas() {
  const list = document.getElementById('vagasList')
  if (!vagasData.length) {
    list.innerHTML = '<div class="va-loading">Nenhuma vaga cadastrada ainda. Clique em "+ Nova Vaga" para começar.</div>'
    return
  }
  list.innerHTML = vagasData.map(v => vagaCard(v)).join('')
}

function vagaCard(v) {
  const isActive = v.status === 'active'
  const scoreStr = v.score_medio ? `Score médio: <strong>${v.score_medio}</strong>` : 'Score: —'
  return `
    <div class="vg-card${isActive ? '' : ' paused'}" id="vgcard-${v.id}">
      <div class="vg-card-top">
        <div class="vg-card-info">
          <div class="vg-card-marca">${esc(v.marca || '')}</div>
          <div class="vg-card-titulo">${esc(v.titulo)}</div>
          <div class="vg-card-pills">
            <span class="vg-pill salary">${esc(v.salario || '—')}</span>
            <span class="vg-pill regime">${esc(v.regime || '—')}</span>
          </div>
        </div>
        <div class="vg-status">
          <div class="status-badge ${isActive ? 'active' : 'paused'}"
               onclick="toggleStatus('${v.id}')" title="Clique para ${isActive ? 'pausar' : 'ativar'}">
            <span class="status-dot"></span>
            ${isActive ? 'Ativa' : 'Pausada'}
          </div>
        </div>
      </div>
      <div class="vg-card-stats">
        <div class="vg-stat">
          <span>📥 Candidatos: <strong>${v.candidatos || 0}</strong></span>
          <span style="margin-left:14px">${scoreStr}</span>
        </div>
        <div class="vg-actions">
          <button class="vg-btn" onclick="openQR('${v.id}', '${esc(v.titulo)}')">📷 QR / Link</button>
          <button class="vg-btn" onclick="openEdit('${v.id}')">✏️ Editar</button>
          <button class="vg-btn danger" onclick="openDelete('${v.id}', '${esc(v.titulo)}')">🗑️</button>
        </div>
      </div>
    </div>
  `
}

// ── Toggle status ─────────────────────────────────────────────────────────────
async function toggleStatus(id) {
  try {
    const headers = { 'Content-Type': 'application/json', ...authHeaders() }
    const r = await fetch(`/api/vagas/${id}/status`, { method: 'PATCH', headers })
    const d = await r.json()
    if (!r.ok) return toast(d.error || 'Erro ao alterar status', 'error')
    const idx = vagasData.findIndex(v => v.id === id)
    if (idx !== -1) {
      vagasData[idx].status = d.status
      document.getElementById('vagasList').innerHTML = vagasData.map(v => vagaCard(v)).join('')
      renderStats()
    }
    toast(d.status === 'active' ? 'Vaga ativada' : 'Vaga pausada')
  } catch { toast('Erro de conexão', 'error') }
}

// ── QR code ───────────────────────────────────────────────────────────────────
function openQR(id, titulo) {
  qrVagaId = id
  document.getElementById('qrVagaTitulo').textContent = titulo

  const qrEl = document.getElementById('qrCanvas')
  qrEl.innerHTML = ''

  const url = `${location.origin}/vaga/${id}`
  document.getElementById('qrLink').textContent = url

  try {
    qrInstance = new QRCode(qrEl, {
      text:       url,
      width:      200,
      height:     200,
      colorDark:  '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M,
    })
  } catch (e) {
    qrEl.innerHTML = '<p style="color:var(--red);font-size:.8rem">Erro ao gerar QR. Recarregue a página.</p>'
  }

  openModal('modalQR')
}

function copyLink() {
  const url = `${location.origin}/vaga/${qrVagaId}`
  navigator.clipboard.writeText(url)
    .then(() => toast('Link copiado!'))
    .catch(() => toast('Erro ao copiar', 'error'))
}

function downloadQR() {
  const canvas = document.querySelector('#qrCanvas canvas')
  if (!canvas) return toast('QR ainda não gerado', 'error')
  const link = document.createElement('a')
  link.download = `qr-${qrVagaId}.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}

// ── Nova vaga: upload e extração ──────────────────────────────────────────────
function setupUploadDrop() {
  const drop = document.getElementById('uploadDrop')
  const inp  = document.getElementById('pdfInput')
  if (!drop || !inp) return

  drop.addEventListener('click', () => inp.click())
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag-over') })
  drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'))
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('drag-over')
    if (e.dataTransfer.files[0]) processUpload(e.dataTransfer.files[0])
  })
  inp.addEventListener('change', () => { if (inp.files[0]) processUpload(inp.files[0]) })
}

async function processUpload(file) {
  const drop = document.getElementById('uploadDrop')
  drop.querySelector('.upload-drop-label').textContent = `📄 ${file.name} — lendo...`

  try {
    let texto
    if (file.name.toLowerCase().endsWith('.pdf')) {
      texto = await extractPDFText(file)
    } else {
      texto = await file.text()
    }
    document.getElementById('textoVaga').value = texto
    drop.querySelector('.upload-drop-label').textContent = `✓ ${file.name} carregado`
  } catch {
    drop.querySelector('.upload-drop-label').textContent = 'Erro ao ler arquivo. Cole o texto manualmente.'
  }
}

async function extrairVaga() {
  const texto = document.getElementById('textoVaga').value.trim()
  if (!texto) return toast('Insira o texto ou faça upload de um PDF.', 'error')

  const btn = document.getElementById('btnExtract')
  btn.disabled = true
  btn.textContent = '⏳ Extraindo...'

  try {
    const r = await fetch('/api/vagas/extract', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body:    JSON.stringify({ texto }),
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error || 'Erro na extração')

    // Preenche os campos de revisão
    document.getElementById('rId').value      = d.id_sugerido || ''
    document.getElementById('rTitulo').value  = d.titulo      || ''
    document.getElementById('rMarca').value   = d.marca       || ''
    document.getElementById('rSalario').value = d.salario     || ''
    document.getElementById('rRegime').value  = d.regime      || ''
    document.getElementById('rDescricao').value = d.descricao || ''

    fillListEditor('edRequisitos',   d.requisitos   || [])
    fillListEditor('edDiferenciais', d.diferenciais || [])
    fillListEditor('edPerguntas',    d.perguntas    || [])

    goNovaStep(2)
  } catch (err) {
    toast(err.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = 'Extrair com IA →'
  }
}

function goNovaStep(n) {
  document.getElementById('novaStep1').style.display = n === 1 ? '' : 'none'
  document.getElementById('novaStep2').style.display = n === 2 ? '' : 'none'
  document.getElementById('mstep1').className = n === 1 ? 'mstep active' : 'mstep'
  document.getElementById('mstep2').className = n === 2 ? 'mstep active' : 'mstep'
}

async function publicarVaga() {
  const id         = document.getElementById('rId').value.trim().toLowerCase().replace(/\s+/g, '-')
  const titulo     = document.getElementById('rTitulo').value.trim()
  const marca      = document.getElementById('rMarca').value.trim()
  const salario    = document.getElementById('rSalario').value.trim()
  const regime     = document.getElementById('rRegime').value.trim()
  const descricao  = document.getElementById('rDescricao').value.trim()
  const requisitos  = getListItems('edRequisitos')
  const diferenciais = getListItems('edDiferenciais')
  const perguntas  = getListItems('edPerguntas')

  if (!id || !titulo || !salario || !regime || !requisitos.length) {
    return toast('Preencha os campos obrigatórios: ID, Título, Salário, Regime e ao menos 1 Requisito.', 'error')
  }

  try {
    const r = await fetch('/api/vagas', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body:    JSON.stringify({ id, titulo, marca, descricao, requisitos, diferenciais, competencias: [], salario, regime, perguntas }),
    })
    const d = await r.json()
    if (!r.ok) return toast(d.error || 'Erro ao publicar.', 'error')
    toast('Vaga publicada com sucesso!')
    closeModal('modalNova')
    resetNovaModal()
    await load()
  } catch { toast('Erro de conexão.', 'error') }
}

function resetNovaModal() {
  document.getElementById('textoVaga').value = ''
  document.getElementById('uploadDrop').querySelector('.upload-drop-label').textContent =
    'Arraste o PDF do cargo ou clique para selecionar'
  goNovaStep(1)
}

// ── Editar vaga ───────────────────────────────────────────────────────────────
function openEdit(id) {
  const v = vagasData.find(x => x.id === id)
  if (!v) return

  document.getElementById('editId').value      = v.id
  document.getElementById('eTitulo').value     = v.titulo    || ''
  document.getElementById('eMarca').value      = v.marca     || ''
  document.getElementById('eSalario').value    = v.salario   || ''
  document.getElementById('eRegime').value     = v.regime    || ''
  document.getElementById('eDescricao').value  = v.descricao || ''

  fillListEditor('edERequisitos',   Array.isArray(v.requisitos)   ? v.requisitos   : [])
  fillListEditor('edEDiferenciais', Array.isArray(v.diferenciais) ? v.diferenciais : [])
  fillListEditor('edEPerguntas',    Array.isArray(v.perguntas)    ? v.perguntas    : [])

  openModal('modalEditar')
}

async function salvarEdicao() {
  const id = document.getElementById('editId').value
  const body = {
    titulo:      document.getElementById('eTitulo').value.trim(),
    marca:       document.getElementById('eMarca').value.trim(),
    salario:     document.getElementById('eSalario').value.trim(),
    regime:      document.getElementById('eRegime').value.trim(),
    descricao:   document.getElementById('eDescricao').value.trim(),
    requisitos:   getListItems('edERequisitos'),
    diferenciais: getListItems('edEDiferenciais'),
    perguntas:    getListItems('edEPerguntas'),
  }
  if (!body.titulo) return toast('Título é obrigatório.', 'error')

  try {
    const r = await fetch(`/api/vagas/${id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body:    JSON.stringify(body),
    })
    const d = await r.json()
    if (!r.ok) return toast(d.error || 'Erro ao salvar.', 'error')
    toast('Vaga atualizada!')
    closeModal('modalEditar')
    await load()
  } catch { toast('Erro de conexão.', 'error') }
}

// ── Excluir vaga ──────────────────────────────────────────────────────────────
function openDelete(id, titulo) {
  document.getElementById('deleteId').value = id
  document.getElementById('deleteTitulo').textContent = titulo
  openModal('modalDelete')
}

async function confirmarExclusao() {
  const id = document.getElementById('deleteId').value
  try {
    const r = await fetch(`/api/vagas/${id}`, {
      method:  'DELETE',
      headers: authHeaders(),
    })
    if (!r.ok) { const d = await r.json(); return toast(d.error || 'Erro.', 'error') }
    toast('Vaga excluída.')
    closeModal('modalDelete')
    await load()
  } catch { toast('Erro de conexão.', 'error') }
}

// ── List editor helpers ───────────────────────────────────────────────────────
function fillListEditor(editorId, items) {
  const container = document.getElementById(editorId + 'Items')
  container.innerHTML = ''
  for (const item of items) addItem(editorId, item)
  if (!items.length) addItem(editorId)
}

function addItem(editorId, value = '') {
  const container = document.getElementById(editorId + 'Items')
  const div = document.createElement('div')
  div.className = 'list-item'
  div.innerHTML = `
    <input type="text" value="${esc(value)}" placeholder="Digite aqui..."/>
    <button class="btn-remove-item" onclick="this.closest('.list-item').remove()">✕</button>
  `
  container.appendChild(div)
  if (!value) div.querySelector('input').focus()
}

function getListItems(editorId) {
  const inputs = document.querySelectorAll(`#${editorId}Items .list-item input`)
  return Array.from(inputs).map(i => i.value.trim()).filter(Boolean)
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open')
  document.body.style.overflow = 'hidden'
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open')
  document.body.style.overflow = ''
}
function closeOnOverlay(event, id) {
  if (event.target === document.getElementById(id)) closeModal(id)
}

// ── PDF extract helper ────────────────────────────────────────────────────────
const PDFJS_CDN    = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
let pdfLoaded = false

async function extractPDFText(file) {
  if (!pdfLoaded) {
    await loadScript(PDFJS_CDN)
    window['pdfjs-dist/build/pdf'].GlobalWorkerOptions.workerSrc = PDFJS_WORKER
    pdfLoaded = true
  }
  const lib = window['pdfjs-dist/build/pdf']
  const pdf  = await lib.getDocument({ data: await file.arrayBuffer() }).promise
  let text   = ''
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

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.className   = type === 'error' ? 'err show' : 'show'
  clearTimeout(el._t)
  el._t = setTimeout(() => { el.className = '' }, 3200)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function authHeaders() {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}
function esc(s) {
  return (s || '').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

'use strict'

if (typeof requireAuth === 'function' && !requireAuth('triagem')) throw new Error('not auth')

// ─── PDF.js worker ───────────────────────────────────────────────────────────
if (typeof pdfjsLib !== 'undefined')
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

// ─── State ───────────────────────────────────────────────────────────────────
const S = {
  step:        1,
  vagaId:      null,
  vagaData:    null,
  cands:       [],    // [{id, nome, curriculo, fileName}]
  resultados:  [],    // resultados da IA
  shortlist:   new Set(),
  dispensados: new Set(),
  nextCandId:  0,
}

const SCHED = { date: '', startTime: '08:00', numSlots: 5 }

// ─── Outlook Calendar ─────────────────────────────────────────────────────────
const OUTLOOK = {
  slots:    [],     // [{ id, start, end, label }]
  assigned: {},     // { resultadoIdx: slotId }

  _stored() {
    try { return JSON.parse(localStorage.getItem('aihr_outlook') || 'null') } catch { return null }
  },

  init() {
    const stored  = this._stored()
    const tokenOk = !!(stored && stored.accessToken &&
                       String(stored.accessToken).includes('.') &&
                       (!stored.expiresAt || Date.now() < stored.expiresAt - 60_000))
    if (!tokenOk) {
      if (stored) localStorage.removeItem('aihr_outlook') // limpa token ruim/expirado
      return
    }
    document.getElementById('outlookSection').style.display = 'block'
    this._updateUI()
    this._bindControls()
  },

  _bindControls() {
    document.getElementById('btnBuscarSlots')?.addEventListener('click', () => this.fetchSlots())
  },

  _updateUI() {
    const stored    = this._stored()
    const tokenOk   = !!(stored && stored.accessToken &&
                        String(stored.accessToken).includes('.') &&
                        (!stored.expiresAt || Date.now() < stored.expiresAt - 60_000))
    const connected = tokenOk
    const bar       = document.getElementById('outlookStatusBar')
    const panel     = document.getElementById('outlookSearchPanel')
    if (bar) {
      if (connected) {
        const user = stored.username || 'conta Microsoft'
        bar.innerHTML = `<span class="ol-check">&#10003;</span><span class="ol-username">Outlook: ${esc(user)}</span><a href="intranet.html" class="ol-hub-link">Gerenciar &rarr;</a>`
      } else {
        bar.innerHTML = '<span class="ol-disc-dot"></span><span class="ol-not-conn">Outlook não conectado</span><a href="intranet.html" class="ol-hub-link">Conectar no Hub &rarr;</a>'
      }
    }
    if (panel) panel.style.display = connected ? 'block' : 'none'
  },

  reset() {
    this.slots    = []
    this.assigned = {}
    this._renderSlots()
    this._refreshPickers()
  },

  async _getToken() {
    const stored = this._stored()
    if (!stored || !stored.accessToken) throw new Error('Outlook não conectado — conecte no Hub primeiro')

    // Token malformado (sem pontos) — forçar reconexão
    if (!String(stored.accessToken).includes('.')) {
      localStorage.removeItem('aihr_outlook')
      throw new Error('Token Outlook inválido — reconecte o Outlook no Hub para continuar')
    }

    // Token expirado — forçar reconexão
    if (stored.expiresAt && Date.now() > stored.expiresAt - 60_000) {
      localStorage.removeItem('aihr_outlook')
      throw new Error('Sessão Outlook expirada — reconecte o Outlook no Hub para continuar')
    }

    return stored.accessToken
  },

  async fetchSlots() {
    const fromVal  = document.getElementById('outlookFrom')?.value
    const toVal    = document.getElementById('outlookTo')?.value
    const startStr = document.getElementById('outlookStartHour')?.value || '09:00'
    const endStr   = document.getElementById('outlookEndHour')?.value   || '18:00'
    const duration = parseInt(document.getElementById('outlookDuration')?.value || '30')

    if (!fromVal || !toVal) { showToast('Defina o período.', true); return }

    const btn = document.getElementById('btnBuscarSlots')
    btn.disabled = true; btn.textContent = '⏳ Buscando...'

    try {
      const token   = await this._getToken()
      const startDT = new Date(fromVal + 'T00:00:00').toISOString()
      const endDT   = new Date(toVal   + 'T23:59:59').toISOString()

      const params = new URLSearchParams({
        startDateTime: startDT,
        endDateTime:   endDT,
        '$select':     'start,end,isCancelled',
        '$top':        '200',
      })
      const resp = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendarView?${params}`,
        { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="E. South America Standard Time"' } }
      )
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.error?.message || `HTTP ${resp.status}`)
      }
      const data = await resp.json()

      // Intervalos ocupados (horários no fuso retornado pelo Prefer header → tratar como local)
      const busy = (data.value || [])
        .filter(e => !e.isCancelled)
        .map(e => ({ s: new Date(e.start.dateTime), e: new Date(e.end.dateTime) }))

      const [sh, sm] = startStr.split(':').map(Number)
      const [eh, em] = endStr.split(':').map(Number)
      const startMin = sh * 60 + sm
      const endMin   = eh * 60 + em

      const cands = []
      const cur   = new Date(fromVal + 'T00:00:00')
      const last  = new Date(toVal   + 'T00:00:00')
      last.setHours(23, 59, 59)

      while (cur <= last) {
        const dow = cur.getDay()
        if (dow !== 0 && dow !== 6) {
          for (let m = startMin; m + duration <= endMin; m += duration) {
            const s = new Date(cur)
            s.setHours(Math.floor(m / 60), m % 60, 0, 0)
            const e = new Date(s)
            e.setMinutes(e.getMinutes() + duration)
            cands.push({ s, e })
          }
        }
        cur.setDate(cur.getDate() + 1)
      }

      const free = cands.filter(c => !busy.some(b => b.s < c.e && b.e > c.s))

      this.slots = free.slice(0, 40).map((c, i) => ({
        id: i, start: c.s, end: c.e, label: this._fmtSlot(c.s, c.e),
      }))

      this._renderSlots()
      this._refreshPickers()
      showToast(`✓ ${this.slots.length} horários livres encontrados`)
    } catch (e) {
      showToast('Erro ao buscar horários: ' + e.message, true)
    } finally {
      btn.disabled = false; btn.textContent = '🔍 Buscar horários livres'
    }
  },

  _fmtSlot(s, e) {
    const days = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']
    const p    = n => String(n).padStart(2, '0')
    return `${days[s.getDay()]} ${p(s.getDate())}/${p(s.getMonth()+1)} · ${p(s.getHours())}:${p(s.getMinutes())}–${p(e.getHours())}:${p(e.getMinutes())}`
  },

  _renderSlots() {
    const el = document.getElementById('outlookSlotList')
    if (!el) return
    if (!this.slots.length) { el.innerHTML = ''; return }
    const takenIds = new Set(Object.values(this.assigned))
    el.innerHTML = `
      <div class="ol-slot-header">${this.slots.length} hor&aacute;rios dispon&iacute;veis &mdash; <span style="font-weight:400;color:var(--text3)">clique para atribuir ao pr&oacute;ximo candidato</span></div>
      <div class="ol-slot-grid" id="olSlotGrid">
        ${this.slots.map(s => `<div class="ol-slot-chip${takenIds.has(s.id) ? ' taken' : ' free'}" data-slot-id="${s.id}" style="${takenIds.has(s.id) ? '' : 'cursor:pointer'}">${esc(s.label)}</div>`).join('')}
      </div>`
    el.querySelectorAll('.ol-slot-chip.free').forEach(chip => {
      chip.addEventListener('click', () => {
        const slotId = parseInt(chip.dataset.slotId)
        const pickers = document.querySelectorAll('[data-slot-picker]')
        const unassigned = [...pickers].find(w => {
          const i = parseInt(w.dataset.slotPicker)
          return this.assigned[i] === undefined
        })
        if (!unassigned) { showToast('Todos os candidatos já têm horário atribuído', true); return }
        const idx = parseInt(unassigned.dataset.slotPicker)
        this.assigned[idx] = slotId
        this._renderSlots()
        this._refreshPickers()
        showToast('Horário atribuído ao candidato #' + (idx + 1))
      })
    })
  },

  _refreshPickers() {
    document.querySelectorAll('[data-slot-picker]').forEach(wrap => {
      const idx = parseInt(wrap.dataset.slotPicker)
      wrap.innerHTML = this._pickerHTML(idx)
      const sel = wrap.querySelector('select')
      if (sel) sel.addEventListener('change', e => {
        const v = e.target.value
        if (v === '') delete this.assigned[idx]
        else this.assigned[idx] = parseInt(v)
        this._renderSlots()
      })
    })
  },

  _pickerHTML(idx) {
    if (!this.slots.length) return ''
    const cur     = this.assigned[idx]
    const options = this.slots.map(s => {
      const taken = Object.entries(this.assigned).some(([i, id]) => id === s.id && parseInt(i) !== idx)
      return `<option value="${s.id}"${cur === s.id ? ' selected' : ''}${taken ? ' disabled' : ''}>${esc(s.label)}${taken ? ' ✗' : ''}</option>`
    }).join('')
    return `<div class="ol-card-picker"><span class="ol-picker-label">&#128197; Entrevista</span><select class="ol-select"><option value="">Sem agendamento</option>${options}</select></div>`
  },

  getAssigned(idx) {
    const id = this.assigned[idx]
    return id !== undefined ? (this.slots.find(s => s.id === id) || null) : null
  },

  async createEvents(aprovados) {
    if (!this._stored()?.accessToken || !Object.keys(this.assigned).length) return
    try {
      const token = await this._getToken()
      for (const [idxStr, slotId] of Object.entries(this.assigned)) {
        const slot = this.slots.find(s => s.id === slotId)
        const cand = aprovados[parseInt(idxStr)]
        if (!slot || !cand) continue
        await fetch('https://graph.microsoft.com/v1.0/me/events', {
          method:  'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject: `Entrevista — ${cand.nome} · ${S.vagaData?.titulo || ''}`,
            start:   { dateTime: slot.start.toISOString(), timeZone: 'E. South America Standard Time' },
            end:     { dateTime: slot.end.toISOString(),   timeZone: 'E. South America Standard Time' },
            location:{ displayName: 'Rua Joinville, 515 - Vila Mariana' },
            body:    { contentType: 'text', content: `Candidato: ${cand.nome}\nVaga: ${S.vagaData?.titulo||''}\nScore: ${cand.scoreTotal}/100\nRecomendação: ${cand.recomendacao}` },
          }),
        })
      }
      showToast('✓ Eventos criados no Outlook')
    } catch (e) {
      showToast('Aviso: eventos não criados — ' + e.message, true)
    }
  },
}

const DIM_LABELS = {
  heartist:    'Cultura Heartist',
  tecnico:     'Competências Técnicas',
  estabilidade:'Estabilidade (Retenção)',
  experiencia: 'Experiência no Setor',
  potencial:   'Potencial de Dev.',
}

// ─── Init ────────────────────────────────────────────────────────────────────
;(async () => {
  checkStatus()
  loadVagas()
  addCand()
  bindNav()
  bindResults()
  initSchedule()
  await OUTLOOK.init()
  await renderHistory()

  // Prevent browser from navigating to files dropped outside designated drop zones
  document.addEventListener('dragover', e => e.preventDefault())
  document.addEventListener('drop',     e => e.preventDefault())

  // Warn before leaving the page when triagem is in progress
  window.addEventListener('beforeunload', e => {
    const temDados = S.cands.some(c => c.curriculo?.trim()) || S.resultados.length > 0
    if (temDados) {
      e.preventDefault()
      e.returnValue = ''
    }
  })
})()

// ─── API status ──────────────────────────────────────────────────────────────
async function checkStatus() {
  try {
    const d = await fetch('/api/status').then(r => r.json())
    document.getElementById('apiDot').className = `api-dot ${d.ok ? 'ok' : 'err'}`
    document.getElementById('apiStatusTxt').textContent = d.ok ? d.model : 'API Key ausente'
  } catch {
    document.getElementById('apiStatusTxt').textContent = 'servidor offline'
  }
}

// ─── Vagas ───────────────────────────────────────────────────────────────────
async function loadVagas() {
  try {
    const vagas = await fetch('/api/vagas').then(r => r.json())
    const grid  = document.getElementById('vagasGrid')
    grid.innerHTML = ''
    vagas.forEach(v => {
      const card = document.createElement('div')
      card.className  = 'vaga-card'
      card.dataset.id = v.id
      card.innerHTML  = `
        <div class="vcard-titulo">${v.titulo}</div>
        <div class="vcard-marca">${v.marca}</div>
        <span class="vcard-tag">${v.regime.split('\u00b7')[0].trim()}</span>
        <div class="vcard-salario">${v.salario}</div>`
      card.addEventListener('click', () => selectVaga(v.id))
      grid.appendChild(card)
    })
  } catch {
    document.getElementById('vagasGrid').innerHTML =
      '<div style="color:var(--red);font-size:.85rem">Erro — servidor offline. Rode: <b>npm start</b></div>'
  }
}

async function selectVaga(id) {
  S.vagaId = id
  document.querySelectorAll('.vaga-card').forEach(c =>
    c.classList.toggle('selected', c.dataset.id === id))
  try {
    const v = await fetch(`/api/vagas/${id}`).then(r => r.json())
    S.vagaData = v
    window.VOICE_CONTEXT = { page: 'triagem', vaga: v.titulo, step: 1, candidatos: S.cands.length }
    document.getElementById('vdTitulo').textContent = v.titulo
    document.getElementById('vdMarca').textContent  = v.marca
    document.getElementById('vdRegime').textContent = v.regime
    const vdDescEl = document.getElementById('vdDesc')
    if (vdDescEl) vdDescEl.textContent = v.descricao || ''
    const fill = (el, arr) => {
      document.getElementById(el).innerHTML = arr.map(t =>
        `<div class="vd-item">${esc(t)}</div>`).join('')
    }
    fill('vdReq',  v.requisitos)
    fill('vdDif',  v.diferenciais)
    fill('vdComp', v.competencias)
    document.getElementById('vagaDetalhe').classList.add('on')
    document.getElementById('btnNext1').disabled = false
  } catch { showAlert('Erro ao carregar vaga.') }
}

// ─── Nav binding ─────────────────────────────────────────────────────────────
function bindNav() {
  document.getElementById('btnNext1').addEventListener('click', () => goStep(2))
  document.getElementById('btnBack2').addEventListener('click', () => {
    goStep(1)
    if (S.cands.some(c => c.curriculo?.trim()))
      showToast('📌 Candidatos preservados — selecione a vaga e clique em Continuar')
  })
  document.getElementById('btnNext2').addEventListener('click', iniciarTriagem)
  document.getElementById('btnExport').addEventListener('click', openShortlistGeral)
  document.getElementById('btnExportXlsx').addEventListener('click', exportarExcel)
  document.getElementById('btnNova').addEventListener('click', novaTriagem)
  document.getElementById('btnAddCand').addEventListener('click', addCand)
  document.getElementById('btnImportOrganico').addEventListener('click', importOrganicCandidates)
  document.getElementById('btnAvancarComun').addEventListener('click', avancarComunicacao)
}

function goStep(n) {
  hideAlert()
  S.step = n
  ;[1,2,3].forEach(i => {
    document.getElementById(`s${i}`).classList.toggle('active', i === n)
    const sn = document.getElementById(`sn${i}`)
    sn.classList.toggle('active', i === n)
    sn.classList.toggle('done', i < n)
  })
  ;[1,2].forEach(i =>
    document.getElementById(`sc${i}`).classList.toggle('done', i < n))
  window.scrollTo({ top: 0, behavior: 'smooth' })
  if (n === 2 && S.vagaData) {
    document.getElementById('s2Sub').textContent =
      `${S.vagaData.titulo} \u00b7 ${S.vagaData.marca}`

    // Bind batch drop zone (once per activation)
    const dropZone = document.getElementById('batchDropZone')
    if (dropZone && !dropZone._bound) {
      dropZone._bound = true
      dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('dz-over') })
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dz-over'))
      dropZone.addEventListener('drop', handleBatchDrop)

      const fileInput = document.getElementById('batchFileInput')
      if (fileInput) {
        fileInput.addEventListener('change', e => {
          if (e.target.files && e.target.files.length) {
            handleBatchDrop({ dataTransfer: { files: e.target.files }, preventDefault: () => {} })
            fileInput.value = ''
          }
        })
      }
    }
  }
}

// ─── Candidatos ──────────────────────────────────────────────────────────────
function addCand() {
  const id = ++S.nextCandId
  S.cands.push({ id, nome: '', curriculo: '', fileName: null })
  renderCands()
}

function removeCand(id) {
  S.cands = S.cands.filter(c => c.id !== id)
  renderCands()
}

async function importOrganicCandidates() {
  if (!S.vagaId) { showAlert('Selecione uma vaga primeiro.'); return }
  try {
    const headers = typeof authHeaders === 'function' ? authHeaders() : {}
    const url = `/api/candidates?source=organico&job=${encodeURIComponent(S.vagaId)}`
    const organicos = await fetch(url, { headers }).then(r => r.json())
    if (!Array.isArray(organicos) || !organicos.length) {
      showToast('Nenhum candidato orgânico encontrado para esta vaga.'); return
    }
    // If only slot has empty data, clear it first
    if (S.cands.length === 1 && !S.cands[0].nome && !S.cands[0].curriculo) S.cands = []
    let added = 0
    for (const c of organicos) {
      if (!c.cv_text) continue
      if (S.cands.find(x => x.nome === c.name)) continue
      const id = ++S.nextCandId
      S.cands.push({ id, nome: c.name, curriculo: c.cv_text, fileName: `[portal] ${c.name}`, dbId: c.id })
      added++
    }
    renderCands()
    showToast(added ? `✓ ${added} candidato(s) importado(s) do portal` : 'Todos os candidatos já foram adicionados.')
  } catch { showToast('Erro ao importar candidatos.', true) }
}

function renderCands() {
  const lista = document.getElementById('candidatosList')
  lista.innerHTML = ''

  S.cands.forEach((c, i) => {
    const block = document.createElement('div')
    block.className   = 'cand-block'
    block.dataset.cid = c.id

    block.innerHTML = `
      <div class="cand-block-header">
        <span class="cand-num">Candidato ${String(i+1).padStart(2,'0')}</span>
        <span class="cand-detected-name" id="dname-${c.id}">${c.nome ? esc(c.nome) : '<span style="color:var(--text3);font-size:.75rem">nome será detectado do arquivo</span>'}</span>
        ${S.cands.length > 1
          ? `<button type="button" class="btn-remove" data-remove="${c.id}">\u00d7 Remover</button>`
          : ''}
      </div>
      <div class="cv-toolbar">
        <span class="cv-label">Curr\u00edculo</span>
        <div class="cv-right">
          ${c.fileName ? `<span class="file-badge">${esc(c.fileName)}</span><button type="button" class="btn-clear-file" data-clear="${c.id}">\u00d7 limpar</button>` : ''}
          <button type="button" class="btn-upload" data-upload="${c.id}">\uD83D\uDCCE Carregar arquivo</button>
          <input type="file" accept=".pdf,.docx,.doc,.txt" multiple style="display:none" data-file-input="${c.id}"/>
        </div>
      </div>
      <div class="cv-wrap" data-cvwrap="${c.id}">
        <textarea class="cand-cv" placeholder="Cole o curr\u00edculo aqui, ou arraste um arquivo PDF \u00b7 DOCX \u00b7 TXT...">${esc(c.curriculo)}</textarea>
      </div>`

    const ta = block.querySelector('textarea')
    ta.addEventListener('input',    e => { syncCand(c.id, 'curriculo', e.target.value) })
    ta.addEventListener('dragover', e => { e.preventDefault(); ta.classList.add('drag-over') })
    ta.addEventListener('dragleave',() => ta.classList.remove('drag-over'))
    ta.addEventListener('drop', e => {
      e.preventDefault(); ta.classList.remove('drag-over')
      const file = e.dataTransfer.files?.[0]
      if (file) handleFile(c.id, file)
    })

    block.querySelector('[data-upload]')?.addEventListener('click', () => {
      block.querySelector('[data-file-input]').click()
    })
    block.querySelector('[data-file-input]')?.addEventListener('change', async e => {
      const files = Array.from(e.target.files || [])
      if (!files.length) { e.target.value = ''; return }
      if (files.length === 1) {
        handleFile(c.id, files[0])
      } else {
        // First file goes to this candidate; extras create new candidates
        handleFile(c.id, files[0])
        const extras = files.slice(1)
        for (const f of extras) {
          const newId = ++S.nextCandId
          S.cands.push({ id: newId, nome: '', curriculo: '', fileName: null })
        }
        if (extras.length) {
          renderCands()
          const novos = S.cands.slice(-extras.length)
          for (let i = 0; i < extras.length; i++) await handleFile(novos[i].id, extras[i])
        }
      }
      e.target.value = ''
    })
    block.querySelector('[data-clear]')?.addEventListener('click', () => {
      syncCand(c.id, 'curriculo', '')
      syncCand(c.id, 'fileName', null)
      renderCands()
    })
    block.querySelector('[data-remove]')?.addEventListener('click', () => removeCand(c.id))

    lista.appendChild(block)
  })

  document.getElementById('candCount').textContent = S.cands.length
  validateCands()
}

function syncCand(id, field, value) {
  const c = S.cands.find(c => c.id === id)
  if (c) c[field] = value
  validateCands()
}

function validateCands() {
  const ok = S.cands.some(c => c.curriculo?.trim())
  document.getElementById('btnNext2').disabled = !ok
}

// ─── File parsing ─────────────────────────────────────────────────────────────
const IMAGE_EXTS = new Set(['jpg','jpeg','png','gif','webp','bmp','tiff','tif'])
const IMAGE_MIME  = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif',
                      webp:'image/webp', bmp:'image/bmp', tiff:'image/tiff', tif:'image/tiff' }

async function handleFile(id, file) {
  const ext = file.name.split('.').pop().toLowerCase()

  const wrap = document.querySelector(`[data-cvwrap="${id}"]`)
  wrap.innerHTML = `<div class="cv-parsing"><div class="spin"></div>Lendo ${esc(file.name)}...</div>`

  try {
    let texto = ''
    if (ext === 'txt')                        texto = await parseTXT(file)
    else if (ext === 'pdf')                   texto = await parsePDF(file)
    else if (ext === 'docx' || ext === 'doc')  texto = await parseDOCX(file)
    else if (IMAGE_EXTS.has(ext))              texto = await ocrDocument(file, IMAGE_MIME[ext] || 'image/jpeg')
    else {
      try { texto = await parseTXT(file) } catch (_) { texto = '' }
      if (!texto.trim()) throw new Error(`Não foi possível extrair texto de "${file.name}". Tente converter para PDF ou DOCX.`)
    }

    if (!texto.trim()) throw new Error('Nenhum texto encontrado no arquivo.')

    syncCand(id, 'curriculo', texto)
    syncCand(id, 'fileName', file.name)
    syncCand(id, 'fileObj', file)

    const c = S.cands.find(c => c.id === id)
    if (c && !c.nome?.trim()) {
      const nome = detectNome(texto)
      syncCand(id, 'nome', nome || '')
    }

    renderCands()
    showToast(`\u2713 ${file.name} carregado`)
  } catch (err) {
    wrap.innerHTML = `<textarea class="cand-cv" placeholder="Erro ao ler arquivo. Cole o texto manualmente."></textarea>`
    const ta = wrap.querySelector('textarea')
    ta.addEventListener('input', e => syncCand(id, 'curriculo', e.target.value))
    showToast(err.message || 'Erro ao processar arquivo.', true)
  }
}

function parseTXT(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload  = e => res(e.target.result)
    r.onerror = () => rej(new Error('Falha ao ler TXT.'))
    r.readAsText(file, 'UTF-8')
  })
}

async function parsePDF(file) {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const pgs = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i)
    const ct = await pg.getTextContent()
    pgs.push(ct.items.map(it => it.str).join(' '))
  }
  const texto = pgs.join('\n').replace(/\s{3,}/g, '\n').trim()

  // PDF digitalizado (sem texto selecionável) → OCR via Gemini Vision
  if (texto.length < 80) {
    return ocrPDF(file)
  }
  return texto
}

async function ocrPDF(file) {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let b64 = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    b64 += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  b64 = btoa(b64)

  const resp = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: b64, mimeType: 'application/pdf' })
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || 'OCR falhou. Verifique se a Gemini API Key está configurada.')
  }
  const { texto } = await resp.json()
  if (!texto?.trim()) throw new Error('Não foi possível extrair texto deste PDF.')
  return texto
}

async function ocrDocument(file, mimeType) {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let b64 = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    b64 += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  b64 = btoa(b64)

  const resp = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: b64, mimeType })
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || 'OCR falhou. Verifique se a Gemini API Key está configurada.')
  }
  const { texto } = await resp.json()
  if (!texto?.trim()) throw new Error('Não foi possível extrair texto deste arquivo via OCR.')
  return texto
}

async function parseDOCX(file) {
  const buf = await file.arrayBuffer()

  // convertToHtml preserves paragraph/list structure better than extractRawText
  const res = await mammoth.convertToHtml({ arrayBuffer: buf })
  const html = res.value

  if (!html.trim()) {
    const raw = await mammoth.extractRawText({ arrayBuffer: buf })
    return raw.value.trim()
  }

  const tmp = document.createElement('div')
  tmp.innerHTML = html

  tmp.querySelectorAll('p, h1, h2, h3, h4, h5, h6').forEach(el => el.prepend('\n'))
  tmp.querySelectorAll('li').forEach(el => el.prepend('\n• '))
  tmp.querySelectorAll('br').forEach(el => el.replaceWith('\n'))

  return tmp.textContent.replace(/\n{3,}/g, '\n\n').trim()
}

function detectNome(texto) {
  const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean)

  // Pass 1: first 8 lines — classic "Nome Sobrenome" pattern
  for (const linha of linhas.slice(0, 8)) {
    const palavras = linha.split(/\s+/)
    if (palavras.length >= 2 && palavras.length <= 5
      && /^[A-Za-zA-\u00D6\u00D8-\u00F6\u00F8-\u00FF\s]+$/.test(linha)
      && linha.length >= 5 && linha.length < 60)
      return linha
  }

  // Pass 2: look for "Nome: ..." or "Name: ..." label in first 20 lines
  for (const linha of linhas.slice(0, 20)) {
    const m = linha.match(/^(?:nome|name)\s*[:\-]\s*(.+)/i)
    if (m) {
      const candidato = m[1].trim()
      const palavras = candidato.split(/\s+/)
      if (palavras.length >= 2 && palavras.length <= 5) return candidato
    }
  }

  return null
}

// ─── Batch drop zone ─────────────────────────────────────────────────────────
async function handleBatchDrop(e) {
  e.preventDefault()
  e.currentTarget?.classList.remove('dz-over')
  const files = Array.from(e.dataTransfer.files)
  if (!files.length) return showToast('Nenhum arquivo recebido.', true)

  // Remove the empty placeholder candidate if it's blank
  if (S.cands.length === 1 && !S.cands[0].nome && !S.cands[0].curriculo) {
    S.cands = []
  }
  for (const file of files) {
    const id = ++S.nextCandId
    S.cands.push({ id, nome: '', curriculo: '', fileName: null })
  }
  renderCands()

  const novos = S.cands.slice(-files.length)
  for (let i = 0; i < files.length; i++) {
    await handleFile(novos[i].id, files[i])
  }
}

// ─── Triagem ─────────────────────────────────────────────────────────────────
async function iniciarTriagem() {
  // Usa nome detectado ou fallback "Candidato N"
  S.cands.forEach((c, i) => { if (!c.nome?.trim()) c.nome = `Candidato ${String(i+1).padStart(2,'0')}` })
  const validos = S.cands.filter(c => c.curriculo?.trim())
  if (!validos.length) return
  hideAlert()

  S.resultados  = []
  S.shortlist   = new Set()
  S.dispensados = new Set()

  goStep(3)
  window.VOICE_CONTEXT = { page: 'triagem', vaga: S.vagaData?.titulo, step: 3, candidatos: validos.length }
  document.getElementById('resTitulo').textContent  = 'Analisando candidatos...'
  document.getElementById('resSub').textContent     = `${S.vagaData.titulo} \u00b7 ${validos.length} candidato(s)`
  document.getElementById('resSummary').className   = ''
  document.getElementById('resNav').style.display   = 'none'
  document.getElementById('progWrap').style.display = 'block'
  document.getElementById('btnExport').disabled     = true
  document.getElementById('resLista').innerHTML     = ''

  validos.forEach((_, i) => {
    document.getElementById('resLista').insertAdjacentHTML('beforeend', `
      <div class="skel-card" id="skel-${i}">
        <div class="skel skel-circle"></div>
        <div class="skel-lines">
          <div class="skel skel-line" style="width:60%"></div>
          <div class="skel skel-line skel-s"></div>
        </div>
      </div>`)
  })

  setProgress(0, validos.length)

  try {
    const resp = await fetch('/api/screen', {
      method:  'POST',
      headers: authHeaders(),
      body:    JSON.stringify({ vagaId: S.vagaId, candidatos: validos }),
    })
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}))
      throw new Error(e.error || `Erro ${resp.status}`)
    }

    const reader  = resp.body.getReader()
    const decoder = new TextDecoder()
    let   buf     = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop()
      let ev = null
      for (const line of lines) {
        if (line.startsWith('event: ')) { ev = line.slice(7).trim(); continue }
        if (line.startsWith('data: ') && ev) {
          try { onSSE(ev, JSON.parse(line.slice(6)), validos.length) } catch (_) {}
          ev = null
        }
      }
    }
  } catch (err) {
    showAlert(err.message)
    document.querySelectorAll('[id^=skel-]').forEach(el => el.remove())
    document.getElementById('resNav').style.display  = 'flex'
    document.getElementById('resTitulo').textContent = 'Erro na triagem'
  }
}

function onSSE(event, data, total) {
  if (event === 'start') {
    setProgress(0, data.total)

  } else if (event === 'progress') {
    document.getElementById('progTxt').textContent = `Analisando: ${data.nome}...`

  } else if (event === 'candidato') {
    document.getElementById(`skel-${data.index}`)?.remove()
    if (data.erro) {
      document.getElementById('resLista').insertAdjacentHTML('beforeend',
        `<div class="rcard" style="padding:16px 20px;color:var(--red);font-size:.83rem">${data.nome}: ${data.erro}</div>`)
    } else {
      S.resultados.push({ nome: data.nome, ...data.resultado })
      renderCard(S.resultados.length - 1, data.index + 1)
    }
    setProgress(data.index + 1, total)

  } else if (event === 'done') {
    const lista  = document.getElementById('resLista')
    const ranked = S.resultados
      .map((r, i) => ({ ...r, i }))
      .sort((a, b) => b.scoreTotal - a.scoreTotal)

    ranked.forEach((r, pos) => {
      const card = document.getElementById(`rc-${r.i}`)
      if (card) {
        card.querySelector('.rc-pos').textContent = `#${pos + 1}`
        lista.appendChild(card)
      }
    })

    const scores  = S.resultados.map(r => r.scoreTotal).filter(Boolean)
    const avancar = S.resultados.filter(r => normRec(r.recomendacao) === 'avancar').length
    document.getElementById('sumTotal').textContent   = S.resultados.length
    document.getElementById('sumAvancar').textContent = avancar
    document.getElementById('sumMedia').textContent   = scores.length ? Math.round(scores.reduce((a,b) => a+b, 0) / scores.length) : '\u2014'
    document.getElementById('sumMelhor').textContent  = scores.length ? Math.max(...scores) : '\u2014'
    document.getElementById('resSummary').className   = 'on'
    document.getElementById('progWrap').style.display = 'none'
    document.getElementById('resTitulo').textContent  = 'Triagem conclu\u00edda'
    document.getElementById('resSub').textContent     = `${S.resultados.length} candidato(s) avaliados para ${S.vagaData.titulo}`
    document.getElementById('resNav').style.display   = 'flex'
    document.getElementById('btnExport').disabled = false
    setProgress(total, total)
    saveToHistory()
    showScheduleCard()

    if (data.screeningId) uploadCVsToServer(data.screeningId)

    // Botão Modo Tinder
    if (S.resultados.length > 0 && !document.getElementById('btnTinderMode')) {
      document.getElementById('resNav').insertAdjacentHTML('beforeend',
        `<button type="button" class="btn-tinder-mode" id="btnTinderMode">\u2764 Revis\u00e3o R\u00e1pida</button>`)
      document.getElementById('btnTinderMode').addEventListener('click', openTinderMode)
    }
  }
}

// ─── CV upload ───────────────────────────────────────────────────────────────
async function uploadCVsToServer(screeningId) {
  for (const r of S.resultados) {
    const cand = S.cands.find(c => c.nome?.trim().toLowerCase() === r.nome?.trim().toLowerCase())
    if (!cand?.fileObj) continue
    try {
      const dataUrl = await new Promise((res, rej) => {
        const reader = new FileReader()
        reader.onload = e => res(e.target.result)
        reader.onerror = rej
        reader.readAsDataURL(cand.fileObj)
      })
      await fetch('/api/cvs/upload', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screeningId,
          candidateName: r.nome,
          fileData: dataUrl,
          filename: cand.fileObj.name,
          mimetype: cand.fileObj.type || 'application/octet-stream',
        })
      })
    } catch (_) {}
  }
}

// ─── Result card ─────────────────────────────────────────────────────────────
function scoreColor(s) {
  return s >= 66 ? 'var(--green)' : s >= 41 ? 'var(--amber)' : 'var(--red)'
}
function normRec(r) {
  return (r || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function avatarColor(name) {
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffff
  const colors = ['#7c3aed','#06b6d4','#10b981','#f59e0b','#f43f5e','#3b82f6','#8b5cf6','#0ea5e9']
  return colors[h % colors.length]
}

function renderCard(idx, posDisplay) {
  const r   = S.resultados[idx]
  const col = scoreColor(r.scoreTotal)
  const rec = normRec(r.recomendacao)
  const ring = `conic-gradient(${col} ${r.scoreTotal}%, rgba(255,255,255,0.06) 0)`
  const avColor = avatarColor(r.nome)
  const avInitial = (r.nome || '?').trim()[0].toUpperCase()

  const dims = Object.entries(DIM_LABELS).map(([k, label]) => {
    const d   = r.dimensoes?.[k] || {}
    const sc  = Number(d.score) || 0
    const pct = sc * 10
    const c   = scoreColor(pct)
    return `<div>
      <div class="dim-label-row">
        <span class="dim-label">${label}</span>
        <span class="dim-score" style="color:${c}">${sc}/10</span>
      </div>
      <div class="dim-bar"><div class="dim-fill" style="--pct:${pct}%;background:${c}"></div></div>
      <div class="dim-just">${esc(d.justificativa || '')}</div>
    </div>`
  }).join('')

  const forts   = (r.pontosFort    || []).map(p => `<div class="ponto fort">${p}</div>`).join('')   || '<div class="ponto fort">N\u00e3o identificado</div>'
  const atencao = (r.pontosAtencao || []).map(p => `<div class="ponto atencao">${p}</div>`).join('') || '<div class="ponto atencao">N\u00e3o identificado</div>'

  const card = document.createElement('div')
  card.className = `rcard ${rec}`
  card.id        = `rc-${idx}`
  card.innerHTML = `
    <div class="rc-head">
      <div class="rc-pos">#${posDisplay}</div>
      <div class="rc-avatar" style="background:${avColor}">${avInitial}</div>
      <div class="score-ring" style="background:${ring};--ring-color:${col}">
        <span class="score-val">${r.scoreTotal}</span>
      </div>
      <div class="rc-info">
        <div class="rc-nome">${esc(r.nome)}</div>
        <div class="rc-resumo">${esc(r.resumo || '')}</div>
      </div>
      <div class="rec-badge ${rec}">${esc(r.recomendacao)}</div>
      <div class="rc-chevron">\u25be</div>
    </div>
    <div class="rc-body">
      <div class="dim-grid">${dims}</div>
      <div class="pontos-row">
        <div class="pontos-box"><div class="pontos-title fort">Pontos fortes</div>${forts}</div>
        <div class="pontos-box"><div class="pontos-title atencao">Pontos de aten\u00e7\u00e3o</div>${atencao}</div>
      </div>
      <div class="rc-actions">
        <button type="button" class="btn-action btn-sl" data-sl="${idx}">Shortlist</button>
        <button type="button" class="btn-action btn-dp" data-dp="${idx}">Dispensar</button>
        <button type="button" class="btn-action btn-cp" data-cp="${idx}">Copiar an\u00e1lise</button>
      </div>
      ${rec === 'avancar' ? `<div class="ol-picker-wrap" data-slot-picker="${idx}">${OUTLOOK.app && OUTLOOK.slots.length ? OUTLOOK._pickerHTML(idx) : ''}</div>` : ''}
    </div>`

  card.querySelector('.rc-head').addEventListener('click', () => card.classList.toggle('open'))

  card.querySelector('[data-sl]').addEventListener('click', e => {
    e.stopPropagation()
    const btn = e.currentTarget
    if (S.shortlist.has(idx)) {
      S.shortlist.delete(idx)
      btn.classList.remove('on')
    } else {
      S.shortlist.add(idx)
      S.dispensados.delete(idx)
      btn.classList.add('on')
      card.querySelector('[data-dp]').classList.remove('on')
    }
  })

  card.querySelector('[data-dp]').addEventListener('click', e => {
    e.stopPropagation()
    const btn = e.currentTarget
    if (S.dispensados.has(idx)) {
      S.dispensados.delete(idx)
      btn.classList.remove('on')
    } else {
      S.dispensados.add(idx)
      S.shortlist.delete(idx)
      btn.classList.add('on')
      card.querySelector('[data-sl]').classList.remove('on')
    }
  })

  card.querySelector('[data-cp]').addEventListener('click', e => {
    e.stopPropagation()
    copiarAnalise(idx)
  })

  const pickerWrap = card.querySelector('[data-slot-picker]')
  if (pickerWrap) {
    pickerWrap.addEventListener('change', e => {
      if (!e.target.matches('select')) return
      const v = e.target.value
      if (v === '') delete OUTLOOK.assigned[idx]
      else OUTLOOK.assigned[idx] = parseInt(v)
      OUTLOOK._renderSlots()
    })
  }

  document.getElementById('resLista').appendChild(card)
}

function bindResults() {
  // ligado via bindNav()
}

// ─── Shortlist Geral Modal ───────────────────────────────────────
let _slSorted = []

function openShortlistGeral() {
  if (!S.resultados.length) { showToast('Nenhum resultado disponível.', true); return }
  _slSorted = [...S.resultados].sort((a, b) => b.scoreTotal - a.scoreTotal)

  document.getElementById('slModalTitle').textContent =
    'Shortlist Geral — ' + (S.vagaData?.titulo || '')
  document.getElementById('slModalSub').textContent =
    _slSorted.length + ' candidato(s) · ' + (S.vagaData?.marca || '') + ' · ' + new Date().toLocaleDateString('pt-BR')

  document.querySelectorAll('[data-sltab]').forEach(b =>
    b.classList.toggle('active', b.dataset.sltab === 'dashboard'))
  document.getElementById('slOverlay').classList.add('on')
  renderSlTab('dashboard')

  if (!document.getElementById('slOverlay')._bound) {
    document.getElementById('slOverlay')._bound = true
    document.getElementById('slClose').addEventListener('click', () =>
      document.getElementById('slOverlay').classList.remove('on'))
    document.querySelectorAll('[data-sltab]').forEach(btn =>
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-sltab]').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        renderSlTab(btn.dataset.sltab)
      }))
  }
}

function renderSlTab(tab) {
  const body     = document.getElementById('slBody')
  const sorted   = _slSorted
  const DIM_KEYS = ['heartist', 'tecnico', 'estabilidade', 'experiencia', 'potencial']
  const DIM_HDRS = ['Heartist®', 'Técnico', 'Estabilidade', 'Experiência', 'Potencial']

  function dimCell(r, k) {
    const sc  = r.dimensoes?.[k]?.score
    const col = sc != null ? scoreColor(sc * 10) : 'var(--text3)'
    return '<td class="sl-td-c"><span style="color:' + col + ';font-weight:700">' + (sc != null ? sc + '/10' : '—') + '</span></td>'
  }

  if (tab === 'dashboard') {
    const total     = sorted.length
    const avancar   = sorted.filter(r => normRec(r.recomendacao).includes('avan')).length
    const aguardar  = sorted.filter(r => normRec(r.recomendacao).includes('aguar')).length
    const dispensar = total - avancar - aguardar
    const scores    = sorted.map(r => r.scoreTotal).filter(Boolean)
    const media     = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
    const melhor    = scores.length ? Math.max(...scores) : 0

    const kpis = [
      { label: 'Total Triados', value: total,             color: '#7c3aed' },
      { label: 'Avançar',    value: avancar,           color: '#059669' },
      { label: 'Aguardar',      value: aguardar,          color: '#d97706' },
      { label: 'Dispensar',     value: dispensar,         color: '#dc2626' },
      { label: 'Score Médio',value: media + '/100',    color: '#0891b2' },
      { label: 'Maior Score',   value: melhor + '/100',   color: '#7c3aed' },
    ]

    const rows = sorted.map((r, i) => {
      const rec = normRec(r.recomendacao)
      return '<tr><td class="sl-td-c">' + (i+1) + '</td><td>' + esc(r.nome) + '</td>' +
        '<td class="sl-td-c"><span style="color:' + scoreColor(r.scoreTotal) + ';font-weight:800">' + r.scoreTotal + '</span></td>' +
        '<td class="sl-td-c"><span class="rec-badge ' + rec + '">' + esc(r.recomendacao || '') + '</span></td>' +
        '<td class="sl-td-c">' + esc(r.nivel_ingles || '—') + '</td>' +
        '<td class="sl-td-w">' + esc((r.pontosFort || []).join(' · ')) + '</td>' +
        '<td class="sl-td-w">' + esc(r.resumo || '') + '</td></tr>'
    }).join('')

    body.innerHTML =
      '<div class="sl-kpis">' + kpis.map(k =>
        '<div class="sl-kpi"><div class="sl-kpi-val" style="color:' + k.color + '">' + k.value + '</div>' +
        '<div class="sl-kpi-lbl">' + k.label + '</div></div>'
      ).join('') + '</div>' +
      '<div class="sl-sec-title">Ranking de Candidatos</div>' +
      '<div class="sl-table-wrap"><table class="sl-table"><thead><tr>' +
      '<th>#</th><th>Candidato</th><th>Score</th><th>Recomendação</th>' +
      '<th>Inglês</th><th>Pontos Fortes</th><th>Resumo</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>'

  } else if (tab === 'candidatos') {
    const rows = sorted.map((r, i) => {
      const rec = normRec(r.recomendacao)
      return '<tr><td class="sl-td-c">' + (i+1) + '</td><td>' + esc(r.nome) + '</td>' +
        '<td class="sl-td-c">' + esc(r.telefone || '—') + '</td>' +
        '<td class="sl-td-c">' + esc(r.nivel_ingles || '—') + '</td>' +
        '<td class="sl-td-c"><span style="color:' + scoreColor(r.scoreTotal) + ';font-weight:800">' + r.scoreTotal + '</span></td>' +
        '<td class="sl-td-c"><span class="rec-badge ' + rec + '">' + esc(r.recomendacao || '') + '</span></td>' +
        '<td class="sl-td-w">' + esc(r.resumo || '') + '</td>' +
        '<td class="sl-td-w">' + esc((r.pontosFort || []).join(' · ')) + '</td>' +
        '<td class="sl-td-w">' + esc((r.pontosAtencao || []).join(' · ')) + '</td>' +
        DIM_KEYS.map(k => dimCell(r, k)).join('') + '</tr>'
    }).join('')

    body.innerHTML =
      '<div class="sl-table-wrap"><table class="sl-table"><thead><tr>' +
      '<th>#</th><th>Nome</th><th>Telefone</th><th>Inglês</th><th>Score</th>' +
      '<th>Recomendação</th><th>Resumo</th><th>Pontos Fortes</th><th>Pts. Atenção</th>' +
      DIM_HDRS.map(h => '<th>' + h + '</th>').join('') +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>'

  } else if (tab === 'dimensoes') {
    const rows = sorted.map(r =>
      '<tr><td>' + esc(r.nome) + '</td>' +
      '<td class="sl-td-c"><span style="color:' + scoreColor(r.scoreTotal) + ';font-weight:800">' + r.scoreTotal + '</span></td>' +
      DIM_KEYS.map(k => dimCell(r, k)).join('') + '</tr>'
    ).join('')

    const avgTotal = sorted.length
      ? Math.round(sorted.reduce((s, r) => s + (r.scoreTotal || 0), 0) / sorted.length) : 0
    const avgCells = DIM_KEYS.map(k => {
      const avg = sorted.length
        ? sorted.reduce((s, r) => s + (r.dimensoes?.[k]?.score || 0), 0) / sorted.length : 0
      return '<td class="sl-td-c"><span style="color:' + scoreColor(avg * 10) + ';font-weight:700">' + avg.toFixed(1) + '/10</span></td>'
    }).join('')

    body.innerHTML =
      '<div class="sl-table-wrap"><table class="sl-table"><thead><tr>' +
      '<th>Candidato</th><th>Score Total</th>' + DIM_HDRS.map(h => '<th>' + h + '</th>').join('') +
      '</tr></thead><tbody>' + rows +
      '<tr class="sl-avg-row"><td style="font-weight:700;color:var(--text3)">MÉDIA GERAL</td>' +
      '<td class="sl-td-c"><span style="color:' + scoreColor(avgTotal) + ';font-weight:800">' + avgTotal + '</span></td>' +
      avgCells + '</tr></tbody></table></div>'
  }
}

async function exportarExcel() {
  const resultados = S.shortlist.size
    ? S.resultados.filter((_, i) => S.shortlist.has(i))
    : S.resultados
  if (!resultados.length) { showToast('Nenhum candidato para exportar', true); return }

  const btn = document.getElementById('btnExportXlsx')
  btn.disabled = true
  btn.textContent = '⏳ Gerando...'
  try {
    const r = await fetch('/api/export-xlsx', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ vagaData: S.vagaData, resultados }),
    })
    if (!r.ok) throw new Error('Erro ao gerar planilha')
    const blob = await r.blob()
    const vaga = S.vagaData?.titulo?.toLowerCase().replace(/\s+/g, '-') || 'candidatos'
    const nome = `triagem-pullman-${vaga}-${new Date().toISOString().slice(0,10)}.xlsx`
    const url  = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), { href: url, download: nome }).click()
    URL.revokeObjectURL(url)
    showToast(`📊 Excel exportado — ${resultados.length} candidato(s)`)
  } catch (e) {
    showToast(e.message, true)
  } finally {
    btn.disabled = false
    btn.textContent = '📄 Exportar Excel'
  }
}

function copiarAnalise(idx) {
  const r = S.resultados[idx]
  if (!r) return
  const dims = Object.entries(DIM_LABELS)
    .map(([k, l]) => `${l}: ${r.dimensoes?.[k]?.score ?? '\u2014'}/10 \u2014 ${r.dimensoes?.[k]?.justificativa || ''}`)
    .join('\n')
  const txt = [
    '\uD83D\uDCCB An\u00e1lise de Candidato \u2014 AI-HR Academy',
    `Vaga: ${S.vagaData?.titulo} | ${S.vagaData?.marca}`,
    '',
    `Candidato: ${r.nome}`,
    `Score: ${r.scoreTotal}/100 \u2014 ${(r.recomendacao || '').toUpperCase()}`,
    '', dims, '',
    '\u2705 Pontos Fortes:',
    ...(r.pontosFort    || []).map(p => `\u2022 ${p}`), '',
    '\u26A0\uFE0F Pontos de Aten\u00e7\u00e3o:',
    ...(r.pontosAtencao || []).map(p => `\u2022 ${p}`), '',
    `Resumo: ${r.resumo || ''}`,
  ].join('\n')
  copyText(txt, 'An\u00e1lise copiada')
}

function copyText(text, msg = 'Copiado') {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast(msg)).catch(() => legacyCopy(text, msg))
  } else {
    legacyCopy(text, msg)
  }
}

function legacyCopy(text, msg) {
  const ta = Object.assign(document.createElement('textarea'), {
    value: text, style: 'position:fixed;left:-9999px;opacity:0'
  })
  document.body.appendChild(ta)
  ta.focus(); ta.select()
  const ok = document.execCommand('copy')
  ta.remove()
  showToast(ok ? msg : 'N\u00e3o foi poss\u00edvel copiar.', !ok)
}

// ─── Nova triagem ─────────────────────────────────────────────────────────────
function novaTriagem() {
  S.vagaId = null; S.vagaData = null
  S.cands  = []; S.resultados = []
  S.shortlist = new Set(); S.dispensados = new Set()
  S.nextCandId = 0
  document.querySelectorAll('.vaga-card').forEach(c => c.classList.remove('selected'))
  document.getElementById('vagaDetalhe').classList.remove('on')
  document.getElementById('btnNext1').disabled = true
  document.getElementById('progWrap').style.display = 'block'
  document.getElementById('resLista').innerHTML     = ''
  OUTLOOK.reset()
  hideScheduleCard()
  const tinderBtn = document.getElementById('btnTinderMode')
  if (tinderBtn) tinderBtn.remove()
  addCand()
  goStep(1)
}

// ─── Progress ─────────────────────────────────────────────────────────────────
function setProgress(done, total) {
  const pct = total > 0 ? Math.round(done / total * 100) : 0
  document.getElementById('progFill').style.width = pct + '%'
  document.getElementById('progPct').textContent  = pct + '%'
  if (done >= total && total > 0)
    document.getElementById('progTxt').textContent = 'Conclu\u00eddo'
}

// ─── Tinder Review Mode ───────────────────────────────────────────────────────
let tinderIdx = 0
let tinderOrder = []

function openTinderMode() {
  tinderOrder = [...S.resultados.keys()].sort((a,b) => S.resultados[b].scoreTotal - S.resultados[a].scoreTotal)
  tinderIdx   = 0

  // Create overlay if not exists
  if (!document.getElementById('tinderOverlay')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="tinder-overlay" id="tinderOverlay">
        <div class="tinder-counter" id="tinderCounter"></div>
        <div class="tinder-card" id="tinderCard">
          <button class="tinder-close" id="tinderClose">\u00d7</button>
          <div class="tinder-score-wrap">
            <div class="tinder-score-ring" id="tinderRing">
              <span class="tinder-score-val" id="tinderScore"></span>
            </div>
          </div>
          <div class="tinder-name" id="tinderName"></div>
          <div class="tinder-rec" id="tinderRec"></div>
          <div class="tinder-resumo" id="tinderResumo"></div>
          <div class="tinder-actions">
            <button class="tinder-btn dispensar" id="tinderDispensar" title="Dispensar">\u2715</button>
            <button class="tinder-btn details" id="tinderDetails" title="Ver detalhes">\u22ef</button>
            <button class="tinder-btn shortlist" id="tinderShortlist" title="Shortlist">\u2713</button>
          </div>
        </div>
        <div class="tinder-done" id="tinderDone" style="display:none">
          <h3>\uD83C\uDF89 Revis\u00e3o conclu\u00edda!</h3>
          <p id="tinderDoneMsg"></p>
          <button class="btn-next" onclick="closeTinderMode()">Fechar</button>
        </div>
      </div>`)

    document.getElementById('tinderClose').addEventListener('click', closeTinderMode)
    document.getElementById('tinderDispensar').addEventListener('click', () => tinderAction('dispensar'))
    document.getElementById('tinderShortlist').addEventListener('click', () => tinderAction('shortlist'))
    document.getElementById('tinderDetails').addEventListener('click', tinderDetails)

    // Keyboard
    document.addEventListener('keydown', tinderKeyboard)
  }

  document.getElementById('tinderOverlay').classList.add('on')
  document.getElementById('tinderDone').style.display = 'none'
  document.getElementById('tinderCard').style.display = 'block'
  renderTinderCard()
}

function renderTinderCard() {
  if (tinderIdx >= tinderOrder.length) {
    showTinderDone()
    return
  }
  const idx = tinderOrder[tinderIdx]
  const r   = S.resultados[idx]
  const col = scoreColor(r.scoreTotal)
  const rec = normRec(r.recomendacao)

  document.getElementById('tinderCounter').textContent = `Candidato ${tinderIdx + 1} de ${tinderOrder.length}`
  document.getElementById('tinderRing').style.background = `conic-gradient(${col} ${r.scoreTotal}%, rgba(255,255,255,0.07) 0)`
  document.getElementById('tinderScore').textContent  = r.scoreTotal
  document.getElementById('tinderScore').style.color  = col
  document.getElementById('tinderName').textContent   = r.nome
  document.getElementById('tinderRec').innerHTML      = `<span class="rec-badge ${rec}">${r.recomendacao}</span>`
  document.getElementById('tinderResumo').textContent = r.resumo || ''

  const card = document.getElementById('tinderCard')
  card.classList.remove('slide-left', 'slide-right')
}

function tinderAction(action) {
  const idx = tinderOrder[tinderIdx]
  const card = document.getElementById('tinderCard')

  if (action === 'shortlist') {
    S.shortlist.add(idx)
    S.dispensados.delete(idx)
    card.classList.add('slide-right')
    // Update main list buttons
    const slBtn = document.querySelector(`[data-sl="${idx}"]`)
    const dpBtn = document.querySelector(`[data-dp="${idx}"]`)
    if (slBtn) slBtn.classList.add('on')
    if (dpBtn) dpBtn.classList.remove('on')
    showToast(`\u2713 ${S.resultados[idx].nome} adicionado \u00e0 shortlist`)
  } else {
    S.dispensados.add(idx)
    S.shortlist.delete(idx)
    card.classList.add('slide-left')
    const slBtn = document.querySelector(`[data-sl="${idx}"]`)
    const dpBtn = document.querySelector(`[data-dp="${idx}"]`)
    if (slBtn) slBtn.classList.remove('on')
    if (dpBtn) dpBtn.classList.add('on')
  }

  setTimeout(() => {
    tinderIdx++
    renderTinderCard()
  }, 300)
}

function tinderDetails() {
  const idx  = tinderOrder[tinderIdx]
  const card = document.getElementById(`rc-${idx}`)
  closeTinderMode()
  if (card) {
    card.classList.add('open')
    card.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

function showTinderDone() {
  document.getElementById('tinderCard').style.display = 'none'
  document.getElementById('tinderDone').style.display = 'block'
  document.getElementById('tinderCounter').textContent = ''
  document.getElementById('tinderDoneMsg').textContent =
    `${S.shortlist.size} candidato(s) na shortlist, ${S.dispensados.size} dispensado(s).`
}

function closeTinderMode() {
  document.getElementById('tinderOverlay').classList.remove('on')
  document.removeEventListener('keydown', tinderKeyboard)
  // Re-add listener next time mode opens
}

function tinderKeyboard(e) {
  if (e.key === 'ArrowRight' || e.key === 'l') tinderAction('shortlist')
  if (e.key === 'ArrowLeft'  || e.key === 'j') tinderAction('dispensar')
  if (e.key === 'Escape') closeTinderMode()
}

// ─── Histórico ────────────────────────────────────────────────────────────────
const HIST_KEY = 'hrTriagemHistory'

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]') } catch { return [] }
}

function saveToHistory() {
  if (!S.resultados.length || !S.vagaData) return
  const nomesKey = S.resultados.map(r => r.nome.trim().toLowerCase()).sort().join('|')
  const id = Date.now().toString()
  const entry = {
    id,
    vagaId:     S.vagaId,
    vagaTitulo: S.vagaData.titulo,
    data:       new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' }),
    total:      S.resultados.length,
    aprovados:  S.resultados.filter(r => normRec(r.recomendacao) === 'avancar').length,
    nomes:      S.resultados.map(r => r.nome.split(' ')[0]).join(', '),
    nomesKey,
  }
  let hist = loadHistory()
  const dupIdx = hist.findIndex(h => h.vagaId === S.vagaId && h.nomesKey === nomesKey)
  if (dupIdx !== -1) {
    localStorage.removeItem('hrTriagemData_' + hist[dupIdx].id)
    hist.splice(dupIdx, 1)
  }
  hist.unshift(entry)
  if (hist.length > 60) {
    hist.slice(60).forEach(h => localStorage.removeItem('hrTriagemData_' + h.id))
    hist = hist.slice(0, 60)
  }
  localStorage.setItem(HIST_KEY, JSON.stringify(hist))
  try {
    localStorage.setItem('hrTriagemData_' + id, JSON.stringify({
      vagaId: S.vagaId, vagaData: S.vagaData, resultados: S.resultados,
    }))
  } catch (_) {}
  renderHistory()
}

async function deleteFromHistory(id) {
  try { await fetch(`/api/screenings/${id}`, { method: 'DELETE', headers: authHeaders() }) } catch {}
  localStorage.removeItem('hrTriagemData_' + id)
  const hist = loadHistory().filter(h => h.id?.toString() !== id?.toString())
  localStorage.setItem(HIST_KEY, JSON.stringify(hist))
  renderHistory()
}

async function restoreFromDb(screeningId, vagaId) {
  // Tenta localStorage primeiro (instantâneo, tem vagaData completo)
  const local = localStorage.getItem('hrTriagemData_' + screeningId)
  if (local) {
    try { restoreFromHistory(screeningId); return } catch {}
  }

  // Busca detalhe completo do screening + vagaData em paralelo
  try {
    const [screening, vaga] = await Promise.all([
      fetch(`/api/screenings/${screeningId}`, { headers: authHeaders() }).then(r => r.json()),
      fetch(`/api/vagas/${vagaId}`).then(r => r.json()),
    ])
    if (screening.error) throw new Error(screening.error)
    if (vaga.error)      throw new Error(vaga.error)

    const resultado = Array.isArray(screening.resultado) ? screening.resultado : []
    if (!resultado.length) { showToast('Triagem sem candidatos salvos.', true); return }

    S.vagaId      = vagaId
    S.vagaData    = vaga
    S.resultados  = resultado
    S.shortlist   = new Set()
    S.dispensados = new Set()

    goStep(3)
    document.getElementById('resTitulo').textContent  = 'Triagem restaurada'
    document.getElementById('resSub').textContent     = resultado.length + ' candidato(s) · ' + vaga.titulo
    document.getElementById('progWrap').style.display = 'none'
    document.getElementById('resLista').innerHTML     = ''

    resultado.forEach((_, i) => renderCard(i, i + 1))

    const lista  = document.getElementById('resLista')
    const ranked = resultado.map((r, i) => ({ ...r, i })).sort((a, b) => b.scoreTotal - a.scoreTotal)
    ranked.forEach((r, pos) => {
      const card = document.getElementById('rc-' + r.i)
      if (card) { card.querySelector('.rc-pos').textContent = '#' + (pos + 1); lista.appendChild(card) }
    })

    const scores  = resultado.map(r => r.scoreTotal).filter(Boolean)
    const avancar = resultado.filter(r => normRec(r.recomendacao) === 'avancar').length
    document.getElementById('sumTotal').textContent   = resultado.length
    document.getElementById('sumAvancar').textContent = avancar
    document.getElementById('sumMedia').textContent   = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : '—'
    document.getElementById('sumMelhor').textContent  = scores.length ? Math.max(...scores) : '—'
    document.getElementById('resSummary').className   = 'on'
    document.getElementById('resNav').style.display   = 'flex'
    document.getElementById('btnExport').disabled     = false
    showScheduleCard()
    showToast('↩ Triagem restaurada — ' + vaga.titulo)
  } catch (e) {
    showAlert('Erro ao restaurar triagem: ' + e.message)
  }
}

async function renderHistory() {
  const list = document.getElementById('histList')
  if (!list) return
  list.innerHTML = '<div class="hist-empty" style="font-size:.78rem">Carregando...</div>'

  let rows = []
  try {
    rows = await fetch('/api/screenings', { headers: authHeaders() }).then(r => r.json())
  } catch {
    list.innerHTML = '<div class="hist-empty">Erro ao carregar histórico</div>'
    return
  }

  if (!rows.length) {
    list.innerHTML = '<div class="hist-empty">Nenhuma triagem realizada ainda</div>'
    return
  }

  list.innerHTML = ''
  rows.forEach(row => {
    let resultado = []
    try { resultado = JSON.parse(row.resultado || '[]') } catch {}

    const aprovados = resultado.filter(r => normRec(r.recomendacao) === 'avancar').length
    const nomes     = resultado.map(r => r.nome?.split(' ')[0]).filter(Boolean).join(', ')
    const data      = new Date(row.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })

    const item = document.createElement('div')
    item.className = 'hist-item hist-item-link'
    item.innerHTML = `
      <div class="hist-item-row">
        <span class="hist-vaga-tag">${esc(row.vaga_titulo)}</span>
        <button class="hist-del" title="Excluir triagem">&times;</button>
      </div>
      <div class="hist-item-row" style="margin-top:4px">
        <span class="hist-date">${esc(data)}</span>
        <span class="hist-stats">
          ${row.total} cand. &middot; <span class="hist-ok">&#10003;${aprovados}</span>
        </span>
      </div>
      <div class="hist-nomes">${esc(nomes)}</div>
      <div class="hist-restore-hint">&#8629; ver resultados</div>`

    item.addEventListener('click', e => {
      if (e.target.closest('.hist-del')) return
      restoreFromDb(row.id, row.vaga_id)
    })

    item.querySelector('.hist-del').addEventListener('click', e => {
      e.stopPropagation()
      if (confirm('Excluir este registro do histórico?')) deleteFromHistory(row.id)
    })

    list.appendChild(item)
  })
}

function restoreFromHistory(id) {
  const raw = localStorage.getItem('hrTriagemData_' + id)
  if (!raw) return
  let data
  try { data = JSON.parse(raw) } catch { return }

  S.vagaId      = data.vagaId
  S.vagaData    = data.vagaData
  S.resultados  = data.resultados
  S.shortlist   = new Set()
  S.dispensados = new Set()

  goStep(3)
  document.getElementById('resTitulo').textContent  = 'Triagem restaurada'
  document.getElementById('resSub').textContent     = S.resultados.length + ' candidato(s) · ' + S.vagaData.titulo
  document.getElementById('progWrap').style.display = 'none'
  document.getElementById('resLista').innerHTML     = ''

  S.resultados.forEach((_, i) => renderCard(i, i + 1))

  const lista  = document.getElementById('resLista')
  const ranked = S.resultados.map((r, i) => ({ ...r, i })).sort((a, b) => b.scoreTotal - a.scoreTotal)
  ranked.forEach((r, pos) => {
    const card = document.getElementById('rc-' + r.i)
    if (card) { card.querySelector('.rc-pos').textContent = '#' + (pos + 1); lista.appendChild(card) }
  })

  const scores  = S.resultados.map(r => r.scoreTotal).filter(Boolean)
  const avancar = S.resultados.filter(r => normRec(r.recomendacao) === 'avancar').length
  document.getElementById('sumTotal').textContent   = S.resultados.length
  document.getElementById('sumAvancar').textContent = avancar
  document.getElementById('sumMedia').textContent   = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : '—'
  document.getElementById('sumMelhor').textContent  = scores.length ? Math.max(...scores) : '—'
  document.getElementById('resSummary').className   = 'on'
  document.getElementById('resNav').style.display   = 'flex'
  document.getElementById('btnExport').disabled     = false
  showScheduleCard()
  showToast('↩ Triagem restaurada — ' + S.vagaData.titulo)
}

// ─── Schedule ─────────────────────────────────────────────────────────────────
function initSchedule() {
  document.getElementById('schedDate')?.addEventListener('input', e => {
    SCHED.date = e.target.value
    updateSchedPreview()
  })
  document.getElementById('schedTime')?.addEventListener('input', e => {
    SCHED.startTime = e.target.value || '08:00'
    updateSchedPreview()
  })
  document.getElementById('schedSlots')?.addEventListener('input', e => {
    SCHED.numSlots = Math.max(1, parseInt(e.target.value) || 5)
    updateSchedPreview()
  })
}

function showScheduleCard() {
  const card = document.getElementById('schedCard')
  if (!card) return
  card.style.display = 'block'
  const dateInput = document.getElementById('schedDate')
  if (dateInput && !SCHED.date) {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    dateInput.value = d.toISOString().slice(0, 10)
    SCHED.date = dateInput.value
    SCHED.startTime = '08:00'
    SCHED.numSlots  = S.resultados.filter((_, i) => !S.dispensados.has(i)).length || 5
    const slotsInput = document.getElementById('schedSlots')
    if (slotsInput) slotsInput.value = SCHED.numSlots
  }
  updateSchedPreview()
}

function hideScheduleCard() {
  const card = document.getElementById('schedCard')
  if (card) card.style.display = 'none'
  SCHED.date = ''; SCHED.startTime = '08:00'; SCHED.numSlots = 5
  const dateInput  = document.getElementById('schedDate');  if (dateInput)  dateInput.value  = ''
  const slotsInput = document.getElementById('schedSlots'); if (slotsInput) slotsInput.value = 5
}

function updateSchedPreview() {
  const preview = document.getElementById('schedPreview')
  if (!preview) return
  if (!SCHED.date) { preview.textContent = ''; return }
  const [y, m, d] = SCHED.date.split('-')
  const slots = []
  for (let i = 0; i < SCHED.numSlots; i++) slots.push(addMinutes(SCHED.startTime, i * 30))
  preview.innerHTML =
    `<strong>${d}/${m}/${y}</strong> &mdash; ${slots.join(' &middot; ')} ` +
    `<span class="sched-count">(${SCHED.numSlots} candidato${SCHED.numSlots !== 1 ? 's' : ''})</span>`
}

function addMinutes(time, mins) {
  const [h, m] = (time || '08:00').split(':').map(Number)
  const total  = h * 60 + m + mins
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')
}

async function avancarComunicacao() {
  if (!S.resultados.length) { showToast('Nenhum resultado para avançar.', true); return }
  const aprovados = S.resultados.reduce((acc, r, i) => {
    if (S.dispensados.has(i)) return acc
    const slot = OUTLOOK.getAssigned(i)
    acc.push({ ...r, ...(slot ? { interview_slot: slot.start.toISOString() } : {}) })
    return acc
  }, [])
  if (!aprovados.length) { showToast('Nenhum candidato para avançar.', true); return }

  if (SCHED.date) {
    localStorage.setItem('hrInterviewSchedule', JSON.stringify({
      date:      SCHED.date,
      startTime: SCHED.startTime,
      numSlots:  SCHED.numSlots,
    }))
  } else {
    localStorage.removeItem('hrInterviewSchedule')
  }

  const btn = document.getElementById('btnAvancarComun')
  btn.disabled = true
  btn.textContent = 'Salvando...'
  try {
    const r = await fetch('/api/selecao/from-triagem', {
      method:  'POST',
      headers: authHeaders(),
      body:    JSON.stringify({ vagaId: S.vagaId, candidatos: aprovados }),
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error || `Erro ${r.status}`)
    await OUTLOOK.createEvents(aprovados)
    window.removeEventListener('beforeunload', () => {})
    window.onbeforeunload = null
    window.location.href = 'contato.html'
  } catch (e) {
    showToast(e.message, true)
    btn.disabled = false
    btn.textContent = '\uD83D\uDC65 Avançar para Comunicação'
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function showAlert(msg) {
  const el = document.getElementById('alertBox')
  el.textContent = msg; el.classList.add('on')
}
function hideAlert() {
  document.getElementById('alertBox').classList.remove('on')
}

let toastTimer
function showToast(msg, err = false) {
  clearTimeout(toastTimer)
  const t = document.getElementById('toast')
  t.textContent = msg
  t.className   = err ? 'err show' : 'show'
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000)
}

function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

'use strict'

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

const DIM_LABELS = {
  heartist:        'Cultura Heartist',
  tecnico:         'Competências Técnicas',
  disponibilidade: 'Disponibilidade',
  experiencia:     'Experiência no Setor',
  potencial:       'Potencial de Dev.',
}

// ─── Init ────────────────────────────────────────────────────────────────────
;(async () => {
  checkStatus()
  loadVagas()
  addCand()
  bindNav()
  bindResults()
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
    document.getElementById('vdTitulo').textContent = v.titulo
    document.getElementById('vdMarca').textContent  = v.marca
    document.getElementById('vdRegime').textContent = v.regime
    const fill = (el, arr) => {
      document.getElementById(el).innerHTML = arr.map(t =>
        `<div class="vd-item">${t}</div>`).join('')
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
  document.getElementById('btnBack2').addEventListener('click', () => goStep(1))
  document.getElementById('btnNext2').addEventListener('click', iniciarTriagem)
  document.getElementById('btnExport').addEventListener('click', exportarShortlist)
  document.getElementById('btnNova').addEventListener('click', novaTriagem)
  document.getElementById('btnAddCand').addEventListener('click', addCand)
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
      `${S.vagaData.titulo} \u00b7 ${S.vagaData.marca} \u00b7 m\u00e1x. 10 candidatos`

    // Bind batch drop zone (once per activation)
    const dropZone = document.getElementById('batchDropZone')
    if (dropZone && !dropZone._bound) {
      dropZone._bound = true
      dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('dz-over') })
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dz-over'))
      dropZone.addEventListener('drop', handleBatchDrop)
    }
  }
}

// ─── Candidatos ──────────────────────────────────────────────────────────────
function addCand() {
  if (S.cands.length >= 10) return
  const id = ++S.nextCandId
  S.cands.push({ id, nome: '', curriculo: '', fileName: null })
  renderCands()
}

function removeCand(id) {
  S.cands = S.cands.filter(c => c.id !== id)
  renderCands()
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
        ${S.cands.length > 1
          ? `<button type="button" class="btn-remove" data-remove="${c.id}">\u00d7 Remover</button>`
          : ''}
      </div>
      <input type="text" class="cand-name" placeholder="Nome completo do candidato" value="${esc(c.nome)}"/>
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

    const nameEl = block.querySelector('.cand-name')
    nameEl.addEventListener('input', e => { syncCand(c.id, 'nome', e.target.value) })

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
        const disponiveis = 10 - S.cands.length
        const extras = files.slice(1, 1 + disponiveis)
        if (files.length - 1 > disponiveis)
          showToast(`Limite de 10 candidatos. ${files.length - 1 - disponiveis} arquivo(s) ignorado(s).`, true)
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
  document.getElementById('btnAddCand').disabled   = S.cands.length >= 10
  validateCands()
}

function syncCand(id, field, value) {
  const c = S.cands.find(c => c.id === id)
  if (c) c[field] = value
  validateCands()
}

function validateCands() {
  const ok = S.cands.some(c => c.nome?.trim() && c.curriculo?.trim())
  document.getElementById('btnNext2').disabled = !ok
}

// ─── File parsing ─────────────────────────────────────────────────────────────
async function handleFile(id, file) {
  const ext = file.name.split('.').pop().toLowerCase()
  if (!['pdf','docx','doc','txt'].includes(ext)) {
    return showToast('Formato n\u00e3o suportado. Use PDF, DOCX ou TXT.', true)
  }

  const wrap = document.querySelector(`[data-cvwrap="${id}"]`)
  wrap.innerHTML = `<div class="cv-parsing"><div class="spin"></div>Lendo ${esc(file.name)}...</div>`

  try {
    let texto = ''
    if (ext === 'txt')       texto = await parseTXT(file)
    else if (ext === 'pdf')  texto = await parsePDF(file)
    else                     texto = await parseDOCX(file)

    if (!texto.trim()) throw new Error('Nenhum texto encontrado no arquivo.')

    syncCand(id, 'curriculo', texto)
    syncCand(id, 'fileName', file.name)

    const c = S.cands.find(c => c.id === id)
    if (c && !c.nome?.trim()) {
      const nome = detectNome(texto)
      if (nome) {
        syncCand(id, 'nome', nome)
        // Mark as auto-filled for visual feedback (after next renderCands)
        setTimeout(() => {
          const block = document.querySelector(`[data-cid="${id}"]`)
          const nameInput = block?.querySelector('.cand-name')
          if (nameInput) {
            nameInput.dataset.autofilled = 'true'
            nameInput.addEventListener('input', () => delete nameInput.dataset.autofilled, { once: true })
          }
        }, 50)
      }
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
  return pgs.join('\n').replace(/\s{3,}/g, '\n').trim()
}

async function parseDOCX(file) {
  const buf = await file.arrayBuffer()
  const res = await mammoth.extractRawText({ arrayBuffer: buf })
  return res.value.trim()
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
  e.currentTarget.classList.remove('dz-over')
  const files = Array.from(e.dataTransfer.files).filter(f =>
    ['pdf','docx','doc','txt'].includes(f.name.split('.').pop().toLowerCase())
  )
  if (!files.length) return showToast('Nenhum arquivo suportado.', true)

  const disponiveis = 10 - S.cands.length
  // Remove the empty placeholder candidate if it's blank
  if (S.cands.length === 1 && !S.cands[0].nome && !S.cands[0].curriculo) {
    S.cands = []
  }
  const slotsRestantes = 10 - S.cands.length
  const lote = files.slice(0, slotsRestantes)
  if (files.length > slotsRestantes)
    showToast(`Limite de 10 candidatos. ${files.length - slotsRestantes} arquivo(s) ignorado(s).`, true)

  for (const file of lote) {
    const id = ++S.nextCandId
    S.cands.push({ id, nome: '', curriculo: '', fileName: null })
  }
  renderCands()

  const novos = S.cands.slice(-lote.length)
  for (let i = 0; i < lote.length; i++) {
    await handleFile(novos[i].id, lote[i])
  }
}

// ─── Triagem ─────────────────────────────────────────────────────────────────
async function iniciarTriagem() {
  const validos = S.cands.filter(c => c.nome?.trim() && c.curriculo?.trim())
  if (!validos.length) return
  hideAlert()

  S.resultados  = []
  S.shortlist   = new Set()
  S.dispensados = new Set()

  goStep(3)
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
      headers: { 'Content-Type': 'application/json' },
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
    setProgress(total, total)

    // Botão Modo Tinder
    if (S.resultados.length > 0 && !document.getElementById('btnTinderMode')) {
      document.getElementById('resNav').insertAdjacentHTML('beforeend',
        `<button type="button" class="btn-tinder-mode" id="btnTinderMode">\u2764 Revis\u00e3o R\u00e1pida</button>`)
      document.getElementById('btnTinderMode').addEventListener('click', openTinderMode)
    }
  }
}

// ─── Result card ─────────────────────────────────────────────────────────────
function scoreColor(s) {
  return s >= 66 ? 'var(--green)' : s >= 41 ? 'var(--amber)' : 'var(--red)'
}
function normRec(r) {
  return (r || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function renderCard(idx, posDisplay) {
  const r   = S.resultados[idx]
  const col = scoreColor(r.scoreTotal)
  const rec = normRec(r.recomendacao)
  const ring = `conic-gradient(${col} ${r.scoreTotal}%, rgba(255,255,255,0.06) 0)`

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
      <div class="dim-just">${d.justificativa || ''}</div>
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
      <div class="score-ring" style="background:${ring};--ring-color:${col}">
        <span class="score-val">${r.scoreTotal}</span>
      </div>
      <div class="rc-info">
        <div class="rc-nome">${r.nome}</div>
        <div class="rc-resumo">${r.resumo || ''}</div>
      </div>
      <div class="rec-badge ${rec}">${r.recomendacao}</div>
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
    document.getElementById('btnExport').disabled = S.shortlist.size === 0
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
      document.getElementById('btnExport').disabled = S.shortlist.size === 0
    }
  })

  card.querySelector('[data-cp]').addEventListener('click', e => {
    e.stopPropagation()
    copiarAnalise(idx)
  })

  document.getElementById('resLista').appendChild(card)
}

function bindResults() {
  // ligado via bindNav()
}

// ─── Exportar / Copiar ───────────────────────────────────────────────────────
function exportarShortlist() {
  if (!S.shortlist.size) return
  const sep = '\u2500'.repeat(60)
  const linhas = [
    'SHORTLIST DE CANDIDATOS',
    `Vaga: ${S.vagaData?.titulo} | ${S.vagaData?.marca}`,
    `Gerado em: ${new Date().toLocaleDateString('pt-BR')}`,
    sep, '',
  ]

  S.resultados
    .filter((_, i) => S.shortlist.has(i))
    .sort((a, b) => b.scoreTotal - a.scoreTotal)
    .forEach((r, i) => {
      const dims = Object.entries(DIM_LABELS)
        .map(([k, l]) => `  ${l}: ${r.dimensoes?.[k]?.score ?? '\u2014'}/10 \u2014 ${r.dimensoes?.[k]?.justificativa || ''}`)
        .join('\n')
      linhas.push(
        `${i+1}. ${r.nome}`,
        `   Score: ${r.scoreTotal}/100 | ${r.recomendacao}`,
        `   ${r.resumo || ''}`, '',
        '   DIMENS\u00d5ES:', dims, '',
        '   PONTOS FORTES:',
        ...(r.pontosFort    || []).map(p => `   \u2713 ${p}`), '',
        '   PONTOS DE ATEN\u00c7\u00c3O:',
        ...(r.pontosAtencao || []).map(p => `   ! ${p}`),
        '', sep, '',
      )
    })

  const vaga = S.vagaData?.titulo?.toLowerCase().replace(/\s+/g, '-') || 'candidatos'
  const nome = `shortlist-${vaga}-${new Date().toISOString().slice(0,10)}.txt`
  const blob = new Blob([linhas.join('\n')], { type: 'text/plain;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: nome })
  a.click()
  URL.revokeObjectURL(url)
  showToast(`Shortlist exportado \u2014 ${S.shortlist.size} candidato(s)`)
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
    document.getElementById('btnExport').disabled = false
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
    if (S.shortlist.size === 0) document.getElementById('btnExport').disabled = true
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

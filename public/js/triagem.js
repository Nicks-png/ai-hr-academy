'use strict'

// ─── PDF.js worker ───────────────────────────────────────────────────────────
if (typeof pdfjsLib !== 'undefined')
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

// ─── State ───────────────────────────────────────────────────────────────────
const S = {
  allCandidates: [],
  allVagas:      [],
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
let allCandidates = [];
let allVagas = [];

async function fetchCandidatesForSelection() {
  document.getElementById('candidates-container').innerHTML = '<p class="loading">Carregando candidatos...</p>';
  try {
    const response = await fetch('/api/selecao/candidates');
    S.allCandidates = await response.json();
    renderCandidatesForSelection();
  } catch (error) {
    console.error('Erro ao buscar candidatos para seleção:', error);
    document.getElementById('candidates-container').innerHTML = '<p class="error">Erro ao carregar candidatos.</p>';
  }
};

async function fetchVagasForSelection() {
  try {
    const response = await fetch('/api/vagas');
    S.allVagas = await response.json();
    populateVagaFilter();
  } catch (error) {
    console.error('Erro ao buscar vagas para seleção:', error);
  }
};

function populateVagaFilter() {
  const vagaFilterSelect = document.getElementById('vaga-filter');
  vagaFilterSelect.innerHTML = '<option value="">Todas as Vagas</option>';
  S.allVagas.forEach(vaga => {
    const option = document.createElement('option');
    option.value = vaga.id;
    option.textContent = vaga.titulo;
    vagaFilterSelect.appendChild(option);
  });
};

function renderCandidatesForSelection() {
  const candidatesContainer = document.getElementById('candidates-container');
  const candidateCountSpan = document.getElementById('candidate-count');
  const vagaFilterSelect = document.getElementById('vaga-filter');
  const searchInput = document.getElementById('search-input');

  candidatesContainer.innerHTML = '';
  let filteredCandidates = S.allCandidates;

  const selectedVagaId = vagaFilterSelect.value;
  if (selectedVagaId) {
    filteredCandidates = filteredCandidates.filter(c => c.job_id === selectedVagaId);
  }

  const searchTerm = searchInput.value.toLowerCase();
  if (searchTerm) {
    filteredCandidates = filteredCandidates.filter(c =>
      c.name.toLowerCase().includes(searchTerm) ||
      (c.skills && c.skills.some(s => s.toLowerCase().includes(searchTerm)))
    );
  }

  candidateCountSpan.textContent = `(${filteredCandidates.length})`;

  if (filteredCandidates.length === 0) {
    candidatesContainer.innerHTML = '<p class="no-results">Nenhum candidato encontrado com os critérios.</p>';
    return;
  }

  filteredCandidates.forEach(candidate => {
    const candidateCard = document.createElement('div');
    candidateCard.className = 'candidate-card';
    candidateCard.innerHTML = `
      <h3>${candidate.name}</h3>
      <p><strong>Vaga:</strong> ${candidate.vaga_titulo || 'N/A'}</p>
      <p><strong>Status:</strong> <span class="status-${(candidate.status || '').toLowerCase().replace(/ /g, '-')}">${candidate.status}</span></p>
      <p><strong>Experiência:</strong> ${candidate.anos_xp || 0} anos</p>
      <p><strong>Pretensão:</strong> R$ ${candidate.pretensao ? candidate.pretensao.toLocaleString('pt-BR') : 'N/A'}</p>
      ${candidate.ai_score_total ? `<p><strong>Score IA:</strong> ${candidate.ai_score_total}</p>` : ''}
      ${candidate.ai_recomendacao ? `<p><strong>Recomendação IA:</strong> ${candidate.ai_recomendacao}</p>` : ''}
      ${candidate.ai_resumo ? `<p><strong>Resumo IA:</strong> ${candidate.ai_resumo}</p>` : ''}
      <div class="skills">
          <strong>Habilidades:</strong> ${candidate.skills && candidate.skills.length > 0 ? candidate.skills.map(s => `<span>${s}</span>`).join(' ') : 'N/A'}
      </div>
      <div class="actions">
          <button class="btn-promote" data-id="${candidate.id}" data-current-status="${candidate.status}">Promover</button>
          <button class="btn-transfer" data-id="${candidate.id}">Transferir para Humano</button>
      </div>
    `;
    candidatesContainer.appendChild(candidateCard);
  });

  document.querySelectorAll('.btn-promote').forEach(button => {
    button.addEventListener('click', async (event) => {
      const id = event.target.dataset.id;
      const currentStatus = event.target.dataset.currentStatus;
      let nextStatus = '';
      switch(currentStatus) {
        case 'Triado': nextStatus = 'Em Entrevista'; break;
        case 'Em Entrevista': nextStatus = 'Oferecido'; break;
        case 'Oferecido': nextStatus = 'Contratado'; break;
        default: nextStatus = 'Em Entrevista';
      }
      if (nextStatus) {
        await promoteCandidate(id, nextStatus);
      }
    });
  });

  document.querySelectorAll('.btn-transfer').forEach(button => {
    button.addEventListener('click', async (event) => {
      const id = event.target.dataset.id;
      await transferToHuman(id);
    });
  });
};

async function promoteCandidate(id, nextStatus) {
  try {
    const response = await fetch(`/api/selecao/promote/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nextStatus })
    });
    if (response.ok) {
      await fetchCandidatesForSelection();
      showToast(`Candidato ${id} promovido para ${nextStatus}!`);
    } else {
      const error = await response.json();
      showAlert(`Erro ao promover candidato: ${error.error}`);
    }
  } catch (error) {
    console.error('Erro de rede ao promover candidato:', error);
    showAlert('Erro de rede ao promover candidato.');
  }
};

async function transferToHuman(id) {
  if (!confirm('Tem certeza que deseja transferir este candidato para intervenção humana?')) return;
  try {
    const response = await fetch(`/api/selecao/transfer-human/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (response.ok) {
      await fetchCandidatesForSelection();
      showToast('Candidato transferido para intervenção humana com sucesso!');
    } else {
      const error = await response.json();
      showAlert(`Erro ao transferir candidato: ${error.error}`);
    }
  } catch (error) {
    console.error('Erro de rede ao transferir candidato:', error);
    showAlert('Erro de rede ao transferir candidato.');
  }
};

function bindNav() {
  document.getElementById('btnNext1').addEventListener('click', () => goStep(2))
  document.getElementById('btnBack2').addEventListener('click', () => goStep(1))
  document.getElementById('btnNext2').addEventListener('click', iniciarTriagem)
  document.getElementById('btnExport').addEventListener('click', e => { e.stopPropagation(); toggleExportMenu() })
  document.getElementById('btnExportXLSX').addEventListener('click', () => { closeExportMenu(); exportarXLSX(shortlistSorted()) })
  document.getElementById('btnExportMD').addEventListener('click',   () => { closeExportMenu(); exportarMD()   })
  document.getElementById('btnExportJSON').addEventListener('click', () => { closeExportMenu(); exportarJSON() })
  document.addEventListener('click', () => closeExportMenu())
  document.getElementById('btnNova').addEventListener('click', novaTriagem)
  document.getElementById('btnAddVaga').addEventListener('click', openModalNovaVaga)

  // Dropzone multi-arquivo
  const dz  = document.getElementById('dropzone')
  const mfi = document.getElementById('multiFileInput')

  dz.addEventListener('click', () => mfi.click())
  mfi.addEventListener('change', e => {
    if (e.target.files?.length) handleMultipleFiles(e.target.files)
    e.target.value = ''
  })
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over') })
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'))
  dz.addEventListener('drop', e => {
    e.preventDefault()
    dz.classList.remove('drag-over')
    if (e.dataTransfer.files?.length) handleMultipleFiles(e.dataTransfer.files)
  })
  document.getElementById('btnManageCandidates').addEventListener('click', () => {
    window.location.href = 'contato.html'
  })

  // Modal Nova Vaga
  const modal = document.getElementById('modalNovaVaga')
  const form = document.getElementById('formNovaVaga')

  // Event listeners do modal
  document.querySelector('.close-modal').addEventListener('click', () => closeModalNovaVaga())
  document.getElementById('cancelNovaVaga').addEventListener('click', () => closeModalNovaVaga())

  // Fechar ao clicar fora
  modal.addEventListener('click', e => {
    if (e.target === modal) closeModalNovaVaga()
  })

  // Submit do formulário
  form.addEventListener('submit', async e => {
    e.preventDefault()
    await criarNovaVaga()
  })
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
  if (n === 2 && S.vagaData)
    document.getElementById('s2Sub').textContent =
      `${S.vagaData.titulo} \u00b7 ${S.vagaData.marca} \u00b7 m\u00e1x. 10 candidatos`
}

// ─── Candidatos ──────────────────────────────────────────────────────────────
function addCandFromFile(fileName) {
  const id = ++S.nextCandId
  S.cands.push({ id, nome: '', curriculo: '', fileName, loading: true })
  renderCands()
  return id
}

async function handleMultipleFiles(fileList) {
  const files = Array.from(fileList)
  const slots = 10 - S.cands.length
  if (slots <= 0) { showToast('Limite de 10 candidatos atingido.', true); return }
  const toProcess = files.slice(0, slots)
  if (files.length > slots) showToast(`Apenas ${slots} arquivo(s) adicionado(s) — limite de 10.`, true)
  for (const file of toProcess) {
    const id = addCandFromFile(file.name)
    handleFile(id, file)
  }
}

async function removeCand(id) {
  // Tentar deletar do backend primeiro
  try {
    const resp = await fetch(`/api/candidates/${id}`, { method: 'DELETE' })
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}))
      throw new Error(data.error || `Erro ${resp.status}`)
    }
    // Se sucesso, remover da lista local
    S.cands = S.cands.filter(c => c.id !== id)
    renderCands()
    showToast('Candidato removido com sucesso')
  } catch (err) {
    // Se falhar (ex: candidato não existe no BD), apenas remove local
    console.warn('Falha ao deletar candidato do servidor:', err.message)
    S.cands = S.cands.filter(c => c.id !== id)
    renderCands()
    showToast('Removido da lista (não estava salvo no servidor)')
  }
}

function renderCands() {
  const lista = document.getElementById('candidatosList')
  lista.innerHTML = ''

  S.cands.forEach((c, i) => {
    const block = document.createElement('div')
    block.className   = 'cand-block'
    block.dataset.cid = c.id

    const nomeDisplay = c.loading
      ? `<span class="nome-badge extracting"><span class="spin-sm"></span> Extraindo...</span>`
      : `<span class="nome-badge">\uD83D\uDC64 ${esc(c.nome || 'Nome não identificado')}</span>`

    block.innerHTML = `
      <div class="cand-block-header">
        <div class="cand-file-info">
          <span class="cand-num">${String(i+1).padStart(2,'0')}</span>
          <span class="file-badge">${esc(c.fileName || 'arquivo')}</span>
          ${nomeDisplay}
        </div>
        <button type="button" class="btn-remove" data-remove="${c.id}">\u00d7</button>
      </div>
      ${c.loading ? `<div class="cv-parsing-inline"><div class="spin"></div> Lendo currículo...</div>` : ''}
      ${!c.loading && c.curriculo ? `<div class="cand-ok">\u2713 Pronto \u2014 ${c.curriculo.length.toLocaleString('pt-BR')} caracteres</div>` : ''}
      ${!c.loading && !c.curriculo ? `<div class="cand-err">\u26a0 Não foi possível extrair texto deste arquivo</div>` : ''}`

    block.querySelector('[data-remove]')?.addEventListener('click', () => removeCand(c.id))
    lista.appendChild(block)
  })

  const count = S.cands.length
  document.getElementById('candCount').textContent = count
  document.getElementById('candCounterRow').style.display = count > 0 ? '' : 'none'
  document.getElementById('dropzone').style.display = count >= 10 ? 'none' : ''
  validateCands()
}

function syncCand(id, field, value) {
  const c = S.cands.find(c => c.id === id)
  if (c) c[field] = value
  validateCands()
}

function validateCands() {
  const ok = S.cands.some(c => !c.loading && c.curriculo?.trim())
  document.getElementById('btnNext2').disabled = !ok
}

// ─── File parsing ─────────────────────────────────────────────────────────────
async function handleFile(id, file) {
  const ext = file.name.split('.').pop().toLowerCase()
  if (!['pdf','docx','doc','txt'].includes(ext)) {
    S.cands = S.cands.filter(c => c.id !== id)
    renderCands()
    return showToast(`${file.name}: formato não suportado. Use PDF, DOCX ou TXT.`, true)
  }

  try {
    let texto = ''
    if (ext === 'txt')       texto = await parseTXT(file)
    else if (ext === 'pdf')  texto = await parsePDF(file)
    else                     texto = await parseDOCX(file)

    const nome = detectNome(texto) || file.name.replace(/\.[^/.]+$/, '')
    syncCand(id, 'curriculo', texto)
    syncCand(id, 'nome', nome)
    syncCand(id, 'loading', false)
    renderCands()
  } catch (err) {
    syncCand(id, 'loading', false)
    renderCands()
    showToast(`${file.name}: ${err.message || 'Erro ao processar arquivo.'}`, true)
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
  for (const linha of texto.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 5)) {
    const palavras = linha.split(/\s+/)
    if (palavras.length >= 2 && palavras.length <= 5 && /^[A-Za-z\u00C0-\u00FF\s]+$/.test(linha) && linha.length < 60)
      return linha
  }
  return null
}

// ─── Triagem ─────────────────────────────────────────────────────────────────
async function iniciarTriagem() {
  const validos = S.cands.filter(c => !c.loading && c.curriculo?.trim())
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
      <div class="dim-bar"><div class="dim-fill" style="width:${pct}%;background:${c}"></div></div>
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
      <div class="score-ring" style="background:${ring}">
        <span class="score-val" style="color:${col}">${r.scoreTotal}</span>
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
        <button type="button" class="btn-action btn-sl" data-sl="${idx}">\u2714 Aceitar</button>
        <button type="button" class="btn-action btn-dp" data-dp="${idx}">\u00d7 Dispensar</button>
        <button type="button" class="btn-action btn-cp" data-cp="${idx}">Copiar</button>
        <button type="button" class="btn-action btn-xlsx" data-xlsx="${idx}" title="Exportar planilha individual">\uD83D\uDCCA .xlsx</button>
      </div>
    </div>`

  card.querySelector('.rc-head').addEventListener('click', () => card.classList.toggle('open'))

  card.querySelector('[data-sl]').addEventListener('click', async e => {
    e.stopPropagation()
    const btn = e.currentTarget
    const dpBtn = card.querySelector('[data-dp]')
    if (S.shortlist.has(idx)) {
      S.shortlist.delete(idx)
      btn.classList.remove('on')
    } else {
      S.shortlist.add(idx)
      S.dispensados.delete(idx)
      btn.classList.add('on')
      dpBtn.classList.remove('on')
      await saveCandidate(idx, 'Aprovado na Triagem')
    }
    document.getElementById('btnExport').disabled = S.shortlist.size === 0
    updateGerenciarBadge()
  })

  card.querySelector('[data-dp]').addEventListener('click', async e => {
    e.stopPropagation()
    const btn = e.currentTarget
    const slBtn = card.querySelector('[data-sl]')
    if (S.dispensados.has(idx)) {
      S.dispensados.delete(idx)
      btn.classList.remove('on')
    } else {
      S.dispensados.add(idx)
      S.shortlist.delete(idx)
      btn.classList.add('on')
      slBtn.classList.remove('on')
      document.getElementById('btnExport').disabled = S.shortlist.size === 0
      await saveCandidate(idx, 'Dispensado')
    }
    updateGerenciarBadge()
  })

  card.querySelector('[data-cp]').addEventListener('click', e => {
    e.stopPropagation()
    copiarAnalise(idx)
  })

  card.querySelector('[data-xlsx]').addEventListener('click', e => {
    e.stopPropagation()
    exportarXLSX([S.resultados[idx]])
  })

  document.getElementById('resLista').appendChild(card)
}

function bindResults() {
  // ligado via bindNav()
}

// ─── Salvar candidato no banco ────────────────────────────────────────────────
async function saveCandidate(idx, status) {
  const r = S.resultados[idx]
  if (!r) return
  try {
    await fetch('/api/screen/save-candidate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        nome:          r.nome,
        vagaId:        S.vagaId,
        status,
        scoreTotal:    r.scoreTotal,
        recomendacao:  r.recomendacao,
        resumo:        r.resumo,
        dimensoes:     r.dimensoes,
        pontosFort:    r.pontosFort,
        pontosAtencao: r.pontosAtencao,
      }),
    })
  } catch (e) {
    console.error('Erro ao salvar candidato:', e)
  }
}

function updateGerenciarBadge() {
  const n   = S.shortlist.size
  const btn = document.getElementById('btnManageCandidates')
  if (!btn) return
  btn.textContent = n > 0
    ? `\uD83D\uDCCB Ir para Contato (${n} aceito${n > 1 ? 's' : ''})`
    : '\uD83D\uDCCB Gerenciar Candidatos'
  btn.disabled = false
}

// ─── Exportar ────────────────────────────────────────────────────────────────
function toggleExportMenu() {
  const menu = document.getElementById('exportMenu')
  menu.classList.toggle('open')
}
function closeExportMenu() {
  document.getElementById('exportMenu')?.classList.remove('open')
}

function shortlistSorted() {
  return S.resultados
    .map((r, i) => ({ ...r, _i: i }))
    .filter(r => S.shortlist.has(r._i))
    .sort((a, b) => b.scoreTotal - a.scoreTotal)
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime })
  const url  = URL.createObjectURL(blob)
  Object.assign(document.createElement('a'), { href: url, download: filename }).click()
  URL.revokeObjectURL(url)
}

function vagaSlug() {
  return (S.vagaData?.titulo || 'candidatos').toLowerCase().replace(/\s+/g, '-')
}

async function exportarXLSX(candidatos) {
  if (!candidatos || !candidatos.length) return
  try {
    const r = await fetch('/api/shortlist/xlsx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vaga: S.vagaData, candidatos }),
    })
    if (!r.ok) throw new Error('Erro ao gerar planilha')
    const blob = await r.blob()
    const url  = URL.createObjectURL(blob)
    const slug = (S.vagaData?.titulo || 'shortlist').toLowerCase().replace(/\s+/g, '-')
    const nome = `shortlist-${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`
    Object.assign(document.createElement('a'), { href: url, download: nome }).click()
    URL.revokeObjectURL(url)
    showToast(`Planilha exportada — ${candidatos.length} candidato(s)`)
  } catch (e) {
    showToast(e.message, true)
  }
}

function exportarMD() {
  if (!S.shortlist.size) return
  const data = new Date().toLocaleDateString('pt-BR')
  const cands = shortlistSorted()
  const lines = [
    `# Shortlist — ${S.vagaData?.titulo}`,
    `**Marca:** ${S.vagaData?.marca}  `,
    `**Data:** ${data}  `,
    `**Candidatos selecionados:** ${cands.length}`,
    '', '---', '',
  ]
  cands.forEach((r, i) => {
    const rec = r.recomendacao || ''
    lines.push(
      `## ${i+1}. ${r.nome} — Score: ${r.scoreTotal}/100`,
      `**Recomendação:** ${rec}  `,
      '',
      `> ${r.resumo || ''}`,
      '',
      '### Dimensões',
      '| Dimensão | Score | Justificativa |',
      '|---|---|---|',
      ...Object.entries(DIM_LABELS).map(([k, l]) => {
        const d = r.dimensoes?.[k] || {}
        return `| ${l} | ${d.score ?? '—'}/10 | ${d.justificativa || ''} |`
      }),
      '',
      '### Pontos Fortes',
      ...(r.pontosFort    || []).map(p => `- ✅ ${p}`),
      '',
      '### Pontos de Atenção',
      ...(r.pontosAtencao || []).map(p => `- ⚠️ ${p}`),
      '', '---', '',
    )
  })
  const fname = `shortlist-${vagaSlug()}-${new Date().toISOString().slice(0,10)}.md`
  downloadBlob(lines.join('\n'), fname, 'text/markdown;charset=utf-8')
  showToast(`Shortlist .md exportado — ${cands.length} candidato(s)`)
}

function exportarJSON() {
  if (!S.shortlist.size) return
  const cands = shortlistSorted()
  const payload = {
    vaga: { titulo: S.vagaData?.titulo, marca: S.vagaData?.marca },
    gerado_em: new Date().toISOString(),
    total: cands.length,
    candidatos: cands.map((r, i) => ({
      posicao:       i + 1,
      nome:          r.nome,
      score:         r.scoreTotal,
      recomendacao:  r.recomendacao,
      resumo:        r.resumo || '',
      dimensoes:     Object.fromEntries(
        Object.entries(DIM_LABELS).map(([k]) => [k, r.dimensoes?.[k] || {}])
      ),
      pontos_fortes:  r.pontosFort    || [],
      pontos_atencao: r.pontosAtencao || [],
    })),
  }
  const fname = `shortlist-${vagaSlug()}-${new Date().toISOString().slice(0,10)}.json`
  downloadBlob(JSON.stringify(payload, null, 2), fname, 'application/json;charset=utf-8')
  showToast(`Shortlist .json exportado — ${cands.length} candidato(s)`)
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
  document.getElementById('dropzone').style.display = ''
  document.getElementById('candCounterRow').style.display = 'none'
  document.getElementById('candidatosList').innerHTML = ''
  const tinderBtn = document.getElementById('btnTinderMode')
  if (tinderBtn) tinderBtn.remove()
  goStep(1)
}

// ─── Nova Vaga ──────────────────────────────────────────────────────────────────
function openModalNovaVaga() {
  const modal = document.getElementById('modalNovaVaga')
  modal.style.display = 'flex'
  setTimeout(() => modal.classList.add('show'), 10)
  formNovaVaga.reset()
}

function closeModalNovaVaga() {
  const modal = document.getElementById('modalNovaVaga')
  modal.classList.remove('show')
  setTimeout(() => modal.style.display = 'none', 300)
}

async function criarNovaVaga() {
  const id = document.getElementById('vagaId').value.trim()
  const titulo = document.getElementById('vagaTitulo').value.trim()
  const marca = document.getElementById('vagaMarca').value.trim()
  const descricao = document.getElementById('vagaDescricao').value.trim()
  const requisitos = document.getElementById('vagaRequisitos').value.trim().split('\n').filter(r => r.trim())
  const diferenciais = document.getElementById('vagaDiferenciais').value.trim().split('\n').filter(d => d.trim())
  const competencias = document.getElementById('vagaCompetencias').value.trim().split('\n').filter(c => c.trim())
  const salario = document.getElementById('vagaSalario').value.trim()
  const regime = document.getElementById('vagaRegime').value.trim()

  try {
    const resp = await fetch('/api/vagas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        titulo,
        marca,
        descricao,
        requisitos,
        diferenciais,
        competencias,
        salario,
        regime
      })
    })

    const data = await resp.json()

    if (!resp.ok) {
      throw new Error(data.error || 'Erro ao criar vaga')
    }

    showToast('Vaga criada com sucesso!')
    closeModalNovaVaga()

    // Recarregar vagas
    await loadVagas()

    // Selecionar a nova vaga
    selectVaga(id)

  } catch (err) {
    showToast(err.message, true)
  }
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

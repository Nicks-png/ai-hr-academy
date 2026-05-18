'use strict'

if (typeof requireAuth === 'function' && !requireAuth('whatsapp')) throw new Error('not auth')

// ── State ─────────────────────────────────────────────────────────────────────
let candidates     = []
let responses      = []
let unreadCount    = 0
let selected       = new Set()
let collapsedGroups = new Set()

// ── Init ──────────────────────────────────────────────────────────────────────
;(async () => {
  checkAPIStatus()
  checkWAStatus(false)
  await loadCandidates()
  await loadResponses()
  connectSSE()
})()

// ── API status ────────────────────────────────────────────────────────────────
async function checkAPIStatus() {
  try {
    const d = await fetch('/api/status').then(r => r.json())
    document.getElementById('apiDot').className = `api-dot ${d.ok ? 'ok' : 'err'}`
    document.getElementById('apiTxt').textContent = d.ok ? d.model : 'sem chave'
  } catch { document.getElementById('apiTxt').textContent = 'offline' }
}

async function checkWAStatus(showQR = false) {
  try {
    const d      = await fetch('/api/whatsapp/status').then(r => r.json())
    const dot    = document.getElementById('waDot')
    const txt    = document.getElementById('waTxt')
    const banner = document.getElementById('mockBanner')
    const btnConnect    = document.getElementById('btnConnectWA')
    const btnDisconnect = document.getElementById('btnDisconnectWA')
    const statusLbl     = document.getElementById('waConnectStatus')
    if (d.connected) {
      dot.className = 'wa-dot on'; txt.textContent = 'Conectado'
      banner.classList.remove('on')
      if (btnConnect)    btnConnect.style.display    = 'none'
      if (btnDisconnect) btnDisconnect.style.display = ''
      if (statusLbl)     statusLbl.textContent       = 'WhatsApp conectado e recebendo mensagens.'
    } else {
      dot.className = 'wa-dot'; txt.textContent = d.hasQR ? 'Aguardando QR...' : 'Desconectado'
      banner.classList.add('on')
      if (btnConnect)    btnConnect.style.display    = ''
      if (btnDisconnect) btnDisconnect.style.display = 'none'
      if (statusLbl)     statusLbl.textContent       = d.hasQR ? 'Aguardando leitura do QR Code...' : 'Desconectado — seu celular recebe notificações normalmente.'
      if (showQR) loadQR()
    }
  } catch { document.getElementById('waTxt').textContent = 'Erro' }
}

async function connectWA() {
  const btn = document.getElementById('btnConnectWA')
  const lbl = document.getElementById('waConnectStatus')
  btn.disabled = true
  if (lbl) lbl.textContent = 'Conectando...'
  try {
    await fetch('/api/whatsapp/connect', { method: 'POST' })
    await new Promise(r => setTimeout(r, 1500))
    await checkWAStatus(true)
  } catch (e) {
    if (lbl) lbl.textContent = 'Erro ao conectar.'
  } finally {
    btn.disabled = false
  }
}

async function disconnectWA() {
  if (!confirm('Desconectar o WhatsApp? Seu celular voltará a receber notificações normalmente.')) return
  const btn = document.getElementById('btnDisconnectWA')
  btn.disabled = true
  try {
    await fetch('/api/whatsapp/disconnect', { method: 'POST' })
    await checkWAStatus(false)
    showToast('WhatsApp desconectado.')
  } catch {
    showToast('Erro ao desconectar.')
  } finally {
    btn.disabled = false
  }
}

async function loadQR() {
  openModal('modalQR')
  document.getElementById('qrLoading2').style.display = 'block'
  document.getElementById('qrImg2').style.display     = 'none'
  try {
    const d = await fetch('/api/whatsapp/qr').then(r => r.json())
    if (d.qr) {
      document.getElementById('qrImg2').src             = d.qr
      document.getElementById('qrImg2').style.display   = 'block'
      document.getElementById('qrLoading2').style.display = 'none'
    } else {
      document.getElementById('qrLoading2').textContent = d.error || 'QR n\u00e3o dispon\u00edvel.'
    }
  } catch (err) {
    document.getElementById('qrLoading2').textContent = err.message
  }
}

// ── Candidates ────────────────────────────────────────────────────────────────
async function loadCandidates() {
  try {
    candidates = await fetch('/api/candidates').then(r => r.json())
    populateVagaFilter()
    renderGroups()
    populateSimSelect()
    window.VOICE_CONTEXT = {
      page: 'whatsapp',
      total: candidates.length,
      pendentes: candidates.filter(c => c.status === 'Pendente').length,
    }
  } catch {
    document.getElementById('candGroups').innerHTML =
      '<div class="cand-loading" style="color:var(--red)">Erro ao carregar. Verifique o servidor.</div>'
  }
}

function updateStats() {
  const el = document.getElementById('waStats')
  if (!el) return
  el.style.display = candidates.length ? 'grid' : 'none'
  document.getElementById('statTotal').textContent = candidates.length
  document.getElementById('statConf').textContent  = candidates.filter(c => c.status === 'Confirmado').length
  document.getElementById('statPend').textContent  = candidates.filter(c => c.status === 'Pendente').length
  document.getElementById('statRec').textContent   = candidates.filter(c => c.status === 'Recusado').length
}

function populateVagaFilter() {
  const sel = document.getElementById('vagaFilter')
  const cur = sel.value
  const vagas = [...new Set(candidates.map(c => c.job_position).filter(Boolean))].sort()
  sel.innerHTML = '<option value="">Todas as vagas</option>'
  vagas.forEach(v => {
    const o = document.createElement('option')
    o.value = v; o.textContent = v
    if (v === cur) o.selected = true
    sel.appendChild(o)
  })
}

function filterCandidates() {
  renderGroups()
}

function renderGroups() {
  const term  = (document.getElementById('candSearch')?.value || '').toLowerCase()
  const vaga  = document.getElementById('vagaFilter')?.value || ''
  const container = document.getElementById('candGroups')

  document.getElementById('candTabCount').textContent = `(${candidates.length})`
  updateStats()

  let list = candidates
  if (vaga) list = list.filter(c => c.job_position === vaga)
  if (term) list = list.filter(c =>
    (c.name || '').toLowerCase().includes(term) ||
    (c.job_position || '').toLowerCase().includes(term)
  )

  if (!list.length) {
    container.innerHTML = '<div class="cand-loading">Nenhum candidato encontrado.</div>'
    updateSelCount()
    return
  }

  // Agrupa por vaga
  const groups = {}
  list.forEach(c => {
    const key = c.job_position || 'Sem vaga'
    if (!groups[key]) groups[key] = []
    groups[key].push(c)
  })

  // Ordena cada grupo por score desc
  Object.values(groups).forEach(g =>
    g.sort((a, b) => (b.ai_score_total || 0) - (a.ai_score_total || 0))
  )

  container.innerHTML = Object.entries(groups).map(([vagaKey, cands]) => {
    const collapsed = collapsedGroups.has(vagaKey)
    const rows = cands.map((c, rank) => {
      const isDisabled  = c.status !== 'Pendente'
      const checked     = selected.has(c.id) ? 'checked' : ''
      const score       = c.ai_score_total
      const scoreColor  = score >= 66 ? 'var(--green)' : score >= 41 ? 'var(--amber)' : score ? 'var(--red)' : 'var(--text3)'
      const organicBadge = c.source === 'organico'
        ? '<span class="source-badge source-organico">\uD83C\uDF31 Org\u00e2nico</span>' : ''
      const cvBtn = c.cv_text
        ? `<button type="button" class="btn-icon-sm" title="Ver curr\u00edculo" onclick="openCVModal(${c.id})">&#128196;</button>` : ''
      let hasAnswers = false
      try { hasAnswers = JSON.parse(c.answers || '[]').some(a => a.resposta) } catch {}
      const answersBtn = hasAnswers
        ? `<button type="button" class="btn-icon-sm" title="Ver respostas" onclick="openAnswersModal(${c.id})">&#128172;</button>` : ''

      return `<div class="cand-row" id="row-${c.id}">
        <input type="checkbox" class="cand-check" ${checked} ${isDisabled ? 'disabled title="J\u00e1 foi contatado"' : ''}
          onchange="toggleSelect(${c.id}, this.checked)"/>
        <span class="cand-rank">#${rank + 1}</span>
        <span class="cand-score" style="color:${scoreColor}">${score || '—'}</span>
        <div class="cand-info">
          <span class="cand-name">${esc(c.name)}${organicBadge}${cvBtn}${answersBtn}</span>
          <span class="cand-phone">${formatPhone(c.phone)}</span>
        </div>
        <div class="cand-right">
          <select style="font-size:.72rem;padding:3px 6px;border-radius:7px;background:#0d0d2b;border:1px solid var(--glass-b);color:#e2e8f0;cursor:pointer"
            onchange="updateCandStatus(${c.id}, this.value)" title="Alterar status">
            ${['Pendente','Aprovado na Triagem','Contato enviado','Confirmado','Recusado'].map(s =>
              `<option value="${s}" ${c.status===s?'selected':''} style="background:#0d0d2b;color:#e2e8f0">${s}</option>`
            ).join('')}
          </select>
          <span class="cand-date">${fmtDate(c.created_at)}</span>
          <button type="button" class="btn btn-danger" style="padding:4px 9px;font-size:.7rem"
            onclick="deleteCandidate(${c.id})">\u00d7</button>
        </div>
      </div>`
    }).join('')

    return `<div class="cand-group">
      <div class="cand-group-hdr" onclick="toggleGroup(${JSON.stringify(vagaKey)})">
        <span class="cg-arrow ${collapsed ? 'collapsed' : ''}">&#9660;</span>
        <span class="cg-title">${esc(vagaKey)}</span>
        <span class="cg-count">${cands.length} candidato(s)</span>
      </div>
      <div class="cand-group-body ${collapsed ? 'collapsed' : ''}">${rows}</div>
    </div>`
  }).join('')

  updateSelCount()
}

function toggleGroup(key) {
  if (collapsedGroups.has(key)) collapsedGroups.delete(key)
  else collapsedGroups.add(key)
  renderGroups()
}

function toggleSelect(id, checked) {
  if (checked) selected.add(id); else selected.delete(id)
  updateSelCount()
}

function updateSelCount() {
  const n = selected.size
  document.getElementById('selNum').textContent      = n
  document.getElementById('btnAdvance').disabled     = n === 0
}

async function advanceSelected() {
  if (!selected.size) return
  const ids = [...selected]
  selected.clear()

  const prog = document.getElementById('advanceProgress')
  prog.classList.add('on')
  document.getElementById('btnAdvance').disabled     = true
  document.getElementById('progTxt').textContent     = `Enviando para ${ids.length} candidato(s)...`
  document.getElementById('progFill').style.width    = '10%'
  document.getElementById('progPct').textContent     = '10%'

  try {
    const res = await fetch('/api/candidates/advance', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ids }),
    }).then(r => r.json())

    const ok  = res.results?.filter(r => r.ok).length || 0
    const err = res.results?.filter(r => !r.ok && !r.skipped).length || 0

    document.getElementById('progFill').style.width = '100%'
    document.getElementById('progPct').textContent  = '100%'
    document.getElementById('progTxt').textContent  = `\u2713 ${ok} enviado(s)${err ? ` \u00b7 ${err} falha(s)` : ''}`

    if (err) showToast(`${ok} enviados, ${err} com falha.`, true)
    else     showToast(`\u2713 ${ok} mensagem(ns) enviada(s)`)

    setTimeout(() => prog.classList.remove('on'), 3000)
    await loadCandidates()
  } catch (err) {
    showToast(err.message, true)
    prog.classList.remove('on')
    document.getElementById('btnAdvance').disabled = false
  }
}

async function updateCandStatus(id, nextStatus) {
  try {
    const r = await fetch(`/api/selecao/promote/${id}`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ nextStatus })
    })
    if (!r.ok) { showToast('Erro ao atualizar status.', true); await loadCandidates(); return }
    const idx = candidates.findIndex(c => c.id === id)
    if (idx >= 0) candidates[idx].status = nextStatus
    showToast(`Status atualizado: ${nextStatus}`)
    updateStats()
  } catch { showToast('Erro de conexão.', true) }
}

async function deleteCandidate(id) {
  if (!confirm('Remover este candidato?')) return
  await fetch(`/api/candidates/${id}`, { method: 'DELETE' })
  selected.delete(id)
  await loadCandidates()
  showToast('Candidato removido')
}

// ── Add candidate modal ───────────────────────────────────────────────────────
function openAddModal() {
  document.getElementById('addName').value  = ''
  document.getElementById('addPhone').value = ''
  document.getElementById('addJob').value   = ''
  openModal('modalAdd')
}

async function addCandidate() {
  const name         = document.getElementById('addName').value.trim()
  const phone        = document.getElementById('addPhone').value.trim()
  const job_position = document.getElementById('addJob').value.trim()
  if (!name || !phone || !job_position) return showToast('Preencha todos os campos.', true)

  try {
    const r = await fetch('/api/candidates', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, phone, job_position }),
    })
    const d = await r.json()
    if (!r.ok) return showToast(d.error || 'Erro ao adicionar.', true)
    closeModal('modalAdd')
    await loadCandidates()
    showToast(`\u2713 ${name} adicionado(a)`)
  } catch (err) {
    showToast(err.message, true)
  }
}

// ── Responses ─────────────────────────────────────────────────────────────────
async function loadResponses() {
  try {
    responses = await fetch('/api/responses').then(r => r.json())
    renderResponses()
    populateSimSelect()
  } catch { console.error('Erro ao carregar respostas') }
}

function renderResponses() {
  const feed  = document.getElementById('responsesFeed')
  unreadCount = responses.filter(r => !r.is_read).length
  updateUnreadBadge()
  document.getElementById('respTotal').textContent = responses.length

  if (!responses.length) {
    feed.innerHTML = '<div class="resp-empty">Nenhuma resposta ainda. Envie mensagens para os candidatos primeiro.</div>'
    return
  }

  feed.innerHTML = responses.map(r => {
    const initials = (r.candidate_name || r.phone || '?')
      .split(' ').slice(0,2).map(w => w[0]?.toUpperCase() || '').join('')
    return `
    <div class="resp-card ${r.is_read ? '' : 'unread'}" id="resp-${r.id}" onclick="markRead(${r.id})">
      <div class="resp-avatar">${esc(initials || '?')}</div>
      <div class="resp-body">
        <div class="resp-top">
          <span class="resp-name">${esc(r.candidate_name || 'Desconhecido')}</span>
          <span class="resp-time">${fmtTime(r.received_at)}</span>
        </div>
        <div class="resp-vaga">${esc(r.job_position || '')} \u00b7 ${esc(r.phone || '')}</div>
        <div class="resp-bubble">${esc(r.message)}</div>
        ${r.candidate_status ? `<div style="margin-top:8px">${statusBadge(r.candidate_status)}</div>` : ''}
        ${!r.is_read ? `<div class="resp-bottom">
          <div class="resp-unread-dot"></div>
          <span class="btn-read">Marcar como lida</span>
        </div>` : ''}
      </div>
    </div>`
  }).join('')
}

async function markRead(id) {
  const card = document.getElementById(`resp-${id}`)
  if (!card?.classList.contains('unread')) return
  card.classList.remove('unread')
  await fetch(`/api/responses/${id}/read`, { method: 'PATCH' })
  const r = responses.find(r => r.id === id)
  if (r) r.is_read = 1
  unreadCount = Math.max(0, unreadCount - 1)
  updateUnreadBadge()
  renderResponses()
}

// ── Simulator ─────────────────────────────────────────────────────────────────
function populateSimSelect() {
  const sel = document.getElementById('simPhone')
  const cur = sel.value
  sel.innerHTML = '<option value="">Selecione o candidato...</option>'
  candidates.forEach(c => {
    const opt = document.createElement('option')
    opt.value       = c.phone
    opt.textContent = `${c.name} (${formatPhone(c.phone)})`
    if (c.phone === cur) opt.selected = true
    sel.appendChild(opt)
  })
}

async function simResponse() {
  const phone = document.getElementById('simPhone').value
  const text  = document.getElementById('simText').value.trim()
  if (!phone) return showToast('Selecione um candidato.', true)
  if (!text)  return showToast('Digite uma mensagem.', true)
  try {
    await fetch('/webhook/test', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ phone, text }),
    })
    document.getElementById('simText').value = ''
    showToast('\u2713 Resposta simulada enviada')
  } catch (err) {
    showToast(err.message, true)
  }
}

// ── SSE ───────────────────────────────────────────────────────────────────────
function connectSSE() {
  const es = new EventSource('/events/whatsapp')
  es.onmessage = e => {
    try {
      const d = JSON.parse(e.data)
      if (d.type === 'wa_status') {
        checkWAStatus(false)
        if (d.qr)        showToast('\uD83D\uDCF1 QR Code pronto \u2014 clique em WhatsApp para escanear')
        if (d.connected) showToast('\u2713 WhatsApp conectado!')
        return
      }
      if (d.type === 'status_update' && d.candidate) {
        const idx = candidates.findIndex(c => c.id === d.candidate.id)
        if (idx >= 0) candidates[idx] = d.candidate; else candidates.unshift(d.candidate)
        renderGroups()
      } else if (d.type === 'new_response') {
        if (d.candidate) {
          const idx = candidates.findIndex(c => c.id === d.candidate.id)
          if (idx >= 0) candidates[idx] = d.candidate
          renderGroups()
        }
        if (d.message) {
          responses.unshift(d.message)
          renderResponses()
          showToast('\uD83D\uDCAC Nova resposta recebida!')
        }
      }
    } catch {}
  }
  es.onerror = () => setTimeout(connectSSE, 5000)
}

// ── CV + Answers modals ───────────────────────────────────────────────────────
function openCVModal(id) {
  const c = candidates.find(x => x.id === id)
  if (!c) return
  document.getElementById('modalCVTitle').textContent = c.name
  document.getElementById('modalCVBody').textContent  = c.cv_text || '(sem currículo)'
  openModal('modalCV')
}

function openAnswersModal(id) {
  const c = candidates.find(x => x.id === id)
  if (!c) return
  let answers = []
  try { answers = JSON.parse(c.answers || '[]') } catch {}
  document.getElementById('modalAnswersTitle').textContent = c.name
  const body = document.getElementById('modalAnswersBody')
  body.innerHTML = answers.length
    ? answers.map((a, i) => `
        <div style="padding:14px;border-radius:10px;background:var(--glass);border:1px solid var(--glass-b);margin-bottom:10px">
          <div style="font-size:.72rem;font-weight:700;color:var(--purple);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Pergunta ${i + 1}</div>
          <div style="font-size:.88rem;font-weight:600;color:var(--text);margin-bottom:8px">${esc(a.pergunta)}</div>
          <div style="font-size:.84rem;color:var(--text2);line-height:1.6">${esc(a.resposta || '(sem resposta)')}</div>
        </div>`).join('')
    : '<p style="color:var(--text3);font-size:.85rem">Nenhuma resposta disponível.</p>'
  openModal('modalAnswers')
}

// ── Portal QR Code ────────────────────────────────────────────────────────────
let portalQRInited = false

function initPortalQR() {
  if (portalQRInited) return
  portalQRInited = true
  const qrDiv   = document.getElementById('portalQRCode')
  const linkEl  = document.getElementById('portalQRLink')
  if (!qrDiv) return
  const url = window.location.origin + '/candidato.html'
  if (linkEl) linkEl.textContent = url
  if (typeof QRCode !== 'undefined') {
    new QRCode(qrDiv, { text: url, width: 180, height: 180, colorDark: '#000', colorLight: '#fff' })
  } else {
    // Fallback: QR Code via public API image
    const img = document.createElement('img')
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`
    img.alt = 'QR Code Portal Candidatos'
    img.style.borderRadius = '8px'
    qrDiv.appendChild(img)
  }
}

function copyPortalLink() {
  const url = window.location.origin + '/candidato.html'
  navigator.clipboard?.writeText(url)
    .then(() => showToast('Link copiado!'))
    .catch(() => showToast('Copie manualmente: ' + url))
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name))
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === `tab-${name}`))
  if (name === 'responses') { responses.filter(r => !r.is_read).forEach(r => markRead(r.id)) }
  if (name === 'setup') initPortalQR()
}

function updateUnreadBadge() {
  const badge = document.getElementById('unreadBadge')
  badge.textContent = unreadCount > 99 ? '99+' : unreadCount
  badge.classList.toggle('on', unreadCount > 0)
}

// ── Modals ────────────────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('on') }
function closeModal(id) { document.getElementById(id).classList.remove('on') }
document.querySelectorAll('.modal-overlay').forEach(m =>
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('on') }))

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusBadge(s) {
  const map = {
    'Pendente':        ['s-pendente',   '\u23f3 Pendente'],
    'Contato enviado': ['s-enviado',    '\uD83D\uDCE8 Enviado'],
    'Confirmado':      ['s-confirmado', '\u2705 Confirmado'],
    'Recusado':        ['s-recusado',   '\u274C Recusado'],
    'Resposta manual': ['s-manual',     '\uD83D\uDCAC Manual'],
  }
  const [cls, label] = map[s] || ['s-pendente', s]
  return `<span class="status ${cls}">${label}</span>`
}

function formatPhone(p) {
  if (!p) return '\u2014'
  const d = p.replace(/\D/g, '')
  if (d.length === 13) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`
  if (d.length === 12) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`
  return p
}

function fmtDate(dt) {
  if (!dt) return '\u2014'
  const d = new Date(dt)
  return isNaN(d) ? dt : d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' })
}

function fmtTime(dt) {
  if (!dt) return ''
  const d   = new Date(dt)
  if (isNaN(d)) return dt
  const now  = new Date()
  const diff = Math.floor((now - d) / 1000)
  if (diff < 60)    return 'agora'
  if (diff < 3600)  return `${Math.floor(diff/60)}min`
  if (diff < 86400) return `${Math.floor(diff/3600)}h`
  return d.toLocaleDateString('pt-BR')
}

function esc(s) {
  return (s || '').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function copyCmd(el) {
  navigator.clipboard?.writeText(el.textContent.trim())
    .then(() => showToast('Copiado!'))
    .catch(() => {})
}

let toastT
function showToast(msg, err = false) {
  clearTimeout(toastT)
  const t = document.getElementById('toast')
  t.textContent = msg
  t.className   = err ? 'err show' : 'show'
  toastT = setTimeout(() => t.classList.remove('show'), 3000)
}

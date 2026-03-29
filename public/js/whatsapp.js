'use strict'

// ── State ─────────────────────────────────────────────────────────────────────
let candidates  = []
let responses   = []
let unreadCount = 0
let selected    = new Set()

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
    if (d.connected) {
      dot.className = 'wa-dot on'; txt.textContent = 'Conectado'
      banner.classList.remove('on')
    } else {
      dot.className = 'wa-dot'; txt.textContent = d.hasQR ? 'Aguardando QR...' : 'Desconectado'
      banner.classList.add('on')
      if (showQR) loadQR()
    }
  } catch { document.getElementById('waTxt').textContent = 'Erro' }
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
    renderTable()
    populateSimSelect()
  } catch {
    document.getElementById('tbody').innerHTML =
      '<tr class="empty-row"><td colspan="7">Erro ao carregar. Verifique o servidor.</td></tr>'
  }
}

function renderTable() {
  const tbody = document.getElementById('tbody')
  document.getElementById('candTabCount').textContent = `(${candidates.length})`

  if (!candidates.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Nenhum candidato ainda. Clique em "+ Candidato".</td></tr>'
    return
  }

  tbody.innerHTML = candidates.map(c => {
    const isDisabled = c.status !== 'Pendente'
    const checked    = selected.has(c.id) ? 'checked' : ''
    return `
    <tr id="row-${c.id}">
      <td class="td-check">
        <input type="checkbox" ${checked} ${isDisabled ? 'disabled title="J\u00e1 foi contatado"' : ''}
          onchange="toggleSelect(${c.id}, this.checked)"/>
      </td>
      <td class="td-name">${esc(c.name)}</td>
      <td style="color:var(--text2);font-size:.8rem">${esc(c.job_position)}</td>
      <td class="td-phone">${formatPhone(c.phone)}</td>
      <td>${statusBadge(c.status)}</td>
      <td class="td-date">${fmtDate(c.created_at)}</td>
      <td>
        <button type="button" class="btn btn-danger" style="padding:5px 10px;font-size:.7rem"
          onclick="deleteCandidate(${c.id})">\u00d7</button>
      </td>
    </tr>`
  }).join('')

  updateSelCount()
}

function toggleSelect(id, checked) {
  if (checked) selected.add(id); else selected.delete(id)
  updateSelCount()
}

function toggleAll(el) {
  const eligible = candidates.filter(c => c.status === 'Pendente').map(c => c.id)
  if (el.checked) eligible.forEach(id => selected.add(id))
  else selected.clear()
  renderTable()
  document.getElementById('checkAll').checked = el.checked
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
        renderTable()
      } else if (d.type === 'new_response') {
        if (d.candidate) {
          const idx = candidates.findIndex(c => c.id === d.candidate.id)
          if (idx >= 0) candidates[idx] = d.candidate
          renderTable()
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

// ── Tabs ──────────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name))
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === `tab-${name}`))
  if (name === 'responses') { responses.filter(r => !r.is_read).forEach(r => markRead(r.id)) }
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

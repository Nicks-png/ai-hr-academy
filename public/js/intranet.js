'use strict'

if (!requireAuth()) throw new Error('not auth')

const user  = getUser()
const tools = getTools()

;(async () => {
  if (sessionStorage.getItem('aihr_just_logged_in')) {
    document.body.classList.add('page-enter')
    sessionStorage.removeItem('aihr_just_logged_in')
  }
  renderGreeting()
  renderAccess()
  loadStatusChips()
  loadStats()
  loadPipeline()
  loadRecentScreenings()
})()

initOutlookHub()
// Atualiza o card do Outlook quando o MSAL salva/remove conta no localStorage
// (acontece quando o login completa em outra aba)
window.addEventListener('storage', () => initOutlookHub())

// ── Greeting ──────────────────────────────────────────────────────────────────
function renderGreeting() {
  const hour = new Date().getHours()
  const saud = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'

  const greetEl = document.getElementById('greetName')
  const dateEl  = document.getElementById('greetDate')
  if (greetEl) {
    const h1 = greetEl.closest('h1')
    if (h1) h1.firstChild.textContent = saud + ', '
    greetEl.textContent = user.name.split(' ')[0]
  }
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('pt-BR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    })
  }

  const avatar = document.getElementById('sidebarAvatar')
  const nameEl = document.getElementById('sidebarName')
  const roleEl = document.getElementById('sidebarRole')
  if (avatar) avatar.textContent = (user.name || '?')[0].toUpperCase()
  injectUserBadge(nameEl, roleEl)
}

// ── Status chips (IA + WhatsApp) ──────────────────────────────────────────────
async function loadStatusChips() {
  const container = document.getElementById('statusChips')
  if (!container) return
  try {
    const [status, wa] = await Promise.all([
      fetch('/api/status').then(r => r.json()).catch(() => null),
      fetch('/api/whatsapp/status').then(r => r.json()).catch(() => ({ connected: false }))
    ])
    container.innerHTML = [
      status ? `<span class="status-chip"><span class="status-chip-dot ${status.ok ? 'ok' : 'err'}"></span>IA: ${esc(status.model || 'offline')}</span>` : '',
      `<span class="status-chip"><span class="status-chip-dot ${wa.connected ? 'ok' : ''}"></span>WhatsApp: ${wa.connected ? 'Conectado' : 'Desconectado'}</span>`,
    ].join('')
  } catch {}
}

// ── Acesso às ferramentas ─────────────────────────────────────────────────────
const TOOL_KEYS = ['triagem', 'whatsapp', 'candidato', 'cursos']

function renderAccess() {
  if (user.role === 'admin') {
    const adminNav  = document.getElementById('adminNav')
    const adminCard = document.getElementById('card-admin')
    if (adminNav)  adminNav.style.display  = 'block'
    if (adminCard) adminCard.style.display = 'flex'
  }

  TOOL_KEYS.forEach(key => {
    const enabled = tools.includes(key) || user.role === 'admin'
    const link = document.getElementById(`tool-${key}`)
    if (link && !enabled) {
      link.classList.add('locked')
      link.removeAttribute('href')
      link.onclick = () => false
    }
    const card = document.getElementById(`card-${key}`)
    if (card && !enabled) {
      card.style.opacity  = '.45'
      card.style.cursor   = 'not-allowed'
      card.removeAttribute('href')
      card.onclick = e => { e.preventDefault(); showToast('🔒 Sem acesso a esta ferramenta.', true) }
    }
  })
}

// ── Stats (admin/rh) ──────────────────────────────────────────────────────────
async function loadStats() {
  if (!['admin','rh'].includes(user.role)) return
  document.getElementById('statsSection').style.display = 'block'
  try {
    const r = await fetch('/api/intranet/stats', { headers: authHeaders() })
    if (!r.ok) return
    const s    = await r.json()
    const grid = document.getElementById('statsGrid')
    if (!grid) return
    grid.innerHTML = [
      { label: 'Candidatos',  val: s.total,       cls: 'purple', href: 'whatsapp.html',  icon: '👥' },
      { label: 'Pendentes',   val: s.pendentes,   cls: 'amber',  href: 'whatsapp.html',  icon: '⏳' },
      { label: 'Confirmados', val: s.confirmados, cls: 'green',  href: 'whatsapp.html',  icon: '✅' },
      { label: 'Orgânicos',   val: s.organicos,   cls: 'cyan',   href: 'candidato.html', icon: '🌱' },
    ].map(c => `
      <div class="stat-card ${c.cls} clickable" onclick="window.location='${c.href}'">
        <div class="stat-icon">${c.icon}</div>
        <div class="stat-info">
          <div class="stat-val">${c.val ?? '—'}</div>
          <div class="stat-lbl">${c.label}</div>
        </div>
      </div>`).join('')
  } catch {}
}

// ── Pipeline de recrutamento ──────────────────────────────────────────────────
async function loadPipeline() {
  const wrap = document.getElementById('pipelineWidget')
  if (!wrap) return

  if (!['admin','rh'].includes(user.role)) {
    wrap.innerHTML = '<div style="font-size:.8rem;color:var(--text3);text-align:center;padding:24px">Disponível para admin e RH.</div>'
    return
  }

  const ctrl    = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), 10000)

  try {
    const r = await fetch('/api/intranet/pipeline', {
      headers: authHeaders(),
      signal:  ctrl.signal,
    })
    clearTimeout(timeout)
    if (r.status === 401) { logout(); return }
    if (!r.ok) throw new Error(r.status)

    const d = await r.json()
    renderPipeline(d)
  } catch (err) {
    clearTimeout(timeout)
    wrap.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text3);font-size:.8rem">
      ${err.name === 'AbortError' ? '⏱️ Tempo esgotado' : '⚠️ Erro ao carregar'}
      <br><button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="loadPipeline()">↺ Tentar novamente</button>
    </div>`
  }
}

function renderPipeline(d) {
  const wrap = document.getElementById('pipelineWidget')
  if (!wrap) return

  const max = Math.max(...d.byStatus.map(s => s.count), 1)

  const stageRows = d.byStatus.map(s => {
    const pct = Math.round((s.count / max) * 100)
    return `
      <div class="pipeline-row">
        <div class="pipeline-row-header">
          <span class="pipeline-row-label">
            <span class="pipeline-dot ${s.color}"></span>${s.label}
          </span>
          <span class="pipeline-count">${s.count}</span>
        </div>
        <div class="pipeline-bar-track">
          <div class="pipeline-bar-fill ${s.color}" style="width:0%" data-pct="${pct}"></div>
        </div>
      </div>`
  }).join('')

  const topVagasHtml = d.topVagas.length
    ? d.topVagas.map(v => `
        <div class="pipeline-vaga-row">
          <span class="pipeline-vaga-name">${esc(v.titulo)}</span>
          <span class="pipeline-vaga-count">${v.count}</span>
        </div>`).join('')
    : '<div style="font-size:.75rem;color:var(--text3)">Sem candidatos ainda.</div>'

  wrap.innerHTML = `
    <div class="pipeline-total">${d.total}</div>
    <div class="pipeline-total-lbl">candidatos no total</div>

    ${stageRows}

    <div class="pipeline-divider"></div>

    <div style="font-size:.68rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin-bottom:10px">Últimos 7 dias</div>
    <div class="pipeline-stat-row">
      <span class="pipeline-stat-label">🎯 Triagens realizadas</span>
      <span class="pipeline-stat-val">${d.triagensUltimos7Dias}</span>
    </div>
    <div class="pipeline-stat-row">
      <span class="pipeline-stat-label">📄 CVs analisados</span>
      <span class="pipeline-stat-val">${d.cvsUltimos7Dias}</span>
    </div>
    ${d.triagensHoje > 0 ? `
    <div class="pipeline-stat-row">
      <span class="pipeline-stat-label">✨ Triagens hoje</span>
      <span class="pipeline-stat-val" style="color:var(--green)">${d.triagensHoje}</span>
    </div>` : ''}

    <div class="pipeline-divider"></div>

    <div style="font-size:.68rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin-bottom:10px">Vagas com mais candidatos</div>
    ${topVagasHtml}
  `

  // Anima as barras após render
  requestAnimationFrame(() => {
    wrap.querySelectorAll('.pipeline-bar-fill').forEach(el => {
      el.style.width = el.dataset.pct + '%'
    })
  })
}

// ── Triagens recentes (admin/rh) ──────────────────────────────────────────────
async function loadRecentScreenings() {
  if (!['admin','rh'].includes(user.role)) return
  const title = document.getElementById('screeningsTitle')
  const wrap  = document.getElementById('recentScreenings')
  if (!wrap) return
  try {
    const rows = await fetch('/api/screenings').then(r => r.json())
    if (!Array.isArray(rows) || !rows.length) return
    title.style.display = 'flex'
    wrap.innerHTML = rows.slice(0, 4).map(s => `
      <div class="screening-item">
        <div class="screening-icon">🎯</div>
        <div class="screening-info">
          <div class="screening-vaga">${esc(s.vaga_titulo)}</div>
          <div class="screening-meta">${fmtTime(s.created_at)}</div>
        </div>
        <span class="screening-count">${s.total} CV${s.total !== 1 ? 's' : ''}</span>
      </div>`).join('')
  } catch {}
}

// ── Sidebar mobile toggle ─────────────────────────────────────────────────────
function toggleSidebar() { document.getElementById('sidebar')?.classList.toggle('open') }

// ── Modals ────────────────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('on') }
function closeModal(id) { document.getElementById(id)?.classList.remove('on') }
document.querySelectorAll('.intranet-modal-overlay').forEach(m =>
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('on') }))

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return (s || '').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
function fmtTime(dt) {
  if (!dt) return ''
  const d = new Date(dt), now = new Date(), diff = Math.floor((now - d) / 1000)
  if (isNaN(d)) return dt
  if (diff < 60)    return 'agora'
  if (diff < 3600)  return `${Math.floor(diff/60)}min atrás`
  if (diff < 86400) return `${Math.floor(diff/3600)}h atrás`
  return d.toLocaleDateString('pt-BR')
}
let toastT
function showToast(msg, err = false) {
  clearTimeout(toastT)
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg
  t.className   = err ? 'err show' : 'show'
  toastT = setTimeout(() => t.classList.remove('show'), 3500)
}

// ── Outlook Hub Integration ─────────────────────────────────────────────────

function _msalCachedUser() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      const v = JSON.parse(localStorage.getItem(k))
      if (v && v.homeAccountId && v.username) return v
    }
  } catch (_) {}
  return null
}

function _renderOutlookCard() {
  const statusEl = document.getElementById('outlookIntegStatus')
  const card     = document.getElementById('outlookIntegCard')
  if (!statusEl || !card) return
  card.querySelectorAll('button, .btn-ol-connect').forEach(el => el.remove())
  const cached = _msalCachedUser()
  if (cached) {
    statusEl.innerHTML = '<span class="integ-conn-dot"></span> Conectado: ' + esc(cached.username || '')
    statusEl.className = 'integ-status connected'
    const b = document.createElement('button')
    b.className = 'btn btn-ghost btn-sm'
    b.textContent = 'Desconectar'
    b.onclick = () => _outlookDisconnect()
    card.appendChild(b)
  } else {
    statusEl.textContent = 'Não conectado'
    statusEl.className   = 'integ-status'
    const b = document.createElement('button')
    b.className = 'btn-ol-connect'
    b.innerHTML = '<span class="ol-ms-icon">&#9632;&#9632;</span> Conectar'
    b.onclick = () => _outlookConnect()
    card.appendChild(b)
  }
}

function _msalInit(cfg) {
  return new msal.PublicClientApplication({
    auth: { clientId: cfg.azureClientId, authority: 'https://login.microsoftonline.com/common', redirectUri: window.location.origin + '/intranet.html' },
    cache: { cacheLocation: 'localStorage' },
  })
}

function _withInit(app) {
  // initialize() é obrigatório no MSAL v2.38 mas pode travar — limita a 3s
  const timeout = new Promise(resolve => setTimeout(resolve, 3000))
  return Promise.race([app.initialize(), timeout]).catch(() => {})
}

function initOutlookHub() {
  const statusEl = document.getElementById('outlookIntegStatus')
  const card     = document.getElementById('outlookIntegCard')
  if (!statusEl || !card) return

  const isCallback = window.location.hash.includes('code=')
    || window.location.hash.includes('error=')
    || window.location.search.includes('code=')

  if (isCallback && typeof msal !== 'undefined') {
    statusEl.textContent = 'Finalizando login...'
    fetch('/api/config').then(r => r.json()).catch(() => null).then(cfg => {
      if (!cfg || !cfg.azureClientId) { _renderOutlookCard(); return }
      let app
      try { app = _msalInit(cfg) } catch (_) { _renderOutlookCard(); return }
      _withInit(app).then(() =>
        app.handleRedirectPromise()
          .then(result => {
            history.replaceState({}, '', window.location.pathname)
            const account = (result && result.account) || app.getAllAccounts()[0] || null
            if (account) { _showConnected(account); showToast('✓ Outlook conectado — disponível na Triagem') }
            else _renderOutlookCard()
          })
          .catch(e => {
            history.replaceState({}, '', window.location.pathname)
            statusEl.textContent = 'Erro: ' + (e.errorCode || e.message || 'desconhecido')
          })
      )
    })
    return
  }

  _renderOutlookCard()
}

function _outlookConnect() {
  if (typeof msal === 'undefined') { showToast('Erro: MSAL não carregou', true); return }
  const statusEl = document.getElementById('outlookIntegStatus')
  const card     = document.getElementById('outlookIntegCard')
  if (statusEl) statusEl.textContent = 'Aguarde...'
  if (card) card.querySelectorAll('button, .btn-ol-connect').forEach(el => el.remove())

  fetch('/api/config').then(r => r.json()).catch(() => null).then(cfg => {
    if (!cfg || !cfg.azureClientId) { showToast('Azure não configurado', true); _renderOutlookCard(); return }
    let app
    try { app = _msalInit(cfg) } catch (e) { showToast('Erro MSAL: ' + e.message, true); _renderOutlookCard(); return }
    // initialize() obrigatório antes do loginRedirect (com timeout de segurança)
    _withInit(app).then(() =>
      app.loginRedirect({ scopes: ['Calendars.ReadWrite', 'User.Read'] })
        .catch(e => { if (!String(e.errorCode || '').includes('cancelled')) showToast('Erro: ' + (e.message || ''), true) })
    )
  })
}

function _showConnected(account) {
  const statusEl = document.getElementById('outlookIntegStatus')
  const card     = document.getElementById('outlookIntegCard')
  if (!statusEl || !card) return
  card.querySelectorAll('button, .btn-ol-connect').forEach(el => el.remove())
  statusEl.innerHTML = '<span class="integ-conn-dot"></span> Conectado: ' + esc(account.username || account.name || '')
  statusEl.className = 'integ-status connected'
  const b = document.createElement('button')
  b.className = 'btn btn-ghost btn-sm'
  b.textContent = 'Desconectar'
  b.onclick = () => _outlookDisconnect()
  card.appendChild(b)
}

function _outlookDisconnect() {
  const toRemove = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k) continue
    try {
      const v = JSON.parse(localStorage.getItem(k))
      if (v && (v.homeAccountId || v.credentialType || v.secret)) toRemove.push(k)
    } catch (_) {}
  }
  toRemove.forEach(k => localStorage.removeItem(k))
  _renderOutlookCard()
  showToast('Outlook desconectado')
}

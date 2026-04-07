'use strict'

// ── Auth check ───────────────────────────────────────────────────────────────
if (!requireAuth()) throw new Error('not auth')

const user  = getUser()
const tools = getTools()

// ── Init ─────────────────────────────────────────────────────────────────────
;(async () => {
  if (sessionStorage.getItem('aihr_just_logged_in')) {
    document.body.classList.add('page-enter')
    sessionStorage.removeItem('aihr_just_logged_in')
  }

  renderGreeting()
  renderAccess()
  loadStats()
  loadFeed()
})()

// ── Greeting ─────────────────────────────────────────────────────────────────
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

// ── Acesso às ferramentas ─────────────────────────────────────────────────────
const TOOL_KEYS = ['triagem', 'whatsapp', 'candidato', 'cursos']

function renderAccess() {
  // Admin panel
  if (user.role === 'admin') {
    const adminNav  = document.getElementById('adminNav')
    const adminCard = document.getElementById('card-admin')
    if (adminNav)  adminNav.style.display  = 'block'
    if (adminCard) adminCard.style.display = 'flex'
  }

  // Lock sidebar links + cards sem permissão
  TOOL_KEYS.forEach(key => {
    const enabled = tools.includes(key) || user.role === 'admin'

    // Sidebar link
    const link = document.getElementById(`tool-${key}`)
    if (link && !enabled) {
      link.classList.add('locked')
      link.removeAttribute('href')
      link.onclick = () => false
    }

    // Tool card
    const card = document.getElementById(`card-${key}`)
    if (card && !enabled) {
      card.style.opacity  = '.45'
      card.style.cursor   = 'not-allowed'
      card.removeAttribute('href')
      card.onclick = e => { e.preventDefault(); showToast('🔒 Sem acesso a esta ferramenta.', true) }
    }
  })

  // Publicar button
  const btn = document.getElementById('btnNewPost')
  if (btn && ['admin','rh','manager'].includes(user.role)) btn.style.display = 'inline-flex'
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
      { label: 'Candidatos',   val: s.total,      cls: 'purple', href: 'whatsapp.html' },
      { label: 'Pendentes',    val: s.pendentes,  cls: 'amber',  href: 'whatsapp.html' },
      { label: 'Confirmados',  val: s.confirmados,cls: 'green',  href: 'whatsapp.html' },
      { label: '🌱 Orgânicos', val: s.organicos,  cls: 'cyan',   href: 'candidato.html' },
    ].map(c => `
      <div class="stat-card ${c.cls} clickable" onclick="window.location='${c.href}'">
        <div class="stat-val">${c.val ?? '—'}</div>
        <div class="stat-lbl">${c.label}</div>
      </div>`).join('')
  } catch (e) { console.warn('stats:', e) }
}

// ── Feed ──────────────────────────────────────────────────────────────────────
async function loadFeed() {
  const list = document.getElementById('feedList')
  try {
    const r = await fetch('/api/intranet/posts?status=published', { headers: authHeaders() })
    if (!r.ok) throw new Error(r.status)
    const posts = await r.json()
    if (!Array.isArray(posts) || !posts.length) {
      list.innerHTML = '<div class="comm-empty">Nenhum comunicado publicado ainda.</div>'
      return
    }
    const typeLabel = { news: 'Notícia', announcement: 'Comunicado', alert: 'Alerta', event: 'Evento' }
    list.innerHTML = '<div class="comm-list">' + posts.map(p => `
      <div class="comm-card${p.pinned ? ' pinned' : ''}" onclick="markRead(${p.id}, this)">
        ${p.pinned ? '<div style="font-size:.72rem;color:var(--text3);margin-bottom:4px">📌 Fixado</div>' : ''}
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
          <span class="post-type-badge ${p.type}">${typeLabel[p.type] || p.type}</span>
          <span style="font-size:.7rem;color:var(--text3)">${fmtTime(p.created_at)}</span>
        </div>
        <div class="comm-card-title">${esc(p.title)}</div>
        <div class="comm-card-body">${esc(p.content)}</div>
        <div class="comm-card-meta">por ${esc(p.author_name || 'Sistema')}</div>
      </div>`).join('') + '</div>'
  } catch {
    list.innerHTML = '<div class="comm-empty">Não foi possível carregar comunicados.</div>'
  }
}

async function markRead(postId, card) {
  try {
    await fetch(`/api/intranet/posts/${postId}/read`, { method: 'POST', headers: authHeaders() })
  } catch {}
}

// ── Post modal ────────────────────────────────────────────────────────────────
function openPostModal() { openModal('modalPost') }

async function submitPost() {
  const type    = document.getElementById('postType').value
  const title   = document.getElementById('postTitle').value.trim()
  const content = document.getElementById('postContent').value.trim()
  const errEl   = document.getElementById('postError')
  errEl.style.display = 'none'
  if (!title || !content) {
    errEl.textContent = 'Título e conteúdo são obrigatórios.'
    errEl.style.display = 'block'; return
  }
  try {
    const r = await fetch('/api/intranet/posts', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ type, title, content })
    }).then(r => r.json())
    closeModal('modalPost')
    document.getElementById('postTitle').value   = ''
    document.getElementById('postContent').value = ''
    if (r.status === 'published') { showToast('✓ Comunicado publicado!'); loadFeed() }
    else showToast('✓ Enviado para moderação.')
  } catch { errEl.textContent = 'Erro ao publicar.'; errEl.style.display = 'block' }
}

// ── Modals ────────────────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('on') }
function closeModal(id) { document.getElementById(id)?.classList.remove('on') }
document.querySelectorAll('.intranet-modal-overlay').forEach(m =>
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('on') }))

// ── Sidebar mobile toggle ─────────────────────────────────────────────────────
function toggleSidebar() { document.getElementById('sidebar')?.classList.toggle('open') }

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

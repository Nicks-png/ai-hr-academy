'use strict'

// ── Auth check ───────────────────────────────────────────────────────────────
if (!requireAuth()) throw new Error('not auth')

const user  = getUser()
const tools = getTools()

// ── Init ─────────────────────────────────────────────────────────────────────
;(async () => {
  renderGreeting()
  renderSidebar()
  await Promise.all([loadStats(), loadFeed(), loadDocuments(), loadDirectory()])
})()

// ── Greeting ─────────────────────────────────────────────────────────────────
function renderGreeting() {
  const greetEl = document.getElementById('greetName')
  const dateEl  = document.getElementById('greetDate')
  if (greetEl) greetEl.textContent = user.name.split(' ')[0]
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

// ── Sidebar tools ─────────────────────────────────────────────────────────────
const TOOL_DEF = [
  { key: 'triagem',    label: 'Triagem IA',           icon: '🎯', href: 'triagem.html' },
  { key: 'whatsapp',   label: 'WhatsApp Recruiter',   icon: '💬', href: 'whatsapp.html' },
  { key: 'candidato',  label: 'Portal de Candidatos', icon: '📄', href: 'candidato.html' },
  { key: 'cursos',     label: 'Cursos de IA',         icon: '📚', href: 'cursos.html' },
]

function renderSidebar() {
  const nav = document.getElementById('toolsNav')
  if (!nav) return

  // Admin link
  let html = ''
  if (user.role === 'admin') {
    html += `<a href="admin.html" class="sidebar-link">
      <span class="sidebar-link-icon">⚙️</span> Painel Admin
    </a>`
  }

  TOOL_DEF.forEach(t => {
    const enabled = tools.includes(t.key)
    html += `<a href="${enabled ? t.href : '#'}"
      class="sidebar-link${enabled ? '' : ' locked'}"
      ${!enabled ? 'title="Sem acesso — contate o administrador" onclick="return false"' : ''}>
      <span class="sidebar-link-icon">${t.icon}</span> ${t.label}
      ${!enabled ? '<span style="margin-left:auto;font-size:.7rem">🔒</span>' : ''}
    </a>`
  })

  nav.innerHTML = html

  // Show "Publicar" button for rh/admin/manager
  const btn = document.getElementById('btnNewPost')
  if (btn && ['admin','rh','manager'].includes(user.role)) btn.style.display = 'inline-flex'
}

// ── Stats ─────────────────────────────────────────────────────────────────────
async function loadStats() {
  if (!['admin','rh'].includes(user.role)) return
  document.getElementById('statsSection').style.display = 'block'
  try {
    const s   = await fetch('/api/intranet/stats', { headers: authHeaders() }).then(r => r.json())
    const grid = document.getElementById('statsGrid')
    grid.innerHTML = [
      { label: 'Candidatos',  val: s.total,        cls: 'purple',  href: 'whatsapp.html' },
      { label: 'Pendentes',   val: s.pendentes,     cls: 'amber',   href: 'whatsapp.html' },
      { label: 'Confirmados', val: s.confirmados,   cls: 'green',   href: 'whatsapp.html' },
      { label: '🌱 Orgânicos',val: s.organicos,     cls: 'cyan',    href: 'whatsapp.html' },
    ].map(c => `
      <div class="stat-card ${c.cls} clickable" onclick="window.location='${c.href}'">
        <div class="stat-val">${c.val}</div>
        <div class="stat-lbl">${c.label}</div>
      </div>`).join('')

    // Birthdays widget
    if (s.birthdaysThisMonth?.length) {
      document.getElementById('bdaySection').style.display = 'block'
      document.getElementById('bdayList').innerHTML = s.birthdaysThisMonth.map(b =>
        `<div class="bday-item">
          <div class="bday-avatar">${b.name[0]}</div>
          <span class="bday-name">${esc(b.name.split(' ')[0])}</span>
        </div>`).join('')
    }
  } catch (e) { console.error('stats error', e) }
}

// ── Feed ──────────────────────────────────────────────────────────────────────
async function loadFeed() {
  try {
    const posts = await fetch('/api/intranet/posts?status=published', {
      headers: authHeaders()
    }).then(r => r.json())
    renderFeed(posts)
  } catch { document.getElementById('feedList').innerHTML = '<div class="feed-empty">Erro ao carregar comunicados.</div>' }
}

function renderFeed(posts) {
  const list = document.getElementById('feedList')
  if (!posts.length) {
    list.innerHTML = '<div class="feed-empty">Nenhum comunicado publicado ainda.</div>'
    return
  }
  list.innerHTML = posts.map(p => {
    const typeLabels = { news: 'Notícia', announcement: 'Comunicado', alert: 'Alerta', event: 'Evento' }
    const initials   = (p.author_name || '?').split(' ').slice(0,2).map(w => w[0]).join('')
    const reactionBar = ['👍','❤️','🎉'].map(e => {
      const r   = p.reactions?.find(x => x.emoji === e)
      const cnt = r?.count || 0
      const my  = p.myReactions?.includes(e)
      return `<button class="reaction-btn${my ? ' my-react' : ''}"
        onclick="react(${p.id}, '${e}', this)">
        ${e} <span class="reaction-count">${cnt > 0 ? cnt : ''}</span>
      </button>`
    }).join('')
    return `
    <div class="post-card${p.isRead ? '' : ' unread'}${p.pinned ? ' pinned' : ''}" id="post-${p.id}"
      onclick="markRead(${p.id}, this)">
      ${p.pinned ? '<div class="post-pin">📌 Fixado</div>' : ''}
      <div class="post-meta">
        <div class="post-avatar">${esc(initials)}</div>
        <span class="post-author">${esc(p.author_name || 'Sistema')}</span>
        <span class="post-type-badge ${p.type}">${typeLabels[p.type] || p.type}</span>
        <span class="post-time">${fmtTime(p.created_at)}</span>
      </div>
      <div class="post-title">${esc(p.title)}</div>
      <div class="post-content">${esc(p.content)}</div>
      <div class="post-reactions">${reactionBar}</div>
    </div>`
  }).join('')
}

async function react(postId, emoji, btn) {
  try {
    const r = await fetch(`/api/intranet/posts/${postId}/react`, {
      method: 'POST', headers: authHeaders(),
      body:   JSON.stringify({ emoji })
    }).then(r => r.json())

    // Update count in button
    const countEl = btn.querySelector('.reaction-count')
    const cur     = parseInt(countEl.textContent) || 0
    if (r.action === 'added') {
      btn.classList.add('my-react')
      countEl.textContent = cur + 1 || 1
    } else {
      btn.classList.remove('my-react')
      countEl.textContent = cur > 1 ? cur - 1 : ''
    }
  } catch {}
}

async function markRead(postId, card) {
  if (!card.classList.contains('unread')) return
  card.classList.remove('unread')
  try {
    await fetch(`/api/intranet/posts/${postId}/read`, {
      method: 'POST', headers: authHeaders()
    })
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
    errEl.style.display = 'block'
    return
  }
  try {
    const r = await fetch('/api/intranet/posts', {
      method: 'POST', headers: authHeaders(),
      body:   JSON.stringify({ type, title, content })
    }).then(r => r.json())
    closeModal('modalPost')
    document.getElementById('postTitle').value   = ''
    document.getElementById('postContent').value = ''
    if (r.status === 'published') {
      showToast('✓ Comunicado publicado!')
      await loadFeed()
    } else {
      showToast('✓ Enviado para moderação — aguardando aprovação do admin.')
    }
  } catch { errEl.textContent = 'Erro ao publicar.'; errEl.style.display = 'block' }
}

// ── Documents ─────────────────────────────────────────────────────────────────
async function loadDocuments() {
  const cat  = document.getElementById('docCategoryFilter')?.value || ''
  const url  = `/api/intranet/documents${cat ? `?category=${cat}` : ''}`
  const list = document.getElementById('docsList')
  try {
    const docs = await fetch(url, { headers: authHeaders() }).then(r => r.json())
    if (!docs.length) { list.innerHTML = '<div class="feed-empty">Nenhum documento disponível.</div>'; return }
    const labels = { politicas: 'Políticas', beneficios: 'Benefícios', normas: 'Normas',
                     formularios: 'Formulários', geral: 'Geral' }
    list.innerHTML = `<table class="intranet-table">
      <thead><tr><th>Título</th><th>Categoria</th><th>Versão</th><th>Autor</th><th>Data</th><th></th></tr></thead>
      <tbody>${docs.map(d => `
        <tr>
          <td style="font-weight:600">${esc(d.title)}</td>
          <td><span class="doc-category-badge ${d.category}">${labels[d.category] || d.category}</span></td>
          <td style="color:var(--text3)">${esc(d.version)}</td>
          <td style="color:var(--text2)">${esc(d.author_name || '—')}</td>
          <td style="color:var(--text3)">${fmtDate(d.created_at)}</td>
          <td>${d.url
            ? `<a href="${esc(d.url)}" target="_blank" class="btn btn-ghost btn-sm">Abrir →</a>`
            : `<button class="btn btn-ghost btn-sm" onclick='viewDocContent(${JSON.stringify(d.content)})'>Ver</button>`
          }</td>
        </tr>`).join('')}</tbody></table>`
  } catch { list.innerHTML = '<div class="feed-empty">Erro ao carregar documentos.</div>' }
}

function viewDocContent(content) {
  alert(content || '(sem conteúdo)')
}

// ── Directory ─────────────────────────────────────────────────────────────────
async function loadDirectory() {
  const grid = document.getElementById('directoryGrid')
  try {
    const users = await fetch('/api/intranet/users', { headers: authHeaders() }).then(r => r.json())
    const active = users.filter(u => u.is_active)
    const roleLabels = { admin: 'Administrador', rh: 'RH', manager: 'Gestor', employee: 'Colaborador' }
    grid.innerHTML = active.map(u => `
      <div style="padding:16px;border-radius:14px;background:var(--glass);border:1px solid var(--glass-b);display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px">
        <div style="width:42px;height:42px;border-radius:50%;background:var(--grad);display:flex;align-items:center;justify-content:center;font-size:.9rem;font-weight:800;color:#fff">
          ${u.name[0]}</div>
        <div style="font-size:.85rem;font-weight:700">${esc(u.name)}</div>
        <span class="role-badge ${u.role}">${roleLabels[u.role] || u.role}</span>
        ${u.department ? `<div style="font-size:.72rem;color:var(--text3)">${esc(u.department)}</div>` : ''}
      </div>`).join('')
  } catch { grid.innerHTML = '<div class="feed-empty">Erro ao carregar.</div>' }
}

// ── Scroll anchors ────────────────────────────────────────────────────────────
function scrollToFeed() { document.getElementById('feed')?.scrollIntoView({ behavior: 'smooth' }) }
function scrollToDocs()  { document.getElementById('docs')?.scrollIntoView({ behavior: 'smooth' }) }
function scrollToDir()   { document.getElementById('directory')?.scrollIntoView({ behavior: 'smooth' }) }

// ── Sidebar mobile toggle ─────────────────────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open')
}

// ── Modals ────────────────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('on') }
function closeModal(id) { document.getElementById(id).classList.remove('on') }
document.querySelectorAll('.intranet-modal-overlay').forEach(m =>
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('on') }))

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return (s || '').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function fmtDate(dt) {
  if (!dt) return '—'
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

'use strict'
/* ── Auth client-side utility ─────────────────────────────────────────────── */

const AUTH_KEY = 'aihr_auth'

function getAuth()    { try { return JSON.parse(localStorage.getItem(AUTH_KEY)) } catch { return null } }
function getToken()   { return getAuth()?.token }
function getUser()    { return getAuth()?.user }
function getTools()   { return getAuth()?.tools || [] }

function authHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}`, ...extra }
}

function requireAuth(toolKey) {
  if (!getToken()) { window.location.href = '/login.html'; return false }

  if (toolKey === 'admin') {
    if (getUser()?.role !== 'admin') { window.location.href = '/intranet.html'; return false }
    return true
  }

  if (toolKey && !getTools().includes(toolKey)) {
    document.body.innerHTML = `
      <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;
        justify-content:center;background:var(--bg);color:var(--text);font-family:var(--font);
        text-align:center;padding:24px">
        <div style="font-size:3rem;margin-bottom:16px">🔒</div>
        <h2 style="font-size:1.4rem;font-weight:800;margin-bottom:8px">Acesso restrito</h2>
        <p style="color:var(--text2);margin-bottom:24px">
          Esta ferramenta não está disponível para o seu perfil.<br>
          Fale com o administrador para solicitar acesso.
        </p>
        <a href="/intranet.html" style="padding:10px 22px;border-radius:12px;
          background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#fff;
          text-decoration:none;font-weight:700;font-size:.9rem">← Voltar ao Hub</a>
      </div>`
    return false
  }
  return true
}

function logout() {
  localStorage.removeItem(AUTH_KEY)
  window.location.href = '/login.html'
}

// Inject user avatar/name into header if element exists
function injectUserBadge(nameEl, roleEl) {
  const user = getUser()
  if (!user) return
  if (nameEl) nameEl.textContent = user.name
  if (roleEl) {
    const labels = { admin: 'Administrador', rh: 'RH', manager: 'Gestor', employee: 'Colaborador' }
    roleEl.textContent = labels[user.role] || user.role
    roleEl.className = `sidebar-user-role ${user.role}`
  }
}

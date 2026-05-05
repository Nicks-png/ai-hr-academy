'use strict'

if (!requireAuth('admin')) throw new Error('not auth')

const ROLE_LABELS = { admin: 'Administrador', rh: 'RH', manager: 'Gestor', employee: 'Colaborador' }
const TOOLS       = ['triagem', 'whatsapp', 'cursos', 'candidato', 'documentos']
const TOOL_LABELS = { triagem: '🎯 Triagem', whatsapp: '💬 WhatsApp', cursos: '📚 Cursos',
                      candidato: '📄 Portal', documentos: '📂 Docs' }
const ROLES       = ['admin', 'rh', 'manager', 'employee']

// ── Init ─────────────────────────────────────────────────────────────────────
;(async () => {
  const u = getUser()
  const av = document.getElementById('sidebarAvatar')
  const nm = document.getElementById('sidebarName')
  const rl = document.getElementById('sidebarRole')
  if (av) av.textContent = u.name[0]
  injectUserBadge(nm, rl)
  await Promise.all([loadUsers(), loadPending(), loadPermissions(), loadDocs(), loadVagas()])
})()

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.admin-tab').forEach((t, i) => {
    const tabs = ['users','moderation','access','documents','vagas']
    t.classList.toggle('active', tabs[i] === name)
  })
  document.querySelectorAll('.admin-panel').forEach(p =>
    p.classList.toggle('active', p.id === `tab-${name}`))
}

// ── Users tab ─────────────────────────────────────────────────────────────────
let allUsers = []

async function loadUsers() {
  try {
    allUsers = await fetch('/api/intranet/users', { headers: authHeaders() }).then(r => r.json())
    renderUsersTable()
  } catch { document.getElementById('usersTableWrap').textContent = 'Erro ao carregar.' }
}

function renderUsersTable() {
  const wrap = document.getElementById('usersTableWrap')
  if (!allUsers.length) { wrap.innerHTML = '<p style="color:var(--text3)">Nenhum usuário.</p>'; return }
  wrap.innerHTML = `<table class="intranet-table">
    <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Dept.</th><th>Status</th><th></th></tr></thead>
    <tbody>${allUsers.map(u => `
      <tr>
        <td style="font-weight:700">${esc(u.name)}</td>
        <td style="color:var(--text2);font-size:.8rem">${esc(u.email)}</td>
        <td><span class="role-badge ${u.role}">${ROLE_LABELS[u.role] || u.role}</span></td>
        <td style="color:var(--text2);font-size:.8rem">${esc(u.department || '—')}</td>
        <td><span style="font-size:.72rem;font-weight:700;color:${u.is_active ? 'var(--green)' : 'var(--text3)'}">
          ${u.is_active ? '● Ativo' : '○ Inativo'}</span></td>
        <td style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" data-edit-user="${u.id}">Editar</button>
          <button class="btn btn-sm" style="background:rgba(${u.is_active ? '244,63,94' : '16,185,129'},.1);border:1px solid rgba(${u.is_active ? '244,63,94' : '16,185,129'},.2);color:${u.is_active ? '#fb7185' : 'var(--green)'}"
            data-toggle-user="${u.id}" data-active="${u.is_active}">${u.is_active ? 'Desativar' : 'Ativar'}</button>
        </td>
      </tr>`).join('')}</tbody></table>`

  wrap.querySelectorAll('[data-edit-user]').forEach(btn => {
    const u = allUsers.find(x => x.id == btn.dataset.editUser)
    if (u) btn.addEventListener('click', () => openEditUser(u))
  })
  wrap.querySelectorAll('[data-toggle-user]').forEach(btn => {
    btn.addEventListener('click', () => toggleUser(Number(btn.dataset.toggleUser), btn.dataset.active === 'true' || btn.dataset.active === '1'))
  })
}

function openUserModal() {
  document.getElementById('editUserId').value = ''
  document.getElementById('userModalTitle').textContent = 'Novo usuário'
  document.getElementById('uPwdHint').style.display = 'none'
  ;['uName','uEmail','uPassword','uDept','uBirth'].forEach(id => document.getElementById(id).value = '')
  document.getElementById('uRole').value = 'employee'
  document.getElementById('userError').style.display = 'none'
  openModal('modalUser')
}

function openEditUser(u) {
  document.getElementById('editUserId').value = u.id
  document.getElementById('userModalTitle').textContent = 'Editar usuário'
  document.getElementById('uPwdHint').style.display = 'inline'
  document.getElementById('uName').value    = u.name
  document.getElementById('uEmail').value   = u.email
  document.getElementById('uPassword').value= ''
  document.getElementById('uRole').value    = u.role
  document.getElementById('uDept').value    = u.department || ''
  document.getElementById('uBirth').value   = u.birth_date || ''
  document.getElementById('userError').style.display = 'none'
  openModal('modalUser')
}

async function saveUser() {
  const id       = document.getElementById('editUserId').value
  const name     = document.getElementById('uName').value.trim()
  const email    = document.getElementById('uEmail').value.trim()
  const password = document.getElementById('uPassword').value
  const role     = document.getElementById('uRole').value
  const department = document.getElementById('uDept').value.trim()
  const birth_date = document.getElementById('uBirth').value
  const errEl    = document.getElementById('userError')
  errEl.style.display = 'none'

  if (!name || !email) { errEl.textContent = 'Nome e e-mail são obrigatórios.'; errEl.style.display = 'block'; return }
  if (!id && !password) { errEl.textContent = 'Senha é obrigatória para novos usuários.'; errEl.style.display = 'block'; return }

  const body = { name, email, role, department: department || null, birth_date: birth_date || null }
  if (password) body.password = password

  try {
    const url    = id ? `/api/intranet/users/${id}` : '/api/intranet/users'
    const method = id ? 'PATCH' : 'POST'
    const r = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) })
    const d = await r.json()
    if (!r.ok) { errEl.textContent = d.error || 'Erro ao salvar.'; errEl.style.display = 'block'; return }
    closeModal('modalUser')
    showToast(`✓ Usuário ${id ? 'atualizado' : 'criado'}!`)
    await loadUsers()
  } catch { errEl.textContent = 'Erro de conexão.'; errEl.style.display = 'block' }
}

async function toggleUser(id, isActive) {
  if (!confirm(`${isActive ? 'Desativar' : 'Ativar'} este usuário?`)) return
  try {
    await fetch(`/api/intranet/users/${id}`, {
      method: 'PATCH', headers: authHeaders(),
      body: JSON.stringify({ is_active: !isActive })
    })
    showToast(`✓ Usuário ${isActive ? 'desativado' : 'ativado'}`)
    await loadUsers()
  } catch { showToast('Erro', true) }
}

// ── Moderation tab ────────────────────────────────────────────────────────────
async function loadPending() {
  try {
    const posts  = await fetch('/api/intranet/posts?status=pending', { headers: authHeaders() }).then(r => r.json())
    const countEl = document.getElementById('modCount')
    if (posts.length > 0) { countEl.textContent = posts.length; countEl.classList.add('show') }
    else countEl.classList.remove('show')

    const wrap = document.getElementById('pendingPosts')
    if (!posts.length) { wrap.innerHTML = '<div class="feed-empty">Nenhum post aguardando aprovação. ✓</div>'; return }

    const typeLabels = { news: 'Notícia', announcement: 'Comunicado', alert: 'Alerta', event: 'Evento' }
    wrap.innerHTML = posts.map(p => `
      <div class="mod-card">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
          <span class="post-type-badge ${p.type}">${typeLabels[p.type] || p.type}</span>
          <span style="font-size:.8rem;font-weight:700">${esc(p.title)}</span>
          <span style="font-size:.72rem;color:var(--text3);margin-left:auto">por ${esc(p.author_name || '?')} · ${fmtTime(p.created_at)}</span>
        </div>
        <div style="font-size:.8rem;color:var(--text2);line-height:1.6">${esc(p.content)}</div>
        <div class="mod-actions">
          <button class="btn btn-green btn-sm" onclick="moderatePost(${p.id},'published')">✅ Publicar</button>
          <button class="btn btn-danger btn-sm" onclick="moderatePost(${p.id},'rejected')">❌ Rejeitar</button>
        </div>
      </div>`).join('')
  } catch { document.getElementById('pendingPosts').textContent = 'Erro ao carregar.' }
}

async function moderatePost(id, status) {
  try {
    await fetch(`/api/intranet/posts/${id}/status`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status })
    })
    showToast(status === 'published' ? '✓ Publicado!' : '✓ Rejeitado.')
    await loadPending()
  } catch { showToast('Erro', true) }
}

// ── Access control tab ────────────────────────────────────────────────────────
async function loadPermissions() {
  try {
    const perms = await fetch('/api/intranet/permissions', { headers: authHeaders() }).then(r => r.json())
    const map   = {}
    perms.forEach(p => { if (!map[p.role]) map[p.role] = {}; map[p.role][p.tool_key] = p.is_enabled })

    const head = document.getElementById('accessHead')
    const body = document.getElementById('accessBody')
    head.innerHTML = `<tr><th>Papel</th>${TOOLS.map(t => `<th>${TOOL_LABELS[t]}</th>`).join('')}</tr>`
    body.innerHTML = ROLES.map(role => {
      const isAdmin = role === 'admin'
      return `<tr>
        <td><span class="role-badge ${role}">${ROLE_LABELS[role]}</span></td>
        ${TOOLS.map(tool => {
          const enabled = isAdmin ? 1 : (map[role]?.[tool] ?? 1)
          return `<td><label class="toggle${isAdmin ? ' disabled' : ''}">
            <input type="checkbox" ${enabled ? 'checked' : ''} ${isAdmin ? 'disabled' : ''}
              onchange="setPermission('${role}','${tool}',this.checked)"/>
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label></td>`
        }).join('')}
      </tr>`
    }).join('')
  } catch { console.error('perms error') }
}

async function setPermission(role, tool_key, is_enabled) {
  try {
    await fetch('/api/intranet/permissions', {
      method: 'PATCH', headers: authHeaders(),
      body: JSON.stringify({ role, tool_key, is_enabled })
    })
    showToast(`✓ Permissão de "${tool_key}" para "${ROLE_LABELS[role]}" ${is_enabled ? 'ativada' : 'desativada'}.`)
  } catch { showToast('Erro ao salvar permissão.', true) }
}

// ── Documents tab ─────────────────────────────────────────────────────────────
let allDocs = []

async function loadDocs() {
  try {
    allDocs = await fetch('/api/intranet/documents', { headers: authHeaders() }).then(r => r.json())
    renderDocsTable()
  } catch { document.getElementById('docsTableWrap').textContent = 'Erro.' }
}

const CAT_LABELS = { politicas: 'Políticas', beneficios: 'Benefícios', normas: 'Normas',
                     formularios: 'Formulários', geral: 'Geral' }

function renderDocsTable() {
  const wrap = document.getElementById('docsTableWrap')
  if (!allDocs.length) { wrap.innerHTML = '<p style="color:var(--text3)">Nenhum documento ainda.</p>'; return }
  wrap.innerHTML = `<table class="intranet-table">
    <thead><tr><th>Título</th><th>Categoria</th><th>Versão</th><th>Autor</th><th>Ativo</th><th></th></tr></thead>
    <tbody>${allDocs.map(d => `
      <tr>
        <td style="font-weight:600">${esc(d.title)}</td>
        <td><span class="doc-category-badge ${d.category}">${CAT_LABELS[d.category] || d.category}</span></td>
        <td style="color:var(--text3)">${esc(d.version)}</td>
        <td style="color:var(--text2);font-size:.8rem">${esc(d.author_name || '—')}</td>
        <td><span style="color:${d.is_active ? 'var(--green)' : 'var(--text3)'}">
          ${d.is_active ? '● Ativo' : '○ Inativo'}</span></td>
        <td>
          ${d.url ? `<a href="${esc(d.url)}" target="_blank" class="btn btn-ghost btn-sm">Abrir →</a>` : ''}
          <button class="btn btn-danger btn-sm" onclick="deleteDoc(${d.id})">×</button>
        </td>
      </tr>`).join('')}</tbody></table>`
}

function openDocModal() {
  ;['dTitle','dUrl','dContent','dDesc'].forEach(id => document.getElementById(id).value = '')
  document.getElementById('dVersion').value = '1.0'
  document.getElementById('dCategory').value = 'geral'
  document.getElementById('docError').style.display = 'none'
  openModal('modalDoc')
}

async function saveDoc() {
  const title    = document.getElementById('dTitle').value.trim()
  const category = document.getElementById('dCategory').value
  const url      = document.getElementById('dUrl').value.trim()
  const content  = document.getElementById('dContent').value.trim()
  const description = document.getElementById('dDesc').value.trim()
  const version  = document.getElementById('dVersion').value.trim() || '1.0'
  const errEl    = document.getElementById('docError')
  errEl.style.display = 'none'

  if (!title) { errEl.textContent = 'Título é obrigatório.'; errEl.style.display = 'block'; return }
  if (!url && !content) { errEl.textContent = 'Informe uma URL ou conteúdo em texto.'; errEl.style.display = 'block'; return }

  try {
    const r = await fetch('/api/intranet/documents', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ title, category, url: url || null, content: content || null, description, version })
    })
    const d = await r.json()
    if (!r.ok) { errEl.textContent = d.error || 'Erro.'; errEl.style.display = 'block'; return }
    closeModal('modalDoc')
    showToast('✓ Documento criado!')
    await loadDocs()
  } catch { errEl.textContent = 'Erro de conexão.'; errEl.style.display = 'block' }
}

async function deleteDoc(id) {
  if (!confirm('Remover este documento?')) return
  try {
    await fetch(`/api/intranet/documents/${id}`, { method: 'DELETE', headers: authHeaders() })
    showToast('✓ Documento removido.')
    await loadDocs()
  } catch { showToast('Erro', true) }
}

// ── Vagas tab ─────────────────────────────────────────────────────────────────
let allVagas = []

async function loadVagas() {
  try {
    allVagas = await fetch('/api/vagas', { headers: authHeaders() }).then(r => r.json())
    renderVagasTable()
  } catch { document.getElementById('vagasTableWrap').textContent = 'Erro ao carregar.' }
}

const VAGA_ICONS = {
  recepcionista: '🛎️', camareira: '🛏️', gerente: '👔', chef: '👨‍🍳',
  supervisorFB: '🍽️', manutencao: '🔧', trainee: '🎓', steward: '🧹',
  chefConfeitaria: '🍰', subChef: '👨‍🍳', auxiliarCozinha: '🥘', garcom: '🍷',
}

function vagaBrandClass(marca) {
  if (!marca) return 'default'
  const m = marca.toLowerCase()
  if (m.includes('ibis'))     return 'ibis'
  if (m.includes('novotel'))  return 'novotel'
  if (m.includes('pullman'))  return 'pullman'
  if (m.includes('mercure'))  return 'mercure'
  if (m.includes('fairmont')) return 'fairmont'
  return 'default'
}

function renderVagasTable() {
  const wrap = document.getElementById('vagasTableWrap')
  if (!allVagas.length) { wrap.innerHTML = '<p style="color:var(--text3)">Nenhuma vaga cadastrada.</p>'; return }
  wrap.innerHTML = `<div class="vagas-grid">${allVagas.map(v => {
    const brand = vagaBrandClass(v.marca)
    const icon  = VAGA_ICONS[v.id] || '💼'
    const regime = (v.regime || '').split('·')[0].trim()
    return `<div class="vaga-card ${brand}">
      <div class="vaga-card-header">
        <div class="vaga-card-icon">${icon}</div>
        <div>
          <div class="vaga-card-title">${esc(v.titulo)}</div>
          <div class="vaga-card-marca">${esc(v.marca || 'Accor Brasil')}</div>
        </div>
      </div>
      <div class="vaga-card-badges">
        <span class="vaga-badge">${esc(regime)}</span>
      </div>
      <div class="vaga-card-salario">💰 <strong>${esc(v.salario)}</strong></div>
      <div class="vaga-card-actions">
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick='openEditVaga(${JSON.stringify(v)})'>✏️ Editar</button>
        <button class="btn btn-danger btn-sm" onclick="deactivateVaga('${esc(v.id)}','${esc(v.titulo)}')">×</button>
      </div>
    </div>`
  }).join('')}</div>`
}

// ── Vaga PDF extract ──────────────────────────────────────────────────────────
if (typeof pdfjsLib !== 'undefined')
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

function handleVagaPdfDrop(e) {
  e.preventDefault()
  document.getElementById('vagaPdfZone').style.borderColor = 'var(--border-h)'
  const file = e.dataTransfer.files[0]
  if (file) handleVagaPdfFile(file)
}

async function handleVagaPdfFile(file) {
  if (!file || file.type !== 'application/pdf') {
    showToast('Envie um arquivo PDF.', true); return
  }
  const zone   = document.getElementById('vagaPdfZone')
  const status = document.getElementById('vagaPdfStatus')
  zone.style.borderColor = 'var(--purple-d)'
  status.innerHTML = '<span style="color:var(--purple)">⏳ Lendo PDF...</span>'

  try {
    const texto = await vagaParsePDF(file)
    status.innerHTML = '<span style="color:var(--purple)">🤖 Extraindo dados com IA...</span>'

    const r = await fetch('/api/vagas/extract', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ texto })
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error || 'Erro na extração.')

    // Preencher campos do formulário
    if (d.id_sugerido && !document.getElementById('editVagaId').value)
      document.getElementById('vId').value = d.id_sugerido
    if (d.titulo)       document.getElementById('vTitulo').value    = d.titulo
    if (d.marca)        document.getElementById('vMarca').value     = d.marca
    if (d.descricao)    document.getElementById('vDescricao').value = d.descricao
    if (d.requisitos?.length)   document.getElementById('vRequisitos').value   = d.requisitos.join('\n')
    if (d.diferenciais?.length) document.getElementById('vDiferenciais').value = d.diferenciais.join('\n')
    if (d.competencias?.length) document.getElementById('vCompetencias').value = d.competencias.join('\n')
    if (d.salario)      document.getElementById('vSalario').value   = d.salario
    if (d.regime)       document.getElementById('vRegime').value    = d.regime

    zone.style.borderColor = 'var(--green)'
    status.innerHTML = `<span style="color:var(--green)">✓ Dados extraídos de <strong>${esc(file.name)}</strong> — revise e salve</span>`
  } catch (err) {
    zone.style.borderColor = 'var(--red)'
    status.innerHTML = `<span style="color:var(--red)">✗ ${esc(err.message)}</span>`
  }
}

async function vagaParsePDF(file) {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const pgs = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i)
    const ct = await pg.getTextContent()
    pgs.push(ct.items.map(it => it.str).join(' '))
  }
  const texto = pgs.join('\n').replace(/\s{3,}/g, '\n').trim()
  if (texto.length >= 80) return texto

  // PDF digitalizado → OCR via Gemini
  const bytes = new Uint8Array(await file.arrayBuffer())
  let b64 = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk)
    b64 += String.fromCharCode(...bytes.subarray(i, i + chunk))
  b64 = btoa(b64)
  const resp = await fetch('/api/ocr', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: b64, mimeType: 'application/pdf' })
  })
  if (!resp.ok) throw new Error('OCR falhou. Configure a GEMINI_API_KEY para PDFs digitalizados.')
  const { texto: ocrTexto } = await resp.json()
  if (!ocrTexto?.trim()) throw new Error('Não foi possível extrair texto do PDF.')
  return ocrTexto
}

function resetVagaPdfZone() {
  document.getElementById('vagaPdfZone').style.borderColor = 'var(--border-h)'
  document.getElementById('vagaPdfStatus').innerHTML =
    '📄 Arraste o PDF da vaga aqui ou <span style="color:var(--purple);text-decoration:underline;cursor:pointer">clique para selecionar</span>'
  document.getElementById('vagaPdfInput').value = ''
}

function openVagaModal() {
  document.getElementById('editVagaId').value = ''
  document.getElementById('vagaModalTitle').textContent = 'Nova vaga'
  document.getElementById('vId').readOnly = false
  document.getElementById('vagaIdHint').style.display = 'inline'
  ;['vId','vTitulo','vMarca','vDescricao','vRequisitos','vDiferenciais','vCompetencias','vSalario','vRegime'].forEach(id => document.getElementById(id).value = '')
  document.getElementById('vagaError').style.display = 'none'
  resetVagaPdfZone()
  openModal('modalVaga')
}

function openEditVaga(v) {
  document.getElementById('editVagaId').value = v.id
  document.getElementById('vagaModalTitle').textContent = 'Editar vaga'
  document.getElementById('vId').value   = v.id
  document.getElementById('vId').readOnly = true
  document.getElementById('vagaIdHint').style.display = 'none'
  document.getElementById('vTitulo').value = v.titulo
  document.getElementById('vMarca').value  = v.marca || ''
  document.getElementById('vagaError').style.display = 'none'
  resetVagaPdfZone()
  // Buscar detalhes completos para preencher os arrays
  fetch(`/api/vagas/${v.id}`, { headers: authHeaders() }).then(r => r.json()).then(full => {
    document.getElementById('vDescricao').value    = full.descricao || ''
    document.getElementById('vRequisitos').value   = (full.requisitos || []).join('\n')
    document.getElementById('vDiferenciais').value = (full.diferenciais || []).join('\n')
    document.getElementById('vCompetencias').value = (full.competencias || []).join('\n')
    document.getElementById('vSalario').value      = full.salario || ''
    document.getElementById('vRegime').value       = full.regime || ''
  })
  openModal('modalVaga')
}

async function saveVaga() {
  const editId = document.getElementById('editVagaId').value
  const id       = document.getElementById('vId').value.trim()
  const titulo   = document.getElementById('vTitulo').value.trim()
  const marca    = document.getElementById('vMarca').value.trim()
  const descricao= document.getElementById('vDescricao').value.trim()
  const requisitos   = document.getElementById('vRequisitos').value.split('\n').map(s => s.trim()).filter(Boolean)
  const diferenciais = document.getElementById('vDiferenciais').value.split('\n').map(s => s.trim()).filter(Boolean)
  const competencias = document.getElementById('vCompetencias').value.split('\n').map(s => s.trim()).filter(Boolean)
  const salario  = document.getElementById('vSalario').value.trim()
  const regime   = document.getElementById('vRegime').value.trim()
  const errEl    = document.getElementById('vagaError')
  errEl.style.display = 'none'

  if (!titulo || !descricao || !requisitos.length || !competencias.length || !salario || !regime) {
    errEl.textContent = 'Preencha todos os campos obrigatórios (*).'; errEl.style.display = 'block'; return
  }
  if (!editId && !id) { errEl.textContent = 'ID da vaga é obrigatório.'; errEl.style.display = 'block'; return }

  const body = { titulo, marca: marca || 'Não especificado', descricao, requisitos, diferenciais, competencias, salario, regime }
  const url    = editId ? `/api/vagas/${editId}` : '/api/vagas'
  const method = editId ? 'PUT' : 'POST'
  if (!editId) body.id = id

  try {
    const r = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) })
    const d = await r.json()
    if (!r.ok) { errEl.textContent = d.error || 'Erro ao salvar.'; errEl.style.display = 'block'; return }
    closeModal('modalVaga')
    showToast(`✓ Vaga ${editId ? 'atualizada' : 'criada'}!`)
    await loadVagas()
  } catch { errEl.textContent = 'Erro de conexão.'; errEl.style.display = 'block' }
}

async function deactivateVaga(id, titulo) {
  if (!confirm(`Desativar a vaga "${titulo}"? Ela deixará de aparecer na triagem.`)) return
  try {
    await fetch(`/api/vagas/${id}`, { method: 'DELETE', headers: authHeaders() })
    showToast('✓ Vaga desativada.')
    await loadVagas()
  } catch { showToast('Erro', true) }
}

// ── Shared ────────────────────────────────────────────────────────────────────
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open') }
function openModal(id)   { document.getElementById(id).classList.add('on') }
function closeModal(id)  { document.getElementById(id).classList.remove('on') }
document.querySelectorAll('.intranet-modal-overlay').forEach(m =>
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('on') }))

function esc(s) {
  return (s || '').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
function fmtTime(dt) {
  if (!dt) return ''
  const d = new Date(dt); if (isNaN(d)) return dt
  const diff = Math.floor((new Date() - d) / 1000)
  if (diff < 60) return 'agora'
  if (diff < 3600) return `${Math.floor(diff/60)}min atrás`
  if (diff < 86400) return `${Math.floor(diff/3600)}h atrás`
  return d.toLocaleDateString('pt-BR')
}
let toastT
function showToast(msg, err = false) {
  clearTimeout(toastT)
  const t = document.getElementById('toast')
  t.textContent = msg; t.className = err ? 'err show' : 'show'
  toastT = setTimeout(() => t.classList.remove('show'), 3500)
}

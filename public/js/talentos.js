'use strict'

if (!requireAuth()) throw new Error('not auth')

const _user = getUser()
if (!['admin', 'rh'].includes(_user.role)) {
  window.location.href = 'intranet.html'
  throw new Error('sem permissão')
}

const _headers = { Authorization: `Bearer ${getToken()}` }

let allTalentos        = []
let editCandidateId    = null

;(async () => {
  await loadTalentos()
  document.getElementById('searchName').addEventListener('input', render)
  document.getElementById('searchTag').addEventListener('input',  render)
  document.getElementById('teTags').addEventListener('input', updateTagPreview)
})()

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function loadTalentos() {
  try {
    const r = await fetch('/api/talentos', { headers: _headers })
    allTalentos = await r.json()
    render()
  } catch {
    document.getElementById('tlGrid').innerHTML =
      '<p style="color:var(--red);text-align:center;padding:40px 0">Erro ao carregar. Servidor offline?</p>'
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  const name = document.getElementById('searchName').value.toLowerCase()
  const tag  = document.getElementById('searchTag').value.toLowerCase()

  let list = allTalentos
  if (name) list = list.filter(t => (t.name || '').toLowerCase().includes(name))
  if (tag)  list = list.filter(t => {
    const tags = parseTags(t.tags)
    return tags.some(tg => tg.toLowerCase().includes(tag))
  })

  document.getElementById('tlCount').textContent =
    allTalentos.length ? `${list.length} de ${allTalentos.length} talento(s)` : ''

  const grid  = document.getElementById('tlGrid')
  const empty = document.getElementById('tlEmpty')

  if (!allTalentos.length) {
    grid.style.display  = 'none'
    empty.style.display = ''
    return
  }

  grid.style.display  = ''
  empty.style.display = 'none'
  grid.innerHTML = list.length
    ? list.map(buildCard).join('')
    : '<div class="tl-loading">Nenhum talento encontrado para os filtros aplicados.</div>'

  grid.querySelectorAll('.tl-btn-edit').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(
      Number(btn.dataset.id), btn.dataset.name, btn.dataset.tags, btn.dataset.notas
    ))
  })
  grid.querySelectorAll('.tl-btn-remove').forEach(btn => {
    btn.addEventListener('click', () => removeTalento(Number(btn.dataset.id), btn.dataset.name))
  })
  grid.querySelectorAll('.tl-btn-wa').forEach(btn => {
    btn.addEventListener('click', () => {
      const phone = btn.dataset.phone
      const name  = btn.dataset.name
      window.open(`https://wa.me/${phone}?text=Olá ${encodeURIComponent(name.split(' ')[0])}!`, '_blank')
    })
  })
}

function buildCard(t) {
  const tags    = parseTags(t.tags)
  const score   = t.ai_score_total
  const sColor  = score >= 66 ? 'var(--green)' : score >= 41 ? 'var(--amber)' : 'var(--red)'
  const [y, m, d] = (t.added_at || '').split(' ')[0].split('-')
  const dateFmt = d && m && y ? `${d}/${m}/${y}` : '—'
  const statusCls = t.status?.toLowerCase().includes('confirm') ? 'confirmado'
                  : t.status?.toLowerCase().includes('recus') ? 'recusado'
                  : t.status?.toLowerCase().includes('aprov') ? 'aprovado'
                  : 'other'

  const tagsHtml = tags.length
    ? tags.map(tg => `<span class="tl-tag">${esc(tg)}</span>`).join('')
    : '<span class="tl-no-tags">Sem tags — clique em Editar para adicionar</span>'

  return `<div class="tl-card">
    <div class="tl-card-head">
      <div class="tl-card-info">
        <div class="tl-card-name">${esc(t.name || 'Sem nome')}</div>
        <div class="tl-card-meta">
          <span>${esc(t.vaga_titulo || t.job_position || '—')}</span>
          <span class="tl-status ${statusCls}">${esc(t.status || '—')}</span>
        </div>
      </div>
      ${score ? `<div class="tl-card-score" style="color:${sColor}">${score}</div>` : ''}
    </div>

    <div class="tl-added-info">
      &#11088; Adicionado em ${dateFmt}${t.added_by ? ` por ${esc(t.added_by)}` : ''}
    </div>

    <div class="tl-tags-row">${tagsHtml}</div>

    ${t.notas ? `<div class="tl-notas">${esc(t.notas)}</div>` : ''}

    <div class="tl-card-actions">
      ${t.phone ? `<button class="ctbtn ctbtn-wa tl-btn-wa" data-phone="${esc(t.phone)}" data-name="${esc(t.name)}">&#128172; Contato WA</button>` : ''}
      <button class="ctbtn ctbtn-edit tl-btn-edit"
        data-id="${t.candidate_id}"
        data-name="${esc(t.name)}"
        data-tags="${esc(t.tags || '')}"
        data-notas="${esc(t.notas || '')}">&#9998; Editar</button>
      <button class="ctbtn ctbtn-remove tl-btn-remove"
        data-id="${t.candidate_id}"
        data-name="${esc(t.name)}">&#128465; Remover</button>
    </div>
  </div>`
}

// ── Remover ───────────────────────────────────────────────────────────────────
async function removeTalento(candidateId, name) {
  if (!confirm(`Remover ${name || 'este candidato'} do banco de talentos?`)) return
  try {
    const r = await fetch(`/api/talentos/${candidateId}`, { method: 'DELETE', headers: _headers })
    const d = await r.json()
    if (!d.ok) throw new Error(d.error)
    showToast('Candidato removido do banco')
    allTalentos = allTalentos.filter(t => t.candidate_id !== candidateId)
    render()
  } catch (e) { showToast(e.message, true) }
}

// ── Modal Editar ──────────────────────────────────────────────────────────────
function openEditModal(candidateId, name, tags, notas) {
  editCandidateId = candidateId
  document.getElementById('teCandidateName').textContent = name || ''
  document.getElementById('teTags').value  = tags  || ''
  document.getElementById('teNotas').value = notas || ''
  updateTagPreview()
  document.getElementById('editOverlay').style.display = 'flex'
}

function closeEditModal(e) {
  if (e && e.target !== document.getElementById('editOverlay')) return
  document.getElementById('editOverlay').style.display = 'none'
  editCandidateId = null
}

function updateTagPreview() {
  const raw  = document.getElementById('teTags').value
  const tags = parseTags(raw)
  const wrap = document.getElementById('tePreviewTags')
  wrap.innerHTML = tags.map(t =>
    `<span class="te-tag-chip" title="Clique para remover" onclick="removeTagChip('${esc(t)}')">${esc(t)} ×</span>`
  ).join('')
}

function removeTagChip(tag) {
  const input = document.getElementById('teTags')
  const tags  = parseTags(input.value).filter(t => t !== tag)
  input.value = tags.join(', ')
  updateTagPreview()
}

async function saveEdit() {
  if (!editCandidateId) return
  const tags  = document.getElementById('teTags').value.trim() || null
  const notas = document.getElementById('teNotas').value.trim() || null
  const btn   = document.getElementById('teSaveBtn')

  btn.disabled = true; btn.textContent = 'Salvando...'
  try {
    const r = await fetch(`/api/talentos/${editCandidateId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', ...  _headers },
      body:    JSON.stringify({ tags, notas }),
    })
    const d = await r.json()
    if (!d.ok) throw new Error(d.error)

    const idx = allTalentos.findIndex(t => t.candidate_id === editCandidateId)
    if (idx !== -1) { allTalentos[idx].tags = tags; allTalentos[idx].notas = notas }

    document.getElementById('editOverlay').style.display = 'none'
    showToast('Talento atualizado')
    render()
  } catch (e) { showToast(e.message, true) }
  finally { btn.disabled = false; btn.textContent = '✓ Salvar' }
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function parseTags(raw) {
  if (!raw) return []
  let arr
  try { arr = JSON.parse(raw) } catch { arr = raw.split(',') }
  return arr.map(t => String(t).trim()).filter(Boolean)
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

let _tt
function showToast(msg, err) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.className = err ? 'err show' : 'show'
  clearTimeout(_tt)
  _tt = setTimeout(() => t.className = '', 3000)
}

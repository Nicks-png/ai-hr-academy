'use strict'

const DIM_LABELS = {
  heartist:        'Heartist®',
  tecnico:         'Técnico',
  disponibilidade: 'Disponibilidade',
  experiencia:     'Experiência',
  potencial:       'Potencial',
}

const STATUS_CONTACT = ['Aprovado na Triagem', 'Triado']
let allCandidates = []
let allVagas      = []

;(async () => {
  await Promise.all([fetchVagas(), fetchCandidates()])
  document.getElementById('vagaFilter').addEventListener('change', render)
  document.getElementById('searchInput').addEventListener('input',  render)
  document.getElementById('btnContactAll').addEventListener('click', contactAll)
})()

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchCandidates() {
  try {
    const r = await fetch('/api/selecao/candidates')
    const all = await r.json()
    allCandidates = all.filter(c => STATUS_CONTACT.includes(c.status))
    render()
  } catch {
    document.getElementById('vagaGroups').innerHTML =
      '<p style="color:var(--red);text-align:center;padding:40px 0">Erro ao carregar candidatos. Servidor offline?</p>'
  }
}

async function fetchVagas() {
  try {
    const r = await fetch('/api/vagas')
    allVagas = await r.json()
    const sel = document.getElementById('vagaFilter')
    allVagas.forEach(v => {
      const o = document.createElement('option')
      o.value = v.id; o.textContent = v.titulo
      sel.appendChild(o)
    })
  } catch {}
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  const vagaId = document.getElementById('vagaFilter').value
  const term   = document.getElementById('searchInput').value.toLowerCase()

  let list = allCandidates
  if (vagaId) list = list.filter(c => c.job_id === vagaId)
  if (term)   list = list.filter(c => (c.name || '').toLowerCase().includes(term))

  document.getElementById('ctCount').textContent = list.length ? `${list.length} candidato(s)` : ''

  const aprovados = list.filter(c => c.status === 'Aprovado na Triagem')
  document.getElementById('btnContactAll').disabled = aprovados.length === 0
  document.getElementById('btnContactAll').textContent =
    aprovados.length > 0
      ? `\u25b6 Contatar ${aprovados.length} aprovado(s) via WhatsApp`
      : '\u25b6 Contatar todos os aprovados'

  if (!list.length) {
    document.getElementById('vagaGroups').style.display = 'none'
    document.getElementById('emptyState').style.display = ''
    return
  }

  document.getElementById('vagaGroups').style.display = ''
  document.getElementById('emptyState').style.display = 'none'

  // Agrupar por vaga
  const byVaga = {}
  list.forEach(c => {
    const key = c.job_id || '_sem_vaga'
    if (!byVaga[key]) byVaga[key] = { titulo: c.vaga_titulo || c.job_position || 'Sem vaga', cands: [] }
    byVaga[key].cands.push(c)
  })

  const container = document.getElementById('vagaGroups')
  container.innerHTML = ''
  Object.values(byVaga).forEach(group => {
    const sec = document.createElement('div')
    sec.className = 'vaga-group'
    sec.innerHTML = `
      <div class="vg-header">
        <span class="vg-titulo">${esc(group.titulo)}</span>
        <span class="vg-count">${group.cands.length} candidato(s)</span>
      </div>
      <div class="vg-cards"></div>`
    const cards = sec.querySelector('.vg-cards')
    group.cands.sort((a, b) => (b.ai_score_total || 0) - (a.ai_score_total || 0))
    group.cands.forEach(c => cards.appendChild(buildCard(c)))
    container.appendChild(sec)
  })
}

// ── Card ──────────────────────────────────────────────────────────────────────
function buildCard(c) {
  const card = document.createElement('div')
  card.className = 'ct-card'
  card.dataset.id = c.id

  const score = c.ai_score_total
  const scoreColor = score >= 66 ? 'var(--green)' : score >= 41 ? 'var(--amber)' : 'var(--red)'
  const ring = score ? `conic-gradient(${scoreColor} ${score}%, rgba(255,255,255,0.06) 0)` : 'none'
  const isAprovado = c.status === 'Aprovado na Triagem'

  // Dimensões
  const dims = c.ai_dimensoes ? Object.entries(DIM_LABELS).map(([k, l]) => {
    const d   = c.ai_dimensoes[k] || {}
    const sc  = d.score ?? null
    const pct = sc !== null ? sc * 10 : 0
    const col = pct >= 66 ? 'var(--green)' : pct >= 41 ? 'var(--amber)' : 'var(--red)'
    return `<div class="dim-row">
      <span class="dim-lbl">${l}</span>
      <div class="dim-bar-sm"><div class="dim-fill-sm" style="width:${pct}%;background:${col}"></div></div>
      <span class="dim-sc" style="color:${col}">${sc ?? '—'}</span>
    </div>`
  }).join('') : ''

  const rec = normRec(c.ai_recomendacao)

  card.innerHTML = `
    <div class="ct-card-head">
      <div class="ct-card-info">
        <div class="ct-card-name">${esc(c.name || 'Sem nome')}</div>
        <div class="ct-card-meta">
          ${c.phone ? `<span>&#128222; ${esc(c.phone)}</span>` : '<span class="no-phone">Sem telefone</span>'}
          <span class="ct-status ${isAprovado ? 'aprovado' : 'triado'}">${esc(c.status)}</span>
        </div>
      </div>
      ${score ? `<div class="ct-score-ring" style="background:${ring}">
        <span style="color:${scoreColor}">${score}</span>
      </div>` : ''}
      ${c.ai_recomendacao ? `<div class="rec-badge ${rec}">${esc(c.ai_recomendacao)}</div>` : ''}
    </div>

    ${c.ai_resumo ? `<div class="ct-resumo">${esc(c.ai_resumo)}</div>` : ''}

    ${dims ? `<div class="ct-dims">${dims}</div>` : ''}

    <div class="ct-card-actions">
      ${isAprovado && c.phone
        ? `<button class="ctbtn ctbtn-wa" data-id="${c.id}">&#128172; Iniciar Contato WhatsApp</button>`
        : isAprovado && !c.phone
        ? `<button class="ctbtn ctbtn-phone" data-id="${c.id}">&#128222; Adicionar Telefone</button>`
        : ''
      }
      <a href="selecao.html" class="ctbtn ctbtn-pipeline">&#128203; Ver Pipeline</a>
    </div>`

  card.querySelector('.ctbtn-wa')?.addEventListener('click', e => {
    sendContact([Number(e.currentTarget.dataset.id)])
  })

  card.querySelector('.ctbtn-phone')?.addEventListener('click', () => {
    openPhoneModal(c.id, c.name)
  })

  return card
}

// ── Contato WhatsApp ──────────────────────────────────────────────────────────
async function sendContact(ids) {
  try {
    const r = await fetch('/api/candidates/advance', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ids }),
    })
    const data = await r.json()
    const ok   = (data.results || []).filter(r => r.ok).length
    const fail = (data.results || []).filter(r => !r.ok && !r.skipped).length
    if (ok)   showToast(`Contato enviado para ${ok} candidato(s)`)
    if (fail) showToast(`${fail} envio(s) falharam`, true)
    await fetchCandidates()
  } catch (e) {
    showToast(e.message, true)
  }
}

async function contactAll() {
  const aprovados = allCandidates.filter(c => c.status === 'Aprovado na Triagem' && c.phone)
  if (!aprovados.length) { showToast('Nenhum aprovado com telefone cadastrado', true); return }
  if (!confirm(`Enviar mensagem WhatsApp para ${aprovados.length} candidato(s)?`)) return
  await sendContact(aprovados.map(c => c.id))
}

// ── Modal telefone ─────────────────────────────────────────────────────────────
function openPhoneModal(id, name) {
  const phone = prompt(`Telefone de ${name} (ex: 11999999999):`)
  if (!phone?.trim()) return
  fetch(`/api/candidates/${id}/phone`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ phone: phone.trim() }),
  }).then(r => r.json()).then(d => {
    if (d.ok) { showToast('Telefone salvo'); fetchCandidates() }
    else showToast(d.error, true)
  }).catch(() => showToast('Erro ao salvar telefone', true))
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function normRec(r) {
  const n = (r || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (n.includes('avan')) return 'avancar'
  if (n.includes('aguar')) return 'aguardar'
  return 'dispensar'
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

let _tt
function showToast(msg, err) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.className = err ? 'err show' : 'show'
  clearTimeout(_tt)
  _tt = setTimeout(() => t.className = '', 3000)
}

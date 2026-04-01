'use strict'

// ── Pipeline de status ────────────────────────────────────────────────────────
const PIPELINE = [
  { key: 'Pendente',         label: 'Pendente'    },
  { key: 'Em Análise',       label: 'Em Análise'  },
  { key: 'Triado',           label: 'Triado'      },
  { key: 'Em Entrevista',    label: 'Entrevista'  },
  { key: 'Oferecido',        label: 'Oferecido'   },
  { key: 'Contratado',       label: 'Contratado'  },
]
const PIPELINE_KEYS = PIPELINE.map(s => s.key)
const TERMINAL = new Set(['Contratado', 'Intervenção Humana', 'Recusado'])

const DIM_LABELS = {
  heartist:        'Heartist®',
  tecnico:         'Técnico',
  disponibilidade: 'Disponibilidade',
  experiencia:     'Experiência',
  potencial:       'Potencial',
}

// ── Estado ────────────────────────────────────────────────────────────────────
const S = { candidates: [], vagas: [] }

// ── Init ──────────────────────────────────────────────────────────────────────
;(async () => {
  await Promise.all([fetchVagas(), fetchCandidates(), fetchWebhooks()])
  document.getElementById('vagaFilter').addEventListener('change', renderCandidates)
  document.getElementById('searchInput').addEventListener('input', renderCandidates)
  document.getElementById('btnAddWebhook').addEventListener('click', addWebhook)
})()

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchCandidates() {
  try {
    const r = await fetch('/api/selecao/candidates')
    S.candidates = await r.json()
    renderCandidates()
  } catch {
    document.getElementById('candidatesContainer').innerHTML =
      '<p class="sel-error">Erro ao carregar candidatos. Verifique se o servidor está rodando.</p>'
  }
}

async function fetchVagas() {
  try {
    const r = await fetch('/api/vagas')
    S.vagas = await r.json()
    const sel = document.getElementById('vagaFilter')
    S.vagas.forEach(v => {
      const o = document.createElement('option')
      o.value = v.id; o.textContent = v.titulo
      sel.appendChild(o)
    })
  } catch {}
}

// ── Render candidatos ─────────────────────────────────────────────────────────
function renderCandidates() {
  const vagaId     = document.getElementById('vagaFilter').value
  const term       = document.getElementById('searchInput').value.toLowerCase()
  const container  = document.getElementById('candidatesContainer')

  let list = S.candidates
  if (vagaId) list = list.filter(c => c.job_id === vagaId)
  if (term)   list = list.filter(c =>
    (c.name || '').toLowerCase().includes(term) ||
    (c.skills || []).some(s => s.toLowerCase().includes(term))
  )

  document.getElementById('selTotal').textContent =
    list.length ? `${list.length} candidato(s)` : ''

  if (!list.length) {
    container.innerHTML = '<p class="sel-empty">Nenhum candidato encontrado.</p>'
    return
  }

  container.innerHTML = ''
  list.forEach(c => container.appendChild(buildCard(c)))
}

function buildCard(c) {
  const card = document.createElement('div')
  card.className = 'cand-card'
  card.dataset.id = c.id

  const isHuman   = c.status === 'Intervenção Humana'
  const pipeIdx   = PIPELINE_KEYS.indexOf(c.status)
  const nextStep  = pipeIdx >= 0 && pipeIdx < PIPELINE.length - 1 ? PIPELINE[pipeIdx + 1] : null
  const isEnd     = TERMINAL.has(c.status)

  const score = c.ai_score_total
  const scoreColor = score >= 66 ? 'var(--green)' : score >= 41 ? 'var(--amber)' : 'var(--red)'
  const ring = score
    ? `conic-gradient(${scoreColor} ${score}%, rgba(255,255,255,0.06) 0)`
    : 'none'

  // Skills
  const skillsHtml = (c.skills || []).length
    ? (c.skills || []).map(s => `<span class="skill-tag">${esc(s)}</span>`).join('')
    : '<span class="no-data">Sem skills</span>'

  // Dimensões compactas
  const dimsHtml = c.ai_dimensoes
    ? Object.entries(DIM_LABELS).map(([k, l]) => {
        const sc  = c.ai_dimensoes[k]?.score ?? null
        const pct = sc !== null ? sc * 10 : 0
        const col = pct >= 66 ? 'var(--green)' : pct >= 41 ? 'var(--amber)' : 'var(--red)'
        return `<div class="dim-row">
          <span class="dim-lbl">${l}</span>
          <div class="dim-bar-sm"><div class="dim-fill-sm" style="width:${pct}%;background:${col}"></div></div>
          <span class="dim-sc" style="color:${col}">${sc ?? '—'}</span>
        </div>`
      }).join('')
    : ''

  card.innerHTML = `
    <div class="cc-head">
      <div class="cc-info">
        <div class="cc-name">${esc(c.name || 'Sem nome')}</div>
        <div class="cc-vaga">${esc(c.vaga_titulo || c.job_position || '—')}</div>
      </div>
      ${score ? `
      <div class="cc-score-ring" style="background:${ring}">
        <span style="color:${scoreColor}">${score}</span>
      </div>` : ''}
      ${c.ai_recomendacao ? `<div class="rec-badge ${normRec(c.ai_recomendacao)}">${esc(c.ai_recomendacao)}</div>` : ''}
    </div>

    ${c.ai_resumo ? `<div class="cc-resumo">${esc(c.ai_resumo)}</div>` : ''}

    ${dimsHtml ? `<div class="cc-dims">${dimsHtml}</div>` : ''}

    <div class="cc-skills">${skillsHtml}</div>

    <!-- Pipeline -->
    <div class="pipeline ${isHuman ? 'pipeline-human' : ''}">
      ${isHuman
        ? `<div class="pipe-human">&#128100; Intervenção Humana — IA desativada</div>`
        : PIPELINE.map((s, i) => `
            <div class="pipe-step ${i < pipeIdx ? 'done' : i === pipeIdx ? 'active' : ''}">${s.label}</div>
            ${i < PIPELINE.length - 1 ? `<div class="pipe-conn ${i < pipeIdx ? 'done' : ''}"></div>` : ''}
          `).join('')
      }
    </div>

    <!-- ActionField -->
    <div class="action-field">
      ${!isEnd && nextStep
        ? `<button class="af-btn af-advance" data-id="${c.id}" data-next="${nextStep.key}">
             &#8594; Avançar para <b>${nextStep.label}</b>
           </button>`
        : ''
      }
      <button class="af-btn af-webhook" data-id="${c.id}">&#9889; Disparar Webhook</button>
      ${!isHuman
        ? `<button class="af-btn af-human" data-id="${c.id}">&#128100; Intervenção Humana</button>`
        : ''
      }
    </div>`

  // ── Eventos do card ──
  card.querySelector('.af-advance')?.addEventListener('click', async e => {
    const btn = e.currentTarget
    btn.disabled = true
    btn.textContent = 'Salvando...'
    await promoteCandidate(c.id, btn.dataset.next)
  })

  card.querySelector('.af-webhook')?.addEventListener('click', async e => {
    e.currentTarget.disabled = true
    await manualFireWebhook(c)
    e.currentTarget.disabled = false
  })

  card.querySelector('.af-human')?.addEventListener('click', async e => {
    if (!confirm(`Transferir "${c.name}" para intervenção humana?`)) return
    e.currentTarget.disabled = true
    await transferToHuman(c.id)
  })

  return card
}

// ── Ações ────────────────────────────────────────────────────────────────────
async function promoteCandidate(id, nextStatus) {
  try {
    const r = await fetch(`/api/selecao/promote/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nextStatus }),
    })
    if (!r.ok) throw new Error((await r.json()).error)
    showToast(`Avançado para "${nextStatus}"`)
    await fetchCandidates()
  } catch (e) {
    showToast(e.message, true)
    await fetchCandidates()
  }
}

async function transferToHuman(id) {
  try {
    const r = await fetch(`/api/selecao/transfer-human/${id}`, { method: 'POST' })
    if (!r.ok) throw new Error((await r.json()).error)
    showToast('Transferido para intervenção humana')
    await fetchCandidates()
  } catch (e) {
    showToast(e.message, true)
    await fetchCandidates()
  }
}

async function manualFireWebhook(c) {
  const hooks = await fetch('/api/webhooks').then(r => r.json()).catch(() => [])
  if (!hooks.length) { showToast('Nenhum webhook configurado', true); return }
  const payload = {
    event:        'manual_trigger',
    candidate_id: c.id,
    name:         c.name,
    status:       c.status,
    job_id:       c.job_id,
    score:        c.ai_score_total,
    recomendacao: c.ai_recomendacao,
    timestamp:    new Date().toISOString(),
  }
  let ok = 0
  for (const h of hooks) {
    try {
      await fetch(h.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      ok++
    } catch {}
  }
  showToast(`Webhook disparado para ${ok}/${hooks.length} endpoint(s)`)
}

// ── Webhooks UI ───────────────────────────────────────────────────────────────
async function fetchWebhooks() {
  try {
    const list = await fetch('/api/webhooks').then(r => r.json())
    renderWebhooks(list)
  } catch {}
}

function renderWebhooks(list) {
  const el = document.getElementById('webhookList')
  if (!list.length) {
    el.innerHTML = '<p class="wh-empty">Nenhum webhook configurado.</p>'
    return
  }
  el.innerHTML = ''
  list.forEach(h => {
    const row = document.createElement('div')
    row.className = 'wh-row'
    row.innerHTML = `
      <div class="wh-row-info">
        <span class="wh-row-label">${esc(h.label || 'Sem rótulo')}</span>
        <span class="wh-row-url">${esc(h.url)}</span>
      </div>
      <div class="wh-row-actions">
        <button class="wh-btn wh-test" data-id="${h.id}">Testar</button>
        <button class="wh-btn wh-del"  data-id="${h.id}">&#215; Remover</button>
      </div>`
    row.querySelector('.wh-test').addEventListener('click', () => testWebhook(h.id, row))
    row.querySelector('.wh-del').addEventListener('click',  () => deleteWebhook(h.id))
    el.appendChild(row)
  })
}

async function addWebhook() {
  const url   = document.getElementById('whUrl').value.trim()
  const label = document.getElementById('whLabel').value.trim()
  if (!url.startsWith('http')) { showToast('URL inválida', true); return }
  try {
    const r = await fetch('/api/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, label }),
    })
    if (!r.ok) throw new Error((await r.json()).error)
    document.getElementById('whUrl').value   = ''
    document.getElementById('whLabel').value = ''
    showToast('Webhook adicionado')
    await fetchWebhooks()
  } catch (e) { showToast(e.message, true) }
}

async function deleteWebhook(id) {
  await fetch(`/api/webhooks/${id}`, { method: 'DELETE' })
  showToast('Webhook removido')
  await fetchWebhooks()
}

async function testWebhook(id, rowEl) {
  const btn = rowEl.querySelector('.wh-test')
  btn.disabled = true; btn.textContent = 'Enviando...'
  try {
    const r = await fetch(`/api/webhooks/test/${id}`, { method: 'POST' })
    btn.textContent = r.ok ? '✓ OK' : '✗ Falhou'
    setTimeout(() => { btn.disabled = false; btn.textContent = 'Testar' }, 2000)
    if (!r.ok) { const e = await r.json(); showToast(e.error, true) }
    else showToast('Webhook testado com sucesso')
  } catch (e) {
    btn.textContent = '✗ Erro'; setTimeout(() => { btn.disabled = false; btn.textContent = 'Testar' }, 2000)
    showToast(e.message, true)
  }
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
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

let _toastTimer
function showToast(msg, err) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.className   = err ? 'err show' : 'show'
  clearTimeout(_toastTimer)
  _toastTimer = setTimeout(() => t.className = '', 3000)
}

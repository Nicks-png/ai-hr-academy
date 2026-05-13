'use strict'

const DIM_LABELS = {
  heartist:     'Heartist®',
  tecnico:      'Técnico',
  estabilidade: 'Estabilidade',
  experiencia:  'Experiência',
  potencial:    'Potencial',
}

const STATUS_CONTACT = ['Aprovado na Triagem', 'Triado', 'Confirmado']

const SCORECARD_CRITERIA = [
  { field: 'pontualidade', label: 'Pontualidade' },
  { field: 'apresentacao', label: 'Apresentação' },
  { field: 'comunicacao',  label: 'Comunicação' },
  { field: 'tecnico',      label: 'Aderência técnica' },
  { field: 'fit_cultural', label: 'Fit cultural' },
]

let allCandidates      = []
let allVagas           = []
let feedbackMap        = {} // candidateId → feedback
let activeSchedule     = null
let slotAssignment     = {}
let scorecardCandidateId = null
let scorecardValues    = {}

;(async () => {
  loadSchedule()
  await Promise.all([fetchVagas(), fetchCandidates(), fetchFeedbacks()])
  document.getElementById('vagaFilter').addEventListener('change', render)
  document.getElementById('searchInput').addEventListener('input',  render)
  document.getElementById('btnContactAll').addEventListener('click', contactAll)
})()

// ── Schedule ──────────────────────────────────────────────────────────────────
function loadSchedule() {
  try {
    const raw = localStorage.getItem('hrInterviewSchedule')
    activeSchedule = raw ? JSON.parse(raw) : null
  } catch { activeSchedule = null }
}

function showScheduleBanner() {
  const el = document.getElementById('scheduleBanner')
  if (!el) return
  if (!activeSchedule?.date) { el.style.display = 'none'; return }
  const [y, m, d] = activeSchedule.date.split('-')
  const slots = []
  for (let i = 0; i < activeSchedule.numSlots; i++)
    slots.push(addMinutes(activeSchedule.startTime, i * 30))
  el.style.display = ''
  el.innerHTML =
    `<span class="sb-icon">📅</span>` +
    `<span class="sb-info"><strong>${d}/${m}/${y}</strong> &mdash; ${slots.join(' &middot; ')}` +
    ` <span class="sb-count">(${activeSchedule.numSlots} horário${activeSchedule.numSlots !== 1 ? 's' : ''})</span></span>` +
    `<button class="sched-clear-btn" id="btnClearSched">&times; Limpar agenda</button>`
  document.getElementById('btnClearSched')?.addEventListener('click', clearSchedule)
}

function clearSchedule() {
  localStorage.removeItem('hrInterviewSchedule')
  activeSchedule = null
  showScheduleBanner()
  render()
}

function addMinutes(time, mins) {
  const [h, m] = (time || '08:00').split(':').map(Number)
  const total  = h * 60 + m + mins
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')
}

function schedDateFormatted() {
  if (!activeSchedule?.date) return null
  const [y, m, d] = activeSchedule.date.split('-')
  return `${d}/${m}/${y}`
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchCandidates() {
  try {
    const r   = await fetch('/api/selecao/candidates')
    const all = await r.json()
    allCandidates = all.filter(c => STATUS_CONTACT.includes(c.status))
    allCandidates.forEach(c => {
      if (typeof c.ai_dimensoes === 'string') {
        try { c.ai_dimensoes = JSON.parse(c.ai_dimensoes) } catch(_) { c.ai_dimensoes = null }
      }
    })
    render()
  } catch {
    document.getElementById('vagaGroups').innerHTML =
      '<p style="color:var(--red);text-align:center;padding:40px 0">Erro ao carregar candidatos. Servidor offline?</p>'
  }
}

async function fetchFeedbacks() {
  try {
    const token = typeof getToken === 'function' ? getToken() : null
    if (!token) return
    const r = await fetch('/api/feedback', { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) return
    const rows = await r.json()
    feedbackMap = {}
    rows.forEach(f => { feedbackMap[f.candidate_id] = f })
  } catch {}
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

  showScheduleBanner()

  // Build global slot assignment: sort approved by score descending
  const aprovadosGlobal = list
    .filter(c => c.status === 'Aprovado na Triagem')
    .sort((a, b) => (b.ai_score_total || 0) - (a.ai_score_total || 0))
  slotAssignment = {}
  aprovadosGlobal.forEach((c, i) => { slotAssignment[c.id] = i })

  const maxContact = activeSchedule
    ? aprovadosGlobal.filter((_, i) => i < activeSchedule.numSlots).filter(c => c.phone).length
    : aprovadosGlobal.filter(c => c.phone).length
  document.getElementById('btnContactAll').disabled = maxContact === 0
  document.getElementById('btnContactAll').textContent =
    maxContact > 0
      ? `\u25b6 Contatar ${maxContact} aprovado(s) via WhatsApp`
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

  const score        = c.ai_score_total
  const scoreColor   = score >= 66 ? 'var(--green)' : score >= 41 ? 'var(--amber)' : 'var(--red)'
  const isAprovado   = c.status === 'Aprovado na Triagem'
  const isConfirmado = c.status === 'Confirmado'
  const feedback     = feedbackMap[c.id]
  const fbAvg        = feedback ? avgScore(feedback) : null

  // Slot info
  const slotIdx  = slotAssignment[c.id] ?? -1
  const hasSlot  = !activeSchedule || (slotIdx >= 0 && slotIdx < activeSchedule.numSlots)
  const slotTime = activeSchedule && slotIdx >= 0 ? addMinutes(activeSchedule.startTime, slotIdx * 30) : null
  const dateFmt  = schedDateFormatted()

  // Vaga data for message template
  const vaga = allVagas.find(v => v.id === c.job_id)

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
          <span class="ct-status ${isAprovado ? 'aprovado' : isConfirmado ? 'confirmado' : 'triado'}">${esc(c.status)}</span>
          ${slotTime ? `<span class="slot-time">&#128336; ${slotTime}</span>` : ''}
        </div>
      </div>
      ${score ? `<div class="ct-score-badge" style="color:${scoreColor}">${score}</div>` : ''}
      ${c.ai_recomendacao ? `<div class="rec-badge ${rec}">${esc(c.ai_recomendacao)}</div>` : ''}
      ${fbAvg !== null ? `<div class="feedback-badge">&#9733; ${fbAvg}</div>` : ''}
    </div>

    ${c.ai_resumo ? `<div class="ct-resumo">${esc(c.ai_resumo)}</div>` : ''}

    ${dims ? `<div class="ct-dims">${dims}</div>` : ''}

    ${isAprovado ? `<div class="ct-msg-wrap">
      <label class="ct-msg-label">&#128172; Mensagem WhatsApp</label>
      <textarea class="ct-msg"></textarea>
    </div>` : ''}

    <div class="ct-card-actions">
      ${isAprovado && c.phone && hasSlot
        ? `<button class="ctbtn ctbtn-wa" data-id="${c.id}">&#128172; Iniciar Contato WhatsApp</button>`
        : isAprovado && c.phone && !hasSlot
        ? `<button class="ctbtn ctbtn-wa ctbtn-no-slot" disabled>&#128683; Sem hor&#225;rio dispon&#237;vel</button>`
        : isAprovado && !c.phone
        ? `<button class="ctbtn ctbtn-phone" data-id="${c.id}">&#128222; Adicionar Telefone</button>`
        : ''
      }
      ${c.status === 'Contato enviado' ? `
        <button class="ctbtn ctbtn-confirm" data-id="${c.id}">&#10003; Confirmar</button>
        <button class="ctbtn ctbtn-reject"  data-id="${c.id}">&#10007; Recusar</button>` : ''}
      ${isConfirmado ? `<button class="ctbtn ctbtn-avaliar" data-id="${c.id}" data-name="${esc(c.name)}">${feedback ? '&#9998; Editar Avalia&#231;&#227;o' : '&#9733; Avaliar Entrevista'}</button>` : ''}
      <a href="selecao.html" class="ctbtn ctbtn-pipeline">&#128203; Ver Pipeline</a>
      <button class="ctbtn ctbtn-delete" data-id="${c.id}" title="Excluir candidato">&#128465; Excluir</button>
    </div>`

  // Set textarea value (no HTML escaping for raw text)
  if (isAprovado) {
    const ta = card.querySelector('.ct-msg')
    if (ta) ta.value = defaultMsg(c, vaga, dateFmt, slotTime)
  }

  card.querySelector('.ctbtn-wa:not([disabled])')?.addEventListener('click', e => {
    const msg = card.querySelector('.ct-msg')?.value || ''
    sendContact([{ id: Number(e.currentTarget.dataset.id), message: msg }])
  })

  card.querySelector('.ctbtn-phone')?.addEventListener('click', () => {
    openPhoneModal(c.id, c.name)
  })

  card.querySelector('.ctbtn-confirm')?.addEventListener('click', () => {
    manualStatus(c.id, 'Confirmado')
  })

  card.querySelector('.ctbtn-reject')?.addEventListener('click', () => {
    manualStatus(c.id, 'Recusado')
  })

  card.querySelector('.ctbtn-delete')?.addEventListener('click', () => {
    deleteCandidate(c.id, c.name)
  })

  card.querySelector('.ctbtn-avaliar')?.addEventListener('click', () => {
    openScorecardModal(c.id, c.name)
  })

  return card
}

// ── Message template ──────────────────────────────────────────────────────────
function defaultMsg(c, vaga, date, time) {
  const cargo   = vaga?.titulo || c.job_position || 'Aux. de Cozinha'
  const dataFmt = date || 'xx/xx/xxxx'
  const horaFmt = time ? time.replace(':', 'h') : 'xxhxx'

  const nome = (c.name || 'candidato').split(' ')[0]

  return `Olá, ${nome}! 😊

Recebemos sua candidatura para a vaga de ${cargo} e gostaríamos de te convidar para uma entrevista no dia ${dataFmt} às ${horaFmt}

Algumas informações importantes sobre a vaga:

Escala 6x1 - das 07h às 15h20 ou das 15h às 23h10

Salário R$2188.71 + 4 pontos de taxa de serviço

Informações adicionais Benefícios:
•    Restaurante de colaboradores - Para você desfrutar de uma refeição deliciosa e balanceada todos os dias. 😊
•    Folga extra no mês de Aniversário - Para você aproveitar do seu jeito! 🎉
•    Almoço de Aniversáriantes do mês – Bovinu's (com Gerente Geral) 🍖
•    PPR 1 vez ao ano de até 1,2 salários mediante alcance de metas - Construímos e alcançamos juntos! 📉
•    Plano de Saúde Amil - Cuidar da saúde é fundamental! 😍
•    Plano odontológico opcional - Pois a vida é feita de sorrisos 😃
•    Vale Transporte ou estacionamento do local – Para o seu deslocamento com segurança. 🚌
•    Seguro de Vida em grupo– É bom prevenir, né? 🤝
•    Previdência Privada com participação da empresa - Para um futuro com segurança!💰
•    Descontos em instituições de ensino - Ajudamos você na jornada acadêmica! 🫰🏽
•    Supletivo virtual para colaboradores, parentes e amigos - Incentivo e capacitação, buscando potencializar o desenvolvimento das nossas pessoas. 🚀
•    Licença Maternidade e Paternidade Estendidas - Através da extensão da licença você conseguirá acompanhar mais de perto e por mais tempo o desenvolvimento na fase inicial da vida do seu bebê! 🙂
•    Licenças casamento, falecimento estendidas ☀️
•    Programa de Apoio ao Colaborador PAC – Orientação psicológica, jurídica, assistência social, financeira e atendimento nutricional - Que visam proporcionar bem-estar aos colaboradores, e seus dependentes legais (cônjuge, enteados e filhos até 24 anos), focando no equilíbrio entre corpo, mente e alma. 📝
•    Descontos especiais em salões de beleza parceiros – Porque é preciso se sentir especial 💇🏾‍♀️💇🏾‍♂️
•    Reembolso medicamentos 50% após 6 meses de contratação 🤒
•    Prêmios fidelização – 1, 5, 10, 20 e 30 anos de Accor. Queremos que você se sinta valorizado e queira estar conosco⏳
•    Lavanderia para uniformes Para que no seu tempo livre, não tenha que pensar se tem roupa limpa para trabalhar!🧺
•    Auxilio academia de até R$80,00 💪🏽

(todos os benefícios estão sujeitos à alterações de acordo com as políticas e regimentos internos da Accor)

Temos orgulho de conquistar posições de destaque entre as melhores empresas para trabalhar pelo Great Place to Work (GPTW) por 28 anos seguidos:

🏆 2° lugar na categoria LGBTI+ - Grandes Empresas
🏆 9º lugar na categoria Mulheres – Grandes Empresas
🏆 12º melhor empresa para se trabalhar no Brasil – categoria grandes empresas.

🌟 Todas as vagas estão abertas para talentos diversos — pessoas com deficiência, pessoas negras, LGBTQIAPN+, 50+ e outros.

Caso tenha interesse em participar, abaixo você encontra nosso endereço:
Endereço: Rua Joinville, 515 - Vila Mariana`
}

// ── Contato WhatsApp ──────────────────────────────────────────────────────────
async function sendContact(entries) {
  const btn = document.getElementById('btnContactAll')
  const prevText = btn?.textContent
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando...' }
  try {
    const r = await fetch('/api/candidates/advance', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ entries }),
    })
    const data = await r.json()
    const ok   = (data.results || []).filter(r => r.ok).length
    const sim  = (data.results || []).filter(r => r.simulated).length
    const fail = (data.results || []).filter(r => !r.ok && !r.skipped && !r.simulated).length
    if (ok)   showToast(`✅ Mensagem enviada para ${ok} candidato(s)`)
    if (sim)  showToast(`⚠️ ${sim} candidato(s) sem telefone real — adicione o número WhatsApp`, true)
    if (fail) showToast(`❌ ${fail} envio(s) falharam`, true)
    await fetchCandidates()
  } catch (e) {
    showToast(e.message, true)
    if (btn) { btn.disabled = false; btn.textContent = prevText }
  }
}

async function contactAll() {
  const aprovados = allCandidates
    .filter(c => c.status === 'Aprovado na Triagem' && c.phone)
    .sort((a, b) => (b.ai_score_total || 0) - (a.ai_score_total || 0))

  if (!aprovados.length) { showToast('Nenhum aprovado com telefone cadastrado', true); return }

  const canContact = activeSchedule
    ? aprovados.filter((_, i) => i < activeSchedule.numSlots)
    : aprovados

  if (!canContact.length) { showToast('Nenhum candidato com horário disponível', true); return }
  if (!confirm(`Enviar mensagem WhatsApp para ${canContact.length} candidato(s)?`)) return

  const entries = canContact.map(c => {
    let msg = ''
    const cardEl = document.querySelector(`.ct-card[data-id="${c.id}"]`)
    if (cardEl) {
      const ta = cardEl.querySelector('.ct-msg')
      if (ta) msg = ta.value
    }
    return { id: c.id, message: msg }
  })
  await sendContact(entries)
}

// ── Excluir candidato ─────────────────────────────────────────────────────────
async function deleteCandidate(id, name) {
  if (!confirm(`Excluir ${name || 'este candidato'}? Esta ação não pode ser desfeita.`)) return
  try {
    const r = await fetch(`/api/candidates/${id}`, { method: 'DELETE' })
    const d = await r.json()
    if (d.ok) {
      showToast('Candidato excluído')
      allCandidates = allCandidates.filter(c => c.id !== id)
      render()
    } else {
      showToast(d.error || 'Erro ao excluir', true)
    }
  } catch (e) {
    showToast(e.message, true)
  }
}

// ── Status manual ─────────────────────────────────────────────────────────────
async function manualStatus(id, newStatus) {
  try {
    const r = await fetch(`/api/selecao/promote/${id}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ nextStatus: newStatus }),
    })
    const d = await r.json()
    if (d.ok) { showToast(`Status atualizado: ${newStatus}`); fetchCandidates() }
    else showToast(d.error || 'Erro ao atualizar status', true)
  } catch { showToast('Erro ao atualizar status', true) }
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

// ── Scorecard ─────────────────────────────────────────────────────────────────
function openScorecardModal(candidateId, candidateName) {
  scorecardCandidateId = candidateId
  scorecardValues      = {}
  document.getElementById('scCandidateName').textContent = candidateName || ''
  buildScorecardRows(feedbackMap[candidateId] || null)
  document.getElementById('scorecardOverlay').style.display = 'flex'
}

function closeScorecardModal(e) {
  if (e && e.target !== document.getElementById('scorecardOverlay')) return
  document.getElementById('scorecardOverlay').style.display = 'none'
  scorecardCandidateId = null
}

function buildScorecardRows(existing) {
  const container = document.getElementById('scRows')
  container.innerHTML = SCORECARD_CRITERIA.map(c => {
    const val = existing?.[c.field] ?? 0
    const stars = [1,2,3,4,5].map(n =>
      `<button class="sc-star${val >= n ? ' active' : ''}" data-field="${c.field}" data-val="${n}" onclick="setStar('${c.field}',${n})">&#9733;</button>`
    ).join('')
    return `<div class="sc-row"><span class="sc-row-label">${c.label}</span><div class="sc-stars">${stars}</div></div>`
  }).join('')

  SCORECARD_CRITERIA.forEach(c => {
    if (existing?.[c.field]) scorecardValues[c.field] = existing[c.field]
  })
  document.getElementById('scNotas').value = existing?.notas || ''
}

function setStar(field, val) {
  scorecardValues[field] = val
  document.querySelectorAll(`.sc-stars [data-field="${field}"]`).forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.val) <= val)
  })
}

async function saveScorecard() {
  if (!scorecardCandidateId) return
  const token = typeof getToken === 'function' ? getToken() : null
  if (!token) { showToast('Faça login para salvar a avaliação', true); return }

  const btn = document.getElementById('scSaveBtn')
  btn.disabled = true; btn.textContent = 'Salvando...'

  try {
    const r = await fetch('/api/feedback', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        candidate_id: scorecardCandidateId,
        notas: document.getElementById('scNotas').value.trim() || null,
        ...scorecardValues,
      }),
    })
    const d = await r.json()
    if (!d.ok) throw new Error(d.error || 'Erro ao salvar')

    feedbackMap[scorecardCandidateId] = {
      candidate_id: scorecardCandidateId,
      notas: document.getElementById('scNotas').value.trim() || null,
      ...scorecardValues,
    }
    document.getElementById('scorecardOverlay').style.display = 'none'
    showToast('Avaliação salva com sucesso')
    render()
  } catch (e) {
    showToast(e.message, true)
  } finally {
    btn.disabled = false; btn.textContent = '✓ Salvar Avaliação'
  }
}

function avgScore(feedback) {
  const vals = SCORECARD_CRITERIA.map(c => feedback[c.field]).filter(v => v != null)
  if (!vals.length) return null
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)
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

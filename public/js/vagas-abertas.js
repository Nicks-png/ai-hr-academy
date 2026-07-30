'use strict'
if (!requireAuth('vagas')) throw new Error('not auth')

let _data = []

;(async () => {
  checkStatus()
  await load()
})()

async function checkStatus() {
  try {
    const d = await fetch('/api/status').then(r => r.json())
    document.getElementById('apiDot').className = `api-dot ${d.ok ? 'ok' : 'err'}`
    document.getElementById('apiTxt').textContent = d.ok ? d.model : 'sem chave'
  } catch { document.getElementById('apiTxt').textContent = 'offline' }
}

async function load() {
  document.getElementById('vagaGroups').innerHTML = '<div class="va-loading">Carregando vagas...</div>'
  try {
    _data = await fetch('/api/vagas-abertas', { headers: authHeaders() }).then(r => r.json())
    renderStats()
    renderGroups()
  } catch {
    document.getElementById('vagaGroups').innerHTML =
      '<div class="va-empty"><div class="va-empty-icon">&#10060;</div>Erro ao carregar. Verifique o servidor.</div>'
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function renderStats() {
  const totalVagas  = _data.length
  const totalCands  = _data.reduce((s, v) => s + v.total, 0)
  const confirmados = _data.reduce((s, v) => s + v.confirmados, 0)
  const aguardando  = _data.reduce((s, v) => s + v.aguardando, 0)
  const recusados   = _data.reduce((s, v) => s + v.recusados, 0)
  const responderam = _data.reduce((s, v) => s + v.responderam, 0)

  const stats = [
    { val: totalVagas,  lbl: 'vagas ativas',       cls: '' },
    { val: totalCands,  lbl: 'candidatos',          cls: '' },
    { val: confirmados, lbl: 'confirmados',         cls: 'green' },
    { val: responderam, lbl: 'responderam',         cls: 'amber' },
    { val: aguardando,  lbl: 'aguardando resposta', cls: 'amber' },
    { val: recusados,   lbl: 'recusados',           cls: 'red' },
  ]

  document.getElementById('vaStats').innerHTML = stats.map(s =>
    `<div class="va-stat">
       <span class="va-stat-val ${s.cls}">${s.val}</span>
       <span class="va-stat-lbl">${s.lbl}</span>
     </div>`
  ).join('')
}

// ── Groups ─────────────────────────────────────────────────────────────────────
function renderGroups() {
  const container = document.getElementById('vagaGroups')

  if (!_data.length) {
    container.innerHTML = `
      <div class="va-empty">
        <div class="va-empty-icon">&#128203;</div>
        <div style="font-weight:700;margin-bottom:6px">Nenhuma vaga em andamento</div>
        <p>Faça a triagem de candidatos e clique em <b>Avançar para Comunicação</b> para ver o pipeline aqui.</p>
      </div>`
    return
  }

  container.innerHTML = ''
  _data.forEach((vaga, vi) => {
    const pct = vaga.total > 0 ? Math.round((vaga.confirmados / vaga.total) * 100) : 0
    const sec = document.createElement('div')
    sec.className = 'vaga-section' + (vi === 0 ? ' open' : '')
    sec.innerHTML = `
      <div class="vs-header" onclick="toggleSection(this)">
        <div style="flex:1">
          <div class="vs-titulo">&#127919; ${esc(vaga.titulo)}</div>
        </div>
        <div class="vs-pills">
          ${vaga.total       ? `<span class="vs-pill total">${vaga.total} candidato(s)</span>` : ''}
          ${vaga.confirmados ? `<span class="vs-pill conf">&#10003; ${vaga.confirmados} confirmado(s)</span>` : ''}
          ${vaga.aguardando > 0 ? `<span class="vs-pill aguard">&#9679; ${vaga.aguardando} aguardando</span>` : ''}
          ${vaga.tem_triagem ? `<span class="vs-pill triagem">&#127919; Triagem feita</span>` : ''}
        </div>
        <span class="vs-chevron">&#9660;</span>
      </div>
      <div class="vs-progress"><div class="vs-prog-fill" style="width:${pct}%"></div></div>
      <div class="vs-body">
        ${buildTable(vaga)}
      </div>`
    container.appendChild(sec)
  })
}

function buildTable(vaga) {
  if (!vaga.candidatos.length) {
    return `<div class="vs-no-cands">
      &#127919; Triagem realizada em ${fmt(vaga.ultima_triagem)} — nenhum candidato avançado para contato ainda.
      <a href="triagem.html" style="color:var(--purple-d);margin-left:8px">Ir para Triagem</a>
    </div>`
  }

  const rows = vaga.candidatos.map((c, idx) => {
    const statusClass = statusCls(c.status)
    const recNorm     = normRec(c.ai_recomendacao)
    const scoreCol    = scoreColor(c.ai_score_total)

    return `<tr>
      <td class="td-nome">${idx + 1}. ${esc(c.name)}</td>
      <td class="td-score td-center" style="color:${scoreCol}">
        ${c.ai_score_total > 0 ? c.ai_score_total : '—'}
      </td>
      <td class="td-center">
        ${c.ai_recomendacao
          ? `<span class="rec-sm ${recNorm}">${esc(c.ai_recomendacao)}</span>`
          : '<span style="color:var(--text3);font-size:.75rem">—</span>'}
      </td>
      <td><span class="st-badge ${statusClass}">${esc(c.status || 'Pendente')}</span></td>
      <td class="td-center">${c.contacted_at
        ? `<span class="ind-sim" title="${fmt(c.contacted_at)}">&#10003; ${fmt(c.contacted_at)}</span>`
        : '<span class="ind-nao">—</span>'}</td>
      <td class="td-center">${c.respondeu
        ? `<span class="ind-sim" title="${esc(c.ultima_resposta||'')}">&#10003; ${fmt(c.ultima_resposta_at)}</span>`
        : '<span class="ind-nao">Não</span>'}</td>
      <td class="td-center">${c.aceitou
        ? '<span class="ind-sim">&#9733; Sim</span>'
        : (c.status === 'Recusado'
          ? '<span style="color:var(--red);font-size:.75rem">Recusou</span>'
          : '<span class="ind-nao">—</span>')}</td>
      <td style="font-size:.72rem;color:var(--text3);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
          title="${esc(c.ultima_resposta||'')}">
        ${c.ultima_resposta ? esc(c.ultima_resposta.slice(0, 60)) : '—'}
      </td>
    </tr>`
  }).join('')

  return `<div class="va-table-wrap">
    <table class="va-table">
      <thead>
        <tr>
          <th>Candidato</th>
          <th style="text-align:center">Score AI</th>
          <th style="text-align:center">Recomendação IA</th>
          <th>Status</th>
          <th style="text-align:center">Contactado</th>
          <th style="text-align:center">Respondeu</th>
          <th style="text-align:center">Aceitou</th>
          <th>Última Resposta</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
}

function toggleSection(header) {
  header.closest('.vaga-section').classList.toggle('open')
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function scoreColor(s) {
  if (!s) return 'var(--text3)'
  return s >= 66 ? 'var(--green)' : s >= 41 ? 'var(--amber)' : 'var(--red)'
}

function normRec(r) {
  const n = (r || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  if (n.includes('avan'))  return 'avancar'
  if (n.includes('aguar')) return 'aguardar'
  return 'dispensar'
}

function statusCls(s) {
  const n = (s || '').toLowerCase()
  if (n.includes('confirm'))   return 'st-confirmado'
  if (n.includes('contato') || n.includes('enviado') || n.includes('resposta manual')) return 'st-contato'
  if (n.includes('aprovado') || n.includes('triagem')) return 'st-aprovado'
  if (n.includes('recusado'))  return 'st-recusado'
  return 'st-pendente'
}

function fmt(dt) {
  if (!dt) return '—'
  const d = new Date(dt)
  if (isNaN(d)) return dt
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
    ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

let _tt
function showToast(msg, err) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.className = err ? 'err show' : 'show'
  clearTimeout(_tt)
  _tt = setTimeout(() => t.className = '', 3000)
}

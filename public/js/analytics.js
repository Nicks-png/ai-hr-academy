'use strict'

if (!requireAuth()) throw new Error('not auth')

const _user = getUser()
if (!['admin', 'rh'].includes(_user.role)) {
  window.location.href = 'intranet.html'
  throw new Error('sem permissão')
}

const headers = { Authorization: `Bearer ${getToken()}` }

;(async () => {
  const [funil, vagas, tempo] = await Promise.all([
    fetch('/api/analytics/funil', { headers }).then(r => r.json()).catch(() => null),
    fetch('/api/analytics/vagas', { headers }).then(r => r.json()).catch(() => null),
    fetch('/api/analytics/tempo', { headers }).then(r => r.json()).catch(() => null),
  ])

  if (funil) {
    renderKpis(funil.kpis)
    renderFunil(funil.stages)
  }
  if (vagas) renderVagas(vagas)
  if (tempo) renderTempo(tempo)
})()

// ── KPI Cards ─────────────────────────────────────────────────────────────────
function renderKpis(k) {
  const taxa  = k.taxa_confirmacao
  const taxaColor = taxa >= 50 ? 'green' : taxa >= 25 ? 'amber' : 'purple'

  document.getElementById('anKpis').innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Total no processo</div>
      <div class="kpi-value purple">${k.total}</div>
      <div class="kpi-sub">candidatos ativos</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Confirmados</div>
      <div class="kpi-value green">${k.confirmados}</div>
      <div class="kpi-sub">${k.taxa_confirmacao}% de confirmação</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Score médio IA</div>
      <div class="kpi-value cyan">${k.score_medio ?? '—'}</div>
      <div class="kpi-sub">de 100 pontos</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Vagas com candidatos</div>
      <div class="kpi-value amber">${k.vagas_ativas}</div>
      <div class="kpi-sub">vagas no funil</div>
    </div>`
}

// ── Funil ─────────────────────────────────────────────────────────────────────
const FUNIL_CLASS = {
  'Aprovado na Triagem': 'aprovado',
  'Triado':              'triado',
  'Contato enviado':     'contato',
  'Confirmado':          'confirmado',
  'Recusado':            'recusado',
  'Resposta manual':     'manual',
  'Intervenção Humana':  'intervencao',
  'Pendente':            'pendente',
}

function renderFunil(stages) {
  const wrap = document.getElementById('anFunil')
  if (!stages?.length) { wrap.innerHTML = '<div class="an-empty">Nenhum candidato no funil ainda.</div>'; return }
  const max = Math.max(...stages.map(s => s.count))
  wrap.innerHTML = stages.map(s => {
    const w   = max ? Math.round(s.count / max * 100) : 0
    const cls = FUNIL_CLASS[s.status] || 'pendente'
    return `<div class="funil-row">
      <div class="funil-label">${esc(s.status)}</div>
      <div class="funil-bar-track">
        <div class="funil-bar-fill ${cls}" style="width:${w}%"></div>
      </div>
      <div class="funil-count">${s.count}</div>
      <div class="funil-pct-num">${s.pct}%</div>
    </div>`
  }).join('')
}

// ── Vagas ─────────────────────────────────────────────────────────────────────
function renderVagas(vagas) {
  const el = document.getElementById('anVagas')
  if (!vagas?.length) { el.innerHTML = '<div class="an-empty">Nenhuma vaga com candidatos ainda.</div>'; return }

  const rows = vagas.map(v => {
    const taxa    = v.taxa_confirmacao
    const score   = v.score_medio
    const sClass  = score >= 66 ? 'green' : score >= 41 ? 'amber' : 'red'
    return `<tr>
      <td><div class="an-vaga-nome">${esc(v.titulo || v.job_id)}</div></td>
      <td style="text-align:center">${v.total}</td>
      <td>
        <div class="an-mini-bar-track"><div class="an-mini-bar-fill" style="width:${taxa}%"></div></div>
        <span style="font-size:.75rem;font-weight:700">${taxa}%</span>
      </td>
      <td>${score ? `<span class="badge-score ${sClass}">${score}</span>` : '—'}</td>
    </tr>`
  }).join('')

  el.innerHTML = `<table class="an-table">
    <thead><tr>
      <th>Vaga</th>
      <th style="text-align:center">Cands.</th>
      <th>Confirmação</th>
      <th style="text-align:right">Score IA</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

// ── Fontes + Time-to-hire ──────────────────────────────────────────────────────
function renderTempo({ fontes, tth, media_geral }) {
  // Fontes
  const fontesEl = document.getElementById('anFontes')
  if (!fontes?.length) {
    fontesEl.innerHTML = '<div class="an-empty">Sem dados de fonte.</div>'
  } else {
    fontesEl.innerHTML = `<div class="an-fontes-list">${fontes.map(f => {
      const cls = f.fonte === 'Triagem IA' ? 'ia' : 'org'
      return `<div class="fonte-item">
        <div class="fonte-header">
          <span class="fonte-nome">${esc(f.fonte)}</span>
          <span class="fonte-meta">${f.count} candidato${f.count !== 1 ? 's' : ''} · ${f.pct}%</span>
        </div>
        <div class="fonte-bar-track">
          <div class="fonte-bar-fill ${cls}" style="width:${f.pct}%"></div>
        </div>
      </div>`
    }).join('')}</div>`
  }

  // Time-to-hire
  if (!tth?.length) return
  document.getElementById('anTempoSection').style.display = ''
  const maxDias = Math.max(...tth.map(r => r.media_dias))
  document.getElementById('anTempo').innerHTML = `
    ${media_geral != null ? `<div class="tth-media-geral">Média geral: <strong>${media_geral} dias</strong></div>` : ''}
    <div class="tth-list">${tth.map(r => {
      const w   = maxDias ? Math.round(r.media_dias / maxDias * 100) : 0
      const cls = r.media_dias <= 7 ? 'fast' : r.media_dias <= 14 ? 'medium' : 'slow'
      return `<div class="tth-row">
        <div class="tth-label">${esc(r.titulo || r.job_id)}</div>
        <div class="tth-bar-track"><div class="tth-bar-fill ${cls}" style="width:${w}%"></div></div>
        <div class="tth-dias">${r.media_dias}d</div>
      </div>`
    }).join('')}</div>`
}

// ── Utils ─────────────────────────────────────────────────────────────────────
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

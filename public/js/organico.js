'use strict'

// ── State ─────────────────────────────────────────────────────────────────────
let allCandidates  = []   // todos os orgânicos carregados
let vagasMap       = {}   // { vagaId: { titulo, candidatos[] } }
let activeVagaId   = null
let currentCvPdf   = null // base64 do PDF atual no modal
let triagemCandId  = null // id do candidato sendo triado

// ── Init ──────────────────────────────────────────────────────────────────────
;(async () => {
  if (!requireAuth('triagem')) return
  await loadAll()
  loadStats()
})()

// ── Stats (auditoria de candidaturas) ─────────────────────────────────────────
let falhasRecentes = []

async function loadStats() {
  try {
    const s = await fetch('/api/organico/stats', { headers: authHeaders() }).then(r => r.json())
    if (!s || s.error) return

    document.getElementById('statHoje').textContent   = s.hoje.sucesso
    document.getElementById('statSemana').textContent = s.semana.sucesso
    document.getElementById('orgStatsBar').style.display = 'flex'

    falhasRecentes = s.falhasRecentes || []
    const falhasEl = document.getElementById('statFalhas')
    if (falhasRecentes.length) {
      document.getElementById('statFalhasNum').textContent = falhasRecentes.length
      falhasEl.style.display = ''
    } else {
      falhasEl.style.display = 'none'
    }
  } catch (err) {
    console.error('[organico] Erro ao carregar stats:', err)
  }
}

const FALHA_LABELS = {
  vaga_invalida_ou_inativa:   'Vaga inválida ou inativa',
  vaga_pausada:                'Vaga pausada',
  nome_ausente:                'Nome não informado',
  telefone_invalido:           'Telefone inválido',
  curriculo_ausente:           'Currículo não enviado',
  duplicado_phone_vaga:        'Já candidatado (mesmo telefone+vaga)',
  duplicado_unique_constraint: 'Já candidatado (mesmo telefone+vaga)',
  rate_limited:                'Bloqueado por limite de tentativas',
}

function openFalhasModal() {
  const body = document.getElementById('falhasBody')
  if (!falhasRecentes.length) {
    body.innerHTML = '<div class="falhas-empty">Nenhuma falha registrada nos últimos 7 dias.</div>'
  } else {
    body.innerHTML = `
      <table class="falhas-table">
        <thead>
          <tr><th>Quando</th><th>Nome</th><th>Telefone</th><th>Vaga</th><th>Motivo</th></tr>
        </thead>
        <tbody>
          ${falhasRecentes.map(f => `
            <tr>
              <td class="td-date">${esc(f.created_at || '')}</td>
              <td>${esc(f.nome || '—')}</td>
              <td>${esc(f.phone || '—')}</td>
              <td>${esc(f.vaga_id || '—')}</td>
              <td>${esc(FALHA_LABELS[f.error_msg] || f.error_msg || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  }
  document.getElementById('falhasModal').classList.remove('hidden')
}

function closeFalhasModal() {
  document.getElementById('falhasModal').classList.add('hidden')
}

// ── Load all organic candidates ───────────────────────────────────────────────
async function loadAll() {
  try {
    const data = await fetch('/api/organico', { headers: authHeaders() }).then(r => r.json())
    if (!Array.isArray(data)) return
    allCandidates = data

    // Agrupar por job_id
    vagasMap = {}
    for (const c of data) {
      const key = c.job_id || '__sem_vaga'
      if (!vagasMap[key]) vagasMap[key] = { titulo: c.job_position || c.job_id || 'Sem vaga', candidatos: [] }
      vagasMap[key].candidatos.push(c)
    }

    renderVagasSidebar()

    // Selecionar primeira vaga automaticamente
    const firstKey = Object.keys(vagasMap)[0]
    if (firstKey) selectVaga(firstKey)
  } catch (err) {
    console.error('[organico] Erro ao carregar:', err)
  }
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function renderVagasSidebar() {
  const el = document.getElementById('vagasList')
  if (!Object.keys(vagasMap).length) {
    el.innerHTML = '<div style="font-size:.78rem;color:var(--text3);padding:8px 12px">Sem candidaturas orgânicas ainda.</div>'
    return
  }
  el.innerHTML = Object.entries(vagasMap).map(([id, v]) => `
    <button class="org-vaga-btn" id="vagaBtn-${esc(id)}" onclick="selectVaga('${esc(id)}')">
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.titulo)}</span>
      <span class="badge">${v.candidatos.length}</span>
    </button>
  `).join('')
}

// ── Select vaga ───────────────────────────────────────────────────────────────
function selectVaga(vagaId) {
  activeVagaId = vagaId
  const vaga = vagasMap[vagaId]
  if (!vaga) return

  // Sidebar highlight
  document.querySelectorAll('.org-vaga-btn').forEach(b => b.classList.remove('active'))
  document.getElementById(`vagaBtn-${vagaId}`)?.classList.add('active')

  // Subtitle
  document.getElementById('orgSubtitle').textContent = `${vaga.candidatos.length} candidatura(s) para ${vaga.titulo}`

  // QR code
  renderQrCode(vagaId, vaga.titulo)

  // Table
  renderTable(vaga.candidatos)

  // Hide empty state
  document.getElementById('orgEmpty').style.display    = 'none'
  document.getElementById('qrCard').style.display      = 'flex'
  document.getElementById('tableSection').style.display = 'block'
}

// ── QR Code ───────────────────────────────────────────────────────────────────
function renderQrCode(vagaId, titulo) {
  const url = `${window.location.origin}/candidato.html?vaga=${encodeURIComponent(vagaId)}`
  document.getElementById('qrLink').textContent = url
  document.getElementById('qrVagaTitulo').textContent = titulo
  document.getElementById('qrPortalLink').href = url

  const canvas = document.getElementById('qrCanvas')

  try {
    const qr = qrcode(0, 'M')
    qr.addData(url)
    qr.make()
    const size = 180
    const modules = qr.getModuleCount()
    const cellSize = Math.floor(size / modules)
    const margin = 4

    canvas.width  = modules * cellSize + margin * 2
    canvas.height = modules * cellSize + margin * 2
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#000000'
    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) {
        if (qr.isDark(row, col)) {
          ctx.fillRect(
            margin + col * cellSize,
            margin + row * cellSize,
            cellSize, cellSize
          )
        }
      }
    }
  } catch (e) {
    canvas.width = 180; canvas.height = 180
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 180, 180)
    ctx.fillStyle = '#7c3aed'
    ctx.font = '12px Inter, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('QR indisponível', 90, 90)
  }
}

function copyQrLink() {
  const url = document.getElementById('qrLink').textContent
  navigator.clipboard.writeText(url).then(() => showToast('Link copiado!')).catch(() => showToast('Erro ao copiar.'))
}

function downloadQr() {
  const canvas = document.getElementById('qrCanvas')
  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = `qr-${activeVagaId || 'vaga'}.png`
  a.click()
}

// ── Candidate table ───────────────────────────────────────────────────────────
function renderTable(candidatos) {
  const title = document.getElementById('tableTitle')
  const tbody = document.getElementById('candTableBody')

  title.textContent = `${candidatos.length} candidato(s)`

  if (!candidatos.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text3)">Nenhum candidato para esta vaga.</td></tr>`
    return
  }

  const hasTriando = candidatos.some(c => c.status === 'Triando')
  scheduleAutoRefresh(hasTriando)

  tbody.innerHTML = candidatos.map(c => {
    const score      = c.ai_score_total
    const triando    = c.status === 'Triando'
    const concluido  = c.status === 'Triagem Concluída'
    const falhou     = !concluido && !score && c.status === 'Pendente'
    const scoreHtml  = concluido
      ? `<span class="td-score ${score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low'}">${score}/100</span>`
      : triando
        ? `<span class="td-score none" style="color:#a78bfa">⏳ Triando...</span>`
        : falhou
          ? `<span class="td-score none" style="color:#f43f5e">Falhou</span>`
          : `<span class="td-score none">—</span>`

    const statusCls = statusClass(c.status)
    const dateStr   = c.created_at ? new Date(c.created_at).toLocaleDateString('pt-BR') : '—'
    const retriarBtn = falhou
      ? `<button class="btn btn-ghost btn-sm" onclick="retriar(${c.id})" style="color:#a78bfa">Retriar</button>`
      : ''

    return `
      <tr id="cand-row-${c.id}">
        <td class="td-name">${esc(c.name)}</td>
        <td class="td-date">${dateStr}</td>
        <td><span class="status-chip ${statusCls}">${esc(c.status || 'Pendente')}</span></td>
        <td>${scoreHtml}</td>
        <td class="td-actions">
          <button class="btn btn-ghost btn-sm" onclick="openCvModal(${c.id}, '${esc(c.name)}')">Ver detalhes</button>
          ${retriarBtn}
          <button class="btn btn-ghost btn-sm" onclick="avancarStatus(${c.id})" style="color:#10b981">Avançar</button>
        </td>
      </tr>
    `
  }).join('')
}

function statusClass(status) {
  const s = (status || '').toLowerCase()
  if (s.includes('triado') || s.includes('aprovado')) return 'triado'
  if (s.includes('contato')) return 'contato'
  if (s.includes('confirmado')) return 'triado'
  if (s.includes('recusado')) return 'recusado'
  return 'pendente'
}

// ── Avançar status ────────────────────────────────────────────────────────────
const NEXT_STATUS = {
  'Triagem Concluída':   'Aprovado na Triagem',
  'Pendente':            'Aprovado na Triagem',
  'Aprovado na Triagem': 'Contato enviado',
  'Triado':              'Contato enviado',
  'Contato enviado':     'Confirmado',
}

async function avancarStatus(id) {
  try {
    const c = allCandidates.find(x => x.id === id)
    const nextStatus = NEXT_STATUS[c?.status] || 'Aprovado na Triagem'
    const r = await fetch(`/api/selecao/promote/${id}`, {
      method:  'POST',
      headers: authHeaders(),
      body:    JSON.stringify({ nextStatus }),
    })
    const d = await r.json()
    if (d.ok || d.status) {
      await refreshVaga()
      showToast('Status atualizado.')
    } else {
      showToast(d.error || 'Não foi possível avançar.')
    }
  } catch { showToast('Erro de conexão.') }
}

async function refreshVaga() {
  if (!activeVagaId) return
  const data = await fetch('/api/organico', { headers: authHeaders() }).then(r => r.json())
  allCandidates = data
  vagasMap = {}
  for (const c of data) {
    const key = c.job_id || '__sem_vaga'
    if (!vagasMap[key]) vagasMap[key] = { titulo: c.job_position || c.job_id, candidatos: [] }
    vagasMap[key].candidatos.push(c)
  }
  renderVagasSidebar()
  const vaga = vagasMap[activeVagaId]
  if (vaga) renderTable(vaga.candidatos)
  document.getElementById(`vagaBtn-${activeVagaId}`)?.classList.add('active')
}

// ── Detalhes do candidato ─────────────────────────────────────────────────────
const DIM_LABELS = { aderencia: 'Aderência à vaga', tecnico: 'Técnico', estabilidade: 'Estabilidade', experiencia: 'Experiência', qualificacao: 'Qualificação' }
const DIM_ORDER  = ['aderencia', 'tecnico', 'estabilidade', 'experiencia', 'qualificacao']

async function openCvModal(id, name) {
  currentCvPdf = null
  document.getElementById('cvModalTitle').textContent = `Detalhes — ${name}`
  document.getElementById('candDetailBody').innerHTML = '<p style="color:var(--text3);font-size:.85rem">Carregando...</p>'
  document.getElementById('cvModal').classList.remove('hidden')

  try {
    const d = await fetch(`/api/organico/${id}/detalhes`, { headers: authHeaders() }).then(r => r.json())
    if (d.error) throw new Error(d.error)
    renderDetalhes(d)
  } catch {
    document.getElementById('candDetailBody').innerHTML = '<p style="color:var(--red)">Erro ao carregar detalhes do candidato.</p>'
  }
}

function renderDetalhes(d) {
  currentCvPdf = d.cv_pdf || null

  const dims = d.ai_dimensoes || {}
  const dimHtml = DIM_ORDER.filter(k => dims[k]).map(k => {
    const s = dims[k].score ?? 0
    const color = s >= 7 ? 'var(--green)' : s >= 4 ? 'var(--amber)' : 'var(--red)'
    return `
      <div class="dim-card">
        <div class="dim-head"><span>${esc(DIM_LABELS[k] || k)}</span><span style="color:${color};font-weight:800">${s}/10</span></div>
        <div class="dim-bar-wrap"><div class="dim-bar" style="width:${s * 10}%;background:${color}"></div></div>
        ${dims[k].justificativa ? `<div class="dim-just">${esc(dims[k].justificativa)}</div>` : ''}
      </div>`
  }).join('')

  const fortes  = Array.isArray(d.ai_pontos_fortes)  ? d.ai_pontos_fortes  : []
  const atencao = Array.isArray(d.ai_pontos_atencao) ? d.ai_pontos_atencao : []
  const answers = (Array.isArray(d.answers) ? d.answers : []).filter(a => a?.resposta)

  const emAndamento = d.status === 'Triando'
  const hasScore = !emAndamento && d.ai_score_total !== null && d.ai_score_total !== undefined
  const scoreColor = !hasScore ? 'var(--text3)' : d.ai_score_total >= 70 ? 'var(--green)' : d.ai_score_total >= 45 ? 'var(--amber)' : 'var(--red)'

  document.getElementById('candDetailBody').innerHTML = `
    <div class="detail-header">
      <div>
        <div class="detail-name">${esc(d.name)}</div>
        <div class="detail-sub">${esc(d.job_position || '')} · ${esc(d.phone || 'sem telefone')}${d.email ? ' · ' + esc(d.email) : ''}</div>
      </div>
      <div class="detail-score" style="color:${scoreColor}">${hasScore ? d.ai_score_total : '⏳'}<span>${hasScore ? '/100' : ''}</span></div>
    </div>

    ${d.ai_recomendacao ? `<div class="detail-rec">Recomendação da IA: <strong>${esc(d.ai_recomendacao)}</strong></div>` : ''}
    ${d.ai_resumo ? `<p class="detail-resumo">${esc(d.ai_resumo)}</p>` : ''}

    ${dimHtml ? `<div class="dim-grid">${dimHtml}</div>` : ''}

    ${fortes.length ? `<div class="detail-block"><h4>Pontos fortes</h4><ul>${fortes.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
    ${atencao.length ? `<div class="detail-block"><h4>Pontos de atenção</h4><ul>${atencao.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}

    ${answers.length ? `<div class="detail-block"><h4>Respostas da inscrição</h4>${answers.map(a => `
      <div class="qa-item"><div class="qa-q">${esc(a.pergunta)}</div><div class="qa-a">${esc(a.resposta)}</div></div>`).join('')}</div>` : ''}

    <div class="detail-block">
      <h4>Currículo</h4>
      <div class="cv-text-area">${esc(d.cv_text || '(sem texto de currículo)')}</div>
      ${currentCvPdf ? `
        <button class="btn btn-primary btn-sm" onclick="openOriginalPdf()">👁 Abrir PDF original</button>
        <button class="btn btn-ghost btn-sm" onclick="downloadPdf()">⬇ Baixar PDF</button>
      ` : ''}
    </div>
  `
}

function closeCvModal() {
  document.getElementById('cvModal').classList.add('hidden')
  currentCvPdf = null
}

function pdfBlobUrl() {
  const bytes = atob(currentCvPdf)
  const arr   = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }))
}

function openOriginalPdf() {
  if (!currentCvPdf) return
  const url = pdfBlobUrl()
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 15000)
}

function downloadPdf() {
  if (!currentCvPdf) return
  const url  = pdfBlobUrl()
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'curriculo.pdf'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// ── Triagem Modal ─────────────────────────────────────────────────────────────
function openTriagemModal(id, name, jobId) {
  triagemCandId = id

  document.getElementById('triagemModalTitle').textContent  = `Triagem IA — ${name}`
  document.getElementById('triagemProgressLabel').textContent = 'Iniciando...'
  document.getElementById('triagemBar').style.width          = '0%'
  document.getElementById('triagemLog').innerHTML            = ''
  document.getElementById('triagemResultArea').innerHTML     = ''
  document.getElementById('triagemActions').style.display   = 'none'
  document.getElementById('triagemModal').classList.remove('hidden')

  // Buscar cv_text do candidato local (já carregado)
  const c = allCandidates.find(x => x.id === id)
  if (!c) {
    appendLog('[erro] Candidato não encontrado.')
    return
  }
  if (!c.cv_text && !c.cv_preview) {
    appendLog('[erro] Este candidato não tem texto de currículo armazenado.')
    document.getElementById('triagemActions').style.display = 'block'
    return
  }

  // Precisamos do cv_text completo — buscar via API
  fetch(`/api/organico/${id}/cv`, { headers: authHeaders() })
    .then(r => r.json())
    .then(d => runTriagem(d.cv_text || '', name, jobId, id))
    .catch(() => appendLog('[erro] Falha ao carregar currículo.'))
}

function appendLog(msg) {
  const el = document.getElementById('triagemLog')
  el.innerHTML += `<div>${esc(msg)}</div>`
  el.scrollTop = el.scrollHeight
}

async function runTriagem(cvText, name, jobId, dbId) {
  if (!cvText.trim()) {
    appendLog('[erro] Currículo vazio.')
    document.getElementById('triagemActions').style.display = 'block'
    return
  }

  appendLog(`[inicio] Enviando para triagem IA...`)
  document.getElementById('triagemProgressLabel').textContent = `Analisando ${name}...`
  document.getElementById('triagemBar').style.width = '30%'

  try {
    const resp = await fetch('/api/screen', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        vagaId:     jobId,
        candidatos: [{ id: 1, nome: name, curriculo: cvText, dbId }],
      }),
    })

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      appendLog(`[erro] ${err.error || resp.statusText}`)
      document.getElementById('triagemActions').style.display = 'block'
      return
    }

    // ── SSE parser ────────────────────────────────────────────────────────────
    const reader  = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf       = ''
    let evName    = null
    let resultado = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop()

      for (const line of lines) {
        if (line.startsWith('event: ')) { evName = line.slice(7).trim(); continue }
        if (line.startsWith('data: ')  && evName) {
          try {
            const payload = JSON.parse(line.slice(6))
            handleSSEEvent(evName, payload)
            if (evName === 'candidato') resultado = payload.resultado
          } catch (_) {}
          evName = null
        }
      }
    }

    document.getElementById('triagemBar').style.width = '100%'
    document.getElementById('triagemProgressLabel').textContent = 'Concluído!'

    // Persistir resultado no candidato existente
    if (resultado) {
      await persistTriagem(jobId, resultado, dbId)
      await refreshVaga()
    }

    document.getElementById('triagemActions').style.display = 'block'
  } catch (err) {
    appendLog(`[erro] ${err.message}`)
    document.getElementById('triagemActions').style.display = 'block'
  }
}

function handleSSEEvent(ev, payload) {
  switch (ev) {
    case 'start':
      appendLog(`[inicio] Vaga: ${payload.vaga} · 1 candidato`)
      document.getElementById('triagemBar').style.width = '40%'
      break
    case 'progress':
      appendLog(`[...] ${payload.message || payload.nome || ''}`)
      document.getElementById('triagemBar').style.width = '70%'
      break
    case 'candidato': {
      document.getElementById('triagemBar').style.width = '90%'
      const r = payload.resultado || {}
      const dims = r.dimensoes || {}
      const dimStr = Object.entries(dims)
        .map(([k, v]) => `${k}: ${v?.score ?? '?'}/10`)
        .join(' · ')
      appendLog(`[resultado] Score: ${r.scoreTotal ?? '?'} · ${r.recomendacao || ''}`)
      document.getElementById('triagemResultArea').innerHTML = `
        <div class="triagem-result-card">
          <h4>${esc(r.nome || '')} — Score: ${r.scoreTotal ?? '?'}/100</h4>
          <div class="score-row">
            <div class="score-item"><strong>Recomendação:</strong> ${esc(r.recomendacao || '—')}</div>
            <div class="score-item"><strong>Inglês:</strong> ${esc(r.nivel_ingles || '—')}</div>
          </div>
          <div class="score-row" style="font-size:.72rem;color:var(--text3)">
            ${esc(dimStr)}
          </div>
          <div class="resumo" style="margin-top:8px">${esc(r.resumo || '')}</div>
        </div>
      `
      break
    }
    case 'done':
      appendLog('[fim] Triagem concluída.')
      break
    default:
      break
  }
}

async function persistTriagem(vagaId, resultado, dbId) {
  try {
    await fetch('/api/selecao/from-triagem', {
      method:  'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        vagaId,
        candidatos: [{
          nome:         resultado.nome,
          telefone:     resultado.telefone || null,
          scoreTotal:   resultado.scoreTotal,
          recomendacao: resultado.recomendacao,
          resumo:       resultado.resumo,
          pontosFort:   resultado.pontosFort,
          pontosAtencao:resultado.pontosAtencao,
          dimensoes:    resultado.dimensoes,
          dbId,
        }],
      }),
    })
  } catch (err) {
    appendLog(`[aviso] Não foi possível salvar resultado: ${err.message}`)
  }
}

function closeTriagemModal() {
  document.getElementById('triagemModal').classList.add('hidden')
  triagemCandId = null
}

// ── Export XLSX ───────────────────────────────────────────────────────────────
async function exportXlsx() {
  if (!activeVagaId) return showToast('Selecione uma vaga primeiro.')
  try {
    const resp = await fetch('/api/organico/export', {
      method:  'POST',
      headers: authHeaders(),
      body:    JSON.stringify({ vagaId: activeVagaId }),
    })
    if (!resp.ok) {
      const d = await resp.json().catch(() => ({}))
      return showToast(d.error || 'Erro ao exportar.')
    }
    const blob = await resp.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `organico-${activeVagaId}-${new Date().toISOString().slice(0,10)}.xlsx`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  } catch { showToast('Erro de conexão ao exportar.') }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg) {
  let t = document.getElementById('orgToast')
  if (!t) {
    t = document.createElement('div')
    t.id = 'orgToast'
    t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
      background:#1e1e3f;border:1px solid var(--glass-b);border-radius:12px;
      padding:10px 20px;font-size:.82rem;color:var(--text);z-index:9999;
      box-shadow:0 8px 24px rgba(0,0,0,.4);transition:opacity .3s`
    document.body.appendChild(t)
  }
  t.textContent = msg
  t.style.opacity = '1'
  clearTimeout(t._timer)
  t._timer = setTimeout(() => { t.style.opacity = '0' }, 2800)
}

// ── Retriar candidato que falhou ──────────────────────────────────────────────
async function retriar(id) {
  try {
    const r = await fetch(`/api/organico/${id}/retriar`, { method: 'POST', headers: authHeaders() })
    const d = await r.json()
    if (d.ok) {
      showToast('Triagem reiniciada.')
      await refreshVaga()
    } else {
      showToast(d.error || 'Erro ao retriar.')
    }
  } catch { showToast('Erro de conexão.') }
}

// ── Auto-refresh enquanto há candidatos em triagem ────────────────────────────
let _refreshTimer = null

function scheduleAutoRefresh(hasPending) {
  clearTimeout(_refreshTimer)
  if (!hasPending) return
  _refreshTimer = setTimeout(async () => {
    await refreshVaga()
  }, 15000) // verifica a cada 15s
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return (s || '').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

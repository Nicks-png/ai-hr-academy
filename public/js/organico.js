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
})()

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

  tbody.innerHTML = candidatos.map(c => {
    const score     = c.ai_score_total
    const scoreHtml = score > 0
      ? `<span class="td-score ${score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low'}">${score}/100</span>`
      : `<span class="td-score none">Não triado</span>`

    const statusCls = statusClass(c.status)
    const dateStr   = c.created_at ? new Date(c.created_at).toLocaleDateString('pt-BR') : '—'

    return `
      <tr id="cand-row-${c.id}">
        <td class="td-name">${esc(c.name)}</td>
        <td class="td-date">${dateStr}</td>
        <td><span class="status-chip ${statusCls}">${esc(c.status || 'Pendente')}</span></td>
        <td>${scoreHtml}</td>
        <td class="td-actions">
          <button class="btn btn-ghost btn-sm" onclick="openCvModal(${c.id}, '${esc(c.name)}')">Ver CV</button>
          <button class="btn btn-primary btn-sm" onclick="openTriagemModal(${c.id}, '${esc(c.name)}', '${esc(c.job_id)}')">Triar</button>
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
async function avancarStatus(id) {
  try {
    const r = await fetch(`/api/selecao/promote/${id}`, {
      method: 'POST', headers: authHeaders()
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

// ── CV Modal ──────────────────────────────────────────────────────────────────
async function openCvModal(id, name) {
  currentCvPdf = null
  document.getElementById('cvModalTitle').textContent = `CV — ${name}`
  document.getElementById('cvTextContent').textContent = 'Carregando...'
  document.getElementById('cvPdfActions').style.display = 'none'
  document.getElementById('cvModal').classList.remove('hidden')

  try {
    const d = await fetch(`/api/organico/${id}/cv`, { headers: authHeaders() }).then(r => r.json())
    document.getElementById('cvTextContent').textContent = d.cv_text || '(sem texto de currículo)'
    if (d.cv_pdf) {
      currentCvPdf = d.cv_pdf
      document.getElementById('cvPdfActions').style.display = 'block'
    }
  } catch {
    document.getElementById('cvTextContent').textContent = 'Erro ao carregar currículo.'
  }
}

function closeCvModal() {
  document.getElementById('cvModal').classList.add('hidden')
  currentCvPdf = null
}

function downloadPdf() {
  if (!currentCvPdf) return
  const bytes  = atob(currentCvPdf)
  const arr    = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  const blob   = new Blob([arr], { type: 'application/pdf' })
  const url    = URL.createObjectURL(blob)
  const a      = document.createElement('a')
  a.href       = url
  a.download   = 'curriculo.pdf'
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return (s || '').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

'use strict'

if (typeof requireAuth === 'function' && !requireAuth()) throw new Error('not auth')

let triagemData = null
let ultimoPayload = null

;(async () => {
  checkStatus()
  carregarTriagens()
  document.getElementById('selTriagem').addEventListener('change', onTriagemChange)
})()

async function checkStatus() {
  try {
    const d = await fetch('/api/status').then(r => r.json())
    document.getElementById('apiDot').className = `api-dot ${d.ok ? 'ok' : 'err'}`
    document.getElementById('apiStatusTxt').textContent = d.ok ? d.model : 'API Key ausente'
  } catch {
    document.getElementById('apiStatusTxt').textContent = 'servidor offline'
  }
}

async function carregarTriagens() {
  try {
    const rows = await fetch('/api/screenings', { headers: authHeaders() }).then(r => r.json())
    const sel  = document.getElementById('selTriagem')
    rows.forEach(r => {
      const opt  = document.createElement('option')
      opt.value  = r.id
      const data = new Date(r.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
      opt.textContent = `${r.vaga_titulo} — ${r.total} candidatos (${data})`
      sel.appendChild(opt)
    })
  } catch { /* silencioso */ }
}

async function onTriagemChange() {
  const id      = document.getElementById('selTriagem').value
  const preview = document.getElementById('triagemPreview')
  const badge   = document.getElementById('triagemBadge')
  const cands   = document.getElementById('triagemCands')

  if (!id) {
    preview.style.display = 'none'
    triagemData = null
    return
  }

  try {
    const d = await fetch(`/api/screenings/${id}`, { headers: authHeaders() }).then(r => r.json())
    triagemData = d
    badge.textContent = `✅ ${d.vaga_titulo} · ${d.resultado.length} candidatos carregados`
    cands.innerHTML = d.resultado
      .sort((a, b) => (b.scoreTotal ?? 0) - (a.scoreTotal ?? 0))
      .map(c => {
        const cor = c.recomendacao === 'Avançar' ? 'var(--green)' : c.recomendacao === 'Aguardar' ? 'var(--amber)' : 'var(--red)'
        return `<span style="background:rgba(255,255,255,.05);border:1px solid var(--glass-b);border-radius:8px;padding:5px 10px;font-size:.74rem;color:var(--text2)">
          <span style="color:${cor}">●</span> ${c.nome} <span style="color:var(--text3)">${c.scoreTotal ?? '—'}</span>
        </span>`
      }).join('')
    preview.style.display = 'block'
  } catch {
    showToast('Erro ao carregar triagem.', true)
  }
}

async function gerarEmail() {
  if (!triagemData) {
    showToast('Selecione uma triagem antes de gerar.', true)
    return
  }

  const totalCvs = document.getElementById('txtTotalCvs').value.trim()
  if (!totalCvs || Number(totalCvs) < 1) {
    showToast('Informe o total de currículos recebidos.', true)
    document.getElementById('txtTotalCvs').focus()
    return
  }

  ultimoPayload = {
    triagemData,
    totalCvs,
    destinatario: document.getElementById('txtDestinatario').value.trim(),
    tom:          document.getElementById('selTom').value,
    obs:          document.getElementById('txtObs').value.trim(),
  }

  await chamarAgente(ultimoPayload, null)
}

async function ajustarEmail(instrucao) {
  if (!ultimoPayload) return
  await chamarAgente(ultimoPayload, instrucao)
}

async function chamarAgente(payload, ajuste) {
  const btn = document.getElementById('btnGerar')
  btn.classList.add('loading')
  btn.innerHTML = '<span class="spin-sm"></span> Gerando...'

  try {
    const resp = await fetch('/api/email/gerar', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ ...payload, ajuste })
    })

    const data = await resp.json()
    if (!resp.ok) throw new Error(data.error || 'Erro ao gerar e-mail.')

    document.getElementById('emailAssunto').textContent  = data.assunto
    document.getElementById('emailCorpo').textContent    = data.corpo
    document.getElementById('emailOutput').style.display = 'block'
    document.getElementById('emailOutput').scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (e) {
    showToast(e.message, true)
  } finally {
    btn.classList.remove('loading')
    btn.innerHTML = '✨ Gerar E-mail'
  }
}

function copiarEmail() {
  const assunto = document.getElementById('emailAssunto').textContent
  const corpo   = document.getElementById('emailCorpo').textContent
  navigator.clipboard.writeText(`Assunto: ${assunto}\n\n${corpo}`)
    .then(() => showToast('E-mail copiado!'))
}

function showToast(msg, err = false) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.style.background = err ? 'var(--red)' : 'var(--purple-d)'
  t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), 2800)
}

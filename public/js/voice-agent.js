'use strict'
;(function () {
  // ── Compatibilidade ──────────────────────────────────────────────────────────
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  const hasSpeech = !!SR

  // ── Estado ───────────────────────────────────────────────────────────────────
  let messages    = []   // histórico { role: 'user'|'assistant', content: string }
  let isListening = false
  let isBusy      = false
  let recognition = null

  // ── Injetar DOM ──────────────────────────────────────────────────────────────
  function buildDOM() {
    const fab = document.createElement('button')
    fab.className   = 'va-fab'
    fab.id          = 'vaFab'
    fab.title       = 'Sofia — Assistente de RH'
    fab.textContent = '🎙️'
    fab.setAttribute('aria-label', 'Abrir assistente de voz Sofia')

    const overlay = document.createElement('div')
    overlay.className = 'va-overlay'
    overlay.id        = 'vaOverlay'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-label', 'Sofia — Assistente de RH')

    overlay.innerHTML = `
      <div class="va-card" id="vaCard">
        <div class="va-header">
          <button class="va-close" id="vaClose" aria-label="Fechar">✕</button>
          <div class="va-avatar" id="vaAvatar">S</div>
          <div>
            <div class="va-name">Sofia</div>
            <div class="va-subtitle">Assistente de RH · Accor Brasil</div>
          </div>
          <div class="va-context-badge" id="vaContextBadge">📍 <span id="vaContextText"></span></div>
          <div class="va-status" id="vaStatusPill">
            <span class="va-status-dot"></span>
            <span id="vaStatusTxt">Aguardando</span>
          </div>
        </div>

        <div class="va-transcript" id="vaTranscript">
          <div class="va-empty" id="vaEmpty">
            ${hasSpeech
              ? 'Clique no microfone e fale sua dúvida sobre RH, CLT ou processos da Accor.'
              : '<strong style="color:#f59e0b">Seu navegador não suporta microfone.</strong><br>Use o campo abaixo para digitar sua pergunta.'}
          </div>
        </div>

        <div class="va-controls">
          ${!hasSpeech ? `
          <div class="va-compat-warn">
            <strong>Dica:</strong> Use Chrome ou Edge para ativar o microfone.
          </div>` : ''}
          <div class="va-text-input-row ${!hasSpeech ? 'visible' : ''}" id="vaTextRow">
            <input class="va-text-input" id="vaTextInput" type="text" placeholder="Digite sua pergunta..." autocomplete="off"/>
            <button class="va-text-send" id="vaTextSend">Enviar</button>
          </div>
          ${hasSpeech ? `
          <div class="va-mic-row">
            <button class="va-end-btn" id="vaEndBtn">Encerrar</button>
            <button class="va-mic-btn" id="vaMicBtn" aria-label="Falar">🎙️</button>
            <button class="va-end-btn" id="vaKeyboard" style="border-color:rgba(255,255,255,0.15);color:var(--text3)" aria-label="Alternar teclado">⌨️</button>
          </div>` : `
          <div class="va-mic-row">
            <button class="va-end-btn" id="vaEndBtn">Encerrar</button>
          </div>`}
        </div>
      </div>`

    document.body.appendChild(fab)
    document.body.appendChild(overlay)
  }

  // ── UI helpers ────────────────────────────────────────────────────────────────
  function setStatus(state, label) {
    const pill = document.getElementById('vaStatusPill')
    const txt  = document.getElementById('vaStatusTxt')
    if (!pill || !txt) return
    pill.className = `va-status ${state}`
    txt.textContent = label
  }

  function setAvatarState(state) {
    const av = document.getElementById('vaAvatar')
    if (!av) return
    av.className = `va-avatar${state ? ' va-' + state : ''}`
  }

  function appendMsg(role, content) {
    const tr = document.getElementById('vaTranscript')
    const empty = document.getElementById('vaEmpty')
    if (empty) empty.remove()

    const div = document.createElement('div')
    div.className = `va-msg va-msg-${role}`
    div.innerHTML = `<div class="va-msg-label">${role === 'user' ? 'Você' : 'Sofia'}</div>${escapeHtml(content)}`
    tr.appendChild(div)
    tr.scrollTop = tr.scrollHeight
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  }

  function updateContextBadge() {
    const badge = document.getElementById('vaContextBadge')
    const span  = document.getElementById('vaContextText')
    if (!badge || !span) return
    const ctx = getContext()
    let label = ''
    if (ctx.page === 'triagem' && ctx.vaga) label = `Triagem · ${ctx.vaga}`
    else if (ctx.page === 'triagem')        label = 'Triagem de Currículos'
    else if (ctx.page === 'whatsapp')       label = 'WhatsApp Recruiter'
    else if (ctx.page === 'cursos')         label = 'Catálogo de Cursos'
    else if (ctx.page === 'home')           label = 'Página Inicial'

    if (label) {
      span.textContent = label
      badge.classList.add('visible')
    } else {
      badge.classList.remove('visible')
    }
  }

  // ── Contexto de página ────────────────────────────────────────────────────────
  function getContext() {
    const page = document.body.dataset.page || 'unknown'
    return { page, ...(window.VOICE_CONTEXT || {}) }
  }

  // ── Abrir / Fechar modal ──────────────────────────────────────────────────────
  function openModal() {
    document.getElementById('vaOverlay').classList.add('va-open')
    document.getElementById('vaFab').classList.add('va-open')
    document.body.style.overflow = 'hidden'
    updateContextBadge()
    // Saudação inicial se vazio
    if (messages.length === 0) {
      const ctx = getContext()
      let greeting = 'Olá! Sou a Sofia, sua consultora de RH. Como posso ajudar?'
      if (ctx.page === 'triagem' && ctx.vaga) {
        greeting = `Olá! Vejo que está triando candidatos para ${ctx.vaga}. Posso ajudar com os critérios de avaliação ou dúvidas sobre a vaga?`
      } else if (ctx.page === 'whatsapp') {
        greeting = `Olá! Estou vendo o painel do WhatsApp Recruiter. Tem dúvidas sobre como comunicar com os candidatos ou sobre os próximos passos do processo?`
      }
      appendMsg('agent', greeting)
      messages.push({ role: 'assistant', content: greeting })
    }
  }

  function closeModal() {
    stopListening()
    window.speechSynthesis?.cancel()
    document.getElementById('vaOverlay').classList.remove('va-open')
    document.getElementById('vaFab').classList.remove('va-open')
    document.body.style.overflow = ''
    setStatus('', 'Aguardando')
    setAvatarState(null)
  }

  function endConversation() {
    stopListening()
    window.speechSynthesis?.cancel()
    messages = []
    const tr = document.getElementById('vaTranscript')
    if (tr) tr.innerHTML = `<div class="va-empty" id="vaEmpty">${hasSpeech ? 'Clique no microfone e fale sua dúvida.' : 'Digite sua pergunta abaixo.'}</div>`
    setStatus('', 'Aguardando')
    setAvatarState(null)
  }

  // ── STT — SpeechRecognition ───────────────────────────────────────────────────
  function startListening() {
    if (!hasSpeech || isBusy) return
    isListening = true
    isBusy      = true

    recognition = new SR()
    recognition.lang        = 'pt-BR'
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setStatus('listening', 'Ouvindo...')
      setAvatarState('listening')
      const btn = document.getElementById('vaMicBtn')
      if (btn) btn.classList.add('va-listening')
    }

    recognition.onresult = e => {
      const transcript = e.results[0][0].transcript.trim()
      if (!transcript) return
      handleUserInput(transcript)
    }

    recognition.onerror = e => {
      console.warn('[Sofia] STT erro:', e.error)
      if (e.error === 'not-allowed') {
        appendMsg('agent', 'Precisei de permissão para usar o microfone. Por favor, autorize nas configurações do navegador e tente novamente.')
        // Mostrar fallback de texto
        const row = document.getElementById('vaTextRow')
        if (row) row.classList.add('visible')
      }
      resetMic()
    }

    recognition.onend = () => {
      if (isListening) resetMic()
    }

    recognition.start()
  }

  function stopListening() {
    isListening = false
    try { recognition?.stop() } catch {}
    resetMic()
  }

  function resetMic() {
    isListening = false
    const btn = document.getElementById('vaMicBtn')
    if (btn) btn.classList.remove('va-listening')
  }

  // ── Envio para IA ─────────────────────────────────────────────────────────────
  async function handleUserInput(text) {
    isListening = false
    isBusy = true

    const btn = document.getElementById('vaMicBtn')
    if (btn) { btn.classList.remove('va-listening'); btn.disabled = true }

    appendMsg('user', text)
    messages.push({ role: 'user', content: text })

    setStatus('thinking', 'Pensando...')
    setAvatarState(null)
    updateContextBadge()

    try {
      const res = await fetch('/api/voice-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, context: getContext() }),
      })
      const data = await res.json()
      if (!res.ok || !data.reply) throw new Error(data.error || 'Erro desconhecido')

      messages.push({ role: 'assistant', content: data.reply })
      appendMsg('agent', data.reply)
      speak(data.reply)
    } catch (err) {
      console.error('[Sofia] Erro:', err)
      setStatus('', 'Aguardando')
      setAvatarState(null)
      isBusy = false
      if (btn) btn.disabled = false
    }
  }

  // ── TTS — SpeechSynthesis ─────────────────────────────────────────────────────
  function speak(text) {
    if (!window.speechSynthesis) {
      setStatus('', 'Aguardando')
      setAvatarState(null)
      isBusy = false
      const btn = document.getElementById('vaMicBtn')
      if (btn) btn.disabled = false
      return
    }

    setStatus('speaking', 'Falando...')
    setAvatarState('speaking')

    const utter = new SpeechSynthesisUtterance(text)
    utter.lang  = 'pt-BR'
    utter.rate  = 1.05
    utter.pitch = 1.05

    // Selecionar voz pt-BR feminina se disponível
    const voices = window.speechSynthesis.getVoices()
    const ptVoice = voices.find(v => v.lang.startsWith('pt') && v.name.toLowerCase().includes('female'))
                 || voices.find(v => v.lang === 'pt-BR')
                 || voices.find(v => v.lang.startsWith('pt'))
    if (ptVoice) utter.voice = ptVoice

    utter.onend = () => {
      setStatus('', 'Aguardando')
      setAvatarState(null)
      isBusy = false
      const btn = document.getElementById('vaMicBtn')
      if (btn) btn.disabled = false
    }

    utter.onerror = () => {
      setStatus('', 'Aguardando')
      setAvatarState(null)
      isBusy = false
      const btn = document.getElementById('vaMicBtn')
      if (btn) btn.disabled = false
    }

    // Chrome às vezes precisa de um pequeno delay para carregar vozes
    setTimeout(() => window.speechSynthesis.speak(utter), 80)
  }

  // ── Bind eventos ──────────────────────────────────────────────────────────────
  function bindEvents() {
    const fab     = document.getElementById('vaFab')
    const overlay = document.getElementById('vaOverlay')
    const closeBtn= document.getElementById('vaClose')
    const endBtn  = document.getElementById('vaEndBtn')
    const micBtn  = document.getElementById('vaMicBtn')
    const kbdBtn  = document.getElementById('vaKeyboard')
    const textRow = document.getElementById('vaTextRow')
    const textIn  = document.getElementById('vaTextInput')
    const textSend= document.getElementById('vaTextSend')

    fab?.addEventListener('click', openModal)
    closeBtn?.addEventListener('click', closeModal)

    // Fechar ao clicar no overlay fora do card
    overlay?.addEventListener('click', e => {
      if (e.target === overlay) closeModal()
    })

    endBtn?.addEventListener('click', endConversation)

    // Microfone — toggle ouvir
    micBtn?.addEventListener('click', () => {
      if (isBusy && !isListening) return
      if (isListening) {
        stopListening()
        isBusy = false
        setStatus('', 'Aguardando')
        setAvatarState(null)
      } else {
        startListening()
      }
    })

    // Alternar teclado
    kbdBtn?.addEventListener('click', () => {
      if (textRow) textRow.classList.toggle('visible')
    })

    // Envio via texto
    function sendText() {
      const val = textIn?.value.trim()
      if (!val || isBusy) return
      textIn.value = ''
      handleUserInput(val)
    }
    textSend?.addEventListener('click', sendText)
    textIn?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText() } })

    // Fechar com Escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.getElementById('vaOverlay')?.classList.contains('va-open')) {
        closeModal()
      }
    })
  }

  // ── Init ──────────────────────────────────────────────────────────────────────
  function init() {
    buildDOM()
    bindEvents()

    // Aguardar vozes carregarem (Chrome)
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices()
      window.speechSynthesis.addEventListener('voiceschanged', () => {}, { once: true })
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()

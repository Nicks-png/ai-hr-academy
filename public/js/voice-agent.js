'use strict'
;(function () {
  const SR       = window.SpeechRecognition || window.webkitSpeechRecognition
  const hasSpeech = !!SR

  let messages    = []
  let isListening = false
  let isBusy      = false
  let recognition = null
  let txVisible   = false

  // ── Injetar DOM ──────────────────────────────────────────────────────────────
  function buildDOM() {
    // Botão flutuante
    const fab = el('button', { class: 'va-fab', id: 'vaFab', title: 'Sofia — Assistente de RH', 'aria-label': 'Falar com Sofia' })
    fab.textContent = '🎙️'

    // Overlay principal (fullscreen)
    const overlay = el('div', { class: 'va-overlay', id: 'vaOverlay', role: 'dialog', 'aria-modal': 'true' })
    overlay.innerHTML = `
      <!-- Top bar -->
      <div class="va-topbar">
        <span class="va-topbar-title">Assistente de RH</span>
        <button class="va-close" id="vaClose" aria-label="Fechar">✕</button>
      </div>

      <!-- Centro -->
      <div class="va-center">
        <!-- Orb / Avatar -->
        <div class="va-orb-wrap" id="vaOrbWrap">
          <div class="va-orb-ring va-orb-ring-1"></div>
          <div class="va-orb-ring va-orb-ring-2"></div>
          <div class="va-orb-ring va-orb-ring-3"></div>
          <img
            class="va-avatar-photo"
            id="vaAvatarPhoto"
            src="img/sofia.jpg"
            alt="Sofia"
            onerror="this.classList.add('va-img-error')"
          />
          <div class="va-avatar-fallback" id="vaAvatarFallback">S</div>
        </div>

        <!-- Info -->
        <div class="va-agent-info">
          <div class="va-agent-name">Sofia</div>
          <div class="va-agent-role">Especialista de RH · Pullman Ibirapuera</div>
        </div>

        <div class="va-context-badge" id="vaContextBadge">📍 <span id="vaContextText"></span></div>

        <div class="va-status-txt" id="vaStatusTxt">Aguardando</div>

        <!-- Transcript colapsável -->
        <div class="va-transcript-wrap" id="vaTxWrap">
          <div class="va-transcript" id="vaTranscript"></div>
        </div>
        <button class="va-toggle-tx" id="vaToggleTx" style="display:none">▾ ver conversa</button>
      </div>

      <!-- Bottom bar -->
      <div class="va-bottom">
        ${!hasSpeech ? `<div class="va-compat-warn"><strong>Use Chrome ou Edge</strong> para ativar o microfone.</div>` : ''}

        <div class="va-text-row ${!hasSpeech ? 'visible' : ''}" id="vaTextRow">
          <input class="va-text-input" id="vaTextInput" type="text" placeholder="Digite sua pergunta..." autocomplete="off"/>
          <button class="va-text-send" id="vaTextSend" aria-label="Enviar">➤</button>
        </div>

        <div class="va-action-row">
          <button class="va-end-btn" id="vaEndBtn" title="Encerrar conversa">🚫</button>
          ${hasSpeech ? `<button class="va-mic-btn" id="vaMicBtn" aria-label="Falar">🎙️</button>` : ''}
          <button class="va-btn-secondary" id="vaKbdBtn" title="Teclado">⌨️</button>
        </div>
      </div>

      <!-- Modal de confirmação de transcrição -->
      <div class="va-confirm-overlay" id="vaConfirmOverlay">
        <div class="va-confirm-card">
          <div class="va-confirm-emoji">📋</div>
          <div class="va-confirm-title">Salvar transcrição?</div>
          <div class="va-confirm-sub">Deseja receber a transcrição desta conversa com a Sofia?</div>
          <div class="va-confirm-btns">
            <button class="va-confirm-yes" id="vaConfirmYes">Sim, quero</button>
            <button class="va-confirm-no" id="vaConfirmNo">Não, obrigado</button>
          </div>
        </div>
      </div>

      <!-- Modal de transcrição -->
      <div class="va-tx-modal-overlay" id="vaTxModalOverlay">
        <div class="va-tx-modal">
          <div class="va-tx-modal-header">
            <span class="va-tx-modal-title">Transcrição da conversa</span>
            <button class="va-tx-modal-close" id="vaTxModalClose">✕</button>
          </div>
          <div class="va-tx-modal-body" id="vaTxModalBody"></div>
          <div class="va-tx-modal-footer">
            <button class="va-tx-close-btn" id="vaTxCloseBtn">Fechar</button>
            <button class="va-tx-download" id="vaTxDownload">↓ Baixar .txt</button>
          </div>
        </div>
      </div>`

    document.body.appendChild(fab)
    document.body.appendChild(overlay)
  }

  // ── Helpers DOM ───────────────────────────────────────────────────────────────
  function el(tag, attrs = {}) {
    const e = document.createElement(tag)
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v))
    return e
  }

  function $(id) { return document.getElementById(id) }

  function setStatus(state, label) {
    const txt = $('vaStatusTxt')
    if (!txt) return
    txt.className = `va-status-txt ${state}`
    txt.textContent = label
  }

  function setOrbState(state) {
    const wrap = $('vaOrbWrap')
    if (!wrap) return
    wrap.className = `va-orb-wrap${state ? ' va-' + state : ''}`
  }

  function appendMsg(role, content) {
    const tr = $('vaTranscript')
    if (!tr) return
    const div = document.createElement('div')
    div.className = `va-msg va-msg-${role}`
    div.innerHTML = `<div class="va-msg-label">${role === 'user' ? 'Você' : 'Sofia'}</div>${escHtml(content)}`
    tr.appendChild(div)
    tr.scrollTop = tr.scrollHeight

    // Mostrar botão de toggle
    const btn = $('vaToggleTx')
    if (btn) btn.style.display = 'block'
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  }

  function updateContextBadge() {
    const badge = $('vaContextBadge')
    const span  = $('vaContextText')
    if (!badge || !span) return
    const ctx = getCtx()
    const labels = {
      triagem: ctx.vaga ? `Triagem · ${ctx.vaga}` : 'Triagem de Currículos',
      whatsapp: 'WhatsApp Recruiter',
      cursos: 'Catálogo de Cursos',
      home: 'Página Inicial',
    }
    const label = labels[ctx.page] || ''
    span.textContent = label
    badge.classList.toggle('visible', !!label)
  }

  // ── Contexto ──────────────────────────────────────────────────────────────────
  function getCtx() {
    return { page: document.body.dataset.page || 'unknown', ...(window.VOICE_CONTEXT || {}) }
  }

  // ── Abrir / Fechar ────────────────────────────────────────────────────────────
  function openModal() {
    $('vaOverlay').classList.add('va-open')
    $('vaFab').classList.add('va-open')
    document.body.style.overflow = 'hidden'
    updateContextBadge()

    // Saudação inicial
    if (messages.length === 0) {
      const ctx = getCtx()
      let greeting = 'Olá! Sou a Sofia, sua consultora de RH. Como posso ajudar?'
      if (ctx.page === 'triagem' && ctx.vaga)
        greeting = `Olá! Vejo que está triando candidatos para ${ctx.vaga}. Posso ajudar com os critérios ou com dúvidas sobre a vaga?`
      else if (ctx.page === 'whatsapp')
        greeting = 'Olá! Estou vendo o painel do WhatsApp Recruiter. Tem dúvidas sobre os candidatos ou os próximos passos?'
      appendMsg('agent', greeting)
      messages.push({ role: 'assistant', content: greeting })
    }
  }

  function closeModal() {
    stopListening()
    window.speechSynthesis?.cancel()
    $('vaOverlay').classList.remove('va-open')
    $('vaFab').classList.remove('va-open')
    document.body.style.overflow = ''
    setStatus('', 'Aguardando')
    setOrbState(null)
  }

  // ── Encerrar — pede transcrição ───────────────────────────────────────────────
  function askForTranscript() {
    stopListening()
    window.speechSynthesis?.cancel()
    if (messages.length <= 1) {
      // Sem conversa real — apenas fechar
      resetConversation()
      closeModal()
      return
    }
    $('vaConfirmOverlay').classList.add('open')
  }

  function resetConversation() {
    messages = []
    txVisible = false
    const tr = $('vaTranscript')
    if (tr) tr.innerHTML = ''
    const btn = $('vaToggleTx')
    if (btn) btn.style.display = 'none'
    const wrap = $('vaTxWrap')
    if (wrap) wrap.classList.remove('expanded')
    setStatus('', 'Aguardando')
    setOrbState(null)
    const micBtn = $('vaMicBtn')
    if (micBtn) { micBtn.disabled = false; micBtn.classList.remove('va-listening') }
  }

  // ── Transcrição ───────────────────────────────────────────────────────────────
  function showTranscript() {
    const body = $('vaTxModalBody')
    if (!body) return

    const now = new Date().toLocaleString('pt-BR')
    let html = `<div style="font-size:.7rem;color:rgba(255,255,255,0.25);margin-bottom:16px">📅 ${now} · Pullman Ibirapuera RH</div>`

    messages.forEach(m => {
      const label = m.role === 'user' ? 'Você' : 'Sofia'
      const cls   = m.role === 'user' ? 'va-tx-line-user' : 'va-tx-line-agent'
      html += `<span class="va-tx-line-label">${label}</span><span class="${cls}">${escHtml(m.content)}</span>\n\n`
    })

    body.innerHTML = html
    $('vaTxModalOverlay').classList.add('open')
  }

  function downloadTranscript() {
    const now = new Date().toLocaleString('pt-BR')
    let txt = `Transcrição — Sofia · Assistente de RH Pullman Ibirapuera\n${now}\n${'─'.repeat(50)}\n\n`
    messages.forEach(m => {
      txt += `${m.role === 'user' ? 'Você' : 'Sofia'}: ${m.content}\n\n`
    })
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `sofia-rh-${Date.now()}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── Toggle transcript ─────────────────────────────────────────────────────────
  function toggleTranscript() {
    txVisible = !txVisible
    const wrap = $('vaTxWrap')
    const btn  = $('vaToggleTx')
    if (wrap) wrap.classList.toggle('expanded', txVisible)
    if (btn) btn.textContent = txVisible ? '▴ esconder conversa' : '▾ ver conversa'
  }

  // ── STT ───────────────────────────────────────────────────────────────────────
  function startListening() {
    if (!hasSpeech || isBusy) return
    isListening = isBusy = true

    recognition = new SR()
    recognition.lang = 'pt-BR'
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setStatus('listening', 'Ouvindo...')
      setOrbState('listening')
      $('vaMicBtn')?.classList.add('va-listening')
    }

    let gotResult = false
    recognition.onresult = e => {
      gotResult = true
      const transcript = e.results[0][0].transcript.trim()
      if (transcript) handleUserInput(transcript)
    }

    recognition.onerror = e => {
      if (e.error === 'not-allowed') {
        appendMsg('agent', 'Preciso de permissão para usar o microfone. Autorize nas configurações do navegador.')
      }
      $('vaTextRow')?.classList.add('visible')
      resetMic()
    }

    recognition.onend = () => {
      if (isListening) {
        if (!gotResult) $('vaTextRow')?.classList.add('visible')
        resetMic()
      }
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
    $('vaMicBtn')?.classList.remove('va-listening')
  }

  // ── LLM ───────────────────────────────────────────────────────────────────────
  async function handleUserInput(text) {
    isListening = false
    isBusy = true
    const micBtn = $('vaMicBtn')
    if (micBtn) { micBtn.classList.remove('va-listening'); micBtn.disabled = true }

    appendMsg('user', text)
    messages.push({ role: 'user', content: text })
    setStatus('thinking', 'Pensando...')
    setOrbState(null)
    updateContextBadge()

    try {
      const res  = await fetch('/api/voice-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, context: getCtx() }),
      })
      const data = await res.json()
      if (!res.ok || !data.reply) throw new Error(data.error || 'Resposta vazia')

      messages.push({ role: 'assistant', content: data.reply })
      appendMsg('agent', data.reply)
      speak(data.reply)
    } catch (err) {
      console.error('[Sofia]', err)
      appendMsg('agent', 'Desculpe, não consegui processar sua mensagem. Tente novamente.')
      setStatus('', 'Aguardando')
      setOrbState(null)
      isBusy = false
      if (micBtn) micBtn.disabled = false
    }
  }

  // ── TTS ───────────────────────────────────────────────────────────────────────
  function speak(text) {
    if (!window.speechSynthesis) {
      finishSpeak()
      return
    }
    setStatus('speaking', 'Falando...')
    setOrbState('speaking')

    const utter = new SpeechSynthesisUtterance(text)
    utter.lang  = 'pt-BR'
    utter.rate  = 1.05
    utter.pitch = 1.08

    const voices = window.speechSynthesis.getVoices()
    const ptVoice = voices.find(v => v.lang.startsWith('pt') && /female|feminino/i.test(v.name))
                 || voices.find(v => v.lang === 'pt-BR')
                 || voices.find(v => v.lang.startsWith('pt'))
    if (ptVoice) utter.voice = ptVoice

    utter.onend   = finishSpeak
    utter.onerror = finishSpeak

    setTimeout(() => window.speechSynthesis.speak(utter), 80)
  }

  function finishSpeak() {
    setStatus('', 'Aguardando')
    setOrbState(null)
    isBusy = false
    const micBtn = $('vaMicBtn')
    if (micBtn) micBtn.disabled = false
  }

  // ── Bind eventos ──────────────────────────────────────────────────────────────
  function bindEvents() {
    // Abrir
    $('vaFab')?.addEventListener('click', openModal)

    // Fechar (X no topo)
    $('vaClose')?.addEventListener('click', closeModal)

    // Mic
    $('vaMicBtn')?.addEventListener('click', () => {
      if (isBusy && !isListening) return
      if (isListening) {
        stopListening(); isBusy = false
        setStatus('', 'Aguardando'); setOrbState(null)
      } else {
        startListening()
      }
    })

    // Teclado toggle
    $('vaKbdBtn')?.addEventListener('click', () => {
      $('vaTextRow')?.classList.toggle('visible')
    })

    // Envio por texto
    const sendText = () => {
      const val = $('vaTextInput')?.value.trim()
      if (!val) return
      // Para reconhecimento de voz antes de enviar
      if (isListening) stopListening()
      isBusy = false
      $('vaTextInput').value = ''
      handleUserInput(val)
    }
    $('vaTextSend')?.addEventListener('click', sendText)
    $('vaTextInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText() }
    })

    // Encerrar → pede transcrição
    $('vaEndBtn')?.addEventListener('click', askForTranscript)

    // Toggle transcript
    $('vaToggleTx')?.addEventListener('click', toggleTranscript)

    // Confirmação de transcrição
    $('vaConfirmYes')?.addEventListener('click', () => {
      $('vaConfirmOverlay').classList.remove('open')
      showTranscript()
      resetConversation()
    })
    $('vaConfirmNo')?.addEventListener('click', () => {
      $('vaConfirmOverlay').classList.remove('open')
      resetConversation()
      closeModal()
    })

    // Modal de transcrição
    $('vaTxModalClose')?.addEventListener('click', () => {
      $('vaTxModalOverlay').classList.remove('open')
      closeModal()
    })
    $('vaTxCloseBtn')?.addEventListener('click', () => {
      $('vaTxModalOverlay').classList.remove('open')
      closeModal()
    })
    $('vaTxDownload')?.addEventListener('click', downloadTranscript)

    // Escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if ($('vaTxModalOverlay')?.classList.contains('open')) {
          $('vaTxModalOverlay').classList.remove('open')
          closeModal()
        } else if ($('vaConfirmOverlay')?.classList.contains('open')) {
          $('vaConfirmOverlay').classList.remove('open')
        } else if ($('vaOverlay')?.classList.contains('va-open')) {
          closeModal()
        }
      }
    })
  }

  // ── Init ──────────────────────────────────────────────────────────────────────
  function init() {
    buildDOM()
    bindEvents()
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

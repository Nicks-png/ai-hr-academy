'use strict'

const CURSOS = [
  // IA Básico
  { id: 1, titulo: 'IA Generativa para Iniciantes', autor: 'Google Cloud', categoria: 'ia-basico', nivel: 'Iniciante', duracao: '2h 30min', descricao: 'Fundamentos de IA generativa: como funciona, casos de uso pr\u00e1ticos e primeiros passos.', videoId: 'G2fqAlgmoPo', tags: ['Google', 'IA', 'Fundamentos'], cor: 'linear-gradient(135deg,#4285f4,#34a853)' },
  { id: 2, titulo: 'Introdu\u00e7\u00e3o \u00e0 Intelig\u00eancia Artificial', autor: 'IBM Skills', categoria: 'ia-basico', nivel: 'Iniciante', duracao: '3h', descricao: 'Conceitos essenciais de IA, machine learning e deep learning para n\u00e3o-t\u00e9cnicos.', videoId: 'mJeNghZXtMo', tags: ['IBM', 'IA', 'ML'], cor: 'linear-gradient(135deg,#1f70c1,#00b0ff)' },
  { id: 3, titulo: 'AI for Everyone', autor: 'Andrew Ng', categoria: 'ia-basico', nivel: 'Iniciante', duracao: '6h', descricao: 'Curso especialmente projetado para executivos e n\u00e3o-t\u00e9cnicos entenderem o impacto da IA.', videoId: 'FaHHHC7Rl6A', tags: ['Coursera', 'Gest\u00e3o', 'Estrat\u00e9gia'], cor: 'linear-gradient(135deg,#7c3aed,#a78bfa)' },

  // Engenharia de Prompts
  { id: 4, titulo: 'Prompt Engineering para Iniciantes', autor: 'DeepLearning.AI', categoria: 'prompts', nivel: 'Iniciante', duracao: '1h 45min', descricao: 'Aprenda a escrever prompts eficientes para obter os melhores resultados de qualquer LLM.', videoId: 'T9aRN5JkmL8', tags: ['Prompts', 'ChatGPT', 'LLM'], cor: 'linear-gradient(135deg,#f59e0b,#ef4444)' },
  { id: 5, titulo: 'Engenharia de Prompts Avan\u00e7ada', autor: 'OpenAI', categoria: 'prompts', nivel: 'Intermedi\u00e1rio', duracao: '2h 15min', descricao: 'T\u00e9cnicas avan\u00e7adas: chain-of-thought, few-shot learning, RAG e otimiza\u00e7\u00e3o de prompts.', videoId: '1bUy-1hGZpI', tags: ['OpenAI', 'Avan\u00e7ado', 'RAG'], cor: 'linear-gradient(135deg,#06b6d4,#0891b2)' },
  { id: 6, titulo: 'ChatGPT Prompt Engineering', autor: 'Isa Fulford', categoria: 'prompts', nivel: 'Intermedi\u00e1rio', duracao: '1h 30min', descricao: 'Guia pr\u00e1tico de engenharia de prompts com exemplos reais e t\u00e9cnicas comprovadas.', videoId: 'H4YK_7MAckk', tags: ['ChatGPT', 'Pr\u00e1tico', 'Exemplos'], cor: 'linear-gradient(135deg,#10b981,#059669)' },

  // IA para RH
  { id: 7, titulo: 'IA no Recrutamento: Guia Completo', autor: 'SHRM', categoria: 'rh', nivel: 'Iniciante', duracao: '2h', descricao: 'Como usar ferramentas de IA para triagem de curr\u00edculos, entrevistas e sele\u00e7\u00e3o de talentos.', videoId: 'Y8Tko2YC5hA', tags: ['RH', 'Recrutamento', 'ATS'], cor: 'linear-gradient(135deg,#7c3aed,#06b6d4)' },
  { id: 8, titulo: 'Automa\u00e7\u00e3o de RH com IA', autor: 'LinkedIn Learning', categoria: 'rh', nivel: 'Intermedi\u00e1rio', duracao: '3h 20min', descricao: 'Automatize triagem, onboarding e avalia\u00e7\u00e3o de desempenho com ferramentas modernas de IA.', videoId: 'aircAruvnKk', tags: ['LinkedIn', 'Automa\u00e7\u00e3o', 'RH'], cor: 'linear-gradient(135deg,#0077b5,#00a0dc)' },
  { id: 9, titulo: '\u00c9tica na IA para RH', autor: 'MIT OpenCourseWare', categoria: 'rh', nivel: 'Iniciante', duracao: '1h 45min', descricao: 'Vi\u00e9ses algor\u00edtmicos, fairness e responsabilidade no uso de IA em processos seletivos.', videoId: '5qap5aO4i9A', tags: ['\u00c9tica', 'MIT', 'Compliance'], cor: 'linear-gradient(135deg,#6366f1,#8b5cf6)' },

  // ChatGPT
  { id: 10, titulo: 'ChatGPT para Profissionais de RH', autor: 'Coursera', categoria: 'chatgpt', nivel: 'Iniciante', duracao: '2h', descricao: 'Use ChatGPT para criar descri\u00e7\u00f5es de vagas, emails de recrutamento, feedbacks e muito mais.', videoId: 'JTxsNm9IdYU', tags: ['ChatGPT', 'RH', 'Produtividade'], cor: 'linear-gradient(135deg,#10a37f,#059669)' },
  { id: 11, titulo: 'ChatGPT: Do Zero ao Profissional', autor: 'Udemy Free', categoria: 'chatgpt', nivel: 'Iniciante', duracao: '4h', descricao: 'Curso completo do zero: como usar ChatGPT para trabalho, estudos e automa\u00e7\u00e3o de tarefas.', videoId: 'oc6RV5c1yd0', tags: ['ChatGPT', 'Completo', 'Pr\u00e1tico'], cor: 'linear-gradient(135deg,#f59e0b,#d97706)' },
  { id: 12, titulo: 'GPT-4 e Claude: Comparativo Pr\u00e1tico', autor: 'AI Explained', categoria: 'chatgpt', nivel: 'Intermedi\u00e1rio', duracao: '1h 20min', descricao: 'An\u00e1lise comparativa dos principais LLMs do mercado: quando usar cada um e suas limita\u00e7\u00f5es.', videoId: 'pOmpqdlVCoo', tags: ['GPT-4', 'Claude', 'Comparativo'], cor: 'linear-gradient(135deg,#a78bfa,#7c3aed)' },

  // Automação
  { id: 13, titulo: 'Automa\u00e7\u00e3o com Make (Integromat)', autor: 'Make Academy', categoria: 'automacao', nivel: 'Iniciante', duracao: '3h 30min', descricao: 'Crie automa\u00e7\u00f5es poderosas conectando ferramentas como Gmail, WhatsApp, Sheets e IA.', videoId: 'wBjZ_K9C0mE', tags: ['Make', 'No-Code', 'Automa\u00e7\u00e3o'], cor: 'linear-gradient(135deg,#6d28d9,#4c1d95)' },
  { id: 14, titulo: 'n8n para Automa\u00e7\u00e3o de RH', autor: 'n8n Community', categoria: 'automacao', nivel: 'Intermedi\u00e1rio', duracao: '2h 45min', descricao: 'Workflows automatizados para recrutamento: parsing de CVs, notifica\u00e7\u00f5es e relat\u00f3rios.', videoId: 'f_m_n0MxKiQ', tags: ['n8n', 'Workflow', 'Open Source'], cor: 'linear-gradient(135deg,#ea580c,#dc2626)' },
  { id: 15, titulo: 'Zapier + IA: Automa\u00e7\u00f5es Inteligentes', autor: 'Zapier Academy', categoria: 'automacao', nivel: 'Iniciante', duracao: '2h', descricao: 'Conecte ferramentas de IA ao seu fluxo de trabalho sem escrever c\u00f3digo.', videoId: 'mPhAL9v3QCw', tags: ['Zapier', 'No-Code', 'Integra\u00e7\u00f5es'], cor: 'linear-gradient(135deg,#ff6008,#ff4500)' },

  // Dados & Analytics
  { id: 16, titulo: 'People Analytics: Dados em RH', autor: 'HRCI', categoria: 'dados', nivel: 'Intermedi\u00e1rio', duracao: '4h', descricao: 'Use dados para tomar decis\u00f5es melhores em recrutamento, reten\u00e7\u00e3o e desenvolvimento.', videoId: 'ua-CiDNNj30', tags: ['Analytics', 'Dados', 'Decis\u00f5es'], cor: 'linear-gradient(135deg,#0284c7,#0369a1)' },
  { id: 17, titulo: 'Power BI para RH', autor: 'Microsoft Learn', categoria: 'dados', nivel: 'Iniciante', duracao: '3h 15min', descricao: 'Dashboards de RH do zero: turnover, time-to-hire, diversidade e m\u00e9tricas de recrutamento.', videoId: 'yKTSLffVGbk', tags: ['Power BI', 'Microsoft', 'Dashboard'], cor: 'linear-gradient(135deg,#f59e0b,#b45309)' },
  { id: 18, titulo: 'Google Sheets + IA para RH', autor: 'Google Workspace', categoria: 'dados', nivel: 'Iniciante', duracao: '1h 45min', descricao: 'Use f\u00f3rmulas, scripts e Add-ons de IA no Google Sheets para automatizar relat\u00f3rios de RH.', videoId: 'N2opj8XzYBY', tags: ['Google', 'Sheets', 'Gr\u00e1tis'], cor: 'linear-gradient(135deg,#34a853,#1a73e8)' },
]

const CAT_LABELS = {
  'todos':     'Todos',
  'ia-basico': 'IA B\u00e1sico',
  'prompts':   'Engenharia de Prompts',
  'rh':        'IA para RH',
  'chatgpt':   'ChatGPT',
  'automacao': 'Automa\u00e7\u00e3o',
  'dados':     'Dados & Analytics',
}

let activeFilter  = 'todos'
let searchQuery   = ''
let currentCourseId = null

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderGrid()
  bindFilters()
  bindSearch()
  bindModal()
})

// ── Render ────────────────────────────────────────────────────────────────────
function renderGrid() {
  const grid     = document.getElementById('coursesGrid')
  const filtered = getFiltered()

  if (!filtered.length) {
    grid.innerHTML = '<div class="no-results">Nenhum curso encontrado para esta busca.</div>'
    return
  }

  grid.innerHTML = filtered.map(c => {
    const levelColor = c.nivel === 'Iniciante' ? 'rgba(16,185,129,0.9)'
                     : c.nivel === 'Intermedi\u00e1rio' ? 'rgba(245,158,11,0.9)'
                     : 'rgba(239,68,68,0.9)'
    return `
    <div class="course-card" data-id="${c.id}" onclick="openCourse(${c.id})">
      <div class="course-thumbnail" style="background:${c.cor}">
        <div class="play-icon">\u25b6\ufe0f</div>
        <div class="course-level-badge" style="background:${levelColor}">${c.nivel}</div>
        <div class="course-duration">\u23f1 ${c.duracao}</div>
      </div>
      <div class="course-body">
        <div class="course-cat">${CAT_LABELS[c.categoria] || c.categoria}</div>
        <div class="course-title">${c.titulo}</div>
        <div class="course-author">${c.autor}</div>
        <div class="course-desc">${c.descricao}</div>
        <div class="course-tags">${c.tags.map(t => `<span class="course-tag">${t}</span>`).join('')}</div>
        <div class="course-footer">
          <button class="btn-watch" onclick="event.stopPropagation();openCourse(${c.id})">\u25b6 Assistir gr\u00e1tis</button>
          <span class="free-badge">GRATIS</span>
        </div>
      </div>
    </div>`
  }).join('')
}

function getFiltered() {
  return CURSOS.filter(c => {
    const catOk = activeFilter === 'todos' || c.categoria === activeFilter
    if (!searchQuery) return catOk
    const q = searchQuery.toLowerCase()
    const haystack = [c.titulo, c.autor, c.descricao, ...c.tags].join(' ').toLowerCase()
    return catOk && haystack.includes(q)
  })
}

// ── Filters ───────────────────────────────────────────────────────────────────
function bindFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.cat
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === activeFilter))
      renderGrid()
    })
  })
}

// ── Search ────────────────────────────────────────────────────────────────────
function bindSearch() {
  const input = document.getElementById('searchInput')
  if (!input) return
  let debounce
  input.addEventListener('input', () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      searchQuery = input.value.trim()
      renderGrid()
    }, 250)
  })
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openCourse(id) {
  const c = CURSOS.find(c => c.id === id)
  if (!c) return
  currentCourseId = id

  document.getElementById('modalTitle').textContent    = c.titulo
  document.getElementById('modalDesc').textContent     = c.descricao
  document.getElementById('modalDuration').textContent = `\u23f1 ${c.duracao}`
  document.getElementById('modalLevel').textContent    = `\uD83D\uDCCA ${c.nivel}`

  // YouTube embed
  document.getElementById('courseIframe').src =
    `https://www.youtube-nocookie.com/embed/${c.videoId}?autoplay=1&rel=0&modestbranding=1`

  document.getElementById('courseModal').classList.add('on')
  document.body.style.overflow = 'hidden'
}

function closeModal() {
  document.getElementById('courseModal').classList.remove('on')
  document.getElementById('courseIframe').src = ''
  document.body.style.overflow = ''
  currentCourseId = null
}

function bindModal() {
  document.getElementById('closeModal').addEventListener('click', closeModal)

  document.getElementById('courseModal').addEventListener('click', e => {
    if (e.target === document.getElementById('courseModal')) closeModal()
  })

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && currentCourseId !== null) closeModal()
  })
}

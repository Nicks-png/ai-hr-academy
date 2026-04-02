;(function () {
  // Aplica tema salvo antes de renderizar (evita flash)
  const saved = localStorage.getItem('theme')
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const theme = saved || (prefersDark ? 'dark' : 'light')
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light')

  // Toggle ao clicar no botão
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('themeToggle')
    if (!btn) return
    updateIcon(btn)
    btn.addEventListener('click', () => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light'
      if (isLight) {
        document.documentElement.removeAttribute('data-theme')
        localStorage.setItem('theme', 'dark')
      } else {
        document.documentElement.setAttribute('data-theme', 'light')
        localStorage.setItem('theme', 'light')
      }
      updateIcon(btn)
    })
  })

  function updateIcon(btn) {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light'
    btn.textContent = isLight ? '🌙' : '☀️'
    btn.title = isLight ? 'Modo escuro' : 'Modo claro'
  }
})()

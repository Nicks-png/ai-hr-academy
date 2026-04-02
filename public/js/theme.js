;(function () {
  // Aplica tema salvo — nunca detecta preferência do SO automaticamente
  // Default sempre escuro, a menos que o usuário tenha escolhido claro
  const saved = localStorage.getItem('theme')
  if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light')

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
    btn.textContent = isLight ? '\u{1F319}' : '\u2600\uFE0F'
    btn.title = isLight ? 'Modo escuro' : 'Modo claro'
  }
})()

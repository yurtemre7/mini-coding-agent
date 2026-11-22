document.getElementById('theme')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = next
  try { localStorage.setItem('mca-theme', next) } catch (e) { /* private mode: the choice just is not remembered */ }
})
document.querySelectorAll('.copy').forEach((b) =>
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(b.parentElement.querySelector('code').innerText)
      b.textContent = 'Copied'
    } catch (e) {
      b.textContent = 'Press Cmd+C'
    }
    setTimeout(() => (b.textContent = 'Copy'), 1600)
  })
)

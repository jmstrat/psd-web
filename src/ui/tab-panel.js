const tabs = document.querySelectorAll('.tab-btn')
for (const tab of tabs) {
  tab.addEventListener('click', () => {
    const parent = tab.closest('form')
    const allTabs = parent.querySelectorAll('.tab-btn')
    const allPanels = parent.querySelectorAll('[role="tabpanel"]')

    // Deactivate all tabs
    for (const t of allTabs) {
      t.setAttribute('aria-selected', 'false')
      t.classList.replace('border-blue-600', 'border-transparent')
      t.classList.replace('text-blue-600', 'text-slate-500')
    }

    // Hide all panels
    for (const panel of allPanels) {
      panel.classList.add('hidden')
    }

    // Activate target tab
    tab.setAttribute('aria-selected', 'true')
    tab.classList.replace('border-transparent', 'border-blue-600')
    tab.classList.replace('text-slate-500', 'text-blue-600')

    // Show target panel
    const panelId = tab.getAttribute('aria-controls')
    const targetPanel = parent.querySelector(`#${panelId}`)
    targetPanel.classList.remove('hidden')
  })
}

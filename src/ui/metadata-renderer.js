const DEFAULT_CLASSES = {
  row: "flex flex-col gap-1 border-b border-dashed border-slate-200 pb-3 last:border-0 last:pb-0",
  label: "font-semibold text-slate-700",
  wrapper: "flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto mt-0.5 scrollbar-simple",
  badge: "inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600",
  value: "text-slate-500 break-all"
}

function defaultFormatKey (key) {
  const humanKey = key.replace(/([A-Z])/g, ' $1').trim()
  return humanKey.charAt(0).toUpperCase() + humanKey.slice(1)
}

export class MetadataRenderer {
  constructor (container, options = {}) {
    this.container = container
    this.classes = { ...DEFAULT_CLASSES, ...options.classes }
    this.formatKey = options.formatKey || defaultFormatKey
  }

  render (metadata) {
    const rows = []

    for (const [key, value] of Object.entries(metadata)) {
      const row = document.createElement("div")
      row.className = this.classes.row

      row.appendChild(this.#createLabel(key))
      row.appendChild(this.#createContent(value))

      rows.push(row)
    }

    this.container.replaceChildren(...rows)
  }

  #createLabel (key) {
    const label = document.createElement("span")
    label.className = this.classes.label
    label.textContent = this.formatKey(key)
    return label
  }

  #createContent (value) {
    if (Array.isArray(value)) {
      const wrapper = document.createElement("div")
      wrapper.className = this.classes.wrapper

      for (const item of value) {
        const badge = document.createElement("span")
        badge.className = this.classes.badge
        badge.textContent = item
        wrapper.appendChild(badge)
      }

      return wrapper
    }

    const valueSpan = document.createElement("span")
    valueSpan.className = this.classes.value
    valueSpan.textContent = value
    return valueSpan
  }
}

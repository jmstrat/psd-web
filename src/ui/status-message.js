export class StatusMessage {
  #element
  #span
  #type
  #typeStyles = {
    info: { bg: 'bg-blue-100', text: 'text-blue-700' },
    success: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
    error: { bg: 'bg-rose-100', text: 'text-rose-700' }
  }

  constructor (element) {
    this.#element = element
    this.#span = element.querySelector('#status') || element.querySelector('span')
    this.message = "Loading..."
    this.type = 'info'
  }

  set message (text) {
    if (this.#span) {
      this.#span.textContent = text
    }
  }

  get type () {
    return this.#type
  }

  set type (type) {
    this.#type = type
    const config = this.#typeStyles[type] || this.#typeStyles.info

    Object.values(this.#typeStyles).forEach(style => {
      this.#element.classList.remove(style.bg, style.text)
    })

    this.#element.classList.add(config.bg, config.text)
  }
}

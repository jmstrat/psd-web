export class ProgressBar {
  #container
  #bar
  #message

  constructor (containerElement) {
    this.#container = containerElement
    this.#bar = containerElement.querySelector('#progressBar')
    this.#message = containerElement.querySelector('#progressText')

    this.message = "Processing..."
    this.progress = null
  }

  show () {
    this.#container.classList.remove('opacity-0')
    this.#container.classList.add('opacity-100')
  }

  hide () {
    this.#container.classList.remove('opacity-100')
    this.#container.classList.add('opacity-0')
    this.progress = 0
  }

  set message (text) {
    if (this.#message) {
      this.#message.textContent = text
    }
  }

  set progress (value) {
    if (value === null || value === undefined) {
      this.#bar.removeAttribute('value')
    } else {
      this.#bar.value = value
    }
  }

  set min (value) {
    this.#bar.min = value
  }

  set max (value) {
    this.#bar.max = value
  }
}

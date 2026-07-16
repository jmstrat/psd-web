// emits:
// 'statechange': { active: bool, [isMultiple: bool] }
// 'files': { files: [] }
// 'error': { message }
export class DragAndDropManager extends EventTarget {
  static events = {
    error: 'error',
    files: 'files',
    stateChange: 'statechange'
  }

  #options

  #dragDepth = 0
  #active = false
  #isMultiple = false

  constructor ({
    accept = ['*/*'],
    multiple = true,
    validate = null // function (file) -> bool
  } = {}) {
    super()

    this.#options = { accept, multiple, validate }

    this.#attachListeners()
  }

  destroy () {
    window.removeEventListener('dragenter', this.#onDragEnter)
    window.removeEventListener('dragover', this.#onDragOver)
    window.removeEventListener('dragleave', this.#onDragLeave)
    window.removeEventListener('drop', this.#onDrop)
    window.removeEventListener('dragend', this.#onDragEnd)
  }

  #attachListeners () {
    window.addEventListener('dragenter', this.#onDragEnter)
    window.addEventListener('dragover', this.#onDragOver)
    window.addEventListener('dragleave', this.#onDragLeave)
    window.addEventListener('drop', this.#onDrop)
    window.addEventListener('dragend', this.#onDragEnd)
  }

  #matchesAccept (file) {
    if (this.#options.validate) {
      return this.#options.validate(file)
    }

    if (
      this.#options.accept.includes('*') ||
      this.#options.accept.includes('*/*')
    ) {
      return true
    }

    return this.#options.accept.some(type => {
      if (type.endsWith('/*')) {
        return file.type.startsWith(type.replace('*', ''))
      }
      return file.type === type
    })
  }

  #extractValidFiles (fileList) {
    const files = Array.from(fileList).filter(f => this.#matchesAccept(f))
    return this.#options.multiple ? files : files.slice(0, 1)
  }

  #onDragEnter = (e) => {
    const types = Array.from(e.dataTransfer.types || [])

    if (!types.includes('Files')) {
      return
    }

    e.preventDefault()

    this.#dragDepth++

    if (!this.#active) {
      this.#active = true
      this.#emitState({
        active: true,
        isMultiple: this.#isMultiple
      })
    }
  }

  #onDragOver = (e) => {
    e.preventDefault()

    const dt = e.dataTransfer

    let validCount = 0

    if (dt.items && dt.items.length > 0) {
      for (const item of dt.items) {
        if (item.kind !== 'file') {
          continue
        }

        const fakeFile = { type: item.type }

        if (!this.#matchesAccept(fakeFile)) {
          continue
        }

        validCount++
        if (validCount === 2) {
          break
        }
      }
    } else {
      // Safari fallback
      // Safari doesn't populate items on dragover
      validCount = 2
    }

    const hasValid = validCount > 0
    const isMultiple = validCount > 1

    dt.dropEffect = hasValid ? 'copy' : 'none'

    if (this.#isMultiple !== isMultiple) {
      this.#isMultiple = isMultiple

      if (this.#active) {
        this.#emitState({
          active: true,
          isMultiple
        })
      }
    }
  }

  #onDragLeave = (e) => {
    if (this.#dragDepth > 0) {
      this.#dragDepth--
    }

    if (this.#dragDepth === 0) {
      this.#active = false
      this.#isMultiple = false

      this.#emitState({ active: false })
    }
  }

  #onDrop = (e) => {
    e.preventDefault()

    this.#dragDepth = 0
    this.#active = false
    this.#isMultiple = false

    this.#emitState({ active: false })

    const files = this.#extractValidFiles(e.dataTransfer.files)

    if (files.length === 0) {
      this.dispatchEvent(new CustomEvent(DragAndDropManager.events.error, {
        detail: { message: 'No valid files dropped' }
      }))
      return
    }

    this.dispatchEvent(new CustomEvent(DragAndDropManager.events.files, {
      detail: { files }
    }))
  }

  #onDragEnd = () => {
    this.#dragDepth = 0

    if (this.#active) {
      this.#active = false
      this.#isMultiple = false

      this.#emitState({ active: false })
    }
  }

  #emitState (state) {
    this.dispatchEvent(new CustomEvent(DragAndDropManager.events.stateChange, {
      detail: state
    }))
  }
}

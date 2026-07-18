const btnArray = document.querySelector('#btn-mode-array')
const btnAxis = document.querySelector('#btn-mode-axis')
const containerArray = document.querySelector('#slice-container-array')
const containerAxis = document.querySelector('#slice-container-axis')
const axisRowsContainer = document.querySelector('#axis-rows-container')
const btnAddAxis = document.querySelector('#btn-add-axis-row')
const arrayInput = document.querySelector('#input-slice-array')

let activeMode = 'array'

function toggleMode (mode) {
  activeMode = mode
  if (mode === 'array') {
    btnArray.className = 'flex-1 py-1 rounded bg-white text-slate-800 shadow-sm transition-all focus:outline-none'
    btnAxis.className = 'flex-1 py-1 rounded text-slate-500 hover:text-slate-700 transition-all focus:outline-none'
    containerArray.classList.remove('hidden')
    containerAxis.classList.add('hidden')
  } else {
    btnAxis.className = 'flex-1 py-1 rounded bg-white text-slate-800 shadow-sm transition-all focus:outline-none'
    btnArray.className = 'flex-1 py-1 rounded text-slate-500 hover:text-slate-700 transition-all focus:outline-none'
    containerAxis.classList.remove('hidden')
    containerArray.classList.add('hidden')
  }
}

btnArray.addEventListener('click', () => toggleMode('array'))
btnAxis.addEventListener('click', () => toggleMode('axis'))

function buildInputField (placeholder, extraClasses = '') {
  const input = document.createElement('input')
  input.type = 'text'
  input.placeholder = placeholder
  input.required = true
  input.className = `form-input py-1 px-1.5 text-[11px] w-full box-border min-w-0 ${extraClasses}`.trim()
  return input
}

function buildRemoveButton (row) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.innerHTML = '&times;'
  btn.className = 'text-slate-400 hover:text-red-500 hover:bg-slate-200/50 rounded-full w-5 h-5 flex items-center justify-center text-sm font-light transition-colors focus:outline-none shrink-0 justify-self-end'
  btn.addEventListener('click', () => row.remove())
  return btn
}

function createAxisRow () {
  const row = document.createElement('div')
  row.className = 'grid grid-cols-[100px_1fr_20px] gap-1.5 items-center bg-slate-50 p-1 rounded border border-slate-200/60 shadow-sm animate-fadeIn box-border w-full'

  const keyInput = buildInputField('Axis Name', 'font-medium axis-key')
  const valInput = buildInputField('Value (e.g. 12)', 'axis-val')
  const removeBtn = buildRemoveButton(row)

  row.appendChild(keyInput)
  row.appendChild(valInput)
  row.appendChild(removeBtn)

  return row
}

btnAddAxis.addEventListener('click', () => {
  axisRowsContainer.appendChild(createAxisRow())
})

axisRowsContainer.appendChild(createAxisRow())

function parsePrimitiveValue (str) {
  const trimmed = str.trim()
  if (!isNaN(trimmed) && trimmed !== '') {
    return Number(trimmed)
  }
  return trimmed.replace(/['"]/g, '')
}

export function getSliceConfiguration () {
  if (activeMode === 'array') {
    const rawVal = arrayInput.value.trim()
    if (!rawVal) {
      return undefined
    }

    const parts = rawVal.split(',')
    const parsedArray = []
    for (const part of parts) {
      parsedArray.push(parsePrimitiveValue(part))
    }
    return parsedArray
  }

  const sliceObject = {}
  const rows = axisRowsContainer.querySelectorAll('#axis-rows-container > div')

  for (const row of rows) {
    const key = row.querySelector('.axis-key').value.trim()
    const valString = row.querySelector('.axis-val').value.trim()

    if (!key || !valString) {
      continue
    }

    sliceObject[key] = parsePrimitiveValue(valString)
  }

  return Object.keys(sliceObject).length > 0 ? sliceObject : undefined
}

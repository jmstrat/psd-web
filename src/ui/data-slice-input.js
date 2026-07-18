const axisRowsContainer = document.querySelector('#axis-rows-container')
const btnAddAxis = document.querySelector('#btn-add-axis-row')

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
  row.className = 'grid grid-cols-[1fr_1fr_20px] gap-1.5 items-center py-0.5 animate-fadeIn box-border w-full'

  const keyInput = buildInputField('Axis Name', 'font-medium axis-key')
  const valInput = buildInputField('Slice', 'axis-val')
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

function parseAxisSliceValue (str) {
  const trimmed = str.trim()

  // Whole axis
  if (trimmed === ":") {
    return ":"
  }

  // Array of indices
  if (trimmed.includes(",")) {
    return trimmed.split(",").map(item => {
      const num = Number(item.trim())
      if (isNaN(num)) {
        throw new Error(`List item "${item}" must be a valid integer`)
      }
      return num
    })
  }

  // Ranges
  if (trimmed.includes(":")) {
    const segments = trimmed.split(":").map(s => {
      const val = s.trim()
      return val === "" ? undefined : Number(val)
    })

    const rangeObj = {}
    if (segments[0] !== undefined) {
      rangeObj.start = segments[0]
    }
    if (segments[1] !== undefined) {
      rangeObj.end = segments[1]
    }
    if (segments[2] !== undefined) {
      rangeObj.step = segments[2]
    }

    return rangeObj
  }

  // Single index
  if (!isNaN(trimmed) && trimmed !== '') {
    return Number(trimmed)
  }

  return trimmed.replace(/['"]/g, '')
}

export function getSliceConfiguration () {
  const sliceObject = {}
  const rows = axisRowsContainer.querySelectorAll('#axis-rows-container > div')

  for (const row of rows) {
    const key = row.querySelector('.axis-key').value.trim()
    const valString = row.querySelector('.axis-val').value.trim()

    if (!key || !valString) {
      continue
    }

    sliceObject[key] = parseAxisSliceValue(valString)
  }

  return Object.keys(sliceObject).length > 0 ? sliceObject : undefined
}

export const box = Object.freeze({
  id: 'box',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea: { left, top, right, bottom } } = chart
    ctx.save()
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(left, top)
    ctx.lineTo(right, top)
    ctx.lineTo(right, bottom)
    ctx.stroke()
    ctx.restore()
  }
})

export const verticalHoverLine = Object.freeze({
  id: 'verticalHoverLine',
  afterDatasetsDraw(chart) {
    if (chart.tooltip?._active?.length) {
      const { ctx, chartArea: { top, bottom } } = chart
      const activePoint = chart.tooltip._active[0]
      const xCoord = activePoint.element.x
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(xCoord, top)
      ctx.lineTo(xCoord, bottom)
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(100, 100, 100, 0.6)'
      ctx.stroke()
      ctx.restore()
    }
  }
})

export function destroyChart (chart, ctx, message) {
  if (chart) {
    chart.destroy()
  }

  if (!ctx) {
    return
  }

  const canvas = ctx.canvas

  const rect = canvas.getBoundingClientRect()
  const width = rect.width
  const height = rect.height

  canvas.width = width
  canvas.height = height

  ctx.save()

  ctx.clearRect(0, 0, width, height)

  ctx.fillStyle = "#666"
  ctx.font = "14px sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"

  ctx.fillText(
    message,
    width / 2,
    height / 2
  )

  ctx.restore()
}

// as addEventListener("click", callback) but with a small debounce to ignore
// double clicks
export function onSingleClick (element, callback, signal, delay = 200) {
  let timer = null

  const handler = (event) => {
    // If the browser registers a double-click, cancel the pending single click
    if (event.detail > 1) {
      clearTimeout(timer)
      return
    }

    const preservedEvent = {
      clientX: event.clientX,
      clientY: event.clientY,
      target: event.target
    }

    timer = setTimeout(() => {
      callback(preservedEvent)
    }, delay)
  }
  element.addEventListener("click", handler, { signal })
}

/**
 * WARNING: This function mutates objects in place for performance
 * Do not use if target or source will be used after this function call
 */
export function deepMerge (target, source) {
  if (!isObject(target) || !isObject(source)) {
    return source
  }

  for (const key of Object.keys(source)) {
    const targetValue = target[key]
    const sourceValue = source[key]

    if (Array.isArray(sourceValue) && Array.isArray(targetValue)) {
      const len = sourceValue.length
      for (let i = 0; i < len; i++) {
        targetValue.push(sourceValue[i])
      }
    } else if (isObject(sourceValue)) {
      if (!(key in target) || !isObject(targetValue)) {
        target[key] = sourceValue
      } else {
        target[key] = deepMerge(targetValue, sourceValue)
      }
    } else {
      target[key] = sourceValue
    }
  }

  return target
}

function isObject (item) {
  return item && typeof item === 'object' && !Array.isArray(item)
}

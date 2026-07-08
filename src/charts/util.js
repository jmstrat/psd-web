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

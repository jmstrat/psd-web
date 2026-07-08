export const gradientLegend = {
  id: 'gradientLegend',
  afterDatasetsDraw (chart, args, options) {
    const { ctx, chartArea: { top, bottom }, data, width } = chart

    const dataArray = data.datasets

    if (!dataArray || dataArray.length === 0) {
      return
    }

    const allColours = dataArray.map(d => d.borderColor || d.backgroundColor)
    const labels = dataArray.map(d => d.label)

    if (options.cyclic && allColours.length > 0) {
      allColours.push(allColours[0])
      labels.push(options.cyclicMax || '')
    }

    const len = labels.length
    const textLabels = [
      labels[0],
      labels[Math.floor((len - 1) / 2)],
      labels[len - 1]
    ]

    const pillHeight = 15
    const pillPaddingX = 6

    const paddingRightMargin = 0
    const legendWidth = 50
    const legendHeight = (bottom - top) - pillHeight - 2
    const legendTop = top + pillHeight / 2 + 1

    const legendRight = width - paddingRightMargin
    const legendLeft = legendRight - legendWidth

    const barWidth = 14
    const barLeft = legendLeft + 18

    // Bar
    ctx.save()
    const gradient = ctx.createLinearGradient(0, legendTop, 0, legendTop + legendHeight)
    for (const [index, colour] of allColours.entries()) {
      gradient.addColorStop(index / (allColours.length - 1), colour)
    }

    ctx.fillStyle = gradient
    ctx.fillRect(barLeft, legendTop, barWidth, legendHeight)

    // Labels
    ctx.font = '300 11px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'

    const positions = [
      legendTop,
      legendTop + legendHeight / 2,
      legendTop + legendHeight
    ]

    for (const [i, text] of textLabels.entries()) {
      if (text === undefined || text === null) {
        continue
      }

      const y = positions[i]
      const textMetrics = ctx.measureText(text)

      const pillWidth = Math.min(legendWidth, textMetrics.width + (pillPaddingX * 2))
      const pillLeft = legendLeft + (legendWidth - pillWidth) / 2
      const pillTop = y - (pillHeight / 2)

      ctx.fillStyle = 'rgba(255, 255, 255, 1.0)'
      ctx.strokeStyle = '#e2e8f0'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(pillLeft, pillTop, pillWidth, pillHeight, 10)
      ctx.fill()
      ctx.stroke()

      const textHeight = textMetrics.actualBoundingBoxAscent + textMetrics.actualBoundingBoxDescent
      const textY = pillTop + (pillHeight / 2) + (textHeight / 2) - textMetrics.actualBoundingBoxDescent

      ctx.fillStyle = '#000000'
      ctx.fillText(text, legendLeft + (legendWidth / 2), textY)
    }

    ctx.restore()
  }
}

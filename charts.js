import { getColour, palettes } from "./colourmap.js"
import { onSingleClick, nearest } from "./util.js"
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Title,
  SubTitle,
  Tooltip,
  Legend,
  Decimation
} from "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/+esm"
import zoomPlugin from 'https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.2.0/+esm'

// TODO: This whole file is messy and should be cleaned up
// but it is functional enough for the moment...

const continuousLegendPlugin = {
  id: 'continuousLegend',
  afterInit(chart, args, options) {
    const dataArray = chart.data.datasets
    if (!dataArray || dataArray.length === 0) {
      return
    }

    const allColours = dataArray.map(d => d.borderColor || d.backgroundColor)
    const labels = dataArray.map(d => d.label)

    if (options.cyclic && allColours.length > 0) {
      allColours.push(allColours[0])
      labels.push(options.cyclicMax)
    }

    const len = labels.length
    const textLabels = [
      labels[0],
      labels[Math.floor((len - 1) / 2)],
      labels[len - 1]
    ]

    const wrapper = document.createElement('div')
    const labelsOverlay = document.createElement('div')
    const colourBar = document.createElement('div')

    wrapper.className = 'legend'
    labelsOverlay.className = 'legend-labels-overlay'
    colourBar.className = 'legend-colour-bar'

    colourBar.style.background = `linear-gradient(to bottom, ${allColours.join(', ')})`

    textLabels.forEach(text => {
      const span = document.createElement('span')
      span.className = 'legend-label-pill'
      span.textContent = text
      labelsOverlay.appendChild(span)
    })

    wrapper.appendChild(labelsOverlay)
    wrapper.appendChild(colourBar)
    chart.canvas.parentNode.appendChild(wrapper)
  }
}

const PSDChartCtx = document.getElementById("chartPSD").getContext("2d")
let PSDChart = null

const PhaseProfileProfileCtx = document.getElementById("chartProfile").getContext("2d")
let PhaseProfileChart = null

const SinglePhaseChartCtx = document.getElementById("chartSinglePhase").getContext("2d")
let SinglePhaseChart = null

Chart.register(LineController, LineElement, PointElement, LinearScale, Title, SubTitle, Tooltip, Legend, Decimation, zoomPlugin)

function destroyChart (chart, ctx, message) {
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

export function renderPSD ({ xAxisData, datasets, dataType }, onclick = () => {}) {
  const styledDatasets = datasets.map((dataset, idx) => {
    const colour = getColour(palettes.roma, idx, datasets.length)
    return {
      ...dataset,
      borderColor: colour,
      backgroundColor: colour,
      pointRadius: 0,
      pointHoverRadius: 4,
      borderWidth: 1.5,
      fill: false,
      tension: 0
    }
  })

  if (!PSDChart) {
    PSDChart = new Chart(PSDChartCtx, {
      type: "line",
      data: {
        datasets: styledDatasets
      },
      options: {
        animation: false,
        spanGaps: true,
        normalized: true,
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: {
            right: 50
          }
        },
        interaction: {
          mode: "index",
          intersect: false
        },
        transitions: {
          zoom: {
            animation: {
              duration: 0
            }
          }
        },
        plugins: {
          legend: {
            display: false
          },
          continuousLegend: {
            cyclic: true,
            cyclicMax: '360°'
          },
          tooltip: {
            enabled: true,
            itemSort: function(a, b) {
              return b.parsed.y - a.parsed.y
            },
            callbacks: {
              title: function (context) {
                return `${context[0].chart.options.scales.x.title.text}: ${context[0].label}`
              },
              label: function (context) {
                const chart = context.chart
                const activeItems = chart.tooltip._active

                if (!chart._minMaxCache || chart._currentHoverX !== context.parsed.x) {
                  let minVal = Infinity, maxVal = -Infinity
                  let minDatasetIndex = 0, maxDatasetIndex = 0

                  for (let i = 0; i < activeItems.length; i++) {
                    const item = activeItems[i]
                    const val = chart.data.datasets[item.datasetIndex].data[item.index]
                    if (val < minVal) { minVal = val; minDatasetIndex = item.datasetIndex; }
                    if (val > maxVal) { maxVal = val; maxDatasetIndex = item.datasetIndex; }
                  }

                  chart._minMaxCache = { minVal, maxVal, minDatasetIndex, maxDatasetIndex }
                  chart._currentHoverX = context.parsed.x
                }

                const cache = chart._minMaxCache

                if (context.datasetIndex === cache.maxDatasetIndex) {
                  return `Max: ${context.dataset.label}`
                } else if (context.datasetIndex === cache.minDatasetIndex) {
                  return `Min: ${context.dataset.label}`
                }

                return null
              },
              labelColor: function (context) {
                return {
                  borderColor: context.dataset.borderColor,
                  backgroundColor: context.dataset.backgroundColor
                }
              }
            }
          },
          decimation: {
            enabled: true,
            algorithm: 'lttb',
            samples: 1000
          },
          zoom: {
            zoom: {
              drag: {
                enabled: true,
              },
              mode: 'x',
              scaleMode: 'x'
            }
          }
        },
        scales: {
          x: {
            type: "linear",
            labels: xAxisData,
            title: { display: true, text: dataType?.xlab },
            grid: {
              display: true,
              drawOnChartArea: false,
              drawTicks: true,
              color: '#ccc',
              tickLength: 6
            },
            border: { display: true, color: '#000', width: 1 },
            ticks: {
              display: true
            },
            afterTickToLabelConversion: function(scaleInstance) {
              const ticks = scaleInstance.ticks
              const newTicks = []

              for (let i = 0; i < ticks.length - 1; i++) {
                newTicks.push(ticks[i])
                const midValue = (ticks[i].value + ticks[i+1].value) / 2
                newTicks.push({ value: midValue, label: "" })
              }
              newTicks.push(ticks[ticks.length - 1])
              scaleInstance.ticks = newTicks
            }
          },
          y: {
            title: { display: true, text: dataType?.ylab },
            grid: {
              display: false
            },
            border: { display: true, color: '#000', width: 1 },
            ticks: {
              display: false
            }
          }
        }
      },
      plugins: [
        {
          id: 'box',
          afterDatasetsDraw (chart) {
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
        },
        {
          id: 'verticalHoverLine',
          afterDatasetsDraw (chart) {
            if (chart.tooltip?._active && chart.tooltip._active.length) {
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
        },
        continuousLegendPlugin
      ]
    })

    PSDChart.canvas.addEventListener('dblclick', () => {
      PSDChart.resetZoom('none')
    })

    // The native "click" event will still trigger on a double click
    // as we use this to reset the zoom, we should ignore double clicks
    onSingleClick(PSDChart.canvas, (event) => {
      const rect = PSDChart.canvas.getBoundingClientRect()
      const canvasX = event.clientX - rect.left
      const canvasY = event.clientY - rect.top

      if (
        canvasX >= PSDChart.chartArea.left &&
        canvasX <= PSDChart.chartArea.right &&
        canvasY >= PSDChart.chartArea.top &&
        canvasY <= PSDChart.chartArea.bottom
      ) {
        const clickedX = PSDChart.scales.x.getValueForPixel(canvasX)

        const nearestIndex = nearest(xAxisData, clickedX)
        if (nearestIndex === -1) {
          return
        }

        const snappedX = xAxisData[nearestIndex].x !== undefined
          ? xAxisData[nearestIndex].x
          : xAxisData[nearestIndex]


        onclick(snappedX, nearestIndex)
      }
    })
  } else {
    PSDChart.data.datasets = styledDatasets
    PSDChart.options.scales.x.labels = xAxisData
    PSDChart.update("none")
  }
}

export function renderPhaseProfile ({ intensities, phaseAngles, selectedX }) {
  let minVal = Infinity
  let maxVal = -Infinity
  let minIdx = 0
  let maxIdx = 0

  for (let i = 0; i < intensities.length; i++) {
    const val = intensities[i]
    if (val < minVal) {
      minVal = val
      minIdx = i
    }
    if (val > maxVal) {
      maxVal = val
      maxIdx = i
    }
  }

  const pointRadii = new Array(intensities.length).fill(0)
  const pointHoverRadii = new Array(intensities.length).fill(0)
  const pointBgColours = new Array(intensities.length).fill("transparent")
  const pointBorderColours = new Array(intensities.length).fill("transparent")

  // Max
  pointRadii[maxIdx] = 6
  pointHoverRadii[maxIdx] = 8
  pointBgColours[maxIdx] = "#d95f02"
  pointBorderColours[maxIdx] = "#000"

  // Min
  pointRadii[minIdx] = 6
  pointHoverRadii[minIdx] = 8
  pointBgColours[minIdx] = "#7570b3"
  pointBorderColours[minIdx] = "#000"

  const chartDataPoints = []
  for (let i = 0; i < intensities.length; i++) {
    chartDataPoints.push({
      x: phaseAngles[i],
      y: intensities[i]
    })
  }

  const dataset = {
    label: null,
    borderColor: "#1b9e77",
    borderWidth: 2,
    fill: false,
    tension: 0.2,
    data: chartDataPoints,

    pointRadius: pointRadii,
    pointHoverRadius: pointHoverRadii,
    pointBackgroundColor: pointBgColours,
    pointBorderColor: pointBorderColours,
    pointBorderWidth: 1.5
  }

  const titleText = `r = ${selectedX} Å`
  const subtitleText = `Min: ${phaseAngles[minIdx]}° | Max: ${phaseAngles[maxIdx]}°`

  if (!PhaseProfileChart) {
    PhaseProfileChart = new Chart(PhaseProfileProfileCtx, {
      type: "line",
      data: {
        datasets: [dataset]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: titleText,
            font: { size: 14, weight: "bold" }
          },
          subtitle: {
            display: true,
            text: subtitleText,
            font: { size: 12, style: "italic" },
            padding: { bottom: 10 }
          },
          tooltip: { enabled: false }
        },
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: "Phase / Degrees (°)" },
            min: 0,
            max: 360,
            grid: {
              display: true,
              drawOnChartArea: false,
              drawTicks: true,
              color: "#ccc",
              tickLength: 6
            },
            border: { display: true, color: "#000", width: 1 },
            ticks: {
              display: true,
              stepSize: 45
            },
            afterTickToLabelConversion: function(scaleInstance) {
              const ticks = scaleInstance.ticks
              const newTicks = []
              for (let i = 0; i < ticks.length - 1; i++) {
                newTicks.push(ticks[i])
                const midValue = (ticks[i].value + ticks[i + 1].value) / 2
                newTicks.push({ value: midValue, label: "" })
              }
              if (ticks.length > 0) {
                newTicks.push(ticks[ticks.length - 1])
              }
              scaleInstance.ticks = newTicks
            }
          },
          y: {
            title: { display: true, text: "Intensity" },
            grid: { display: false },
            border: { display: true, color: "#000", width: 1 },
            ticks: { display: false }
          }
        }
      },
      plugins: [{
        id: "box",
        afterDatasetsDraw(chart) {
          const { ctx, chartArea: { left, top, right, bottom } } = chart
          ctx.save()
          ctx.strokeStyle = "#000"
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(left, top)
          ctx.lineTo(right, top)
          ctx.lineTo(right, bottom)
          ctx.stroke()
          ctx.restore()
        }
      }]
    })
  } else {
    PhaseProfileChart.data.datasets[0] = dataset
    PhaseProfileChart.options.plugins.title.text = titleText
    PhaseProfileChart.options.plugins.subtitle.text = subtitleText
    PhaseProfileChart.update("none")
  }
}

export function renderSinglePhase ({ xAxisData, yAxisData, targetPhase, dataType }) {
  const dataset = {
    label: '',
    borderColor: "#000",
    backgroundColor: "#000",
    pointRadius: 0,
    pointHoverRadius: 4,
    borderWidth: 1.5,
    fill: false,
    tension: 0,
    data: yAxisData
  }

  const titleText = `θ = ${targetPhase}°`

  if (!SinglePhaseChart) {
    SinglePhaseChart = new Chart(SinglePhaseChartCtx, {
      type: "line",
      data: { datasets: [dataset] },
      options: {
        animation: false,
        spanGaps: true,
        normalized: true,
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: "index",
          intersect: false
        },
        transitions: {
          zoom: {
            animation: {
              duration: 0
            }
          }
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            enabled: true
          },
          title: {
            display: true,
            text: titleText,
            font: { size: 14, weight: "bold" }
          },
          zoom: {
            zoom: {
              drag: {
                enabled: true,
              },
              mode: 'x',
              scaleMode: 'x'
            }
          }
        },
        scales: {
          x: {
            type: "linear",
            labels: xAxisData,
            title: { display: true, text: dataType?.xlab },
            grid: {
              display: true,
              drawOnChartArea: false,
              drawTicks: true,
              color: '#ccc',
              tickLength: 6
            },
            border: { display: true, color: '#000', width: 1 },
            ticks: {
              display: true
            },
            afterTickToLabelConversion: function(scaleInstance) {
              const ticks = scaleInstance.ticks
              const newTicks = []

              for (let i = 0; i < ticks.length - 1; i++) {
                newTicks.push(ticks[i])
                const midValue = (ticks[i].value + ticks[i+1].value) / 2
                newTicks.push({ value: midValue, label: "" })
              }
              newTicks.push(ticks[ticks.length - 1])
              scaleInstance.ticks = newTicks
            }
          },
          y: {
            title: { display: true, text: dataType?.ylab },
            grid: {
              display: false
            },
            border: { display: true, color: '#000', width: 1 },
            ticks: {
              display: false
            }
          }
        }
      },
      plugins: [
        {
          id: 'box',
          afterDatasetsDraw (chart) {
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
        },
        {
          id: 'verticalHoverLine',
          afterDatasetsDraw (chart) {
            if (chart.tooltip?._active && chart.tooltip._active.length) {
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
        }
      ]
    })

    SinglePhaseChart.canvas.addEventListener('dblclick', () => {
      SinglePhaseChart.resetZoom('none')
    })
  } else {
    SinglePhaseChart.data.datasets = [dataset]
    SinglePhaseChart.options.plugins.title.text = titleText
    SinglePhaseChart.options.scales.x.labels = xAxisData
    SinglePhaseChart.update("none")
  }
}

export function destroyPSD () {
  destroyChart(
    PSDChart,
    PSDChartCtx,
    "Import files and run PSD to view the phase resolved data"
  )
  PhaseProfileChart = null
}

export function destroyPhaseProfile () {
  destroyChart(
    PhaseProfileChart,
    PhaseProfileProfileCtx,
    "Click on a data point on the main PSD chart to inspect its phase profile"
  )
  PhaseProfileChart = null
}

export function destroySinglePhase () {
  destroyChart(
    SinglePhaseChart,
    SinglePhaseChartCtx,
    "Click on a data point on the main PSD chart to show the data that is in phase at that point"
  )
  SinglePhaseChart = null
}

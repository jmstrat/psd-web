import { getColour, palettes } from "./colourmap.js"
import { createBaseChart } from "./base-chart.js"
import { destroyChart } from './util.js'

const PSDChartCtx = document.getElementById("chartPSD").getContext("2d")
let PSDChart = null

export function renderPSD ({ xAxisData, datasets, dataType }, onclick) {
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
    PSDChart = createBaseChart(
      PSDChartCtx,
      {
        data: {
          datasets: styledDatasets
        },
        options: {
          layout: {
            padding: {
              right: 50
            }
          },
          plugins: {
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
            }
          },
          scales: {
            x: {
              title: { display: true, text: dataType?.xlab },
              labels: xAxisData
            },
            y: {
              title: { display: true, text: dataType?.ylab }
            }
          }
        },
        plugins: [
          {
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
        ]
      },
      onclick
    )
  } else {
    PSDChart.data.datasets = styledDatasets
    PSDChart.options.scales.x.labels = xAxisData
    PSDChart.options.scales.x.title.text = dataType?.xlab
    PSDChart.options.scales.y.title.text = dataType?.ylab
    PSDChart.update("none")
  }
}

export function destroyPSD () {
  destroyChart(
    PSDChart,
    PSDChartCtx,
    "Import files and run PSD to view the phase resolved data"
  )
  PSDChart = null
}

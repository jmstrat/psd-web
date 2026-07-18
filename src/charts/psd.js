import { getColour, palettes } from "./colourmap.js"
import { createBaseChart } from "./base-chart.js"
import { destroyChart, axisLabel } from './util.js'
import { gradientLegend } from './gradient-legend.js'

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
              right: 55
            }
          },
          plugins: {
            gradientLegend: {
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
              title: { display: true, text: axisLabel(dataType.x) },
              labels: xAxisData
            },
            y: {
              title: { display: true, text: axisLabel(dataType.y) }
            }
          }
        },
        plugins: [ gradientLegend ]
      },
      onclick
    )
  } else {
    PSDChart.data.datasets = styledDatasets
    PSDChart.options.scales.x.labels = xAxisData
    PSDChart.options.scales.x.title.text = axisLabel(dataType.x)
    PSDChart.options.scales.y.title.text = axisLabel(dataType.y)
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

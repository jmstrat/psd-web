import { createBaseChart } from "./base-chart.js"
import { destroyChart, axisLabel, hoverCrosshair } from './util.js'

const InPhaseChartCtx = document.getElementById("chartInPhase").getContext("2d")
let InPhaseChart = null

export function renderInPhase ({ mode, xAxisData, yAxisData, dataType }, { onzoom }) {
  const dataset = {
    label: '',
    backgroundColor: "#000",
    pointRadius: 2,
    pointHoverRadius: 4,
    data: yAxisData
  }

  const y_axis = mode === 'psd' ? {
    title: { display: true, text: 'In Phase Angle / °' },
    min: 0,
    max: 360,
    ticks: {
      stepSize: 45,
      display: true
    }
  } : {
    title: { display: true, text: 'Time at Maximum Intensity / s' }
  }

  if (!InPhaseChart) {
    InPhaseChart = createBaseChart(
      InPhaseChartCtx,
      {
        type: 'scatter',
        data: { datasets: [dataset] },
        options: {
          layout: {
            padding: {
              right: 55
            }
          },
          plugins: {
            tooltip: {
              enabled: true
            },
            zoom: { zoom: { onZoom: onzoom }}
          },
          scales: {
            x: {
              labels: xAxisData,
              title: { display: true, text: axisLabel(dataType.x) }
            },
            y: y_axis
          }
        },
        plugins: [hoverCrosshair]
      }
    )
  } else {
    InPhaseChart.data.datasets = [dataset]
    InPhaseChart.options.scales.x.labels = xAxisData
    InPhaseChart.options.scales.x.title.text = axisLabel(dataType.x)
    InPhaseChart.options.scales.y = y_axis
    InPhaseChart.update("none")
  }
}

export function zoomInPhase (min, max) {
  if (!InPhaseChart) {
    return
  }
  InPhaseChart.options.scales.x.min = min
  InPhaseChart.options.scales.x.max = max
  InPhaseChart.update('none')
}

export function destroyInPhase () {
  destroyChart(
    InPhaseChart,
    InPhaseChartCtx,
    "Import files and run PSD to view the in phase angles"
  )
  InPhaseChart = null
}

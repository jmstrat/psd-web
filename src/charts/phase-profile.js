import { createBaseChart } from "./base-chart.js"
import { destroyChart } from './util.js'

const PhaseProfileProfileCtx = document.getElementById("chartProfile").getContext("2d")
let PhaseProfileChart = null

export function renderPhaseProfile ({ intensities, phaseAngles, selectedX, dataType }, onclick) {
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
    pointBorderWidth: 1.5,
    clip: false
  }

  const titleVal = Number(selectedX.toPrecision(3))

  let titleText = `${dataType.x.label} = ${titleVal}`
  if (dataType.x.unit) {
    titleText += ` ${dataType.x.unit}`
  }
  const subtitleText = `Min: ${phaseAngles[minIdx]}° | Max: ${phaseAngles[maxIdx]}°`

  if (!PhaseProfileChart) {
    PhaseProfileChart = createBaseChart(
      PhaseProfileProfileCtx,
      {
        data: {
          datasets: [dataset]
        },
        options: {
          plugins: {
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
            tooltip: {
              enabled: true,
              displayColors: false,
              callbacks: {
                title: function (context) {
                  const xValue = context[0].label
                  return `${xValue}°`
                },
                label: function() {
                  return null
                }
              }
            },
            zoom: {
              zoom: {
                drag: { enabled: false }
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: "Phase / Degrees (°)" },
              min: 0,
              max: 360,
              ticks: {
                stepSize: 45
              }
            },
            y: {
              title: { display: true, text: "Intensity" },
            }
          }
        }
      },
      onclick
    )
  } else {
    PhaseProfileChart.data.datasets[0] = dataset
    PhaseProfileChart.options.plugins.title.text = titleText
    PhaseProfileChart.options.plugins.subtitle.text = subtitleText
    PhaseProfileChart.update("none")
  }
}

export function destroyPhaseProfile () {
  destroyChart(
    PhaseProfileChart,
    PhaseProfileProfileCtx,
    "Click on a data point on the main PSD chart to inspect its phase profile"
  )
  PhaseProfileChart = null
}

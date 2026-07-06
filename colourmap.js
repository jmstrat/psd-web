// https://www.fabiocrameri.ch/cycliccolourmaps/
const ROMA_COLORS = [
  "#7e1e10", "#963d1a", "#ab5c25", "#bd7b32", "#cc9a42",
  "#d6b856", "#dbd46e", "#cbdc8a", "#aedca5", "#8ad6bd",
  "#62ccce", "#39bcda", "#19a3e2", "#1383df", "#1f5fd2", "#2a32b2"
]

export function getColour (palette, index, total) {
  if (!palette || palette.length === 0) {
    return "#000000"
  }

  if (palette.length === 1 || total <= 1) {
    return palette[0]
  }

  const normalizedIndex = ((index % total) + total) % total

  const factor = normalizedIndex / total
  const rawPosition = factor * palette.length

  const baseIndex = Math.floor(rawPosition)
  const nextIndex = (baseIndex + 1) % palette.length

  const weight = rawPosition - baseIndex

  const parseHex = (hex) => {
    const num = parseInt(hex.replace("#", ""), 16)
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
  }

  const [r0, g0, b0] = parseHex(palette[baseIndex])
  const [r1, g1, b1] = parseHex(palette[nextIndex])

  const r = Math.round(r0 + (r1 - r0) * weight)
  const g = Math.round(g0 + (g1 - g0) * weight)
  const b = Math.round(b0 + (b1 - b0) * weight)

  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

export const palettes = {
  roma: ROMA_COLORS
}

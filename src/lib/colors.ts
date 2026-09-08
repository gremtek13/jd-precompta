// Utilitaires minimalistes de manipulation de couleur — servent uniquement à dériver automatiquement
// une teinte "survol" et une teinte "douce" (fond de badge) à partir de la seule couleur d'accent
// choisie par un cabinet (voir CabinetBrandingPage) : pas question de demander à quelqu'un de non
// technique de régler trois couleurs cohérentes entre elles alors qu'une seule a un sens pour lui.

function hexVersRgb(hex: string): [number, number, number] | null {
  const nettoye = hex.trim().replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(nettoye)) return null
  return [parseInt(nettoye.slice(0, 2), 16), parseInt(nettoye.slice(2, 4), 16), parseInt(nettoye.slice(4, 6), 16)]
}

function rgbVersHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export function estCouleurHexValide(hex: string): boolean {
  return hexVersRgb(hex) !== null
}

// Mélange vers le blanc (ratio 0 = couleur d'origine, 1 = blanc pur) — sert de fond pour les badges et
// zones "douces" (voir --color-primary-light).
export function eclaircir(hex: string, ratio: number): string {
  const rgb = hexVersRgb(hex)
  if (!rgb) return hex
  const [r, g, b] = rgb
  return rgbVersHex(r + (255 - r) * ratio, g + (255 - g) * ratio, b + (255 - b) * ratio)
}

// Mélange vers le noir — sert d'état "survol" (voir --color-primary-hover).
export function assombrir(hex: string, ratio: number): string {
  const rgb = hexVersRgb(hex)
  if (!rgb) return hex
  const [r, g, b] = rgb
  return rgbVersHex(r * (1 - ratio), g * (1 - ratio), b * (1 - ratio))
}

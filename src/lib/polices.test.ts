import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { POLICES_CABINET, chargerPoliceCabinet, estPoliceCabinet } from './polices'

// Les polices de l'application, servies par elle-même.
//
// Pourquoi ce test existe. Jusqu'au 25/09/2026, `index.html` demandait Manrope et Inter à Google
// Fonts, et la charte d'un cabinet y demandait sa police : chaque ouverture de l'application envoyait
// l'adresse IP de l'utilisateur — clients compris — à un destinataire absent du registre RGPD, par
// un appel externe fait au chargement. RGPD.md affirmait pourtant qu'« aucun appel réseau externe
// n'est silencieux dans cette application ». Rien ne le vérifiait : le premier `<link>` ajouté par
// commodité le rendait faux sans que personne s'en aperçoive.
//
// Il garde trois choses : qu'aucune source livrée ne nomme plus un hôte de Google Fonts, que chaque
// police proposée aux cabinets se charge depuis les paquets du projet, et que le point d'entrée
// importe les graisses que l'interface emploie.

const HOTES_GOOGLE_FONTS = /fonts\.(googleapis|gstatic)\.com/

const racine = (chemin: string) => new URL(`../../${chemin}`, import.meta.url)

/** Ce que le navigateur reçoit : `index.html`, les sources de `src/` hors tests, et `public/`. */
function sourcesLivrees(): Map<string, string> {
  const texte = /\.(ts|tsx|css|html|js|json|webmanifest|svg)$/
  const sources = new Map<string, string>([['index.html', readFileSync(racine('index.html'), 'utf8')]])
  for (const f of readdirSync(racine('src/'), { recursive: true }) as string[]) {
    if (texte.test(f) && !/\.test\.tsx?$/.test(f)) sources.set(`src/${f}`, readFileSync(racine(`src/${f}`), 'utf8'))
  }
  for (const f of readdirSync(racine('public/'), { recursive: true }) as string[]) {
    if (texte.test(f)) sources.set(`public/${f}`, readFileSync(racine(`public/${f}`), 'utf8'))
  }
  return sources
}

describe('polices servies par l’application', () => {
  it('ne demande plus rien à Google Fonts, nulle part', () => {
    const sources = sourcesLivrees()
    // Le plancher : les trois fichiers qui appelaient Google, et un de `public/`, sont bien dans le
    // balayage, sans quoi « aucun appel » serait aussi ce que rend un balayage qui ne lit rien.
    for (const f of ['index.html', 'src/main.tsx', 'src/lib/branding.ts', 'public/manifest.webmanifest']) expect([...sources.keys()]).toContain(f)
    expect(HOTES_GOOGLE_FONTS.test('<link href="https://fonts.googleapis.com/css2?family=X">')).toBe(true)
    const fautes = [...sources].filter(([, texte]) => HOTES_GOOGLE_FONTS.test(texte)).map(([f]) => f)
    expect(fautes).toEqual([])
  })

  it('charge chaque police proposée aux cabinets depuis les paquets du projet', async () => {
    expect(POLICES_CABINET.length).toBeGreaterThan(0)
    for (const { nom } of POLICES_CABINET) await expect(chargerPoliceCabinet(nom), nom).resolves.toBe(true)
  })

  it('ne charge rien pour un nom hors de la liste', async () => {
    expect(estPoliceCabinet('')).toBe(false)
    expect(estPoliceCabinet('Comic Sans MS')).toBe(false)
    await expect(chargerPoliceCabinet('Comic Sans MS')).resolves.toBe(false)
  })

  it('importe au point d’entrée les graisses de l’interface, pour les deux polices par défaut', () => {
    const entree = readFileSync(racine('src/main.tsx'), 'utf8')
    const graisses = (police: string) =>
      [...entree.matchAll(new RegExp(`^import '@fontsource/${police}/(\\d{3})\\.css'$`, 'gm'))].map((m) => m[1]).sort()
    // Celles que Google servait, et celles qu'emploient index.css et les écrans : 400 à 800.
    expect(graisses('manrope')).toEqual(['400', '500', '600', '700', '800'])
    expect(graisses('inter')).toEqual(['400', '500', '600', '700', '800'])
  })
})

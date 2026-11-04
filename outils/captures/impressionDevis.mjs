// L'IMPRESSION D'UN DEVIS, MESURÉE SUR UN VRAI PDF (étape P6b ; modèle : impressionFacture.mjs) : l'aperçu d'un devis du banc
// ouvert dans Chromium, puis `page.pdf()` en A4 sous le média d'impression — le document que « Imprimer / Enregistrer en PDF »
// produit. Les devis attendent leur migration : le banc lève leur drapeau (BANC_DRAPEAUX, vite.config.ts).
//
//   BANC_DRAPEAUX=DEVIS_EXPORTES npx vite --config outils/captures/vite.config.ts   # sert l'application sur 127.0.0.1:5199
//   node outils/captures/impressionDevis.mjs [numéro ou « Brouillon »] [dossier]    # défaut : D2026-0001 du dossier d1
//
// Le PDF et une capture de l'aperçu vont dans outils/captures/sorties/ ; `pdftotext -layout` en relit le texte, qui ne doit
// porter ni « Fermer », ni « Imprimer », ni la barre de l'application. Même piège que vitrine.mjs : le navigateur ne reçoit PAS
// le mandataire de l'environnement, toute requête externe est coupée.
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:5199/'
const SORTIE = new URL('./sorties/', import.meta.url).pathname
mkdirSync(SORTIE, { recursive: true })
const RACINE = '/opt/pw-browsers'
const revision = existsSync(RACINE) ? readdirSync(RACINE).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined
const executable = process.env.CHROMIUM ?? (revision ? `${RACINE}/${revision}/chrome-linux/chrome` : undefined)

const numero = process.argv[2] ?? 'D2026-0001'
const dossier = process.argv[3] ?? 'd1'
const navigateur = await chromium.launch({ executablePath: executable })
const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 } })
await contexte.addInitScript(() => localStorage.setItem('jd-precompta-theme', 'light'))
const externes = []
await contexte.route(/^https?:\/\//, (route) => {
  const url = route.request().url()
  if (url.startsWith(BASE)) return route.continue()
  externes.push(url.slice(0, 80))
  return route.abort()
})
const page = await contexte.newPage()
const erreurs = []
page.on('pageerror', (e) => erreurs.push(String(e)))
await page.goto(`${BASE}#/dossiers/${dossier}/factures`, { waitUntil: 'load' })
await page.waitForTimeout(1500)
await page.getByRole('tab', { name: 'Devis', exact: true }).click()
await page.waitForTimeout(800)
await page.locator('tr', { hasText: numero }).first().getByRole('button', { name: 'Aperçu', exact: true }).click()
await page.waitForTimeout(800)
await page.evaluate(() => document.fonts.ready)
const fichier = numero.replace(/[^\w-]/g, '_')
await page.screenshot({ path: `${SORTIE}apercu-devis-${fichier}.png`, fullPage: true })
await page.emulateMedia({ media: 'print' })
await page.pdf({ path: `${SORTIE}impression-devis-${fichier}.pdf`, format: 'A4', printBackground: true })
// Sous le média d'impression : ce qui reste VISIBLE de la page (boutons, barres, avis de l'écran).
const visibles = await page.evaluate(() => {
  const vu = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
  return {
    boutons: [...document.querySelectorAll('button')].filter(vu).map((b) => b.textContent),
    barres: [...document.querySelectorAll('nav, header, aside, .sidebar')].filter(vu).length,
    avis: [...document.querySelectorAll('.facture-imprimable-avis')].filter(vu).length,
  }
})
console.log(numero, '—', `boutons imprimés : ${visibles.boutons.length ? visibles.boutons.join(', ') : 'aucun'}`, '—',
  `barres imprimées : ${visibles.barres}`, '—', `avis de l’écran imprimés : ${visibles.avis}`, '—',
  erreurs.length ? erreurs.slice(0, 3) : 'sans erreur', '—',
  externes.length ? `requêtes externes coupées : ${externes.slice(0, 3).join(', ')}` : 'aucune requête externe')
await navigateur.close()

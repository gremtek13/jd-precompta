// L'IMPRESSION D'UNE FACTURE, MESURÉE SUR UN VRAI PDF (étape A7b) : l'aperçu d'une facture du banc ouvert dans Chromium, puis
// `page.pdf()` en A4 sous le média d'impression — le document que « Imprimer / Enregistrer en PDF » produit.
//
//   npx vite --config outils/captures/vite.config.ts                # sert l'application sur 127.0.0.1:5199
//   node outils/captures/impressionFacture.mjs [numéro] [dossier]   # défaut : F2026-0015 du dossier d1, la facture figée
//
// Le PDF et une capture de l'écran de l'aperçu vont dans outils/captures/sorties/ ; `pdftotext -layout` en relit le texte.
// Même piège que vitrine.mjs : le navigateur ne reçoit PAS le mandataire de l'environnement, toute requête externe est coupée.
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:5199/'
const SORTIE = new URL('./sorties/', import.meta.url).pathname
mkdirSync(SORTIE, { recursive: true })
const RACINE = '/opt/pw-browsers'
const revision = existsSync(RACINE) ? readdirSync(RACINE).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined
const executable = process.env.CHROMIUM ?? (revision ? `${RACINE}/${revision}/chrome-linux/chrome` : undefined)

const numero = process.argv[2] ?? 'F2026-0015'
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
await page.locator('tr', { hasText: numero }).getByRole('button', { name: 'Aperçu', exact: true }).click()
await page.waitForTimeout(1200)
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: `${SORTIE}apercu-${numero}.png`, fullPage: true })
await page.emulateMedia({ media: 'print' })
await page.pdf({ path: `${SORTIE}impression-${numero}.pdf`, format: 'A4', printBackground: true })
const logo = await page.locator('.facture-logo').count()
const avis = await page.locator('.facture-imprimable-avis').count()
console.log(numero, '—', `logo affiché : ${logo}`, '—', `avis de l’écran : ${avis}`, '—', erreurs.length ? erreurs.slice(0, 3) : 'sans erreur',
  '—', externes.length ? `requêtes externes coupées : ${externes.slice(0, 3).join(', ')}` : 'aucune requête externe')
await navigateur.close()

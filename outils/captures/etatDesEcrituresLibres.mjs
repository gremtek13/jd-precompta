// L'ÉTAT DES ÉCRITURES LIBRES, TÉLÉCHARGÉ DANS UN VRAI NAVIGATEUR (RA253-Q1 (A), 26/11/2026) : sur la kinésithérapeute (d9, voir
// ecrituresLibres.mjs), EL2025-0001 contre-passée au 1er janvier 2026 par l'écran, puis l'état de 2025 et celui de 2026 téléchargés
// en CSV et en PDF par leurs boutons, tels que le navigateur les enregistre. Le CSV est relu ; le PDF, relu par `pdftotext -layout`
// et rendu en images par `pdftoppm` (poppler-utils), à REGARDER : la mention « Contre-passe EL… du … » / « Contre-passée par EL… du
// … » doit s'y lire entière, sur une ligne, sans déborder de la page.
//
//   npx vite --config outils/captures/vite.config.ts        # sert l'application sur 127.0.0.1:5199
//   node outils/captures/etatDesEcrituresLibres.mjs         # fichiers et images dans outils/captures/sorties/etat-ecritures-libres/
//
// Même piège que vitrine.mjs : le navigateur ne reçoit PAS le mandataire de l'environnement, toute requête externe est coupée.
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { contrePassationFaite, ecrituresFigeesOuvertes } from './ecrituresLibres.mjs'

const BASE = 'http://127.0.0.1:5199/'
const SORTIE = new URL('./sorties/etat-ecritures-libres/', import.meta.url).pathname
mkdirSync(SORTIE, { recursive: true })
const RACINE = '/opt/pw-browsers'
const revision = existsSync(RACINE) ? readdirSync(RACINE).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined
const executable = process.env.CHROMIUM ?? (revision
  ? ['chrome-linux', 'chrome-linux64'].map((d) => `${RACINE}/${revision}/${d}/chrome`).find((f) => existsSync(f))
  : undefined)

// Ce que chaque état doit dire de la contre-passation : la mention sous l'écriture, et son exercice.
const ATTENDUS = {
  2025: ['Contre-passée par EL2026-0001 du 01/01/2026'],
  2026: ['Contre-passe EL2025-0001 du 30/06/2025'],
}

const navigateur = await chromium.launch({ executablePath: executable })
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
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
await page.goto(`${BASE}#/dossiers/d9/checklist`, { waitUntil: 'load' })
await page.waitForTimeout(1000)
await contrePassationFaite(page)

let fautes = 0
for (const exercice of ['2025', '2026']) {
  const section = await ecrituresFigeesOuvertes(page, exercice)
  for (const format of ['CSV', 'PDF']) {
    const attente = page.waitForEvent('download', { timeout: 15000 })
    await section.getByRole('button', { name: `État des écritures libres (${format})`, exact: true }).click()
    const telechargement = await attente
    const chemin = `${SORTIE}${telechargement.suggestedFilename()}`
    await telechargement.saveAs(chemin)
    let texte
    if (format === 'CSV') {
      texte = readFileSync(chemin, 'utf8')
    } else {
      texte = execFileSync('pdftotext', ['-layout', chemin, '-'], { encoding: 'utf8' })
      execFileSync('pdftoppm', ['-png', '-r', '110', chemin, chemin.replace(/\.pdf$/, '')])
    }
    for (const mention of ATTENDUS[exercice]) {
      // Dans le PDF, la mention se lit sur UNE ligne : une coupe la séparerait en deux lignes du texte relu.
      const lue = format === 'CSV' ? texte.includes(mention) : texte.split('\n').some((l) => l.includes(mention))
      if (!lue) fautes += 1
      console.log(`${exercice} ${format} — ${telechargement.suggestedFilename()} — « ${mention} » ${lue ? 'lue' : 'ABSENTE'}`)
    }
  }
}
console.log(erreurs.length ? `erreurs de la page : ${erreurs.slice(0, 3).join(' | ')}` : 'sans erreur de la page',
  '—', externes.length ? `requêtes externes coupées : ${externes.slice(0, 3).join(', ')}` : 'aucune requête externe')
console.log(`${fautes} mention(s) absente(s)`)
await navigateur.close()
process.exitCode = fautes === 0 && erreurs.length === 0 ? 0 : 1

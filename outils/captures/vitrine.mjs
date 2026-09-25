// Captures de la vraie application (faux Supabase, données fictives) — la vérification visuelle à
// rejouer après toute modification de src/index.css ou de la coque (Layout, barre latérale).
//
//   npx vite --config outils/captures/vite.config.ts        # sert l'application sur 127.0.0.1:5199
//   npm i --no-save playwright-core@1.56.1                   # hors package.json : outil, pas dépendance
//   node outils/captures/vitrine.mjs [filtre]                # images dans outils/captures/sorties/
//
// PIÈGE, payé une fois : ne pas donner au navigateur le mandataire de l'environnement (HTTPS_PROXY).
// Il y enverrait AUSSI le serveur local, et la capture montrerait la page d'erreur du relais au lieu
// de l'application. Les polices Google passent donc par curl, qui utilise le mandataire, et sont
// servies au navigateur par interception ; toute autre requête externe est coupée.
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:5199/'
const SORTIE = new URL('./sorties/', import.meta.url).pathname
mkdirSync(SORTIE, { recursive: true })

// Le Chromium préinstallé de l'environnement, quelle que soit sa révision.
const RACINE_NAVIGATEURS = '/opt/pw-browsers'
const revision = existsSync(RACINE_NAVIGATEURS)
  ? readdirSync(RACINE_NAVIGATEURS).filter((d) => /^chromium-\d+$/.test(d)).sort().pop()
  : undefined
const executable = process.env.CHROMIUM ?? (revision ? `${RACINE_NAVIGATEURS}/${revision}/chrome-linux/chrome` : undefined)

const filtre = process.argv[2] ?? ''
const VUES = [
  { nom: 'pc-dossier-clair', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'light', reduite: false },
  { nom: 'pc-dossier-sombre', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'dark', reduite: false },
  { nom: 'pc-reduite-clair', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: true },
  { nom: 'pc-tableau-clair', chemin: '#/dossiers', l: 1280, h: 800, theme: 'light', reduite: false },
  { nom: 'mobile-dossier-clair', chemin: '#/dossiers/d1/pieces', l: 390, h: 844, theme: 'light', reduite: false },
  { nom: 'mobile-tableau-clair', chemin: '#/dossiers', l: 390, h: 844, theme: 'light', reduite: false },
  // Panneau de droite ouvert (l'assistant) : large, étroit (le volet passe PAR-DESSUS), sombre, mobile.
  { nom: 'pc-assistant-clair', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Assistant' },
  { nom: 'pc-assistant-sombre', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'dark', reduite: false, clic: 'Assistant' },
  { nom: 'pc-assistant-1280', chemin: '#/dossiers/d1/banque', l: 1280, h: 800, theme: 'light', reduite: false, clic: 'Assistant' },
  { nom: 'pc-assistant-1024', chemin: '#/dossiers/d1/pieces', l: 1024, h: 768, theme: 'light', reduite: false, clic: 'Assistant' },
  { nom: 'mobile-assistant-clair', chemin: '#/dossiers/d1/pieces', l: 390, h: 844, theme: 'light', reduite: false, clic: "Ouvrir l'assistant" },
].filter((v) => v.nom.includes(filtre))

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
const cache = new Map()
function viaCurl(url) {
  if (!cache.has(url)) cache.set(url, execFileSync('curl', ['-sS', '--max-time', '30', '-A', UA, url]))
  return cache.get(url)
}

const navigateur = await chromium.launch({ executablePath: executable })
for (const v of VUES) {
  const contexte = await navigateur.newContext({ viewport: { width: v.l, height: v.h } })
  await contexte.addInitScript(({ theme, reduite }) => {
    localStorage.setItem('jd-precompta-theme', theme)
    localStorage.setItem('jd-precompta-barre-reduite', reduite ? '1' : '0')
  }, { theme: v.theme, reduite: v.reduite })
  await contexte.route(/^https?:\/\//, (route) => {
    const url = route.request().url()
    if (url.startsWith(BASE)) return route.continue()
    if (/fonts\.(googleapis|gstatic)\.com/.test(url)) {
      const type = url.includes('googleapis') ? 'text/css' : 'font/woff2'
      return route.fulfill({ status: 200, body: viaCurl(url), contentType: type, headers: { 'access-control-allow-origin': '*' } })
    }
    return route.abort()
  })
  const page = await contexte.newPage()
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 160)) })
  await page.goto(BASE + v.chemin, { waitUntil: 'load' })
  await page.waitForTimeout(1500)
  if (v.clic) {
    await page.getByRole('button', { name: v.clic, exact: true }).click()
    await page.waitForTimeout(600)
  }
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${SORTIE}${v.nom}.png` })
  const police = await page.evaluate(() => (document.fonts.check('16px Manrope') ? 'Manrope chargée' : 'Manrope ABSENTE'))
  console.log(v.nom, '—', police, '—', erreurs.length ? erreurs.slice(0, 3) : 'sans erreur')
  await contexte.close()
}
await navigateur.close()

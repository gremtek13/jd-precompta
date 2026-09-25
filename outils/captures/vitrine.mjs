// Captures de la vraie application (faux Supabase, données fictives) — la vérification visuelle à
// rejouer après toute modification de src/index.css ou de la coque (Layout, barre latérale).
//
//   npx vite --config outils/captures/vite.config.ts        # sert l'application sur 127.0.0.1:5199
//   npm i --no-save playwright-core@1.56.1                   # hors package.json : outil, pas dépendance
//   node outils/captures/vitrine.mjs [filtre]                # images dans outils/captures/sorties/
//
// PIÈGE, payé une fois : ne pas donner au navigateur le mandataire de l'environnement (HTTPS_PROXY).
// Il y enverrait AUSSI le serveur local, et la capture montrerait la page d'erreur du relais au lieu
// de l'application. Toute requête externe est donc coupée — et NOMMÉE dans le compte rendu : depuis
// que les polices sont servies par l'application (25/09/2026), il n'y en a aucune, et « Manrope
// chargée » le prouve à chaque vue. Les polices passaient avant par curl, venant de Google.
import { chromium } from 'playwright-core'
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

// Le Chromium du banc se présente comme « HeadlessChrome », que la barre latérale ne reconnaît pas
// (voir lib/installation.ts) : sans une signature ordinaire, les captures ne montreraient pas l'entrée
// « Installer l'application » qu'un utilisateur d'Edge ou de Chrome voit dans le menu du compte.
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

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
  // La fiche d'une pièce dans le panneau de droite : ouverte par un clic sur sa ligne.
  { nom: 'pc-fiche-clair', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'light', reduite: false, cellule: 'Pharma Distrib Sud' },
  { nom: 'pc-fiche-sombre', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'dark', reduite: false, cellule: 'Pharma Distrib Sud' },
  { nom: 'pc-fiche-1280', chemin: '#/dossiers/d1/pieces', l: 1280, h: 800, theme: 'light', reduite: false, cellule: 'Pharma Distrib Sud' },
  { nom: 'pc-fiche-1024', chemin: '#/dossiers/d1/pieces', l: 1024, h: 768, theme: 'light', reduite: false, cellule: 'Pharma Distrib Sud' },
  { nom: 'mobile-fiche-clair', chemin: '#/dossiers/d1/pieces', l: 390, h: 844, theme: 'light', reduite: false, cellule: 'Pharma Distrib Sud' },
  // Le rapprochement d'un mouvement dans le panneau de droite : une pièce proposée (Papeterie Moderne,
  // validée), puis un mouvement déjà rapproché — ouvert après être passé sur « Tous ».
  { nom: 'pc-mouvement-clair', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, cellule: 'CB PAPETERIE MODERNE' },
  { nom: 'pc-mouvement-sombre', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'dark', reduite: false, cellule: 'CB PAPETERIE MODERNE' },
  { nom: 'pc-mouvement-1280', chemin: '#/dossiers/d1/banque', l: 1280, h: 800, theme: 'light', reduite: false, cellule: 'CB PAPETERIE MODERNE' },
  { nom: 'pc-mouvement-rapproche', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Tous', cellule: 'PRLV ENERGIE SERVICES' },
  { nom: 'mobile-mouvement-clair', chemin: '#/dossiers/d1/banque', l: 390, h: 844, theme: 'light', reduite: false, cellule: 'CB PAPETERIE MODERNE' },
  // Le menu du compte (apparence, installation, thème, déconnexion), ouvert tel quel, puis avec la
  // consigne d'installation dépliée (le navigateur n'a pas encore annoncé d'invite) : déployé, sombre,
  // réduit — où le menu s'ouvre au-dessus de l'avatar seul — et le menu « … » du téléphone.
  { nom: 'pc-compte-clair', chemin: '#/dossiers', l: 1440, h: 900, theme: 'light', reduite: false, compte: true },
  { nom: 'pc-installer-clair', chemin: '#/dossiers', l: 1440, h: 900, theme: 'light', reduite: false, compte: true, clic: "Installer l'application" },
  { nom: 'pc-installer-sombre', chemin: '#/dossiers/d1/pieces', l: 1280, h: 800, theme: 'dark', reduite: false, compte: true, clic: "Installer l'application" },
  { nom: 'pc-installer-reduite', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'light', reduite: true, compte: true, clic: "Installer l'application" },
  { nom: 'mobile-menu-clair', chemin: '#/dossiers', l: 390, h: 844, theme: 'light', reduite: false, clic: "Plus d'options" },
].filter((v) => v.nom.includes(filtre))

const navigateur = await chromium.launch({ executablePath: executable })
for (const v of VUES) {
  const contexte = await navigateur.newContext({ viewport: { width: v.l, height: v.h }, userAgent: CHROME })
  await contexte.addInitScript(({ theme, reduite }) => {
    localStorage.setItem('jd-precompta-theme', theme)
    localStorage.setItem('jd-precompta-barre-reduite', reduite ? '1' : '0')
  }, { theme: v.theme, reduite: v.reduite })
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
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 160)) })
  await page.goto(BASE + v.chemin, { waitUntil: 'load' })
  await page.waitForTimeout(1500)
  // Le menu du compte, en bas de la barre : son bouton porte l'adresse de la personne connectée.
  if (v.compte) {
    await page.getByRole('button', { name: /^Compte de / }).click()
    await page.waitForTimeout(300)
  }
  if (v.clic) {
    await page.getByRole('button', { name: v.clic, exact: true }).click()
    await page.waitForTimeout(600)
  }
  // Une ligne de liste, désignée par le texte d'une de ses cellules.
  if (v.cellule) {
    await page.getByRole('cell', { name: v.cellule }).first().click()
    await page.waitForTimeout(600)
  }
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${SORTIE}${v.nom}.png` })
  const police = await page.evaluate(() => (document.fonts.check('16px Manrope') ? 'Manrope chargée' : 'Manrope ABSENTE'))
  console.log(v.nom, '—', police, '—', erreurs.length ? erreurs.slice(0, 3) : 'sans erreur',
    '—', externes.length ? `requêtes externes coupées : ${externes.slice(0, 3).join(', ')}` : 'aucune requête externe')
  await contexte.close()
}
await navigateur.close()

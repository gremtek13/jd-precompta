// Installabilité de l'application : ce que Chromium répond à « peut-on installer cette page ? », pour
// le manifeste statique et pour celui d'un cabinet qui a son logo. À rejouer après toute modification
// de public/manifest.webmanifest, de src/lib/manifesteCabinet.ts ou de src/lib/branding.ts.
//
//   npx vite --config outils/captures/vite.config.ts        # sert l'application sur 127.0.0.1:5199
//   npm i --no-save playwright-core@1.56.1                   # hors package.json : outil, pas dépendance
//   node outils/captures/installable.mjs                     # sort 1 au moindre écart
//
// Pourquoi ce banc existe. Le manifeste d'un cabinet en marque blanche n'était PAS installable — son
// `start_url` relatif ne se résolvait pas contre l'URL `blob:` qui le sert — et rien ne le montrait :
// un avertissement en console, une icône d'installation absente de la barre d'adresse. Or le cabinet
// JD Consult a un logo, donc c'est ce manifeste-là qu'il reçoit. La réponse, seul le navigateur la
// connaît : on la lui demande par le protocole de DevTools (`Page.getInstallabilityErrors`).
//
// Deux pièges, payés en l'écrivant :
// - en navigation privée, Chrome refuse toute installation et le dit (« in-incognito ») : chaque essai
//   passerait pour un échec. D'où un profil ordinaire, jetable, par cas ;
// - ne pas donner au navigateur le mandataire de l'environnement (voir vitrine.mjs) : toute requête
//   externe est coupée, sauf le logo fictif que ce banc sert lui-même.
//
// Quatre cas, dont un qui DOIT échouer (un logo introuvable) : sans lui, un banc qui ne vérifierait
// plus rien rendrait « installable » partout. Et les trois cas installables doivent désigner la MÊME
// application — un cabinet qui pose son logo ne doit pas en installer une seconde.
import { chromium } from 'playwright-core'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'

const BASE = 'http://127.0.0.1:5199/'
const HOTE_LOGOS = 'https://logos.exemple.test/'

const RACINE_NAVIGATEURS = '/opt/pw-browsers'
const revision = existsSync(RACINE_NAVIGATEURS)
  ? readdirSync(RACINE_NAVIGATEURS).filter((d) => /^chromium-\d+$/.test(d)).sort().pop()
  : undefined
const executable = process.env.CHROMIUM ?? (revision ? `${RACINE_NAVIGATEURS}/${revision}/chrome-linux/chrome` : undefined)

// Un PNG uni, écrit à la main : un logo fictif aux dimensions voulues, sans dépendance de plus.
function crc32(octets) {
  let crc = 0xffffffff
  for (const o of octets) {
    crc ^= o
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}
function bloc(type, donnees) {
  const longueur = Buffer.alloc(4)
  longueur.writeUInt32BE(donnees.length)
  const corps = Buffer.concat([Buffer.from(type), donnees])
  const controle = Buffer.alloc(4)
  controle.writeUInt32BE(crc32(corps))
  return Buffer.concat([longueur, corps, controle])
}
function png(largeur, hauteur) {
  const entete = Buffer.alloc(13)
  entete.writeUInt32BE(largeur, 0)
  entete.writeUInt32BE(hauteur, 4)
  entete[8] = 8 // 8 bits par canal
  entete[9] = 2 // RVB
  const ligne = Buffer.alloc(1 + largeur * 3)
  for (let x = 0; x < largeur; x++) ligne.set([29, 69, 135], 1 + x * 3)
  const image = Buffer.concat(Array.from({ length: hauteur }, () => ligne))
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloc('IHDR', entete), bloc('IDAT', deflateSync(image)), bloc('IEND', Buffer.alloc(0)),
  ])
}

const LOGOS = { carre: png(512, 512), large: png(600, 200) }

const CAS = [
  { nom: 'sans logo (manifeste statique)', logo: null, attendu: 'installable' },
  { nom: 'logo carré 512 × 512', logo: 'carre', attendu: 'installable' },
  { nom: 'logo large 600 × 200', logo: 'large', attendu: 'installable' },
  // Le contrôle : un logo que personne ne sert. Chrome exige une icône d'au moins 144 pixels.
  { nom: 'logo introuvable (contrôle)', logo: 'absent', attendu: 'no-acceptable-icon' },
]

let fautes = 0
const identites = new Set()
for (const cas of CAS) {
  const profil = mkdtempSync(path.join(tmpdir(), 'installable-'))
  const contexte = await chromium.launchPersistentContext(profil, { executablePath: executable, viewport: { width: 1440, height: 900 } })
  try {
    await contexte.addInitScript((logo) => {
      if (logo) localStorage.setItem('banc-logo', logo)
    }, cas.logo ? `${HOTE_LOGOS}${cas.logo}.png` : null)
    const externes = []
    await contexte.route(/^https?:\/\//, (route) => {
      const url = route.request().url()
      if (url.startsWith(BASE)) return route.continue()
      const logo = url.startsWith(HOTE_LOGOS) ? LOGOS[url.slice(HOTE_LOGOS.length).replace(/\.png$/, '')] : undefined
      if (logo) return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: logo })
      if (!url.startsWith(HOTE_LOGOS)) externes.push(url.slice(0, 80))
      return route.abort()
    })
    const page = contexte.pages()[0] ?? await contexte.newPage()
    await page.goto(BASE + '#/dossiers', { waitUntil: 'load' })
    // Le temps que la charte du cabinet soit lue et que le manifeste soit remplacé.
    await page.waitForTimeout(2500)
    const cdp = await contexte.newCDPSession(page)
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
    const { appId } = await cdp.send('Page.getAppId')
    const lien = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.href ?? '')
    const erreurs = installabilityErrors.map((e) => e.errorId)
    const obtenu = erreurs.length === 0 ? 'installable' : erreurs.join(', ')
    const conforme = cas.attendu === 'installable' ? erreurs.length === 0 : erreurs.includes(cas.attendu)
    // Le manifeste servi doit être celui qu'annonce le cas : un logo, ou pas de logo.
    const bonManifeste = cas.logo ? lien.startsWith('blob:') : lien.endsWith('/manifest.webmanifest')
    if (!conforme || !bonManifeste) fautes++
    if (cas.attendu === 'installable') identites.add(appId)
    console.log(`${conforme && bonManifeste ? 'ok   ' : 'FAUTE'} ${cas.nom.padEnd(34)} ${obtenu}${bonManifeste ? '' : ` — manifeste inattendu : ${lien.slice(0, 40)}`}${externes.length ? ` — requêtes externes coupées : ${externes.length}` : ''}`)
  } finally {
    await contexte.close()
    rmSync(profil, { recursive: true, force: true })
  }
}
if (identites.size !== 1) {
  fautes++
  console.log(`FAUTE les cas installables désignent ${identites.size} applications : ${[...identites].join(' ; ')}`)
} else {
  console.log(`ok    une seule application, quel que soit le logo : ${[...identites][0]}`)
}
process.exit(fautes ? 1 : 0)

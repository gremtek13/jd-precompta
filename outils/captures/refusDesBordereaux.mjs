// L'ESSAI DU REFUS D'UN BORDEREAU DE TÉLÉTRANSMISSION AU DÉPÔT (BOR6, première partie), dans un VRAI navigateur, côté cabinet
// (« + Ajouter des documents » de Justificatifs) et côté client (« Mes pièces »), sur le faux Supabase du banc (vitrine.mjs).
//
//   npx vite --config outils/captures/vite.config.ts                       # le serveur de dev, 127.0.0.1:5199
//   node outils/captures/refusDesBordereaux.mjs [adresse]                  # adresse par défaut : http://127.0.0.1:5199/
// Le build de production, sur le même faux client : `npx vite build --config outils/captures/vite.config.ts --outDir <dossier>`
// puis `npx vite preview --config outils/captures/vite.config.ts --outDir <dossier> --port 4199`, et l'adresse
// http://127.0.0.1:4199/ en argument.
//
// Quatre dépôts, des PDF FICTIFS fabriqués ici par pdf-lib (aucun document réel, aucun nom de personne réelle) : (a) un
// bordereau d'une page (src/test/bordereauFictif.ts), (b) une facture ordinaire, (c) un PDF de trois pages dont la troisième
// est un bordereau, (d) une image PNG ; puis, pour la durée, une facture de ~5 Mo de texte. Le faux client vit dans la page :
// aucune requête `storage/v1/object` ne part sur le réseau, l'essai compte donc les appels à `upload` du faux stockage
// (`window.__depotsDuBanc`). Exige : (a) et (c) refusés avec leur phrase, sans aucun envoi ; (b) et (d) partent (un appel à
// `upload` chacun — le seau `pieces` du banc répond « maquette », l'issue est alors une erreur, comme avant le refus).
// Rend aussi les erreurs de la console : un ouvrier de pdf.js (worker) qui ne se charge pas y paraîtrait.
//
// PIÈGE, payé une fois : ne pas donner au navigateur le mandataire de l'environnement (voir vitrine.mjs) ; toute requête
// hors du serveur local est coupée, et nommée.
import { chromium } from 'playwright-core'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { bordereauFictifEnPdf } from '../../src/test/bordereauFictif.ts'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5199/'
const RACINE_NAVIGATEURS = '/opt/pw-browsers'
const revision = existsSync(RACINE_NAVIGATEURS)
  ? readdirSync(RACINE_NAVIGATEURS).filter((d) => /^chromium-\d+$/.test(d)).sort().pop()
  : undefined
// La révision préinstallée range son exécutable sous `chrome-linux` ou, plus récente, sous `chrome-linux64`.
const executable = process.env.CHROMIUM ?? (revision
  ? ['chrome-linux', 'chrome-linux64'].map((d) => `${RACINE_NAVIGATEURS}/${revision}/${d}/chrome`).find((f) => existsSync(f))
  : undefined)

// ── Les fichiers fictifs ──
async function pdfDeLignes(pages) {
  const doc = await PDFDocument.create()
  const police = await doc.embedFont(StandardFonts.Helvetica)
  for (const lignes of pages) {
    const p = doc.addPage([595, 842])
    lignes.forEach((l, i) => p.drawText(l, { x: 40, y: 800 - 12 * i, size: 8, font: police }))
  }
  return doc.save()
}
const FACTURE = ['FACTURE N° F-2026-0042', 'Fournitures Fictives SARL', '1 rue Imaginaire 99999 Nullepart', 'Total TTC 54,00']
async function troisPagesDontUnBordereau() {
  const doc = await PDFDocument.create()
  const debut = await PDFDocument.load(await pdfDeLignes([FACTURE, ['Conditions générales fictives', 'Page 2']]))
  const fin = await PDFDocument.load(await bordereauFictifEnPdf())
  for (const p of await doc.copyPages(debut, [0, 1])) doc.addPage(p)
  for (const p of await doc.copyPages(fin, [0])) doc.addPage(p)
  return doc.save()
}
// Une facture d'environ 5 Mo de texte fictif : des pages de lignes inventées, sans compression (pdf-lib ne compresse pas
// les flux de contenu), jusqu'à franchir le poids visé.
async function grosseFacture(octetsVises = 5 * 1024 * 1024) {
  const lignes = Array.from({ length: 64 }, (_, i) => `Ligne fictive ${String(i).padStart(2, '0')} — prestation imaginaire de conseil, quantité 1, prix 10,00, total 10,00`)
  let n = 300
  for (;;) {
    const octets = await pdfDeLignes([FACTURE, ...Array.from({ length: n }, () => lignes)])
    if (octets.byteLength >= octetsVises) return { octets, pages: n + 1 }
    n = Math.ceil(n * octetsVises / octets.byteLength) + 5
  }
}
// Un PNG d'un pixel, valide.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64')

const dossier = mkdtempSync(path.join(tmpdir(), 'bor6-'))
const ecrire = (nom, octets) => { const f = path.join(dossier, nom); writeFileSync(f, octets); return f }
const gros = await grosseFacture()
const FICHIERS = {
  a: { nom: 'a-bordereau.pdf', chemin: ecrire('a-bordereau.pdf', await bordereauFictifEnPdf()), refuse: true },
  b: { nom: 'b-facture.pdf', chemin: ecrire('b-facture.pdf', await pdfDeLignes([FACTURE])), refuse: false },
  c: { nom: 'c-trois-pages.pdf', chemin: ecrire('c-trois-pages.pdf', await troisPagesDontUnBordereau()), refuse: true },
  d: { nom: 'd-image.png', chemin: ecrire('d-image.png', PNG), refuse: false },
  e: { nom: 'e-grosse-facture.pdf', chemin: ecrire('e-grosse-facture.pdf', gros.octets), refuse: false },
}
console.log(`fichiers fictifs : ${dossier} ; la grosse facture : ${(gros.octets.byteLength / 1024 / 1024).toFixed(2)} Mio, ${gros.pages} pages`)

const PHRASE_CABINET = 'à la forme d’un bordereau de télétransmission'
const PHRASE_CLIENT = 'ce fichier a la forme d’un bordereau de télétransmission'

const navigateur = await chromium.launch({ executablePath: executable })
const fautes = []
const resultats = []

async function ouvrir(client) {
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } })
  await contexte.addInitScript((c) => { if (c) localStorage.setItem('banc-client', '1') }, client)
  const externes = []
  await contexte.route(/^https?:\/\//, (route) => {
    const url = route.request().url()
    if (url.startsWith(BASE)) return route.continue()
    externes.push(url.slice(0, 80))
    return route.abort()
  })
  const page = await contexte.newPage()
  const consoles = []
  page.on('pageerror', (e) => consoles.push(`pageerror : ${String(e).slice(0, 200)}`))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoles.push(`${m.type()} : ${m.text().slice(0, 200)}`) })
  page.on('requestfailed', (r) => { if (r.url().startsWith(BASE)) consoles.push(`requête ratée : ${r.url().slice(0, 120)} (${r.failure()?.errorText})`) })
  page.on('dialog', (d) => d.accept())
  // L'ouvrier de pdf.js : un vrai Worker, chargé depuis le serveur. pdf.js se rabattrait sinon, en silence ou par un
  // avertissement, sur un « faux ouvrier » dans la page : l'essai le compte pour le distinguer.
  const ouvriers = []
  page.on('worker', (w) => ouvriers.push(w.url().replace(BASE, '')))
  return { contexte, page, consoles, externes, ouvriers }
}

const envois = (page) => page.evaluate(() => (window.__depotsDuBanc ?? []).length)

// ── Côté cabinet : la fenêtre « Ajouter des documents » de Justificatifs, un fichier à la fois, chacun dans une fenêtre neuve. ──
async function cabinet(cle) {
  const f = FICHIERS[cle]
  const { contexte, page, consoles, externes, ouvriers } = await ouvrir(false)
  await page.goto(BASE + '#/dossiers/d1/pieces', { waitUntil: 'load' })
  await page.getByRole('button', { name: '+ Ajouter des documents' }).click()
  const avant = await envois(page)
  const t0 = Date.now()
  await page.locator('input[type=file][multiple]').setInputFiles(f.chemin)
  const issue = await Promise.race([
    page.getByText(PHRASE_CABINET).first().waitFor({ timeout: 120000 }).then(() => 'refusé'),
    page.locator('td', { hasText: f.nom }).first().waitFor({ timeout: 120000 }).then(() => 'retenu'),
  ]).catch(() => 'aucune issue')
  const duree = Date.now() - t0
  let apres = await envois(page)
  if (issue === 'retenu') {
    await page.getByRole('button', { name: /^Importer 1 fichier/ }).click()
    await page.waitForFunction((n) => (window.__depotsDuBanc ?? []).length > n, avant, { timeout: 60000 }).catch(() => {})
    await page.getByRole('button', { name: 'Fermer' }).waitFor({ timeout: 60000 }).catch(() => {})
    apres = await envois(page)
  } else {
    await page.waitForTimeout(500)
    apres = await envois(page)
  }
  await contexte.close()
  return { espace: 'cabinet', cle, issue, duree, envois: apres - avant, consoles, externes, ouvriers }
}

// ── Côté client : « Mes pièces ». Le dépôt part dès le choix ; l'issue est le refus dit, ou l'appel au stockage. ──
async function client(cle) {
  const f = FICHIERS[cle]
  const { contexte, page, consoles, externes, ouvriers } = await ouvrir(true)
  await page.goto(BASE + '#/mes-pieces', { waitUntil: 'load' })
  await page.locator('input[type=file][multiple]').waitFor({ state: 'attached', timeout: 30000 })
  const avant = await envois(page)
  const t0 = Date.now()
  await page.locator('input[type=file][multiple]').setInputFiles(f.chemin)
  const issue = await Promise.race([
    page.getByText(PHRASE_CLIENT).first().waitFor({ timeout: 120000 }).then(() => 'refusé'),
    page.waitForFunction((n) => (window.__depotsDuBanc ?? []).length > n, avant, { timeout: 120000 }).then(() => 'envoyé'),
  ]).catch(() => 'aucune issue')
  const duree = Date.now() - t0
  await page.waitForTimeout(800)
  const apres = await envois(page)
  await contexte.close()
  return { espace: 'client', cle, issue, duree, envois: apres - avant, consoles, externes, ouvriers }
}

for (const espace of [cabinet, client]) {
  for (const cle of ['a', 'b', 'c', 'd', 'e']) {
    const r = await espace(cle)
    resultats.push(r)
    const attendu = FICHIERS[cle].refuse ? 'refusé' : (r.espace === 'cabinet' ? 'retenu' : 'envoyé')
    const envoisAttendus = FICHIERS[cle].refuse ? 0 : 1
    if (r.issue !== attendu || r.envois !== envoisAttendus) fautes.push(`${r.espace} ${cle} : ${r.issue}, ${r.envois} envoi(s) — attendu ${attendu}, ${envoisAttendus}`)
    console.log(`${r.espace.padEnd(7)} ${cle} ${FICHIERS[cle].nom.padEnd(22)} ${r.issue.padEnd(8)} ${String(r.duree).padStart(6)} ms  envois au stockage : ${r.envois}`
      + `  ouvriers : ${r.ouvriers.filter((u) => u.includes('pdf.worker')).length}`
      + (r.externes.length ? `  externes coupées : ${r.externes.join(', ')}` : ''))
    for (const c of r.consoles) console.log(`          console — ${c}`)
  }
}
await navigateur.close()
console.log(fautes.length === 0 ? 'ESSAI VERT' : `ESSAI ROUGE :\n  ${fautes.join('\n  ')}`)
process.exit(fautes.length === 0 ? 0 : 1)

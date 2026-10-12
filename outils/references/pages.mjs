// Rend des pages du PDF en images, par le pdf.js installé, dans le Chromium de l'environnement, servi en local.
//   node outils/references/pages.mjs <fichier.pdf> <dossier des images> <numéros de page…>
import { chromium } from 'playwright-core'
import { executable } from './navigateur.mjs'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const [, , pdf, sortie, ...numeros] = process.argv
const PROTHESE = 'for (const C of [Map, WeakMap]) { if (!C.prototype.getOrInsertComputed) { C.prototype.getOrInsertComputed = function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k) }; C.prototype.getOrInsert = function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k) } } }\n'
const PDFJS = new URL('../../node_modules/pdfjs-dist/build', import.meta.url).pathname
const page = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#888"><canvas id="c"></canvas><script type="module">
import '/prothese.mjs'
import * as pdfjs from '/pdfjs/pdf.mjs'
pdfjs.GlobalWorkerOptions.workerSrc = '/travailleur.mjs'
const doc = await pdfjs.getDocument({ url: '/document.pdf' }).promise
window.nombreDePages = doc.numPages
window.rendre = async (n) => {
  const p = await doc.getPage(n)
  const v = p.getViewport({ scale: 1.6 })
  const c = document.getElementById('c'); c.width = v.width; c.height = v.height
  await p.render({ canvasContext: c.getContext('2d'), viewport: v }).promise
  return [v.width, v.height]
}
window.pret = true
</script>`
const serveur = createServer((req, res) => {
  const types = { mjs: 'text/javascript', pdf: 'application/pdf' }
  try {
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page) }
    // Le Chromium de l'environnement n'a pas encore Map.prototype.getOrInsertComputed, que pdf.js 6 appelle : une prothèse, chargée avant lui (l'ordre des import est celui de l'évaluation).
    if (req.url === '/prothese.mjs') { res.writeHead(200, { 'content-type': types.mjs }); return res.end(PROTHESE) }
    if (req.url === '/travailleur.mjs') { res.writeHead(200, { 'content-type': types.mjs }); return res.end("import '/prothese.mjs'\nimport '/pdfjs/pdf.worker.mjs'\n") }
    if (req.url === '/document.pdf') { res.writeHead(200, { 'content-type': types.pdf }); return res.end(readFileSync(resolve(pdf))) }
    if (req.url.startsWith('/pdfjs/') && /^[\w.]+$/.test(req.url.slice(7))) {
      res.writeHead(200, { 'content-type': types.mjs }); return res.end(readFileSync(`${PDFJS}/${req.url.slice(7)}`))
    }
  } catch {}
  res.writeHead(404); res.end()
}).listen(5391, '127.0.0.1')
const navigateur = await chromium.launch({ executablePath: executable })
const onglet = await navigateur.newPage({ viewport: { width: 960, height: 1400 } })
onglet.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 300)))
onglet.on('pageerror', (e) => console.log('erreur', String(e).slice(0, 300)))
onglet.on('requestfailed', (r) => console.log('échec', r.url(), r.failure()?.errorText))
await onglet.goto('http://127.0.0.1:5391/')
await onglet.waitForFunction(() => window.pret === true, null, { timeout: 15_000 })
console.log('pages', await onglet.evaluate(() => window.nombreDePages))
for (const n of numeros) {
  const [l, h] = await onglet.evaluate((k) => window.rendre(k), Number(n))
  await onglet.setViewportSize({ width: Math.ceil(l), height: Math.ceil(h) })
  await onglet.screenshot({ path: `${sortie}/pdf-page-${n}.png` })
}
await navigateur.close()
serveur.close()

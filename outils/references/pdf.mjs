// Imprime la version autonome en PDF, par le Chromium de l'environnement, sans mandataire (rien ne sort du disque).
//   node outils/references/pdf.mjs <impression.html> <sortie.pdf>
import { chromium } from 'playwright-core'
import { executable } from './navigateur.mjs'
import { resolve } from 'node:path'

const [, , entree, sortie] = process.argv
const navigateur = await chromium.launch({ executablePath: executable })
const page = await navigateur.newPage()
const refusees = []
page.on('requestfailed', (r) => refusees.push(r.url()))
await page.goto(`file://${resolve(entree)}`, { waitUntil: 'load' })
await page.evaluate(() => document.fonts.ready)
const polices = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`))
await page.pdf({
  path: sortie, format: 'A4', printBackground: true, displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: '<div style="font-size:7.5px;width:100%;text-align:center;color:#566472;font-family:sans-serif">Dossiers de référence · données fictives · page <span class="pageNumber"></span> sur <span class="totalPages"></span></div>',
  margin: { top: '12mm', bottom: '15mm', left: '11mm', right: '11mm' },
})
await navigateur.close()
console.log(JSON.stringify({ polices, refusees }))

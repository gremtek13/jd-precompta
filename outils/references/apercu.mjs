// Photographie la page publiée, enveloppée comme la publication l'enveloppe, à trois réglages ; dit si la page déborde.
//   node outils/references/apercu.mjs <page.html> <dossier des images>
import { chromium } from 'playwright-core'
import { executable } from './navigateur.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const [, , entree, sortie] = process.argv
const enveloppe = `${sortie}/enveloppe.html`
writeFileSync(enveloppe, `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${readFileSync(entree, 'utf8')}</body></html>`)
const navigateur = await chromium.launch({ executablePath: executable })
const bilan = []
for (const [nom, largeur, schema] of [['ordinateur', 1280, 'light'], ['telephone', 390, 'light'], ['telephone-sombre', 390, 'dark']]) {
  const page = await navigateur.newPage({ viewport: { width: largeur, height: 900 }, colorScheme: schema })
  await page.route(/^https?:/, (r) => r.abort())
  await page.goto(`file://${resolve(enveloppe)}`)
  const mesure = await page.evaluate(() => {
    const debordent = [...document.querySelectorAll('body *')].filter((e) => {
      const r = e.getBoundingClientRect()
      return r.right > window.innerWidth + 0.5 && !e.closest('.defile')
    }).map((e) => `${e.tagName.toLowerCase()}.${e.className}`)
    return { largeurDoc: document.documentElement.scrollWidth, fenetre: window.innerWidth, debordent: [...new Set(debordent)].slice(0, 5), hauteur: document.documentElement.scrollHeight }
  })
  bilan.push({ nom, ...mesure })
  await page.screenshot({ path: `${sortie}/${nom}-haut.png` })
  await page.locator('#reponses').scrollIntoViewIfNeeded()
  await page.evaluate(() => document.querySelector('#reponses').scrollIntoView())
  await page.screenshot({ path: `${sortie}/${nom}-reponses.png` })
  await page.evaluate(() => document.querySelector('#a h3:nth-of-type(2)').scrollIntoView())
  await page.screenshot({ path: `${sortie}/${nom}-releve.png` })
  await page.close()
}
await navigateur.close()
console.log(JSON.stringify(bilan, null, 1))

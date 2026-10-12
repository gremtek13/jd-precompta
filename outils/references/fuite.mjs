// Cherche nos résultats dans les livrables : chaque valeur numérique de nos_chiffres.json, mise en forme comme le
// générateur l'écrirait, dans le texte de la page et parmi les nombres du classeur. Une valeur trouvée qui figure AUSSI
// dans les données (un fait du dossier) se distingue d'une valeur qui n'y est pas (une fuite).
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
const [, , chiffres, donnees, html, xlsx] = process.argv
const nombre = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const feuilles = []
const parcourir = (v, chemin) => {
  if (typeof v === 'number') feuilles.push({ chemin, v: chemin.startsWith('.d.') ? v / 100 : v })
  else if (v && typeof v === 'object') for (const [k, w] of Object.entries(v)) parcourir(w, `${chemin}.${k}`)
}
parcourir(JSON.parse(readFileSync(chiffres, 'utf8')), '')
const nombresDesDonnees = new Set()
const ramasser = (v) => { if (typeof v === 'number') nombresDesDonnees.add(Math.round(v * 100)); else if (v && typeof v === 'object') Object.values(v).forEach(ramasser) }
ramasser(JSON.parse(readFileSync(donnees, 'utf8')))
const texte = readFileSync(html, 'utf8').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
const classeur = new ExcelJS.Workbook()
await classeur.xlsx.readFile(xlsx)
const nombresDuClasseur = new Set()
classeur.eachSheet((f) => f.eachRow((r) => r.eachCell((c) => { if (typeof c.value === 'number') nombresDuClasseur.add(Math.round(c.value * 100)) })))
const vus = new Map()
for (const { chemin, v } of feuilles) {
  if (Math.abs(v) < 10) continue
  const c = Math.round(v * 100)
  // Un nombre entier seulement : « 880,00 » ne se lit pas dans « 2 880,00 ».
  const borne = (s) => new RegExp(`(?<![\\d\\u202f\\u00a0.,-])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`)
  const dansLaPage = borne(nombre.format(Math.abs(v))).test(texte)
  const dansLeClasseur = nombresDuClasseur.has(c) || nombresDuClasseur.has(-c)
  if (!dansLaPage && !dansLeClasseur) continue
  const fait = nombresDesDonnees.has(c) || nombresDesDonnees.has(-c)
  const cle = `${c}|${fait}`
  if (!vus.has(cle)) vus.set(cle, { v, fait, dansLaPage, dansLeClasseur, chemins: [] })
  vus.get(cle).chemins.push(chemin)
}
const fuites = [...vus.values()].filter((x) => !x.fait)
console.log(`valeurs examinées : ${feuilles.filter((f) => Math.abs(f.v) >= 10).length}`)
console.log(`trouvées et présentes dans les données (faits du dossier) : ${[...vus.values()].filter((x) => x.fait).length}`)
for (const x of [...vus.values()].filter((x) => x.fait)) console.log(`  fait ${x.v} ← ${x.chemins.slice(0, 3).join(', ')}${x.chemins.length > 3 ? ' …' : ''}`)
console.log(`trouvées SANS être dans les données : ${fuites.length}`)
for (const x of fuites) console.log(`  FUITE ? ${x.v} (page ${x.dansLaPage}, classeur ${x.dansLeClasseur}) ← ${x.chemins.join(', ')}`)

// LA BATTERIE DES LIGNES DE FACTURE, JUGÉE PAR LA BASE (correction de la facture, 31/10/2026 ; migration
// `facture_dates_centimes_mention_tva`, en production depuis le 02/11/2026).
//
// src/lib/montantsFactureBatterie.test.ts fige l'empreinte des centimes que `centimes_ligne_facture` a rendus sur les
// lignes que tire src/test/batterieDesLignes.ts, et exige que `calculerLigne` (src/lib/montantsFacture.ts) rende
// exactement les mêmes. Ce script en est la moitié « base » : il envoie chaque ligne à la fonction, sous l'écriture
// décimale que JSON lui donnerait, dans UNE transaction ANNULÉE, puis confronte ses réponses à celles du module, ligne par
// ligne, et rend l'empreinte des deux. Il n'écrit rien qui reste (une table temporaire, dans la transaction annulée), et
// ne lit qu'une fonction immuable : il se joue sur une réplique.
//
// Sans la migration, la base rend le calcul d'hier (la virgule flottante du navigateur, recopiée au bit près) : le script
// le dit, et rend l'empreinte que le test garde sous EMPREINTE_DE_LA_BASE_AVANT.
//
//   node supabase/essais/batterieDesLignes.mjs --hote /var/run/postgresql --port 5432 --base replique
//
// Node 22 exécute le TypeScript du dépôt tel quel, types effacés ; un crochet de résolution ajoute l'extension `.ts` aux
// imports relatifs, que le dépôt écrit sans elle (le même que celui de batterieEncaissements.mjs).
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

async function resolve(specifier, context, next) {
  if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try {
      return await next(`${specifier}.ts`, context)
    } catch {
      // Un module qui n'est pas du TypeScript du dépôt : la résolution ordinaire.
    }
  }
  return next(specifier, context)
}
register(`data:text/javascript,${encodeURIComponent(`export ${resolve}`)}`)

const { values: options } = parseArgs({
  options: { hote: { type: 'string' }, port: { type: 'string' }, base: { type: 'string' }, utilisateur: { type: 'string' } },
})
if (!options.hote || !options.port || !options.base) {
  console.error('Usage : node supabase/essais/batterieDesLignes.mjs --hote <socket ou hôte> --port <port> --base <base> [--utilisateur postgres]')
  process.exit(2)
}
const connexion = ['-h', options.hote, '-p', options.port, '-U', options.utilisateur ?? 'postgres', '-d', options.base]

const DEPOT = new URL('../../', import.meta.url)
const { GRAINE_DES_LIGNES, NOMBRE_DE_LIGNES, lignesTirees } = await import(new URL('src/test/batterieDesLignes.ts', DEPOT).href)
const { calculerLigne } = await import(new URL('src/lib/montantsFacture.ts', DEPOT).href)

function psql(texte) {
  const travail = mkdtempSync(join(tmpdir(), 'lignes-'))
  try {
    writeFileSync(join(travail, 'lignes.sql'), texte)
    const r = spawnSync('psql', ['-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', ...connexion, '-f', join(travail, 'lignes.sql')],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (r.status !== 0) {
      console.error(`✗ psql a échoué :\n${(r.stderr || r.stdout || '').slice(-4000)}`)
      process.exit(1)
    }
    return r.stdout
  } finally {
    rmSync(travail, { recursive: true, force: true })
  }
}

// 1. Les lignes, et ce que le module en rend, en centimes.
const lignes = lignesTirees(GRAINE_DES_LIGNES, NOMBRE_DE_LIGNES)
const centimes = (x) => Math.round(x * 100)
const module = lignes.map((l) => {
  const c = calculerLigne(l.quantite, l.prix, l.taux)
  return `${centimes(c.montant_ht)}/${centimes(c.montant_tva)}`
})

// 2. Les mêmes lignes jugées par la base : chaque nombre sous son écriture décimale la plus courte (`String`), celle que
// JSON envoie ; le témoin de la migration (le corps qui arrondit le produit exact).
const sql = ['begin;', 'create temp table lignes (n int primary key, q numeric not null, p numeric not null, t numeric not null) on commit drop;']
for (let i = 0; i < lignes.length; i += 1000) {
  sql.push(`insert into lignes values ${lignes.slice(i, i + 1000).map((l, k) => `(${i + k}, ${l.quantite}, ${l.prix}, ${l.taux})`).join(',\n')};`)
}
sql.push("select 'T' || chr(9) || case when strpos(p.prosrc, 'round(q * p * 100)') > 0 then 'oui' else 'non' end from pg_proc p "
  + "where p.oid = to_regprocedure('public.centimes_ligne_facture(numeric, numeric, numeric, boolean)');")
sql.push('select n || chr(9) || c.ht_centimes || \'/\' || c.tva_centimes from lignes, lateral public.centimes_ligne_facture(q, p, t, false) c order by n;')
sql.push('rollback;')
const base = new Array(lignes.length)
let temoin = null
for (const ligne of psql(`${sql.join('\n')}\n`).split('\n')) {
  const tab = ligne.indexOf('\t')
  if (tab <= 0) continue
  if (ligne.startsWith('T\t')) temoin = ligne.slice(tab + 1)
  else base[Number(ligne.slice(0, tab))] = ligne.slice(tab + 1)
}
if (base.some((b) => b === undefined)) {
  console.error(`✗ ${base.filter((b) => b !== undefined).length} réponses de la base pour ${lignes.length} lignes.`)
  process.exit(1)
}

// 3. La confrontation, ligne par ligne.
const empreinte = (sorties) => createHash('md5').update(sorties.join(',')).digest('hex')
const ecarts = base.map((b, n) => (b === module[n] ? null : n)).filter((n) => n !== null)
console.log(`migration de la correction de la facture en base : ${temoin ?? 'illisible'}`)
console.log(`${lignes.length} lignes (graine ${GRAINE_DES_LIGNES}), ${ecarts.length} écart(s) entre la base et le module`)
for (const n of ecarts.slice(0, 20)) {
  const l = lignes[n]
  console.log(`  #${n} ${l.quantite} × ${l.prix} à ${l.taux} % — base ${base[n]}, module ${module[n]}`)
}
console.log(`empreinte base   : ${empreinte(base)}`)
console.log(`empreinte module : ${empreinte(module)}`)
process.exit(ecarts.length === 0 ? 0 : 1)

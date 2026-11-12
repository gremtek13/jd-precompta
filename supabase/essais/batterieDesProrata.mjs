// LA BATTERIE DU PRORATA DES HONORAIRES, JUGÉE PAR LA BASE (ligne 47, LM7-Q4 (C), 11/11/2026 ; la migration
// `honoraires_factures`, en production depuis le 12/11/2026, supabase/schema/20261112141227_honoraires_factures.sql).
//
// src/lib/honorairesAuProrataBatterie.test.ts fige l'empreinte des centimes que `honoraires_au_prorata` a rendus sur les
// parts que tire src/test/batterieDesProrata.ts, et exige que `centimesAuProrata` (src/lib/honorairesAFacturer.ts) rende
// exactement les mêmes. Ce script en est la moitié « base » : il envoie chaque part à la fonction, le prix sous l'écriture
// décimale que JSON lui donnerait, dans UNE transaction ANNULÉE, puis confronte ses réponses à celles du module, part par
// part, et rend l'empreinte des deux. Il n'écrit rien qui reste (une table temporaire, dans la transaction annulée) et ne
// lit qu'une fonction immuable : il se joue sur une réplique qui porte la migration (sans elle, la fonction manque et
// psql le dit).
//
//   node supabase/essais/batterieDesProrata.mjs --hote /var/run/postgresql --port 5432 --base replique
//
// Node 22 exécute le TypeScript du dépôt tel quel, types effacés ; un crochet de résolution ajoute l'extension `.ts` aux
// imports relatifs, que le dépôt écrit sans elle (le même que celui de batterieDesLignes.mjs).
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
  console.error('Usage : node supabase/essais/batterieDesProrata.mjs --hote <socket ou hôte> --port <port> --base <base> [--utilisateur postgres]')
  process.exit(2)
}
const connexion = ['-h', options.hote, '-p', options.port, '-U', options.utilisateur ?? 'postgres', '-d', options.base]

const DEPOT = new URL('../../', import.meta.url)
const { GRAINE_DES_PRORATA, NOMBRE_DE_PRORATA, partsTirees, partEcrite } = await import(new URL('src/test/batterieDesProrata.ts', DEPOT).href)
const { centimesAuProrata } = await import(new URL('src/lib/honorairesAFacturer.ts', DEPOT).href)

const md5 = (texte) => createHash('md5').update(texte, 'utf8').digest('hex')

// 1. Les parts, et ce que le module en rend, en centimes.
const parts = partsTirees(GRAINE_DES_PRORATA, NOMBRE_DE_PRORATA)
const module = parts.map((p) => String(centimesAuProrata(p.montant_ht, p.periodicite, p.debut, p.fin)))

// 2. Ce que la base en rend, dans l'ordre, dans une transaction annulée.
const valeurs = parts.map((p, i) => `(${i}, ${String(p.montant_ht)}, '${p.periodicite}', '${p.debut}', '${p.fin}')`).join(',\n')
const travail = mkdtempSync(join(tmpdir(), 'prorata-'))
let sortie
try {
  writeFileSync(join(travail, 'prorata.sql'), `begin;
create temp table parts (rang integer, montant numeric, periodicite text, debut date, fin date) on commit drop;
insert into parts values
${valeurs};
select coalesce(public.honoraires_au_prorata(montant, periodicite, debut, fin)::text, 'null') from parts order by rang;
rollback;
`)
  const r = spawnSync('psql', ['-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', ...connexion, '-f', join(travail, 'prorata.sql')],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) {
    console.error(`✗ psql a échoué :\n${(r.stderr || r.stdout || '').slice(-4000)}`)
    process.exit(1)
  }
  sortie = r.stdout
} finally {
  rmSync(travail, { recursive: true, force: true })
}
const base = sortie.split('\n').filter((l) => l !== '')
if (base.length !== parts.length) {
  console.error(`✗ la base a rendu ${base.length} réponses pour ${parts.length} parts`)
  process.exit(1)
}

// 3. La confrontation, part par part, et les empreintes.
const ecarts = parts.flatMap((p, i) => (module[i] === base[i] ? [] : [`${partEcrite(p)} : module ${module[i]}, base ${base[i]}`]))
console.log(`parts : ${parts.length}, empreinte ${md5(parts.map(partEcrite).join('\n'))}`)
console.log(`module : empreinte ${md5(module.join(','))}`)
console.log(`base : empreinte ${md5(base.join(','))}`)
console.log(ecarts.length === 0 ? '✓ la base et le module rendent le même centime sur chaque part' : `✗ ${ecarts.length} écart(s) :\n${ecarts.slice(0, 20).join('\n')}`)
process.exit(ecarts.length === 0 ? 0 : 1)

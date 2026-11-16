// LA RESTAURATION DE LA DÉMONSTRATION SUR UNE RÉPLIQUE — avant que le cabinet ne la joue en production, le même fichier
// restauré sur une copie de la réplique, par le même plan que l'écran, sous le même profil (le rôle `authenticated`, la
// session d'un super-administrateur), puis relu et contrôlé par les moteurs de l'application. Trois sous-commandes, par
// outils/demonstration/lancer.mjs (mode d'emploi : README.md) :
//
//   sql <sauvegarde> <uid>            le SQL de la restauration, à passer à psql sur la réplique (autocommit : une instruction
//                                     par lot, comme une requête de PostgREST, les gardes différées jugées à chaque lot)
//   relire <sauvegarde>               le SQL qui relit, sous le même profil, les tables de la sauvegarde et les catégories
//   controler <sauvegarde> <relu>     compare les lignes relues à la sauvegarde (la relecture de `verifierRestauration`), puis
//                                     rend les points de la Vue d'ensemble, la 2035 de 2025 et sa concordance aux écritures
//
// Ce que `sql` rejoue de `restaurerSauvegarde` (src/lib/sauvegardeDonnees.ts) : la lecture du fichier par `lireSauvegarde`,
// les refus d'avant la première écriture (tables hors de l'ordre, anciennes notes, liens perdus, références externes ABSENTES
// de la base, dossier déjà présent), puis `planReinsertion` et `lotsDEcriture` — l'ordre et les lots de l'écran —, chaque lot
// écrit comme PostgREST l'écrit (`insert into t (colonnes) select colonnes from json_populate_recordset(null::t, corps)`). Ce
// qu'il ne rejoue pas : le réseau, et les lignes partagées (le fichier de la démonstration n'en porte aucune : il le refuse).

import { readFileSync } from 'node:fs'
import { lireSauvegarde } from '../../src/lib/sauvegardeFichier'
import { lotsDEcriture } from '../../src/lib/sauvegardeDonnees'
import {
  clePrimaire, estLignePartagee, identiteRestauree, liensPerdus, planReinsertion, referencesExternes, sansAnciennesNotes,
} from '../../src/lib/sauvegarde'
import { CATEGORIES_CITEES, controlesDuDossier, resumeDuPoint } from '../../src/test/dossierDeDemonstration'
import type { Categorie } from '../../src/lib/types'

const [commande, fichier, troisieme] = process.argv.slice(2)
const sauvegarde = await lireSauvegarde(readFileSync(fichier, 'utf8'))
const { manifeste, contenu } = sauvegarde
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const litteral = (v: string) => `'${v.replaceAll("'", "''")}'`
const ident = (v: string) => `"${v.replaceAll('"', '""')}"`
const BALISE = '$demonstration_json$'

if (commande === 'sql') {
  if (!troisieme || !UUID.test(troisieme)) throw new Error('sql <sauvegarde> <uid du super-administrateur>')
  const plan = planReinsertion(contenu)
  const refus = [
    ...plan.tablesIgnorees.map((t) => `table hors de l'ordre : ${t}`),
    ...sansAnciennesNotes(contenu).refus,
    ...liensPerdus(contenu).map((p) => `lien perdu : ${p.table}.${p.colonne} → ${p.parent} ${p.valeur}`),
    ...plan.etapes.flatMap((e) => e.lignes.filter((l) => estLignePartagee(e.table, l)).map(() => `ligne partagée dans ${e.table}`)),
  ]
  if (refus.length > 0) throw new Error(`Refusée avant toute écriture :\n- ${refus.join('\n- ')}`)
  const sortie: string[] = [
    '\\set ON_ERROR_STOP on',
    '-- Le profil de l’écran : la session d’un super-administrateur, sous le rôle authenticated (comme PostgREST la pose).',
    'set role authenticated;',
    `select set_config('request.jwt.claims', ${litteral(JSON.stringify({ sub: troisieme, role: 'authenticated', aal: 'aal1' }))}, false);`,
    `select set_config('request.jwt.claim.sub', ${litteral(troisieme)}, false);`,
    `select set_config('request.jwt.claim.role', 'authenticated', false);`,
  ]
  // Les références externes, LUES sous le même profil, comme `restaurerSauvegarde` les lit avant d'écrire.
  for (const externe of referencesExternes(contenu)) {
    const cle = clePrimaire(externe.parent)
    if (cle.length !== 1) continue
    sortie.push(`do $$ begin if (select count(*) from public.${ident(externe.parent)} where ${ident(cle[0])}::text in (${externe.valeurs.map(litteral).join(', ')})) <> ${externe.valeurs.length} then raise exception 'référence externe absente : ${externe.parent} (pointée par ${externe.table}.${externe.colonne})'; end if; end $$;`)
  }
  sortie.push(`do $$ begin if exists (select 1 from public.dossiers where id = ${litteral(manifeste.dossierId)}) then raise exception 'le dossier existe déjà'; end if; end $$;`)
  for (const etape of plan.etapes) {
    for (const lot of lotsDEcriture(etape.lignes)) {
      const colonnes = Object.keys(lot[0]).map(ident).join(', ')
      sortie.push(`-- ${etape.table} : ${lot.length} ligne(s)`)
      sortie.push(`insert into public.${ident(etape.table)} (${colonnes}) select ${colonnes} from json_populate_recordset(null::public.${ident(etape.table)}, ${BALISE}${JSON.stringify(lot)}${BALISE});`)
    }
  }
  if (plan.secondePasse.some((p) => p.valeurs.length > 0)) throw new Error('Une seconde passe : la démonstration n’en porte aucune.')
  sortie.push('reset role;')
  console.log(sortie.join('\n'))
} else if (commande === 'relire') {
  const D = litteral(manifeste.dossierId)
  const tables = Object.keys(contenu).map((t) => {
    const filtre = t === 'dossiers' ? `id = ${D}` : `dossier_id = ${D}`
    const tri = clePrimaire(t).map(ident).join(', ')
    return `${litteral(t)}, (select coalesce(json_agg(x order by ${tri}), '[]'::json) from public.${ident(t)} x where ${filtre})`
  })
  console.log([
    'set role authenticated;',
    `select set_config('request.jwt.claims', ${litteral(JSON.stringify({ sub: troisieme ?? '', role: 'authenticated', aal: 'aal1' }))}, false) \\g /dev/null`,
    `select json_build_object('contenu', json_build_object(${tables.join(', ')}), 'categories', (select coalesce(json_agg(c order by c.id), '[]'::json) from public.categories c where c.dossier_id is null or c.dossier_id = ${D}));`,
  ].join('\n'))
} else if (commande === 'controler') {
  const relu = JSON.parse(readFileSync(troisieme, 'utf8')) as { contenu: Record<string, Record<string, unknown>[]>; categories: Categorie[] }
  // La relecture de `verifierRestauration` : chaque ligne de la sauvegarde retrouvée, aucune de plus.
  const ecarts: string[] = []
  for (const [table, lignes] of Object.entries(contenu)) {
    const attendues = new Set(lignes.map((l) => identiteRestauree(table, l)))
    const trouvees = new Set((relu.contenu[table] ?? []).map((l) => identiteRestauree(table, l)))
    for (const x of attendues) if (!trouvees.has(x)) ecarts.push(`${table} : ligne absente ${x}`)
    for (const x of trouvees) if (!attendues.has(x)) ecarts.push(`${table} : ligne en trop ${x}`)
  }
  console.log(`Relecture : ${ecarts.length} écart(s)${ecarts.length ? `\n- ${ecarts.join('\n- ')}` : ''}`)
  // Les catégories que la base d'arrivée porte, celles que la sauvegarde cite seulement.
  const citees = new Set(CATEGORIES_CITEES.map((k) => k.id))
  const categories = relu.categories.filter((k) => citees.has(k.id))
  const apres = controlesDuDossier(relu.contenu, categories)
  const avant = controlesDuDossier(contenu, CATEGORIES_CITEES)
  const resume = (k: typeof apres) => JSON.stringify({
    checklist: k.checklist.filter((p) => p.nb > 0).map(resumeDuPoint), cases: k.cases2025, concordance: k.concordance2025, ecarts: k.relevesEnEcart,
    prealables: k.prealables2025, validable: k.validable2025,
  })
  console.log(`Préalables de la validation de 2025 (relus) : ${apres.prealables2025.length === 0 ? 'aucun' : apres.prealables2025.join(', ')} ; validable : ${apres.validable2025 ? 'oui' : 'non'}`)
  console.log(`Catégories citées relues : ${categories.length} sur ${citees.size}`)
  console.log(`Points de la Vue d'ensemble (relus) :\n  ${apres.checklist.filter((p) => p.nb > 0).map(resumeDuPoint).join('\n  ')}`)
  console.log(`2035 de 2025 (relue) : recettes ${apres.declaration2025.totalRecettes}, dépenses ${apres.declaration2025.totalDepenses}, résultat ${apres.declaration2025.resultat} ; concordance ${apres.concordance2025.concorde ? 'oui' : 'NON'} ; relevés en écart : ${apres.relevesEnEcart.length}`)
  console.log(`Contrôles relus identiques à ceux de la composition : ${resume(apres) === resume(avant) ? 'oui' : 'NON'}`)
} else {
  throw new Error('sql | relire | controler')
}

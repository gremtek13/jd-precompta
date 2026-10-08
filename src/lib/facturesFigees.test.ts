import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import { TABLES_AUTO_REFERENCEES } from './sauvegarde'

// UNE FACTURE VALIDÉE EST FIGÉE EN BASE, ET LA BASE NE CONNAÎT QUE CE QU'ON LUI A DIT.
//
// Depuis la migration factures_validees_figees (ligne 28.5, étape c), le déclencheur `garder_factures_validees` refuse
// toute modification d'une facture validée, sauf de trois colonnes que son envoi écrit APRÈS coup et qu'elle n'imprime
// ni ne transmet : l'adresse à laquelle `send-email` l'a envoyée, et ce que Super PDP en dit. Cette liste vit dans le
// déclencheur (`v_modifiables`), et c'est elle que ce test confronte au code.
//
// CE QUE ÇA COÛTERAIT SANS LUI. Une colonne qu'une étape suivante écrira sur une facture validée — le dépôt chez la
// plateforme du client, son statut — sans l'inscrire dans la liste ferait refuser l'écriture par la base, en
// production seulement : les tests de `src/` doublent Supabase, et les Edge Functions n'y sont appelées par aucun test.
// L'erreur arriverait APRÈS l'envoi, donc sur une facture déjà transmise dont le suivi ne s'écrirait plus. Et dans
// l'autre sens, une colonne laissée dans la liste alors que plus rien ne l'écrit est une porte ouverte sur une facture
// validée, que personne ne surveille. D'où l'égalité, dans les deux sens.
//
// LES DEUX AUTRES CHEMINS D'ÉCRITURE NE SE LISENT PAS ICI, et c'est dit plutôt que promis : `enregistrer_facture`
// (un appel de fonction, qui ne modifie jamais une facture validée — il la refuse lui-même) et la restauration d'une
// sauvegarde, dont la table est une variable (`supabase.from(passe.table)`). Pour la seconde, le test vérifie ce que le
// déclencheur en admet : un seul lien auto-référencé, `facture_origine_id`, reposé au second passage.

/**
 * Les écritures d'une facture qui ne visent PAS une facture validée, avec la raison ET LE NOMBRE. Vide à ce jour : une
 * entrée ici doit dire pourquoi cette écriture ne peut atteindre qu'un brouillon.
 */
const EXCEPTIONS: Record<string, { nombre: number; raison: string }> = {}

/** Ce que le déclencheur laisse modifier sur une facture validée, lu dans sa dernière définition. */
export function colonnesModifiables(definition: string): string[] {
  const m = /v_modifiables\s+constant\s+text\[\]\s*:=\s*array\[([^\]]*)\]/.exec(definition)
  if (!m) throw new Error('La liste v_modifiables est introuvable dans garder_factures_validees.')
  return m[1].split(',').map((c) => c.trim().replace(/^'|'$/g, '')).filter((c) => c !== '').sort()
}

function fichiers(dossier: URL, garder: (nom: string) => boolean): { chemin: string; texte: string }[] {
  const sortie: { chemin: string; texte: string }[] = []
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    if (e.isDirectory()) sortie.push(...fichiers(new URL(`${e.name}/`, dossier), garder))
    else if (garder(e.name)) sortie.push({ chemin: new URL(e.name, dossier).pathname, texte: readFileSync(new URL(e.name, dossier), 'utf8') })
  }
  return sortie
}

/** Toute source de production : l'application (hors tests et outillage de test) et les Edge Functions. */
function sourcesDeProduction(): { chemin: string; texte: string }[] {
  const racine = new URL('../../', import.meta.url)
  const appli = fichiers(new URL('src/', racine), (n) => /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n))
    .filter((f) => !f.chemin.includes('/src/test/'))
  const fonctions = fichiers(new URL('supabase/functions/', racine), (n) => n === 'index.ts')
  return [...appli, ...fonctions].map((f) => ({ chemin: f.chemin.replace(racine.pathname, ''), texte: f.texte }))
}

/** Les lignes entièrement en commentaire ne comptent pas : ce dépôt CITE ses défauts dans ses commentaires. */
function sansCommentairesPleins(texte: string): string {
  return texte.split('\n').map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l)).join('\n')
}

/** Le contenu d'un groupe ouvert en `i` (accolade, crochet ou parenthèse), délimiteurs appariés. */
function groupe(texte: string, i: number): string | null {
  const ouvrant = texte[i]
  const fermant = ouvrant === '{' ? '}' : ouvrant === '[' ? ']' : ')'
  let profondeur = 0
  for (let k = i; k < texte.length; k++) {
    if (texte[k] === ouvrant) profondeur++
    else if (texte[k] === fermant && --profondeur === 0) return texte.slice(i + 1, k)
  }
  return null
}

/** Les clés de PREMIER niveau d'un objet littéral : `cle: valeur`, `"cle": valeur`, ou la forme courte `cle`. */
export function clesDeLObjet(corps: string): string[] {
  const cles: string[] = []
  let profondeur = 0
  let debut = 0
  const morceaux: string[] = []
  for (let k = 0; k <= corps.length; k++) {
    const c = corps[k]
    if (c === '{' || c === '[' || c === '(') profondeur++
    else if (c === '}' || c === ']' || c === ')') profondeur--
    else if ((c === ',' && profondeur === 0) || k === corps.length) {
      morceaux.push(corps.slice(debut, k))
      debut = k + 1
    }
  }
  for (const m of morceaux) {
    const t = m.trim()
    if (t === '') continue
    const cle = /^["']?([A-Za-z_$][\w$]*)["']?\s*(:|$)/.exec(t)
    cles.push(cle ? cle[1] : `«${t.slice(0, 40)}»`)
  }
  return cles
}

export interface EcritureDeFacture {
  chemin: string
  ligne: number
  table: 'factures_emises' | 'facture_lignes'
  forme: 'update' | 'insert' | 'upsert' | 'delete'
  /** Les colonnes écrites, quand elles se lisent ; null quand l'écriture reçoit autre chose qu'un objet littéral. */
  colonnes: string[] | null
}

/**
 * Les écritures directes des deux tables de facture dans une source. Le corps d'une chaîne s'arrête au `.from(` SUIVANT
 * (la borne de `lecturesPaginees`), et les `\s*` traversent les retours à la ligne : une chaîne coupée sur plusieurs
 * lignes est une seule expression.
 */
export function ecrituresDeFactures(chemin: string, source: string): EcritureDeFacture[] {
  const code = sansCommentairesPleins(source)
  const sortie: EcritureDeFacture[] = []
  const motif = /\.\s*from\s*\(\s*["'](factures_emises|facture_lignes)["']\s*\)/g
  for (const m of code.matchAll(motif)) {
    const debut = (m.index ?? 0) + m[0].length
    const suivant = code.slice(debut).search(/\.\s*from\s*\(/)
    const corps = code.slice(debut, suivant < 0 ? undefined : debut + suivant)
    const ecriture = /\.\s*(update|insert|upsert|delete)\s*\(/.exec(corps)
    if (!ecriture) continue
    const forme = ecriture[1] as EcritureDeFacture['forme']
    let colonnes: string[] | null = null
    if (forme === 'update') {
      const ouverture = ecriture.index + ecriture[0].length
      const reste = corps.slice(ouverture)
      const decalage = reste.search(/\S/)
      if (decalage >= 0 && reste[decalage] === '{') {
        const objet = groupe(reste, decalage)
        colonnes = objet === null ? null : clesDeLObjet(objet)
      }
    }
    sortie.push({
      chemin,
      ligne: code.slice(0, m.index).split('\n').length,
      table: m[1] as EcritureDeFacture['table'],
      forme,
      colonnes,
    })
  }
  return sortie
}

const definition = () => derniereDefinitionSql('garder_factures_validees')
const ecritures = () => sourcesDeProduction().flatMap((s) => ecrituresDeFactures(s.chemin, s.texte))
const lieu = (e: EcritureDeFacture) => `${e.chemin}:${e.ligne}`

describe('les colonnes modifiables d\'une facture validée (garder_factures_validees)', () => {
  it('le déclencheur en porte une liste, lue dans sa DERNIÈRE définition', () => {
    expect(colonnesModifiables(definition())).toEqual(['superpdp_dernier_statut', 'superpdp_invoice_id', 'tiers_email'])
  })

  it('… exactement les colonnes que le code écrit sur une facture, dans les deux sens', () => {
    const ecrites = new Set<string>()
    for (const e of ecritures()) {
      if (e.table !== 'factures_emises' || e.forme !== 'update' || EXCEPTIONS[lieu(e)]) continue
      for (const c of e.colonnes ?? []) ecrites.add(c)
    }
    expect([...ecrites].sort()).toEqual(colonnesModifiables(definition()))
  })

  it('… chacune existe dans la table, sans quoi la liste désignerait une colonne que la base n\'a pas', () => {
    const textes = fichiersDuSchema().map((f) => f.texte).join('\n')
    const creation = /create table (?:public\.)?factures_emises\s*\(([\s\S]*?)\n\);/.exec(textes)?.[1] ?? ''
    for (const c of colonnesModifiables(definition())) {
      const ajoutee = new RegExp(`alter table (?:public\\.)?factures_emises[^;]*add column (?:if not exists )?${c}\\b`).test(textes)
      const creee = new RegExp(`^\\s+${c}\\s`, 'm').test(creation)
      expect(ajoutee || creee, c).toBe(true)
    }
  })

  it('une écriture de facture dit ses colonnes : un objet qu\'on ne lit pas est une faute', () => {
    const illisibles = ecritures().filter((e) => e.table === 'factures_emises' && e.forme === 'update' && e.colonnes === null)
    expect(illisibles.map(lieu)).toEqual([])
  })

  it('aucune insertion directe de facture : une facture naît par enregistrer_facture, ou par la restauration', () => {
    const directes = ecritures().filter((e) => e.table === 'factures_emises' && (e.forme === 'insert' || e.forme === 'upsert'))
    expect(directes.map(lieu)).toEqual([])
  })

  it('aucune écriture directe des lignes : elles s\'écrivent par enregistrer_facture et partent avec leur facture', () => {
    const directes = ecritures().filter((e) => e.table === 'facture_lignes')
    expect(directes.map(lieu)).toEqual([])
  })

  it('la restauration ne repose que le lien que le déclencheur admet au second passage', () => {
    const liens = TABLES_AUTO_REFERENCEES.filter((t) => t.table === 'factures_emises').map((t) => t.colonne)
    expect(liens).toEqual(['facture_origine_id'])
    expect(definition()).toMatch(/to_jsonb\(new\) - 'facture_origine_id' = to_jsonb\(old\) - 'facture_origine_id'/)
  })

  it('chaque exception désigne une écriture qui existe, avec son nombre', () => {
    const parLieu = new Map<string, number>()
    for (const e of ecritures()) parLieu.set(lieu(e), (parLieu.get(lieu(e)) ?? 0) + 1)
    for (const [cle, { nombre }] of Object.entries(EXCEPTIONS)) expect(parLieu.get(cle), cle).toBe(nombre)
  })

  // Le plancher : sans lui, « aucune faute » serait aussi ce que rend un scanner devenu aveugle. Les trois écritures
  // connues — l'adresse d'envoi (send-email), l'identifiant et le statut Super PDP (superpdp-emit) — et la suppression
  // d'un brouillon (onglet Factures).
  it('le scanner voit les écritures connues du dépôt', () => {
    const vues = ecritures().map((e) => `${e.chemin.split('/').slice(-2).join('/')} ${e.forme} ${(e.colonnes ?? []).join(',')}`).sort()
    expect(vues).toEqual([
      'dossier/FacturesTab.tsx delete ',
      'send-email/index.ts update tiers_email',
      'superpdp-emit/index.ts update superpdp_dernier_statut,superpdp_invoice_id',
      'superpdp-emit/index.ts update superpdp_invoice_id',
    ])
  })
})

describe('le scanner des écritures de facture, sur des sources synthétiques', () => {
  it('voit une écriture coupée sur plusieurs lignes, et ses colonnes', () => {
    const source = 'const { error } = await admin\n  .from("factures_emises")\n  .update({\n    notes: "x",\n    statut_depot: s,\n  })\n  .eq("id", id)\n'
    expect(ecrituresDeFactures('a.ts', source)).toEqual([
      { chemin: 'a.ts', ligne: 2, table: 'factures_emises', forme: 'update', colonnes: ['notes', 'statut_depot'] },
    ])
  })

  it('lit la forme courte, les clés entre guillemets, et ne prend pas les clés imbriquées', () => {
    expect(clesDeLObjet(' tiers_email, "superpdp_invoice_id": 1, meta: { notes: 2 }, f: g(a, b) ')).toEqual(
      ['tiers_email', 'superpdp_invoice_id', 'meta', 'f'])
  })

  it('dit illisible un objet qui n\'est pas littéral', () => {
    expect(ecrituresDeFactures('a.ts', 'await supabase.from(\'factures_emises\').update(champs).eq(\'id\', id)')[0].colonnes).toBeNull()
  })

  it('ne prend pas la lecture d\'une table pour l\'écriture de la suivante', () => {
    const source = 'supabase.from(\'factures_emises\').select(\'*\')\nsupabase.from(\'pieces\').update({ notes: 1 })'
    expect(ecrituresDeFactures('a.ts', source)).toEqual([])
  })

  it('voit une écriture des lignes, quelle que soit sa forme', () => {
    const source = 'await supabase.from("facture_lignes").delete().eq("facture_id", id)\nawait supabase.from("facture_lignes").insert(lignes)'
    expect(ecrituresDeFactures('a.ts', source).map((e) => `${e.table} ${e.forme}`)).toEqual(['facture_lignes delete', 'facture_lignes insert'])
  })

  it('ne lit pas une écriture citée en commentaire', () => {
    expect(ecrituresDeFactures('a.ts', '// supabase.from("factures_emises").update({ notes: 1 })\n')).toEqual([])
  })

  it('lit la liste du déclencheur, et lève quand elle manque', () => {
    expect(colonnesModifiables("v_modifiables constant text[] := array['b', 'a'];")).toEqual(['a', 'b'])
    expect(() => colonnesModifiables('rien')).toThrow(/introuvable/)
  })
})

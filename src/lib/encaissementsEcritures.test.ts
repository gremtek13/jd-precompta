import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TABLES_AUTO_REFERENCEES, TABLES_AUTO_REFERENCEES_PAR_VAGUES } from './sauvegarde'

// LE REGISTRE DES ENCAISSEMENTS NE S'ÉCRIT QUE PAR SES DEUX FONCTIONS (ligne 28.5, étape d3).
//
// Un encaissement d'une facture émise est une AFFIRMATION que l'administration recevra : la plateforme ne dédoublonne pas
// les statuts, et un encaissement compté deux fois l'est pour de bon, la TVA avec lui. D'où un registre que seules
// `enregistrer_encaissement` (les douze refus, les plafonds sous verrou) et `retirer_encaissement` écrivent (entrée d1).
// Mais la policy de la table laisse une porte : la restauration d'une sauvegarde, par le super-administrateur — le chef
// du cabinet en production —, insère en direct, sans les plafonds de la fonction (le déclencheur garde la facture, le
// mouvement, l'annulation et la répartition, pas le total). C'est voulu pour elle seule : elle rejoue un registre qui a
// déjà passé ces contrôles. Une autre écriture directe, écrite demain par commodité depuis un écran, passerait les
// mêmes portes avec un montant que personne n'aurait plafonné — et rien d'autre que ce test ne la verrait : les tests
// d'écran doublent Supabase.
//
// LA DOCTRINE DES SCANNERS (CLAUDE.md) : il part de TOUT `src/` (et des Edge Functions), lit l'EXPRESSION et non la
// ligne — une chaîne s'arrête au `.from(` suivant, les retours à la ligne ne la coupent pas —, ne saute aucune forme
// qu'il ne reconnaît pas : une table qu'il ne sait pas nommer est une faute, sauf exception qui porte sa raison ET son
// nombre. Un plancher distingue « zéro faute » d'« aveugle ». Et il est éprouvé par des défauts plantés, plus bas.

export const TABLES_DU_REGISTRE = ['encaissements_factures', 'encaissements_factures_taux'] as const

/**
 * Les fichiers qui écrivent dans une table qu'ils ne nomment pas en clair, avec la raison et le NOMBRE de ces écritures.
 * Une de plus est une écriture nouvelle à juger ; une de moins, une raison morte.
 */
const EXCEPTIONS: Record<string, { nombre: number; raison: string }> = {
  'src/lib/sauvegardeDonnees.ts': {
    nombre: 2,
    raison: 'La restauration d’une sauvegarde : l’insertion par lots de chaque table du plan (dont les deux du registre, '
      + 'par vagues) et la seconde passe des liens auto-référencés, qui ne vise que TABLES_AUTO_REFERENCEES — '
      + 'aucune table du registre, vérifié ci-dessous. Seule porte d’insertion directe admise (entrée d1).',
  },
}

// Ce qui s'écrit `.from(` sans être une table : un compartiment de stockage, et les constructeurs de JavaScript.
const RECEVEURS_HORS_TABLE = new Set(['storage', 'Array', 'Uint8Array', 'Buffer'])

export interface Source { chemin: string; texte: string }

function fichiers(dossier: URL, garder: (nom: string) => boolean): Source[] {
  const sortie: Source[] = []
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    if (e.isDirectory()) sortie.push(...fichiers(new URL(`${e.name}/`, dossier), garder))
    else if (garder(e.name)) sortie.push({ chemin: new URL(e.name, dossier).pathname, texte: readFileSync(new URL(e.name, dossier), 'utf8') })
  }
  return sortie
}

/** Toute source de production : l'application (hors tests et outillage de test) et les Edge Functions. */
function sourcesDeProduction(): Source[] {
  const racine = new URL('../../', import.meta.url)
  const appli = fichiers(new URL('src/', racine), (n) => /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n))
    .filter((f) => !f.chemin.includes('/src/test/'))
  const fonctions = fichiers(new URL('supabase/functions/', racine), (n) => /\.(ts|tsx)$/.test(n))
  return [...appli, ...fonctions].map((f) => ({ chemin: f.chemin.replace(racine.pathname, ''), texte: f.texte }))
}

/** Les lignes entièrement en commentaire ne comptent pas : ce dépôt CITE ses défauts dans ses commentaires. */
function sansCommentairesPleins(texte: string): string {
  return texte.split('\n').map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l)).join('\n')
}

/**
 * Les tables qu'un identifiant peut désigner, lues dans son fichier : un paramètre ou une variable typés par une union de
 * chaînes (`table: 'pieces' | 'documents_divers'`), ou une constante initialisée par une chaîne. Null quand rien ne le
 * dit : la table est alors illisible.
 */
export function tablesDeLIdentifiant(code: string, nom: string): string[] | null {
  const echappe = nom.replace(/[$]/g, '\\$')
  const union = new RegExp(`\\b${echappe}\\s*:\\s*((?:['"][\\w]+['"]\\s*\\|?\\s*)+)(?=[,)=;\\n])`).exec(code)
  if (union) return [...union[1].matchAll(/['"](\w+)['"]/g)].map((m) => m[1])
  const constante = new RegExp(`\\bconst\\s+${echappe}\\s*=\\s*['"\`](\\w+)['"\`]\\s*(?:as\\s+const\\s*)?[;\\n]`).exec(code)
  if (constante) return [constante[1]]
  return null
}

export interface SiteFrom {
  chemin: string
  ligne: number
  /** Les tables que la chaîne peut viser ; null : illisible. */
  tables: string[] | null
  /** L'écriture de la chaîne, s'il y en a une. */
  ecriture: 'insert' | 'upsert' | 'update' | 'delete' | null
}

/**
 * Chaque `.from(` d'une source qui vise une table, avec la ou les tables visées et l'écriture qui suit. Le corps d'une
 * chaîne s'arrête au `.from(` SUIVANT, quel qu'il soit (la borne de `lecturesPaginees`), et les `\s*` traversent les
 * retours à la ligne.
 */
export function sitesFrom(source: Source): SiteFrom[] {
  const code = sansCommentairesPleins(source.texte)
  const tous = [...code.matchAll(/([\w$)\]]+)\s*\.\s*from\s*\(/g)]
  const sites: SiteFrom[] = []
  for (const [k, m] of tous.entries()) {
    if (RECEVEURS_HORS_TABLE.has(m[1])) continue
    const ouverture = (m.index ?? 0) + m[0].length
    const fin = tous[k + 1]?.index ?? code.length
    const corps = code.slice(ouverture, fin)
    const argument = /^\s*(?:(['"])(\w+)\1|`(\w+)`|([A-Za-z_$][\w$]*)\s*\))/.exec(corps)
    let tables: string[] | null = null
    if (argument?.[2] ?? argument?.[3]) tables = [(argument[2] ?? argument[3]) as string]
    else if (argument?.[4]) tables = tablesDeLIdentifiant(code, argument[4])
    const ecriture = /\.\s*(insert|upsert|update|delete)\s*\(/.exec(corps)
    sites.push({
      chemin: source.chemin,
      // La ligne du `.from(`, pas celle du client qui le précède à la ligne d'avant.
      ligne: code.slice(0, (m.index ?? 0) + m[0].search(/\.\s*from\s*\($/)).split('\n').length,
      tables,
      ecriture: (ecriture?.[1] ?? null) as SiteFrom['ecriture'],
    })
  }
  return sites
}

/**
 * Les écritures directes qui pourraient atteindre le registre : celles qui nomment une de ses tables, et celles dont la
 * table ne se lit pas — sauf dans un fichier dispensé, au nombre près.
 */
export function ecrituresDuRegistre(
  sources: readonly Source[],
  exceptions: Record<string, { nombre: number; raison: string }> = EXCEPTIONS,
): string[] {
  const fautes: string[] = []
  const illisiblesParFichier = new Map<string, number>()
  for (const site of sources.flatMap(sitesFrom)) {
    if (site.ecriture == null) continue
    const lieu = `${site.chemin}:${site.ligne}`
    if (site.tables == null) {
      illisiblesParFichier.set(site.chemin, (illisiblesParFichier.get(site.chemin) ?? 0) + 1)
      if (!exceptions[site.chemin]) fautes.push(`${lieu} — .${site.ecriture}() sur une table que le scanner ne sait pas nommer`)
      continue
    }
    const visee = site.tables.find((t) => (TABLES_DU_REGISTRE as readonly string[]).includes(t))
    if (visee) fautes.push(`${lieu} — .${site.ecriture}() sur ${visee} : seules ses deux fonctions l’écrivent`)
  }
  for (const [chemin, { nombre }] of Object.entries(exceptions)) {
    const reel = illisiblesParFichier.get(chemin) ?? 0
    if (reel !== nombre) fautes.push(`exception « ${chemin} » annonce ${nombre} écriture(s) illisible(s), il y en a ${reel}`)
  }
  return fautes
}

describe('le registre des encaissements ne s’écrit que par ses deux fonctions', () => {
  const sources = sourcesDeProduction()
  const sites = sources.flatMap(sitesFrom)

  it('aucune écriture directe, hors de la restauration', () => {
    expect(ecrituresDuRegistre(sources)).toEqual([])
  })

  it('la restauration ne vise le registre que par l’insertion : sa seconde passe ne le touche pas', () => {
    const secondes = TABLES_AUTO_REFERENCEES.map((t) => t.table)
    for (const t of TABLES_DU_REGISTRE) expect(secondes).not.toContain(t)
    // Le registre se restaure par vagues, en insertions distinctes (entrée d1).
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((t) => t.table)).toContain('encaissements_factures')
  })

  it('les deux fonctions ne s’appellent que de la fenêtre des encaissements', () => {
    const appelants = (fonction: string) => sources
      .filter((s) => new RegExp(`\\.rpc\\(\\s*['"]${fonction}['"]`).test(sansCommentairesPleins(s.texte)))
      .map((s) => s.chemin)
    expect(appelants('enregistrer_encaissement')).toEqual(['src/pages/dossier/EncaissementsFactureModal.tsx'])
    expect(appelants('retirer_encaissement')).toEqual(['src/pages/dossier/EncaissementsFactureModal.tsx'])
  })

  // LE PLANCHER : sans lui, « aucune faute » serait aussi ce que rend un scanner devenu aveugle — un motif de `.from(`
  // cassé, un dossier qu'on ne parcourt plus.
  it('voit encore quelque chose', () => {
    const nommes = sites.filter((s) => s.tables != null)
    expect(nommes.length).toBeGreaterThanOrEqual(400)
    expect(new Set(nommes.flatMap((s) => s.tables ?? [])).size).toBeGreaterThanOrEqual(40)
    expect(sites.filter((s) => s.ecriture != null).length).toBeGreaterThanOrEqual(80)
    // Les deux tables du registre sont LUES par les écrans : le scanner les voit passer.
    for (const t of TABLES_DU_REGISTRE) expect(nommes.some((s) => s.tables?.includes(t) && s.ecriture == null), t).toBe(true)
    // Les Edge Functions sont parcourues.
    expect(sites.some((s) => s.chemin.startsWith('supabase/functions/'))).toBe(true)
    // Une table passée par un paramètre typé se lit : le dépôt d'une pièce ou d'un document.
    const deposes = sites.filter((s) => s.chemin === 'src/lib/depot.ts' && s.ecriture === 'insert' && s.tables?.length === 2)
    expect(deposes.map((s) => s.tables)).toEqual([['pieces', 'documents_divers']])
  })
})

describe('le scanner, éprouvé par des défauts plantés', () => {
  const juger = (texte: string, chemin = 'src/faux.ts') => ecrituresDuRegistre([{ chemin, texte }], {})

  it('attrape une insertion écrite sur plusieurs lignes, dans les deux tables', () => {
    expect(juger(`
      const { error } = await supabase
        .from('encaissements_factures')
        .insert({ facture_id: id, montant: 100 })`)).toEqual(['src/faux.ts:3 — .insert() sur encaissements_factures : seules ses deux fonctions l’écrivent'])
    expect(juger(`await supabase.from("encaissements_factures_taux").delete().eq('encaissement_id', id)`))
      .toEqual(['src/faux.ts:1 — .delete() sur encaissements_factures_taux : seules ses deux fonctions l’écrivent'])
  })

  it('attrape la mise à jour et l’upsert, et une table passée par une constante ou un paramètre typé', () => {
    expect(juger(`const { error } = await admin.from(\`encaissements_factures\`).update({ retire_le: maintenant }).eq('id', id)`)).toHaveLength(1)
    expect(juger(`supabase.from('encaissements_factures_taux').upsert(parts)`)).toHaveLength(1)
    expect(juger(`
      const TABLE = 'encaissements_factures'
      await supabase.from(TABLE).insert(ligne)`)).toEqual(['src/faux.ts:3 — .insert() sur encaissements_factures : seules ses deux fonctions l’écrivent'])
    expect(juger(`
      async function ecrire(table: 'pieces' | 'encaissements_factures', ligne: object) {
        return supabase.from(table).insert(ligne)
      }`)).toEqual(['src/faux.ts:3 — .insert() sur encaissements_factures : seules ses deux fonctions l’écrivent'])
  })

  it('une table qu’il ne sait pas nommer est une faute, jamais un saut', () => {
    expect(juger(`await supabase.from(passe.table).update({ x: 1 })`)).toEqual(['src/faux.ts:1 — .update() sur une table que le scanner ne sait pas nommer'])
    expect(juger(`await supabase.from(nomDeTable).insert(lignes)`)).toHaveLength(1)
  })

  it('une exception compte ses écritures : une de plus est une faute', () => {
    const texte = `await supabase.from(a).insert(x)\nawait supabase.from(b).insert(y)`
    expect(ecrituresDuRegistre([{ chemin: 'src/r.ts', texte }], { 'src/r.ts': { nombre: 2, raison: 'essai' } })).toEqual([])
    expect(ecrituresDuRegistre([{ chemin: 'src/r.ts', texte }], { 'src/r.ts': { nombre: 1, raison: 'essai' } }))
      .toEqual(['exception « src/r.ts » annonce 1 écriture(s) illisible(s), il y en a 2'])
  })

  it('ne crie pas sur une lecture, ni sur une écriture d’une autre table qui suit la lecture', () => {
    expect(juger(`
      const lu = await supabase.from('encaissements_factures').select('*', { count: 'exact' }).eq('dossier_id', d)
      await supabase.from('pieces').update({ statut: 'validee' }).eq('id', p)`)).toEqual([])
    // Ni sur un commentaire qui cite le défaut, ni sur le stockage, ni sur un constructeur de JavaScript.
    expect(juger(`
      // supabase.from('encaissements_factures').insert(x) serait une faute
      await supabase.storage.from(seau).update(chemin, fichier)
      const octets = Uint8Array.from(liste).map((x) => x)`)).toEqual([])
  })
})

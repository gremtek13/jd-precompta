import { describe, expect, it } from 'vitest'
import {
  DERNIER_JOUR_DE_VALIDITE, ELEMENTS_PROPOSES_PAR_A9, LIBELLES_DES_NATURES, LONGUEUR_MAX_TEXTE, LONGUEUR_MAX_TITRE,
  NATURES_DU_DOSSIER_PERMANENT, PREMIER_JOUR_DE_VALIDITE, REFUS_CONSIGNATION, REFUS_RETRAIT, argumentsDeConsigner,
  argumentsDeRetirer, elementsSansEntree, entreesDeLExercice, entreesDuDossierPermanent, etatDeLaCitation, lireLaCitation,
  natureQuiGardeLaSource, refusDeConsigner, refusDeRetirer, refusDuRetraitDUneSourceCitee, refusDuRetraitParLeDossierPermanent,
  vautPourLExercice, type ArgumentsConsigner, type ContexteDuDossierPermanent, type SaisieDuDossierPermanent,
} from './dossierPermanent'
import type { EntreeDossierPermanent, RevisionJustification, RevisionPreuve } from './types'
import { argumentsSql, codesSql, messagesSql, numerosSql } from '../test/raiseSql'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// LE DOSSIER PERMANENT (ligne 41, étape R7), confronté à ce qui fait foi : la migration `dossier_permanent` — le texte des
// deux fonctions, de la garde et de `garder_source_citee` que l'export porte — pour l'ordre, les mots, les codes et les
// numéros des refus, les listes et les bornes ; l'essai (supabase/essais/dossierPermanent.sql) est rejoué à part,
// appel par appel (dossierPermanentEssai.test.ts). CHAQUE AUTRE ATTENDU EST ÉCRIT À LA MAIN, depuis la règle que cite la
// ligne de commentaire qui le précède. Données FICTIVES.

const sqlDe = (nom: string) => derniereDefinitionSql(nom)
const parametresDe = (nom: string) => (/function public\.\w+\(([^)]*)\)/.exec(sqlDe(nom))?.[1] ?? '')
  .split(',').map((p) => p.trim().split(/\s+/)[0])

function migration(): string {
  const f = fichiersDuSchema().find((x) => x.texte.includes('create table public.dossier_permanent ('))
  expect(f, 'la migration du dossier permanent dans l’export').toBeDefined()
  return f?.texte ?? ''
}

const D = 'aaaaaaaa-0000-4000-8000-000000000001'
const AUTRE_DOSSIER = 'aaaaaaaa-0000-4000-8000-000000000002'
const P1 = 'bbbbbbbb-0000-4000-8000-000000000001'
const P2 = 'bbbbbbbb-0000-4000-8000-000000000002'
const D1 = 'cccccccc-0000-4000-8000-000000000001'
const ID = (n: number) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`

function entree(o: Partial<EntreeDossierPermanent> = {}): EntreeDossierPermanent {
  return {
    id: ID(1), dossier_id: D, nature: 'lettre_mission', titre: 'Lettre de mission', texte: 'Présentation des comptes.',
    piece_id: null, document_id: null, fichier_id: null, empreinte: null, valable_du: '2026-01-01', valable_jusqu_au: null,
    remplace_id: null, auteur: 'u1', cree_le: '2026-01-05T10:00:00+00:00', retire_le: null, retire_par: null, ...o,
  }
}

// Une entrée juste, que la base accepte : le cabinet a l'accès, la pièce citée est du dossier.
function args(o: Partial<ArgumentsConsigner> = {}): ArgumentsConsigner {
  return {
    p_dossier_id: D, p_nature: 'bail', p_titre: 'Bail', p_texte: 'Bail commercial.', p_citation: { piece_id: P1 },
    p_valable_du: '2024-07-01', p_valable_jusqu_au: '2033-06-30', p_remplace_id: null, ...o,
  }
}

function contexte(o: Partial<ContexteDuDossierPermanent> = {}): ContexteDuDossierPermanent {
  return { accesAuDossier: true, entrees: [], pieces: [P1, P2], documents: [D1], ...o }
}

const cle = (a: Partial<ArgumentsConsigner>, c: Partial<ContexteDuDossierPermanent> = {}) =>
  refusDeConsigner(args(a), contexte(c))?.cle ?? 'aucun'

// ── Les refus, confrontés au texte des fonctions ──────────────────────────────────────────────────────────────────

describe.each([
  { nom: 'consigner_au_dossier_permanent', liste: REFUS_CONSIGNATION, codes: (r: { refus: number }) => (r.refus === 1 ? '42501' : '22023') },
  {
    nom: 'retirer_du_dossier_permanent', liste: REFUS_RETRAIT,
    codes: (r: { refus: number }) => (r.refus === 1 ? '42501' : r.refus === 2 ? 'P0002' : '22023'),
  },
])('les refus de $nom, tels que la migration les écrit', ({ nom, liste, codes }) => {
  const sql = sqlDe(nom)

  it('les mêmes messages, dans le même ordre, sans aucun « % »', () => {
    expect(liste.map((r) => r.modele)).toEqual(messagesSql(sql))
    expect(new Set(liste.map((r) => r.cle)).size).toBe(liste.length)
    expect(argumentsSql(sql).every((v) => v.length === 0)).toBe(true)
    expect(liste.every((r) => !r.modele.includes('%'))).toBe(true)
  })

  it('les mêmes codes, et les mêmes numéros, dans l’ordre', () => {
    expect(codesSql(sql)).toEqual(liste.map(codes))
    const n = liste.map((r) => r.refus)
    expect(n).toEqual(numerosSql(sql))
    expect(n).toEqual([...n].sort((a, b) => a - b))
  })

  // LA BORNE DU HARNAIS : une confrontation qui ne saurait pas virer au rouge ne prouverait rien.
  it('vire au rouge sur une dérive plantée dans le texte de la fonction', () => {
    const attendu = liste.map((r) => r.modele)
    const second = `'${liste[1].modele.replace(/'/g, "''")}'`
    expect(sql).toContain(second)
    expect(messagesSql(sql.replace(second, "'Un autre mot.'"))).not.toEqual(attendu)
    // Deux refus voisins de mots différents, échangés : les deux derniers de la consignation disent la même phrase.
    const i = [...liste.keys()].reverse().find((k) => k > 0 && liste[k - 1].modele !== liste[k].modele) ?? 1
    const a = `raise exception '${liste[i - 1].modele.replace(/'/g, "''")}'`
    const b = `raise exception '${liste[i].modele.replace(/'/g, "''")}'`
    expect(sql).toContain(a)
    expect(sql).toContain(b)
    expect(messagesSql(sql.replace(a, '§').replace(b, a).replace('§', b))).not.toEqual(attendu)
    expect(numerosSql(sql.replace(/-- 3\./, '-- 33.'))).not.toEqual(liste.map((r) => r.refus))
  })
})

describe('les listes, les bornes et les paramètres sont ceux de la migration', () => {
  const texte = migration()
  const liste = (s: string) => [...s.matchAll(/'(\w+)'/g)].map((m) => m[1])

  it('les huit natures : la table, la fonction et la garde des sources, dans l’ordre de A9', () => {
    const table = /constraint dossier_permanent_nature check \(nature in \(([^)]*)\)\)/.exec(texte)?.[1] ?? ''
    const fonction = /p_nature not in \(([^)]*)\)/.exec(sqlDe('consigner_au_dossier_permanent'))?.[1] ?? ''
    const garde = [...sqlDe('garder_source_citee').matchAll(/array_position\(array\[([^\]]*)\]/g)].map((m) => liste(m[1]))
    expect(liste(table)).toEqual(NATURES_DU_DOSSIER_PERMANENT)
    expect(liste(fonction)).toEqual(NATURES_DU_DOSSIER_PERMANENT)
    expect(garde).toEqual([NATURES_DU_DOSSIER_PERMANENT, NATURES_DU_DOSSIER_PERMANENT])
  })

  it('le libellé de chaque nature est celui que la garde des sources écrit', () => {
    const cas = /case v_nature ([\s\S]*?) end,/.exec(sqlDe('garder_source_citee'))?.[1] ?? ''
    const paires = [...cas.matchAll(/when '(\w+)' then '((?:[^']|'')*)'/g)].map((m) => [m[1], m[2].replace(/''/g, "'")])
    const sinon = /else '((?:[^']|'')*)'$/.exec(cas.trim())?.[1]
    expect(Object.fromEntries([...paires, ['autre', sinon]])).toEqual(LIBELLES_DES_NATURES)
    expect(paires.map((p) => p[0])).toEqual(NATURES_DU_DOSSIER_PERMANENT.filter((n) => n !== 'autre'))
  })

  it('les longueurs, les bornes de la validité et les blancs, à la table et dans la fonction', () => {
    const fonction = sqlDe('consigner_au_dossier_permanent')
    expect(texte).toContain(`btrim(titre, E' \\t\\n\\r') <> '' and length(titre) <= ${LONGUEUR_MAX_TITRE}`)
    expect(texte).toContain(`btrim(texte, E' \\t\\n\\r') <> '' and length(texte) <= ${LONGUEUR_MAX_TEXTE}`)
    expect(fonction).toContain(`if length(p_titre) > ${LONGUEUR_MAX_TITRE} then`)
    expect(fonction).toContain(`if length(p_texte) > ${LONGUEUR_MAX_TEXTE} then`)
    expect(fonction).toContain("btrim(p_titre, E' \\t\\n\\r') = ''")
    expect(fonction).toContain("btrim(p_texte, E' \\t\\n\\r') = ''")
    const bornes = `between date '${PREMIER_JOUR_DE_VALIDITE}' and date '${DERNIER_JOUR_DE_VALIDITE}'`
    expect(texte.split(bornes).length - 1).toBe(4)
    expect(fonction).toContain('if p_valable_jusqu_au < p_valable_du then')
  })

  it('la citation : une seule clé, piece_id ou document_id, une valeur qui s’écrit comme un uuid', () => {
    const fonction = sqlDe('consigner_au_dossier_permanent')
    expect(fonction).toContain("v_citation jsonb := nullif(p_citation, 'null'::jsonb);")
    expect(fonction).toContain('(select count(*) from jsonb_object_keys(v_citation)) <> 1')
    expect(fonction).toContain("k.cle not in ('piece_id', 'document_id')")
    expect(fonction).toContain("!~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'")
  })

  it('les paramètres, dans l’ordre des signatures', () => {
    const saisie: SaisieDuDossierPermanent = {
      nature: 'bail', titre: 'Bail', texte: '', citation: null, valableDu: null, valableJusquAu: null,
    }
    expect(Object.keys(argumentsDeConsigner(D, saisie, null))).toEqual(parametresDe('consigner_au_dossier_permanent'))
    expect(parametresDe('consigner_au_dossier_permanent')).toHaveLength(8)
    expect(Object.keys(argumentsDeRetirer(D, ID(1)))).toEqual(parametresDe('retirer_du_dossier_permanent'))
  })

  it('la garde prend le verrou de la révision par la clé de cle_revision, avant de lire, sur un retrait et sur une version', () => {
    // La clé de `cle_revision` (étape R1), son paramètre remplacé par la ligne que la garde regarde : un verrou pris sous
    // une autre clé ne ferait rien attendre.
    const cleRevision = /select (hashtextextended\('jd\.revision_des_comptes:' \|\| )p_dossier_id(::text, 0\))/
      .exec(sqlDe('cle_revision'))
    expect(cleRevision).not.toBeNull()
    const garde = sqlDe('garder_dossier_permanent')
    for (const ligne of ['old', 'new']) {
      expect(garde).toContain(`perform pg_advisory_xact_lock(${cleRevision?.[1]}${ligne}.dossier_id${cleRevision?.[2]});`)
    }
    // Avant de lire : la suite d'une version retirée, l'état de la version remplacée.
    expect(garde.indexOf("old.dossier_id::text, 0));")).toBeLessThan(garde.indexOf('where s.remplace_id = old.id'))
    expect(garde.indexOf("new.dossier_id::text, 0));")).toBeLessThan(garde.indexOf('e.retire_le is not null'))
  })
})

// ── La citation ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('lireLaCitation — la citation telle que la base la lit (refus 5)', () => {
  it('rien, une pièce, un document ; un identifiant en majuscules aussi', () => {
    expect(lireLaCitation(null)).toBeNull()
    expect(lireLaCitation(undefined)).toBeNull()
    expect(lireLaCitation({ piece_id: P1 })).toEqual({ pieceId: P1 })
    expect(lireLaCitation({ document_id: D1 })).toEqual({ documentId: D1 })
    expect(lireLaCitation({ piece_id: P1.toUpperCase() })).toEqual({ pieceId: P1.toUpperCase() })
  })

  it('tout le reste est illisible', () => {
    for (const c of [[], [{ piece_id: P1 }], P1, 1, true, {}, { piece_id: P1, document_id: D1 }, { fichier_id: P1 },
      { piece: P1 }, { piece_id: null }, { piece_id: 12 }, { piece_id: 'pas-un-identifiant' }, { piece_id: [P1] },
      { piece_id: { id: P1 } }, { document_id: ` ${D1}` }, { document_id: `${D1} ` }, { piece_id: `{${P1}}` },
      { piece_id: P1.replace(/-/g, '') }]) {
      expect(lireLaCitation(c), JSON.stringify(c)).toBe('illisible')
    }
  })
})

// ── Les refus dits avant le clic ──────────────────────────────────────────────────────────────────────────────────

describe('refusDeConsigner — dit avant le clic ce que la base refuserait', () => {
  it('accepte une entrée juste, une entrée sans citation, une entrée sans texte', () => {
    expect(cle({})).toBe('aucun')
    expect(cle({ p_citation: null })).toBe('aucun')
    expect(cle({ p_texte: null })).toBe('aucun')
    expect(cle({ p_citation: { document_id: D1 }, p_texte: null })).toBe('aucun')
  })

  it('1. l’accès (hypothèse Q2), avant tout le reste', () => {
    expect(refusDeConsigner(args({ p_nature: null }), contexte({ accesAuDossier: false })))
      .toEqual({ cle: 'acces', refus: 1, code: '42501', message: 'Accès refusé à ce dossier.' })
  })

  it('2. une des huit natures, à la lettre', () => {
    for (const n of NATURES_DU_DOSSIER_PERMANENT) expect(cle({ p_nature: n }), n).toBe('aucun')
    for (const n of [null, '', 'Bail', ' bail', 'bail ', 'contrat_de_travail', 'lettre-mission']) expect(cle({ p_nature: n }), String(n)).toBe('nature')
    expect(cle({ p_nature: 'x', p_titre: null })).toBe('nature')
  })

  it('3. un titre : absent, vide, fait des quatre blancs ; une espace insécable n’en est pas un ; 500 caractères', () => {
    for (const t of [null, '', ' ', '\t', '\n', '\r', ' \t\n\r']) expect(cle({ p_titre: t }), JSON.stringify(t)).toBe('titre_absent')
    expect(cle({ p_titre: ' ' })).toBe('aucun')
    expect(cle({ p_titre: 't'.repeat(500) })).toBe('aucun')
    expect(cle({ p_titre: 't'.repeat(501) })).toBe('titre_trop_long')
    // `length` compte des caractères : 500 « é » passent, un caractère hors du plan de base compte pour un.
    expect(cle({ p_titre: 'é'.repeat(500) })).toBe('aucun')
    expect(cle({ p_titre: 'é'.repeat(501) })).toBe('titre_trop_long')
    expect(cle({ p_titre: '𝄞'.repeat(500) })).toBe('aucun')
    expect(cle({ p_titre: '𝄞'.repeat(501) })).toBe('titre_trop_long')
    // Le titre avant le texte.
    expect(cle({ p_titre: null, p_texte: ' ' })).toBe('titre_absent')
    expect(cle({ p_titre: 't'.repeat(501), p_texte: 't'.repeat(8001) })).toBe('titre_trop_long')
  })

  it('4. un texte facultatif : fait de blancs ou vide, il se refuse ; 8 000 caractères', () => {
    for (const t of ['', ' ', ' \t\n\r']) expect(cle({ p_texte: t }), JSON.stringify(t)).toBe('texte_blanc')
    expect(cle({ p_texte: ' ', p_citation: null })).toBe('aucun')
    expect(cle({ p_texte: 't'.repeat(8000) })).toBe('aucun')
    expect(cle({ p_texte: 't'.repeat(8001) })).toBe('texte_trop_long')
    expect(cle({ p_texte: '𝄞'.repeat(8000) })).toBe('aucun')
    expect(cle({ p_texte: '𝄞'.repeat(8001) })).toBe('texte_trop_long')
    // Le texte avant la citation.
    expect(cle({ p_texte: ' ', p_citation: [] })).toBe('texte_blanc')
    expect(cle({ p_texte: 't'.repeat(8001), p_citation: {} })).toBe('texte_trop_long')
  })

  it('5. une citation illisible, avant tout ce qui lit la base', () => {
    expect(cle({ p_citation: [] })).toBe('citation_illisible')
    expect(cle({ p_citation: { fichier_id: P1 } })).toBe('citation_illisible')
    expect(cle({ p_citation: [], p_valable_du: '1899-12-31', p_remplace_id: ID(9) })).toBe('citation_illisible')
  })

  it('6. une entrée dit quelque chose : un texte, ou une citation', () => {
    expect(cle({ p_texte: null, p_citation: null })).toBe('rien_a_dire')
    expect(cle({ p_texte: null, p_citation: null, p_valable_du: '2101-01-01', p_valable_jusqu_au: '1899-12-31' })).toBe('rien_a_dire')
  })

  it('7. la validité : de 1900 à 2100, bornes comprises ; la fin jamais avant le début', () => {
    expect(cle({ p_valable_du: '1899-12-31' })).toBe('validite_hors_bornes')
    expect(cle({ p_valable_du: '1900-01-01', p_valable_jusqu_au: null })).toBe('aucun')
    expect(cle({ p_valable_jusqu_au: '2101-01-01' })).toBe('validite_hors_bornes')
    expect(cle({ p_valable_du: null, p_valable_jusqu_au: '2100-12-31' })).toBe('aucun')
    expect(cle({ p_valable_du: '2101-01-01', p_valable_jusqu_au: null })).toBe('validite_hors_bornes')
    expect(cle({ p_valable_du: null, p_valable_jusqu_au: '1899-12-31' })).toBe('validite_hors_bornes')
    expect(cle({ p_valable_du: '2026-01-02', p_valable_jusqu_au: '2026-01-01' })).toBe('validite_inversee')
    expect(cle({ p_valable_du: '2026-01-01', p_valable_jusqu_au: '2026-01-01' })).toBe('aucun')
    expect(cle({ p_valable_du: null, p_valable_jusqu_au: null })).toBe('aucun')
    // Les bornes avant l'ordre.
    expect(cle({ p_valable_du: '2101-01-01', p_valable_jusqu_au: '2026-01-01' })).toBe('validite_hors_bornes')
  })

  it('8. la version courante d’une entrée du dossier, et une entrée qui n’est pas retirée', () => {
    const courante = entree({ id: ID(1) })
    const ancienne = entree({ id: ID(2) })
    const nouvelle = entree({ id: ID(3), remplace_id: ID(2) })
    const retiree = entree({ id: ID(4), retire_le: '2026-02-01T10:00:00+00:00', retire_par: 'u1' })
    const ailleurs = entree({ id: ID(5), dossier_id: AUTRE_DOSSIER })
    const entrees = [courante, ancienne, nouvelle, retiree, ailleurs]
    expect(cle({ p_remplace_id: ID(1) }, { entrees })).toBe('aucun')
    expect(cle({ p_remplace_id: ID(1).toUpperCase() }, { entrees })).toBe('aucun')
    expect(cle({ p_remplace_id: ID(3) }, { entrees })).toBe('aucun')
    expect(cle({ p_remplace_id: ID(2) }, { entrees })).toBe('remplacement_perime')
    expect(cle({ p_remplace_id: ID(4) }, { entrees })).toBe('remplacement_retiree')
    expect(cle({ p_remplace_id: ID(5) }, { entrees })).toBe('remplacement_hors_dossier')
    expect(cle({ p_remplace_id: ID(99) }, { entrees })).toBe('remplacement_hors_dossier')
    // Avant la source : une version périmée qui citerait une pièce d'ailleurs se dit périmée.
    expect(cle({ p_remplace_id: ID(2), p_citation: { piece_id: 'eeeeeeee-0000-4000-8000-000000000001' } }, { entrees }))
      .toBe('remplacement_perime')
  })

  it('9. la source citée est une pièce ou un document du dossier, et pas l’un pour l’autre', () => {
    expect(cle({ p_citation: { piece_id: P2 } })).toBe('aucun')
    expect(cle({ p_citation: { piece_id: P1.toUpperCase() } })).toBe('aucun')
    expect(cle({ p_citation: { piece_id: 'eeeeeeee-0000-4000-8000-000000000001' } })).toBe('piece_hors_dossier')
    expect(cle({ p_citation: { document_id: P1 } })).toBe('document_hors_dossier')
    expect(cle({ p_citation: { piece_id: D1 } })).toBe('piece_hors_dossier')
    expect(cle({ p_citation: { document_id: D1 } }, { documents: [] })).toBe('document_hors_dossier')
    // Les deux refus disent la même phrase, celle de la base.
    expect(refusDeConsigner(args({ p_citation: { document_id: P1 } }), contexte())?.message)
      .toBe(refusDeConsigner(args({ p_citation: { piece_id: D1 } }), contexte())?.message)
  })

  it('rend le rang, le code et les mots', () => {
    expect(refusDeConsigner(args({ p_valable_du: '2026-02-01', p_valable_jusqu_au: '2026-01-01' }), contexte()))
      .toEqual({ cle: 'validite_inversee', refus: 7, code: '22023', message: 'La fin de validité précède son début.' })
  })
})

describe('refusDeRetirer — dit avant le clic ce que la base refuserait', () => {
  const courante = entree({ id: ID(1) })
  const ancienne = entree({ id: ID(2) })
  const nouvelle = entree({ id: ID(3), remplace_id: ID(2) })
  const retiree = entree({ id: ID(4), retire_le: '2026-02-01T10:00:00+00:00', retire_par: 'u1' })
  const ailleurs = entree({ id: ID(5), dossier_id: AUTRE_DOSSIER })
  const entrees = [courante, ancienne, nouvelle, retiree, ailleurs]
  const dit = (id: string | null, acces = true) => refusDeRetirer({ p_dossier_id: D, p_entree_id: id }, { accesAuDossier: acces, entrees })

  it('la version courante se retire, une fois', () => {
    expect(dit(ID(1))).toBeNull()
    expect(dit(ID(3))).toBeNull()
    expect(dit(ID(2))?.cle).toBe('remplacee_depuis')
    expect(dit(ID(4))?.cle).toBe('deja_retiree')
  })

  it('l’accès d’abord, puis l’entrée dans ce dossier — introuvable en P0002', () => {
    expect(dit(ID(99), false)).toEqual({ cle: 'acces', refus: 1, code: '42501', message: 'Accès refusé à ce dossier.' })
    expect(dit(ID(5))).toEqual({ cle: 'introuvable', refus: 2, code: 'P0002', message: 'Entrée introuvable dans ce dossier.' })
    expect(dit(ID(99))?.code).toBe('P0002')
    expect(dit(null)?.code).toBe('P0002')
    expect(dit(ID(1).toUpperCase())).toBeNull()
  })
})

// ── Ce que l'écran envoie ─────────────────────────────────────────────────────────────────────────────────────────

describe('argumentsDeConsigner — ce que l’écran envoie', () => {
  const saisie = (o: Partial<SaisieDuDossierPermanent> = {}): SaisieDuDossierPermanent => ({
    nature: 'bail', titre: 'Bail', texte: 'Bail commercial.', citation: { pieceId: P1 }, valableDu: '2024-07-01',
    valableJusquAu: null, ...o,
  })

  it('les huit arguments, nuls plutôt qu’absents ; la citation en objet', () => {
    expect(argumentsDeConsigner(D, saisie(), ID(1))).toEqual({
      p_dossier_id: D, p_nature: 'bail', p_titre: 'Bail', p_texte: 'Bail commercial.', p_citation: { piece_id: P1 },
      p_valable_du: '2024-07-01', p_valable_jusqu_au: null, p_remplace_id: ID(1),
    })
    expect(argumentsDeConsigner(D, saisie({ citation: { documentId: D1 } }), null).p_citation).toEqual({ document_id: D1 })
    expect(argumentsDeConsigner(D, saisie({ citation: null }), null).p_citation).toBeNull()
    expect(argumentsDeConsigner(D, saisie({ nature: null }), null).p_nature).toBeNull()
  })

  it('des blancs partent nuls ; une espace insécable, non', () => {
    const a = argumentsDeConsigner(D, saisie({ titre: ' \t', texte: '\n\r ' }), null)
    expect([a.p_titre, a.p_texte]).toEqual([null, null])
    expect(refusDeConsigner(a, contexte())?.cle).toBe('titre_absent')
    expect(argumentsDeConsigner(D, saisie({ texte: '' }), null).p_texte).toBeNull()
    expect(argumentsDeConsigner(D, saisie({ texte: ' ' }), null).p_texte).toBe(' ')
    // Un texte de blancs parti nul, et une citation : l'entrée part sans texte.
    expect(refusDeConsigner(argumentsDeConsigner(D, saisie({ texte: '  ' }), null), contexte())).toBeNull()
    expect(refusDeConsigner(argumentsDeConsigner(D, saisie({ texte: '  ', citation: null }), null), contexte())?.cle).toBe('rien_a_dire')
  })

  it('une date qui n’en est pas une ne part pas', () => {
    for (const d of ['', '2026-02-30', '2026-13-01', '01/07/2024', '2024-7-1', '2023-02-29']) {
      expect(argumentsDeConsigner(D, saisie({ valableDu: d }), null).p_valable_du, d).toBeNull()
    }
    expect(argumentsDeConsigner(D, saisie({ valableDu: '2024-02-29' }), null).p_valable_du).toBe('2024-02-29')
    expect(argumentsDeConsigner(D, saisie({ valableJusquAu: '2033-06-30' }), null).p_valable_jusqu_au).toBe('2033-06-30')
  })

  it('le retrait : le dossier et l’entrée', () => {
    expect(argumentsDeRetirer(D, ID(1))).toEqual({ p_dossier_id: D, p_entree_id: ID(1) })
  })
})

// ── Les entrées, leurs versions, l'exercice ───────────────────────────────────────────────────────────────────────

describe('entreesDuDossierPermanent — la chaîne de chaque entrée, et sa version courante', () => {
  it('une entrée par chaîne, ses versions de la première à la courante, dans l’ordre de leur première version', () => {
    const v1 = entree({ id: ID(1), cree_le: '2026-01-05T10:00:00+00:00' })
    const v2 = entree({ id: ID(2), remplace_id: ID(1), cree_le: '2026-01-06T10:00:00+00:00' })
    const v3 = entree({ id: ID(3), remplace_id: ID(2), cree_le: '2026-01-07T10:00:00+00:00' })
    const bail = entree({ id: ID(4), nature: 'bail', cree_le: '2026-01-01T10:00:00+00:00', retire_le: '2026-03-01T10:00:00+00:00', retire_par: 'u1' })
    const lues = entreesDuDossierPermanent([v3, v1, bail, v2])
    expect(lues.lisible).toBe(true)
    expect(lues.entrees.map((e) => [e.versions.map((v) => v.id), e.courante.id, e.retiree])).toEqual([
      [[ID(4)], ID(4), true],
      [[ID(1), ID(2), ID(3)], ID(3), false],
    ])
  })

  it('à instant égal, l’identifiant départage ; un identifiant se compare sans la casse', () => {
    const a = entree({ id: ID(2) })
    const b = entree({ id: ID(1) })
    const suite = entree({ id: ID(3), remplace_id: ID(1).toUpperCase(), cree_le: '2026-02-01T00:00:00+00:00' })
    const lues = entreesDuDossierPermanent([a, b, suite])
    expect(lues.lisible).toBe(true)
    expect(lues.entrees.map((e) => e.versions.map((v) => v.id))).toEqual([[ID(1), ID(3)], [ID(2)]])
  })

  it('une entrée est retirée quand sa version COURANTE l’est — la première ne l’est jamais quand elle a une suite', () => {
    // La garde ne retire que la courante (« Seule la version courante … se retire ») : une chaîne de deux versions dont la
    // seconde est retirée est une entrée retirée, qui ne vaut plus pour aucun exercice.
    const v1 = entree({ id: ID(1) })
    const v2 = entree({ id: ID(2), remplace_id: ID(1), cree_le: '2026-01-06T10:00:00+00:00', retire_le: '2026-02-01T10:00:00+00:00', retire_par: 'u1' })
    const lues = entreesDuDossierPermanent([v1, v2])
    expect(lues.lisible).toBe(true)
    expect(lues.entrees.map((e) => [e.courante.id, e.retiree])).toEqual([[ID(2), true]])
    expect(entreesDeLExercice(lues, true, 2026)).toEqual([])
  })

  it('illisible : une version d’une version absente, deux suites à une version, une suite à une retirée, une boucle', () => {
    const v1 = entree({ id: ID(1) })
    expect(entreesDuDossierPermanent([v1, entree({ id: ID(2), remplace_id: ID(9) })]).lisible).toBe(false)
    expect(entreesDuDossierPermanent([v1, entree({ id: ID(2), remplace_id: ID(1) }), entree({ id: ID(3), remplace_id: ID(1) })]).lisible).toBe(false)
    expect(entreesDuDossierPermanent([entree({ id: ID(1), retire_le: '2026-02-01T00:00:00+00:00', retire_par: 'u1' }),
      entree({ id: ID(2), remplace_id: ID(1) })]).lisible).toBe(false)
    expect(entreesDuDossierPermanent([v1, entree({ id: ID(2), remplace_id: ID(3) }), entree({ id: ID(3), remplace_id: ID(2) })]).lisible).toBe(false)
    expect(entreesDuDossierPermanent([]).lisible).toBe(true)
  })
})

describe('l’exercice : ce qui vaut pour lui, ce que A9 propose et qui manque', () => {
  it('une période touche l’année civile, bornes comprises ; nulle, elle ne borne rien', () => {
    expect(vautPourLExercice({ valable_du: null, valable_jusqu_au: null }, 2025)).toBe(true)
    expect(vautPourLExercice({ valable_du: '2025-12-31', valable_jusqu_au: null }, 2025)).toBe(true)
    expect(vautPourLExercice({ valable_du: '2026-01-01', valable_jusqu_au: null }, 2025)).toBe(false)
    expect(vautPourLExercice({ valable_du: null, valable_jusqu_au: '2025-01-01' }, 2025)).toBe(true)
    expect(vautPourLExercice({ valable_du: null, valable_jusqu_au: '2024-12-31' }, 2025)).toBe(false)
    expect(vautPourLExercice({ valable_du: '2020-01-01', valable_jusqu_au: '2030-12-31' }, 2025)).toBe(true)
    expect(vautPourLExercice({ valable_du: '1950-03-01', valable_jusqu_au: null }, 999)).toBe(false)
  })

  const lettre2024 = entree({ id: ID(1), valable_du: '2024-01-01', valable_jusqu_au: '2024-12-31' })
  const lettre2025 = entree({ id: ID(2), valable_du: '2025-01-01', valable_jusqu_au: null })
  const description = entree({ id: ID(3), nature: 'description', valable_du: null })
  const organisation = entree({ id: ID(4), nature: 'organisation_comptable', valable_du: null, retire_le: '2026-01-01T00:00:00+00:00', retire_par: 'u1' })
  // Une version courante qui ne vaut plus pour 2025, l'ancienne valait : seule la courante compte.
  const bailAncien = entree({ id: ID(5), nature: 'bail', valable_du: '2020-01-01', valable_jusqu_au: null })
  const bailNouveau = entree({ id: ID(6), nature: 'bail', remplace_id: ID(5), valable_du: '2026-01-01', valable_jusqu_au: null })
  const lues = entreesDuDossierPermanent([lettre2024, lettre2025, description, organisation, bailAncien, bailNouveau])

  it('les entrées en vigueur pour l’exercice : non retirées, leur version courante dans l’année', () => {
    expect(entreesDeLExercice(lues, true, 2025)?.map((e) => e.courante.id).sort()).toEqual([ID(2), ID(3)])
    expect(entreesDeLExercice(lues, true, 2024)?.map((e) => e.courante.id).sort()).toEqual([ID(1), ID(3)])
    expect(entreesDeLExercice(lues, true, 2026)?.map((e) => e.courante.id).sort()).toEqual([ID(2), ID(3), ID(6)])
  })

  it('ce que A9 propose et qu’aucune entrée en vigueur ne porte : une information, dans l’ordre de A9', () => {
    expect(ELEMENTS_PROPOSES_PAR_A9).toEqual(['lettre_mission', 'description', 'organisation_comptable'])
    expect(elementsSansEntree(lues, true, 2025)).toEqual(['organisation_comptable'])
    expect(elementsSansEntree(entreesDuDossierPermanent([]), true, 2025)).toEqual(ELEMENTS_PROPOSES_PAR_A9)
  })

  it('la nature qui compte est celle de la version courante : une version peut corriger la nature d’une entrée', () => {
    // La fonction ne lie pas la nature d'une version à celle qu'elle remplace (question R7-Q2 au cabinet) : une entrée
    // consignée « autre » puis remplacée par une lettre de mission porte la lettre de mission.
    const autre = entree({ id: ID(1), nature: 'autre', valable_du: null })
    const corrigee = entree({ id: ID(2), nature: 'lettre_mission', remplace_id: ID(1), valable_du: null, cree_le: '2026-01-06T10:00:00+00:00' })
    const corrigees = entreesDuDossierPermanent([autre, corrigee, description])
    expect(elementsSansEntree(corrigees, true, 2025)).toEqual(['organisation_comptable'])
    const inverse = entreesDuDossierPermanent([
      entree({ id: ID(1), nature: 'lettre_mission', valable_du: null }),
      entree({ id: ID(2), nature: 'autre', remplace_id: ID(1), valable_du: null, cree_le: '2026-01-06T10:00:00+00:00' }),
      description,
    ])
    expect(elementsSansEntree(inverse, true, 2025)).toEqual(['lettre_mission', 'organisation_comptable'])
  })

  it('une lecture partielle ou une chaîne illisible : rien ne s’affirme', () => {
    expect(entreesDeLExercice(lues, false, 2025)).toBeNull()
    expect(elementsSansEntree(lues, false, 2025)).toBeNull()
    const illisible = entreesDuDossierPermanent([entree({ id: ID(1), remplace_id: ID(9) })])
    expect(entreesDeLExercice(illisible, true, 2025)).toBeNull()
    expect(elementsSansEntree(illisible, true, 2025)).toBeNull()
  })
})

describe('etatDeLaCitation — ce qu’une citation prouve encore', () => {
  const H = 'ab'.repeat(32)
  const pieces = new Map([[P1, { storage_hash: H }], [P2, { storage_hash: null }]])
  const documents = new Map([[D1, { storage_hash: 'cd'.repeat(32) }]])
  const etat = (o: Partial<EntreeDossierPermanent>) => etatDeLaCitation(entree(o), pieces, documents)

  it('intacte, changée, disparue, sans empreinte, introuvable ; rien sans citation', () => {
    expect(etat({})).toBeNull()
    expect(etat({ piece_id: P1, empreinte: H })).toBe('intacte')
    expect(etat({ piece_id: P1.toUpperCase(), empreinte: H })).toBe('intacte')
    expect(etat({ piece_id: P1, empreinte: 'ef'.repeat(32) })).toBe('changee')
    expect(etat({ piece_id: P2, empreinte: H })).toBe('disparue')
    expect(etat({ piece_id: P2, empreinte: null })).toBe('sans-empreinte')
    expect(etat({ document_id: D1, empreinte: 'cd'.repeat(32) })).toBe('intacte')
    expect(etat({ piece_id: 'eeeeeeee-0000-4000-8000-000000000001', empreinte: H })).toBe('introuvable')
    // Un fichier du cabinet (étape R8) ne se lit pas encore.
    expect(etat({ fichier_id: P1, empreinte: H })).toBe('introuvable')
  })

  it('une empreinte du jour qui n’est pas en minuscules hexadécimales ne vaut rien', () => {
    expect(etatDeLaCitation(entree({ piece_id: P1, empreinte: H }), new Map([[P1, { storage_hash: H.toUpperCase() }]]), documents))
      .toBe('disparue')
  })
})

// ── Une source citée ne se retire plus (hypothèse Q8) ─────────────────────────────────────────────────────────────

describe('ce que garder_source_citee refuserait d’une source citée par le dossier permanent', () => {
  const sql = sqlDe('garder_source_citee')

  it('le message est celui du déclencheur, mot pour mot, après celui de la révision d’un solde', () => {
    const revision = sql.indexOf("raise exception '% par la révision du solde du compte % (exercice %) : %, sauf avec son dossier.'")
    const permanent = sql.indexOf("raise exception '% par le dossier permanent (%) : %, sauf avec son dossier.'")
    expect(revision).toBeGreaterThan(0)
    expect(permanent).toBeGreaterThan(revision)
    expect(sql.slice(permanent)).toContain("case when tg_table_name = 'pieces' then 'Cette pièce est citée' else 'Ce document est cité' end")
  })

  it('chaque nature sous son libellé, à la suppression et au changement de dossier', () => {
    for (const n of NATURES_DU_DOSSIER_PERMANENT) {
      const lignes = [entree({ nature: n, piece_id: P1, texte: null }), entree({ id: ID(2), nature: n, document_id: D1 })]
      expect(refusDuRetraitParLeDossierPermanent({ pieceId: P1 }, 'suppression', lignes))
        .toBe(`Cette pièce est citée par le dossier permanent (${LIBELLES_DES_NATURES[n]}) : elle ne se supprime plus, sauf avec son dossier.`)
      expect(refusDuRetraitParLeDossierPermanent({ documentId: D1 }, 'changement-de-dossier', lignes))
        .toBe(`Ce document est cité par le dossier permanent (${LIBELLES_DES_NATURES[n]}) : il ne change plus de dossier, sauf avec son dossier.`)
    }
  })

  it('la suppression d’un document se dit au masculin — le message que la base a rendu sur la réplique', () => {
    // Relevé le 11/10/2026 sur la réplique de l'étape (la suppression ne se joue pas en production) : un document cité
    // par des statuts, supprimé par le propriétaire.
    const statuts = [entree({ nature: 'statuts', document_id: D1, texte: null })]
    expect(refusDuRetraitParLeDossierPermanent({ documentId: D1 }, 'suppression', statuts))
      .toBe('Ce document est cité par le dossier permanent (statuts) : il ne se supprime plus, sauf avec son dossier.')
    expect(sql).toContain("case when tg_table_name = 'pieces' then 'elle ne se supprime plus' else 'il ne se supprime plus' end")
  })

  it('même par une version remplacée ou une entrée retirée ; la première nature dans l’ordre de A9', () => {
    const bailRetire = entree({ id: ID(1), nature: 'bail', piece_id: P1, retire_le: '2026-01-01T00:00:00+00:00', retire_par: 'u1' })
    expect(natureQuiGardeLaSource({ pieceId: P1 }, [bailRetire])).toBe('bail')
    const statuts = entree({ id: ID(2), nature: 'statuts', piece_id: P1 })
    expect(natureQuiGardeLaSource({ pieceId: P1 }, [bailRetire, statuts])).toBe('statuts')
    expect(natureQuiGardeLaSource({ pieceId: P1.toUpperCase() }, [bailRetire])).toBe('bail')
    // Une pièce et un document du même identifiant ne se confondent pas ; rien quand rien ne cite.
    expect(natureQuiGardeLaSource({ documentId: P1 }, [bailRetire])).toBeNull()
    expect(refusDuRetraitParLeDossierPermanent({ pieceId: P2 }, 'suppression', [bailRetire])).toBeNull()
  })

  it('la révision d’un solde se dit d’abord, sous ses mots d’hier (lib/revision.ts)', () => {
    const decision: Pick<RevisionJustification, 'id' | 'annee' | 'compte'> = { id: ID(50), annee: 2025, compte: '512000' }
    const preuve: Pick<RevisionPreuve, 'justification_id' | 'piece_id' | 'document_id'> = { justification_id: ID(50), piece_id: P1, document_id: null }
    const lignes = [entree({ nature: 'contrat_emprunt', piece_id: P1 })]
    expect(refusDuRetraitDUneSourceCitee({ pieceId: P1 }, 'changement-de-dossier', { decisions: [decision], preuves: [preuve] }, lignes))
      .toBe('Cette pièce est citée par la révision du solde du compte 512000 (exercice 2025) : elle ne change plus de dossier, sauf avec son dossier.')
    expect(refusDuRetraitDUneSourceCitee({ pieceId: P1 }, 'changement-de-dossier', { decisions: [], preuves: [] }, lignes))
      .toBe("Cette pièce est citée par le dossier permanent (contrat d'emprunt) : elle ne change plus de dossier, sauf avec son dossier.")
    expect(refusDuRetraitDUneSourceCitee({ pieceId: P2 }, 'suppression', { decisions: [decision], preuves: [preuve] }, lignes)).toBeNull()
  })
})

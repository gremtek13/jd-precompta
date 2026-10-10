import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { revisionDeLExercice } from './revision'
import { CYCLES_DE_REVISION, type CycleRevision } from './revisionCycles'
import { octetsJsonb } from './revisionPreuves'
import {
  argumentsDeConclureCycle, argumentsDeNoterRevision, argumentsDeRevoirCycle, AVIS_DE_REVUE, chaineDesConclusions,
  cyclesDeLExercice, ETATS_DE_CONCLUSION, ETATS_DU_CYCLE, exercicePourLesCycles, LIBELLE_DE_L_AVIS, LIBELLE_DE_L_ETAT,
  LIBELLE_DE_LA_NATURE, lireProgramme, LONGUEUR_MAX_A_SUIVRE, LONGUEUR_MAX_CONCLUSION, LONGUEUR_MAX_NOTE_DE_TRAVAIL,
  LONGUEUR_MAX_OBSERVATION, LONGUEUR_MAX_TEXTE_DE_NOTE, LONGUEUR_MAX_TRAVAIL, MOTIF_CODE_DE_TRAVAIL, NATURES_DE_NOTE,
  NOMBRE_MAX_DE_TRAVAUX, pointsASuivre, PROGRAMME_DES_CYCLES, programmeDeDepart, programmePropose, REFUS_CONCLURE_CYCLE,
  REFUS_NOTER_REVISION, REFUS_REVOIR_CYCLE, refusDeConclureCycle, refusDeNoterRevision, refusDeRevoirCycle,
  TAILLE_MAX_DU_PROGRAMME, type ArgumentsConclureCycle, type ArgumentsNoterRevision, type ArgumentsRevoirCycle,
  type ContexteDesCycles, type DonneesDesCycles,
} from './revisionRevue'
import { BLANCS_D_UN_TEXTE } from './revisionSoldes'
import type { RevisionConclusion, RevisionJustification } from './types'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import { argumentsSql, codesSql, messagesSql, nombreDeValeurs, numerosSql } from '../test/raiseSql'
import { decision, donnees, DOSSIER, ecritureEquilibree } from '../test/revision'
import { CHEF, conclusion, noteDuJournal, revue } from '../test/revisionRevue'

// LA MIGRATION, telle que l'export la porte : ses littéraux et le texte de ses fonctions sont la référence du module.
const MIGRATION = (() => {
  const f = fichiersDuSchema().filter((x) => /_revision_des_cycles\.sql$/.test(x.chemin))
  if (f.length !== 1) throw new Error(`${f.length} fichier(s) revision_des_cycles dans l'export`)
  return f[0].texte
})()

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// ── Les littéraux de la migration ─────────────────────────────────────────────────────────────────────────────────

describe('les littéraux sont ceux de la migration', () => {
  const listeSql = (motif: RegExp) => {
    const m = motif.exec(MIGRATION)
    if (!m) throw new Error(`introuvable : ${motif}`)
    return [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1])
  }

  it('les onze cycles, dans l’ordre de l’écran, aux deux tables et aux deux fonctions qui les écrivent', () => {
    expect(listeSql(/constraint revision_conclusions_cycle check \(cycle in \(([^)]*)\)/)).toEqual([...CYCLES_DE_REVISION])
    expect(listeSql(/constraint revision_notes_cycle check \(cycle in \(([^)]*)\)/)).toEqual([...CYCLES_DE_REVISION])
    for (const f of ['conclure_cycle', 'noter_revision']) {
      const m = /p_cycle is null or p_cycle not in \(([^)]*)\)/.exec(derniereDefinitionSql(f))
      expect(m, f).not.toBeNull()
      expect([...(m as RegExpExecArray)[1].matchAll(/'(\w+)'/g)].map((x) => x[1]), f).toEqual([...CYCLES_DE_REVISION])
    }
  })

  it('les états, les natures et les avis', () => {
    expect(listeSql(/constraint revision_conclusions_etat check \(etat in \(([^)]*)\)/)).toEqual([...ETATS_DE_CONCLUSION])
    expect(listeSql(/constraint revision_notes_nature check \(nature in \(([^)]*)\)/)).toEqual([...NATURES_DE_NOTE])
    expect(listeSql(/constraint revision_revues_avis check \(avis in \(([^)]*)\)/)).toEqual([...AVIS_DE_REVUE])
    expect([...(/p_etat not in \(([^)]*)\)/.exec(derniereDefinitionSql('conclure_cycle')) as RegExpExecArray)[1].matchAll(/'(\w+)'/g)].map((x) => x[1]))
      .toEqual([...ETATS_DE_CONCLUSION])
    expect([...(/p_nature not in \(([^)]*)\)/.exec(derniereDefinitionSql('noter_revision')) as RegExpExecArray)[1].matchAll(/'(\w+)'/g)].map((x) => x[1]))
      .toEqual([...NATURES_DE_NOTE])
    expect([...(/p_avis not in \(([^)]*)\)/.exec(derniereDefinitionSql('revoir_cycle')) as RegExpExecArray)[1].matchAll(/'(\w+)'/g)].map((x) => x[1]))
      .toEqual([...AVIS_DE_REVUE])
    // Chaque valeur a son libellé, et aucun libellé ne nomme une valeur que la base ignore.
    expect(Object.keys(LIBELLE_DE_L_ETAT)).toEqual([...ETATS_DE_CONCLUSION])
    expect(Object.keys(LIBELLE_DE_LA_NATURE)).toEqual([...NATURES_DE_NOTE])
    expect(Object.keys(LIBELLE_DE_L_AVIS)).toEqual([...AVIS_DE_REVUE])
  })

  it('les longueurs et les bornes, à la table comme à la fonction', () => {
    const conclure = derniereDefinitionSql('conclure_cycle')
    expect(MIGRATION).toContain(`length(conclusion) <= ${LONGUEUR_MAX_CONCLUSION})`)
    expect(conclure).toContain(`if length(p_conclusion) > ${LONGUEUR_MAX_CONCLUSION} then`)
    expect(MIGRATION).toContain(`length(a_suivre) <= ${LONGUEUR_MAX_A_SUIVRE})`)
    expect(conclure).toContain(`if length(p_a_suivre) > ${LONGUEUR_MAX_A_SUIVRE} then`)
    expect(MIGRATION).toContain(`length(texte) <= ${LONGUEUR_MAX_TEXTE_DE_NOTE})`)
    expect(derniereDefinitionSql('noter_revision')).toContain(`if length(p_texte) > ${LONGUEUR_MAX_TEXTE_DE_NOTE} then`)
    expect(MIGRATION).toContain(`length(observation) <= ${LONGUEUR_MAX_OBSERVATION})`)
    expect(derniereDefinitionSql('revoir_cycle')).toContain(`if length(p_observation) > ${LONGUEUR_MAX_OBSERVATION} then`)
    expect(conclure).toContain(`length(e.v ->> 'travail') > ${LONGUEUR_MAX_TRAVAIL})`)
    expect(conclure).toContain(`length(e.v ->> 'note') > ${LONGUEUR_MAX_NOTE_DE_TRAVAIL})`)
    expect(conclure).toContain(`if jsonb_array_length(v_travaux) > ${NOMBRE_MAX_DE_TRAVAUX} or octet_length(v_travaux::text) > ${TAILLE_MAX_DU_PROGRAMME} then`)
    expect(MIGRATION).toContain(`check (jsonb_typeof(travaux) = 'array' and octet_length(travaux::text) <= ${TAILLE_MAX_DU_PROGRAMME})`)
    expect(conclure).toContain(`e.v ->> 'code' !~ '${MOTIF_CODE_DE_TRAVAIL.source}'`)
    expect(conclure).toContain("k.cle not in ('code', 'travail', 'fait', 'note')")
    // Les blancs que la base ôte sont ceux du module, partout où elle juge un texte.
    expect(BLANCS_D_UN_TEXTE).toBe(' \t\n\r')
    const blancs = [...MIGRATION.matchAll(/btrim\(([^,()]+(?:\([^)]*\))?[^,()]*), E'([^']*)'\)/g)]
    // Chaque `btrim` de la migration, sans exception : onze, aux trois tables et aux trois fonctions.
    expect(blancs.length).toBe((MIGRATION.match(/btrim\(/g) ?? []).length)
    expect(blancs.length).toBeGreaterThanOrEqual(11)
    for (const m of blancs) expect(m[2], m[1]).toBe(String.raw` \t\n\r`)
    // Les bornes de l'exercice, aux trois tables et aux trois fonctions ; l'année à Paris, aux trois fonctions.
    expect(MIGRATION.match(/check \(annee between 2000 and 2100\)/g)).toHaveLength(3)
    for (const f of ['conclure_cycle', 'noter_revision', 'revoir_cycle']) {
      const sql = derniereDefinitionSql(f)
      expect(sql, f).toContain('if p_annee is null or p_annee < 2000 or p_annee > 2100 then')
      expect(sql, f).toContain("if p_annee >= extract(year from (now() at time zone 'Europe/Paris'))::integer then")
      expect(sql, f).toContain('perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));\n  perform pg_advisory_xact_lock(public.cle_revision(p_dossier_id));')
    }
    expect(derniereDefinitionSql('conclure_cycle')).toContain("v_travaux jsonb := coalesce(nullif(p_travaux, 'null'::jsonb), '[]'::jsonb);")
  })
})

// ── Les refus, confrontés au texte des trois fonctions ────────────────────────────────────────────────────────────

const FONCTIONS = [
  {
    nom: 'conclure_cycle', liste: REFUS_CONCLURE_CYCLE, numeros: [1, 2, 3, 5, 6, 7, 8, 9, 10],
    valeurs: { exercice_en_cours: ['p_annee'], remplacement_hors_cycle: ['p_annee'] } as Record<string, string[]>,
  },
  { nom: 'noter_revision', liste: REFUS_NOTER_REVISION, numeros: [1, 2, 3, 5, 6, 7], valeurs: { exercice_en_cours: ['p_annee'] } as Record<string, string[]> },
  {
    nom: 'revoir_cycle', liste: REFUS_REVOIR_CYCLE, numeros: [1, 2, 3, 5, 6, 7, 8, 9],
    valeurs: { exercice_en_cours: ['p_annee'], conclusion_hors_exercice: ['p_annee'] } as Record<string, string[]>,
  },
] as const

describe.each(FONCTIONS)('les refus de $nom, tels que la migration les écrit', ({ nom, liste, numeros, valeurs }) => {
  const sql = derniereDefinitionSql(nom)

  it('les mêmes messages, dans le même ordre', () => {
    expect(liste.map((r) => r.modele)).toEqual(messagesSql(sql))
    expect(new Set(liste.map((r) => r.cle)).size).toBe(liste.length)
  })

  it('les mêmes codes : 42501 pour le refus 1, 22023 pour les autres', () => {
    const codes = codesSql(sql)
    expect(codes).toHaveLength(liste.length)
    liste.forEach((r, i) => expect(codes[i], r.cle).toBe(r.refus === 1 ? '42501' : '22023'))
  })

  it('les numéros suivent l’ordre de la fonction, le refus 4 réservé à l’étape R9', () => {
    const n = liste.map((r) => r.refus)
    expect([...new Set(n)]).toEqual(numeros)
    expect(n).toEqual([...n].sort((a, b) => a - b))
    expect(n).toEqual(numerosSql(sql))
    expect(sql).not.toMatch(/-- 4\./)
  })

  it('les valeurs des « % » sont celles que le module écrit', () => {
    const args = argumentsSql(sql)
    expect(args).toHaveLength(liste.length)
    liste.forEach((r, i) => {
      expect(args[i], r.cle).toEqual(valeurs[r.cle] ?? [])
      expect(nombreDeValeurs(r.modele), r.cle).toBe(args[i].length)
    })
  })

  // LA BORNE DU HARNAIS : une confrontation qui ne saurait pas virer au rouge ne prouverait rien.
  it('vire au rouge sur une dérive plantée dans le texte de la fonction', () => {
    const attendu = liste.map((r) => r.modele)
    const premier = `'${liste[1].modele.replace(/'/g, "''")}'`
    expect(sql).toContain(premier)
    expect(messagesSql(sql.replace(premier, "'Un autre mot.'"))).not.toEqual(attendu)
    const a = `raise exception '${liste[liste.length - 2].modele.replace(/'/g, "''")}'`
    const b = `raise exception '${liste[liste.length - 1].modele.replace(/'/g, "''")}'`
    expect(sql).toContain(a)
    expect(sql).toContain(b)
    expect(messagesSql(sql.replace(a, '§').replace(b, a).replace('§', b))).not.toEqual(attendu)
    expect(numerosSql(sql.replace(/-- 6\./, '-- 66.'))).not.toEqual(liste.map((r) => r.refus))
  })
})

// ── Les refus de conclure_cycle, cas par cas ──────────────────────────────────────────────────────────────────────

const K1 = UUID(1)
const K2 = UUID(2)
const K24 = UUID(3)
const contexte = (o: Partial<ContexteDesCycles> = {}): ContexteDesCycles => ({
  accesAuDossier: true, chefDuCabinet: true, anneeCourante: 2026,
  conclusions: [
    { id: K1, annee: 2025, cycle: 'tresorerie', remplace_id: null },
    { id: K2, annee: 2025, cycle: 'tresorerie', remplace_id: K1 },
    { id: K24, annee: 2024, cycle: 'tresorerie', remplace_id: null },
  ],
  revues: [{ conclusion_id: K24 }],
  ...o,
})
const conclure = (o: Partial<ArgumentsConclureCycle> = {}): ArgumentsConclureCycle => ({
  p_dossier_id: DOSSIER, p_annee: 2025, p_cycle: 'recettes', p_etat: 'revise', p_travaux: [], p_conclusion: 'Rien à signaler.',
  p_a_suivre: null, p_remplace_id: null, ...o,
})
const cle = (r: { cle: string } | null) => r?.cle ?? null

describe('ce que conclure_cycle refuserait, dit avant le clic', () => {
  it('une conclusion qui passe tout', () => {
    expect(refusDeConclureCycle(conclure(), contexte())).toBeNull()
    expect(refusDeConclureCycle(conclure({ p_cycle: 'tresorerie', p_remplace_id: K2 }), contexte())).toBeNull()
    // La casse d'un identifiant ne compte pas, comme pour la base.
    expect(refusDeConclureCycle(conclure({ p_cycle: 'tresorerie', p_remplace_id: K2.toUpperCase() }), contexte())).toBeNull()
  })

  it('1. l’accès, sous le code de la base, avant tout', () => {
    const r = refusDeConclureCycle(conclure({ p_annee: 1999 }), contexte({ accesAuDossier: false }))
    expect(r).toEqual({ cle: 'acces', refus: 1, code: '42501', message: 'Accès refusé à ce dossier.' })
    // Le chef seul n'y suffit pas : conclure est un geste de préparation (hypothèse Q2).
    expect(cle(refusDeConclureCycle(conclure(), contexte({ accesAuDossier: false, chefDuCabinet: true })))).toBe('acces')
    expect(refusDeConclureCycle(conclure(), contexte({ chefDuCabinet: false }))).toBeNull()
  })

  it('2. et 3. l’exercice : ses bornes, puis l’exercice en cours à Paris (hypothèse Q11)', () => {
    for (const annee of [1999, 2101, null, Number.NaN]) {
      expect(refusDeConclureCycle(conclure({ p_annee: annee }), contexte()), String(annee))
        .toEqual({ cle: 'exercice_invalide', refus: 2, code: '22023', message: 'Exercice invalide.' })
    }
    expect(refusDeConclureCycle(conclure({ p_annee: 2026, p_cycle: 'caisse' }), contexte())?.message)
      .toBe("L'exercice 2026 n'est pas terminé : sa révision s'ouvre une fois clos.")
    expect(cle(refusDeConclureCycle(conclure({ p_annee: 2027 }), contexte()))).toBe('exercice_en_cours')
    expect(refusDeConclureCycle(conclure({ p_annee: 2000 }), contexte())).toBeNull()
    expect(refusDeConclureCycle(conclure({ p_annee: 2025 }), contexte({ anneeCourante: 2101 }))).toBeNull()
  })

  it('5. et 6. le cycle, puis l’état', () => {
    for (const cycle of ['caisse', null, 'Tresorerie', ' tresorerie', '']) {
      expect(cle(refusDeConclureCycle(conclure({ p_cycle: cycle, p_etat: 'valide' }), contexte())), String(cycle)).toBe('cycle_inconnu')
    }
    for (const c of CYCLES_DE_REVISION) expect(cle(refusDeConclureCycle(conclure({ p_cycle: c }), contexte({ conclusions: [] }))), c).toBeNull()
    for (const etat of ['valide', null, 'Revise', 'revu']) {
      expect(cle(refusDeConclureCycle(conclure({ p_etat: etat, p_conclusion: null }), contexte())), String(etat)).toBe('etat_invalide')
    }
    expect(refusDeConclureCycle(conclure({ p_etat: 'anomalie' }), contexte())).toBeNull()
  })

  it('7. et 8. la conclusion, puis les points à suivre', () => {
    expect(cle(refusDeConclureCycle(conclure({ p_conclusion: null, p_a_suivre: ' ' }), contexte()))).toBe('conclusion_vide')
    expect(cle(refusDeConclureCycle(conclure({ p_conclusion: ' \t\n\r' }), contexte()))).toBe('conclusion_vide')
    expect(cle(refusDeConclureCycle(conclure({ p_conclusion: '' }), contexte()))).toBe('conclusion_vide')
    // Une espace insécable ou un saut de page restent un texte.
    expect(refusDeConclureCycle(conclure({ p_conclusion: ' ' }), contexte())).toBeNull()
    expect(refusDeConclureCycle(conclure({ p_conclusion: '\f' }), contexte())).toBeNull()
    expect(cle(refusDeConclureCycle(conclure({ p_conclusion: 'c'.repeat(8001) }), contexte()))).toBe('conclusion_trop_longue')
    expect(refusDeConclureCycle(conclure({ p_conclusion: 'c'.repeat(8000) }), contexte())).toBeNull()
    // Les caractères, pas les unités UTF-16 : 8 000 visages font 16 000 unités.
    expect(refusDeConclureCycle(conclure({ p_conclusion: '😀'.repeat(8000) }), contexte())).toBeNull()
    expect(cle(refusDeConclureCycle(conclure({ p_a_suivre: '\n', p_travaux: {} }), contexte()))).toBe('a_suivre_blanc')
    expect(cle(refusDeConclureCycle(conclure({ p_a_suivre: 's'.repeat(4001) }), contexte()))).toBe('a_suivre_trop_long')
    expect(refusDeConclureCycle(conclure({ p_a_suivre: 's'.repeat(4000) }), contexte())).toBeNull()
  })

  it('9. le programme : sa forme, comme la base la lit', () => {
    const illisibles: unknown[] = [
      {}, 'texte', 1, true, [1], [null], [[]], [{ travail: 'T', fait: true, autre: 1 }], [{ fait: true }], [{ travail: 1, fait: true }],
      [{ travail: 'T' }], [{ travail: 'T', fait: 'true' }], [{ travail: 'T', fait: null }], [{ travail: 'T', fait: true, note: 1 }],
      [{ code: 1, travail: 'T', fait: true }], [{ code: true, travail: 'T', fait: true }], [{ code: 'Tresorerie', travail: 'T', fait: true }],
      [{ code: '', travail: 'T', fait: true }], [{ code: 'c'.repeat(65), travail: 'T', fait: true }], [{ code: '1x', travail: 'T', fait: true }],
      [{ code: 'a_b', travail: 'T', fait: true }], [{ code: 'a\n', travail: 'T', fait: true }],
    ]
    for (const v of illisibles) expect(cle(refusDeConclureCycle(conclure({ p_travaux: v }), contexte())), JSON.stringify(v)).toBe('programme_illisible')
    const lisibles: unknown[] = [
      null, undefined, [], [{ travail: 'T', fait: false }], [{ code: null, travail: 'T', fait: true, note: null }],
      [{ code: 'c'.repeat(64), travail: 'T', fait: true }], [{ code: 'a', travail: 'T', fait: true }], [{ code: 'a-1-b', travail: 'T', fait: true, note: 'N' }],
      // Une clé `undefined` disparaît à l'envoi, comme JSON.stringify la fait disparaître.
      [{ travail: 'T', fait: true, note: undefined }],
    ]
    for (const v of lisibles) expect(refusDeConclureCycle(conclure({ p_travaux: v }), contexte()), JSON.stringify(v)).toBeNull()
  })

  it('9. le programme : le nombre, la taille au JSON près, les libellés, les notes, les doublons — dans cet ordre', () => {
    const t = (n: number, o: Record<string, unknown> = {}) => Array.from({ length: n }, (_, i) => ({ travail: `T${i + 1}`, fait: false, ...o }))
    expect(cle(refusDeConclureCycle(conclure({ p_travaux: t(101) }), contexte()))).toBe('programme_trop_long')
    expect(refusDeConclureCycle(conclure({ p_travaux: t(100) }), contexte())).toBeNull()
    // La taille de la base : le texte du jsonb, que `octetsJsonb` écrit comme elle — 64 Kio tout juste, puis un octet de plus.
    const base = Array.from({ length: 32 }, () => ({ travail: 'T', fait: true, note: 'n'.repeat(1980) }))
    const juste = [...base, { travail: 'T', fait: true, note: 'n'.repeat(65536 - octetsJsonb(base) - 44) }]
    expect(octetsJsonb(juste)).toBe(65536)
    expect(refusDeConclureCycle(conclure({ p_travaux: juste }), contexte())).toBeNull()
    const trop = [...base, { travail: 'T', fait: true, note: 'n'.repeat(65537 - octetsJsonb(base) - 44) }]
    expect(octetsJsonb(trop)).toBe(65537)
    expect(cle(refusDeConclureCycle(conclure({ p_travaux: trop }), contexte()))).toBe('programme_trop_long')
    // Un caractère hors de l'ASCII compte ses octets : 1 000 « é » font 2 000 octets.
    expect(octetsJsonb([{ travail: 'é'.repeat(1000), fait: true }])).toBe(octetsJsonb([{ travail: 'e'.repeat(1000), fait: true }]) + 1000)
    expect(cle(refusDeConclureCycle(conclure({ p_travaux: [{ travail: '', fait: true }] }), contexte()))).toBe('travail_vide')
    expect(cle(refusDeConclureCycle(conclure({ p_travaux: [{ travail: ' \t\n\r', fait: true }] }), contexte()))).toBe('travail_vide')
    expect(cle(refusDeConclureCycle(conclure({ p_travaux: [{ travail: 'l'.repeat(501), fait: true }] }), contexte()))).toBe('travail_trop_long')
    expect(refusDeConclureCycle(conclure({ p_travaux: [{ travail: 'l'.repeat(500), fait: true }] }), contexte())).toBeNull()
    expect(cle(refusDeConclureCycle(conclure({ p_travaux: [{ travail: 'T', fait: true, note: '  ' }] }), contexte()))).toBe('note_de_travail_blanche')
    expect(cle(refusDeConclureCycle(conclure({ p_travaux: [{ travail: 'T', fait: true, note: 'm'.repeat(2001) }] }), contexte()))).toBe('note_de_travail_trop_longue')
    expect(refusDeConclureCycle(conclure({ p_travaux: [{ travail: 'T', fait: true, note: 'm'.repeat(2000) }] }), contexte())).toBeNull()
    expect(cle(refusDeConclureCycle(conclure({ p_travaux: [{ code: 'a', travail: 'T', fait: true }, { code: 'a', travail: 'U', fait: false }] }), contexte())))
      .toBe('travail_en_double')
    // Deux travaux ajoutés par le cabinet peuvent se ressembler.
    expect(refusDeConclureCycle(conclure({ p_travaux: [{ travail: 'T', fait: true }, { travail: 'T', fait: false }] }), contexte())).toBeNull()
    // L'ordre : la forme, le nombre, le libellé vide, le libellé long, la note de blancs, la note longue, le doublon.
    expect(cle(refusDeConclureCycle(conclure({ p_travaux: [...t(101).slice(1), { travail: 'T', fait: 'x' }] }), contexte()))).toBe('programme_illisible')
    expect(cle(refusDeConclureCycle(conclure({ p_travaux: [{ travail: '', fait: false }, ...t(100)] }), contexte()))).toBe('programme_trop_long')
    expect(cle(refusDeConclureCycle(conclure({ p_travaux: [{ travail: 'l'.repeat(501), fait: true }, { travail: '', fait: true }] }), contexte()))).toBe('travail_vide')
    expect(cle(refusDeConclureCycle(conclure({ p_travaux: [{ travail: 'T', fait: true, note: ' ' }, { travail: 'l'.repeat(501), fait: true }] }), contexte())))
      .toBe('travail_trop_long')
    expect(cle(refusDeConclureCycle(conclure({ p_travaux: [{ travail: 'T', fait: true, note: 'm'.repeat(2001) }, { travail: 'U', fait: true, note: ' ' }] }), contexte())))
      .toBe('note_de_travail_blanche')
    expect(cle(refusDeConclureCycle(conclure({ p_travaux: [{ code: 'a', travail: 'T', fait: true }, { code: 'a', travail: 'U', fait: true, note: 'm'.repeat(2001) }] }), contexte())))
      .toBe('note_de_travail_trop_longue')
  })

  it('10. la chaîne : la courante, ou rien quand il n’y en a pas', () => {
    expect(refusDeConclureCycle(conclure({ p_cycle: 'tresorerie' }), contexte())?.message)
      .toBe('Une autre conclusion a été prise sur ce cycle depuis : relire avant de conclure.')
    expect(cle(refusDeConclureCycle(conclure({ p_cycle: 'tresorerie', p_remplace_id: K1 }), contexte()))).toBe('remplacement_perime')
    expect(refusDeConclureCycle(conclure({ p_cycle: 'recettes', p_remplace_id: K2 }), contexte())?.message)
      .toBe("La conclusion à remplacer n'est pas une conclusion de ce cycle pour l'exercice 2025.")
    expect(cle(refusDeConclureCycle(conclure({ p_cycle: 'tresorerie', p_remplace_id: K24 }), contexte()))).toBe('remplacement_hors_cycle')
    expect(cle(refusDeConclureCycle(conclure({ p_cycle: 'tresorerie', p_remplace_id: UUID(99) }), contexte()))).toBe('remplacement_hors_cycle')
    expect(refusDeConclureCycle(conclure({ p_annee: 2024, p_cycle: 'tresorerie', p_remplace_id: K24 }), contexte())).toBeNull()
    // 9 avant 10 : un programme illisible l'emporte sur un remplacement périmé.
    expect(cle(refusDeConclureCycle(conclure({ p_cycle: 'tresorerie', p_remplace_id: K1, p_travaux: {} }), contexte()))).toBe('programme_illisible')
  })
})

// ── Les refus de noter_revision et de revoir_cycle ────────────────────────────────────────────────────────────────

const noter = (o: Partial<ArgumentsNoterRevision> = {}): ArgumentsNoterRevision => ({
  p_dossier_id: DOSSIER, p_annee: 2025, p_cycle: 'tresorerie', p_nature: 'travail', p_texte: 'Fait.', ...o,
})
const revoir = (o: Partial<ArgumentsRevoirCycle> = {}): ArgumentsRevoirCycle => ({
  p_dossier_id: DOSSIER, p_annee: 2025, p_conclusion_id: K2, p_avis: 'approuve', p_observation: null, ...o,
})

describe('ce que noter_revision refuserait', () => {
  it('dans l’ordre de la fonction', () => {
    expect(refusDeNoterRevision(noter(), contexte())).toBeNull()
    expect(refusDeNoterRevision(noter({ p_annee: 1999 }), contexte({ accesAuDossier: false })))
      .toEqual({ cle: 'acces', refus: 1, code: '42501', message: 'Accès refusé à ce dossier.' })
    expect(cle(refusDeNoterRevision(noter({ p_annee: 2101 }), contexte()))).toBe('exercice_invalide')
    expect(refusDeNoterRevision(noter({ p_annee: 2026, p_cycle: 'caisse' }), contexte())?.message)
      .toBe("L'exercice 2026 n'est pas terminé : sa révision s'ouvre une fois clos.")
    expect(cle(refusDeNoterRevision(noter({ p_cycle: 'caisse', p_nature: 'appel' }), contexte()))).toBe('cycle_inconnu')
    expect(cle(refusDeNoterRevision(noter({ p_cycle: null }), contexte()))).toBe('cycle_inconnu')
    for (const n of ['appel', null, 'Travail']) {
      expect(cle(refusDeNoterRevision(noter({ p_nature: n, p_texte: null }), contexte())), String(n)).toBe('nature_invalide')
    }
    for (const n of NATURES_DE_NOTE) expect(refusDeNoterRevision(noter({ p_nature: n }), contexte()), n).toBeNull()
    expect(cle(refusDeNoterRevision(noter({ p_texte: null }), contexte()))).toBe('texte_vide')
    expect(cle(refusDeNoterRevision(noter({ p_texte: '\r\n' }), contexte()))).toBe('texte_vide')
    expect(cle(refusDeNoterRevision(noter({ p_texte: 'n'.repeat(4001) }), contexte()))).toBe('texte_trop_long')
    expect(refusDeNoterRevision(noter({ p_texte: 'n'.repeat(4000) }), contexte())).toBeNull()
    // Le journal ne lit aucune conclusion : une note s'écrit sur un cycle que rien n'a conclu.
    expect(refusDeNoterRevision(noter({ p_cycle: 'stocks' }), { accesAuDossier: true, anneeCourante: 2026 })).toBeNull()
  })
})

describe('ce que revoir_cycle refuserait', () => {
  it('1. seul le chef du cabinet revoit (hypothèse Q2), avant tout', () => {
    expect(refusDeRevoirCycle(revoir({ p_annee: 1999 }), contexte({ chefDuCabinet: false })))
      .toEqual({ cle: 'chef', refus: 1, code: '42501', message: 'Seul le chef du cabinet revoit un cycle.' })
    // Un membre affecté prépare, il ne revoit pas ; le chef revoit sans y être affecté.
    expect(cle(refusDeRevoirCycle(revoir(), contexte({ chefDuCabinet: false, accesAuDossier: true })))).toBe('chef')
    expect(refusDeRevoirCycle(revoir(), contexte({ chefDuCabinet: true, accesAuDossier: false }))).toBeNull()
  })

  it('dans l’ordre de la fonction', () => {
    expect(cle(refusDeRevoirCycle(revoir({ p_annee: 2101 }), contexte()))).toBe('exercice_invalide')
    expect(cle(refusDeRevoirCycle(revoir({ p_annee: 2026, p_avis: 'valide' }), contexte()))).toBe('exercice_en_cours')
    expect(cle(refusDeRevoirCycle(revoir({ p_avis: null, p_observation: ' ' }), contexte()))).toBe('avis_invalide')
    expect(cle(refusDeRevoirCycle(revoir({ p_avis: 'Approuve' }), contexte()))).toBe('avis_invalide')
    for (const o of [null, '', ' \t\n\r']) {
      expect(cle(refusDeRevoirCycle(revoir({ p_avis: 'a_reprendre', p_observation: o, p_conclusion_id: null }), contexte())), String(o))
        .toBe('a_reprendre_sans_observation')
    }
    expect(cle(refusDeRevoirCycle(revoir({ p_observation: '  ' }), contexte()))).toBe('observation_blanche')
    expect(cle(refusDeRevoirCycle(revoir({ p_avis: 'a_reprendre', p_observation: 'o'.repeat(4001) }), contexte()))).toBe('observation_trop_longue')
    expect(refusDeRevoirCycle(revoir({ p_avis: 'a_reprendre', p_observation: 'o'.repeat(4000) }), contexte())).toBeNull()
    expect(refusDeRevoirCycle(revoir({ p_conclusion_id: null }), contexte())?.message)
      .toBe("La conclusion à revoir n'est pas une conclusion de l'exercice 2025 dans ce dossier.")
    expect(cle(refusDeRevoirCycle(revoir({ p_conclusion_id: UUID(99) }), contexte()))).toBe('conclusion_hors_exercice')
    expect(cle(refusDeRevoirCycle(revoir({ p_conclusion_id: K24 }), contexte()))).toBe('conclusion_hors_exercice')
    expect(cle(refusDeRevoirCycle(revoir({ p_annee: 2024, p_conclusion_id: K1 }), contexte()))).toBe('conclusion_hors_exercice')
    expect(refusDeRevoirCycle(revoir({ p_conclusion_id: K1 }), contexte())?.message)
      .toBe('Une autre conclusion a été prise sur ce cycle depuis : relire avant de revoir.')
    expect(refusDeRevoirCycle(revoir({ p_annee: 2024, p_conclusion_id: K24 }), contexte())?.message)
      .toBe('Cette conclusion a déjà été revue : revoir de nouveau suppose une nouvelle conclusion.')
    // 8 avant 9 : une conclusion revue, puis remplacée.
    expect(cle(refusDeRevoirCycle(revoir({ p_conclusion_id: K1 }), contexte({ revues: [{ conclusion_id: K1 }] })))).toBe('conclusion_remplacee')
    expect(refusDeRevoirCycle(revoir({ p_conclusion_id: K2.toUpperCase() }), contexte())).toBeNull()
  })
})

// ── Les arguments ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('les arguments, tels que supabase-js les envoie', () => {
  it('conclure_cycle : les huit, nuls plutôt qu’absents, les blancs partis nuls', () => {
    const a = argumentsDeConclureCycle(DOSSIER, 2025, {
      cycle: 'tresorerie', etat: 'revise', conclusion: 'Révisé.', aSuivre: ' \n', remplaceId: null,
      travaux: [
        { code: 'tresorerie-releves', travail: 'Les relevés', fait: true, note: ' ' },
        { code: null, travail: 'Ajouté', fait: false, note: 'Une note' },
      ],
    })
    expect(Object.keys(a)).toEqual(['p_dossier_id', 'p_annee', 'p_cycle', 'p_etat', 'p_travaux', 'p_conclusion', 'p_a_suivre', 'p_remplace_id'])
    expect(Object.values(a).every((v) => v !== undefined)).toBe(true)
    expect(a.p_a_suivre).toBeNull()
    expect(a.p_travaux).toEqual([
      { code: 'tresorerie-releves', travail: 'Les relevés', fait: true },
      { travail: 'Ajouté', fait: false, note: 'Une note' },
    ])
    // Les clés de la fonction, dans l'ordre de sa signature exportée.
    const signature = /create function public\.conclure_cycle\(([\s\S]*?)\)\s*returns/.exec(MIGRATION) as RegExpExecArray
    expect([...signature[1].matchAll(/(p_\w+)/g)].map((m) => m[1])).toEqual(Object.keys(a))
    // Ce qui part passe les refus du module : le programme proposé tel quel, une conclusion de chaque cycle.
    for (const c of CYCLES_DE_REVISION) {
      const x = argumentsDeConclureCycle(DOSSIER, 2025, { cycle: c, etat: 'revise', conclusion: 'R', aSuivre: null, remplaceId: null, travaux: programmePropose(c) })
      expect(refusDeConclureCycle(x, contexte({ conclusions: [] })), c).toBeNull()
    }
  })

  it('noter_revision et revoir_cycle : les cinq, dans l’ordre de leur signature', () => {
    const n = argumentsDeNoterRevision(DOSSIER, 2025, 'ensemble', 'consultation', 'Texte')
    const sn = /create function public\.noter_revision\(([\s\S]*?)\)\s*returns/.exec(MIGRATION) as RegExpExecArray
    expect([...sn[1].matchAll(/(p_\w+)/g)].map((m) => m[1])).toEqual(Object.keys(n))
    expect(refusDeNoterRevision(n, contexte())).toBeNull()
    const r = argumentsDeRevoirCycle(DOSSIER, 2025, K2, 'approuve', '\t')
    const sr = /create function public\.revoir_cycle\(([\s\S]*?)\)\s*returns/.exec(MIGRATION) as RegExpExecArray
    expect([...sr[1].matchAll(/(p_\w+)/g)].map((m) => m[1])).toEqual(Object.keys(r))
    expect(r.p_observation).toBeNull()
    expect(refusDeRevoirCycle(r, contexte())).toBeNull()
    expect(argumentsDeRevoirCycle(DOSSIER, 2025, K2, 'a_reprendre', 'À reprendre').p_observation).toBe('À reprendre')
  })
})

// ── Le programme proposé, sa lecture, son départ ──────────────────────────────────────────────────────────────────

describe('le programme de travail proposé (§ 4.4)', () => {
  it('chaque cycle a le sien ; chaque code est unique, au motif, préfixé de son cycle', () => {
    const codes = CYCLES_DE_REVISION.flatMap((c) => PROGRAMME_DES_CYCLES[c].map((t) => t.code))
    expect(new Set(codes).size).toBe(codes.length)
    for (const c of CYCLES_DE_REVISION) {
      expect(PROGRAMME_DES_CYCLES[c].length, c).toBeGreaterThan(0)
      for (const t of PROGRAMME_DES_CYCLES[c]) {
        expect(t.code, t.code).toMatch(MOTIF_CODE_DE_TRAVAIL)
        expect(t.code.startsWith(`${c}-`), t.code).toBe(true)
        expect([...t.travail].length, t.code).toBeLessThanOrEqual(LONGUEUR_MAX_TRAVAIL)
        expect(t.travail.trim(), t.code).not.toBe('')
      }
    }
    expect(programmePropose('emprunts')).toEqual(PROGRAMME_DES_CYCLES.emprunts.map((t) => ({ ...t, fait: false, note: null })))
  })

  it('le cycle « ensemble » ne présume pas la mission (Q5) et ne cite aucun seuil', () => {
    const ensemble = PROGRAMME_DES_CYCLES.ensemble.map((t) => t.travail).join(' ')
    expect(ensemble).toContain('Pour une présentation des comptes')
    expect(ensemble).toContain('note de synthèse')
    for (const c of CYCLES_DE_REVISION) for (const t of PROGRAMME_DES_CYCLES[c]) expect(t.travail, t.code).not.toMatch(/\d+\s*€/)
  })

  it('se relit sans deviner : la forme que la fonction exige, ou rien', () => {
    expect(lireProgramme([{ code: 'a', travail: 'T', fait: true, note: 'N' }, { travail: 'U', fait: false }])).toEqual({
      lisible: true,
      travaux: [{ code: 'a', travail: 'T', fait: true, note: 'N' }, { code: null, travail: 'U', fait: false, note: null }],
    })
    expect(lireProgramme([])).toEqual({ lisible: true, travaux: [] })
    for (const v of [null, {}, [1], [{ travail: 'T' }], [{ travail: 'T', fait: true, x: 1 }], [{ code: true, travail: 'T', fait: true }]]) {
      expect(lireProgramme(v), JSON.stringify(v)).toEqual({ lisible: false })
    }
    // Lisible, au sens de la forme seulement : le nombre et les longueurs se montrent tels qu'ils sont.
    expect(lireProgramme(Array.from({ length: 101 }, () => ({ travail: '', fait: true }))).lisible).toBe(true)
    // Le même critère que le refus « illisible » de la fonction.
    const valeurs: unknown[] = [[], {}, [1], [{ travail: 'T', fait: true }], [{ travail: 'T', fait: 1 }], [{ code: 'Z', travail: 'T', fait: true }],
      [{ code: 'z', travail: 'T', fait: true, note: null }], [{ travail: 'T', fait: true, note: [] }]]
    for (const v of valeurs) {
      expect(lireProgramme(v).lisible, JSON.stringify(v)).toBe(cle(refusDeConclureCycle(conclure({ p_travaux: v }), contexte())) !== 'programme_illisible')
    }
  })

  it('part de la conclusion courante, complétée des travaux proposés depuis ; sinon du programme proposé', () => {
    expect(programmeDeDepart('emprunts', null)).toEqual({ travaux: programmePropose('emprunts'), repris: false })
    const courante = { travaux: [{ code: 'emprunts-tableau', travail: 'Ancien libellé', fait: true, note: 'Obtenu' }, { travail: 'Ajouté', fait: false }] }
    const depart = programmeDeDepart('emprunts', courante)
    expect(depart.repris).toBe(true)
    expect(depart.travaux.slice(0, 2)).toEqual([
      { code: 'emprunts-tableau', travail: 'Ancien libellé', fait: true, note: 'Obtenu' },
      { code: null, travail: 'Ajouté', fait: false, note: null },
    ])
    expect(depart.travaux.slice(2).map((t) => t.code)).toEqual(['emprunts-capital', 'emprunts-interets'])
    expect(programmeDeDepart('emprunts', { travaux: { illisible: true } })).toEqual({ travaux: programmePropose('emprunts'), repris: false })
  })
})

// ── La chaîne et les points à suivre ──────────────────────────────────────────────────────────────────────────────

describe('la chaîne des conclusions d’un cycle', () => {
  const a = conclusion({ id: 'a', cree_le: '2026-02-01T10:00:00Z' })
  const b = conclusion({ id: 'b', remplace_id: 'a', cree_le: '2026-02-02T10:00:00Z' })
  const c = conclusion({ id: 'c', remplace_id: 'B', cree_le: '2026-02-03T10:00:00Z' })

  it('de la première à la courante, sans horodatage, la casse ignorée', () => {
    expect(chaineDesConclusions([c, a, b], 2025, 'tresorerie')).toEqual({ conclusions: [a, b, c], courante: c, lisible: true })
    expect(chaineDesConclusions([], 2025, 'tresorerie')).toEqual({ conclusions: [], courante: null, lisible: true })
    // Un autre cycle, un autre exercice ne s'y mêlent pas.
    const autre = conclusion({ id: 'x', cycle: 'recettes' })
    const avant = conclusion({ id: 'y', annee: 2024 })
    expect(chaineDesConclusions([a, autre, avant], 2025, 'tresorerie').conclusions).toEqual([a])
  })

  it('une chaîne qui ne se suit pas n’a pas de courante', () => {
    const deuxiemePremiere = conclusion({ id: 'd', cree_le: '2026-01-01T10:00:00Z' })
    expect(chaineDesConclusions([a, b, deuxiemePremiere], 2025, 'tresorerie')).toEqual({ conclusions: [deuxiemePremiere, a, b], courante: null, lisible: false })
    const deuxiemeSuite = conclusion({ id: 'e', remplace_id: 'a' })
    expect(chaineDesConclusions([a, b, deuxiemeSuite], 2025, 'tresorerie').lisible).toBe(false)
    const orpheline = conclusion({ id: 'f', remplace_id: 'z' })
    expect(chaineDesConclusions([a, orpheline], 2025, 'tresorerie').lisible).toBe(false)
    const boucle = [conclusion({ id: 'p', remplace_id: 'q' }), conclusion({ id: 'q', remplace_id: 'p' })]
    expect(chaineDesConclusions(boucle, 2025, 'tresorerie')).toMatchObject({ courante: null, lisible: false })
  })

  it('les points à suivre de l’exercice précédent : ceux de sa conclusion courante', () => {
    const ancienne = conclusion({ id: 'o', annee: 2024, a_suivre: 'Vieux point' })
    const courante = conclusion({ id: 'p', annee: 2024, remplace_id: 'o', a_suivre: 'Le chèque de décembre' })
    expect(pointsASuivre([ancienne, courante], 2025, 'tresorerie')).toEqual({ annee: 2024, conclusion: courante, texte: 'Le chèque de décembre' })
    expect(pointsASuivre([ancienne, conclusion({ id: 'p', annee: 2024, remplace_id: 'o' })], 2025, 'tresorerie')).toBeNull()
    expect(pointsASuivre([conclusion({ annee: 2024, cycle: 'recettes', a_suivre: 'X' })], 2025, 'tresorerie')).toBeNull()
    expect(pointsASuivre([conclusion({ annee: 2025, a_suivre: 'X' })], 2025, 'tresorerie')).toBeNull()
  })
})

// ── L'état d'un cycle, déduit (§ 3.5) ─────────────────────────────────────────────────────────────────────────────

describe('l’exercice, pour les cycles', () => {
  it('terminé à Paris et dans les bornes de la base, sans attendre l’ouverture de ses soldes', () => {
    expect(exercicePourLesCycles(2025, 2026)).toBe('ouvert')
    expect(exercicePourLesCycles(2026, 2026)).toBe('en-cours')
    expect(exercicePourLesCycles(2030, 2026)).toBe('en-cours')
    for (const a of [1999, 2101, Number.NaN, 2025.5]) expect(exercicePourLesCycles(a, 2026), String(a)).toBe('invalide')
    expect(exercicePourLesCycles(2000, 2026)).toBe('ouvert')
    expect(exercicePourLesCycles(2100, 2101)).toBe('ouvert')
  })
})

describe('l’état de chaque cycle, déduit (conception, § 3.5)', () => {
  // Un dossier fictif : la banque à 100 au débit en 2025, contre une recette. Ses cycles : trésorerie, recettes, dépenses,
  // social, exploitant et capitaux, ensemble (lib/revisionCycles.ts).
  const ecritures = ecritureEquilibree('e1', '2025-03-01', '512000', '706000', 100)
  const justifiee = decision({ id: 'j1', compte: '512000', solde: 100, etat: 'justifie', cree_le: '2026-02-01T09:00:00Z' })
  const revision = (decisions: RevisionJustification[] = [justifiee], o: Parameters<typeof donnees>[0] = {}) =>
    revisionDeLExercice(donnees({ ecritures, decisions, ...o }), [])
  const vide: DonneesDesCycles = { conclusions: [], journal: [], revues: [], decisions: [] }
  const etats = (d: Partial<DonneesDesCycles>, decisions: RevisionJustification[] = [justifiee], o: Parameters<typeof donnees>[0] = {}) => {
    const r = cyclesDeLExercice(revision(decisions, o), { ...vide, decisions, ...d }, null, 2026)
    return Object.fromEntries(r.cycles.map((c) => [c.cycle, c.etat]))
  }
  const un = (cycle: CycleRevision, d: Partial<DonneesDesCycles>, decisions: RevisionJustification[] = [justifiee], o: Parameters<typeof donnees>[0] = {}) =>
    cyclesDeLExercice(revision(decisions, o), { ...vide, decisions, ...d }, null, 2026).cycles.find((c) => c.cycle === cycle)
  const tresorerie = conclusion({ id: 'k1', cycle: 'tresorerie', cree_le: '2026-02-01T10:00:00Z' })

  it('non commencé, en cours, révisé', () => {
    expect(etats({}, [])).toEqual({
      tresorerie: 'non-commence', recettes: 'non-commence', depenses: 'non-commence', social: 'non-commence', capitaux: 'non-commence', ensemble: 'non-commence',
    })
    // Une décision sur un solde du cycle, ou une note, commencent le cycle.
    expect(un('tresorerie', {})?.etat).toBe('en-cours')
    expect(un('recettes', { journal: [noteDuJournal({ cycle: 'recettes' })] }, [])?.etat).toBe('en-cours')
    expect(un('tresorerie', { conclusions: [tresorerie] })).toMatchObject({ etat: 'revise', causes: [] })
    // Un cycle sans solde se révise par sa conclusion seule.
    expect(un('recettes', { conclusions: [conclusion({ id: 'r', cycle: 'recettes' })] }, [])?.etat).toBe('revise')
  })

  it('« révisé » attend que ses soldes soient réglés : à justifier, à revoir, en anomalie, en attente', () => {
    expect(un('tresorerie', { conclusions: [tresorerie] }, [])).toMatchObject({ etat: 'en-cours', causes: ['soldes-a-justifier'] })
    const perimee = decision({ id: 'j2', compte: '512000', solde: 90, etat: 'justifie' })
    expect(un('tresorerie', { conclusions: [tresorerie] }, [perimee])).toMatchObject({ etat: 'en-cours', causes: ['soldes-a-revoir'] })
    const enAnomalie = decision({ id: 'j3', compte: '512000', solde: 100, etat: 'anomalie', motif: 'Écart' })
    expect(un('tresorerie', { conclusions: [tresorerie] }, [enAnomalie])).toMatchObject({ etat: 'en-cours', causes: ['soldes-en-anomalie'] })
    // Une écriture de 2024, exercice non validé : l'ouverture de 2025 attend, ses soldes aussi — le cycle se conclut quand même.
    const attente = [...ecritures, ...ecritureEquilibree('e0', '2024-06-01', '606100', '512000', 10)]
    expect(un('tresorerie', { conclusions: [tresorerie] }, [justifiee], { ecritures: attente })).toMatchObject({ etat: 'en-cours', causes: ['soldes-en-attente'] })
    // Un solde accepté sur motif est réglé.
    const accepte = decision({ id: 'j4', compte: '512000', solde: 100, etat: 'accepte', motif: 'Négligeable' })
    expect(un('tresorerie', { conclusions: [tresorerie] }, [accepte])?.etat).toBe('revise')
  })

  it('anomalie, à reprendre, revu, revue périmée', () => {
    expect(un('tresorerie', { conclusions: [conclusion({ id: 'k1', etat: 'anomalie' })] }, [])?.etat).toBe('anomalie')
    const approuvee = revue({ conclusion_id: 'k1', revu_le: '2026-02-01T12:00:00Z' })
    expect(un('tresorerie', { conclusions: [tresorerie], revues: [approuvee] })).toMatchObject({ etat: 'revu', causes: [] })
    // Revoir une anomalie l'approuve telle qu'elle est conclue.
    expect(un('tresorerie', { conclusions: [conclusion({ id: 'k1', etat: 'anomalie' })], revues: [approuvee] }, [])?.etat).toBe('revu')
    const aReprendre = revue({ conclusion_id: 'k1', avis: 'a_reprendre', observation: 'Le relevé manque' })
    expect(un('tresorerie', { conclusions: [tresorerie], revues: [aReprendre] })?.etat).toBe('a-reprendre')
    // Une note, une décision, une conclusion d'après la revue la périment ; une revue d'un autre cycle, non.
    const apres = noteDuJournal({ cycle: 'tresorerie', cree_le: '2026-02-01T13:00:00Z' })
    expect(un('tresorerie', { conclusions: [tresorerie], revues: [approuvee], journal: [apres] })).toMatchObject({ etat: 'revue-perimee', causes: ['activite-posterieure'] })
    const decisionApres = decision({ id: 'j5', compte: '512000', solde: 100, etat: 'justifie', remplace_id: 'j1', cree_le: '2026-02-02T09:00:00Z' })
    expect(un('tresorerie', { conclusions: [tresorerie], revues: [approuvee] }, [justifiee, decisionApres])?.etat).toBe('revue-perimee')
    expect(un('tresorerie', { conclusions: [tresorerie], revues: [approuvee], journal: [noteDuJournal({ cycle: 'recettes', cree_le: '2026-02-03T10:00:00Z' })] })?.etat).toBe('revu')
    // Au même instant que la revue, ce n'est pas « avant » : la revue est périmée.
    const memeInstant = noteDuJournal({ cycle: 'tresorerie', cree_le: '2026-02-01T12:00:00Z' })
    expect(un('tresorerie', { conclusions: [tresorerie], revues: [approuvee], journal: [memeInstant] })?.etat).toBe('revue-perimee')
    const avant = noteDuJournal({ cycle: 'tresorerie', cree_le: '2026-02-01T11:59:59.999Z' })
    expect(un('tresorerie', { conclusions: [tresorerie], revues: [approuvee], journal: [avant] })?.etat).toBe('revu')
    // Une revue approuvée dont les soldes ont depuis cessé d'être réglés : le cycle est de nouveau en cours, la revue reste dite.
    const ouvert = un('tresorerie', { conclusions: [tresorerie], revues: [approuvee] }, [])
    expect(ouvert).toMatchObject({ etat: 'en-cours', causes: ['soldes-a-justifier'] })
    expect(ouvert?.revue?.revue).toEqual(approuvee)
  })

  it('la revue d’une conclusion remplacée ne vaut plus : la nouvelle conclusion attend la sienne', () => {
    const nouvelle = conclusion({ id: 'k2', remplace_id: 'k1', cree_le: '2026-02-03T10:00:00Z' })
    const r = un('tresorerie', { conclusions: [tresorerie, nouvelle], revues: [revue({ conclusion_id: 'k1' })] })
    expect(r).toMatchObject({ etat: 'revise', revue: null })
    expect(r?.revues).toHaveLength(1)
  })

  it('la trace dit qui a revu ce qu’il avait conclu (A30-1)', () => {
    const r = un('tresorerie', { conclusions: [conclusion({ id: 'k1', auteur: CHEF.toUpperCase() })], revues: [revue({ conclusion_id: 'k1', revu_par: CHEF })] })
    expect(r?.revue).toMatchObject({ perimee: false, parLAuteur: true })
    expect(un('tresorerie', { conclusions: [tresorerie], revues: [revue({ conclusion_id: 'k1' })] })?.revue?.parLAuteur).toBe(false)
  })

  it('le cycle « ensemble » attend les autres, et sa revue se périme de toute la révision', () => {
    const toutes = (etat: 'revise' | 'anomalie' = 'revise') => ['tresorerie', 'recettes', 'depenses', 'social', 'capitaux']
      .map((c, i) => conclusion({ id: `c${i}`, cycle: c, etat, cree_le: '2026-02-01T10:00:00Z' }))
    const ensemble = conclusion({ id: 'ens', cycle: 'ensemble', cree_le: '2026-02-02T10:00:00Z' })
    expect(un('ensemble', { conclusions: [ensemble] })).toMatchObject({ etat: 'en-cours', causes: ['cycles-ouverts'] })
    expect(un('ensemble', { conclusions: [...toutes(), ensemble] })).toMatchObject({ etat: 'revise', causes: [] })
    expect(un('ensemble', { conclusions: [...toutes('anomalie'), ensemble] })?.etat).toBe('revise')
    // Un cycle renvoyé à reprendre n'est pas réglé.
    expect(un('ensemble', { conclusions: [...toutes(), ensemble], revues: [revue({ id: 'v0', conclusion_id: 'c0', avis: 'a_reprendre', observation: 'X' })] }))
      .toMatchObject({ etat: 'en-cours', causes: ['cycles-ouverts'] })
    // Un cycle dont la revue s'est périmée reste réglé pour la synthèse : sa préparation est faite, seule sa revue est à
    // refaire.
    const revueTresorerie = revue({ id: 'vt', conclusion_id: 'c0', revu_le: '2026-02-01T11:00:00Z' })
    const noteApres = noteDuJournal({ cycle: 'tresorerie', cree_le: '2026-02-01T12:00:00Z' })
    const perimee = { conclusions: [...toutes(), ensemble], revues: [revueTresorerie], journal: [noteApres] }
    expect(un('tresorerie', perimee)?.etat).toBe('revue-perimee')
    expect(un('ensemble', perimee)).toMatchObject({ etat: 'revise', causes: [] })
    const revueEnsemble = revue({ id: 've', conclusion_id: 'ens', revu_le: '2026-02-03T10:00:00Z' })
    expect(un('ensemble', { conclusions: [...toutes(), ensemble], revues: [revueEnsemble] })?.etat).toBe('revu')
    // Une note d'un autre cycle, après la revue de la synthèse, la périme.
    expect(un('ensemble', { conclusions: [...toutes(), ensemble], revues: [revueEnsemble], journal: [noteDuJournal({ cycle: 'social', cree_le: '2026-02-04T10:00:00Z' })] })?.etat)
      .toBe('revue-perimee')
  })

  it('en attente sur l’exercice en cours ; à revoir sur une chaîne qui ne se lit pas', () => {
    const r = cyclesDeLExercice(revision([], { annee: 2026 }), { ...vide, conclusions: [conclusion({ annee: 2026 })] }, null, 2026)
    expect(new Set(r.cycles.map((c) => c.etat))).toEqual(new Set(['en-attente']))
    expect(r.exercice).toBe('en-cours')
    const illisible = [conclusion({ id: 'a' }), conclusion({ id: 'b' })]
    expect(un('tresorerie', { conclusions: illisible })).toMatchObject({ etat: 'a-revoir', causes: ['chaine-illisible'] })
  })

  it('le programme courant relu, ses travaux non faits comptés, l’historique dans l’ordre', () => {
    // Un travail fait, deux non faits : compter les faits rendrait 1, et non 2.
    const k = conclusion({
      id: 'k1', travaux: [{ code: 'tresorerie-releves', travail: 'R', fait: true }, { travail: 'A', fait: false }, { travail: 'B', fait: false }],
    })
    const r = un('tresorerie', {
      conclusions: [k],
      journal: [noteDuJournal({ id: 'n2', cycle: 'tresorerie', cree_le: '2026-03-02T10:00:00Z' }), noteDuJournal({ id: 'n1', cycle: 'tresorerie', cree_le: '2026-03-01T10:00:00Z' })],
    })
    expect(r?.travauxNonFaits).toBe(2)
    expect(r?.programme).toMatchObject({ lisible: true })
    expect(r?.journal.map((n) => n.id)).toEqual(['n1', 'n2'])
    // Les revues des conclusions du cycle, de la plus ancienne à la plus récente, quel que soit l'ordre de lecture.
    const h = un('tresorerie', {
      conclusions: [k, conclusion({ id: 'k2', remplace_id: 'k1', cree_le: '2026-02-03T10:00:00Z' })],
      revues: [revue({ id: 'v2', conclusion_id: 'k2', revu_le: '2026-02-04T10:00:00Z' }), revue({ id: 'v1', conclusion_id: 'k1', revu_le: '2026-02-02T10:00:00Z' })],
    })
    expect(h?.revues.map((v) => v.id)).toEqual(['v1', 'v2'])
    const illisible = un('tresorerie', { conclusions: [conclusion({ id: 'k1', travaux: { x: 1 } })] })
    expect(illisible).toMatchObject({ programme: { lisible: false }, travauxNonFaits: 0, etat: 'revise' })
  })

  it('les points à suivre de l’exercice précédent, en tête du même cycle', () => {
    const r = un('tresorerie', { conclusions: [conclusion({ id: 'p', annee: 2024, a_suivre: 'Le chèque de décembre' })] })
    expect(r?.pointsASuivre).toEqual({ annee: 2024, texte: 'Le chèque de décembre' })
  })

  it('un cycle qu’une conclusion ou une note nomme se montre, même hors des cycles du dossier', () => {
    const r = cyclesDeLExercice(revision(), { ...vide, decisions: [justifiee], journal: [noteDuJournal({ cycle: 'stocks' })] }, null, 2026)
    expect(r.cycles.map((c) => c.cycle)).toEqual(['tresorerie', 'recettes', 'depenses', 'social', 'capitaux', 'stocks', 'ensemble'])
    // Une note d'un autre exercice ne l'ouvre pas.
    const s = cyclesDeLExercice(revision(), { ...vide, decisions: [justifiee], journal: [noteDuJournal({ cycle: 'stocks', annee: 2024 })] }, null, 2026)
    expect(s.cycles.map((c) => c.cycle)).not.toContain('stocks')
  })

  it('compte l’avancement ; une lecture partielle n’affirme rien', () => {
    const r = cyclesDeLExercice(revision(), { ...vide, decisions: [justifiee], conclusions: [tresorerie] }, null, 2026)
    // La trésorerie conclue ; les cinq autres sans rien — « ensemble » compris, que rien n'a encore commencé.
    expect(r.avancement).toEqual({ ...Object.fromEntries(ETATS_DU_CYCLE.map((e) => [e, 0])), revise: 1, 'non-commence': 5 })
    for (const lecture of [
      cyclesDeLExercice(revision(), { ...vide, conclusions: [tresorerie] }, 'Les revues n’ont été lues qu’en partie.', 2026),
      cyclesDeLExercice(revisionDeLExercice(donnees({ ecritures, lectureIncomplete: 'Le brouillon n’a été lu qu’en partie.' }), []), { ...vide, conclusions: [tresorerie] }, null, 2026),
    ]) {
      expect(lecture.lectureIncomplete).not.toBeNull()
      expect(lecture.exercice).toBeNull()
      expect(lecture.cycles).toEqual([])
      expect(Object.values(lecture.avancement).every((n) => n === 0)).toBe(true)
    }
  })
})

// ── Un module de calcul ───────────────────────────────────────────────────────────────────────────────────────────

describe('un module pur', () => {
  it('n’atteint pas supabase.ts, ni par lui-même ni par ce qu’il importe', () => {
    const racine = new URL('./', import.meta.url).pathname
    const vus = new Set<string>()
    const aVoir = ['revisionRevue.ts']
    while (aVoir.length > 0) {
      const fichier = aVoir.pop() as string
      if (vus.has(fichier)) continue
      vus.add(fichier)
      const texte = readFileSync(racine + fichier, 'utf8')
      for (const m of texte.matchAll(/^import (?!type )[\s\S]*?from '\.\/([\w.]+)'/gm)) {
        const cible = /\.tsx?$/.test(m[1]) ? m[1] : `${m[1]}.ts`
        aVoir.push(cible)
      }
    }
    expect(vus.size).toBeGreaterThan(5)
    expect([...vus]).not.toContain('supabase.ts')
    // Le garde voit une importation de supabase.ts : planté, il le trouverait.
    expect(/^import (?!type )[\s\S]*?from '\.\/([\w.]+)'/m.exec("import { supabase } from './supabase'")?.[1]).toBe('supabase')
  })
})

// Une conclusion de la fabrique est entière : chaque colonne que la base écrit y est.
const _typeEntier: RevisionConclusion = conclusion({})
void _typeEntier

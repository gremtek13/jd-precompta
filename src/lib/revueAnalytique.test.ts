import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BORNE_DES_MONTANTS, centimesDeLa2035Validee, centimesDuNavigateur, centimesDuRepereAnnuel, chaineDesExplications, chaineDesSeuils,
  ETATS_DE_LA_LIGNE, exerciceDeLaRevue, LIBELLE_DE_L_ETAT_DE_LA_LIGNE, LIBELLE_DE_LA_SOURCE, LIBELLE_DU_TOTAL, lireLa2035Validee,
  LONGUEUR_MAX_EXPLICATION, LONGUEUR_MAX_MOTIF_DU_SEUIL, LONGUEUR_MAX_POSTE, montantCommeLaBase, MOTIF_COMPTE_COMPARE, NATURES_D_UN_POSTE,
  OBJETS_DE_LA_REVUE, REFUS_EXPLIQUER_VARIATION, REFUS_FIXER_SEUIL, refusDExpliquerVariation, refusDeFixerSeuil, revueAnalytiqueDeLExercice,
  SOURCES_DU_PRECEDENT, sourceDuPrecedent, TOTAUX_DE_LA_2035, variationEnDixiemes, argumentsDeFixerSeuil, argumentsDExpliquerVariation,
  type ArgumentsExpliquerVariation, type ArgumentsFixerSeuil, type CleDeLigne, type ContexteDeLExplication, type ContexteDuSeuil,
  type DonneesDeLaRevueAnalytique, type ExercicePourLaRevue, type LigneDeLaRevue, type ReperesAnnuels,
} from './revueAnalytique'
import type { RevisionExplication, RevisionSeuil } from './types'
import { argumentsSql, codesSql, messagesSql, nombreDeValeurs, numerosSql } from '../test/raiseSql'
import { DOSSIER, ecriture } from '../test/revision'
import { explication, part, posteDeclare, seuil } from '../test/revueAnalytique'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// LA REVUE ANALYTIQUE (ligne 41, étape R5) : le module, confronté au texte de la migration `revue_analytique` et à des cas
// calculés À LA MAIN, en centimes. Le rejeu de l'essai de l'étape sur le module est dans revueAnalytiqueEssai.test.ts.

const UUID = (n: number) => `0e5a0000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MIGRATION = fichiersDuSchema().find((f) => /^supabase\/schema\/\d{14}_revue_analytique\.sql$/.test(f.chemin))?.texte ?? ''

// ── Les littéraux de la migration ─────────────────────────────────────────────────────────────────────────────────

describe('les littéraux sont ceux de la migration', () => {
  const expliquer = derniereDefinitionSql('expliquer_variation')
  const liste = (texte: string, motif: RegExp) => [...(motif.exec(texte) as RegExpExecArray)[1].matchAll(/'(\w+)'/g)].map((m) => m[1])

  it('la migration est dans l’export, une fois', () => {
    expect(fichiersDuSchema().filter((f) => /_revue_analytique\.sql$/.test(f.chemin))).toHaveLength(1)
    expect(MIGRATION.length).toBeGreaterThan(30000)
  })

  it('les types d’objet, les totaux, les natures, les sources — dans la table et dans la fonction', () => {
    expect(liste(MIGRATION, /objet_type check \(objet_type in \(([^)]*)\)\)/)).toEqual([...OBJETS_DE_LA_REVUE])
    expect(liste(expliquer, /p_objet_type not in \(([^)]*)\)/)).toEqual([...OBJETS_DE_LA_REVUE])
    expect(liste(MIGRATION, /when 'total_2035' then objet in \(([^)]*)\)/)).toEqual([...TOTAUX_DE_LA_2035])
    expect(liste(expliquer, /p_objet not in \(([^)]*)\)/)).toEqual([...TOTAUX_DE_LA_2035])
    expect(liste(MIGRATION, /nature check \(nature in \(([^)]*)\)\)/)).toEqual([...NATURES_D_UN_POSTE])
    expect(liste(expliquer, /p_nature not in \(([^)]*)\)/)).toEqual([...NATURES_D_UN_POSTE])
    expect(liste(MIGRATION, /source_precedent check \(source_precedent in \(([^)]*)\)\)/)).toEqual([...SOURCES_DU_PRECEDENT])
    expect(liste(expliquer, /p_source_precedent not in \(([^)]*)\)/)).toEqual([...SOURCES_DU_PRECEDENT])
  })

  it('les longueurs, le motif d’un compte, la borne des montants', () => {
    expect(MIGRATION).toContain(`length(objet) <= ${LONGUEUR_MAX_POSTE}`)
    expect(expliquer).toContain(`if length(p_objet) > ${LONGUEUR_MAX_POSTE} then`)
    expect(MIGRATION).toContain(`length(explication) <= ${LONGUEUR_MAX_EXPLICATION}`)
    expect(expliquer).toContain(`if length(p_explication) > ${LONGUEUR_MAX_EXPLICATION} then`)
    expect(MIGRATION).toContain(`length(motif) <= ${LONGUEUR_MAX_MOTIF_DU_SEUIL}`)
    expect(derniereDefinitionSql('fixer_seuil_de_signification')).toContain(`if length(p_motif) > ${LONGUEUR_MAX_MOTIF_DU_SEUIL} then`)
    expect(MIGRATION).toContain(`objet ~ '${MOTIF_COMPTE_COMPARE.source}'`)
    expect(expliquer).toContain(`p_objet !~ '${MOTIF_COMPTE_COMPARE.source}'`)
    expect(expliquer).toContain(`not (abs(p_montant) < ${BORNE_DES_MONTANTS})`)
    expect(derniereDefinitionSql('centimes_du_navigateur')).toContain(`if not (abs(v) < ${BORNE_DES_MONTANTS}::double precision) then`)
  })

  it('les blancs d’un texte sont ceux de la base', () => {
    for (const f of ['fixer_seuil_de_signification', 'expliquer_variation']) expect(derniereDefinitionSql(f)).toContain("E' \\t\\n\\r'")
  })
})

// ── Les refus, confrontés au texte des deux fonctions ─────────────────────────────────────────────────────────────

const FORME = "replace(to_char(v_centimes / 100.0, 'FM99999999999990.00'), '.', ',') || ' €'"
const COTE = "case when v_solde = 0 then 'est nul' else 'est de ' || replace(to_char(abs(v_solde), 'FM99999999999990.00'), '.', ',') || ' € au ' || case when v_solde > 0 then 'débit' else 'crédit' end end"
const FONCTIONS = [
  {
    nom: 'fixer_seuil_de_signification', liste: REFUS_FIXER_SEUIL, numeros: [1, 2, 3, 5, 6, 7],
    valeurs: { exercice_en_cours: ['p_annee'], remplacement_hors_exercice: ['p_annee'] } as Record<string, string[]>,
  },
  {
    nom: 'expliquer_variation', liste: REFUS_EXPLIQUER_VARIATION, numeros: [1, 2, 3, 5, 6, 7, 8, 9, 10],
    valeurs: {
      exercice_en_cours: ['p_annee'], source_validee: ['p_annee - 1'], source_reference: ['p_annee - 1'], source_aucune: ['p_annee - 1'],
      solde_change: ['p_objet', 'p_annee', COTE], solde_precedent_change: ['p_objet', 'p_annee - 1', COTE],
      exercice_illisible: ['p_annee'], exercice_autre_montant: ['p_annee', FORME], precedent_illisible: ['p_annee - 1'],
      precedent_autre_montant: ['p_annee - 1', FORME], repere_autre_montant: ['p_annee - 1', FORME], remplacement_hors_ligne: ['p_annee'],
    } as Record<string, string[]>,
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

// ── Les centimes, la forme d'un montant ───────────────────────────────────────────────────────────────────────────

describe('les centimes, comme l’application et la base les comptent', () => {
  it('Math.round(montant × 100) sur le binaire le plus proche — relevé sur la réplique (contrôle 203 de l’essai)', () => {
    // 1,005 vaut 100,49999… en binaire : 100 ; 2,675 vaut 267,5 tout juste : 268 ; −2,675 : −267 (la moitié monte).
    const cas: [number, number | null][] = [
      [1.005, 100], [0.125, 13], [2.675, 268], [-2.675, -267], [-0.005, 0], [-0.004, 0], [Number('99999999999999.99'), 9999999999999998],
      [1234.565, 123457], [-1234.565, -123456], [0, 0], [12.5, 1250], [9000.004, 900000], [-0.5, -50], [0.015, 2], [1e-7, 0],
    ]
    for (const [x, c] of cas) expect(centimesDuNavigateur(x), String(x)).toBe(c)
  })

  it('le zéro négatif de Math.round devient zéro, comme en base', () => {
    expect(Object.is(centimesDuNavigateur(-0.004), 0)).toBe(true)
    expect(Object.is(centimesDuNavigateur(-0), 0)).toBe(true)
  })

  it('nul hors de ±10^14 €, pour NaN, l’infini, et ce qui n’est pas un nombre', () => {
    for (const x of [1e14, -1e14, Number('99999999999999.999'), Number.NaN, Infinity, -Infinity, '12', null, undefined, {}]) {
      expect(centimesDuNavigateur(x), String(x)).toBeNull()
    }
  })

  it('un montant comme la base l’écrit : au centime, la virgule, le signe, sans séparateur de milliers', () => {
    expect(montantCommeLaBase(300000)).toBe('3000,00 €')
    expect(montantCommeLaBase(-123456)).toBe('-1234,56 €')
    expect(montantCommeLaBase(0)).toBe('0,00 €')
    expect(montantCommeLaBase(-5)).toBe('-0,05 €')
    expect(montantCommeLaBase(9999999999999998)).toBe('99999999999999,98 €')
  })
})

// ── La 2035 validée, les repères, la source ───────────────────────────────────────────────────────────────────────

const DECL_2024 = {
  version: 1, annee: 2024, totalRecettes: 10000, totalDepenses: 4200.5, resultat: 5799.5,
  postes: [
    { poste: 'Honoraires', nature: 'recette', montant: 10000 }, { poste: 'Achats', nature: 'depense', montant: 1200.5 },
    { poste: 'Loyers', nature: 'depense', montant: 3000 },
  ],
}
const poste = (objet: string, nature: 'recette' | 'depense' = 'depense'): CleDeLigne => ({ objet_type: 'poste_2035', objet, nature })
const total = (objet: 'recettes' | 'depenses' | 'resultat'): CleDeLigne => ({ objet_type: 'total_2035', objet, nature: null })
const compte = (objet: string): CleDeLigne => ({ objet_type: 'compte', objet, nature: null })

describe('la 2035 validée, relue sans deviner', () => {
  it('un poste par sa nature, ses entrées additionnées ; zéro pour un poste qu’elle ne porte pas ; un total', () => {
    const d = { postes: [{ poste: 'A', nature: 'depense', montant: 1.5 }, { poste: 'A', nature: 'depense', montant: 0.25 }, { poste: 'A', nature: 'recette', montant: 9 }], totalRecettes: 9, totalDepenses: 1.75, resultat: 7.25 }
    expect(centimesDeLa2035Validee(d, poste('A'))).toBe(175)
    expect(centimesDeLa2035Validee(d, poste('A', 'recette'))).toBe(900)
    expect(centimesDeLa2035Validee(d, poste('B'))).toBe(0)
    expect(centimesDeLa2035Validee(d, total('recettes'))).toBe(900)
    expect(centimesDeLa2035Validee(d, total('depenses'))).toBe(175)
    expect(centimesDeLa2035Validee(d, total('resultat'))).toBe(725)
    expect(centimesDeLa2035Validee({ ...d, resultat: -7.255 }, total('resultat'))).toBe(-725)
  })

  it('nulle quand elle ne se relit pas — chaque forme que la base refuse (contrôle 204 de l’essai)', () => {
    const bon = { postes: [], totalRecettes: 9, totalDepenses: 1.75, resultat: 7.25 }
    const fautes: unknown[] = [
      null, '["postes"]', ['postes'], { ...bon, totalRecettes: '9' }, { postes: [], totalRecettes: 9, resultat: 7.25 },
      { ...bon, postes: {} }, { ...bon, postes: [{ poste: 'A', nature: 'charge', montant: 1 }] },
      { ...bon, postes: [{ poste: 1, nature: 'depense', montant: 1 }] }, { ...bon, postes: [{ poste: 'A', nature: 'depense', montant: '1' }] },
      { ...bon, postes: [{ poste: 'A', nature: 'depense', montant: 1e14 }] }, { ...bon, postes: [{ poste: 'A', nature: 'depense' }] },
      { ...bon, postes: ['A'] }, { essai: 'D' }, { ...bon, resultat: null },
    ]
    for (const f of fautes) {
      expect(lireLa2035Validee(f), JSON.stringify(f)).toBeNull()
      expect(centimesDeLa2035Validee(f, total('recettes')), JSON.stringify(f)).toBeNull()
    }
    // Une clé de plus ne dérange pas ; un poste négatif reste négatif.
    expect(centimesDeLa2035Validee({ ...bon, autre: 'x' }, poste('Inconnu'))).toBe(0)
    expect(centimesDeLa2035Validee({ ...bon, postes: [{ poste: 'A', nature: 'depense', montant: -2.5 }] }, poste('A'))).toBe(-250)
  })
})

const REPERES: ReperesAnnuels = {
  annuels: [{ annee: 2024, chiffre_affaires: 9000.004, resultat_net: -1234.565 }, { annee: 2023, chiffre_affaires: null, resultat_net: 12 }],
  postes: [
    { annee: 2024, poste: 'Loyers', montant: 2400 }, { annee: 2024, poste: 'Énorme', montant: 1e20 }, { annee: 2024, poste: 'Achats', montant: Number.NaN },
  ],
}

describe('les repères annuels', () => {
  it('un poste de DÉPENSES à son nom exact, le chiffre d’affaires, le résultat net — rien d’autre (contrôle 205)', () => {
    expect(centimesDuRepereAnnuel(REPERES, 2024, poste('Loyers'))).toBe(240000)
    expect(centimesDuRepereAnnuel(REPERES, 2024, poste('Loyers', 'recette'))).toBeNull()
    expect(centimesDuRepereAnnuel(REPERES, 2024, poste('loyers'))).toBeNull()
    expect(centimesDuRepereAnnuel(REPERES, 2024, poste('Énorme'))).toBeNull()
    expect(centimesDuRepereAnnuel(REPERES, 2024, poste('Achats'))).toBeNull()
    expect(centimesDuRepereAnnuel(REPERES, 2024, total('recettes'))).toBe(900000)
    expect(centimesDuRepereAnnuel(REPERES, 2024, total('resultat'))).toBe(-123456)
    expect(centimesDuRepereAnnuel(REPERES, 2024, total('depenses'))).toBeNull()
    expect(centimesDuRepereAnnuel(REPERES, 2023, total('recettes'))).toBeNull()
    expect(centimesDuRepereAnnuel(REPERES, 2023, total('resultat'))).toBe(1200)
    expect(centimesDuRepereAnnuel(REPERES, 2022, total('resultat'))).toBeNull()
    expect(centimesDuRepereAnnuel(REPERES, 2024, compte('706000'))).toBeNull()
  })
})

describe('la source de l’exercice précédent, ligne par ligne', () => {
  const sans: ReperesAnnuels = { annuels: [], postes: [] }
  const source = (annee: number, cle: CleDeLigne, valides: ExercicePourLaRevue[], reperes: ReperesAnnuels = REPERES) =>
    sourceDuPrecedent(annee, cle, { exercicesValides: valides, reperes })

  it('l’exercice précédent validé : sa 2035 pour une ligne de la 2035, lui-même pour un compte', () => {
    const valides = [{ annee: 2024, declaration: DECL_2024 }]
    expect(source(2025, compte('512000'), valides)).toBe('validee')
    expect(source(2025, poste('Inconnu'), valides)).toBe('validee')
    expect(source(2025, total('resultat'), valides)).toBe('validee')
    // L'exercice validé est le précédent, pas un autre.
    expect(source(2026, compte('512000'), valides)).toBe('aucune')
    expect(source(2024, total('resultat'), valides)).toBe('reference')
    expect(source(2024, total('resultat'), valides, sans)).toBe('aucune')
  })

  it('sinon un repère qui porte la ligne, jamais pour un compte ; sinon rien', () => {
    expect(source(2025, total('recettes'), [])).toBe('reference')
    expect(source(2025, total('resultat'), [])).toBe('reference')
    expect(source(2025, total('depenses'), [])).toBe('aucune')
    expect(source(2025, poste('Loyers'), [])).toBe('reference')
    expect(source(2025, poste('Loyers', 'recette'), [])).toBe('aucune')
    expect(source(2025, poste('Achats'), [])).toBe('aucune')
    expect(source(2025, compte('706000'), [])).toBe('aucune')
    expect(source(2025, total('recettes'), [], sans)).toBe('aucune')
  })

  it('un exercice validé en engagement n’a pas de 2035 validée : ses lignes de la 2035 passent au repère, ses comptes non', () => {
    const valides = [{ annee: 2024, declaration: null }]
    expect(source(2025, total('recettes'), valides)).toBe('reference')
    expect(source(2025, total('depenses'), valides)).toBe('aucune')
    expect(source(2025, compte('706000'), valides)).toBe('validee')
  })

  it('une 2035 validée illisible reste la source : elle ne se lit pas, elle ne se remplace pas par un repère', () => {
    expect(source(2025, total('recettes'), [{ annee: 2024, declaration: { essai: 'D' } }])).toBe('validee')
  })
})

// ── Les refus de fixer_seuil_de_signification, cas par cas ────────────────────────────────────────────────────────

const S1 = UUID(1)
const S2 = UUID(2)
const S24 = UUID(3)
const contexteSeuil = (o: Partial<ContexteDuSeuil> = {}): ContexteDuSeuil => ({
  accesAuDossier: true, anneeCourante: 2026,
  seuils: [{ id: S1, annee: 2025, remplace_id: null }, { id: S2, annee: 2025, remplace_id: S1 }, { id: S24, annee: 2024, remplace_id: null }],
  ...o,
})
const fixer = (o: Partial<ArgumentsFixerSeuil> = {}): ArgumentsFixerSeuil => ({
  p_dossier_id: DOSSIER, p_annee: 2025, p_seuil: 1000, p_motif: 'Motif', p_remplace_id: S2, ...o,
})
const cle = (r: { cle: string } | null) => r?.cle ?? null

describe('ce que fixer_seuil_de_signification refuserait, dit avant le clic', () => {
  it('un seuil qui passe tout : il remplace le courant', () => {
    expect(refusDeFixerSeuil(fixer(), contexteSeuil())).toBeNull()
    expect(refusDeFixerSeuil(fixer({ p_annee: 2023, p_remplace_id: null }), contexteSeuil())).toBeNull()
  })

  it('refus 1 : l’accès, avant tout le reste, sous 42501', () => {
    const r = refusDeFixerSeuil(fixer({ p_annee: 1999, p_seuil: 0 }), contexteSeuil({ accesAuDossier: false }))
    expect(r).toEqual({ cle: 'acces', refus: 1, code: '42501', message: 'Accès refusé à ce dossier.' })
  })

  it('refus 2 et 3 : l’exercice, dans les bornes puis terminé à Paris', () => {
    for (const annee of [1999, 2101, null, Number.NaN]) expect(cle(refusDeFixerSeuil(fixer({ p_annee: annee }), contexteSeuil())), String(annee)).toBe('exercice_invalide')
    expect(refusDeFixerSeuil(fixer({ p_annee: 2026, p_seuil: 0 }), contexteSeuil())?.message).toBe("L'exercice 2026 n'est pas terminé : sa révision s'ouvre une fois clos.")
    expect(refusDeFixerSeuil(fixer({ p_annee: 2100 }), contexteSeuil())?.message).toBe("L'exercice 2100 n'est pas terminé : sa révision s'ouvre une fois clos.")
    expect(cle(refusDeFixerSeuil(fixer({ p_annee: 2000, p_remplace_id: null }), contexteSeuil()))).toBeNull()
  })

  it('refus 5 : un montant positif au centime, sous cent mille milliards', () => {
    for (const s of [null, 0, -1, 0.001, 1e14, Number.NaN, Infinity, 0.1 + 0.2]) expect(cle(refusDeFixerSeuil(fixer({ p_seuil: s }), contexteSeuil())), String(s)).toBe('seuil_invalide')
    for (const s of [0.01, Number('99999999999999.99'), 1500.5]) expect(refusDeFixerSeuil(fixer({ p_seuil: s }), contexteSeuil()), String(s)).toBeNull()
  })

  it('refus 6 : un motif, qui n’est pas fait de blancs, en 4 000 caractères (hypothèse Q4)', () => {
    expect(cle(refusDeFixerSeuil(fixer({ p_motif: null }), contexteSeuil()))).toBe('motif_absent')
    expect(cle(refusDeFixerSeuil(fixer({ p_motif: ' \t\n\r' }), contexteSeuil()))).toBe('motif_absent')
    expect(refusDeFixerSeuil(fixer({ p_motif: ' ' }), contexteSeuil())).toBeNull()
    expect(refusDeFixerSeuil(fixer({ p_motif: 'm'.repeat(4000) }), contexteSeuil())).toBeNull()
    expect(cle(refusDeFixerSeuil(fixer({ p_motif: 'm'.repeat(4001) }), contexteSeuil()))).toBe('motif_trop_long')
    // Les caractères, pas les unités UTF-16 : 4 000 émoticônes passent.
    expect(refusDeFixerSeuil(fixer({ p_motif: '😀'.repeat(4000) }), contexteSeuil())).toBeNull()
  })

  it('refus 7 : remplacer le courant, ou rien quand il n’y en a pas', () => {
    expect(refusDeFixerSeuil(fixer({ p_remplace_id: null }), contexteSeuil())?.message)
      .toBe('Un autre seuil a été fixé pour cet exercice depuis : relire avant de le changer.')
    expect(cle(refusDeFixerSeuil(fixer({ p_remplace_id: S1 }), contexteSeuil()))).toBe('remplacement_perime')
    expect(refusDeFixerSeuil(fixer({ p_remplace_id: S24 }), contexteSeuil())?.message)
      .toBe("Le seuil à remplacer n'est pas un seuil de l'exercice 2025 dans ce dossier.")
    expect(cle(refusDeFixerSeuil(fixer({ p_remplace_id: UUID(99) }), contexteSeuil()))).toBe('remplacement_hors_exercice')
    expect(cle(refusDeFixerSeuil(fixer({ p_annee: 2024, p_remplace_id: null }), contexteSeuil()))).toBe('remplacement_perime')
    // La base compare un uuid sans la casse.
    expect(refusDeFixerSeuil(fixer({ p_remplace_id: S2.toUpperCase() }), contexteSeuil())).toBeNull()
    // Le courant est celui qu'aucun autre ne remplace, quel que soit l'ordre de lecture — pas le dernier lu.
    const desordre = contexteSeuil({ seuils: [{ id: S2, annee: 2025, remplace_id: S1 }, { id: S1, annee: 2025, remplace_id: null }] })
    expect(refusDeFixerSeuil(fixer({ p_remplace_id: S2 }), desordre)).toBeNull()
    expect(cle(refusDeFixerSeuil(fixer({ p_remplace_id: S1 }), desordre))).toBe('remplacement_perime')
  })

  it('l’ordre : l’exercice avant le seuil, le seuil avant le motif, le motif avant le remplacement', () => {
    expect(cle(refusDeFixerSeuil(fixer({ p_annee: 1999, p_seuil: 0 }), contexteSeuil()))).toBe('exercice_invalide')
    expect(cle(refusDeFixerSeuil(fixer({ p_seuil: 0, p_motif: null }), contexteSeuil()))).toBe('seuil_invalide')
    expect(cle(refusDeFixerSeuil(fixer({ p_motif: null, p_remplace_id: UUID(99) }), contexteSeuil()))).toBe('motif_absent')
  })
})

// ── Les refus d'expliquer_variation, cas par cas ──────────────────────────────────────────────────────────────────

// Le dossier A de l'essai : 2024 validé, sa 2035 lisible ; 2025 ouvert. La banque en 2025 : 12 500 + 0,10 − 1 000 −
// 9 000 = 2 500,10 au débit ; en 2024 : 10 000 − 1 200,50 − 3 000 = 5 799,50. Les honoraires : 12 500,10 et 10 000 au crédit.
const ECRITURES_A = [
  ['2024-03-15', '512000', 10000, 'debit'], ['2024-03-15', '706000', 10000, 'credit'],
  ['2024-05-10', '606100', 1200.5, 'debit'], ['2024-05-10', '512000', 1200.5, 'credit'],
  ['2024-06-01', '613200', 3000, 'debit'], ['2024-06-01', '512000', 3000, 'credit'],
  ['2025-03-15', '512000', 12500, 'debit'], ['2025-03-15', '706000', 12500, 'credit'],
  ['2025-03-16', '512000', 0.1, 'debit'], ['2025-03-16', '706000', 0.1, 'credit'],
  ['2025-05-10', '606100', 1000, 'debit'], ['2025-05-10', '512000', 1000, 'credit'],
  ['2025-06-01', '613200', 9000, 'debit'], ['2025-06-01', '512000', 9000, 'credit'],
].map(([date, c, montant, sens], i) => ecriture({ id: `e${i}`, date: date as string, compte: c as string, montant: montant as number, sens: sens as 'debit' | 'credit' }))

const X1 = UUID(11)
const X2 = UUID(12)
const X3 = UUID(13)
const contexteExplication = (o: Partial<ContexteDeLExplication> = {}): ContexteDeLExplication => ({
  accesAuDossier: true, anneeCourante: 2026, exercicesValides: [{ annee: 2024, declaration: DECL_2024 }], reperes: { annuels: [], postes: [] },
  ecritures: ECRITURES_A, reprise: [], reportes: [],
  explications: [
    { id: X1, annee: 2025, objet_type: 'compte', objet: '706000', nature: null, remplace_id: null },
    { id: X2, annee: 2025, objet_type: 'compte', objet: '706000', nature: null, remplace_id: X1 },
    { id: X3, annee: 2025, objet_type: 'total_2035', objet: 'resultat', nature: null, remplace_id: null },
  ],
  ...o,
})
const expliquer = (o: Partial<ArgumentsExpliquerVariation> = {}): ArgumentsExpliquerVariation => ({
  p_dossier_id: DOSSIER, p_annee: 2025, p_objet_type: 'compte', p_objet: '512000', p_nature: null, p_montant: 2500.1,
  p_montant_precedent: 5799.5, p_source_precedent: 'validee', p_explication: 'Explication', p_remplace_id: null, ...o,
})
const refus = (o: Partial<ArgumentsExpliquerVariation>, c: Partial<ContexteDeLExplication> = {}) =>
  refusDExpliquerVariation(expliquer(o), contexteExplication(c))

describe('ce que expliquer_variation refuserait, dit avant le clic', () => {
  it('une explication qui passe tout', () => {
    expect(refus({})).toBeNull()
    expect(refus({ p_objet: '706000', p_montant: -12500.1, p_montant_precedent: -10000, p_remplace_id: X2 })).toBeNull()
    expect(refus({ p_objet_type: 'total_2035', p_objet: 'resultat', p_montant: 2500.1, p_montant_precedent: 5799.5, p_remplace_id: X3 })).toBeNull()
  })

  it('refus 1, 2 et 3', () => {
    expect(refus({ p_annee: 1999 }, { accesAuDossier: false })).toEqual({ cle: 'acces', refus: 1, code: '42501', message: 'Accès refusé à ce dossier.' })
    for (const annee of [1999, 2101, null]) expect(cle(refus({ p_annee: annee, p_objet_type: 'ligne' })), String(annee)).toBe('exercice_invalide')
    expect(refus({ p_annee: 2026, p_objet_type: 'ligne' })?.message).toBe("L'exercice 2026 n'est pas terminé : sa révision s'ouvre une fois clos.")
  })

  it('refus 5 : la ligne', () => {
    expect(cle(refus({ p_objet_type: 'ligne' }))).toBe('objet_inconnu')
    expect(cle(refus({ p_objet_type: null }))).toBe('objet_inconnu')
    const p = { p_objet_type: 'poste_2035', p_nature: 'depense', p_montant: 0, p_montant_precedent: 0 }
    expect(cle(refus({ ...p, p_objet: null }))).toBe('poste_sans_nom')
    expect(cle(refus({ ...p, p_objet: ' \t\n\r' }))).toBe('poste_sans_nom')
    expect(refus({ ...p, p_objet: ' ' })).toBeNull()
    expect(refus({ ...p, p_objet: 'p'.repeat(500) })).toBeNull()
    expect(cle(refus({ ...p, p_objet: 'p'.repeat(501) }))).toBe('poste_trop_long')
    expect(cle(refus({ ...p, p_objet: 'Achats', p_nature: null }))).toBe('nature_du_poste')
    expect(cle(refus({ ...p, p_objet: 'Achats', p_nature: 'Depense' }))).toBe('nature_du_poste')
    expect(cle(refus({ p_objet_type: 'total_2035', p_objet: 'benefice' }))).toBe('total_inconnu')
    expect(cle(refus({ p_objet_type: 'total_2035', p_objet: null }))).toBe('total_inconnu')
    for (const c of ['801000', '51', '512000 ', null, '0512000', 'x12']) expect(cle(refus({ p_objet: c })), String(c)).toBe('compte_hors_classes')
    expect(cle(refus({ p_objet_type: 'total_2035', p_objet: 'resultat', p_nature: 'recette' }))).toBe('nature_hors_poste')
    expect(cle(refus({ p_nature: 'depense' }))).toBe('nature_hors_poste')
  })

  it('refus 6 : les montants et la source, leur forme', () => {
    for (const m of [null, 2500.105, -1e14, Number.NaN]) expect(cle(refus({ p_montant: m })), String(m)).toBe('montant_invalide')
    expect(cle(refus({ p_source_precedent: 'validée' }))).toBe('source_inconnue')
    expect(cle(refus({ p_source_precedent: null }))).toBe('source_inconnue')
    expect(cle(refus({ p_source_precedent: 'aucune', p_montant_precedent: 0 }))).toBe('precedent_sans_source')
    for (const m of [null, 9000.004, Number.NaN]) expect(cle(refus({ p_montant_precedent: m })), String(m)).toBe('precedent_invalide')
  })

  it('refus 7 : l’explication', () => {
    expect(cle(refus({ p_explication: null }))).toBe('explication_vide')
    expect(cle(refus({ p_explication: ' \t\n\r' }))).toBe('explication_vide')
    expect(refus({ p_explication: ' ' })).toBeNull()
    expect(refus({ p_explication: 'e'.repeat(4000) })).toBeNull()
    expect(cle(refus({ p_explication: 'e'.repeat(4001) }))).toBe('explication_trop_longue')
  })

  it('refus 8 : la source que la base retient, ligne par ligne', () => {
    expect(refus({ p_objet: '706000', p_montant: -12500.1, p_montant_precedent: null, p_source_precedent: 'aucune' })?.message)
      .toBe("L'exercice 2024 est validé : la comparaison se fait à ce qu'il a validé.")
    expect(cle(refus({ p_source_precedent: 'reference' }))).toBe('source_validee')
    const sansValide = { exercicesValides: [], reperes: REPERES }
    expect(refus({ p_objet_type: 'total_2035', p_objet: 'recettes', p_montant: 5, p_montant_precedent: null, p_source_precedent: 'aucune' }, sansValide)?.message)
      .toBe('Un repère annuel de 2024 porte cette ligne : la comparaison se fait à lui.')
    expect(refus({ p_objet_type: 'total_2035', p_objet: 'depenses', p_montant: 0, p_montant_precedent: 0, p_source_precedent: 'reference' }, sansValide)?.message)
      .toBe("L'exercice 2024 n'offre rien à comparer à cette ligne.")
    expect(cle(refus({ p_source_precedent: 'validee' }, sansValide))).toBe('source_aucune')
  })

  it('refus 9 : le solde d’un compte, de l’exercice et du précédent validé, avec son côté', () => {
    expect(refus({ p_objet: '706000', p_montant: -12500, p_montant_precedent: -10000 })?.message)
      .toBe('Le solde du compte 706000 a changé : au 31/12/2025, il est de 12500,10 € au crédit.')
    expect(refus({ p_montant: 2500 })?.message).toBe('Le solde du compte 512000 a changé : au 31/12/2025, il est de 2500,10 € au débit.')
    expect(refus({ p_objet: '101000', p_montant: 1, p_montant_precedent: 0 })?.message).toBe('Le solde du compte 101000 a changé : au 31/12/2025, il est nul.')
    expect(refus({ p_montant_precedent: 5799.49 })?.message)
      .toBe("Le solde du compte 512000 au 31/12/2024 n'est pas celui de l'exercice validé : il est de 5799,50 € au débit.")
    expect(refus({ p_objet: '101000', p_montant: 0, p_montant_precedent: 0 })).toBeNull()
  })

  it('refus 9 : une ligne de la 2035 validée — de l’exercice d’abord, puis du précédent — et d’un repère', () => {
    const p = { p_objet_type: 'poste_2035', p_objet: 'Loyers', p_nature: 'depense', p_montant: 9000 }
    expect(refus({ ...p, p_montant_precedent: 3000.01 })?.message).toBe('La 2035 validée de 2024 porte un autre montant sur cette ligne : 3000,00 €.')
    expect(refus({ ...p, p_montant_precedent: 3000 })).toBeNull()
    // Un exercice non validé : son montant se garde tel que l'écran l'a montré.
    expect(refus({ ...p, p_montant: 123.45, p_montant_precedent: 3000 })).toBeNull()
    expect(refus({ ...p, p_objet: 'Absent', p_montant_precedent: 5 })?.message).toBe('La 2035 validée de 2024 porte un autre montant sur cette ligne : 0,00 €.')
    // 2025 validé à son tour : sa 2035 fait foi, et se juge avant celle de 2024.
    const e = { exercicesValides: [{ annee: 2024, declaration: DECL_2024 }, { annee: 2025, declaration: { ...DECL_2024, postes: [{ poste: 'Loyers', nature: 'depense', montant: 9000.5 }], resultat: -1 } }] }
    expect(refus({ ...p, p_montant_precedent: 1 }, e)?.message).toBe('La 2035 validée de 2025 porte un autre montant sur cette ligne : 9000,50 €.')
    expect(refus({ ...p, p_montant: 9000.5, p_montant_precedent: 1 }, e)?.message).toBe('La 2035 validée de 2024 porte un autre montant sur cette ligne : 3000,00 €.')
    expect(refus({ p_objet_type: 'total_2035', p_objet: 'resultat', p_montant: -0.99, p_montant_precedent: 5799.5 }, e)?.message)
      .toBe('La 2035 validée de 2025 porte un autre montant sur cette ligne : -1,00 €.')
    // Illisibles : l'exercice, puis le précédent.
    expect(refus({ ...p }, { exercicesValides: [{ annee: 2024, declaration: DECL_2024 }, { annee: 2025, declaration: { essai: 'F' } }] })?.message)
      .toBe('La 2035 validée de 2025 ne se relit pas.')
    expect(refus({ ...p, p_montant_precedent: 0 }, { exercicesValides: [{ annee: 2024, declaration: { essai: 'D' } }] })?.message)
      .toBe('La 2035 validée de 2024 ne se relit pas.')
    // Un repère.
    const r = { exercicesValides: [], reperes: REPERES }
    expect(refus({ p_objet_type: 'total_2035', p_objet: 'resultat', p_montant: 200, p_montant_precedent: -1234.57, p_source_precedent: 'reference' }, r)?.message)
      .toBe('Le repère annuel de 2024 porte un autre montant sur cette ligne : -1234,56 €.')
    expect(refus({ p_objet_type: 'total_2035', p_objet: 'resultat', p_montant: 200, p_montant_precedent: -1234.56, p_source_precedent: 'reference', p_remplace_id: X3 }, r)).toBeNull()
  })

  it('refus 10 : remplacer la courante de la ligne, ou rien', () => {
    const c706 = { p_objet: '706000', p_montant: -12500.1, p_montant_precedent: -10000 }
    expect(refus({ ...c706 })?.message).toBe("Une autre explication a été donnée sur cette ligne depuis : relire avant d'expliquer.")
    expect(cle(refus({ ...c706, p_remplace_id: X1 }))).toBe('remplacement_perime')
    expect(refus({ ...c706, p_remplace_id: X3 })?.message).toBe("L'explication à remplacer n'est pas une explication de cette ligne pour l'exercice 2025.")
    expect(cle(refus({ ...c706, p_remplace_id: UUID(99) }))).toBe('remplacement_hors_ligne')
    expect(refus({ ...c706, p_remplace_id: X2.toUpperCase() })).toBeNull()
    // La courante est celle qu'aucune autre ne remplace, quel que soit l'ordre de lecture — pas la dernière lue.
    const desordre = {
      explications: [
        { id: X2, annee: 2025, objet_type: 'compte' as const, objet: '706000', nature: null, remplace_id: X1 },
        { id: X1, annee: 2025, objet_type: 'compte' as const, objet: '706000', nature: null, remplace_id: null },
      ],
    }
    expect(refus({ ...c706, p_remplace_id: X2 }, desordre)).toBeNull()
    expect(cle(refus({ ...c706, p_remplace_id: X1 }, desordre))).toBe('remplacement_perime')
    // Deux natures nulles se heurtent : un second premier sur un total.
    expect(cle(refus({ p_objet_type: 'total_2035', p_objet: 'resultat', p_montant: 2500.1, p_montant_precedent: 5799.5 }))).toBe('remplacement_perime')
  })

  it('l’ordre, par paires de refus voisins', () => {
    expect(cle(refus({ p_objet_type: 'ligne', p_montant: null }))).toBe('objet_inconnu')
    expect(cle(refus({ p_objet_type: 'total_2035', p_objet: 'resultat', p_nature: 'depense', p_montant: null }))).toBe('nature_hors_poste')
    expect(cle(refus({ p_montant: null, p_source_precedent: 'x' }))).toBe('montant_invalide')
    expect(cle(refus({ p_source_precedent: 'x', p_explication: null }))).toBe('source_inconnue')
    expect(cle(refus({ p_source_precedent: 'aucune', p_montant_precedent: null, p_explication: null }))).toBe('explication_vide')
    expect(cle(refus({ p_objet: '706000', p_montant: 1, p_montant_precedent: null, p_source_precedent: 'aucune' }))).toBe('source_validee')
    expect(cle(refus({ p_objet: '706000', p_montant: -1, p_montant_precedent: -10000, p_remplace_id: UUID(99) }))).toBe('solde_change')
  })
})

describe('les arguments, tels que supabase-js les envoie', () => {
  it('le seuil : cinq arguments, le montant en euros depuis ses centimes, un motif de blancs parti nul', () => {
    expect(argumentsDeFixerSeuil(DOSSIER, 2025, 150050, 'Cinq pour cent du résultat', null)).toEqual({
      p_dossier_id: DOSSIER, p_annee: 2025, p_seuil: 1500.5, p_motif: 'Cinq pour cent du résultat', p_remplace_id: null,
    })
    expect(argumentsDeFixerSeuil(DOSSIER, 2025, 1, ' \t', S2).p_motif).toBeNull()
    expect(Object.keys(argumentsDeFixerSeuil(DOSSIER, 2025, 1, 'm', null))).toHaveLength(5)
  })

  it('une explication : la ligne, ses montants et sa source tels que l’écran les montre ; elle passe les refus de la base', () => {
    const ligne: Pick<LigneDeLaRevue, 'cle' | 'montantCentimes' | 'precedentCentimes' | 'source'> = {
      cle: compte('512000'), montantCentimes: 250010, precedentCentimes: 579950, source: 'validee',
    }
    const a = argumentsDExpliquerVariation(DOSSIER, 2025, ligne, 'Une explication', null)
    expect(a).toEqual({
      p_dossier_id: DOSSIER, p_annee: 2025, p_objet_type: 'compte', p_objet: '512000', p_nature: null, p_montant: 2500.1,
      p_montant_precedent: 5799.5, p_source_precedent: 'validee', p_explication: 'Une explication', p_remplace_id: null,
    })
    expect(refusDExpliquerVariation(a, contexteExplication())).toBeNull()
    expect(argumentsDExpliquerVariation(DOSSIER, 2025, { ...ligne, precedentCentimes: null, source: 'aucune' }, '\n', null))
      .toMatchObject({ p_montant_precedent: null, p_source_precedent: 'aucune', p_explication: null })
    expect(Object.keys(a)).toHaveLength(10)
    // Un poste de la 2035 part avec sa nature : sans elle, la base ne trouverait pas la ligne.
    const poste = argumentsDExpliquerVariation(DOSSIER, 2025, {
      cle: { objet_type: 'poste_2035', objet: 'Honoraires', nature: 'recette' }, montantCentimes: 1250010, precedentCentimes: 1000000, source: 'validee',
    }, 'Une explication', null)
    expect(poste).toMatchObject({ p_objet_type: 'poste_2035', p_objet: 'Honoraires', p_nature: 'recette', p_montant: 12500.1, p_montant_precedent: 10000 })
  })
})

// ── Les chaînes, l'exercice, la variation ─────────────────────────────────────────────────────────────────────────

describe('les chaînes de remplacements', () => {
  it('de la première à la courante, quel que soit l’ordre de lecture ; un identifiant comparé sans la casse', () => {
    const s = [seuil({ id: 'b', remplace_id: 'A', seuil: 2 }), seuil({ id: 'a', seuil: 1 }), seuil({ id: 'c', remplace_id: 'b', seuil: 3 }), seuil({ id: 'z', annee: 2024 })]
    const c = chaineDesSeuils(s, 2025)
    expect(c.lisible).toBe(true)
    expect(c.elements.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(c.courant?.id).toBe('c')
    expect(chaineDesSeuils(s, 2023)).toEqual({ elements: [], courant: null, lisible: true })
  })

  it('deux premiers, deux suites, une boucle : pas de courant, l’ordre de création', () => {
    const deuxPremiers = [seuil({ id: 'a', cree_le: '2026-01-02T00:00:00Z' }), seuil({ id: 'b', cree_le: '2026-01-01T00:00:00Z' })]
    expect(chaineDesSeuils(deuxPremiers, 2025)).toMatchObject({ courant: null, lisible: false })
    expect(chaineDesSeuils(deuxPremiers, 2025).elements.map((x) => x.id)).toEqual(['b', 'a'])
    expect(chaineDesSeuils([seuil({ id: 'a' }), seuil({ id: 'b', remplace_id: 'a' }), seuil({ id: 'c', remplace_id: 'a' })], 2025).lisible).toBe(false)
    expect(chaineDesSeuils([seuil({ id: 'a', remplace_id: 'b' }), seuil({ id: 'b', remplace_id: 'a' })], 2025).lisible).toBe(false)
  })

  it('les explications d’une ligne : son type, son objet, sa nature, son exercice', () => {
    const e = [
      explication({ id: 'p1', objet_type: 'poste_2035', objet: 'Loyers', nature: 'depense' }),
      explication({ id: 'p2', objet_type: 'poste_2035', objet: 'Loyers', nature: 'recette' }),
      explication({ id: 'p3', objet_type: 'poste_2035', objet: 'Loyers', nature: 'depense', annee: 2024 }),
      explication({ id: 'p4', objet_type: 'poste_2035', objet: 'Loyers', nature: 'depense', remplace_id: 'p1' }),
    ]
    expect(chaineDesExplications(e, 2025, poste('Loyers')).elements.map((x) => x.id)).toEqual(['p1', 'p4'])
    expect(chaineDesExplications(e, 2025, poste('Loyers', 'recette')).courant?.id).toBe('p2')
  })
})

describe('l’exercice, pour la revue', () => {
  it('ouvert, en cours à Paris, ou hors des bornes', () => {
    expect(exerciceDeLaRevue(2025, 2026)).toBe('ouvert')
    expect(exerciceDeLaRevue(2026, 2026)).toBe('en-cours')
    expect(exerciceDeLaRevue(2000, 2026)).toBe('ouvert')
    for (const a of [1999, 2101, 2025.5, Number.NaN]) expect(exerciceDeLaRevue(a, 2026), String(a)).toBe('invalide')
  })
})

describe('la variation en dixièmes de point', () => {
  it('rapportée à la valeur absolue du précédent, arrondie au plus proche, la moitié loin de zéro', () => {
    expect(variationEnDixiemes(250010, 1000000)).toBe(250)
    expect(variationEnDixiemes(-20050, 120050)).toBe(-167)
    expect(variationEnDixiemes(1, 2000)).toBe(1)
    expect(variationEnDixiemes(-1, 2000)).toBe(-1)
    expect(variationEnDixiemes(3, 2000)).toBe(2)
    expect(variationEnDixiemes(-374940, 579950)).toBe(-647)
    expect(variationEnDixiemes(-250010, -1000000)).toBe(-250)
    expect(variationEnDixiemes(0, 5)).toBe(0)
    expect(Object.is(variationEnDixiemes(0, -5), 0)).toBe(true)
  })

  it('nulle sur un précédent nul ; en entiers jusqu’aux bornes des montants', () => {
    expect(variationEnDixiemes(45000, 0)).toBeNull()
    // 9 999 999 999 999 998 × 2 000 dépasse 2^53 : le calcul se fait en entiers exacts, puis l'arrondi.
    expect(variationEnDixiemes(9999999999999998, 9999999999999998)).toBe(1000)
    expect(variationEnDixiemes(-4999999999999999, 9999999999999998)).toBe(-500)
  })
})

// ── Le tableau, calculé à la main ─────────────────────────────────────────────────────────────────────────────────

// LE DOSSIER DU CAS, ses chiffres posés à la main, en centimes :
//   - 2024 validé : sa 2035 porte les honoraires (1 000 000), les achats (120 050), les loyers (300 000), les totaux
//     1 000 000, 420 050, 579 950 ; ses écritures, celles du dossier A ;
//   - 2025 ouvert : la 2035 calculée porte les honoraires (1 250 010), les achats (100 000), les loyers (900 000), les
//     frais de déplacement (45 000) ; totaux 1 250 010, 1 045 000, 205 010. Les écritures de A, plus 758000 au crédit de 3
//     et 801000 au débit de 5 ; le seuil, 1 000 € (100 000), remplacé une fois.
const DECLARATION_2025: NonNullable<DonneesDeLaRevueAnalytique['declaration']> = {
  recettes: [posteDeclare({ poste: 'Honoraires', nature: 'recette', montant: 12500.1 })],
  depenses: [
    posteDeclare({ poste: 'Loyers', montant: 9000 }), posteDeclare({ poste: 'Achats', montant: 1000 }),
    posteDeclare({ poste: 'Frais de déplacement', montant: 450 }),
  ],
  totalRecettes: 12500.1, totalDepenses: 10450, resultat: 2050.1,
}
const ECRITURES_DU_CAS = [
  ...ECRITURES_A,
  ecriture({ id: 'f1', date: '2025-07-01', compte: '758000', montant: 3, sens: 'credit' }),
  ecriture({ id: 'f2', date: '2025-07-01', compte: '512000', montant: 3, sens: 'debit' }),
  ecriture({ id: 'f3', date: '2025-08-01', compte: '801000', montant: 5, sens: 'debit' }),
  ecriture({ id: 'f4', date: '2025-08-01', compte: '512000', montant: 5, sens: 'credit' }),
]
const donnees = (o: Partial<DonneesDeLaRevueAnalytique> = {}): DonneesDeLaRevueAnalytique => ({
  annee: 2025, anneeCourante: 2026, declaration: DECLARATION_2025, exercicesValides: [{ annee: 2024, declaration: DECL_2024 }],
  reperes: { annuels: [], postes: [] }, ecritures: ECRITURES_DU_CAS, reprise: [], reportes: [],
  partsDuReleve: [
    part({ ligneId: 'L1', date: '2025-02-01', montantDuMouvement: -1500, montantPoste: 1500, poste: 'Frais bancaires' }),
    part({ ligneId: 'L2', date: '2025-04-01', montantDuMouvement: -1200, montantPoste: 700, origine: 'ventilation', poste: 'Fournitures', compte: '606400', montantReleve: -700 }),
    part({ ligneId: 'L2', date: '2025-04-01', montantDuMouvement: -1200, montantPoste: 500, origine: 'ventilation', poste: 'Petit matériel', compte: '606300', montantReleve: -500 }),
    part({ ligneId: 'L3', date: '2025-05-01', montantDuMouvement: -3000, montantPoste: 2500, origine: 'emprunt', poste: 'Frais financiers', compte: '661100' }),
    part({ ligneId: 'L4', date: '2025-06-01', montantDuMouvement: 5000, montantPoste: 5000, nature: 'recette', poste: 'Honoraires', compte: '706000' }),
    part({ ligneId: 'L5', date: '2024-12-31', montantDuMouvement: -2000, montantPoste: 2000 }),
    part({ ligneId: 'L6', date: '2025-08-01', montantDuMouvement: -1000, montantPoste: 1000 }),
  ],
  seuils: [seuil({ id: 's1', seuil: 400 }), seuil({ id: 's2', seuil: 1000, remplace_id: 's1' }), seuil({ id: 's24', annee: 2024, seuil: 1 })],
  explications: [
    explication({ id: 'x1', objet_type: 'poste_2035', objet: 'Loyers', nature: 'depense', montant: 9000, montant_precedent: 3000, source_precedent: 'validee' }),
    explication({ id: 'x2', objet_type: 'poste_2035', objet: 'Achats', nature: 'depense', montant: 999.99, montant_precedent: 1200.5, source_precedent: 'validee' }),
    explication({ id: 'x3', objet_type: 'total_2035', objet: 'recettes', montant: 12500.1, montant_precedent: 10000, source_precedent: 'reference' }),
  ],
  ...o,
})
const resume = (l: LigneDeLaRevue) => [l.libelle, l.montantCentimes, l.precedentCentimes, l.source, l.variationCentimes, l.variationDixiemesDePourcent, l.auDelaDuSeuil, l.etat, l.causes.join('+')]

describe('le tableau de l’exercice face au précédent, calculé à la main', () => {
  const r = revueAnalytiqueDeLExercice(donnees(), null)

  it('le seuil courant, en centimes', () => {
    expect(r.seuil.courant?.id).toBe('s2')
    expect(r.seuil.centimes).toBe(100000)
    expect(r.exercice).toBe('ouvert')
    expect(r.la2035.sourceDeLExercice).toBe('calculee')
  })

  it('la 2035 : les postes par nature puis par nom, les trois totaux ; la variation, son pourcentage, l’état', () => {
    expect(r.la2035.lignes.map(resume)).toEqual([
      ['Honoraires', 1250010, 1000000, 'validee', 250010, 250, true, 'a-expliquer', ''],
      ['Achats', 100000, 120050, 'validee', -20050, -167, false, 'a-revoir', 'montant-change'],
      ['Frais de déplacement', 45000, 0, 'validee', 45000, null, false, 'sous-le-seuil', ''],
      ['Loyers', 900000, 300000, 'validee', 600000, 2000, true, 'expliquee', ''],
      ['Total des recettes', 1250010, 1000000, 'validee', 250010, 250, true, 'a-revoir', 'source-changee'],
      ['Total des dépenses', 1045000, 420050, 'validee', 624950, 1488, true, 'a-expliquer', ''],
      ['Résultat', 205010, 579950, 'validee', -374940, -647, true, 'a-expliquer', ''],
    ])
  })

  it('les comptes : le solde de l’exercice face à celui du précédent validé ; un compte hors des classes 1 à 7, dit', () => {
    // 512000 : 2 500,10 + 3 − 5 = 2 498,10 en 2025, 5 799,50 en 2024.
    expect(r.comptes.source).toBe('validee')
    expect(r.comptes.lignes.map(resume)).toEqual([
      ['512000', 249810, 579950, 'validee', -330140, -569, true, 'a-expliquer', ''],
      ['606100', 100000, 120050, 'validee', -20050, -167, false, 'sous-le-seuil', ''],
      ['613200', 900000, 300000, 'validee', 600000, 2000, true, 'a-expliquer', ''],
      ['706000', -1250010, -1000000, 'validee', -250010, -250, true, 'a-expliquer', ''],
      ['758000', -300, 0, 'validee', -300, null, false, 'sous-le-seuil', ''],
    ])
    expect(r.comptes.horsDeLaRevue).toEqual(['801000'])
  })

  it('les recettes mois par mois : les comptes du cycle des recettes, sans le 758000 de la TVA', () => {
    expect(r.recettesParMois.source).toBe('validee')
    expect(r.recettesParMois.mois).toHaveLength(12)
    expect(r.recettesParMois.mois[2]).toEqual({ mois: '2025-03', centimes: 1250010, ecritures: 2, precedentCentimes: 1000000, variationCentimes: 250010 })
    expect(r.recettesParMois.mois[6]).toEqual({ mois: '2025-07', centimes: 0, ecritures: 0, precedentCentimes: 0, variationCentimes: 0 })
    expect(r.recettesParMois.mois.filter((m) => m.ecritures === 0)).toHaveLength(11)
  })

  it('les dépenses affectées sans pièce : affectées ou ventilées, de l’exercice, au-delà du seuil strictement', () => {
    expect(r.depensesSansPiece.map((d) => [d.ligneId, d.totalCentimes, d.montantReleveCentimes, d.parts.length, d.auDelaDuSeuil])).toEqual([
      ['L1', 150000, -150000, 1, true],
      ['L2', 120000, -120000, 2, true],
      ['L6', 100000, -100000, 1, false],
    ])
    expect(r.depensesSansPiece[1].parts).toEqual([
      { poste: 'Fournitures', compte: '606400', centimes: 70000 }, { poste: 'Petit matériel', compte: '606300', centimes: 50000 },
    ])
  })

  it('l’avancement compte les lignes de la 2035 et des comptes, état par état', () => {
    expect(r.avancement).toEqual({
      'en-attente': 0, 'sans-comparaison': 0, 'sans-seuil': 0, 'sous-le-seuil': 3, 'a-expliquer': 6, expliquee: 1, 'a-revoir': 2,
    })
  })
})

describe('le tableau, les autres états', () => {
  it('sans seuil, aucune explication attendue ; l’explication donnée reste expliquée', () => {
    const r = revueAnalytiqueDeLExercice(donnees({ seuils: [] }), null)
    expect(r.seuil.centimes).toBeNull()
    expect(r.la2035.lignes.map((l) => l.etat)).toEqual(['sans-seuil', 'a-revoir', 'sans-seuil', 'expliquee', 'a-revoir', 'sans-seuil', 'sans-seuil'])
    expect(r.la2035.lignes.every((l) => l.auDelaDuSeuil === null)).toBe(true)
    expect(r.depensesSansPiece.map((d) => d.auDelaDuSeuil)).toEqual([null, null, null])
  })

  it('au seuil exactement, sous le seuil : « au-delà » est strict', () => {
    const r = revueAnalytiqueDeLExercice(donnees({ seuils: [seuil({ seuil: 2500.1 })], explications: [] }), null)
    expect(r.la2035.lignes[0].etat).toBe('sous-le-seuil')
    expect(revueAnalytiqueDeLExercice(donnees({ seuils: [seuil({ seuil: 2500.09 })], explications: [] }), null).la2035.lignes[0].etat).toBe('a-expliquer')
  })

  it('sans exercice précédent validé ni repère : sans comparaison, pour la 2035, les comptes et les mois', () => {
    const r = revueAnalytiqueDeLExercice(donnees({ exercicesValides: [], explications: [] }), null)
    expect(r.la2035.lignes.map((l) => [l.libelle, l.precedentCentimes, l.source, l.etat])).toEqual([
      ['Honoraires', null, 'aucune', 'sans-comparaison'], ['Achats', null, 'aucune', 'sans-comparaison'],
      ['Frais de déplacement', null, 'aucune', 'sans-comparaison'], ['Loyers', null, 'aucune', 'sans-comparaison'],
      ['Total des recettes', null, 'aucune', 'sans-comparaison'], ['Total des dépenses', null, 'aucune', 'sans-comparaison'],
      ['Résultat', null, 'aucune', 'sans-comparaison'],
    ])
    expect(r.comptes.source).toBe('aucune')
    expect(r.comptes.lignes.every((l) => l.precedentCentimes === null && l.etat === 'sans-comparaison')).toBe(true)
    expect(r.recettesParMois.source).toBe('aucune')
    expect(r.recettesParMois.mois.every((m) => m.precedentCentimes === null && m.variationCentimes === null)).toBe(true)
  })

  it('les comptes montrés : ni un compte soldé dans l’exercice, ni un compte du seul exercice précédent quand il n’est pas validé', () => {
    const ecritures = [
      ...ECRITURES_DU_CAS,
      // 471000 soldé dans l'exercice ; 625100 mouvementé en 2024 seulement.
      ecriture({ id: 'g1', date: '2025-09-01', compte: '471000', montant: 100, sens: 'debit' }),
      ecriture({ id: 'g2', date: '2025-09-02', compte: '471000', montant: 100, sens: 'credit' }),
      ecriture({ id: 'g3', date: '2024-09-01', compte: '625100', montant: 50, sens: 'debit' }),
      ecriture({ id: 'g4', date: '2024-09-01', compte: '512000', montant: 50, sens: 'credit' }),
    ]
    const ouvert = revueAnalytiqueDeLExercice(donnees({ exercicesValides: [], explications: [], ecritures }), null)
    expect(ouvert.comptes.lignes.map((l) => [l.libelle, l.source, l.precedentCentimes, l.etat])).toEqual([
      ['512000', 'aucune', null, 'sans-comparaison'], ['606100', 'aucune', null, 'sans-comparaison'],
      ['613200', 'aucune', null, 'sans-comparaison'], ['706000', 'aucune', null, 'sans-comparaison'],
      ['758000', 'aucune', null, 'sans-comparaison'],
    ])
    // 2024 validé : le 625100 se compare, à zéro dans l'exercice ; le 471000 soldé reste tu.
    const valide = revueAnalytiqueDeLExercice(donnees({ explications: [], ecritures }), null)
    expect(valide.comptes.lignes.map((l) => [l.libelle, l.montantCentimes, l.precedentCentimes])).toEqual([
      ['512000', 249810, 574950], ['606100', 100000, 120050], ['613200', 900000, 300000], ['625100', 0, 5000],
      ['706000', -1250010, -1000000], ['758000', -300, 0],
    ])
  })

  it('les postes se rangent par point de code, comme partout dans l’application : le même ordre sur tout navigateur', () => {
    // Un tri « à la française » mettrait « achats » et « Énergie » avant « Frais » ; l'ordre des points de code ne dépend
    // d'aucune langue installée.
    const declaration = {
      ...DECLARATION_2025, recettes: [],
      depenses: [posteDeclare({ poste: 'Énergie', montant: 1 }), posteDeclare({ poste: 'achats', montant: 2 }), posteDeclare({ poste: 'Frais', montant: 3 })],
    }
    const r = revueAnalytiqueDeLExercice(donnees({ declaration, exercicesValides: [], explications: [] }), null)
    expect(r.la2035.lignes.map((l) => l.libelle)).toEqual(['Frais', 'achats', 'Énergie', 'Total des recettes', 'Total des dépenses', 'Résultat'])
  })

  it('une 2035 calculée hors des bornes de l’application — un total, un poste — n’affirme rien de la 2035', () => {
    for (const declaration of [
      { ...DECLARATION_2025, totalRecettes: Number.NaN },
      { ...DECLARATION_2025, resultat: 1e14 },
      { ...DECLARATION_2025, recettes: [posteDeclare({ poste: 'Honoraires', nature: 'recette', montant: Infinity })] },
    ]) {
      const r = revueAnalytiqueDeLExercice(donnees({ declaration }), null)
      expect(r.la2035).toEqual({ sourceDeLExercice: 'calculee', illisible: 2025, lignes: [] })
      expect(r.comptes.lignes).not.toHaveLength(0)
    }
  })

  it('avec des repères : les postes de dépenses et les totaux qu’ils portent, à leur nom exact ; les autres sans comparaison', () => {
    const r = revueAnalytiqueDeLExercice(donnees({ exercicesValides: [], explications: [], reperes: REPERES }), null)
    expect(r.la2035.lignes.map((l) => [l.libelle, l.precedentCentimes, l.source, l.etat])).toEqual([
      ['Honoraires', null, 'aucune', 'sans-comparaison'], ['Achats', null, 'aucune', 'sans-comparaison'],
      ['Frais de déplacement', null, 'aucune', 'sans-comparaison'], ['Loyers', 240000, 'reference', 'a-expliquer'],
      ['Total des recettes', 900000, 'reference', 'a-expliquer'], ['Total des dépenses', null, 'aucune', 'sans-comparaison'],
      ['Résultat', -123456, 'reference', 'a-expliquer'],
    ])
    // Un poste du repère que la 2035 de l'exercice ne porte pas : une ligne, à zéro, comparée.
    const avecAutre = revueAnalytiqueDeLExercice(donnees({
      exercicesValides: [], explications: [], reperes: { ...REPERES, postes: [...REPERES.postes, { annee: 2024, poste: 'Autre', montant: 50 }] },
    }), null)
    expect(avecAutre.la2035.lignes.map((l) => l.libelle)).toEqual(['Honoraires', 'Achats', 'Autre', 'Frais de déplacement', 'Loyers', 'Total des recettes', 'Total des dépenses', 'Résultat'])
    expect(resume(avecAutre.la2035.lignes[2])).toEqual(['Autre', 0, 5000, 'reference', -5000, -1000, false, 'sous-le-seuil', ''])
  })

  it('une explication d’une ligne qui n’existe plus reste montrée, à revoir', () => {
    const r = revueAnalytiqueDeLExercice(donnees({
      explications: [
        explication({ objet_type: 'poste_2035', objet: 'Disparu', nature: 'recette', montant: 10, montant_precedent: 0, source_precedent: 'validee' }),
        explication({ id: 'c', objet_type: 'compte', objet: '411000', montant: 1, montant_precedent: 0, source_precedent: 'validee' }),
      ],
    }), null)
    expect(resume(r.la2035.lignes.find((l) => l.libelle === 'Disparu') as LigneDeLaRevue))
      .toEqual(['Disparu', 0, 0, 'validee', 0, null, false, 'a-revoir', 'montant-change'])
    expect(resume(r.comptes.lignes.find((l) => l.libelle === '411000') as LigneDeLaRevue))
      .toEqual(['411000', 0, 0, 'validee', 0, null, false, 'a-revoir', 'montant-change'])
  })

  it('à revoir : le montant précédent changé, une chaîne illisible', () => {
    const r = revueAnalytiqueDeLExercice(donnees({
      explications: [
        explication({ objet_type: 'poste_2035', objet: 'Loyers', nature: 'depense', montant: 9000, montant_precedent: 2999, source_precedent: 'validee' }),
        explication({ id: 'h1', objet_type: 'total_2035', objet: 'resultat', montant: 2050.1, montant_precedent: 5799.5, source_precedent: 'validee' }),
        explication({ id: 'h2', objet_type: 'total_2035', objet: 'resultat', montant: 2050.1, montant_precedent: 5799.5, source_precedent: 'validee' }),
      ],
    }), null)
    expect(r.la2035.lignes.find((l) => l.libelle === 'Loyers')?.causes).toEqual(['precedent-change'])
    expect(r.la2035.lignes.find((l) => l.libelle === 'Résultat')).toMatchObject({ etat: 'a-revoir', causes: ['chaine-illisible'] })
  })

  it('l’exercice en cours : le tableau se calcule, rien ne s’attend', () => {
    const r = revueAnalytiqueDeLExercice(donnees({ annee: 2026, anneeCourante: 2026 }), null)
    expect(r.exercice).toBe('en-cours')
    expect([...r.la2035.lignes, ...r.comptes.lignes].every((l) => l.etat === 'en-attente')).toBe(true)
  })

  it('l’exercice validé : sa 2035 validée fait foi sur la 2035 calculée', () => {
    const r = revueAnalytiqueDeLExercice(donnees({
      exercicesValides: [{ annee: 2024, declaration: DECL_2024 }, { annee: 2025, declaration: { postes: [{ poste: 'Loyers', nature: 'depense', montant: 8000 }], totalRecettes: 0, totalDepenses: 8000, resultat: -8000 } }],
      explications: [],
    }), null)
    expect(r.la2035.sourceDeLExercice).toBe('validee')
    expect(r.la2035.lignes.map((l) => [l.libelle, l.montantCentimes, l.precedentCentimes])).toEqual([
      ['Honoraires', 0, 1000000], ['Achats', 0, 120050], ['Loyers', 800000, 300000],
      ['Total des recettes', 0, 1000000], ['Total des dépenses', 800000, 420050], ['Résultat', -800000, 579950],
    ])
  })

  it('une 2035 validée illisible — de l’exercice, puis du précédent — n’affirme rien de la 2035 ; les comptes, si', () => {
    const illisibleN = revueAnalytiqueDeLExercice(donnees({ exercicesValides: [{ annee: 2024, declaration: DECL_2024 }, { annee: 2025, declaration: { essai: 'F' } }] }), null)
    expect(illisibleN.la2035).toEqual({ sourceDeLExercice: 'validee', illisible: 2025, lignes: [] })
    expect(illisibleN.comptes.lignes).toHaveLength(5)
    const illisibleN1 = revueAnalytiqueDeLExercice(donnees({ exercicesValides: [{ annee: 2024, declaration: { essai: 'D' } }] }), null)
    expect(illisibleN1.la2035).toEqual({ sourceDeLExercice: 'calculee', illisible: 2024, lignes: [] })
    expect(illisibleN1.comptes.source).toBe('validee')
  })

  it('sans 2035 de l’exercice (un dossier en engagement) : rien de la 2035 ; un exercice précédent validé en engagement compare ses comptes', () => {
    const r = revueAnalytiqueDeLExercice(donnees({ declaration: null, exercicesValides: [{ annee: 2024, declaration: null }] }), null)
    expect(r.la2035).toEqual({ sourceDeLExercice: 'aucune', illisible: null, lignes: [] })
    expect(r.comptes.source).toBe('validee')
  })

  it('une lecture partielle, un seuil illisible, un exercice hors des bornes : rien ne s’affirme', () => {
    const partielle = revueAnalytiqueDeLExercice(donnees(), 'Les écritures n’ont été lues qu’en partie.')
    expect(partielle.lectureIncomplete).toBe('Les écritures n’ont été lues qu’en partie.')
    expect([partielle.la2035.lignes, partielle.comptes.lignes, partielle.recettesParMois.mois, partielle.depensesSansPiece]).toEqual([[], [], [], []])
    const seuilIllisible = revueAnalytiqueDeLExercice(donnees({ seuils: [seuil({ id: 'a' }), seuil({ id: 'b' })] }), null)
    expect(seuilIllisible.lectureIncomplete).toBe('Le seuil de signification de 2025 ne se relit pas.')
    expect(seuilIllisible.comptes.lignes).toEqual([])
    const horsBornes = revueAnalytiqueDeLExercice(donnees({ annee: 1999 }), null)
    expect(horsBornes.exercice).toBe('invalide')
    expect(horsBornes.comptes.lignes).toEqual([])
  })
})

describe('les libellés', () => {
  it('ceux des totaux, des sources et des états, mot pour mot', () => {
    expect(LIBELLE_DU_TOTAL).toEqual({ recettes: 'Total des recettes', depenses: 'Total des dépenses', resultat: 'Résultat' })
    expect(LIBELLE_DE_LA_SOURCE).toEqual({ validee: 'Exercice validé', reference: 'Repère annuel', aucune: 'Aucune' })
    expect(LIBELLE_DE_L_ETAT_DE_LA_LIGNE).toEqual({
      'en-attente': 'Exercice en cours', 'sans-comparaison': 'Sans comparaison', 'sans-seuil': 'Sans seuil',
      'sous-le-seuil': 'Sous le seuil', 'a-expliquer': 'À expliquer', expliquee: 'Expliquée', 'a-revoir': 'À revoir',
    })
  })
})

describe('ce que l’application ne dit pas', () => {
  it('aucun état, aucun libellé ne qualifie une variation de « normale » (ni d’« anormale »)', () => {
    const textes = [...Object.values(LIBELLE_DE_L_ETAT_DE_LA_LIGNE), ...Object.values(LIBELLE_DE_LA_SOURCE), ...Object.values(LIBELLE_DU_TOTAL), ...ETATS_DE_LA_LIGNE]
    for (const t of textes) expect(t.toLowerCase(), t).not.toMatch(/normal|coh[ée]rent|justifi/)
    expect(Object.keys(LIBELLE_DE_L_ETAT_DE_LA_LIGNE)).toEqual([...ETATS_DE_LA_LIGNE])
  })
})

// ── Un module de calcul ───────────────────────────────────────────────────────────────────────────────────────────

describe('un module pur', () => {
  it('n’atteint pas supabase.ts, ni par lui-même ni par ce qu’il importe', () => {
    const racine = new URL('./', import.meta.url).pathname
    const vus = new Set<string>()
    const aVoir = ['revueAnalytique.ts']
    while (aVoir.length > 0) {
      const fichier = aVoir.pop() as string
      if (vus.has(fichier)) continue
      vus.add(fichier)
      const texte = readFileSync(racine + fichier, 'utf8')
      for (const m of texte.matchAll(/^import (?!type )[\s\S]*?from '\.\/([\w.]+)'/gm)) aVoir.push(/\.tsx?$/.test(m[1]) ? m[1] : `${m[1]}.ts`)
    }
    expect(vus.size).toBeGreaterThan(5)
    expect([...vus]).not.toContain('supabase.ts')
  })
})

// Les lignes de la fabrique sont entières : chaque colonne que la base écrit y est.
const _seuilEntier: RevisionSeuil = seuil({})
const _explicationEntiere: RevisionExplication = explication({})
void _seuilEntier
void _explicationEntiere

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ciblePrecedente, compteRepriseNonExtourne, compteRepriseNonVentile, comptesReprisNonExtournes, extourneEntiere, INVENTAIRE_SANS_OBJET, lignesCommandees,
  MODELES_DE_LA_VALIDATION, RACINES_CONFRONTEES_A_LA_REPRISE,
  MOTS_DE_LA_DECLARATION, MOTS_DE_LA_GARDE_DES_DECLARATIONS, motsDeLaValidation, prealablesDeLInventaire, RACINES_LETTREES_PAR_REGULARISATION,
  refusDeLaDeclaration, refusDuRetrait, regularisationAJour, type ContexteDeLaDeclaration, type EntreesDeLInventaire,
  type InventaireDeLaValidation, type OperationDeLaValidation,
} from './inventaireDeLaValidation'
import { TABLES_DES_DECLARATIONS } from './inventaire'
import type { EcritureBrouillon } from './types'

// INV3 (ligne 35) : LA BASE REDIT LE MODULE. La migration `validation_de_l_inventaire` (préparée) refuse ce que
// src/lib/inventaireDeLaValidation.ts dit avant le clic, sous les mêmes mots, aux mêmes codes, dans le même ordre ; ses deux
// juges recomposent ce que les juges du module recomposent, et son essai (supabase/essais/validationDeLInventaire.sql, joué
// sur une réplique) en éprouve les cas que ces tests rejouent ici. Données FICTIVES.

const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), 'utf8')
const MIGRATION = lire('supabase/preparees/20261112235000_validation_de_l_inventaire.sql')
const RETOUR = lire('supabase/preparees/retour/20261112235100_retour_validation_de_l_inventaire.sql')
const ESSAI = lire('supabase/essais/validationDeLInventaire.sql')

/** Le corps d'une fonction de la migration, du `create` à la fin de son corps. */
function corps(entete: string, fin: string): string {
  const debut = MIGRATION.indexOf(entete)
  const arret = MIGRATION.indexOf(fin, debut + entete.length)
  if (debut < 0 || arret < 0) throw new Error(`${entete} introuvable dans la migration`)
  return MIGRATION.slice(debut, arret)
}
const VALIDER = corps('create or replace function public.valider_exercice(', '\n$$;')
const DECLARER = corps('create function public.declarer_inventaire(', '$fonction$;')
const RETIRER = corps('create function public.retirer_declaration_inventaire(', '$fonction$;')
const GARDE = corps('create function public.garder_inventaires_declares(', '\n$$;')
// Un message de la base, tel que le texte SQL l'écrit : l'apostrophe droite doublée.
const enSql = (mots: string) => mots.replaceAll("'", "''")

/** Le code que la base lève pour le message : le premier `using errcode` qui le suit. */
function codeApres(texte: string, message: string): string | undefined {
  const i = texte.indexOf(message)
  return i < 0 ? undefined : /using errcode = '(\w+)'/.exec(texte.slice(i))?.[1]
}

describe('les mots de valider_exercice sont ceux du module, dans son ordre, après tous ses refus d’hier', () => {
  const M = MODELES_DE_LA_VALIDATION
  const ordre = [M.numerotation, M.nonDeclare, M.aRecomposer, M.extourneManquante, M.provisionsAVentiler, M.repriseARecomposer,
    M.repriseHorsDeLOuverture, M.repriseNonExtournee]

  it('chaque modèle est dans la fonction, au caractère près, dans l’ordre des contrôles, après la numérotation d’hier', () => {
    const positions = ordre.map((m) => VALIDER.indexOf(enSql(m)))
    positions.forEach((p, i) => expect(p, ordre[i]).toBeGreaterThan(-1))
    for (let i = 1; i < positions.length; i++) expect(positions[i], ordre[i]).toBeGreaterThan(positions[i - 1])
    // Après le dernier refus d'hier (les quatre champs d'un BNC) et avant le réglage de la validation.
    expect(positions[0]).toBeGreaterThan(VALIDER.indexOf('porte un poste de la 2035 sur un compte qui n'))
    expect(positions.at(-1)).toBeLessThan(VALIDER.indexOf("perform set_config('jd.validation_exercice'"))
  })

  it('aux codes de la base : 22023 la numérotation, 23514 les autres', () => {
    expect(codeApres(VALIDER, enSql(M.numerotation))).toBe('22023')
    for (const m of ordre.slice(1)) expect(codeApres(VALIDER, enSql(m)), m).toBe('23514')
  })

  it('un modèle se remplit comme la base le remplit, chaque % dans l’ordre', () => {
    expect(motsDeLaValidation(M.extourneManquante, 2026, 2025, 'Assurance 2026')).toBe("L'exercice 2026 ne porte pas l'extourne "
      + "entière d'une régularisation d'inventaire de l'exercice 2025 : Assurance 2026 — figée avec son exercice, elle ne se "
      + "réécrit plus, et l'exercice ne se valide pas sans elle.")
    expect(motsDeLaValidation(M.aRecomposer, 2026, 'Taux 5 %')).toContain(': Taux 5 % — ')
  })
})

describe('les refus de la déclaration et de son retrait sont ceux du module', () => {
  const D = MOTS_DE_LA_DECLARATION

  it('declarer_inventaire : l’accès, le mode, l’exercice, le gel, la clôture, l’ouverture, la déclaration en vigueur — dans cet ordre', () => {
    const ordre = [D.acces, D.tresorerie, D.exercice, D.exerciceFige, D.nonClos, D.avantLOuverture, D.dejaDeclare]
    const positions = ordre.map((m) => DECLARER.indexOf(m))
    positions.forEach((p, i) => expect(p, ordre[i]).toBeGreaterThan(-1))
    for (let i = 1; i < positions.length; i++) expect(positions[i], ordre[i]).toBeGreaterThan(positions[i - 1])
    expect(codeApres(DECLARER, D.acces)).toBe('42501')
    expect(codeApres(DECLARER, D.exerciceFige)).toBe('23514')
    expect(codeApres(DECLARER, D.dejaDeclare)).toBe('40001')
    for (const m of [D.tresorerie, D.exercice, D.nonClos, D.avantLOuverture]) expect(codeApres(DECLARER, m), m).toBe('22023')
  })

  it('retirer_declaration_inventaire : l’accès, la déclaration déjà retirée, le gel', () => {
    const ordre = [D.accesALaDeclaration, D.declarationChangee, D.exerciceFige]
    const positions = ordre.map((m) => RETIRER.indexOf(m))
    positions.forEach((p, i) => expect(p, ordre[i]).toBeGreaterThan(-1))
    for (let i = 1; i < positions.length; i++) expect(positions[i], ordre[i]).toBeGreaterThan(positions[i - 1])
    expect([codeApres(RETIRER, D.accesALaDeclaration), codeApres(RETIRER, D.declarationChangee), codeApres(RETIRER, D.exerciceFige)])
      .toEqual(['42501', '40001', '23514'])
  })

  it('la garde : ses trois mots, en 42501, et le gel de la déclaration', () => {
    for (const m of Object.values(MOTS_DE_LA_GARDE_DES_DECLARATIONS)) expect(codeApres(GARDE, m), m).toBe('42501')
    expect(codeApres(GARDE, D.exerciceFige)).toBe('23514')
  })

  const contexte = (o: Partial<ContexteDeLaDeclaration> = {}): ContexteDeLaDeclaration => ({
    mode: 'engagement', exercice: 2025, derniereValidee: 2024, anneeEnCours: 2026, premierExercice: 2024, declarations: [], ...o,
  })

  it('refusDeLaDeclaration dit le premier refus de la base, dans son ordre', () => {
    expect(refusDeLaDeclaration(contexte())).toBeNull()
    expect(refusDeLaDeclaration(contexte({ mode: 'tresorerie', exercice: 1999 }))?.cle).toBe('tresorerie')
    expect(refusDeLaDeclaration(contexte({ exercice: 1999 }))?.cle).toBe('exercice')
    expect(refusDeLaDeclaration(contexte({ exercice: 2024 }))).toMatchObject({ cle: 'exerciceFige', code: '23514' })
    expect(refusDeLaDeclaration(contexte({ exercice: 2026 }))?.cle).toBe('nonClos')
    expect(refusDeLaDeclaration(contexte({ exercice: 2023, derniereValidee: null }))?.cle).toBe('avantLOuverture')
    expect(refusDeLaDeclaration(contexte({ declarations: [{ id: 'a', exercice: 2025, retire_le: null }] })))
      .toMatchObject({ cle: 'dejaDeclare', code: '40001', message: D.dejaDeclare })
    // Une déclaration retirée ne compte plus : l'exercice se déclare de nouveau.
    expect(refusDeLaDeclaration(contexte({ declarations: [{ id: 'a', exercice: 2025, retire_le: '2026-02-01T10:00:00Z' }] }))).toBeNull()
  })

  it('refusDuRetrait : une déclaration déjà retirée, puis le gel', () => {
    expect(refusDuRetrait({ id: 'a', exercice: 2025, retire_le: null }, 2024)).toBeNull()
    expect(refusDuRetrait({ id: 'a', exercice: 2025, retire_le: '2026-02-01T10:00:00Z' }, 2025)?.cle).toBe('declarationChangee')
    expect(refusDuRetrait({ id: 'a', exercice: 2025, retire_le: null }, 2025)?.cle).toBe('exerciceFige')
  })
})

// ── Les juges ──

const op = (o: Partial<OperationDeLaValidation> = {}): OperationDeLaValidation => ({
  id: 'o1', exercice: 2025, nature: 'cca', compte_resultat: '616000', compte_regularisation: '486000', montant_centimes: 120000,
  tva_centimes: 0, objet: 'Assurance 2026', provision_id: null, reprise: false, ...o,
})
const ligne = (o: Partial<EcritureBrouillon>): EcritureBrouillon => ({
  id: 'e', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, date: '2025-12-31', libelle: 'Régularisation', sens: 'debit',
  statut: 'proposee', compte: '486000', montant: 1200, created_at: '2026-01-15T09:00:00Z', operation_inventaire_id: 'o1', ...o,
} as EcritureBrouillon)
// Les lignes que la base écrit pour une régularisation : celles qu'elle commande, telles quelles.
const ecrites = (o: OperationDeLaValidation, cible: number | null = null): EcritureBrouillon[] =>
  (lignesCommandees(o, cible) ?? []).map((l, i) => ligne({
    id: `${o.id}-${i}`, date: l.date, compte: l.compte, sens: l.sens, montant: l.centimes / 100, operation_inventaire_id: o.id,
  }))

describe('les juges de la base, recomposés en entiers', () => {
  it('une régularisation écrite telle qu’elle se commande est à jour, et son extourne entière', () => {
    for (const o of [op(), op({ nature: 'pca', compte_resultat: '706000', compte_regularisation: '487000' }),
      op({ nature: 'charge_a_payer', compte_resultat: '641200', compte_regularisation: '428200' }),
      op({ nature: 'produit_a_recevoir', compte_resultat: '791000', compte_regularisation: '448200' }),
      op({ nature: 'fnp', compte_resultat: '622600', compte_regularisation: '408100', montant_centimes: 10000, tva_centimes: 2000 }),
      op({ nature: 'fae', compte_resultat: '706000', compte_regularisation: '418100', montant_centimes: 10000, tva_centimes: 2000 })]) {
      const brouillon = ecrites(o)
      expect(regularisationAJour(o, brouillon, null), o.nature).toBe(true)
      expect(extourneEntiere(o, brouillon), o.nature).toBe(true)
    }
  })

  it('un centime de moins, une ligne de trop, une date ailleurs : plus à jour', () => {
    const o = op()
    const b = ecrites(o)
    expect(regularisationAJour(o, b.map((l, i) => (i === 0 ? { ...l, montant: 1199.99 } : l)), null)).toBe(false)
    expect(regularisationAJour(o, [...b, ligne({ id: 'trop', compte: '616000', montant: 1 })], null)).toBe(false)
    expect(regularisationAJour(o, b.map((l, i) => (i === 0 ? { ...l, date: '2025-12-30' } : l)), null)).toBe(false)
    // Une ligne d'une AUTRE régularisation n'est pas lue.
    expect(regularisationAJour(o, [...b, ligne({ id: 'autre', operation_inventaire_id: 'o2' })], null)).toBe(true)
  })

  it('la TVA d’attente se juge sous sa racine : le compte du rôle à l’écriture, que le plan a pu déplacer', () => {
    const o = op({ nature: 'fnp', compte_resultat: '622600', compte_regularisation: '408100', montant_centimes: 10000, tva_centimes: 2000 })
    const b = ecrites(o).map((l) => (l.compte === '44586' ? { ...l, compte: '445861' } : l))
    expect(b.some((l) => l.compte === '445861')).toBe(true)
    expect(regularisationAJour(o, b, null)).toBe(true)
    expect(regularisationAJour(o, b.map((l) => (l.compte === '445861' ? { ...l, compte: '445660' } : l)), null)).toBe(false)
  })

  it('l’extourne : manquante, partielle, ou d’un autre montant — pas entière ; une provision n’en a aucune', () => {
    const o = op()
    const b = ecrites(o)
    expect(extourneEntiere(o, b.filter((l) => l.date === '2025-12-31'))).toBe(false)
    expect(extourneEntiere(o, b.filter((l, i) => !(l.date === '2026-01-01' && i === 2)))).toBe(false)
    expect(extourneEntiere(o, b.map((l) => (l.date === '2026-01-01' ? { ...l, montant: 1000 } : l)))).toBe(false)
    const p = op({ id: 'p1', nature: 'provision', compte_resultat: '681500', compte_regularisation: '151100', provision_id: 'pr' })
    expect(lignesCommandees(p, 0)?.every((l) => l.date === '2025-12-31')).toBe(true)
    expect(extourneEntiere(p, ecrites(p, 0))).toBe(true)
  })

  it('une évaluation de provision : l’écart à la précédente, en hausse ou en baisse, rien sans écart', () => {
    const provisions = [{ id: 'pr', compte_provision: '151100', reprise_centimes: 50000 }]
    const e25 = op({ id: 'p25', nature: 'provision', compte_resultat: '681500', compte_regularisation: '151100', montant_centimes: 80000, provision_id: 'pr' })
    const e26 = op({ id: 'p26', exercice: 2026, nature: 'provision', compte_resultat: '781500', compte_regularisation: '151100', montant_centimes: 30000, provision_id: 'pr' })
    const toutes = [e25, e26]
    expect(ciblePrecedente(e25, toutes, provisions)).toBe(50000)
    expect(ciblePrecedente(e26, toutes, provisions)).toBe(80000)
    expect(lignesCommandees(e25, 50000)).toEqual([
      { date: '2025-12-31', compte: '681500', sens: 'debit', centimes: 30000 },
      { date: '2025-12-31', compte: '151100', sens: 'credit', centimes: 30000 },
    ])
    expect(lignesCommandees(e26, 80000)).toEqual([
      { date: '2026-12-31', compte: '151100', sens: 'debit', centimes: 50000 },
      { date: '2026-12-31', compte: '781500', sens: 'credit', centimes: 50000 },
    ])
    expect(lignesCommandees({ ...e26, montant_centimes: 80000 }, 80000)).toEqual([])
    // Une provision que la lecture ne rend pas : la base n'attend aucune ligne.
    expect(ciblePrecedente({ ...e25, provision_id: 'inconnue' }, toutes, provisions)).toBeNull()
    expect(regularisationAJour({ ...e25, provision_id: 'inconnue' }, [], null)).toBe(true)
  })

  it('la ventilation des provisions reprises : le premier compte en écart, dans l’ordre des numéros', () => {
    const reprise = [
      { compte: '491000', sens: 'credit' as const, montant: 500 }, { compte: '151100', sens: 'credit' as const, montant: 1000 },
      { compte: '512000', sens: 'debit' as const, montant: 1500 },
    ]
    expect(compteRepriseNonVentile(reprise, [])).toBe('151100')
    expect(compteRepriseNonVentile(reprise, [{ id: 'a', compte_provision: '151100', reprise_centimes: 100000 }])).toBe('491000')
    expect(compteRepriseNonVentile(reprise, [{ id: 'a', compte_provision: '151100', reprise_centimes: 100000 },
      { id: 'b', compte_provision: '491000', reprise_centimes: 50000 }])).toBeNull()
    // Une provision née dans l'application (part reprise nulle) ne compte pas dans la ventilation.
    expect(compteRepriseNonVentile([], [{ id: 'c', compte_provision: '151200', reprise_centimes: null }])).toBeNull()
    expect(compteRepriseNonVentile([], [{ id: 'c', compte_provision: '151200', reprise_centimes: 1 }])).toBe('151200')
  })

  it('les racines lettrées sont le 408 et le 418, lues au catalogue des rôles', () => {
    expect(RACINES_LETTREES_PAR_REGULARISATION).toEqual(['408', '418'])
  })
})

describe('prealablesDeLInventaire : ce que la validation retiendrait, avant le clic', () => {
  const lu = (o: Partial<Extract<InventaireDeLaValidation, { etat: 'lu' }>> = {}): InventaireDeLaValidation => ({
    etat: 'lu', operations: [], declarations: [{ id: 'd', exercice: 2025, retire_le: null }], provisions: [], ...o,
  })
  const entrees = (o: Partial<EntreesDeLInventaire> = {}): EntreesDeLInventaire => ({
    annee: 2025, mode: 'engagement', aNouveaux: [], ecritures: [], inventaire: lu(), ...o,
  })
  const ids = (e: EntreesDeLInventaire) => prealablesDeLInventaire(e).map((p) => p.id)

  it('sans objet (le drapeau baissé) : rien ; en trésorerie : ni déclaration attendue ni rien d’autre', () => {
    expect(prealablesDeLInventaire(entrees({ inventaire: INVENTAIRE_SANS_OBJET }))).toEqual([])
    expect(ids(entrees({ mode: 'tresorerie', inventaire: lu({ declarations: [] }) }))).toEqual([])
  })

  it('l’inventaire non déclaré, ou seulement par une déclaration retirée, sous les mots de la base', () => {
    expect(prealablesDeLInventaire(entrees({ inventaire: lu({ declarations: [] }) }))).toEqual([{
      id: 'inventaire-non-declare',
      message: "L'inventaire de l'exercice 2025 n'est pas déclaré : le déclarer fait, même sans régularisation, avant la validation.",
    }])
    expect(ids(entrees({ inventaire: lu({ declarations: [{ id: 'd', exercice: 2025, retire_le: '2026-01-10T08:00:00Z' }] }) })))
      .toEqual(['inventaire-non-declare'])
    expect(ids(entrees({ inventaire: lu({ declarations: [{ id: 'd', exercice: 2024, retire_le: null }] }) }))).toEqual(['inventaire-non-declare'])
  })

  it('la première régularisation qui n’est plus à jour, par son identifiant ; celle de l’exercice précédent sans son extourne', () => {
    const a = op({ id: 'b-2', objet: 'Deuxième' })
    const b = op({ id: 'a-1', objet: 'Première' })
    const ecritures = [...ecrites(a).slice(1), ...ecrites(b).slice(1)]
    expect(prealablesDeLInventaire(entrees({ ecritures, inventaire: lu({ operations: [a, b] }) }))).toEqual([{
      id: 'inventaire-a-recomposer', message: motsDeLaValidation(MODELES_DE_LA_VALIDATION.aRecomposer, 2025, 'Première'),
    }])
    const precedente = op({ id: 'p', exercice: 2024, objet: 'Loyer de janvier' })
    const sansExtourne = ecrites(precedente).filter((l) => l.date === '2024-12-31')
    expect(prealablesDeLInventaire(entrees({ ecritures: sansExtourne, inventaire: lu({ operations: [precedente] }) }))).toEqual([{
      id: 'extourne-manquante', message: motsDeLaValidation(MODELES_DE_LA_VALIDATION.extourneManquante, 2025, 2024, 'Loyer de janvier'),
    }])
    expect(ids(entrees({ ecritures: ecrites(precedente), inventaire: lu({ operations: [precedente] }) }))).toEqual([])
  })

  it('les provisions reprises non ventilées, au premier exercice d’un dossier en engagement seulement', () => {
    const aNouveaux = [{ date: '2025-01-01', compte: '151100', sens: 'credit' as const, montant: 1000 },
      { date: '2025-01-01', compte: '512000', sens: 'debit' as const, montant: 1000 }]
    expect(prealablesDeLInventaire(entrees({ aNouveaux }))).toEqual([{
      id: 'provisions-a-ventiler', message: motsDeLaValidation(MODELES_DE_LA_VALIDATION.provisionsAVentiler, 2025, '151100'),
    }])
    expect(ids(entrees({ aNouveaux, annee: 2026, inventaire: lu({ declarations: [{ id: 'd', exercice: 2026, retire_le: null }] }) }))).toEqual([])
    expect(ids(entrees({ aNouveaux, inventaire: lu({ provisions: [{ id: 'p', compte_provision: '151100', reprise_centimes: 100000 }] }) }))).toEqual([])
  })
})

describe('la migration, son retour et son essai', () => {
  it('l’essai cite le module, et le retour rend la validation d’hier (son empreinte, dite par la garde de fin)', () => {
    expect(ESSAI).toContain('src/lib/inventaireDeLaValidation.ts')
    expect(RETOUR).toContain('923cfa1b57037146070ca1430f163495')
    expect(MIGRATION).toContain("923cfa1b57037146070ca1430f163495")
  })

  it('la table des déclarations est celle que la sauvegarde déclare derrière le drapeau', () => {
    expect(MIGRATION).toContain(`create table public.${TABLES_DES_DECLARATIONS[0]} (`)
  })

  it('le texte passe par l’outil : aucune suppression hors des événements d’un déclencheur, aucune barre oblique inverse', () => {
    expect(MIGRATION).not.toMatch(/\bdelete\s+from\b|\bdrop\s|\btruncate\b/i)
    expect(MIGRATION).not.toContain('\\')
    expect(MIGRATION).not.toContain('\r')
  })
})

// ── Les régularisations reprises d'une balance (INV3-Q2 (A)) ──

describe('les régularisations reprises, à la validation du premier exercice', () => {
  const repriseCca = op({ id: 'r-1', exercice: 2024, reprise: true, compte_regularisation: '486000', montant_centimes: 30000, objet: 'Assurance reprise' })
  const repriseFnp = op({ id: 'r-2', exercice: 2024, reprise: true, nature: 'fnp', compte_resultat: '622600', compte_regularisation: '408100',
    montant_centimes: 10000, tva_centimes: 2000, objet: 'Honoraires repris' })
  // Les lignes que la base écrit : la TVA d'attente au compte du rôle (445860), sous sa racine.
  const ecritesAuPlan = (o: OperationDeLaValidation) => ecrites(o).map((l) => (l.compte === '44586' ? { ...l, compte: '445860' } : l))
  const balance = [
    { date: '2025-01-01', compte: '512000', sens: 'debit' as const, montant: 1000 }, { date: '2025-01-01', compte: '486000', sens: 'debit' as const, montant: 300 },
    { date: '2025-01-01', compte: '445860', sens: 'debit' as const, montant: 20 }, { date: '2025-01-01', compte: '408100', sens: 'credit' as const, montant: 120 },
    { date: '2025-01-01', compte: '408400', sens: 'credit' as const, montant: 50 }, { date: '2025-01-01', compte: '101000', sens: 'credit' as const, montant: 1150 },
  ]

  it('une reprise commande son extourne seule, au 1er janvier : la base l’écrit ainsi, elle est à jour', () => {
    expect(lignesCommandees(repriseCca, null)).toEqual([
      { date: '2025-01-01', compte: '486000', sens: 'credit', centimes: 30000 }, { date: '2025-01-01', compte: '616000', sens: 'debit', centimes: 30000 },
    ])
    expect(regularisationAJour(repriseCca, ecrites(repriseCca), null)).toBe(true)
    // Sa constatation au 31 décembre, que la balance porte déjà, la rend fausse.
    expect(regularisationAJour(repriseCca, [...ecrites(repriseCca), ...ecrites({ ...repriseCca, reprise: false }).filter((l) => l.date === '2024-12-31')], null)).toBe(false)
  })

  it('confrontées au solde repris : chaque compte de régularisation soldé au 1er janvier, le 4084 laissé, la TVA d’attente comprise', () => {
    const brouillon = [...ecrites(repriseCca), ...ecritesAuPlan(repriseFnp)]
    expect(compteRepriseNonExtourne(balance, [repriseCca, repriseFnp], brouillon, 2025)).toBeNull()
    expect(compteRepriseNonExtourne(balance, [], [], 2025)).toBe('408100')
    expect(compteRepriseNonExtourne(balance, [repriseCca], ecrites(repriseCca), 2025)).toBe('408100')
    const sansTva = { ...repriseFnp, montant_centimes: 12000, tva_centimes: 0 }
    expect(compteRepriseNonExtourne(balance, [repriseCca, sansTva], [...ecrites(repriseCca), ...ecritesAuPlan(sansTva)], 2025)).toBe('445860')
    const moindre = { ...repriseCca, montant_centimes: 25000 }
    expect(compteRepriseNonExtourne(balance, [moindre, repriseFnp], [...ecrites(moindre), ...ecritesAuPlan(repriseFnp)], 2025)).toBe('486000')
    // Une reprise sur un compte que la balance ne porte pas le laisse en écart ; l'extourne d'une autre année ne compte pas.
    const ailleurs = { ...repriseCca, compte_regularisation: '486100' }
    expect(compteRepriseNonExtourne(balance, [ailleurs, repriseFnp], [...ecrites(ailleurs), ...ecritesAuPlan(repriseFnp)], 2025)).toBe('486000')
    expect(compteRepriseNonExtourne(balance, [repriseCca, repriseFnp], brouillon, 2026)).toBe('408100')
  })

  it('tous les comptes en écart, pour l’écran : le premier est celui que la base dit, chacun avec son solde repris et son reste', () => {
    const brouillon = [...ecrites(repriseCca), ...ecritesAuPlan(repriseFnp)]
    expect(comptesReprisNonExtournes(balance, [repriseCca, repriseFnp], brouillon, 2025)).toEqual([])
    expect(comptesReprisNonExtournes(balance, [], [], 2025)).toEqual([
      { compte: '408100', reprisCentimes: -12000, resteCentimes: -12000 },
      { compte: '445860', reprisCentimes: 2000, resteCentimes: 2000 },
      { compte: '486000', reprisCentimes: 30000, resteCentimes: 30000 },
    ])
    const moindre = { ...repriseCca, montant_centimes: 25000 }
    const ecart = comptesReprisNonExtournes(balance, [moindre, repriseFnp], [...ecrites(moindre), ...ecritesAuPlan(repriseFnp)], 2025)
    expect(ecart).toEqual([{ compte: '486000', reprisCentimes: 30000, resteCentimes: 5000 }])
    // Un compte qu'une extourne touche sans que la balance le porte : son solde repris à zéro.
    const ailleurs = { ...repriseCca, compte_regularisation: '486100' }
    expect(comptesReprisNonExtournes(balance, [ailleurs, repriseFnp], [...ecrites(ailleurs), ...ecritesAuPlan(repriseFnp)], 2025)).toEqual([
      { compte: '486000', reprisCentimes: 30000, resteCentimes: 30000 }, { compte: '486100', reprisCentimes: 0, resteCentimes: -30000 },
    ])
    for (const [ops, lignes] of [[[], []], [[moindre, repriseFnp], ecart.length ? [...ecrites(moindre), ...ecritesAuPlan(repriseFnp)] : []]] as const) {
      expect(compteRepriseNonExtourne(balance, ops, lignes, 2025)).toBe(comptesReprisNonExtournes(balance, ops, lignes, 2025)[0]?.compte ?? null)
    }
  })

  it('les racines confrontées, lues au catalogue, sont celles de la migration, et le 4084 en est écarté des deux côtés', () => {
    expect(RACINES_CONFRONTEES_A_LA_REPRISE).toEqual(['486', '487', '408', '418', '44586', '44587'])
    const bloc = VALIDER.slice(VALIDER.indexOf('--   f. Les régularisations reprises'), VALIDER.indexOf("perform set_config('jd.validation_exercice'"))
    expect(bloc).toContain(RACINES_CONFRONTEES_A_LA_REPRISE.map((r, i) => `${i === 0 ? '' : 'or '}starts_with(s.compte, '${r}')`).join(' ')
      .replace(" or starts_with(s.compte, '418')", "\n            or starts_with(s.compte, '418')"))
    expect(bloc).toContain("and not starts_with(s.compte, '4084')")
  })

  const lu = (o: Partial<Extract<InventaireDeLaValidation, { etat: 'lu' }>> = {}): InventaireDeLaValidation => ({
    etat: 'lu', operations: [], declarations: [{ id: 'd', exercice: 2025, retire_le: null }], provisions: [], ...o,
  })
  const entrees = (o: Partial<EntreesDeLInventaire> = {}): EntreesDeLInventaire => ({
    annee: 2025, mode: 'engagement', aNouveaux: balance, ecritures: [...ecrites(repriseCca), ...ecritesAuPlan(repriseFnp)],
    inventaire: lu({ operations: [repriseCca, repriseFnp] }), ...o,
  })
  const ids = (e: EntreesDeLInventaire) => prealablesDeLInventaire(e).map((p) => p.id)

  it('avant le clic, sous les mots de la base : rien quand tout est juste ; une reprise n’attend jamais d’extourne entière', () => {
    expect(ids(entrees())).toEqual([])
    expect(prealablesDeLInventaire(entrees({ ecritures: ecrites(repriseCca), inventaire: lu({ operations: [repriseCca] }) }))).toEqual([{
      id: 'reprise-non-extournee', message: motsDeLaValidation(MODELES_DE_LA_VALIDATION.repriseNonExtournee, 2025, '408100'),
    }])
  })

  it('la reprise à recomposer, puis sa place, puis la confrontation', () => {
    const falsifiee = [...ecrites(repriseCca).map((l) => (l.compte === '616000' ? { ...l, compte: '618000' } : l)), ...ecritesAuPlan(repriseFnp)]
    expect(prealablesDeLInventaire(entrees({ ecritures: falsifiee }))).toEqual([{
      id: 'reprise-a-recomposer', message: motsDeLaValidation(MODELES_DE_LA_VALIDATION.repriseARecomposer, 2025, 'Assurance reprise'),
    }])
    expect(prealablesDeLInventaire(entrees({ aNouveaux: [] }))).toEqual([{
      id: 'reprise-hors-de-l-ouverture', message: motsDeLaValidation(MODELES_DE_LA_VALIDATION.repriseHorsDeLOuverture, 2025, 'Assurance reprise'),
    }])
    expect(ids(entrees({ ecritures: falsifiee, aNouveaux: [] }))).toEqual(['reprise-a-recomposer', 'reprise-hors-de-l-ouverture'])
    // En trésorerie, rien ne se confronte ; un autre exercice que le premier n'en porte aucune.
    expect(ids(entrees({ mode: 'tresorerie', ecritures: ecrites(repriseCca), inventaire: lu({ operations: [repriseCca] }) }))).toEqual([])
    expect(ids(entrees({ annee: 2026, inventaire: lu({ operations: [repriseCca, repriseFnp], declarations: [{ id: 'd', exercice: 2026, retire_le: null }] }) }))).toEqual([])
  })
})

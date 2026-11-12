import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  composerLEcritureDAffectation, jugerLAffectation, ROLES_DE_L_AFFECTATION, type ContexteDeLAffectation, type DecisionSaisie,
  type LigneDAffectation, type SoldesAvantAffectation,
} from './affectationDuResultat'
import { ROLES_COMPTABLES } from './planComptable'

// AFF2 (lignes 33 et 45) : LA BASE REDIT LE MODULE. La migration `affectation_du_resultat` (préparée) refuse ce que
// src/lib/affectationDuResultat.ts refuse, sous les mêmes mots, dans le même ordre (la base ne dit que le premier) ; elle
// insère au catalogue les six rôles que le module déclare ; elle recompose l'écriture que `composerLEcritureDAffectation`
// propose. Son essai (supabase/essais/affectationDuResultat.sql, joué sur une réplique) attend, cas par cas, le refus que le
// module rend ici sur le même jeu : la confrontation se fait par le texte de l'essai.

const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), 'utf8')
const MIGRATION = lire('supabase/preparees/20261112233000_affectation_du_resultat.sql')
const RETOUR = lire('supabase/preparees/retour/20261112233100_retour_affectation_du_resultat.sql')
const ESSAI = lire('supabase/essais/affectationDuResultat.sql')
const ESSAI_DU_PLAN = lire('supabase/essais/planComptable.sql')
const RLS = lire('supabase/essais/rls.sql')

/** Le corps d'une fonction de la migration. */
function corps(nom: string): string {
  const debut = MIGRATION.search(new RegExp(`create function public\\.${nom}\\(`, 'i'))
  const fin = MIGRATION.indexOf('$fonction$;', debut)
  if (debut < 0 || fin < 0) throw new Error(`${nom} introuvable dans la migration`)
  return MIGRATION.slice(debut, fin)
}
const ENREGISTRER = corps('enregistrer_affectation')

// ── Le jeu de l'essai, tel que le module le reçoit ──
const SOLDES_NULS: SoldesAvantAffectation = {
  capitalAuxComptes: 0, primes: 0, ecartsDeReevaluation: 0, reserveLegale: 0, reservesIndisponibles: 0, reservesStatutaires: 0,
  reservesReglementees: 0, autresReserves: 0, reportCrediteur: 0, pertesAnterieures: 0, acomptesSurDividendes: 0,
}
const COMPTES = {
  resultat_benefice: '120000', resultat_perte: '129000', reserve_legale: '106100', reserves_statutaires: '106300',
  autres_reserves: '106800', report_a_nouveau_crediteur: '110000', report_a_nouveau_debiteur: '119000', dividendes_a_payer: '457000',
}
type Dossier = 'd' | 'd2' | 'd3' | 'tresorerie' | 'ei' | 'sans_forme' | 'hors_champ' | 'sans_capital' | 'acomptes'
function contexte(dossier: Dossier, statuts = true, exerciceDeLaDecisionValide = false): ContexteDeLAffectation {
  const base = { modeComptable: 'engagement' as const, exploitantIndividuel: false, formeJuridique: '5499' as string | null,
    capitalCentimes: 1000000 as number | null, reservesStatutairesDistribuables: statuts }
  const soldes: Record<Dossier, SoldesAvantAffectation> = {
    d: { ...SOLDES_NULS, capitalAuxComptes: 1000000, reserveLegale: 80000, autresReserves: 500000 },
    d2: { ...SOLDES_NULS, capitalAuxComptes: 1000000, pertesAnterieures: 500000 },
    d3: { ...SOLDES_NULS, capitalAuxComptes: 500000, reserveLegale: 100000 },
    tresorerie: SOLDES_NULS, ei: SOLDES_NULS, sans_forme: SOLDES_NULS, hors_champ: SOLDES_NULS, sans_capital: SOLDES_NULS,
    acomptes: { ...SOLDES_NULS, acomptesSurDividendes: 1000 },
  }
  const dossiers: Record<Dossier, ContexteDeLAffectation['dossier']> = {
    d: base, d2: base, d3: base, acomptes: base,
    tresorerie: { ...base, modeComptable: 'tresorerie' }, ei: { ...base, exploitantIndividuel: true },
    sans_forme: { ...base, formeJuridique: null, capitalCentimes: null }, hors_champ: { ...base, formeJuridique: '9220', capitalCentimes: 100000 },
    sans_capital: { ...base, capitalCentimes: null },
  }
  return { dossier: dossiers[dossier], resultatCentimes: ['d', 'd2', 'd3'].includes(dossier) ? 3000000 : 0, soldes: soldes[dossier],
    comptes: COMPTES, aujourdHui: '2026-11-12', exerciceDeLaDecisionValide }
}
const L = (origine: LigneDAffectation['origine'], destination: LigneDAffectation['destination'], centimes: number): LigneDAffectation =>
  ({ origine, destination, centimes })
const BONNES = [L('benefice', 'reserve_legale', 20000), L('benefice', 'autres_reserves', 980000), L('benefice', 'dividendes', 2000000)]
function decision(p: Partial<DecisionSaisie> = {}): DecisionSaisie {
  return { exerciceAffecte: 2025, organe: 'assemblee', nombreDAssocies: 'plusieurs', dateDecision: '2026-05-15', comptesApprouves: true,
    dateMiseEnPaiement: null, lignes: BONNES, ...p }
}
const PAYE = { dateMiseEnPaiement: '2026-06-30' }
const RL_REPORT = [L('benefice', 'reserve_legale', 20000), L('benefice', 'report_crediteur', 2980000)]

/** Les cas de l'essai que le module juge (les refus que la base dit seule — l'accès, la saisie illisible, l'exercice non
 *  validé, l'écriture proposée — n'ont pas de jumeau ici), et le code que la base y met. */
const CAS: readonly [string, string, ContexteDeLAffectation, DecisionSaisie][] = [
  ['E0', '22023', contexte('tresorerie'), decision(PAYE)],
  ['E3', '22023', contexte('d'), decision({ lignes: [L('benefice', 'reserve_legale', 1.5)] })],
  ['E4', '22023', contexte('ei'), decision(PAYE)],
  ['E5', '22023', contexte('sans_forme'), decision(PAYE)],
  ['E6', '22023', contexte('hors_champ'), decision(PAYE)],
  ['E7', '22023', contexte('sans_capital'), decision(PAYE)],
  ['E8', '22023', contexte('acomptes'), decision(PAYE)],
  ['E9', '22023', contexte('d'), decision({ ...PAYE, exerciceAffecte: 1999 })],
  ['E11', '22023', contexte('d'), decision({ ...PAYE, dateDecision: '2026-02-30' })],
  ['E12', '22023', contexte('d'), decision({ ...PAYE, dateDecision: '2025-12-31' })],
  ['E13', '22023', contexte('d'), decision({ dateDecision: '2099-01-15', dateMiseEnPaiement: '2099-06-30' })],
  ['E14', '23514', contexte('d', true, true), decision({ exerciceAffecte: 2024, dateDecision: '2025-05-15', dateMiseEnPaiement: '2025-06-30', lignes: [] })],
  ['E15', '22023', contexte('d'), decision({ ...PAYE, organe: 'associe_unique' })],
  ['E16', '22023', contexte('d'), decision({ ...PAYE, comptesApprouves: false })],
  ['E17', '22023', contexte('d'), decision({ lignes: [L('report_crediteur', 'reserve_legale', 100)] })],
  ['E18', '22023', contexte('d', false), decision({ lignes: [...RL_REPORT, L('reserves_statutaires', 'dividendes', 100)] })],
  ['E19', '22023', contexte('d'), decision({ lignes: [L('perte', 'report_debiteur', 100)] })],
  ['E20', '22023', contexte('d'), decision({ lignes: [L('benefice', 'reserve_legale', 20000), L('benefice', 'report_crediteur', 2979999)] })],
  ['E21', '22023', contexte('d'), decision({ lignes: [...RL_REPORT, L('report_crediteur', 'dividendes', 100)] })],
  ['E22', '22023', contexte('d'), decision({ lignes: [L('benefice', 'reserve_legale', 20000), L('benefice', 'report_debiteur', 100), L('benefice', 'report_crediteur', 2979900)] })],
  ['E23', '22023', contexte('d'), decision({ lignes: [L('benefice', 'reserve_legale', 19999), L('benefice', 'report_crediteur', 2980001)] })],
  ['E24', '22023', contexte('d2'), decision({ lignes: [L('benefice', 'reserve_legale', 100000), L('benefice', 'dividendes', 2900000)] })],
  ['E25', '22023', contexte('d'), decision({ lignes: [...RL_REPORT, L('autres_reserves', 'dividendes', 100000)] })],
  ['E26', '22023', contexte('d3'), decision({ lignes: [L('benefice', 'dividendes', 3000000)] })],
  ['E27', '22023', contexte('d'), decision({ ...PAYE, lignes: RL_REPORT })],
  ['E28', '22023', contexte('d'), decision({ dateMiseEnPaiement: '2026-05-01' })],
]

/** Une chaîne SQL telle que l'essai l'écrit : les apostrophes doublées. */
const enSql = (texte: string) => texte.replace(/'/g, "''")

describe('la base redit les refus du module', () => {
  it.each(CAS)('%s : l’essai attend le premier refus du module, sous son code', (cas, code, c, d) => {
    const premier = jugerLAffectation(c, d).refus[0]
    expect(premier, cas).toBeDefined()
    const ligne = ESSAI.split('\n').findIndex((l) => l.includes(`('${cas}. `))
    expect(ligne, cas).toBeGreaterThan(0)
    const deux = ESSAI.split('\n').slice(ligne, ligne + 2).join('\n')
    expect(deux, cas).toContain(`'${code} ${enSql(premier.message)}'`)
  })

  it('les refus du module se lisent dans la fonction, dans l’ordre du module', () => {
    // Le texte fixe de chaque refus (avant sa première partie variable), dans l'ordre de `jugerLAffectation`.
    const ordre = [
      'Un montant n’est pas un nombre entier de centimes', 'Le plan du dossier ne rend pas, pour chaque compte de l’affectation',
      'Un dossier tenu en trésorerie ne connaît pas', 'Une entreprise individuelle n’affecte pas son résultat',
      'La forme juridique du dossier n’est pas posée', 'n’est ni une SARL, ni une société par actions',
      'Le capital social du dossier n’est pas posé', 'Le compte des acomptes sur dividendes porte un solde de',
      'L’exercice affecté n’est pas une année entre 2000 et 2100.', 'Une date n’est pas une date du calendrier (JJ/MM/AAAA).',
      'au plus tard à la clôture de l’exercice', 'dans le futur : elle s’enregistre une fois prise.',
      'est validé : une écriture n’y entre plus.', 'Une décision de l’associé unique suppose un seul associé.',
      'Les comptes ne sont pas approuvés : le résultat ne s’affecte pas', 'ne s’affecte pas à %s.',
      'Les statuts ne permettent pas de distribuer les réserves statutaires', 'se solde par %s : une ligne affecte %s.',
      's’affecte en entier : les lignes en affectent', 'La décision prélève %s sur %s', 'La décision apure %s de pertes antérieures',
      'La réserve légale doit recevoir au moins', 'dépassent le bénéfice distribuable', 'Les dividendes se prélèvent par priorité',
      'Après la distribution, les capitaux propres', 'La décision ne distribue aucun dividende', 'précède la décision',
    ]
    const positions = ordre.map((f) => ENREGISTRER.indexOf(f))
    ordre.forEach((f, i) => expect(positions[i], f).toBeGreaterThan(0))
    for (let i = 1; i < positions.length; i++) expect(positions[i], ordre[i]).toBeGreaterThan(positions[i - 1])
  })

  it('les montants s’écrivent comme `formatMoney` : l’espace fine insécable entre les milliers, l’insécable avant « € »', () => {
    expect(MIGRATION).toContain("replace(to_char(abs(p_centimes) / 100, 'FM999,999,999,999,999,990'), ',', chr(8239))")
    expect(MIGRATION).toContain("|| chr(160) || '€'")
    expect(ESSAI).toContain('30 000,00 €')
  })
})

describe('l’écriture, le catalogue, le retour', () => {
  const bonne = (nom: string) => JSON.parse(new RegExp(`  ${nom} text := '(.*)';`).exec(ESSAI)![1])

  it('l’essai propose l’écriture que le module compose (D, et D2 qui apure ses pertes) ; rls.sql aussi', () => {
    const d = composerLEcritureDAffectation(contexte('d'), decision(PAYE))
    expect(bonne('bonne_ecriture')).toEqual(d)
    const lignesD2 = [L('benefice', 'reserve_legale', 100000), L('benefice', 'report_debiteur', 500000), L('benefice', 'report_crediteur', 2400000)]
    expect(jugerLAffectation(contexte('d2'), decision({ lignes: lignesD2 })).refus).toEqual([])
    expect(bonne('ecriture_d2')).toEqual(composerLEcritureDAffectation(contexte('d2'), decision({ lignes: lignesD2 })))
    const rls = composerLEcritureDAffectation({ ...contexte('d'), soldes: SOLDES_NULS, resultatCentimes: 100000 },
      decision({ lignes: [L('benefice', 'reserve_legale', 5000), L('benefice', 'report_crediteur', 95000)] }))
    expect(RLS).toContain(`ecriture jsonb := '${JSON.stringify(rls).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/\},\{/g, '}, {')}';`)
  })

  it('la fonction recompose avec les comptes des huit rôles de l’affectation, ceux que le module reçoit', () => {
    expect(ENREGISTRER).toContain("foreach v_role in array array['resultat_benefice', 'resultat_perte', 'reserve_legale', 'reserves_statutaires', 'autres_reserves',\n"
      + "                                'report_a_nouveau_crediteur', 'report_a_nouveau_debiteur', 'dividendes_a_payer']")
    expect(Object.keys(COMPTES).sort()).toEqual(['resultat_benefice', 'resultat_perte', ...ROLES_DE_L_AFFECTATION.map((r) => r.role)].sort())
    expect(ENREGISTRER).toContain("'Affectation du résultat ' || p_exercice || ' — décision du ' || to_char(v_date, 'DD/MM/YYYY')")
  })

  it('les six rôles : insérés tels que le module les déclare, absents du catalogue de l’application, rendus par le retour', () => {
    for (const r of ROLES_DE_L_AFFECTATION) {
      expect(MIGRATION, r.role).toContain(`('${r.role}', array['${r.racines.join("', '")}'], '${r.compteDefaut}', '${r.libelleDefaut}', null, ${r.ordre})`)
      expect(ROLES_COMPTABLES.some((c) => c.role === r.role), r.role).toBe(false)
      expect(RETOUR, r.role).toContain(`'${r.role}'`)
      // Aucune racine du catalogue n'en commence une autre (`regler_plan_du_dossier`, contrôle 8).
      for (const c of [...ROLES_COMPTABLES, ...ROLES_DE_L_AFFECTATION.filter((x) => x !== r)]) {
        for (const a of c.racines) for (const b of r.racines) expect(a.startsWith(b) || b.startsWith(a), `${c.role} / ${r.role}`).toBe(false)
      }
    }
    const texte = ROLES_DE_L_AFFECTATION.map((r) => `${r.role}|${r.racines.join(',')}|${r.compteDefaut}|${r.libelleDefaut ?? ''}|${r.prefixeAuxiliaireDefaut ?? ''}|${r.ordre}`).join('\n')
    const epinglee = /empreinte_roles_affectation constant text := '([0-9a-f]{32})'/.exec(ESSAI_DU_PLAN)?.[1]
    expect(createHash('md5').update(texte, 'utf8').digest('hex')).toBe(epinglee)
  })
})

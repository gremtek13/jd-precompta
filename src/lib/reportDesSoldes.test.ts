import { describe, expect, it } from 'vitest'
import { libelleDuResultat } from './aNouveaux'
import type { MouvementBancaire } from './affectationBanque'
import { COMPTE_CAPITAL_INDIVIDUEL, COMPTE_RESULTAT_BENEFICE, COMPTE_RESULTAT_PERTE } from './comptes'
import type { ModeleComptable } from './engagement'
import { formaterFec, genererFec, numeroterFec, numerotationValidee } from './fec'
import { calculerBalance } from './ecritures'
import { pisteAudit } from './pisteAudit'
import {
  aNouveauDuReport, etatDeLOuverture, exploitantIndividuel, LIBELLE_CAPITAL_INDIVIDUEL, LIBELLE_RESULTATS_EN_ATTENTE,
  MOTIFS_DU_REPORT, mouvementsDeCloture, ouvertureDeLExercice, soldesAReporter, sourceDuReport,
  type MouvementDeCloture,
} from './reportDesSoldes'
import type { ANouveau, EcritureBrouillon, SensEcriture, SoldeReporte } from './types'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from '../test/ecritures'
import { tirage } from '../test/encaissementsBatterie'
import { derniereDefinitionSql } from '../test/schema'

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
const SOCIETE: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }
const SOCIETE_467: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '467000' }
const EI_ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '108000' }

type Ligne = [compte: string, libelle: string, sens: SensEcriture, montant: number]

// LA TABLE RELEVÉE SUR LA FONCTION DE LA BASE. Chaque cas a été joué le 07/10/2026 par `soldes_a_reporter` elle-même
// (supabase/schema/20261007052231_report_des_soldes.sql), sur une réplique locale du schéma de production : un dossier
// jetable, les lignes de l'exercice 2025 — écritures validées, à-nouveaux repris, soldes reportés —, l'appel, et ce
// qu'elle rend recopié ici tel quel, libellés compris. Le jumeau de l'application doit rendre EXACTEMENT la même chose :
// l'écran montre l'ouverture de l'exercice suivant avant la validation, la base l'écrit au clic, et deux calculs qui
// divergent ne se verraient nulle part ailleurs. `supabase/essais/reportDesSoldes.sql` éprouve la même fonction en
// production, sur des dossiers jetables.
//
// Les cas couvrent chaque branche de la fonction : les trois destinations du résultat, le 108, le 101 et le 12 d'une
// entreprise individuelle, les libellés (celui que l'exercice a figé, « Capital individuel », le résultat avec son
// exercice, « Résultats en attente d'affectation »), un résultat nul, un compte soldé, un compte hors des classes 1 à 7,
// une ouverture déséquilibrée et des centimes que la virgule flottante ne somme pas juste.
interface CasReleve { nom: string; modele: ModeleComptable; mouvements: Ligne[]; soldes: Ligne[] }

const TABLE: CasReleve[] = [
  {
    nom: 'EI en trésorerie : le 108, le 101 et le résultat passent au 101000',
    modele: TRESORERIE,
    mouvements: [
      ['512000', 'Banque', 'debit', 10000],
      ['101000', 'Capital individuel', 'credit', 10000],
      ['706000', 'Honoraires', 'credit', 50000],
      ['512000', 'Banque', 'debit', 50000],
      ['606100', 'Fournitures', 'debit', 1234.56],
      ['512000', 'Banque', 'credit', 1234.56],
      ['108000', "Compte de l'exploitant", 'debit', 20000],
      ['512000', 'Banque', 'credit', 20000],
    ],
    soldes: [
      ['101000', 'Capital individuel', 'credit', 38765.44],
      ['512000', 'Banque', 'debit', 38765.44],
    ],
  },
  {
    nom: 'EI sans 101000 dans l’exercice : « Capital individuel »',
    modele: TRESORERIE,
    mouvements: [
      ['512000', 'Banque', 'debit', 500],
      ['706000', 'Honoraires', 'credit', 500],
    ],
    soldes: [
      ['101000', 'Capital individuel', 'credit', 500],
      ['512000', 'Banque', 'debit', 500],
    ],
  },
  {
    nom: 'EI : un 12, un 1011 et un 1081 passent aussi au 101000',
    modele: TRESORERIE,
    mouvements: [
      ['512000', 'Banque', 'debit', 500],
      ['120000', 'Résultat de l’exercice 2024 (bénéfice), en attente d’affectation', 'credit', 300],
      ['101100', 'Capital', 'credit', 200],
      ['108100', 'Prélèvements', 'debit', 100],
      ['512000', 'Banque', 'credit', 100],
    ],
    soldes: [
      ['101000', 'Capital individuel', 'credit', 400],
      ['512000', 'Banque', 'debit', 400],
    ],
  },
  {
    nom: 'EI repris : le 101000 garde le libellé que l’exercice lui a figé',
    modele: TRESORERIE,
    mouvements: [
      ['101000', 'Compte capital', 'credit', 1000],
      ['512000', 'Banque', 'debit', 1000],
      ['706000', 'Honoraires', 'credit', 200],
      ['512000', 'Banque', 'debit', 200],
    ],
    soldes: [
      ['101000', 'Compte capital', 'credit', 1200],
      ['512000', 'Banque', 'debit', 1200],
    ],
  },
  {
    nom: 'EI en engagement (compte du dirigeant 108) : au 101000',
    modele: EI_ENGAGEMENT,
    mouvements: [
      ['512000', 'Banque', 'debit', 100],
      ['101000', 'Capital individuel', 'credit', 100],
      ['706000', 'Ventes', 'credit', 900],
      ['411000', 'Clients', 'debit', 900],
      ['108000', "Compte de l'exploitant", 'debit', 100],
      ['512000', 'Banque', 'credit', 100],
    ],
    soldes: [
      ['101000', 'Capital individuel', 'credit', 900],
      ['411000', 'Clients', 'debit', 900],
    ],
  },
  {
    nom: 'Société, bénéfice : au 120000',
    modele: SOCIETE,
    mouvements: [
      ['706000', 'Ventes', 'credit', 1000],
      ['411000', 'Clients', 'debit', 1000],
      ['606000', 'Achats', 'debit', 300],
      ['401000', 'Fournisseurs', 'credit', 300],
    ],
    soldes: [
      ['120000', 'Résultat de l’exercice 2025 (bénéfice), en attente d’affectation', 'credit', 700],
      ['401000', 'Fournisseurs', 'credit', 300],
      ['411000', 'Clients', 'debit', 1000],
    ],
  },
  {
    nom: 'Société, perte : au 129000',
    modele: SOCIETE,
    mouvements: [
      ['512000', 'Banque', 'debit', 1000],
      ['101000', 'Capital social', 'credit', 1000],
      ['606000', 'Achats', 'debit', 800],
      ['512000', 'Banque', 'credit', 800],
    ],
    soldes: [
      ['101000', 'Capital social', 'credit', 1000],
      ['129000', 'Résultat de l’exercice 2025 (perte), en attente d’affectation', 'debit', 800],
      ['512000', 'Banque', 'debit', 200],
    ],
  },
  {
    nom: 'Société, bénéfice qui s’ajoute à un bénéfice antérieur en attente',
    modele: SOCIETE,
    mouvements: [
      ['512000', 'Banque', 'debit', 5000],
      ['120000', 'Résultat de l’exercice 2024 (bénéfice), en attente d’affectation', 'credit', 5000],
      ['706000', 'Ventes', 'credit', 1000],
      ['512000', 'Banque', 'debit', 1000],
    ],
    soldes: [
      ['120000', 'Résultats en attente d’affectation', 'credit', 6000],
      ['512000', 'Banque', 'debit', 6000],
    ],
  },
  {
    nom: 'Société, bénéfice à côté d’une perte antérieure en attente',
    modele: SOCIETE,
    mouvements: [
      ['129000', 'Résultat de l’exercice 2024 (perte), en attente d’affectation', 'debit', 2000],
      ['512000', 'Banque', 'credit', 2000],
      ['706000', 'Ventes', 'credit', 3000],
      ['512000', 'Banque', 'debit', 3000],
    ],
    soldes: [
      ['120000', 'Résultat de l’exercice 2025 (bénéfice), en attente d’affectation', 'credit', 3000],
      ['129000', 'Résultat de l’exercice 2024 (perte), en attente d’affectation', 'debit', 2000],
      ['512000', 'Banque', 'debit', 1000],
    ],
  },
  {
    nom: 'Société, perte à côté d’un bénéfice antérieur en attente',
    modele: SOCIETE_467,
    mouvements: [
      ['120000', 'Résultat de l’exercice 2024 (bénéfice), en attente d’affectation', 'credit', 500],
      ['512000', 'Banque', 'debit', 500],
      ['606000', 'Achats', 'debit', 200],
      ['512000', 'Banque', 'credit', 200],
    ],
    soldes: [
      ['120000', 'Résultat de l’exercice 2024 (bénéfice), en attente d’affectation', 'credit', 500],
      ['129000', 'Résultat de l’exercice 2025 (perte), en attente d’affectation', 'debit', 200],
      ['512000', 'Banque', 'debit', 300],
    ],
  },
  {
    nom: 'Société, résultat nul et perte antérieure : le 129000 garde son libellé',
    modele: SOCIETE,
    mouvements: [
      ['129000', 'Résultat de l’exercice 2024 (perte), en attente d’affectation', 'debit', 2000],
      ['512000', 'Banque', 'credit', 2000],
      ['706000', 'Ventes', 'credit', 500],
      ['512000', 'Banque', 'debit', 500],
      ['606000', 'Achats', 'debit', 500],
      ['512000', 'Banque', 'credit', 500],
    ],
    soldes: [
      ['129000', 'Résultat de l’exercice 2024 (perte), en attente d’affectation', 'debit', 2000],
      ['512000', 'Banque', 'credit', 2000],
    ],
  },
  {
    nom: 'Société, résultat nul et bénéfice antérieur : le 120000 reste seul',
    modele: SOCIETE,
    mouvements: [
      ['120000', 'Résultat de l’exercice 2024 (bénéfice), en attente d’affectation', 'credit', 700],
      ['512000', 'Banque', 'debit', 700],
      ['706000', 'Ventes', 'credit', 500],
      ['512000', 'Banque', 'debit', 500],
      ['606000', 'Achats', 'debit', 500],
      ['512000', 'Banque', 'credit', 500],
    ],
    soldes: [
      ['120000', 'Résultat de l’exercice 2024 (bénéfice), en attente d’affectation', 'credit', 700],
      ['512000', 'Banque', 'debit', 700],
    ],
  },
  {
    nom: 'Société, résultat nul sans résultat antérieur : rien ne s’écrit',
    modele: SOCIETE,
    mouvements: [
      ['706000', 'Ventes', 'credit', 500],
      ['512000', 'Banque', 'debit', 500],
      ['606000', 'Achats', 'debit', 500],
      ['512000', 'Banque', 'credit', 500],
    ],
    soldes: [],
  },
  {
    nom: 'Société : un 120000 antérieur soldé dans l’exercice n’est pas un résultat en attente',
    modele: SOCIETE,
    mouvements: [
      ['120000', 'Résultat de l’exercice 2024 (bénéfice), en attente d’affectation', 'credit', 400],
      ['512000', 'Banque', 'debit', 400],
      ['120000', 'Résultat de l’exercice 2024 (bénéfice), en attente d’affectation', 'debit', 400],
      ['512000', 'Banque', 'credit', 400],
      ['706000', 'Ventes', 'credit', 1000],
      ['512000', 'Banque', 'debit', 1000],
    ],
    soldes: [
      ['120000', 'Résultat de l’exercice 2025 (bénéfice), en attente d’affectation', 'credit', 1000],
      ['512000', 'Banque', 'debit', 1000],
    ],
  },
  {
    nom: 'Un compte hors des classes 1 à 7 se rend tel quel',
    modele: SOCIETE,
    mouvements: [
      ['801000', 'Engagements donnés', 'debit', 50],
      ['512000', 'Banque', 'credit', 50],
    ],
    soldes: [
      ['512000', 'Banque', 'credit', 50],
      ['801000', 'Engagements donnés', 'debit', 50],
    ],
  },
  {
    nom: 'Une ouverture déséquilibrée se rend telle quelle',
    modele: SOCIETE,
    mouvements: [
      ['512000', 'Banque', 'debit', 100],
    ],
    soldes: [
      ['512000', 'Banque', 'debit', 100],
    ],
  },
  {
    nom: 'Des centimes qui ne tombent pas juste en virgule flottante',
    modele: TRESORERIE,
    mouvements: [
      ['706000', 'Honoraires', 'credit', 0.1],
      ['512000', 'Banque', 'debit', 0.1],
      ['706000', 'Honoraires', 'credit', 0.2],
      ['512000', 'Banque', 'debit', 0.2],
      ['706000', 'Honoraires', 'credit', 0.07],
      ['512000', 'Banque', 'debit', 0.07],
      ['706000', 'Honoraires', 'credit', 0.14],
      ['512000', 'Banque', 'debit', 0.14],
      ['622600', 'Honoraires payés', 'debit', 0.3],
      ['512000', 'Banque', 'credit', 0.3],
    ],
    soldes: [
      ['101000', 'Capital individuel', 'credit', 0.21],
      ['512000', 'Banque', 'debit', 0.21],
    ],
  },
  {
    nom: 'Avoirs et remboursements : un 7 au débit, un 6 au crédit',
    modele: SOCIETE,
    mouvements: [
      ['706000', 'Ventes', 'credit', 1200],
      ['411000', 'Clients', 'debit', 1200],
      ['706000', 'Ventes', 'debit', 200],
      ['411000', 'Clients', 'credit', 200],
      ['606000', 'Achats', 'debit', 700],
      ['401000', 'Fournisseurs', 'credit', 700],
      ['606000', 'Achats', 'credit', 50],
      ['401000', 'Fournisseurs', 'debit', 50],
      ['445660', 'TVA déductible', 'debit', 130],
      ['401000', 'Fournisseurs', 'credit', 130],
    ],
    soldes: [
      ['120000', 'Résultat de l’exercice 2025 (bénéfice), en attente d’affectation', 'credit', 350],
      ['401000', 'Fournisseurs', 'credit', 780],
      ['411000', 'Clients', 'debit', 1000],
      ['445660', 'TVA déductible', 'debit', 130],
    ],
  },
  {
    nom: 'Deux libellés pour un compte : le plus grand',
    modele: SOCIETE,
    mouvements: [
      ['411000', 'Clients A', 'debit', 5],
      ['411000', 'Clients B', 'debit', 5],
      ['706000', 'Ventes', 'credit', 10],
    ],
    soldes: [
      ['120000', 'Résultat de l’exercice 2025 (bénéfice), en attente d’affectation', 'credit', 10],
      ['411000', 'Clients B', 'debit', 10],
    ],
  },
  {
    nom: 'Perte d’un EI : le 101000 au débit',
    modele: TRESORERIE,
    mouvements: [
      ['512000', 'Banque', 'debit', 300],
      ['101000', 'Capital individuel', 'credit', 300],
      ['616000', 'Assurances', 'debit', 900],
      ['512000', 'Banque', 'credit', 900],
    ],
    soldes: [
      ['101000', 'Capital individuel', 'debit', 600],
      ['512000', 'Banque', 'credit', 600],
    ],
  },
]

const enMouvements = (lignes: Ligne[]): MouvementDeCloture[] =>
  lignes.map(([compte, compteLib, sens, montant]) => ({ compte, compteLib, sens, montant }))
const enSoldes = (lignes: Ligne[]) => lignes.map(([compte, libelle, sens, montant]) => ({ compte, libelle, sens, montant }))

describe('le report est celui de la base, au centime et au libellé près', () => {
  it('la table couvre chaque branche (plancher)', () => {
    // Sans plancher, une table vidée par erreur rendrait la comparaison muette — et verte.
    expect(TABLE.length).toBeGreaterThanOrEqual(20)
  })

  for (const cas of TABLE) {
    it(cas.nom, () => {
      const report = soldesAReporter(enMouvements(cas.mouvements), cas.modele, 2025)
      expect(report.soldes).toEqual(enSoldes(cas.soldes))
    })
  }
})

describe('ce que la base refuserait', () => {
  const cas = (nom: string) => TABLE.find((c) => c.nom === nom)!

  it('un compte hors des classes 1 à 7 qui porte un solde', () => {
    const report = soldesAReporter(enMouvements(cas('Un compte hors des classes 1 à 7 se rend tel quel').mouvements), SOCIETE, 2025)
    expect(report.horsClasses).toEqual(['801000'])
    expect(report.ecartCentimes).toBe(0)
  })

  it('une ouverture déséquilibrée, en centimes exacts', () => {
    const report = soldesAReporter(enMouvements(cas('Une ouverture déséquilibrée se rend telle quelle').mouvements), SOCIETE, 2025)
    expect(report.ecartCentimes).toBe(10000)
    expect(report.horsClasses).toEqual([])
  })

  it('rien sur un exercice équilibré', () => {
    for (const c of TABLE.filter((x) => !/hors des classes|déséquilibrée/.test(x.nom))) {
      const report = soldesAReporter(enMouvements(c.mouvements), c.modele, 2025)
      expect(report.horsClasses, c.nom).toEqual([])
      expect(report.ecartCentimes, c.nom).toBe(0)
      expect(report.totalDebit, c.nom).toBe(report.totalCredit)
    }
  })

  it('un compte de classe 8 soldé ne se reporte pas, donc ne refuse rien', () => {
    const report = soldesAReporter(enMouvements([
      ['801000', 'Engagements donnés', 'debit', 50], ['801000', 'Engagements donnés', 'credit', 50],
      ['512000', 'Banque', 'debit', 10], ['706000', 'Honoraires', 'credit', 10],
    ]), TRESORERIE, 2025)
    expect(report.horsClasses).toEqual([])
  })

  it('les comptes hors classes dans l’ordre des numéros', () => {
    const report = soldesAReporter(enMouvements([
      ['901000', 'Analytique', 'debit', 5], ['801000', 'Engagements', 'debit', 5], ['512000', 'Banque', 'credit', 10],
    ]), SOCIETE, 2025)
    expect(report.horsClasses).toEqual(['801000', '901000'])
  })
})

describe('le résultat', () => {
  it('est rendu en euros, positif pour un bénéfice', () => {
    const benefice = soldesAReporter(enMouvements([['706000', 'Ventes', 'credit', 700.5], ['512000', 'Banque', 'debit', 700.5]]), SOCIETE, 2025)
    expect(benefice.resultat).toBe(700.5)
    const perte = soldesAReporter(enMouvements([['606000', 'Achats', 'debit', 80], ['512000', 'Banque', 'credit', 80]]), SOCIETE, 2025)
    expect(perte.resultat).toBe(-80)
  })

  it('porte l’exercice qui se clôt, et dit l’ouverture qu’il prépare', () => {
    const report = soldesAReporter([], TRESORERIE, 2025)
    expect(report).toMatchObject({ exercice: 2025, date: '2026-01-01', source: 'Exercice 2025 validé', soldes: [] })
  })
})

describe('une entreprise individuelle', () => {
  it('est un dossier dont le compte du dirigeant est le 108 — la règle de la base', () => {
    expect(exploitantIndividuel(TRESORERIE)).toBe(true)
    expect(exploitantIndividuel({ mode: 'tresorerie', compteNotesDeFrais: '467000' })).toBe(true)
    expect(exploitantIndividuel(EI_ENGAGEMENT)).toBe(true)
    expect(exploitantIndividuel(SOCIETE)).toBe(false)
    expect(exploitantIndividuel(SOCIETE_467)).toBe(false)
  })

  it('le rapport le dit', () => {
    expect(soldesAReporter([], TRESORERIE, 2025).individuel).toBe(true)
    expect(soldesAReporter([], SOCIETE, 2025).individuel).toBe(false)
  })
})

// LES LITTÉRAUX DE LA MIGRATION. La table ci-dessus prouve que les deux calculs s'accordent sur des cas ; ceci garde
// que les MOTS soient les mêmes — un compte ou un libellé changé dans la migration suivante d'un seul côté ne ferait
// échouer la table qu'au prochain relevé. On lit la DERNIÈRE définition de chaque fonction, celle que la base exécute.
describe('les littéraux sont ceux de la base', () => {
  const sansApostrophes = (s: string) => s.replace(/''/g, "'")

  it('soldes_a_reporter : les motifs, les comptes et les libellés', () => {
    const sql = sansApostrophes(derniereDefinitionSql('soldes_a_reporter'))
    expect(sql).toContain(`s.compte ~ '${MOTIFS_DU_REPORT.resultat.source}'`)
    expect(sql).toContain(`md.individuel and s.compte ~ '${MOTIFS_DU_REPORT.capitauxDeLExploitant.source}'`)
    expect(sql).toContain(`case when md.individuel then '${COMPTE_CAPITAL_INDIVIDUEL}' when r.net < 0 then '${COMPTE_RESULTAT_BENEFICE}' else '${COMPTE_RESULTAT_PERTE}' end`)
    expect(sql).toContain(`then '${COMPTE_CAPITAL_INDIVIDUEL}'\n        else s.compte`)
    expect(sql).toContain(`'${LIBELLE_RESULTATS_EN_ATTENTE}'`)
    expect(sql).toContain(`case when c.cible = '${COMPTE_CAPITAL_INDIVIDUEL}' then '${LIBELLE_CAPITAL_INDIVIDUEL}' end`)
    expect(sql).toContain("(d.mode_comptable = 'tresorerie' or d.compte_notes_de_frais = '108000') as individuel")
  })

  it('le libellé du résultat est le format de la base, rempli', () => {
    const sql = sansApostrophes(derniereDefinitionSql('soldes_a_reporter'))
    const format = /format\('([^']+)', p_annee,\s*case when c\.resultat < 0 then '([^']+)' else '([^']+)' end\)/.exec(sql)
    expect(format).not.toBeNull()
    const [, gabarit, benefice, perte] = format!
    const remplir = (annee: number, qualite: string) => gabarit.replace('%s', String(annee)).replace('%s', qualite)
    expect(libelleDuResultat(2025, true)).toBe(remplir(2025, benefice))
    expect(libelleDuResultat(2025, false)).toBe(remplir(2025, perte))
  })

  it('valider_exercice : ce qui se reporte, sa pièce, et le refus d’un compte hors classes', () => {
    const sql = sansApostrophes(derniereDefinitionSql('valider_exercice'))
    expect(sql).toContain(`filter (where compte !~ '${MOTIFS_DU_REPORT.reportable.source}')`)
    const source = /format\('(Exercice %s validé)', p_annee\)/.exec(sql)
    expect(source).not.toBeNull()
    expect(sourceDuReport(2025)).toBe(source![1].replace('%s', '2025'))
  })
})

// UN EXERCICE SANS ACTIVITÉ REPORTE SON OUVERTURE TELLE QUELLE. C'est la propriété qui fait tenir une chaîne d'exercices :
// sur des exercices tirés au hasard, équilibrés, le report d'un exercice vide ouvert par un report rend ce report — mêmes
// comptes, mêmes sens, mêmes montants, mêmes libellés. Un report qui déplacerait un compte, ou renommerait un libellé, le
// referait à chaque exercice.
describe('sur des exercices tirés au hasard', () => {
  // Les exercices sortent de `tirage` (src/test/encaissementsBatterie.ts) : déterministe, un échec se rejoue à
  // l'identique, et exact sur 32 bits. Le congruentiel en virgule flottante qui les tirait avant le 09/10/2026 bouclait
  // sur 10 466 valeurs, et ses trois graines tombaient dans la même suite : 501 exercices distincts sur 600.
  const COMPTES: [string, string][] = [
    ['512000', 'Banque'], ['101000', 'Capital individuel'], ['108000', "Compte de l'exploitant"], ['120000', 'Résultat'],
    ['129000', 'Perte'], ['164000', 'Emprunts'], ['218300', 'Matériel de bureau'], ['281830', 'Amortissements'],
    ['401000', 'Fournisseurs'], ['411000', 'Clients'], ['445660', 'TVA déductible'], ['455000', 'Associés'],
    ['606100', 'Fournitures'], ['622600', 'Honoraires payés'], ['681100', 'Dotations'], ['706000', 'Honoraires'],
  ]

  for (const modele of [TRESORERIE, SOCIETE, EI_ENGAGEMENT]) {
    it(`${modele.mode}, dirigeant ${modele.compteNotesDeFrais}`, () => {
      const hasard = tirage(modele.compteNotesDeFrais === '455000' && modele.mode === 'engagement' ? 7 : modele.mode === 'tresorerie' ? 11 : 13)
      for (let essai = 0; essai < 200; essai++) {
        const mouvements: MouvementDeCloture[] = []
        for (let k = 0; k < 1 + Math.floor(hasard() * 12); k++) {
          const [debit, libDebit] = COMPTES[Math.floor(hasard() * COMPTES.length)]
          const [credit, libCredit] = COMPTES[Math.floor(hasard() * COMPTES.length)]
          const montant = Math.round(hasard() * 1000000) / 100 || 0.01
          mouvements.push({ compte: debit, compteLib: libDebit, sens: 'debit', montant })
          mouvements.push({ compte: credit, compteLib: libCredit, sens: 'credit', montant })
        }
        const report = soldesAReporter(mouvements, modele, 2025)
        expect(report.ecartCentimes).toBe(0)
        expect(report.horsClasses).toEqual([])
        expect(report.soldes.every((s) => !/^[67]/.test(s.compte))).toBe(true)
        if (report.individuel) {
          expect(report.soldes.every((s) => s.compte === COMPTE_CAPITAL_INDIVIDUEL || !/^(101|108|12)/.test(s.compte))).toBe(true)
        }
        const suivant = soldesAReporter(
          report.soldes.map((s) => ({ compte: s.compte, compteLib: s.libelle, sens: s.sens, montant: s.montant })), modele, 2026,
        )
        expect(suivant.soldes).toEqual(report.soldes)
      }
    })
  }
})

describe('les lignes d’un exercice, tirées de sa numérotation', () => {
  function ecriture(o: Partial<EcritureBrouillon>): EcritureBrouillon {
    return {
      id: 'e', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, date: '2026-03-12', compte: '512000', libelle: 'Ligne',
      montant: 0, sens: 'debit', statut: 'proposee', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null,
      ...NON_VALIDEE, created_at: '2026-03-12T10:00:00Z', ...o,
    }
  }
  function mouvement(o: Partial<MouvementBancaire>): MouvementBancaire {
    return {
      id: 'l', date: '2026-03-12', libelle: 'VIR', libelle_brut: null, montant: 0, statut: 'rapprochee', piece_id: null,
      cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: 'releve.csv',
      emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
      reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, ...o,
    }
  }
  const reporte = (id: string, compte: string, libelle: string, sens: SensEcriture, montant: number): SoldeReporte => ({
    id, dossier_id: 'd1', date: '2026-01-01', compte, libelle, sens, montant, source_nom: 'Exercice 2025 validé',
    source_empreinte: 'e'.repeat(64), created_at: '2026-01-02T08:00:00Z', ...A_NOUVEAU_NON_VALIDE,
  })

  // Une entreprise individuelle ouverte par le report de 2025 : une recette affectée, un virement personnel et une
  // dotation en 2026.
  const OUVERTURE = [
    reporte('s1', '512000', 'Banque', 'debit', 800), reporte('s2', '218300', 'Matériel de bureau et matériel informatique', 'debit', 1200),
    reporte('s3', '281830', 'Amortissements du matériel de bureau et matériel informatique', 'credit', 400),
    reporte('s4', '101000', 'Capital individuel', 'credit', 1600),
  ]
  const ECRITURES = [
    ecriture({ id: 'e1', ligne_bancaire_id: 'l1', compte: '512000', sens: 'debit', montant: 3000 }),
    ecriture({ id: 'e2', ligne_bancaire_id: 'l1', compte: '706000', sens: 'credit', montant: 3000 }),
    ecriture({ id: 'e3', ligne_bancaire_id: 'l2', date: '2026-05-02', compte: '108000', sens: 'debit', montant: 1000 }),
    ecriture({ id: 'e4', ligne_bancaire_id: 'l2', date: '2026-05-02', compte: '512000', sens: 'credit', montant: 1000 }),
    ecriture({ id: 'e5', immobilisation_id: 'b1', date: '2026-12-31', compte: '681100', sens: 'debit', montant: 240 }),
    ecriture({ id: 'e6', immobilisation_id: 'b1', date: '2026-12-31', compte: '281830', sens: 'credit', montant: 240 }),
  ]
  const MOUVEMENTS = [
    mouvement({ id: 'l1', montant: 3000, categorie_id: 'c1' }),
    mouvement({ id: 'l2', date: '2026-05-02', montant: -1000, statut: 'ignoree', prelevement_personnel: true }),
  ]
  const numerotation = numeroterFec(
    ECRITURES, [], [{ id: 'c1', dossier_id: null, code: 'honoraires', libelle: 'Honoraires', ordre: 1, compte_comptable: '706000', poste_2035: 'Recettes' }],
    ouvertureDeLExercice([], OUVERTURE, 2026), 'tresorerie', MOUVEMENTS,
  )

  it('chaque écriture et chaque solde d’ouverture, avec le libellé que la numérotation lui donne', () => {
    const mouvements = mouvementsDeCloture(numerotation)
    expect(mouvements).toHaveLength(ECRITURES.length + OUVERTURE.length)
    expect(mouvements).toContainEqual({ compte: '101000', compteLib: 'Capital individuel', sens: 'credit', montant: 1600 })
    expect(mouvements).toContainEqual({ compte: '512000', compteLib: 'Banque', sens: 'debit', montant: 3000 })
    expect(mouvements).toContainEqual({ compte: '108000', compteLib: "Compte de l'exploitant", sens: 'debit', montant: 1000 })
  })

  it('le report de l’exercice : le 108 et le résultat passent au capital individuel', () => {
    const report = soldesAReporter(mouvementsDeCloture(numerotation), TRESORERIE, 2026)
    expect(report.soldes).toEqual([
      { compte: '101000', libelle: 'Capital individuel', sens: 'credit', montant: 3360 },
      { compte: '218300', libelle: 'Matériel de bureau et matériel informatique', sens: 'debit', montant: 1200 },
      { compte: '281830', libelle: 'Amortissements du matériel de bureau et matériel informatique', sens: 'credit', montant: 640 },
      { compte: '512000', libelle: 'Banque', sens: 'debit', montant: 2800 },
    ])
    expect(report.resultat).toBe(2760)
    expect(report.ecartCentimes).toBe(0)
  })
})

describe('l’ouverture d’un exercice', () => {
  const repris = (id: string, date: string): ANouveau => ({
    id, dossier_id: 'd1', date, compte: '512000', compte_origine: '512100', libelle: 'Banque', sens: 'debit', montant: 10,
    source_nom: 'balance.csv', source_empreinte: 'a'.repeat(64), created_at: '2025-02-01T08:00:00Z', ...A_NOUVEAU_NON_VALIDE,
  })
  const reporte = (id: string, date: string, o: Partial<SoldeReporte> = {}): SoldeReporte => ({
    id, dossier_id: 'd1', date, compte: '101000', libelle: 'Capital individuel', sens: 'credit', montant: 10,
    source_nom: 'Exercice 2025 validé', source_empreinte: 'b'.repeat(64), created_at: '2026-01-02T08:00:00Z',
    ...A_NOUVEAU_NON_VALIDE, ...o,
  })

  it('la reprise pour l’exercice repris, les soldes reportés pour celui qui suit une validation', () => {
    const reprise = [repris('a1', '2025-01-01')]
    const reportes = [reporte('s1', '2026-01-01'), reporte('s2', '2027-01-01')]
    expect(ouvertureDeLExercice(reprise, reportes, 2025).map((a) => a.id)).toEqual(['a1'])
    expect(ouvertureDeLExercice(reprise, reportes, 2026).map((a) => a.id)).toEqual(['s1'])
    expect(ouvertureDeLExercice(reprise, reportes, 2027).map((a) => a.id)).toEqual(['s2'])
    expect(ouvertureDeLExercice(reprise, reportes, 2028)).toEqual([])
  })

  it('les bornes de l’exercice de la reprise : du 1er janvier au 31 décembre', () => {
    // La base lit la reprise `between` les deux bornes ; une reprise est datée d'un 1er janvier, mais ce filtre ne doit
    // pas en dépendre pour la trouver.
    expect(ouvertureDeLExercice([repris('a1', '2025-12-31')], [], 2025)).toHaveLength(1)
    expect(ouvertureDeLExercice([repris('a1', '2024-12-31')], [], 2025)).toHaveLength(0)
    expect(ouvertureDeLExercice([repris('a1', '2026-01-01')], [], 2025)).toHaveLength(0)
  })

  it('un solde reporté devient un à-nouveau sans numéro d’origine, tout le reste gardé', () => {
    const s = reporte('s1', '2026-01-01', { compte_lib: 'Capital individuel', ecriture_lib: 'À-nouveau Capital individuel' })
    expect(aNouveauDuReport(s)).toEqual({ ...s, compte_origine: null })
  })
})

describe('ce que l’écran dit de l’ouverture', () => {
  const repris = (date: string): ANouveau => ({
    id: 'a1', dossier_id: 'd1', date, compte: '512000', compte_origine: null, libelle: 'Banque', sens: 'debit', montant: 10,
    source_nom: 'balance 2024.csv', source_empreinte: 'a'.repeat(64), created_at: '', ...A_NOUVEAU_NON_VALIDE,
  })
  const reporte = (date: string): SoldeReporte => ({
    id: `s${date}`, dossier_id: 'd1', date, compte: '512000', libelle: 'Banque', sens: 'debit', montant: 10,
    source_nom: 'Exercice validé', source_empreinte: 'b'.repeat(64), created_at: '', ...A_NOUVEAU_NON_VALIDE,
  })
  const vide = { reprise: [], reportes: [], anneesValidees: [], ecritures: [] }

  it('l’exercice repris : sa balance', () => {
    expect(etatDeLOuverture(2025, { ...vide, reprise: [repris('2025-01-01')] }))
      .toEqual({ type: 'reprise', date: '2025-01-01', source: 'balance 2024.csv' })
  })

  it('un exercice antérieur à la reprise : rien à ouvrir, il est dans les comptes repris', () => {
    expect(etatDeLOuverture(2024, { ...vide, reprise: [repris('2025-01-01')], ecritures: [{ date: '2023-05-01' }] }))
      .toEqual({ type: 'sans-objet' })
  })

  it('l’exercice qui suit un exercice validé : ses soldes reportés, même s’il n’y en a aucun', () => {
    expect(etatDeLOuverture(2026, { ...vide, anneesValidees: [2025], reportes: [reporte('2026-01-01'), reporte('2027-01-01')] }))
      .toEqual({ type: 'report', depuis: 2025, lignes: 1 })
    expect(etatDeLOuverture(2026, { ...vide, anneesValidees: [2025] })).toEqual({ type: 'report', depuis: 2025, lignes: 0 })
  })

  it('tant que l’exercice précédent n’est pas validé : en attente de sa validation', () => {
    // Après la reprise.
    expect(etatDeLOuverture(2026, { ...vide, reprise: [repris('2025-01-01')] })).toEqual({ type: 'en-attente', exercice: 2025 })
    // Après une activité dans l'application.
    expect(etatDeLOuverture(2026, { ...vide, ecritures: [{ date: '2025-11-30' }] })).toEqual({ type: 'en-attente', exercice: 2025 })
    // Après un exercice validé, mais pas celui d'avant.
    expect(etatDeLOuverture(2027, { ...vide, anneesValidees: [2025] })).toEqual({ type: 'en-attente', exercice: 2026 })
  })

  it('le premier exercice d’une activité nouvelle n’attend rien', () => {
    expect(etatDeLOuverture(2025, { ...vide, ecritures: [{ date: '2025-03-01' }, { date: '2026-02-01' }] }))
      .toEqual({ type: 'sans-objet' })
    expect(etatDeLOuverture(2025, vide)).toEqual({ type: 'sans-objet' })
  })
})

// UNE CHAÎNE D'EXERCICES, de bout en bout : le report de 2025 — celui que la base écrit, le jumeau le garantit — ouvre le
// FEC, la balance et la piste d'audit de 2026, et le report de 2026 en repart. Un entrepreneur individuel repris au
// 1er janvier 2025, une recette affectée et un prélèvement personnel en 2025, une recette en 2026.
describe('une chaîne d’exercices', () => {
  const ecriture = (id: string, ligne: string, date: string, compte: string, sens: SensEcriture, montant: number): EcritureBrouillon => ({
    id, dossier_id: 'd1', piece_id: null, ligne_bancaire_id: ligne, date, compte, libelle: 'Mouvement', montant, sens,
    statut: 'proposee', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, ...NON_VALIDEE,
    created_at: `${date}T10:00:00Z`,
  })
  const mouvement = (id: string, date: string, montant: number, o: Partial<MouvementBancaire> = {}): MouvementBancaire => ({
    id, date, libelle: 'VIR', libelle_brut: null, montant, statut: 'rapprochee', piece_id: null, cotisation_id: null,
    categorie_id: 'c1', taux_tva: null, prelevement_personnel: false, source_fichier: `releve-${date.slice(0, 4)}.csv`, emprunt_id: null,
    emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
    compte_bilan: null, declaration_tva_id: null, ...o,
  })
  const repris = (id: string, compte: string, libelle: string, sens: SensEcriture, montant: number): ANouveau => ({
    id, dossier_id: 'd1', date: '2025-01-01', compte, compte_origine: compte.slice(0, 3), libelle, sens, montant,
    source_nom: 'balance-2024.csv', source_empreinte: 'a'.repeat(64), created_at: '2025-02-01T08:00:00Z', ...A_NOUVEAU_NON_VALIDE,
  })
  const CATEGORIES = [{ id: 'c1', dossier_id: null, code: 'honoraires', libelle: 'Honoraires', ordre: 1, compte_comptable: '706000', poste_2035: 'Recettes' }]
  const REPRISE = [repris('a1', '512000', 'Banque Populaire', 'debit', 2000), repris('a2', '101000', 'Compte capital', 'credit', 2000)]
  const MOUVEMENTS = [
    mouvement('l1', '2025-03-12', 3000),
    mouvement('l2', '2025-05-02', -1000, { statut: 'ignoree', categorie_id: null, prelevement_personnel: true }),
    mouvement('l3', '2026-02-01', 500),
  ]
  const E2025 = [
    ecriture('e1', 'l1', '2025-03-12', '512000', 'debit', 3000), ecriture('e2', 'l1', '2025-03-12', '706000', 'credit', 3000),
    ecriture('e3', 'l2', '2025-05-02', '108000', 'debit', 1000), ecriture('e4', 'l2', '2025-05-02', '512000', 'credit', 1000),
  ]
  const E2026 = [ecriture('e5', 'l3', '2026-02-01', '512000', 'debit', 500), ecriture('e6', 'l3', '2026-02-01', '706000', 'credit', 500)]

  const report2025 = soldesAReporter(
    mouvementsDeCloture(numeroterFec(E2025, [], CATEGORIES, ouvertureDeLExercice(REPRISE, [], 2025), 'tresorerie', MOUVEMENTS)),
    TRESORERIE, 2025,
  )
  // Ce que `valider_exercice` écrit : ces soldes, datés du 1er janvier 2026, avec l'empreinte de l'exercice 2025.
  const REPORTES: SoldeReporte[] = report2025.soldes.map((s, i) => ({
    id: `s${i + 1}`, dossier_id: 'd1', date: report2025.date, ...s, source_nom: report2025.source,
    source_empreinte: 'c'.repeat(64), created_at: '2027-01-10T08:00:00Z', ...A_NOUVEAU_NON_VALIDE,
  }))
  const OUVERTURE_2026 = ouvertureDeLExercice(REPRISE, REPORTES, 2026)
  const colonnes = (fec: string) => fec.split('\r\n').map((l) => l.split('\t'))

  it('le report de 2025 : la banque, et le capital qui reçoit le 108 et le résultat, sous le libellé que 2025 lui a figé', () => {
    expect(report2025.soldes).toEqual([
      { compte: '101000', libelle: 'Compte capital', sens: 'credit', montant: 4000 },
      { compte: '512000', libelle: 'Banque', sens: 'debit', montant: 4000 },
    ])
    expect(OUVERTURE_2026.map((a) => a.id)).toEqual(['s1', 's2'])
  })

  it('ouvre le FEC de 2026 : journal AN, l’exercice validé pour pièce, au 1er janvier', () => {
    const rows = colonnes(genererFec(E2026, [], CATEGORIES, OUVERTURE_2026, 'tresorerie', MOUVEMENTS, new Map())).slice(1)
    expect(rows.filter((r) => r[0] === 'AN').map((r) => [r[2], r[3], r[4], r[5], r[8], r[9], r[10], r[11], r[12]])).toEqual([
      ['AN00001', '20260101', '101000', 'Compte capital', 'Exercice 2025 validé', '20260101', 'À-nouveau Compte capital', '0,00', '4000,00'],
      ['AN00001', '20260101', '512000', 'Banque', 'Exercice 2025 validé', '20260101', 'À-nouveau Banque', '4000,00', '0,00'],
    ])
    // Le fichier s'équilibre, ouverture comprise.
    const centimes = (champ: string) => Math.round(Number(champ.replace(',', '.')) * 100)
    expect(rows.reduce((solde, r) => solde + centimes(r[11]) - centimes(r[12]), 0)).toBe(0)
  })

  it('se relit telle quelle une fois 2026 validé : les libellés figés sont ceux de la numérotation', () => {
    const n = numeroterFec(E2026, [], CATEGORIES, OUVERTURE_2026, 'tresorerie', MOUVEMENTS)
    const figes = n.aNouveaux.map((a) => ({ ...a.aNouveau, compte_lib: a.compteLib, ecriture_lib: a.ecritureLib }))
    const relus = colonnes(formaterFec(numerotationValidee([], figes, '2027-01-15T10:00:00Z'), new Map())).slice(1)
    expect(relus.map((r) => [r[4], r[5], r[10]])).toEqual([
      ['101000', 'Compte capital', 'À-nouveau Compte capital'], ['512000', 'Banque', 'À-nouveau Banque'],
    ])
  })

  it('ouvre la balance de 2026 ; celle de 2025 part de la reprise', () => {
    expect(calculerBalance(E2026, CATEGORIES, OUVERTURE_2026).map((l) => [l.compte, l.libelle, l.solde])).toEqual([
      ['101000', 'Compte capital', -4000], ['512000', 'Banque', 4500], ['706000', 'Honoraires', -500],
    ])
    expect(calculerBalance(E2025, CATEGORIES, ouvertureDeLExercice(REPRISE, REPORTES, 2025)).find((l) => l.compte === '512000')?.solde).toBe(4000)
  })

  it('justifie l’ouverture de 2026, dans la piste d’audit, par l’exercice validé et son empreinte', () => {
    const lignes = pisteAudit([], [], [], OUVERTURE_2026, { immobilisations: [], factures: [], vehicules: [] })
    expect(lignes.map((l) => [l.compte, l.libelle, l.pieceFichier, l.pieceEmpreinte, l.manque])).toEqual([
      ['101000', 'À-nouveau Compte capital', 'Exercice 2025 validé', 'c'.repeat(64), []],
      ['512000', 'À-nouveau Banque', 'Exercice 2025 validé', 'c'.repeat(64), []],
    ])
  })

  it('le report de 2026 repart de celui de 2025', () => {
    const report2026 = soldesAReporter(
      mouvementsDeCloture(numeroterFec(E2026, [], CATEGORIES, OUVERTURE_2026, 'tresorerie', MOUVEMENTS)), TRESORERIE, 2026,
    )
    expect(report2026.soldes).toEqual([
      { compte: '101000', libelle: 'Compte capital', sens: 'credit', montant: 4500 },
      { compte: '512000', libelle: 'Banque', sens: 'debit', montant: 4500 },
    ])
  })
})

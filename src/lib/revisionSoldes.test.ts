import { describe, expect, it } from 'vitest'
import { calculerBalance } from './ecritures'
import { ouvertureDeLExercice } from './reportDesSoldes'
import {
  BLANCS_D_UN_TEXTE, ETATS_DE_DECISION, LONGUEUR_MAX_MOTIF, LONGUEUR_MAX_PRECISION, MOTIF_COMPTE_DE_BILAN,
  PORTEES_DE_DECISION, refusDeLOuverture, soldeDuCompteCentimes, TAILLE_MAX_PREUVE_APPLICATION,
} from './revisionSoldes'
import type { ANouveau, EcritureBrouillon, SensEcriture, SoldeReporte } from './types'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from '../test/ecritures'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

type Ligne = [date: string, compte: string, sens: SensEcriture, montant: number]

function repeter(n: number, ligne: Ligne): Ligne[] {
  return Array.from({ length: n }, () => ligne)
}

function ecriture(o: Partial<EcritureBrouillon>): EcritureBrouillon {
  return {
    id: 'e', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, date: '2025-01-01', compte: '512000', libelle: 'Ligne',
    montant: 0, sens: 'debit', statut: 'proposee', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null,
    ...NON_VALIDEE, created_at: '2025-01-01T10:00:00Z', ...o,
  }
}
function aNouveau(o: Partial<ANouveau>): ANouveau {
  return {
    id: 'a', dossier_id: 'd1', date: '2025-01-01', compte: '512000', compte_origine: null, libelle: 'Banque', sens: 'debit',
    montant: 0, source_nom: 'balance.csv', source_empreinte: 'a'.repeat(64), created_at: '2025-01-01T10:00:00Z',
    ...A_NOUVEAU_NON_VALIDE, ...o,
  }
}
function soldeReporte(o: Partial<SoldeReporte>): SoldeReporte {
  return {
    id: 's', dossier_id: 'd1', date: '2025-01-01', compte: '512000', libelle: 'Banque', sens: 'debit', montant: 0,
    source_nom: 'Exercice 2024 validé', source_empreinte: 'b'.repeat(64), created_at: '2025-01-01T10:00:00Z',
    compte_lib: null, ecriture_lib: null, ...o,
  }
}

const enEcritures = (ls: readonly Ligne[]) =>
  ls.map(([date, compte, sens, montant], i) => ecriture({ id: `e${i}`, date, compte, sens, montant }))
const enReprise = (ls: readonly Ligne[]) =>
  ls.map(([date, compte, sens, montant], i) => aNouveau({ id: `a${i}`, date, compte, sens, montant }))
const enReportes = (ls: readonly Ligne[]) =>
  ls.map(([date, compte, sens, montant], i) => soldeReporte({ id: `s${i}`, date, compte, sens, montant }))

/** Des centimes, écrits comme la base écrit un `numeric` arrondi au centime : « -12.34 », « 0.00 ». */
function enEuros(centimes: number): string {
  return `${centimes < 0 ? '-' : ''}${(Math.abs(centimes) / 100).toFixed(2)}`
}

interface CasSolde {
  nom: string
  ecritures: Ligne[]
  reprise: Ligne[]
  reportes: Ligne[]
  exercice: number
  compte: string
  solde: string
}
interface CasOuverture {
  nom: string
  reprise: string | null
  validees: number[]
  ecritures: string[]
  exercice: number
  refus: '6' | '7' | 'aucun'
}

// LA TABLE RELEVÉE SUR LA FONCTION DE LA BASE. Chaque cas a été joué le 09/10/2026 par `solde_du_compte` et par
// `justifier_solde` elles-mêmes (supabase/schema/…_revision_des_soldes.sql), sur une réplique locale dont
// `supabase/essais/signature.sql` dit qu'elle EST la production : un dossier jetable par cas, ses lignes écrites en
// décimal, l'appel, et ce que la base a rendu recopié ici tel quel — le solde au centime, le refus de l'ouverture (6, 7,
// ou aucun : la décision s'écrivait). Le jumeau de l'application doit rendre EXACTEMENT la même chose : l'écran montrera
// le solde à justifier, la base le refuserait s'il ne tombait pas juste, et deux calculs qui divergent ne se verraient
// nulle part ailleurs. `supabase/essais/revisionSoldes.sql` éprouve les mêmes fonctions en production.
//
// Les cas couvrent chaque branche : les écritures de l'exercice et ses bornes, un autre compte, la reprise de l'exercice
// ou d'un autre, une reprise en cours d'année, les soldes reportés de l'exercice ou du suivant, le crédit, le compte sans
// ligne, et les montants que la base ne contraint pas au centime — un millième dont le binaire tombe sous le demi-centime
// (1,005 : l'arrondi décimal dirait 1,01), le demi exact, un produit par cent qui retombe sur le demi, une somme
// flottante enregistrée telle quelle, mille centimes, un grand montant.
const SOLDES: CasSolde[] = [
  {
    nom: 'la banque, débits et crédits, des centimes que la virgule flottante somme mal',
    ecritures: [['2025-02-01', '512000', 'debit', 0.1], ['2025-02-02', '512000', 'debit', 0.2], ['2025-02-03', '512000', 'credit', 0.3], ['2025-03-01', '512000', 'debit', 1500.10], ['2025-03-02', '512000', 'credit', 265.55]],
    reprise: [],
    reportes: [],
    exercice: 2025, compte: '512000', solde: '1234.55',
  },
  {
    nom: 'les écritures d’un autre exercice ne comptent pas, ses bornes comprises',
    ecritures: [['2024-12-31', '512000', 'debit', 100], ['2025-01-01', '512000', 'debit', 7], ['2025-12-31', '512000', 'credit', 2], ['2026-01-01', '512000', 'debit', 50]],
    reprise: [],
    reportes: [],
    exercice: 2025, compte: '512000', solde: '5.00',
  },
  {
    nom: 'un autre compte ne compte pas, même voisin',
    ecritures: [['2025-02-01', '512000', 'debit', 10], ['2025-02-01', '512100', 'debit', 99], ['2025-02-01', '401000', 'credit', 109]],
    reprise: [],
    reportes: [],
    exercice: 2025, compte: '512000', solde: '10.00',
  },
  {
    nom: 'la reprise de l’exercice compte',
    ecritures: [['2025-03-01', '512000', 'debit', 100]],
    reprise: [['2025-01-01', '512000', 'debit', 800], ['2025-01-01', '101000', 'credit', 800]],
    reportes: [],
    exercice: 2025, compte: '512000', solde: '900.00',
  },
  {
    nom: 'la reprise d’un exercice antérieur ne compte pas',
    ecritures: [['2025-03-01', '512000', 'debit', 100]],
    reprise: [['2024-01-01', '512000', 'debit', 800], ['2024-01-01', '101000', 'credit', 800]],
    reportes: [],
    exercice: 2025, compte: '512000', solde: '100.00',
  },
  {
    nom: 'une reprise datée en cours d’exercice compte dans cet exercice',
    ecritures: [['2025-09-01', '512000', 'credit', 30]],
    reprise: [['2025-07-01', '512000', 'debit', 45.67], ['2025-07-01', '101000', 'credit', 45.67]],
    reportes: [],
    exercice: 2025, compte: '512000', solde: '15.67',
  },
  {
    nom: 'les soldes reportés au 1er janvier comptent',
    ecritures: [['2025-05-01', '101000', 'credit', 15]],
    reprise: [],
    reportes: [['2025-01-01', '101000', 'credit', 1000], ['2025-01-01', '512000', 'debit', 1000]],
    exercice: 2025, compte: '101000', solde: '-1015.00',
  },
  {
    nom: 'les soldes reportés sur l’exercice suivant ne comptent pas',
    ecritures: [['2025-05-01', '512000', 'debit', 15]],
    reprise: [],
    reportes: [['2026-01-01', '512000', 'debit', 1000], ['2026-01-01', '101000', 'credit', 1000]],
    exercice: 2025, compte: '512000', solde: '15.00',
  },
  {
    nom: 'un compte au crédit',
    ecritures: [['2025-05-01', '401000', 'credit', 12.34], ['2025-05-01', '445660', 'debit', 12.34]],
    reprise: [],
    reportes: [],
    exercice: 2025, compte: '401000', solde: '-12.34',
  },
  {
    nom: 'un compte sans aucune ligne',
    ecritures: [['2025-05-01', '401000', 'credit', 12.34], ['2025-05-01', '445660', 'debit', 12.34]],
    reprise: [],
    reportes: [],
    exercice: 2025, compte: '580000', solde: '0.00',
  },
  {
    nom: '1,005 : son binaire est sous le demi-centime, le produit par cent aussi (100,4999…) — l’arrondi décimal dirait 1,01',
    ecritures: [['2025-06-01', '512000', 'debit', 1.005]],
    reprise: [],
    reportes: [],
    exercice: 2025, compte: '512000', solde: '1.00',
  },
  {
    nom: 'le demi-centime exact : 0,125',
    ecritures: [['2025-06-01', '512000', 'debit', 0.125]],
    reprise: [],
    reportes: [],
    exercice: 2025, compte: '512000', solde: '0.13',
  },
  {
    nom: '2,675 au crédit : son binaire est sous le demi, mais le produit par cent tombe sur 267,5, qui monte',
    ecritures: [['2025-06-01', '512000', 'credit', 2.675]],
    reprise: [],
    reportes: [],
    exercice: 2025, compte: '512000', solde: '-2.68',
  },
  {
    nom: '1,135 : le produit par cent tombe sur 113,5, qui monte',
    ecritures: [['2025-06-01', '512000', 'debit', 1.135]],
    reprise: [],
    reportes: [],
    exercice: 2025, compte: '512000', solde: '1.14',
  },
  {
    nom: 'une somme flottante du navigateur enregistrée telle quelle : 0,30000000000000004',
    ecritures: [['2025-06-01', '512000', 'debit', 0.30000000000000004]],
    reprise: [],
    reportes: [],
    exercice: 2025, compte: '512000', solde: '0.30',
  },
  {
    nom: 'mille lignes d’un centime',
    ecritures: repeter(1000, ['2025-06-01', '512000', 'debit', 0.01]),
    reprise: [],
    reportes: [],
    exercice: 2025, compte: '512000', solde: '10.00',
  },
  {
    nom: 'un grand montant',
    ecritures: [['2025-06-01', '512000', 'debit', 9999999999.99], ['2025-06-02', '512000', 'credit', 0.01]],
    reprise: [],
    reportes: [],
    exercice: 2025, compte: '512000', solde: '9999999999.98',
  },
  {
    nom: 'la reprise et des soldes reportés le même exercice : les deux comptent, comme dans l’ouverture de l’application',
    ecritures: [],
    reprise: [['2025-01-01', '512000', 'debit', 3]],
    reportes: [['2025-01-01', '512000', 'debit', 4]],
    exercice: 2025, compte: '512000', solde: '7.00',
  },
]

const OUVERTURES: CasOuverture[] = [
  { nom: 'rien ne précède l’exercice', reprise: null, validees: [], ecritures: [], exercice: 2025, refus: 'aucun' },
  { nom: 'une écriture de l’exercice précédent, qui n’est pas validé', reprise: null, validees: [], ecritures: ['2024-06-01'], exercice: 2025, refus: '7' },
  { nom: 'une écriture du 1er janvier de l’exercice seulement', reprise: null, validees: [], ecritures: ['2025-01-01'], exercice: 2025, refus: 'aucun' },
  { nom: 'une écriture de l’exercice suivant seulement', reprise: null, validees: [], ecritures: ['2026-02-01'], exercice: 2025, refus: 'aucun' },
  { nom: 'l’exercice de la reprise', reprise: '2025-01-01', validees: [], ecritures: [], exercice: 2025, refus: 'aucun' },
  { nom: 'une reprise datée du 31 décembre de l’exercice', reprise: '2025-12-31', validees: [], ecritures: [], exercice: 2025, refus: 'aucun' },
  { nom: 'une reprise postérieure : l’exercice est dans les comptes repris', reprise: '2026-01-01', validees: [], ecritures: [], exercice: 2025, refus: '6' },
  { nom: 'une reprise antérieure, l’exercice qu’elle ouvre n’étant pas validé', reprise: '2024-01-01', validees: [], ecritures: [], exercice: 2025, refus: '7' },
  { nom: 'une reprise antérieure, l’exercice qu’elle ouvre validé', reprise: '2024-01-01', validees: [2024], ecritures: [], exercice: 2025, refus: 'aucun' },
  { nom: 'l’exercice précédent validé, sans reprise', reprise: null, validees: [2024], ecritures: [], exercice: 2025, refus: 'aucun' },
  { nom: 'un exercice validé plus ancien ne suffit pas', reprise: null, validees: [2023], ecritures: [], exercice: 2025, refus: '7' },
  { nom: 'l’exercice qui suit un exercice validé', reprise: null, validees: [2023], ecritures: [], exercice: 2024, refus: 'aucun' },
  { nom: 'une reprise postérieure et une écriture antérieure : la reprise d’abord', reprise: '2026-01-01', validees: [], ecritures: ['2024-06-01'], exercice: 2025, refus: '6' },
  { nom: 'une écriture antérieure, mais l’exercice précédent validé', reprise: null, validees: [2024], ecritures: ['2023-06-01'], exercice: 2025, refus: 'aucun' },
  { nom: 'deux exercices validés depuis la reprise, le troisième non', reprise: '2022-01-01', validees: [2022, 2023], ecritures: [], exercice: 2025, refus: '7' },
  { nom: 'les écritures de l’exercice seul', reprise: null, validees: [], ecritures: ['2024-03-01', '2024-12-31'], exercice: 2024, refus: 'aucun' },
]

describe('le solde d’un compte, comme la base le vérifie au clic', () => {
  for (const cas of SOLDES) {
    it(cas.nom, () => {
      const centimes = soldeDuCompteCentimes(cas.compte, cas.exercice, {
        ecritures: enEcritures(cas.ecritures), reprise: enReprise(cas.reprise), reportes: enReportes(cas.reportes),
      })
      expect(Number.isInteger(centimes)).toBe(true)
      expect(enEuros(centimes)).toBe(cas.solde)
    })
  }

  it('la balance de l’exercice somme les mêmes lignes : elle ne diffère que de l’arrondi flottant', () => {
    // Le jumeau part des lignes que `calculerBalance` reçoit déjà (lib/ecritures.ts) — les écritures de l'exercice et
    // son ouverture — et ne fait que compter chacune en centimes. Une ligne oubliée ou en trop d'un côté se verrait ici.
    for (const cas of SOLDES) {
      const ecritures = enEcritures(cas.ecritures)
        .filter((e) => e.date >= `${cas.exercice}-01-01` && e.date <= `${cas.exercice}-12-31`)
      const ouverture = ouvertureDeLExercice(enReprise(cas.reprise), enReportes(cas.reportes), cas.exercice)
      const ligne = calculerBalance(ecritures, [], ouverture).find((l) => l.compte === cas.compte)
      const centimes = soldeDuCompteCentimes(cas.compte, cas.exercice, {
        ecritures: enEcritures(cas.ecritures), reprise: enReprise(cas.reprise), reportes: enReportes(cas.reportes),
      })
      expect(Math.abs((ligne?.solde ?? 0) * 100 - centimes), cas.nom).toBeLessThan(1)
    }
  })

  it('une écriture validée compte comme une écriture proposée : la base ne lit pas le statut', () => {
    const lignes = [ecriture({ date: '2025-03-01', montant: 10 }), ecriture({ date: '2025-03-02', montant: 5, statut: 'validee' })]
    expect(soldeDuCompteCentimes('512000', 2025, { ecritures: lignes, reprise: [], reportes: [] })).toBe(1500)
  })
})

describe('l’ouverture de l’exercice, comme la base la juge avant de laisser justifier un solde', () => {
  for (const cas of OUVERTURES) {
    it(cas.nom, () => {
      const refus = refusDeLOuverture(cas.exercice, {
        reprise: cas.reprise === null ? [] : enReprise([[cas.reprise, '512000', 'debit', 2], [cas.reprise, '101000', 'credit', 2]]),
        reportes: [],
        anneesValidees: cas.validees,
        ecritures: cas.ecritures.flatMap((date, i) =>
          enEcritures([[date, '512000', 'debit', 1], [date, '706000', 'credit', 1]]).map((e) => ({ ...e, id: `${e.id}-${i}` }))),
      })
      expect(refus === 'anterieur-a-la-reprise' ? '6' : refus === 'en-attente' ? '7' : 'aucun').toBe(cas.refus)
    })
  }
})

// LES LITTÉRAUX DE LA MIGRATION. Les tables ci-dessus prouvent que les deux calculs s'accordent sur des cas ; ceci garde
// que les MOTS soient les mêmes — un motif, un état ou une borne changés d'un seul côté, dans la migration suivante, ne
// feraient échouer les tables qu'au prochain relevé. On lit la DERNIÈRE définition de chaque fonction exportée, celle que
// la base exécute, et la migration qui crée les tables.
describe('les littéraux sont ceux de la base', () => {
  const sansApostrophes = (s: string) => s.replace(/''/g, "'")
  const migration = fichiersDuSchema().find((f) => f.texte.includes('create table public.revision_justifications ('))?.texte ?? ''
  const blancs = `E'${BLANCS_D_UN_TEXTE.replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`

  it('la migration est dans l’export', () => {
    expect(migration).not.toBe('')
  })

  it('les comptes de bilan, les états, les portées : dans la table et dans la fonction', () => {
    const fonction = sansApostrophes(derniereDefinitionSql('justifier_solde'))
    expect(migration).toContain(`check (compte ~ '${MOTIF_COMPTE_DE_BILAN.source}')`)
    expect(fonction).toContain(`p_compte !~ '${MOTIF_COMPTE_DE_BILAN.source}'`)
    const liste = (valeurs: readonly string[]) => `(${valeurs.map((v) => `'${v}'`).join(', ')})`
    expect(migration).toContain(`check (etat in ${liste(ETATS_DE_DECISION)})`)
    expect(fonction).toContain(`p_etat not in ${liste(ETATS_DE_DECISION)}`)
    expect(migration).toContain(`check (portee in ${liste(PORTEES_DE_DECISION)})`)
    expect(fonction).toContain(`p_portee not in ${liste(PORTEES_DE_DECISION)}`)
  })

  it('les blancs et les longueurs : dans la table et dans la fonction', () => {
    const fonction = derniereDefinitionSql('justifier_solde')
    expect(migration).toContain(`check (btrim(motif, ${blancs}) <> '' and length(motif) <= ${LONGUEUR_MAX_MOTIF})`)
    expect(fonction).toContain(`btrim(p_motif, ${blancs}) = ''`)
    expect(fonction).toContain(`length(p_motif) > ${LONGUEUR_MAX_MOTIF}`)
    expect(migration).toContain(`check (btrim(precision, ${blancs}) <> '' and length(precision) <= ${LONGUEUR_MAX_PRECISION})`)
    expect(fonction).toContain(`length(e.v ->> 'precision') > ${LONGUEUR_MAX_PRECISION}`)
    expect(migration).toContain(`octet_length(preuve_application::text) <= ${TAILLE_MAX_PREUVE_APPLICATION}`)
    expect(fonction).toContain(`octet_length(v_preuve_application::text) > ${TAILLE_MAX_PREUVE_APPLICATION}`)
  })

  it('le solde compte chaque ligne comme Math.round(montant × 100), sur le binaire que lit le navigateur', () => {
    const solde = derniereDefinitionSql('solde_du_compte')
    expect(solde).toContain('floor(m.montant::double precision * 100::double precision)')
    expect(solde).toContain('>= 0.5::double precision')
    expect(solde).toContain("e.date between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31)")
    expect(solde).toContain("a.date between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31)")
    expect(solde).toContain('s.date = make_date(p_annee, 1, 1)')
  })

  it('l’ouverture : la reprise, l’exercice précédent validé, ce qui le précède', () => {
    const fonction = derniereDefinitionSql('justifier_solde')
    expect(fonction).toContain('make_date(p_annee, 12, 31) < v_reprise')
    expect(fonction).toContain('extract(year from v_reprise)::integer <> p_annee')
    expect(fonction).toContain('v.annee = p_annee - 1')
    expect(fonction).toContain('v.annee < p_annee')
    expect(fonction).toContain('e.date < make_date(p_annee, 1, 1)')
  })
})

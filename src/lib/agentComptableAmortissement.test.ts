import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  acquisitionsDesBiens, bienRepris, compteAmortissement, dotationAEcrire, dotationDeLExercice, dotationsDuRegistre, dotationsEnDefaut, rang360,
  type AcquisitionDuBien,
} from './amortissements'
import type { EcritureBrouillon, Immobilisation, NatureImmobilisation } from './types'
import { NON_VALIDEE } from '../test/ecritures'

// L'ASSISTANT RECOPIE CE QUE LA CHECKLIST DIT DES DOTATIONS AUX AMORTISSEMENTS (01/10/2026, ligne 26.6, étape b).
//
// La Checklist réclame la dotation d'un exercice fini qui n'est pas écrite, et toute dotation écrite qui ne
// suit plus le registre. `agent-comptable` est auto-portée : elle recopie le calcul de la base — prorata
// temporis depuis la mise en service, le cumul arrondi au centime, en entiers — et l'état de chaque dotation
// entre les bornes `── DÉBUT/FIN AMORTISSEMENT`, et ce test les compare à `src/lib` sur une batterie commune —
// la forme de garde des blocs COTISATION, EMPRUNT et VENTILATION : extraire, transpiler, exécuter, comparer à
// une référence EXTÉRIEURE à la copie, et planter des dérives dans la vraie source pour prouver qu'il sait
// encore échouer.
//
// CE QU'UNE DÉRIVE COÛTERAIT : l'assistant répondrait « rien à signaler » sur un dossier dont le FEC n'a
// aucune dotation pendant que la 2035 en compte une en case CH — en français, à un comptable qui n'ira pas
// vérifier — ou réclamerait une dotation déjà écrite, juste au centime.

function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
}

type Bien = Pick<Immobilisation, 'valeur' | 'duree_annees' | 'date_acquisition' | 'date_mise_en_service'>
type Dotation = { immobilisation: { id: string }; annee: number; montant: number; etat: string; figee: boolean }
interface Copie {
  rang360: (date: string) => number
  dotationDeLExercice: (bien: Bien, annee: number) => number
  compteAmortissement: (compte: string) => string
  dotationAEcrire: (bien: Bien, annee: number, ouverture: string | null) => number
  dotationsDuRegistre: (
    immobilisations: Immobilisation[], natures: NatureImmobilisation[], ecritures: EcritureBrouillon[], ouverture: string | null, anneeCourante: number,
    frontiere: string | null,
  ) => Dotation[]
  dotationsEnDefaut: (dotations: Dotation[], anneeCourante: number) => Dotation[]
  bienRepris: (bien: Pick<Immobilisation, 'date_acquisition'>, ouverture: string | null) => boolean
  acquisitionsDesBiens: (immobilisations: Immobilisation[], natures: NatureImmobilisation[], ouverture: string | null) => Map<string, AcquisitionDuBien>
}

// Le bloc AMORTISSEMENT ne lit de la fonction que `estFigee`, du bloc VALIDATION (la frontière des exercices
// validés), repris de la MÊME source.
function extraire(source: string): Copie {
  const debut = source.indexOf('// ── DÉBUT AMORTISSEMENT')
  const fin = source.indexOf('// ── FIN AMORTISSEMENT')
  expect(debut, 'bornes du bloc AMORTISSEMENT introuvables — garde-fou à remettre à jour').toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  const debutValidation = source.indexOf('// ── DÉBUT VALIDATION')
  const finValidation = source.indexOf('// ── FIN VALIDATION')
  expect(debutValidation, 'bornes du bloc VALIDATION introuvables — garde-fou à remettre à jour').toBeGreaterThan(-1)
  expect(finValidation).toBeGreaterThan(debutValidation)
  const bloc = `${source.slice(debutValidation, finValidation)}\n${source.slice(debut, fin)}`
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { rang360, dotationDeLExercice, compteAmortissement, dotationAEcrire, dotationsDuRegistre, dotationsEnDefaut, bienRepris, acquisitionsDesBiens }`)() as Copie
}

const deployee = extraire(sourceDeployee())

const bien = (o: Partial<Immobilisation> = {}): Immobilisation => ({
  id: 'b', dossier_id: 'd', piece_id: 'p', nature_id: 'n-info', libelle: 'Ordinateur', valeur: 1200,
  date_acquisition: '2025-07-01', date_mise_en_service: null, duree_annees: 3, created_at: '2025-07-02T09:00:00Z', ...o,
})

// Les bornes qui comptent : un 31 compté comme un 30, le 28 et le 29 février, le 1er janvier et le 31 décembre,
// une mise en service qui n'est pas l'acquisition, des valeurs dont le cumul tombe sur un demi-centime.
const BIENS: Immobilisation[] = [
  bien({ id: 'b1' }),
  bien({ id: 'b2', valeur: 1000, duree_annees: 3 }),
  bien({ id: 'b3', valeur: 999.99, date_acquisition: '2024-01-31', duree_annees: 5 }),
  bien({ id: 'b4', valeur: 12000, date_acquisition: '2025-02-28', duree_annees: 5 }),
  bien({ id: 'b5', valeur: 7, date_acquisition: '2024-02-29', duree_annees: 7 }),
  bien({ id: 'b6', valeur: 0.07, date_acquisition: '2025-12-31', duree_annees: 2 }),
  bien({ id: 'b7', valeur: 1500.5, date_acquisition: '2023-01-01', duree_annees: 1 }),
  bien({ id: 'b8', valeur: 3333.33, date_acquisition: '2025-03-10', date_mise_en_service: '2025-10-15', duree_annees: 10 }),
  bien({ id: 'b9', valeur: 2500, date_acquisition: '2025-08-31', date_mise_en_service: '2025-08-31', duree_annees: 4 }),
]

const NATURES: NatureImmobilisation[] = [
  { id: 'n-info', dossier_id: null, libelle: 'Matériel informatique', duree_annees_defaut: 3, ordre: 1, compte_immobilisation: '218300' },
  { id: 'n-fauteuil', dossier_id: 'd', libelle: 'Fauteuil de soins', duree_annees_defaut: 10, ordre: 2, compte_immobilisation: '215400' },
]

// Une dotation écrite telle que la base l'écrit, au 31 décembre.
function ecrite(id: string, annee: number, montant: number, o: Partial<EcritureBrouillon> = {}): EcritureBrouillon[] {
  const base = {
    dossier_id: 'd', piece_id: null, ligne_bancaire_id: null, date: `${annee}-12-31`, libelle: `Dotation ${annee}`, montant,
    statut: 'proposee' as const, immobilisation_id: id, vehicule_id: null, ...NON_VALIDEE, created_at: '2026-01-02T09:00:00Z',
  }
  return [
    { ...base, id: `${id}-${annee}-d`, compte: '681100', sens: 'debit', ...o },
    { ...base, id: `${id}-${annee}-c`, compte: '281830', sens: 'credit', ...o },
  ]
}

// Un registre où chaque état se rencontre : écrite, à écrire, à réécrire (au centime près), validée qui
// diverge, à retirer (mise en service repoussée), sans nature, et un bien d'une autre nature.
const REGISTRE: Immobilisation[] = [
  bien({ id: 'r-ecrite' }),
  bien({ id: 'r-centime' }),
  bien({ id: 'r-validee' }),
  bien({ id: 'r-repoussee', date_mise_en_service: '2026-03-01' }),
  bien({ id: 'r-sans-nature', nature_id: null }),
  bien({ id: 'r-fauteuil', nature_id: 'n-fauteuil', valeur: 4800, duree_annees: 10, date_acquisition: '2024-05-15' }),
  bien({ id: 'r-ancien', valeur: 900, duree_annees: 3, date_acquisition: '2021-01-01' }),
]
const ECRITURES: EcritureBrouillon[] = [
  ...ecrite('r-ecrite', 2025, 200),
  ...ecrite('r-centime', 2025, 200.01),
  ...ecrite('r-validee', 2025, 400, { statut: 'validee' }),
  ...ecrite('r-repoussee', 2025, 200),
  ...ecrite('r-ancien', 2023, 300),
]

const etats = (d: Dotation[]) => d.map((x) => [x.immobilisation.id, x.annee, x.montant, x.etat, x.figee])
// Les frontières de validation sous lesquelles les deux copies sont comparées : aucune, puis 2024 et 2025 validés.
const FRONTIERES = [null, '2024-12-31', '2025-12-31'] as const

describe('agent-comptable / bloc AMORTISSEMENT (copie déployée)', () => {
  it('n’est pas la fonction de src/lib elle-même', () => {
    // Sans ce garde, comparer la copie à src/lib pourrait comparer src/lib à elle-même.
    expect(deployee.dotationDeLExercice).not.toBe(dotationDeLExercice)
  })

  it('rend le même rang et la même dotation de chaque exercice, au centime', () => {
    for (const date of ['2025-01-01', '2025-01-31', '2025-02-28', '2024-02-29', '2025-03-01', '2025-12-31', '2026-07-15']) {
      expect(deployee.rang360(date), date).toBe(rang360(date))
    }
    for (const b of BIENS) {
      const premiere = Number(b.date_acquisition.slice(0, 4))
      for (let annee = premiere - 1; annee <= premiere + b.duree_annees + 1; annee++) {
        expect(deployee.dotationDeLExercice(b, annee), `${b.id} ${annee}`).toBe(dotationDeLExercice(b, annee))
      }
    }
  })

  it('tire le même compte d’amortissement du compte d’immobilisation', () => {
    for (const compte of ['218300', '215400', '205000', '211000', '213100', '218400']) {
      expect(deployee.compteAmortissement(compte), compte).toBe(compteAmortissement(compte))
    }
  })

  it('n’écrit rien avant l’ouverture d’un dossier repris, comme src/lib', () => {
    for (const ouverture of [null, '2025-01-01', '2026-01-01']) {
      for (const annee of [2024, 2025, 2026]) {
        expect(deployee.dotationAEcrire(BIENS[0], annee, ouverture), `${annee} / ${ouverture}`).toBe(dotationAEcrire(BIENS[0], annee, ouverture))
      }
    }
  })

  it('rend les mêmes dotations du registre, dans le même état, et réclame les mêmes', () => {
    for (const ouverture of [null, '2026-01-01']) {
      for (const anneeCourante of [2025, 2026, 2027]) {
        for (const f of FRONTIERES) {
          const attendu = dotationsDuRegistre(REGISTRE, NATURES, ECRITURES, ouverture, anneeCourante, f)
          const copie = deployee.dotationsDuRegistre(REGISTRE, NATURES, ECRITURES, ouverture, anneeCourante, f)
          expect(etats(copie), `${ouverture} / ${anneeCourante} / ${f}`).toEqual(etats(attendu))
          expect(etats(deployee.dotationsEnDefaut(copie, anneeCourante)), `${ouverture} / ${anneeCourante} / ${f}`)
            .toEqual(etats(dotationsEnDefaut(attendu, anneeCourante)))
        }
      }
    }
    // Et la frontière décide : un exercice validé ne réclame plus sa dotation, même validée et divergente.
    const reclamees = (f: string | null) => etats(dotationsEnDefaut(dotationsDuRegistre(REGISTRE, NATURES, ECRITURES, null, 2026, f), 2026))
    expect(reclamees(null).some(([, annee]) => annee === 2025)).toBe(true)
    expect(reclamees('2025-12-31').some(([, annee]) => (annee as number) <= 2025)).toBe(false)
    // Et le registre exerce bien chaque état : sans quoi l'égalité ci-dessus ne prouverait rien de lui.
    const tous = new Set(dotationsDuRegistre(REGISTRE, NATURES, ECRITURES, null, 2026, null).map((d) => d.etat))
    expect([...tous].sort()).toEqual(['a_ecrire', 'a_reecrire', 'a_retirer', 'ecrite', 'validee'])
  })

  // L'ÉCRITURE D'ACQUISITION : la facture d'un bien s'écrit sur le compte de sa nature — ou rien. Un bien d'une
  // nature partagée, d'une nature du dossier, sans nature, d'une nature inconnue, sans facture, et, pour un
  // dossier repris, acquis la veille de l'ouverture, le jour même, et longtemps avant sans nature.
  it('rend la même acquisition de chaque bien, avec ou sans ouverture', () => {
    const apres = '2026-03-01'
    const biens = [
      bien({ id: 'b1', piece_id: 'p1', date_acquisition: apres }),
      bien({ id: 'b2', piece_id: 'p2', nature_id: 'n-fauteuil', date_acquisition: apres }),
      bien({ id: 'b3', piece_id: 'p3', nature_id: null, date_acquisition: apres }),
      bien({ id: 'b4', piece_id: 'p4', nature_id: 'n-inconnue', date_acquisition: apres }),
      bien({ id: 'b5', piece_id: null }),
      bien({ id: 'b6', piece_id: 'p6', date_acquisition: '2025-12-31' }),
      bien({ id: 'b7', piece_id: 'p7', date_acquisition: '2026-01-01' }),
      bien({ id: 'b8', piece_id: 'p8', date_acquisition: '2019-06-01', nature_id: null }),
    ]
    for (const ouverture of [null, '2026-01-01']) {
      const attendu = acquisitionsDesBiens(biens, NATURES, ouverture)
      expect([...deployee.acquisitionsDesBiens(biens, NATURES, ouverture)], String(ouverture)).toEqual([...attendu])
    }
    // Et la batterie exerce bien chaque cas : sans quoi l'égalité ne prouverait rien.
    const motifs = [...acquisitionsDesBiens(biens, NATURES, '2026-01-01')].map(([p, a]) => [p, a.compte ?? a.motif])
    expect(motifs).toEqual([
      ['p1', '218300'], ['p2', '215400'], ['p3', 'sans_nature'], ['p4', 'sans_nature'],
      ['p6', 'repris'], ['p7', '218300'], ['p8', 'repris'],
    ])
    expect(deployee.bienRepris(bien({ date_acquisition: '2025-12-31' }), '2026-01-01')).toBe(bienRepris(bien({ date_acquisition: '2025-12-31' }), '2026-01-01'))
  })
})

describe('agent-comptable / points_a_traiter lit le registre et ses dotations', () => {
  const source = sourceDeployee()
  const corps = source.slice(source.indexOf('if (nom === "points_a_traiter")'), source.indexOf('return { erreur: `Outil inconnu'))

  it('lit le registre, les natures, les dotations écrites et l’ouverture, sous le même refus de lecture partielle', () => {
    expect(corps).toMatch(/from\("immobilisations"\)\.select\("id, piece_id, nature_id, libelle, valeur, date_acquisition, date_mise_en_service, duree_annees"[^)]*\)\.eq\("dossier_id", dossierId\)\.order\("id"\)/)
    // Celles du cabinet comprises, comme les catégories : sinon un bien d'une nature partagée paraîtrait sans nature.
    expect(corps).toMatch(/from\("natures_immobilisation"\)\.select\("id, compte_immobilisation"[^)]*\)\.or\(`dossier_id\.eq\.\$\{dossierId\},dossier_id\.is\.null`\)\.order\("id"\)/)
    expect(corps).toMatch(/from\("ecritures_brouillon"\)\.select\("date, compte, libelle, sens, montant, piece_id, ligne_bancaire_id, statut, immobilisation_id[,"]/)
    expect(corps).toMatch(/from\("a_nouveaux"\)\.select\("id, date"[^)]*\)\.eq\("dossier_id", dossierId\)\.order\("date"\)\.order\("id"\)/)
    expect(corps).toMatch(/rReglements, rCotisations, rNatures, rANouveaux, rVehicules, rValides, rLettrages\]\s*\.filter\(\(r\) => !r\.complete\)/)
  })

  it('rend le point de la Checklist, l’exercice en cours lu dans le fuseau du cabinet', () => {
    expect(corps).toContain('const anneeCourante = Number(aujourdHuiCabinet().slice(0, 4))')
    expect(corps).toContain('const ouverture = rANouveaux.lignes[0]?.date ?? null')
    expect(corps).toMatch(/dotationsEnDefaut\(\s*dotationsDuRegistre\(rImmobilisations\.lignes, rNatures\.lignes, ecrituresTyped, ouverture, anneeCourante, frontiere\),\s*anneeCourante,\s*\)/)
    expect(corps).toMatch(/dotations_aux_amortissements_a_ecrire_ou_qui_ne_suivent_plus_le_registre: dotationsManquantes\.length/)
  })

  // L'ACQUISITION : sans cette phrase, le modèle prendrait la facture d'un bien sur un compte de classe 2 — ou
  // celle d'un bien repris, qui ne s'écrit pas du tout — pour une anomalie à signaler.
  it('dit au modèle où s’écrit la facture d’un bien, et que celle d’un bien repris ne s’écrit pas', () => {
    expect(source).toMatch(/La facture d'un BIEN IMMOBILISÉ[^\n]*s'écrit sur le compte d'immobilisation de sa nature[^\n]*sa TVA au 445620[^\n]*Celle d'un bien acquis avant l'ouverture d'un dossier repris ne s'écrit pas : la balance reprise porte déjà sa valeur\. Rien de cela n'est une anomalie\./)
    expect(source).toMatch(/401000 Fournisseurs \(404000 Fournisseurs d'immobilisations pour celle d'un bien\)/)
  })

  it('dit au modèle qu’une dotation s’écrit sans pièce, au 31 décembre, et l’annonce dans l’outil', () => {
    expect(source).toMatch(/Une DOTATION AUX AMORTISSEMENTS s'écrit au 31 décembre de son exercice, sans pièce ni mouvement : le 681100 au débit, le compte d'amortissement du bien \(28…\) au crédit[^\n]*Ce n'est pas une anomalie\./)
    expect(source).toMatch(/dotations aux amortissements à écrire \(exercice fini\) ou qui ne suivent plus le registre/)
  })
})

describe('le garde-fou du bloc AMORTISSEMENT sait encore échouer', () => {
  const planter = (...remplacements: [string, string][]) => {
    let source = sourceDeployee()
    for (const [avant, apres] of remplacements) {
      expect(source.split(avant).length - 1, `motif à planter introuvable ou ambigu : ${avant}`).toBe(1)
      source = source.replace(avant, apres)
    }
    return extraire(source)
  }
  // Une dérive doit faire échouer une ASSERTION, pas lever pour une autre raison (voir le bloc EMPRUNT).
  const echoue = (f: () => void) => {
    let erreur: unknown = null
    try { f() } catch (e) { erreur = e }
    expect((erreur as Error | null)?.name, `la dérive n'a pas fait échouer une assertion : ${String(erreur)}`).toBe('AssertionError')
  }
  const memesDotations = (copie: Copie) => {
    for (const b of BIENS) {
      const premiere = Number(b.date_acquisition.slice(0, 4))
      for (let annee = premiere; annee <= premiere + b.duree_annees; annee++) {
        expect(copie.dotationDeLExercice(b, annee), `${b.id} ${annee}`).toBe(dotationDeLExercice(b, annee))
      }
    }
  }
  const memeRegistre = (copie: Copie, anneeCourante = 2026, ouverture: string | null = null, frontiere: string | null = null) => {
    const attendu = dotationsDuRegistre(REGISTRE, NATURES, ECRITURES, ouverture, anneeCourante, frontiere)
    const rendu = copie.dotationsDuRegistre(REGISTRE, NATURES, ECRITURES, ouverture, anneeCourante, frontiere)
    expect(etats(rendu)).toEqual(etats(attendu))
    expect(etats(copie.dotationsEnDefaut(rendu, anneeCourante))).toEqual(etats(dotationsEnDefaut(attendu, anneeCourante)))
  }

  it('attrape un bien sans nature à qui l’on prêterait un compte', () => {
    const derivee = planter(['(bien.nature_id ? compteParNature.get(bien.nature_id) : undefined) ?? null', 'compteParNature.get(bien.nature_id ?? \'\') ?? "218000"'])
    const biens = [bien({ id: 'b3', piece_id: 'p3', nature_id: null })]
    echoue(() => expect([...derivee.acquisitionsDesBiens(biens, NATURES, null)]).toEqual([...acquisitionsDesBiens(biens, NATURES, null)]))
  })

  it('attrape l’acquisition d’un bien repris qu’on écrirait encore', () => {
    const derivee = planter(['    if (bienRepris(bien, ouverture)) {\n      acquisitions.set(bien.piece_id, { compte: null, motif: "repris" })\n      continue\n    }\n', ''])
    const biens = [bien({ id: 'b6', piece_id: 'p6', date_acquisition: '2025-12-31' })]
    echoue(() => expect([...derivee.acquisitionsDesBiens(biens, NATURES, '2026-01-01')]).toEqual([...acquisitionsDesBiens(biens, NATURES, '2026-01-01')]))
  })

  it('attrape un bien acquis le jour de l’ouverture qu’on tiendrait pour repris', () => {
    const derivee = planter(['  return ouverture != null && bien.date_acquisition < ouverture', '  return ouverture != null && bien.date_acquisition <= ouverture'])
    const biens = [bien({ id: 'b7', piece_id: 'p7', date_acquisition: '2026-01-01' })]
    echoue(() => expect([...derivee.acquisitionsDesBiens(biens, NATURES, '2026-01-01')]).toEqual([...acquisitionsDesBiens(biens, NATURES, '2026-01-01')]))
  })

  it('attrape une annuité arrondie vers le bas au lieu du demi-centime vers le haut', () => {
    const derivee = planter(['(2n * BigInt(Math.round(bien.valeur * 100)) * jours + 360n * duree) / (720n * duree)', '(BigInt(Math.round(bien.valeur * 100)) * jours) / (360n * duree)'])
    echoue(() => memesDotations(derivee))
  })

  it('attrape un 31 compté comme un 31', () => {
    const derivee = planter(['Math.min(Number(date.slice(8, 10)), 30) - 1', 'Number(date.slice(8, 10)) - 1'])
    echoue(() => memesDotations(derivee))
  })

  it('attrape une mise en service ignorée', () => {
    const derivee = planter(['  return bien.date_mise_en_service ?? bien.date_acquisition\n}\n\n// Le rang d\'un jour en mois de trente jours, le 31 compté comme le 30 — `rang_360` en base.\nfunction rang360', '  return bien.date_acquisition\n}\n\n// Le rang d\'un jour en mois de trente jours, le 31 compté comme le 30 — `rang_360` en base.\nfunction rang360'])
    echoue(() => memesDotations(derivee))
  })

  it('attrape un compte d’amortissement décalé d’un chiffre', () => {
    const derivee = planter(['  return `28${compteImmobilisation.slice(1, 5)}`\n}\n\nconst dateDeLaDotation', '  return `28${compteImmobilisation.slice(2, 6)}`\n}\n\nconst dateDeLaDotation'])
    echoue(() => expect(derivee.compteAmortissement('218300')).toBe(compteAmortissement('218300')))
    // Et le registre le voit : une dotation écrite sur le bon compte n'y serait plus conforme.
    echoue(() => memeRegistre(derivee))
  })

  it('attrape un exercice repris dans les à-nouveaux dont la dotation serait réclamée', () => {
    const derivee = planter(['  if (ouverture && dateDeLaDotation(annee) < ouverture) return 0\n  return dotationDeLExercice(bien, annee)', '  return dotationDeLExercice(bien, annee)'])
    echoue(() => memeRegistre(derivee, 2026, '2026-01-01'))
  })

  it('attrape la dotation de l’exercice en cours réclamée', () => {
    const derivee = planter(['(d.etat !== "a_ecrire" || d.annee < anneeCourante)', '(d.etat !== "a_ecrire" || d.annee <= anneeCourante)'])
    echoue(() => memeRegistre(derivee))
  })

  it('attrape une dotation validée qu’on proposerait de réécrire', () => {
    const derivee = planter(['      else if (presentes.some((e) => e.statut !== "proposee")) etat = "validee"\n', ''])
    echoue(() => memeRegistre(derivee))
  })

  it('attrape une conformité qui tolérerait un centime', () => {
    // Le motif porte la date de la DOTATION : le bloc FORFAIT a la même comparaison au centime, sur la sienne.
    const derivee = planter(['e.date === dateDeLaDotation(annee)\n      && Math.round(e.montant * 100) === Math.round(a.montant * 100))', 'e.date === dateDeLaDotation(annee)\n      && Math.abs(e.montant - a.montant) < 0.05)'])
    echoue(() => memeRegistre(derivee))
  })

  // LA FRONTIÈRE DE VALIDATION : un exercice validé ne réclame plus sa dotation.
  it('attrape une dotation figée réclamée', () => {
    const derivee = planter(['dotations.filter((d) => !d.figee && d.etat !== "ecrite"', 'dotations.filter((d) => d.etat !== "ecrite"'])
    echoue(() => memeRegistre(derivee, 2026, null, '2025-12-31'))
  })

  it('attrape une dotation jamais figée', () => {
    const derivee = planter(['figee: estFigee(dateDeLaDotation(annee), frontiere) })', 'figee: false })'])
    echoue(() => memeRegistre(derivee, 2026, null, '2025-12-31'))
  })

  it('attrape une dotation écrite hors des exercices du calcul, qu’on ne verrait plus', () => {
    const derivee = planter(['    for (const e of sesEcritures) annees.add(Number(e.date.slice(0, 4)))\n', ''])
    echoue(() => memeRegistre(derivee))
  })
})

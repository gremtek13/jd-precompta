import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { indemniteKilometriqueCentimes, vehiculeDuDossier } from './baremeKilometrique'
import type { ModeleComptable } from './engagement'
import { ecritureDuForfait, forfaitsDuCadre7, forfaitsEnDefaut, nomDuVehicule } from './forfaitKilometrique'
import type { EcritureBrouillon, VehiculeDossier } from './types'
import { NON_VALIDEE } from '../test/ecritures'

// L'ASSISTANT RECOPIE CE QUE LA CHECKLIST DIT DES FORFAITS KILOMÉTRIQUES (04/10/2026, ligne 26.6, étape b).
//
// La Checklist réclame le forfait d'un exercice fini qui n'est pas écrit, et tout forfait écrit qui ne suit
// plus le cadre 7. `agent-comptable` est auto-portée : elle recopie le barème, son calcul en centimes entiers
// et l'état de chaque ligne du cadre 7 entre les bornes `── DÉBUT/FIN FORFAIT`, et ce test les compare à
// `src/lib` sur une batterie commune — la forme de garde des blocs AMORTISSEMENT et COTISATION : extraire,
// transpiler, exécuter, comparer à une référence EXTÉRIEURE à la copie, et planter des dérives dans la vraie
// source pour prouver qu'il sait encore échouer.
//
// CE QU'UNE DÉRIVE COÛTERAIT : l'assistant répondrait « rien à signaler » sur un dossier dont le FEC n'a aucun
// forfait pendant que la 2035 en compte un en case BJ — en français, à un comptable qui n'ira pas vérifier —,
// ou réclamerait un forfait déjà écrit, juste au centime.

function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
}

type Vehicule = Pick<VehiculeDossier, 'type' | 'puissance_fiscale' | 'motorisation' | 'km_professionnel'>
type Ligne = { compte: string; sens: 'debit' | 'credit'; montant: number; libelle: string }
type Forfait = { vehicule: { id: string; annee: number }; etat: string }
interface Copie {
  indemniteKilometriqueCentimes: (v: Vehicule, annee: number) => bigint | null
  nomDuVehicule: (v: Pick<VehiculeDossier, 'modele' | 'type' | 'puissance_fiscale' | 'motorisation'>) => string
  ecritureDuForfait: (v: VehiculeDossier, modele: ModeleComptable, ouverture: string | null) => Ligne[] | null
  forfaitsDuCadre7: (vehicules: VehiculeDossier[], ecritures: EcritureBrouillon[], modele: ModeleComptable, ouverture: string | null) => Forfait[]
  forfaitsEnDefaut: (forfaits: Forfait[], anneeCourante: number) => Forfait[]
}

// Le bloc FORFAIT lit le compte du dirigeant dans le bloc AFFECTATION (`compteDuDirigeant`), qui lit lui-même
// `COMPTE_BANQUE` — la forme d'extraction du bloc COTISATION.
function extraire(source: string): Copie {
  const bornes = (nom: string) => {
    const debut = source.indexOf(`// ── DÉBUT ${nom}`)
    const fin = source.indexOf(`// ── FIN ${nom}`)
    expect(debut, `bornes du bloc ${nom} introuvables — garde-fou à remettre à jour`).toBeGreaterThan(-1)
    expect(fin).toBeGreaterThan(debut)
    return source.slice(debut, fin)
  }
  const banque = /const COMPTE_BANQUE = "(\d+)"/.exec(source)
  expect(banque, '`COMPTE_BANQUE` introuvable dans la source').not.toBeNull()
  // Le compte de l'exploitant vit avec les comptes de la copie de src/lib/ecritures.ts, qui l'emploie la première.
  const exploitant = /const COMPTE_EXPLOITANT = "(\d+)"/.exec(source)
  expect(exploitant, '`COMPTE_EXPLOITANT` introuvable dans la source').not.toBeNull()
  const bloc = `const COMPTE_BANQUE = "${banque![1]}"\nconst COMPTE_EXPLOITANT = "${exploitant![1]}"\n${bornes('AFFECTATION')}\n${bornes('FORFAIT')}`
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { indemniteKilometriqueCentimes, nomDuVehicule, ecritureDuForfait, forfaitsDuCadre7, forfaitsEnDefaut }`)() as Copie
}

const deployee = extraire(sourceDeployee())

const vehicule = (o: Partial<VehiculeDossier> = {}): VehiculeDossier => ({
  id: 'v', dossier_id: 'd', annee: 2025, modele: 'Clio', type: 'voiture', puissance_fiscale: 5, bareme: 'bnc',
  motorisation: 'thermique', carburant: 'diesel', km_professionnel: 12_000, inscrit_immobilisations: false,
  amortissements_a_reintegrer: null, created_at: '2025-01-05T09:00:00Z', updated_at: '2025-01-05T09:00:00Z', ...o,
})

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
const ENGAGEMENT_455: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }
const ENGAGEMENT_467: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '467000' }
const MODELES = [TRESORERIE, ENGAGEMENT_455, ENGAGEMENT_467]

// Un forfait écrit tel que la base l'écrit, au 31 décembre, en trésorerie.
function ecrit(v: VehiculeDossier, montant: number, o: Partial<EcritureBrouillon> = {}, credit = '108000'): EcritureBrouillon[] {
  const base = {
    dossier_id: 'd', piece_id: null, ligne_bancaire_id: null, immobilisation_id: null, vehicule_id: v.id, ...NON_VALIDEE,
    date: `${v.annee}-12-31`, libelle: `Indemnités kilométriques ${v.annee}`, montant, statut: 'proposee' as const,
    created_at: '2026-01-02T09:00:00Z',
  }
  return [
    { ...base, id: `${v.id}-d`, compte: '625110', sens: 'debit', ...o },
    { ...base, id: `${v.id}-c`, compte: credit, sens: 'credit', ...o },
  ]
}

// Un cadre 7 où chaque état se rencontre : écrit, à écrire, à réécrire (au centime près), validé qui diverge, à
// retirer (zéro kilomètre), rien, hors barème, barème absent, l'exercice en cours, et des exercices antérieurs à
// une ouverture — avec et sans forfait écrit.
const CLIO = vehicule({ id: 'v-ecrit' }) // 12 000 km, 5 CV : 12 000 × 0,357 + 1 395 = 5 679 €
const CADRE7: VehiculeDossier[] = [
  CLIO,
  vehicule({ id: 'v-a-ecrire', modele: null, puissance_fiscale: 4, km_professionnel: 4321 }),
  vehicule({ id: 'v-centime', km_professionnel: 45, puissance_fiscale: 3 }), // 45 × 0,529 = 23,805 → 23,81 €
  vehicule({ id: 'v-valide', km_professionnel: 8000, motorisation: 'electrique' }),
  vehicule({ id: 'v-zero', km_professionnel: 0 }),
  vehicule({ id: 'v-rien', km_professionnel: 0, annee: 2024 }),
  vehicule({ id: 'v-hors-bareme', type: 'moto', puissance_fiscale: 0, km_professionnel: 3500 }),
  vehicule({ id: 'v-sans-bareme', annee: 2027, km_professionnel: 900 }),
  vehicule({ id: 'v-en-cours', annee: 2026, type: 'cyclomoteur', puissance_fiscale: 0, motorisation: null, km_professionnel: 6001 }),
  vehicule({ id: 'v-repris', annee: 2024, km_professionnel: 7000 }),
  vehicule({ id: 'v-repris-ecrit', annee: 2024, km_professionnel: 7000 }),
]
const ECRITURES: EcritureBrouillon[] = [
  ...ecrit(CLIO, 5679),
  ...ecrit(CADRE7[2], 23.8),
  ...ecrit(CADRE7[3], 1000, { statut: 'validee' }),
  ...ecrit(CADRE7[4], 120),
  ...ecrit(CADRE7[10], 4501),
]

const etats = (f: Forfait[]) => f.map((x) => [x.vehicule.id, x.vehicule.annee, x.etat])

describe('agent-comptable / bloc FORFAIT (copie déployée)', () => {
  it('n’est pas la fonction de src/lib elle-même', () => {
    // Sans ce garde, comparer la copie à src/lib pourrait comparer src/lib à elle-même.
    expect(deployee.indemniteKilometriqueCentimes).not.toBe(indemniteKilometriqueCentimes)
  })

  it('rend la même indemnité au centime, sur chaque ligne du barème et à chaque borne de distance', () => {
    let calculees = 0
    for (const annee of [2024, 2025, 2026, 2027]) {
      for (const type of ['voiture', 'moto', 'cyclomoteur'] as const) {
        for (const puissance of [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 99, 100]) {
          for (const motorisation of [null, 'thermique', 'hybride', 'hydrogene', 'electrique'] as const) {
            for (const km of [0, 1, 45, 2999, 3000, 3001, 4999, 5000, 5001, 5999, 6000, 6001, 19_999, 20_000, 20_001, 54_321, 1.5, -1]) {
              const v = { type, puissance_fiscale: puissance, motorisation, km_professionnel: km }
              const attendu = indemniteKilometriqueCentimes(vehiculeDuDossier(vehicule(v)), annee)
              expect(deployee.indemniteKilometriqueCentimes(v, annee), `${annee} ${type} ${puissance} CV ${motorisation} ${km} km`).toBe(attendu)
              if (attendu !== null) calculees++
            }
          }
        }
      }
    }
    // Et la batterie touche bien le barème : sans quoi l'égalité ne prouverait que deux refus.
    expect(calculees).toBeGreaterThan(1000)
  })

  it('nomme le véhicule et compose la même écriture, dans chaque modèle et autour d’une ouverture', () => {
    for (const v of CADRE7) {
      expect(deployee.nomDuVehicule(v), v.id).toBe(nomDuVehicule(v))
      for (const modele of MODELES) {
        for (const ouverture of [null, '2025-01-01', '2026-01-01']) {
          expect(deployee.ecritureDuForfait(v, modele, ouverture), `${v.id} ${modele.mode} ${modele.compteNotesDeFrais} ${ouverture}`)
            .toEqual(ecritureDuForfait(v, modele, ouverture))
        }
      }
    }
  })

  it('rend le même état de chaque ligne du cadre 7, et réclame les mêmes forfaits', () => {
    for (const modele of MODELES) {
      for (const ouverture of [null, '2025-01-01']) {
        const attendu = forfaitsDuCadre7(CADRE7, ECRITURES, modele, ouverture, 2026, null)
        const copie = deployee.forfaitsDuCadre7(CADRE7, ECRITURES, modele, ouverture)
        expect(etats(copie), `${modele.mode} ${modele.compteNotesDeFrais} ${ouverture}`).toEqual(etats(attendu))
        for (const anneeCourante of [2025, 2026, 2027]) {
          expect(etats(deployee.forfaitsEnDefaut(copie, anneeCourante)), `${modele.mode} ${ouverture} ${anneeCourante}`)
            .toEqual(etats(forfaitsEnDefaut(attendu, anneeCourante)))
        }
      }
    }
    // Et le cadre 7 exerce bien chaque état : sans quoi l'égalité ci-dessus ne prouverait rien de lui.
    const tous = new Set(forfaitsDuCadre7(CADRE7, ECRITURES, TRESORERIE, '2025-01-01', 2026, null).map((f) => f.etat))
    expect([...tous].sort()).toEqual(['a_ecrire', 'a_reecrire', 'a_retirer', 'ecrit', 'rien', 'valide'])
  })
})

describe('agent-comptable / points_a_traiter lit le cadre 7 et ses forfaits', () => {
  const source = sourceDeployee()
  const corps = source.slice(source.indexOf('if (nom === "points_a_traiter")'), source.indexOf('return { erreur: `Outil inconnu'))

  it('lit le cadre 7 et le lien des écritures vers lui, sous le même refus de lecture partielle', () => {
    expect(corps).toMatch(/from\("vehicules"\)\.select\("id, annee, modele, type, puissance_fiscale, motorisation, km_professionnel"[^)]*\)\.eq\("dossier_id", dossierId\)\.order\("id"\)/)
    expect(corps).toMatch(/from\("ecritures_brouillon"\)\.select\("[^"]*immobilisation_id, vehicule_id"/)
    expect(corps).toMatch(/rNatures, rANouveaux, rVehicules\]\s*\.filter\(\(r\) => !r\.complete\)/)
  })

  it('rend le point de la Checklist, dans le modèle du dossier et sur son ouverture', () => {
    expect(corps).toContain('const forfaitsManquants = forfaitsEnDefaut(forfaitsDuCadre7(rVehicules.lignes, ecrituresTyped, modele, ouverture), anneeCourante)')
    expect(corps).toMatch(/forfaits_kilometriques_a_ecrire_ou_qui_ne_suivent_plus_le_cadre_7: forfaitsManquants\.length/)
  })

  it('dit au modèle que le forfait s’écrit sans pièce, au 31 décembre, et l’annonce dans l’outil', () => {
    expect(source).toMatch(/Le FORFAIT KILOMÉTRIQUE d'un véhicule du cadre 7 s'écrit au 31 décembre de son exercice, sans pièce ni mouvement : l'indemnité du barème au débit du 625110, au crédit du compte du dirigeant[^\n]*Il compte en case BJ de la 2035[^\n]*Ce n'est pas une anomalie\./)
    expect(source).toMatch(/forfaits kilométriques à écrire \(exercice fini\) ou qui ne suivent plus le cadre 7/)
  })
})

describe('le garde-fou du bloc FORFAIT sait encore échouer', () => {
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
  const memesIndemnites = (copie: Copie) => {
    for (const annee of [2025, 2026, 2027]) {
      for (const type of ['voiture', 'moto', 'cyclomoteur'] as const) {
        for (const puissance of [0, 1, 3, 4, 5, 6, 7, 99]) {
          for (const motorisation of ['thermique', 'electrique', null] as const) {
            for (const km of [45, 3000, 3001, 5000, 5001, 6000, 6001, 20_000, 20_001]) {
              const v = { type, puissance_fiscale: puissance, motorisation, km_professionnel: km }
              expect(copie.indemniteKilometriqueCentimes(v, annee)).toBe(indemniteKilometriqueCentimes(vehiculeDuDossier(vehicule(v)), annee))
            }
          }
        }
      }
    }
  }
  const memeCadre7 = (copie: Copie, modele = TRESORERIE, ouverture: string | null = null, anneeCourante = 2026) => {
    const attendu = forfaitsDuCadre7(CADRE7, ECRITURES, modele, ouverture, anneeCourante, null)
    const rendu = copie.forfaitsDuCadre7(CADRE7, ECRITURES, modele, ouverture)
    expect(etats(rendu)).toEqual(etats(attendu))
    expect(etats(copie.forfaitsEnDefaut(rendu, anneeCourante))).toEqual(etats(forfaitsEnDefaut(attendu, anneeCourante)))
  }

  it('attrape la table des véhicules électriques ignorée', () => {
    const derivee = planter(['  const electrique = v.motorisation === "electrique"\n  const ligne = bareme', '  const electrique = false\n  const ligne = bareme'])
    echoue(() => memesIndemnites(derivee))
  })

  it('attrape un coefficient mal recopié', () => {
    const derivee = planter(['voitureKm([0, 3], false, [0.529, 0.316, 1065, 0.370])', 'voitureKm([0, 3], false, [0.528, 0.316, 1065, 0.370])'])
    echoue(() => memesIndemnites(derivee))
  })

  it('attrape une indemnité arrondie vers le bas au lieu du demi-centime vers le haut', () => {
    const derivee = planter(['enMillimesKm(tranche.forfait) + 5n) / 10n', 'enMillimesKm(tranche.forfait)) / 10n'])
    echoue(() => memesIndemnites(derivee))
  })

  it('attrape une borne de tranche prise à l’envers', () => {
    const derivee = planter(['t.jusqua === null || v.km_professionnel <= t.jusqua', 't.jusqua === null || v.km_professionnel < t.jusqua'])
    echoue(() => memesIndemnites(derivee))
  })

  it('attrape un barème emprunté à une autre année', () => {
    const derivee = planter(['const bareme = BAREMES_KM.find((b) => b.annee === annee)', 'const bareme = [...BAREMES_KM].reverse().find((b) => b.annee <= annee)'])
    echoue(() => memesIndemnites(derivee))
  })

  it('attrape un compte du dirigeant figé au 108000 en engagement', () => {
    const derivee = planter(['    { compte: compteDuDirigeant(modele), sens: "credit" as const, montant, libelle },\n  ]\n}\n\n// Exactement l\'écriture attendue', '    { compte: "108000", sens: "credit" as const, montant, libelle },\n  ]\n}\n\n// Exactement l\'écriture attendue'])
    echoue(() => memeCadre7(derivee, ENGAGEMENT_455))
  })

  it('attrape un exercice repris dans les à-nouveaux dont le forfait serait réclamé', () => {
    const derivee = planter(['  if (ouverture && dateDuForfait(v.annee) < ouverture) return 0n\n', ''])
    echoue(() => memeCadre7(derivee, TRESORERIE, '2025-01-01'))
  })

  it('attrape le forfait de l’exercice en cours réclamé', () => {
    const derivee = planter(['(f.etat !== "a_ecrire" || f.vehicule.annee < anneeCourante)', '(f.etat !== "a_ecrire" || f.vehicule.annee <= anneeCourante)'])
    echoue(() => memeCadre7(derivee))
  })

  it('attrape un forfait validé qu’on proposerait de réécrire', () => {
    const derivee = planter(['    else if (presentes.some((e) => e.statut !== "proposee")) etat = "valide"\n', ''])
    echoue(() => memeCadre7(derivee))
  })

  it('attrape une conformité qui tolérerait un centime', () => {
    const derivee = planter(['    const i = restantes.findIndex((e) => e.compte === a.compte && e.sens === a.sens && e.date === dateDuForfait(annee)\n      && Math.round(e.montant * 100) === Math.round(a.montant * 100))', '    const i = restantes.findIndex((e) => e.compte === a.compte && e.sens === a.sens && e.date === dateDuForfait(annee)\n      && Math.abs(e.montant - a.montant) < 0.05)'])
    echoue(() => memeCadre7(derivee))
  })
})

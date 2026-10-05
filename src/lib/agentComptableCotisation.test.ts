import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { COMPTE_BANQUE, COMPTE_COTISATIONS_EXPLOITANT, COMPTE_EXPLOITANT } from './comptes'
import {
  cotisationsAEcrire, csgDeLEcriture, ecritureDeLaCotisation, montantDeLEcheance, rapprochementsCotisationRefuses,
  REFUS_COTISATION_CLASSEE, refusRapprochementCotisation,
} from './cotisationRapprochee'
import { REFUS_REGLE_EN_GROUPE } from './reglementGroupe'
import type { CotisationDeclaree, EcritureBrouillon, LigneBancaire, ModeComptable } from './types'
import { NON_VALIDEE } from '../test/ecritures'

// L'ASSISTANT RECOPIE CE QUE LA CHECKLIST DIT DES ÉCHÉANCES DE COTISATION RAPPROCHÉES (01/10/2026, ligne 26.6,
// étape b).
//
// Deux points de la Checklist en dépendent : l'échéance payée dont l'écriture manque ou n'est plus à jour —
// absente du FEC —, et le rapprochement qui ne peut pas s'écrire. `agent-comptable` est auto-portée : elle
// recopie le montant d'une échéance, sa CSG-CRDS, les refus et l'écriture attendue entre les bornes
// `── DÉBUT/FIN COTISATION`, et ce test les compare à `src/lib` sur une batterie commune — la forme de garde
// des blocs AFFECTATION, EMPRUNT et VENTILATION : extraire, transpiler, exécuter, comparer à une référence
// EXTÉRIEURE à la copie, et planter des dérives dans la vraie source pour prouver qu'il sait encore échouer.
//
// CE QU'UNE DÉRIVE COÛTERAIT : l'assistant répondrait « rien à signaler » sur un dossier dont le FEC n'a
// aucune cotisation, en français, à un comptable qui n'ira pas vérifier — ou compterait comme à écrire un
// rapprochement que la base refuserait d'écrire.

function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
}

type Ecriture = { compte: string; sens: string; montant: number }
type Rapprochement = { ligne: { id: string }; cotisation: { id: string } }
interface Copie {
  montantDeLEcheance: typeof montantDeLEcheance
  csgDeLEcriture: typeof csgDeLEcriture
  refusRapprochementCotisation: (l: LigneBancaire, c: CotisationDeclaree, mode: ModeComptable) => string | null
  ecritureDeLaCotisation: (l: { montant: number }, c: CotisationDeclaree, mode: ModeComptable) => Ecriture[]
  cotisationsAEcrire: (e: EcritureBrouillon[], l: LigneBancaire[], c: CotisationDeclaree[], mode: ModeComptable) => Rapprochement[]
  rapprochementsCotisationRefuses: (l: LigneBancaire[], c: CotisationDeclaree[], mode: ModeComptable) => (Rapprochement & { raison: string })[]
}

// Le bloc COTISATION lit `ecrituresSansPieceParMouvement`, `ecritureConforme` et `COMPTE_EXPLOITANT` du bloc
// AFFECTATION, et `COMPTE_BANQUE` déclaré plus haut : tous repris de la MÊME source, pour qu'une dérive de
// l'un d'eux morde ici aussi.
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
  const bloc = `const COMPTE_BANQUE = "${banque![1]}"\nconst COMPTE_EXPLOITANT = "${exploitant![1]}"\n${bornes('AFFECTATION')}\n${bornes('COTISATION')}`
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { montantDeLEcheance, csgDeLEcriture, refusRapprochementCotisation, ecritureDeLaCotisation, cotisationsAEcrire, rapprochementsCotisationRefuses }`)() as Copie
}

const deployee = extraire(sourceDeployee())

const MODES: ModeComptable[] = ['tresorerie', 'engagement']

const ligne = (o: Partial<LigneBancaire>): LigneBancaire => ({
  id: 'l', dossier_id: 'd', date: '2026-03-05', libelle: 'PRLV URSSAF', montant: -500, statut: 'rapprochee',
  piece_id: null, cotisation_id: 'c', categorie_id: null, taux_tva: null, prelevement_personnel: false,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
  id_externe: null, source_fichier: null, libelle_brut: null, created_at: '2026-03-06T09:00:00Z', ...o,
})

const cotisation = (o: Partial<CotisationDeclaree>): CotisationDeclaree => ({
  id: 'c', dossier_id: 'd', echeance: '2026-03-05', montant_appele: 500, montant_verse: null, montant_csg_crds: null,
  previsionnel: false, created_at: '2026-01-02T09:00:00Z', ...o,
})

const ecriture = (o: Partial<EcritureBrouillon>): EcritureBrouillon => ({
  id: 'e', dossier_id: 'd', piece_id: null, ligne_bancaire_id: 'l', date: '2026-03-05', compte: COMPTE_BANQUE,
  libelle: 'PRLV URSSAF', sens: 'credit', montant: 500, statut: 'proposee', immobilisation_id: null, vehicule_id: null, ...NON_VALIDEE, created_at: '2026-03-06T09:00:00Z', ...o,
})
// L'écriture juste d'un rapprochement, telle que src/lib la compose.
const conforme = (l: LigneBancaire, c: CotisationDeclaree, mode: ModeComptable, date = l.date): EcritureBrouillon[] =>
  ecritureDeLaCotisation(l, c, mode)
    .map((e, i) => ecriture({ id: `${l.id}-${i}`, ligne_bancaire_id: l.id, date, compte: e.compte, sens: e.sens, montant: e.montant }))

const sansLibelle = (e: { compte: string; sens: string; montant: number }[]) => e.map(({ compte, sens, montant }) => ({ compte, sens, montant }))
const paires = (a: Rapprochement[]) => a.map((r) => `${r.ligne.id}→${r.cotisation.id}`)

// Le code de chaque refus de la copie, face à la phrase que src/lib rend pour lui : c'est ce qui rend
// l'ORDRE des refus vérifiable, et non seulement leur existence.
const PHRASE_DU_CODE: Record<string, string | RegExp> = {
  regle_en_groupe: REFUS_REGLE_EN_GROUPE,
  deja_classe: REFUS_COTISATION_CLASSEE,
  mouvement_a_zero: 'Un mouvement de zéro euro n’a rien à écrire.',
  echeance_a_zero: 'Une échéance de zéro euro ne se rapproche pas.',
  encaissement_sur_un_appel: /^Ce mouvement est un encaissement : il ne paie pas un appel de cotisation\./,
  prelevement_sur_un_remboursement: /^Cette échéance est négative — un remboursement : un prélèvement ne la paie pas\./,
  csg_pas_au_centime: 'La CSG-CRDS de cette échéance n’est pas au centime.',
  csg_au_dela_du_mouvement: /^La CSG-CRDS de cette échéance \(.+\) dépasse le mouvement \(.+\)\.$/,
}

// Des mouvements qui portent chacun ce qui décide d'un refus — et plusieurs à la fois, pour l'ORDRE.
const MOUVEMENTS: LigneBancaire[] = [
  ligne({}),
  ligne({ id: 'encaissement', montant: 500 }),
  ligne({ id: 'zero', montant: 0 }),
  ligne({ id: 'petit', montant: -20 }),
  ligne({ id: 'groupe', reglement_groupe: true, piece_id: 'p1' }),
  ligne({ id: 'piece', piece_id: 'p1' }),
  ligne({ id: 'affecte', categorie_id: 'cat' }),
  ligne({ id: 'emprunt', emprunt_id: 'e1' }),
  ligne({ id: 'ventile', ventilee: true, montant: 0 }),
  ligne({ id: 'personnel', prelevement_personnel: true }),
]
// Des échéances : un appel, un versement saisi (qui prime), un remboursement, une échéance à zéro, et des
// CSG-CRDS saisies — nulle, au centime, hors centime, au-delà d'un petit mouvement, négative.
const ECHEANCES: CotisationDeclaree[] = [
  cotisation({}),
  cotisation({ id: 'verse', montant_verse: 480 }),
  cotisation({ id: 'verse-zero', montant_appele: 500, montant_verse: 0 }),
  cotisation({ id: 'remboursement', montant_appele: -120 }),
  cotisation({ id: 'zero', montant_appele: 0 }),
  cotisation({ id: 'csg', montant_csg_crds: 48.5 }),
  cotisation({ id: 'csg-negative', montant_csg_crds: -48.5 }),
  cotisation({ id: 'csg-zero', montant_csg_crds: 0 }),
  cotisation({ id: 'csg-millieme', montant_csg_crds: 48.505 }),
  cotisation({ id: 'csg-tout', montant_csg_crds: 500 }),
  cotisation({ id: 'csg-au-dela', montant_csg_crds: 25 }),
]

describe('agent-comptable / bloc COTISATION (copie déployée)', () => {
  it('n’est pas la fonction de src/lib elle-même', () => {
    expect(deployee.refusRapprochementCotisation).not.toBe(refusRapprochementCotisation)
    expect(deployee.cotisationsAEcrire).not.toBe(cotisationsAEcrire)
  })

  it('rend le même montant d’échéance et la même CSG-CRDS écrite, dans les deux modèles', () => {
    for (const c of ECHEANCES) {
      expect(deployee.montantDeLEcheance(c), c.id).toBe(montantDeLEcheance(c))
      for (const mode of MODES) expect(deployee.csgDeLEcriture(c, mode), `${c.id} / ${mode}`).toBe(csgDeLEcriture(c, mode))
    }
  })

  it('refuse ce que src/lib refuse, pour la même raison, dans le même ordre', () => {
    let refus = 0
    for (const l of MOUVEMENTS) {
      for (const c of ECHEANCES) {
        for (const mode of MODES) {
          const attendu = refusRapprochementCotisation(l, c, mode)
          const code = deployee.refusRapprochementCotisation(l, c, mode)
          const cas = `${l.id} / ${c.id} / ${mode}`
          if (attendu === null) {
            expect(code, cas).toBeNull()
            continue
          }
          refus++
          expect(code, cas).not.toBeNull()
          const phrase = PHRASE_DU_CODE[code!]
          expect(phrase, `code inconnu : ${code}`).toBeDefined()
          if (typeof phrase === 'string') expect(attendu, cas).toBe(phrase)
          else expect(attendu, cas).toMatch(phrase)
        }
      }
    }
    // La batterie exerce bien chaque refus, et laisse passer des rapprochements justes.
    const codes = new Set(MOUVEMENTS.flatMap((l) => ECHEANCES.flatMap((c) => MODES.map((m) => deployee.refusRapprochementCotisation(l, c, m)))))
    for (const code of Object.keys(PHRASE_DU_CODE)) expect(codes, code).toContain(code)
    expect(codes).toContain(null)
    expect(refus).toBeGreaterThan(0)
  })

  it('compose la même écriture, ligne à ligne, dans les deux sens et les deux modèles', () => {
    const cas: [number, CotisationDeclaree][] = [
      [-500, cotisation({})], [-500, cotisation({ montant_csg_crds: 48.5 })], [-500, cotisation({ montant_csg_crds: -48.5 })],
      [-500, cotisation({ montant_csg_crds: 500 })], [-0.3, cotisation({ montant_csg_crds: 0.1 })],
      [-1234.57, cotisation({ montant_csg_crds: 0.07 })], [120, cotisation({ montant_appele: -120, montant_csg_crds: 11.6 })],
      [0.3, cotisation({ montant_appele: -0.3 })],
    ]
    for (const [montant, c] of cas) {
      for (const mode of MODES) {
        expect(deployee.ecritureDeLaCotisation({ montant }, c, mode), `${montant} / ${c.montant_csg_crds} / ${mode}`)
          .toEqual(sansLibelle(ecritureDeLaCotisation(ligne({ montant }), c, mode)))
      }
    }
    // Les comptes sont bien ceux de src/lib.
    expect(sansLibelle(ecritureDeLaCotisation(ligne({}), cotisation({ montant_csg_crds: 48.5 }), 'tresorerie')).map((e) => e.compte))
      .toEqual([COMPTE_BANQUE, COMPTE_COTISATIONS_EXPLOITANT, COMPTE_EXPLOITANT])
  })

  it('rend les mêmes échéances à écrire et les mêmes rapprochements refusés, dans les deux modèles', () => {
    const cotisations = [
      cotisation({ id: 'juste' }),
      cotisation({ id: 'absente' }),
      cotisation({ id: 'perimee', montant_csg_crds: 48.5 }),
      cotisation({ id: 'autre-date' }),
      cotisation({ id: 'autre-montant' }),
      cotisation({ id: 'refusee' }),
      cotisation({ id: 'non-rapprochee' }),
      cotisation({ id: 'remboursement', montant_appele: -120 }),
    ]
    const lignes = [
      ligne({ id: 'l-juste', cotisation_id: 'juste' }),
      ligne({ id: 'l-absente', cotisation_id: 'absente' }),
      ligne({ id: 'l-perimee', cotisation_id: 'perimee' }),
      ligne({ id: 'l-autre-date', cotisation_id: 'autre-date' }),
      ligne({ id: 'l-autre-montant', cotisation_id: 'autre-montant' }),
      // Un encaissement rapproché d'un appel : il ne s'écrit pas.
      ligne({ id: 'l-refusee', cotisation_id: 'refusee', montant: 500 }),
      // Un mouvement qui n'est plus rapproché, et une échéance qu'aucune lecture n'a rendue.
      ligne({ id: 'l-non-rapprochee', cotisation_id: 'non-rapprochee', statut: 'non_rapprochee' }),
      ligne({ id: 'l-inconnue', cotisation_id: 'pas-lue' }),
      ligne({ id: 'l-remboursement', cotisation_id: 'remboursement', montant: 120 }),
    ]
    for (const mode of MODES) {
      const ecritures = [
        ...conforme(lignes[0], cotisations[0], mode),
        // Écrite avant la saisie de sa CSG-CRDS : tout au 646000.
        ...conforme(lignes[2], cotisation({ id: 'perimee' }), mode),
        ...conforme(lignes[3], cotisations[3], mode, '2026-03-09'),
        ...conforme(lignes[4], cotisations[4], mode).map((e) => (e.compte === COMPTE_BANQUE ? e : { ...e, montant: 450 })),
        ...conforme(lignes[8], cotisations[7], mode),
        // Les écritures d'une PIÈCE qui désignent le même mouvement n'en sont pas.
        ecriture({ id: 'piece', piece_id: 'p1', ligne_bancaire_id: 'l-absente', compte: '606100', sens: 'debit', montant: 500 }),
      ]
      expect(paires(deployee.cotisationsAEcrire(ecritures, lignes, cotisations, mode)), mode)
        .toEqual(paires(cotisationsAEcrire(ecritures, lignes, cotisations, mode, null)))
      expect(paires(deployee.rapprochementsCotisationRefuses(lignes, cotisations, mode)), mode)
        .toEqual(paires(rapprochementsCotisationRefuses(lignes, cotisations, mode, null)))
    }
    // La batterie exerce bien ce qui décide : en trésorerie, la CSG-CRDS saisie depuis rend l'écriture
    // périmée ; en engagement, elle n'y change rien.
    const ecrituresTresorerie = [
      ...conforme(lignes[0], cotisations[0], 'tresorerie'),
      ...conforme(lignes[2], cotisation({ id: 'perimee' }), 'tresorerie'),
      ...conforme(lignes[3], cotisations[3], 'tresorerie', '2026-03-09'),
      ...conforme(lignes[4], cotisations[4], 'tresorerie').map((e) => (e.compte === COMPTE_BANQUE ? e : { ...e, montant: 450 })),
      ...conforme(lignes[8], cotisations[7], 'tresorerie'),
    ]
    expect(paires(cotisationsAEcrire(ecrituresTresorerie, lignes, cotisations, 'tresorerie', null)))
      .toEqual(['l-absente→absente', 'l-perimee→perimee', 'l-autre-date→autre-date', 'l-autre-montant→autre-montant'])
    expect(paires(cotisationsAEcrire(ecrituresTresorerie, lignes, cotisations, 'engagement', null))).not.toContain('l-perimee→perimee')
    expect(paires(rapprochementsCotisationRefuses(lignes, cotisations, 'tresorerie', null))).toEqual(['l-refusee→refusee'])
  })
})

describe('agent-comptable / points_a_traiter lit les échéances de cotisation', () => {
  const source = sourceDeployee()
  const corps = source.slice(source.indexOf('if (nom === "points_a_traiter")'), source.indexOf('return { erreur: `Outil inconnu'))

  it('lit les échéances et ce qui les paie, sous le même refus de lecture partielle', () => {
    expect(corps).toMatch(/from\("cotisations_declarees"\)\.select\("id, echeance, montant_appele, montant_verse, montant_csg_crds"[^)]*\)\.eq\("dossier_id", dossierId\)\.order\("id"\)/)
    // Le relevé entier porte ce qui décide d'un refus : le lien, et tout autre classement du mouvement.
    expect(corps).toMatch(/from\("lignes_bancaires"\)\.select\("id, date, montant, statut, piece_id, reglement_groupe, cotisation_id, categorie_id, prelevement_personnel, emprunt_id, [^"]*ventilee"[^)]*\)\.eq\("dossier_id", dossierId\)\.order\("id"\)/)
    expect(corps).toMatch(/rReleve, rParts, rReglements, rCotisations[^\]]*\]\s*\.filter\(\(r\) => !r\.complete\)/)
  })

  it('rend les deux points de la Checklist, selon le modèle du dossier', () => {
    expect(corps).toContain('const cotisationsSansEcriture = cotisationsAEcrire(ecrituresTyped, rReleve.lignes, rCotisations.lignes, modele.mode)')
    expect(corps).toContain('const cotisationsRefusees = rapprochementsCotisationRefuses(rReleve.lignes, rCotisations.lignes, modele.mode)')
    expect(corps).toMatch(/echeances_de_cotisation_payees_dont_l_ecriture_manque_ou_n_est_plus_a_jour: cotisationsSansEcriture\.length/)
    expect(corps).toMatch(/rapprochements_d_une_echeance_de_cotisation_qui_ne_peuvent_pas_s_ecrire: cotisationsRefusees\.length/)
  })

  it('dit au modèle qu’une échéance rapprochée s’écrit sans pièce, au 646000 et au 108000 en trésorerie', () => {
    expect(source).toMatch(/Une ÉCHÉANCE DE COTISATION rapprochée d'un mouvement s'écrit face au 512000, sans pièce : la cotisation au 646000[^\n]*mode_comptable === "engagement" \? "" : " et sa CSG-CRDS, quand elle est saisie, au 108000 Compte de l'exploitant ; elle compte dans la 2035 à la date et au montant du prélèvement[^"]*"\}\. Ce n'est pas une anomalie\./)
    // Et la description de l'outil les annonce, pour que le modèle sache les demander.
    expect(source).toMatch(/échéances de cotisation payées dont l'écriture manque ou n'est plus à jour, rapprochements d'une échéance de cotisation qui ne peuvent pas s'écrire/)
  })
})

describe('le garde-fou du bloc COTISATION sait encore échouer', () => {
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
  const memesRefus = (copie: Copie) => {
    for (const l of MOUVEMENTS) {
      for (const c of ECHEANCES) {
        for (const mode of MODES) {
          expect(copie.refusRapprochementCotisation(l, c, mode) === null, `${l.id} / ${c.id} / ${mode}`)
            .toBe(refusRapprochementCotisation(l, c, mode) === null)
        }
      }
    }
  }

  it('attrape un versement saisi qui ne primerait plus sur l’appel', () => {
    const derivee = planter(['  return c.montant_verse ?? c.montant_appele\n}\n\n// La CSG-CRDS que l\'écriture porte au 108000', '  return c.montant_appele\n}\n\n// La CSG-CRDS que l\'écriture porte au 108000'])
    echoue(() => { for (const c of ECHEANCES) expect(derivee.montantDeLEcheance(c)).toBe(montantDeLEcheance(c)) })
  })

  it('attrape une CSG-CRDS portée au 108000 en engagement', () => {
    const derivee = planter(['  return mode === "tresorerie" && c.montant_csg_crds != null ? Math.abs(c.montant_csg_crds) : 0\n}\n\n// Pourquoi ce rapprochement', '  return c.montant_csg_crds != null ? Math.abs(c.montant_csg_crds) : 0\n}\n\n// Pourquoi ce rapprochement'])
    echoue(() => expect(derivee.ecritureDeLaCotisation({ montant: -500 }, cotisation({ montant_csg_crds: 48.5 }), 'engagement'))
      .toEqual(sansLibelle(ecritureDeLaCotisation(ligne({}), cotisation({ montant_csg_crds: 48.5 }), 'engagement'))))
  })

  it('attrape un encaissement qui paierait un appel', () => {
    const derivee = planter(['  if (montant > 0 && ligne.montant > 0) return "encaissement_sur_un_appel"\n', ''])
    echoue(() => memesRefus(derivee))
  })

  it('attrape un mouvement déjà classé ailleurs qui s’écrirait quand même', () => {
    const derivee = planter(['ligne.emprunt_id || ligne.ventilee || ligne.prelevement_personnel) return "deja_classe"', 'ligne.emprunt_id) return "deja_classe"'])
    echoue(() => memesRefus(derivee))
  })

  it('attrape une CSG-CRDS au-delà du mouvement qui ne serait plus refusée', () => {
    const derivee = planter(['  if (centimesCotisation(csg) > centimesCotisation(Math.abs(ligne.montant))) return "csg_au_dela_du_mouvement"\n', ''])
    echoue(() => memesRefus(derivee))
  })

  it('attrape une écriture qui garde ses lignes à zéro', () => {
    const derivee = planter(['  ].filter((l) => l.montant > 0)\n}\n\n// Les mouvements rapprochés d\'une échéance LUE', '  ]\n}\n\n// Les mouvements rapprochés d\'une échéance LUE'])
    echoue(() => expect(derivee.ecritureDeLaCotisation({ montant: -500 }, cotisation({}), 'tresorerie'))
      .toEqual(sansLibelle(ecritureDeLaCotisation(ligne({}), cotisation({}), 'tresorerie'))))
  })

  it('attrape un remboursement écrit dans le sens d’un prélèvement', () => {
    const derivee = planter(['  const sensCompte = sortie ? "debit" : "credit"\n  return [\n    { compte: COMPTE_BANQUE, sens: sortie ? "credit" : "debit", montant: total / 100 },\n    { compte: COMPTE_COTISATIONS_EXPLOITANT', '  const sensCompte = "debit"\n  return [\n    { compte: COMPTE_BANQUE, sens: "credit", montant: total / 100 },\n    { compte: COMPTE_COTISATIONS_EXPLOITANT'])
    echoue(() => expect(derivee.ecritureDeLaCotisation({ montant: 120 }, cotisation({ montant_appele: -120 }), 'tresorerie'))
      .toEqual(sansLibelle(ecritureDeLaCotisation(ligne({ montant: 120 }), cotisation({ montant_appele: -120 }), 'tresorerie'))))
  })

  it('attrape un rapprochement refusé compté parmi les échéances à écrire', () => {
    const derivee = planter(['    !refusRapprochementCotisation(ligne, cotisation, mode)\n    && !ecritureConforme(', '    !ecritureConforme('])
    const lignes = [ligne({ id: 'l-refusee', cotisation_id: 'refusee', montant: 500 })]
    const cotisations = [cotisation({ id: 'refusee' })]
    echoue(() => expect(paires(derivee.cotisationsAEcrire([], lignes, cotisations, 'tresorerie')))
      .toEqual(paires(cotisationsAEcrire([], lignes, cotisations, 'tresorerie', null))))
  })

  it('attrape une écriture jugée à la date de l’échéance plutôt qu’à celle du mouvement', () => {
    const derivee = planter(['ecritureDeLaCotisation(ligne, cotisation, mode), ligne.date))', 'ecritureDeLaCotisation(ligne, cotisation, mode), cotisation.echeance))'])
    // Prélevée le 9 mars pour une échéance du 5 : l'écriture juste porte le 9.
    const lignes = [ligne({ id: 'l-tard', date: '2026-03-09' })]
    const cotisations = [cotisation({})]
    const ecritures = conforme(lignes[0], cotisations[0], 'tresorerie')
    echoue(() => expect(paires(derivee.cotisationsAEcrire(ecritures, lignes, cotisations, 'tresorerie')))
      .toEqual(paires(cotisationsAEcrire(ecritures, lignes, cotisations, 'tresorerie', null))))
  })

  it('attrape un mouvement non rapproché qui paierait encore', () => {
    const derivee = planter(['    if (ligne.statut !== "rapprochee" || !ligne.cotisation_id) continue\n    const cotisation = parId.get', '    if (!ligne.cotisation_id) continue\n    const cotisation = parId.get'])
    const lignes = [ligne({ id: 'l-non-rapprochee', statut: 'non_rapprochee' })]
    const cotisations = [cotisation({})]
    echoue(() => expect(paires(derivee.cotisationsAEcrire([], lignes, cotisations, 'tresorerie')))
      .toEqual(paires(cotisationsAEcrire([], lignes, cotisations, 'tresorerie', null))))
  })
})

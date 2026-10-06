import { describe, expect, it } from 'vitest'
import type { MouvementBancaire } from './affectationBanque'
import { COMPTE_BANQUE, COMPTE_COTISATIONS_EXPLOITANT, COMPTE_EXPLOITANT, LIBELLES_COMPTES } from './comptes'
import {
  avertissementRetraitEcheance, cotisationsAEcrire, cotisationsComptees, csgDeLEcriture, ecritureDeLaCotisation,
  montantDeLEcheance, rapprochementsCotisationRefuses, REFUS_COTISATION_CLASSEE, refusRapprochementCotisation,
} from './cotisationRapprochee'
import { REFUS_REGLE_EN_GROUPE } from './reglementGroupe'
import type { CotisationDeclaree, EcritureBrouillon } from './types'
import { fichiersDuSchema } from '../test/schema'
import { NON_VALIDEE } from '../test/ecritures'

function mouvement(o: Partial<MouvementBancaire> = {}): MouvementBancaire {
  return {
    id: 'l1', date: '2026-01-06', libelle: 'PRLV URSSAF', libelle_brut: null, montant: -500,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    source_fichier: 'releve-janvier.csv', emprunt_id: null, emprunt_echeance: null, emprunt_interets: null,
    emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, ...o,
  }
}

// Un mouvement tel que la base le garde une fois rapproché de l'échéance `c1`.
function rapproche(o: Partial<MouvementBancaire> = {}): MouvementBancaire {
  return mouvement({ statut: 'rapprochee', cotisation_id: 'c1', ...o })
}

function cotisation(o: Partial<CotisationDeclaree> = {}): CotisationDeclaree {
  return {
    id: 'c1', dossier_id: 'd1', echeance: '2025-12-05', montant_appele: 500, montant_verse: null,
    montant_csg_crds: 48.5, previsionnel: false, created_at: '2025-11-02T10:00:00Z', ...o,
  }
}

function ecriture(o: Partial<EcritureBrouillon>): EcritureBrouillon {
  return {
    id: 'e', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: 'l1', date: '2026-01-06', compte: COMPTE_BANQUE,
    libelle: 'PRLV URSSAF', montant: 500, sens: 'credit', statut: 'proposee', immobilisation_id: null, vehicule_id: null, ...NON_VALIDEE, created_at: '2026-01-07T10:00:00Z',
    ...o,
  }
}

// L'écriture que la base a écrite pour le prélèvement de 500 € d'une échéance à 48,50 € de CSG-CRDS.
const ECRITE = [
  ecriture({ id: 'e1' }),
  ecriture({ id: 'e2', compte: COMPTE_COTISATIONS_EXPLOITANT, sens: 'debit', montant: 451.5 }),
  ecriture({ id: 'e3', compte: COMPTE_EXPLOITANT, sens: 'debit', montant: 48.5 }),
]

// La définition de `rapprocher_cotisation` telle que l'export du schéma la porte, la dernière en date.
function definitionSql(): string {
  const definitions = fichiersDuSchema().filter((f) => /function public\.rapprocher_cotisation\(/.test(f.texte))
  expect(definitions.length).toBeGreaterThan(0)
  const texte = definitions[definitions.length - 1].texte
  const debut = texte.indexOf('function public.rapprocher_cotisation(')
  const fin = texte.indexOf('function public.retirer_rapprochement_cotisation(', debut)
  return texte.slice(debut, fin < 0 ? undefined : fin)
}

// Une apostrophe se double en SQL, se courbe à l'écran : comparées, elles sont la même.
const sansApostrophes = (s: string) => s.replace(/''/g, "'").replace(/’/g, "'")

describe('les comptes de l’écriture', () => {
  // La base vérifie ces numéros EXACTEMENT : un compte renommé d'un seul côté ferait refuser chaque
  // rapprochement, avec « L'écriture proposée ne correspond pas », sans que rien dise pourquoi.
  it('sont ceux que la fonction SQL exportée attend, dans le sens du mouvement', () => {
    const sql = definitionSql()
    expect(sql).toContain(`('${COMPTE_BANQUE}', v_sens_banque, v_total)`)
    expect(sql).toContain(`('${COMPTE_COTISATIONS_EXPLOITANT}', v_sens_compte, v_total - v_csg)`)
    expect(sql).toContain(`('${COMPTE_EXPLOITANT}', v_sens_compte, v_csg)`)
    expect(sql).toContain("v_sens_banque := case when v_ligne.montant > 0 then 'debit' else 'credit' end")
    expect(sql).toContain("v_sens_compte := case when v_ligne.montant > 0 then 'credit' else 'debit' end")
    // La CSG-CRDS ne passe au 108000 qu'en trésorerie, et la base le lit au même endroit que l'écran.
    expect(sql).toContain("if v_mode = 'tresorerie' and v_cotisation.montant_csg_crds is not null then")
  })

  it('portent un libellé, que la balance et le FEC reprennent', () => {
    expect(LIBELLES_COMPTES[COMPTE_COTISATIONS_EXPLOITANT]).toBe("Cotisations sociales personnelles de l'exploitant")
    expect(LIBELLES_COMPTES[COMPTE_EXPLOITANT]).toBeTruthy()
  })
})

describe('refusRapprochementCotisation — dit avant d’écrire ce que la base refuserait', () => {
  it('rien à redire d’un prélèvement qui paie un appel', () => {
    expect(refusRapprochementCotisation(mouvement(), cotisation(), 'tresorerie')).toBeNull()
    expect(refusRapprochementCotisation(mouvement(), cotisation(), 'engagement')).toBeNull()
  })

  it('ni d’un encaissement qui reçoit un remboursement', () => {
    expect(refusRapprochementCotisation(mouvement({ montant: 120 }), cotisation({ montant_appele: -120, montant_csg_crds: -11.64 }), 'tresorerie')).toBeNull()
  })

  it('un mouvement réglé en groupe : annuler d’abord ce règlement', () => {
    // Avant le classement : c'est le refus que la base lève en premier.
    expect(refusRapprochementCotisation(mouvement({ reglement_groupe: true, categorie_id: 'cat' }), cotisation(), 'tresorerie'))
      .toBe(REFUS_REGLE_EN_GROUPE)
  })

  it('un mouvement déjà classé autrement : annuler d’abord ce classement', () => {
    const classes: Partial<MouvementBancaire>[] = [
      { piece_id: 'p1' }, { categorie_id: 'cat-frais' }, { emprunt_id: 'emp1', emprunt_echeance: 1 }, { ventilee: true },
      { prelevement_personnel: true },
    ]
    for (const o of classes) {
      expect(refusRapprochementCotisation(mouvement({ statut: 'rapprochee', ...o }), cotisation(), 'tresorerie')).toBe(REFUS_COTISATION_CLASSEE)
    }
  })

  it('un mouvement déjà rapproché d’une échéance n’est pas refusé : le nouveau rapprochement remplace l’ancien', () => {
    expect(refusRapprochementCotisation(rapproche({ cotisation_id: 'autre' }), cotisation(), 'tresorerie')).toBeNull()
  })

  it('un mouvement de zéro euro, puis une échéance de zéro euro', () => {
    expect(refusRapprochementCotisation(mouvement({ montant: 0 }), cotisation(), 'tresorerie')).toBe('Un mouvement de zéro euro n’a rien à écrire.')
    expect(refusRapprochementCotisation(mouvement(), cotisation({ montant_appele: 0 }), 'tresorerie'))
      .toBe('Une échéance de zéro euro ne se rapproche pas.')
  })

  it('le versement saisi fait foi sur l’appel, pour le zéro comme pour le sens', () => {
    // Un appel de 500 € dont rien n'a été versé : il n'y a rien à rapprocher.
    expect(refusRapprochementCotisation(mouvement(), cotisation({ montant_verse: 0 }), 'tresorerie'))
      .toBe('Une échéance de zéro euro ne se rapproche pas.')
    // Un appel de 500 € finalement remboursé de 80 € : c'est un remboursement, un encaissement le reçoit.
    expect(refusRapprochementCotisation(mouvement({ montant: 80 }), cotisation({ montant_verse: -80 }), 'tresorerie')).toBeNull()
    expect(montantDeLEcheance(cotisation({ montant_verse: -80 }))).toBe(-80)
    expect(montantDeLEcheance(cotisation())).toBe(500)
  })

  it('un encaissement ne paie pas un appel, un prélèvement ne reçoit pas un remboursement', () => {
    expect(refusRapprochementCotisation(mouvement({ montant: 500 }), cotisation(), 'tresorerie'))
      .toBe('Ce mouvement est un encaissement : il ne paie pas un appel de cotisation. Un remboursement se rapproche d’une échéance négative.')
    expect(refusRapprochementCotisation(mouvement(), cotisation({ montant_appele: -500 }), 'tresorerie'))
      .toBe('Cette échéance est négative — un remboursement : un prélèvement ne la paie pas.')
  })

  it('une CSG-CRDS qui n’est pas au centime, ou qui dépasse le mouvement — en trésorerie seulement', () => {
    expect(refusRapprochementCotisation(mouvement(), cotisation({ montant_csg_crds: 48.505 }), 'tresorerie'))
      .toBe('La CSG-CRDS de cette échéance n’est pas au centime.')
    const depasse = refusRapprochementCotisation(mouvement(), cotisation({ montant_csg_crds: 900 }), 'tresorerie')
    expect(depasse).toMatch(/^La CSG-CRDS de cette échéance \(900,00\s€\) dépasse le mouvement \(500,00\s€\)\.$/)
    // En engagement, la CSG-CRDS n'est pas écrite à part : elle ne peut rien empêcher.
    expect(refusRapprochementCotisation(mouvement(), cotisation({ montant_csg_crds: 900 }), 'engagement')).toBeNull()
    expect(refusRapprochementCotisation(mouvement(), cotisation({ montant_csg_crds: 48.505 }), 'engagement')).toBeNull()
  })

  it('une CSG-CRDS égale au mouvement est admise : l’écriture n’a alors pas de 646000', () => {
    expect(refusRapprochementCotisation(mouvement(), cotisation({ montant_csg_crds: 500 }), 'tresorerie')).toBeNull()
  })

  it('les refus sont ceux de la base, dans le même ordre', () => {
    // Chaque refus de l'écran déclenché par un cas qui ne déclenche que lui et ceux qui le suivent :
    // l'ordre des premiers refus rencontrés doit être l'ordre des `raise` de la fonction.
    const cas: [MouvementBancaire, CotisationDeclaree, string][] = [
      [mouvement({ reglement_groupe: true }), cotisation(), REFUS_REGLE_EN_GROUPE],
      [mouvement({ piece_id: 'p1', statut: 'rapprochee' }), cotisation(), REFUS_COTISATION_CLASSEE],
      [mouvement({ montant: 0 }), cotisation(), 'Un mouvement de zéro euro'],
      [mouvement(), cotisation({ montant_appele: 0 }), 'Une échéance de zéro euro'],
      [mouvement({ montant: 500 }), cotisation(), 'Ce mouvement est un encaissement'],
      [mouvement(), cotisation({ montant_appele: -500 }), 'Cette échéance est négative'],
      [mouvement(), cotisation({ montant_csg_crds: 0.001 }), 'n’est pas au centime'],
      [mouvement(), cotisation({ montant_csg_crds: 900 }), 'dépasse le mouvement'],
    ]
    const sql = sansApostrophes(definitionSql())
    let position = -1
    for (const [ligne, c, attendu] of cas) {
      const refus = refusRapprochementCotisation(ligne, c, 'tresorerie')
      expect(refus).toContain(attendu)
      // Le texte du refus, sans ses montants, figure dans la fonction — et APRÈS le précédent.
      const fixe = sansApostrophes(refus!).replace(/\([^)]*€\)/g, '(% €)')
      const ici = sql.indexOf(fixe)
      expect(ici, fixe).toBeGreaterThan(position)
      position = ici
    }
  })
})

describe('ecritureDeLaCotisation — la banque au montant du mouvement, la cotisation et sa CSG-CRDS en face', () => {
  it('en trésorerie, la CSG-CRDS passe au 108000 et le reste au 646000', () => {
    expect(ecritureDeLaCotisation(mouvement(), cotisation(), 'tresorerie')).toEqual([
      { compte: COMPTE_BANQUE, sens: 'credit', montant: 500, libelle: 'PRLV URSSAF' },
      { compte: COMPTE_COTISATIONS_EXPLOITANT, sens: 'debit', montant: 451.5, libelle: 'PRLV URSSAF' },
      { compte: COMPTE_EXPLOITANT, sens: 'debit', montant: 48.5, libelle: 'PRLV URSSAF' },
    ])
  })

  it('en engagement, tout va au 646000', () => {
    expect(ecritureDeLaCotisation(mouvement(), cotisation(), 'engagement')).toEqual([
      { compte: COMPTE_BANQUE, sens: 'credit', montant: 500, libelle: 'PRLV URSSAF' },
      { compte: COMPTE_COTISATIONS_EXPLOITANT, sens: 'debit', montant: 500, libelle: 'PRLV URSSAF' },
    ])
  })

  it('sans CSG-CRDS saisie, deux lignes : une ligne à zéro n’en est pas une', () => {
    expect(ecritureDeLaCotisation(mouvement(), cotisation({ montant_csg_crds: null }), 'tresorerie').map((l) => [l.compte, l.montant]))
      .toEqual([[COMPTE_BANQUE, 500], [COMPTE_COTISATIONS_EXPLOITANT, 500]])
    // Une échéance faite toute de CSG-CRDS : le 646000 vaudrait zéro, il n'est pas écrit.
    expect(ecritureDeLaCotisation(mouvement(), cotisation({ montant_csg_crds: 500 }), 'tresorerie').map((l) => [l.compte, l.montant]))
      .toEqual([[COMPTE_BANQUE, 500], [COMPTE_EXPLOITANT, 500]])
  })

  it('un remboursement crédite le 646000 et le 108000 : le sens vient du mouvement', () => {
    const ecrite = ecritureDeLaCotisation(mouvement({ montant: 120 }), cotisation({ montant_appele: -120, montant_csg_crds: -11.64 }), 'tresorerie')
    expect(ecrite.map((l) => [l.compte, l.sens, l.montant])).toEqual([
      [COMPTE_BANQUE, 'debit', 120],
      [COMPTE_COTISATIONS_EXPLOITANT, 'credit', 108.36],
      [COMPTE_EXPLOITANT, 'credit', 11.64],
    ])
  })

  it('compte en centimes : la différence tombe juste, et l’écriture s’équilibre', () => {
    // 0,30 − 0,10 vaut 0,19999999999999998 en flottants : la base refuserait la ligne.
    const petite = ecritureDeLaCotisation(mouvement({ montant: -0.3 }), cotisation({ montant_csg_crds: 0.1 }), 'tresorerie')
    expect(petite.find((l) => l.compte === COMPTE_COTISATIONS_EXPLOITANT)?.montant).toBe(0.2)
    // Seulement ce que le refus laisse passer : une CSG-CRDS plus grande que le mouvement n'est jamais écrite.
    let essais = 0
    for (const montant of [-0.03, -17.29, -1234.56, -98765.43, 45.67]) {
      for (const csg of [null, 0, 0.01, 9.99, Math.abs(montant)]) {
        const ligne = mouvement({ montant })
        const c = cotisation({ montant_csg_crds: csg, montant_appele: montant < 0 ? 100 : -100 })
        if (refusRapprochementCotisation(ligne, c, 'tresorerie')) continue
        essais++
        const lignes = ecritureDeLaCotisation(ligne, c, 'tresorerie')
        const debit = lignes.filter((l) => l.sens === 'debit').reduce((s, l) => s + Math.round(l.montant * 100), 0)
        const credit = lignes.filter((l) => l.sens === 'credit').reduce((s, l) => s + Math.round(l.montant * 100), 0)
        expect(debit).toBe(credit)
        expect(debit).toBe(Math.round(Math.abs(montant) * 100))
        for (const l of lignes) expect(Math.round(l.montant * 100) / 100).toBe(l.montant)
      }
    }
    expect(essais).toBe(24)
  })

  it('reprend le libellé brut quand le libellé est générique', () => {
    const lignes = ecritureDeLaCotisation(mouvement({ libelle: 'Mouvement bancaire', libelle_brut: 'PRLV SEPA URSSAF 012345' }), cotisation(), 'tresorerie')
    expect(new Set(lignes.map((l) => l.libelle))).toEqual(new Set(['PRLV SEPA URSSAF 012345']))
  })

  it('csgDeLEcriture : la valeur absolue en trésorerie, rien en engagement', () => {
    expect(csgDeLEcriture(cotisation({ montant_csg_crds: -11.64 }), 'tresorerie')).toBe(11.64)
    expect(csgDeLEcriture(cotisation({ montant_csg_crds: null }), 'tresorerie')).toBe(0)
    expect(csgDeLEcriture(cotisation(), 'engagement')).toBe(0)
  })
})

describe('cotisationsComptees — la date et le montant auxquels une échéance compte', () => {
  it('payée par un mouvement rapproché : à sa date et pour son montant', () => {
    // L'échéance de décembre prélevée en janvier compte l'année du prélèvement, comme son écriture au FEC.
    const [c] = cotisationsComptees([cotisation()], [rapproche()], 'tresorerie')
    expect(c).toMatchObject({ date: '2026-01-06', montant: 500, csgCrds: 48.5 })
    expect(c.ligne?.id).toBe('l1')
  })

  it('le montant est celui de la banque, pas celui de l’appel', () => {
    const [c] = cotisationsComptees([cotisation()], [rapproche({ montant: -498.5 })], 'tresorerie')
    expect(c.montant).toBe(498.5)
  })

  it('un remboursement compte en négatif, sa CSG-CRDS aussi', () => {
    const [c] = cotisationsComptees(
      [cotisation({ montant_appele: -120, montant_csg_crds: 11.64 })], [rapproche({ montant: 120 })], 'tresorerie')
    expect(c).toMatchObject({ date: '2026-01-06', montant: -120, csgCrds: -11.64 })
  })

  it('une CSG-CRDS non saisie reste inconnue, jamais zéro', () => {
    const [c] = cotisationsComptees([cotisation({ montant_csg_crds: null })], [rapproche()], 'tresorerie')
    expect(c.csgCrds).toBeNull()
  })

  it('sans mouvement : à son échéance, pour le versement saisi ou l’appel — la règle d’avant', () => {
    const comptees = cotisationsComptees([
      cotisation({ id: 'a', montant_verse: 480 }),
      cotisation({ id: 'b', montant_verse: null, montant_csg_crds: null }),
    ], [], 'tresorerie')
    expect(comptees.map((c) => [c.cotisation.id, c.date, c.montant, c.csgCrds, c.ligne])).toEqual([
      ['a', '2025-12-05', 480, 48.5, null],
      ['b', '2025-12-05', 500, null, null],
    ])
  })

  it('ne retient que les mouvements RAPPROCHÉS de CETTE échéance', () => {
    const comptees = cotisationsComptees([cotisation()], [
      rapproche({ id: 'autre', cotisation_id: 'c2', date: '2026-02-06' }),
      mouvement({ id: 'piece', statut: 'rapprochee', piece_id: 'p1', date: '2026-03-06' }),
      mouvement({ id: 'ignore', statut: 'ignoree', cotisation_id: 'c1', date: '2026-04-06' }),
    ], 'tresorerie')
    expect(comptees[0]).toMatchObject({ date: '2025-12-05', montant: 500, ligne: null })
  })

  it('un rapprochement qui ne peut pas s’écrire ne date rien', () => {
    // Un encaissement rapproché d'un appel, posé quand l'écran ne regardait pas le sens : l'échéance
    // reste comptée à son échéance, et la Checklist dit pourquoi.
    const [encaissement] = cotisationsComptees([cotisation()], [rapproche({ montant: 500 })], 'tresorerie')
    expect(encaissement).toMatchObject({ date: '2025-12-05', montant: 500, ligne: null })
    // Une CSG-CRDS qui dépasse le mouvement empêche l'écriture en trésorerie, pas en engagement.
    const depasse = cotisation({ montant_csg_crds: 900 })
    expect(cotisationsComptees([depasse], [rapproche()], 'tresorerie')[0].ligne).toBeNull()
    expect(cotisationsComptees([depasse], [rapproche()], 'engagement')[0]).toMatchObject({ date: '2026-01-06', montant: 500 })
  })

  it('dit pourquoi un rapprochement ne s’écrit pas, et seulement alors', () => {
    // La concordance de la 2035 le reprend : une échéance rapprochée à tort n'est pas une échéance que
    // personne n'a rapprochée, et le geste n'est pas le même.
    const [encaissement] = cotisationsComptees([cotisation()], [rapproche({ montant: 500 })], 'tresorerie')
    expect(encaissement.refus).toMatch(/^Ce mouvement est un encaissement/)
    const [payee, attente] = cotisationsComptees([cotisation(), cotisation({ id: 'c2' })], [rapproche()], 'tresorerie')
    expect(payee.refus).toBeNull()
    expect(attente.refus).toBeNull()
  })

  it('rend une entrée par échéance, dans l’ordre reçu', () => {
    const comptees = cotisationsComptees([cotisation({ id: 'x' }), cotisation({ id: 'c1' }), cotisation({ id: 'y' })], [rapproche()], 'tresorerie')
    expect(comptees.map((c) => [c.cotisation.id, c.date])).toEqual([
      ['x', '2025-12-05'], ['c1', '2026-01-06'], ['y', '2025-12-05'],
    ])
  })
})

describe('cotisationsAEcrire — les échéances payées dont l’écriture manque ou a changé', () => {
  it('un rapprochement sans écriture : celui d’avant le 01/10/2026', () => {
    const aEcrire = cotisationsAEcrire([], [rapproche()], [cotisation()], 'tresorerie', null)
    expect(aEcrire.map((r) => [r.ligne.id, r.cotisation.id])).toEqual([['l1', 'c1']])
  })

  it('se tait sur une écriture conforme, dans n’importe quel ordre', () => {
    expect(cotisationsAEcrire([...ECRITE].reverse(), [rapproche()], [cotisation()], 'tresorerie', null)).toEqual([])
  })

  it('une CSG-CRDS saisie après le rapprochement : l’écriture n’est plus celle qu’il produirait', () => {
    const ancienne = [ecriture({ id: 'e1' }), ecriture({ id: 'e2', compte: COMPTE_COTISATIONS_EXPLOITANT, sens: 'debit', montant: 500 })]
    expect(cotisationsAEcrire(ancienne, [rapproche()], [cotisation()], 'tresorerie', null)).toHaveLength(1)
    // La même écriture est juste en engagement, où la CSG-CRDS reste au 646000.
    expect(cotisationsAEcrire(ancienne, [rapproche()], [cotisation()], 'engagement', null)).toEqual([])
  })

  it('une ligne datée autrement que le mouvement', () => {
    const autreDate = ECRITE.map((e) => (e.id === 'e3' ? { ...e, date: '2025-12-05' } : e))
    expect(cotisationsAEcrire(autreDate, [rapproche()], [cotisation()], 'tresorerie', null)).toHaveLength(1)
  })

  // L'écriture ENTIÈRE à la date de l'échéance, cohérente avec elle-même : seule la comparaison à la date
  // du MOUVEMENT la voit. Une comparaison qui prendrait la date de la première ligne présente se tairait.
  it('toute l’écriture datée à l’échéance plutôt qu’au prélèvement', () => {
    const aLEcheance = ECRITE.map((e) => ({ ...e, date: '2025-12-05' }))
    expect(cotisationsAEcrire(aLEcheance, [rapproche()], [cotisation()], 'tresorerie', null)).toHaveLength(1)
  })

  it('ignore les écritures d’une pièce sur le même mouvement : elles appartiennent à la pièce', () => {
    const avecPiece = [...ECRITE, ecriture({ id: 'p', piece_id: 'p1', compte: '606100', sens: 'debit', montant: 12 })]
    expect(cotisationsAEcrire(avecPiece, [rapproche()], [cotisation()], 'tresorerie', null)).toEqual([])
  })

  it('ne rend ni un rapprochement qui ne peut pas s’écrire, ni une échéance qu’on n’a pas lue', () => {
    expect(cotisationsAEcrire([], [rapproche({ montant: 500 })], [cotisation()], 'tresorerie', null)).toEqual([])
    expect(cotisationsAEcrire([], [rapproche()], [], 'tresorerie', null)).toEqual([])
    expect(cotisationsAEcrire([], [rapproche({ statut: 'ignoree' })], [cotisation()], 'tresorerie', null)).toEqual([])
  })

  // NI UN PAIEMENT D'UN EXERCICE FIGÉ PAR LA VALIDATION : la base n'y écrit plus. L'exercice est celui du MOUVEMENT — une
  // échéance de décembre prélevée en janvier s'écrit dans l'exercice suivant —, frontière comprise.
  it('ne rend pas un paiement d’un exercice validé, jugé à la date du mouvement, frontière comprise', () => {
    // L'échéance du 05/12/2025, prélevée le 06/01/2026 : 2025 validé n'y change rien.
    expect(cotisationsAEcrire([], [rapproche()], [cotisation()], 'tresorerie', '2025-12-31')).toHaveLength(1)
    expect(cotisationsAEcrire([], [rapproche()], [cotisation()], 'tresorerie', '2026-12-31')).toEqual([])
    expect(cotisationsAEcrire([], [rapproche({ date: '2025-12-31' })], [cotisation()], 'tresorerie', '2025-12-31')).toEqual([])
    expect(cotisationsAEcrire([], [rapproche({ date: '2026-01-01' })], [cotisation()], 'tresorerie', '2025-12-31')).toHaveLength(1)
  })
})

describe('rapprochementsCotisationRefuses — ce qui ne s’écrira pas, avec sa raison', () => {
  it('un encaissement rapproché d’un appel', () => {
    const refuses = rapprochementsCotisationRefuses([rapproche({ montant: 500 }), rapproche({ id: 'l2', cotisation_id: 'c2' })],
      [cotisation(), cotisation({ id: 'c2' })], 'tresorerie', null)
    expect(refuses.map((r) => [r.ligne.id, r.raison])).toEqual([
      ['l1', 'Ce mouvement est un encaissement : il ne paie pas un appel de cotisation. Un remboursement se rapproche d’une échéance négative.'],
    ])
  })

  it('se tait sur une échéance qu’on n’a pas lue : on ne juge pas ce qu’on n’a pas vu', () => {
    expect(rapprochementsCotisationRefuses([rapproche({ montant: 500 })], [], 'tresorerie', null)).toEqual([])
  })

  it('suit le mode : une CSG-CRDS qui dépasse le mouvement ne gêne qu’en trésorerie', () => {
    const depasse = [cotisation({ montant_csg_crds: 900 })]
    expect(rapprochementsCotisationRefuses([rapproche()], depasse, 'tresorerie', null)).toHaveLength(1)
    expect(rapprochementsCotisationRefuses([rapproche()], depasse, 'engagement', null)).toEqual([])
  })

  // Rien d'un exercice figé par la validation : ni le mouvement ni l'échéance n'y changent plus, et le dire réclamerait un
  // geste que la base refuse. Le reste se dit comme avant — le garde symétrique.
  it('se tait sur un mouvement d’un exercice validé, frontière comprise', () => {
    expect(rapprochementsCotisationRefuses([rapproche({ montant: 500 })], [cotisation()], 'tresorerie', '2026-12-31')).toEqual([])
    expect(rapprochementsCotisationRefuses([rapproche({ montant: 500, date: '2025-12-31' })], [cotisation()], 'tresorerie', '2025-12-31')).toEqual([])
    expect(rapprochementsCotisationRefuses([rapproche({ montant: 500 })], [cotisation()], 'tresorerie', '2025-12-31')).toHaveLength(1)
  })
})

describe('avertissementRetraitEcheance — la confirmation nomme le mouvement qui paie l’échéance', () => {
  it('un prélèvement, avec sa date et son montant', () => {
    const phrase = avertissementRetraitEcheance(mouvement(), true)
    expect(phrase).toMatch(/^Le prélèvement du 06\/01\/2026 \(500,00\s€\) qui la paie redevient à traiter, et son écriture est retirée du brouillon\.$/)
  })

  it('un remboursement se nomme remboursement', () => {
    const phrase = avertissementRetraitEcheance(mouvement({ montant: 180 }), true)
    expect(phrase).toMatch(/^Le remboursement du 06\/01\/2026 \(180,00\s€\) qui la paie/)
  })

  it('sans mouvement : « aucun » sur un relevé lu en entier, le conditionnel sur un relevé lu en partie', () => {
    expect(avertissementRetraitEcheance(null, true)).toBe('Aucun mouvement bancaire ne la paie.')
    expect(avertissementRetraitEcheance(null, false)).toBe(
      'Si un mouvement bancaire la paie, il redevient à traiter, et son écriture est retirée du brouillon.',
    )
  })
})

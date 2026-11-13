import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { composerRegularisation, MOTS_DES_REFUS, prorataApresLaCloture, type ComptesDInventaire, type EcritureDInventaire } from './inventaire'
import {
  CHOIX_DU_CABINET, centimesDeLaSaisie, compteDeProvisionPropose, compteDeRegularisationPropose, confirmationDuRetrait, derniereValidee,
  declarationEnVigueur, ecrituresAJour, euros, evaluationDeLExercice, formulaireDeLOperation, formulaireDeProvisionVide, formulaireVide,
  MOTS_DES_PROVISIONS_A_L_ECRAN, natureAvecTvaDAttente, operationsDeLExercice, propositionDuProrata, provisionsDeLExercice,
  refusDeLaDeclarationALEcran, refusDuRetraitDeLaDeclarationALEcran, refusDuRetraitDeLaProvision, refusDuRetraitDeLOperation,
  regularisationsDeLExercice, texteDesCentimes, verdictDeLEvaluation, verdictDeLaProvision, verdictDeLaRegularisation,
  type ContexteDeLInventaire, type DonneesDeLInventaire, type FormulaireDeRegularisation, type LigneDuBrouillonDInventaire,
} from './inventaireEcran'
import { MOTS_DES_JUSTIFICATIFS, type JustificatifsDuDossier } from './justificatifsDeLInventaire'
import type { InventaireDeclare, OperationInventaire, Provision } from './types'

// L'ÉCRAN DE L'INVENTAIRE, SA LOGIQUE (ligne 35, INV5 ; lib/inventaireEcran.ts). Ce que ces cas gardent : un montant tapé lu au
// centime, jamais arrondi, jamais zéro quand il est illisible ; le verdict d'une saisie TELLE QU'ELLE PART — les refus du module
// de l'inventaire, dans son ordre, la période à la suite — et les arguments exacts des fonctions de la base ; la paire
// d'écritures de la confirmation ; le prorata proposé ; l'ouverture et l'évaluation d'une provision (par différence, sur la
// provision précédente LUE) ; les retraits, la déclaration ; et les mots que la base seule dit, confrontés à la migration. Des
// jeux FICTIFS.

// Les comptes d'un plan d'essai : des sous-comptes du cabinet, pour qu'aucun test ne passe parce qu'un compte en dur coïncide.
const COMPTES: ComptesDInventaire = {
  charges_constatees_avance: '486100', produits_constates_avance: '487100', factures_non_parvenues: '408110', factures_a_etablir: '418110',
  tva_factures_non_parvenues: '445861', tva_factures_a_etablir: '445871', provisions_risques: '151110', depreciation_clients: '491100',
  dotations_provisions_exploitation: '681510', dotations_depreciations_actif_circulant: '681740',
  reprises_provisions_exploitation: '781510', reprises_depreciations_actif_circulant: '781740',
}

const ctx = (p: Partial<ContexteDeLInventaire> = {}): ContexteDeLInventaire => ({
  mode: 'engagement', assujettiTva: true, exercice: 2025, anneesValidees: [], aujourdhui: '2026-11-12', ...p,
})

const operation = (p: Partial<OperationInventaire> & Pick<OperationInventaire, 'id'>): OperationInventaire => ({
  dossier_id: 'd1', exercice: 2025, nature: 'cca', compte_resultat: '616000', compte_regularisation: '486100', montant_centimes: 60_000,
  tva_centimes: 0, periode_debut: null, periode_fin: null, objet: 'Assurance du local', piece_citee_id: null, provision_id: null, version: 1,
  cree_par: 'u', cree_le: '2026-11-10T09:00:00Z', modifie_par: null, modifie_le: null, ...p,
})

const provision = (p: Partial<Provision> & Pick<Provision, 'id'>): Provision => ({
  dossier_id: 'd1', genre: 'risque', compte_provision: '151110', objet: 'Litige avec un fournisseur', facture_id: null, piece_citee_id: null,
  ouverte_en: 2025, reprise_centimes: null, version: 1, cree_par: 'u', cree_le: '2026-11-10T09:00:00Z', modifie_par: null, modifie_le: null, ...p,
})

const declaration = (p: Partial<InventaireDeclare> & Pick<InventaireDeclare, 'id'>): InventaireDeclare => ({
  dossier_id: 'd1', exercice: 2025, declare_par: 'u', declare_le: '2026-11-11T10:00:00Z', retire_par: null, retire_le: null, ...p,
})

const donnees = (p: Partial<DonneesDeLInventaire> = {}): DonneesDeLInventaire => ({
  operations: [], provisions: [], declarations: [], lignes: [], comptes: COMPTES, premierExercice: 2024, ...p,
})

const formulaire = (p: Partial<FormulaireDeRegularisation> = {}): FormulaireDeRegularisation => ({
  ...formulaireVide('cca', COMPTES), compteResultat: '616000', montant: '600,00', objet: 'Assurance du local, juillet 2025 à juin 2026', ...p,
})

describe('un montant tapé, en centimes exacts', () => {
  it('lit « 1 200,50 », « 1200.5 » et « 600 » exactement, sans flottant', () => {
    expect(centimesDeLaSaisie('1 200,50', false)).toBe(120_050)
    expect(centimesDeLaSaisie('1200.5', false)).toBe(120_050)
    expect(centimesDeLaSaisie('600', false)).toBe(60_000)
    expect(centimesDeLaSaisie('0,10', false)).toBe(10)
    expect(centimesDeLaSaisie('0', false)).toBe(0)
    expect(centimesDeLaSaisie('19 999 999,99 €', false)).toBe(1_999_999_999)
  })

  it('refuse (NaN) ce qui est illisible : trois décimales, un signe, une lettre — jamais zéro', () => {
    for (const t of ['1,234', '-5', '12a', '1,2,3', ',5', 'un euro']) expect(centimesDeLaSaisie(t, true), t).toBeNaN()
  })

  it('ne tient une saisie vide pour zéro que quand l’appelant le dit (la TVA d’attente), jamais pour un montant', () => {
    expect(centimesDeLaSaisie('  ', true)).toBe(0)
    expect(centimesDeLaSaisie('', false)).toBeNaN()
  })

  it('relit des centimes tels qu’une saisie les lit, pour remplir un formulaire', () => {
    expect(texteDesCentimes(120_050)).toBe('1200,50')
    expect(texteDesCentimes(5)).toBe('0,05')
    expect(centimesDeLaSaisie(texteDesCentimes(7_654_321), false)).toBe(7_654_321)
  })
})

describe('les choix du cabinet non tranchés : la recommandation du document', () => {
  it('la TVA d’attente (INV-Q3 A), la provision par différence (INV-Q4 A), le prorata en jours réels (INV-Q6 A)', () => {
    expect(CHOIX_DU_CABINET).toEqual({ tvaDesFacturesAttendues: 'ttc_avec_tva_d_attente', reajustement: 'par_difference', methodeDuProrata: 'jours_reels' })
  })
})

describe('la saisie d’une régularisation, jugée telle qu’elle part', () => {
  it('permet une charge constatée d’avance et rend les arguments exacts de la fonction de la base, la paire composée par le module', () => {
    const v = verdictDeLaRegularisation(formulaire(), ctx(), donnees(), null, null)
    if (v.etat !== 'permis') throw new Error(v.refus.join(' / '))
    const attendue = composerRegularisation({
      nature: 'cca', compteResultat: '616000', libelleCompteResultat: null, compteRegularisation: '486100', montantCentimes: 60_000, tvaCentimes: 0,
      objet: 'Assurance du local, juillet 2025 à juin 2026',
    }, {
      modeComptable: 'engagement', assujettiTva: true, comptes: COMPTES, exercice: { exercice: 2025, valide: false, anneeEnCours: 2026, premierExercice: 2024 },
      tvaDesFacturesAttendues: 'ttc_avec_tva_d_attente',
    })
    if (!attendue.ok) throw new Error('la composition attendue se refuse')
    expect(v.appel.ecritures).toEqual([attendue.constatation, attendue.extourne])
    expect(v.appel.operation).toEqual({
      id: null, exercice: 2025, nature: 'cca', compte_resultat: '616000', compte_regularisation: '486100', montant_centimes: 60_000, tva_centimes: 0,
      objet: 'Assurance du local, juillet 2025 à juin 2026', periode_debut: null, periode_fin: null, piece_citee_id: null,
    })
    expect(v.appel.versionLue).toBeNull()
    expect(v.constatation.date).toBe('2025-12-31')
    expect(v.extourne.date).toBe('2026-01-01')
  })

  it('la confirmation NOMME la paire : les deux dates, les comptes, les montants et le libellé qui part au FEC', () => {
    const v = verdictDeLaRegularisation(formulaire(), ctx(), donnees(), null, null)
    if (v.etat !== 'permis') throw new Error('refusé')
    expect(v.confirmation).toContain('Enregistrer cette régularisation ?')
    expect(v.confirmation).toContain(`Au 31/12/2025 : Débit 486100 ${euros(60_000)} ; Crédit 616000 ${euros(60_000)}.`)
    expect(v.confirmation).toContain(`Au 01/01/2026 (extourne) : Crédit 486100 ${euros(60_000)} ; Débit 616000 ${euros(60_000)}.`)
    expect(v.confirmation).toContain(`« ${v.constatation.libelle} »`)
    expect(v.constatation.libelle).toContain('CCA 31/12/2025')
  })

  it('un remplacement retient la version lue, l’identifiant et la pièce citée, et le dit', () => {
    const existante = operation({ id: 'o1', version: 4, piece_citee_id: 'p1', periode_debut: '2025-07-01', periode_fin: '2026-06-30' })
    const v = verdictDeLaRegularisation({ ...formulaireDeLOperation(existante), montant: '700,00' }, ctx(), donnees(), existante, null)
    if (v.etat !== 'permis') throw new Error(v.refus.join(' / '))
    expect(v.appel.versionLue).toBe(4)
    expect(v.appel.operation).toMatchObject({ id: 'o1', piece_citee_id: 'p1', montant_centimes: 70_000, periode_debut: '2025-07-01', periode_fin: '2026-06-30' })
    expect(v.confirmation).toContain('Remplacer cette régularisation ?')
  })

  it('une facture non parvenue d’un dossier assujetti porte sa TVA d’attente ; la composition la range sous son compte', () => {
    const f = formulaire({ ...formulaireVide('fnp', COMPTES), compteResultat: '622000', montant: '1 000,00', tva: '200,00', objet: 'Honoraires de décembre' })
    const v = verdictDeLaRegularisation(f, ctx(), donnees(), null, null)
    if (v.etat !== 'permis') throw new Error(v.refus.join(' / '))
    expect(v.constatation.lignes).toEqual([
      { compte: '622000', sens: 'debit', centimes: 100_000 }, { compte: '445861', sens: 'debit', centimes: 20_000 }, { compte: '408110', sens: 'credit', centimes: 120_000 },
    ])
    expect(v.appel.operation).toMatchObject({ tva_centimes: 20_000, montant_centimes: 100_000 })
  })

  it('le champ de TVA n’est offert qu’à une FNP ou une FAE d’un assujetti, et ignoré sinon', () => {
    expect(natureAvecTvaDAttente('fnp', true)).toBe(true)
    expect(natureAvecTvaDAttente('fae', true)).toBe(true)
    expect(natureAvecTvaDAttente('fnp', false)).toBe(false)
    expect(natureAvecTvaDAttente('cca', true)).toBe(false)
    const v = verdictDeLaRegularisation(formulaire({ tva: '40,00' }), ctx(), donnees(), null, null)
    expect(v.etat).toBe('permis')
    if (v.etat === 'permis') expect(v.appel.operation).toMatchObject({ tva_centimes: 0 })
  })

  it('refuse un dossier en trésorerie avant tout, sous les mots de la base', () => {
    const v = verdictDeLaRegularisation(formulaire({ montant: 'x' }), ctx({ mode: 'tresorerie' }), donnees(), null, null)
    expect(v).toEqual({ etat: 'refuse', refus: [MOTS_DES_REFUS.tresorerie] })
  })

  it('refuse un exercice validé, puis un exercice pas encore commencé, aux mots de la base', () => {
    expect(verdictDeLaRegularisation(formulaire(), ctx({ anneesValidees: [2024, 2025] }), donnees(), null, null))
      .toEqual({ etat: 'refuse', refus: [MOTS_DES_REFUS.exerciceFige] })
    expect(verdictDeLaRegularisation(formulaire(), ctx({ exercice: 2027 }), donnees(), null, null))
      .toEqual({ etat: 'refuse', refus: [MOTS_DES_REFUS.exerciceAVenir] })
    expect(verdictDeLaRegularisation(formulaire(), ctx({ exercice: 2023 }), donnees(), null, null))
      .toEqual({ etat: 'refuse', refus: [MOTS_DES_REFUS.avantLOuverture] })
  })

  it('dit le plan qui ne porte pas le compte du rôle, avant le clic', () => {
    const v = verdictDeLaRegularisation(formulaire(), ctx(), donnees({ comptes: {} }), null, null)
    expect(v.etat).toBe('refuse')
    if (v.etat === 'refuse') expect(v.refus[0]).toContain('Charges constatées d’avance')
  })

  it('refuse un montant illisible ou nul, un compte hors de sa classe, un objet vide — dans l’ordre du module', () => {
    const v = verdictDeLaRegularisation(formulaire({ compteResultat: '706000', compteRegularisation: '123456', montant: '12,345', objet: '  ' }), ctx(), donnees(), null, null)
    expect(v).toEqual({
      etat: 'refuse',
      refus: [MOTS_DES_REFUS.compteDeCharge, MOTS_DES_REFUS.compteDeRegularisation.cca, MOTS_DES_REFUS.montant, MOTS_DES_REFUS.objet],
    })
    const nul = verdictDeLaRegularisation(formulaire({ montant: '0' }), ctx(), donnees(), null, null)
    expect(nul).toEqual({ etat: 'refuse', refus: [MOTS_DES_REFUS.montant] })
  })

  it('juge la période après l’objet : les deux dates ou aucune, le début au plus tard à la fin, une date qui existe', () => {
    for (const periode of [{ periodeDebut: '2025-07-01' }, { periodeFin: '2026-06-30' }, { periodeDebut: '2026-06-30', periodeFin: '2025-07-01' }, { periodeDebut: '2025-02-30', periodeFin: '2026-06-30' }]) {
      expect(verdictDeLaRegularisation(formulaire(periode), ctx(), donnees(), null, null), JSON.stringify(periode))
        .toEqual({ etat: 'refuse', refus: [MOTS_DES_REFUS.periode] })
    }
    const ok = verdictDeLaRegularisation(formulaire({ periodeDebut: '2025-07-01', periodeFin: '2026-06-30' }), ctx(), donnees(), null, null)
    expect(ok.etat).toBe('permis')
    if (ok.etat === 'permis') expect(ok.appel.operation).toMatchObject({ periode_debut: '2025-07-01', periode_fin: '2026-06-30' })
    // L'objet illisible vient AVANT la période dans la liste, comme dans la base.
    const deux = verdictDeLaRegularisation(formulaire({ objet: '', periodeDebut: '2025-07-01' }), ctx(), donnees(), null, null)
    expect(deux).toEqual({ etat: 'refuse', refus: [MOTS_DES_REFUS.objet, MOTS_DES_REFUS.periode] })
  })

  it('propose le compte du plan pour les natures qui ont leur rôle, rien pour les autres', () => {
    expect(compteDeRegularisationPropose('cca', COMPTES)).toBe('486100')
    expect(compteDeRegularisationPropose('pca', COMPTES)).toBe('487100')
    expect(compteDeRegularisationPropose('fnp', COMPTES)).toBe('408110')
    expect(compteDeRegularisationPropose('fae', COMPTES)).toBe('418110')
    expect(compteDeRegularisationPropose('charge_a_payer', COMPTES)).toBe('')
    expect(compteDeRegularisationPropose('cca', {})).toBe('')
  })
})

describe('le prorata proposé, jamais imposé', () => {
  it('se tait tant que le montant de la pièce et les deux dates ne sont pas saisis', () => {
    expect(propositionDuProrata(formulaire(), ctx())).toBeNull()
    expect(propositionDuProrata(formulaire({ montantDeLaPiece: '2 400,00', periodeDebut: '2025-07-01' }), ctx())).toBeNull()
  })

  it('propose la part qui court après le 31 décembre, en jours réels, au même centime que le module', () => {
    const p = propositionDuProrata(formulaire({ montantDeLaPiece: '2 400,00', periodeDebut: '2025-07-01', periodeFin: '2026-06-30' }), ctx())
    const attendu = prorataApresLaCloture({ montantCentimes: 240_000, debut: '2025-07-01', fin: '2026-06-30', exercice: 2025 }, 'jours_reels')
    if (!attendu.ok || p === null || p.etat !== 'proposee') throw new Error('proposition attendue')
    expect(p.centimes).toBe(attendu.centimes)
    expect(p.phrase).toContain(`${attendu.joursApres} jour(s) sur ${attendu.joursDeLaPeriode}`)
    expect(p.phrase).toContain('jours réels')
  })

  it('dit le refus du module : une période entièrement avant la clôture, un montant illisible', () => {
    const avant = propositionDuProrata(formulaire({ montantDeLaPiece: '100', periodeDebut: '2025-01-01', periodeFin: '2025-06-30' }), ctx())
    expect(avant).toEqual({ etat: 'refusee', message: MOTS_DES_REFUS.periodeAvantLaCloture })
    const illisible = propositionDuProrata(formulaire({ montantDeLaPiece: 'abc', periodeDebut: '2025-07-01', periodeFin: '2026-06-30' }), ctx())
    expect(illisible).toEqual({ etat: 'refusee', message: MOTS_DES_REFUS.montant })
  })
})

describe('l’ouverture d’une provision', () => {
  const saisie = (p = {}) => ({ ...formulaireDeProvisionVide('risque', COMPTES), objet: 'Litige avec un fournisseur', ...p })

  it('permet une provision pour risques sur l’exercice affiché, sans facture ni pièce, et nomme ce qui part', () => {
    const v = verdictDeLaProvision(saisie(), ctx(), donnees(), null)
    if (v.etat !== 'permis') throw new Error(v.refus.join(' / '))
    expect(v.provision).toEqual({
      id: null, genre: 'risque', compte_provision: '151110', objet: 'Litige avec un fournisseur', ouverte_en: 2025, facture_id: null,
      piece_citee_id: null, reprise_centimes: null,
    })
    expect(v.confirmation).toContain('Aucune écriture ne part')
    expect(v.confirmation).toContain('Provision pour risques « Litige avec un fournisseur », au compte 151110, ouverte sur l’exercice 2025')
  })

  it('ne juge pas le plan des dotations et des reprises à l’ouverture : la base ne le lit qu’à l’évaluation', () => {
    expect(verdictDeLaProvision(saisie(), ctx(), donnees({ comptes: { provisions_risques: '151110' } }), null).etat).toBe('permis')
  })

  it('refuse un compte hors de sa racine, un objet vide, un dossier en trésorerie, aux mots de la base', () => {
    expect(verdictDeLaProvision(saisie({ compte: '491100' }), ctx(), donnees(), null)).toEqual({ etat: 'refuse', refus: [MOTS_DES_REFUS.compteDeProvision.risque] })
    expect(verdictDeLaProvision(saisie({ genre: 'depreciation_creance', compte: '151110' }), ctx(), donnees(), null))
      .toEqual({ etat: 'refuse', refus: [MOTS_DES_REFUS.compteDeProvision.depreciation_creance] })
    expect(verdictDeLaProvision(saisie({ objet: ' ' }), ctx(), donnees(), null)).toEqual({ etat: 'refuse', refus: [MOTS_DES_REFUS.objet] })
    expect(verdictDeLaProvision(saisie(), ctx({ mode: 'tresorerie' }), donnees(), null)).toEqual({ etat: 'refuse', refus: [MOTS_DES_REFUS.tresorerie] })
  })

  it('une part reprise s’ouvre au premier exercice du dossier seulement ; illisible, elle se refuse', () => {
    const premier = verdictDeLaProvision(saisie({ reprise: '3 000,00' }), ctx({ exercice: 2024 }), donnees({ premierExercice: 2024 }), null)
    expect(premier.etat).toBe('permis')
    if (premier.etat === 'permis') expect(premier.provision).toMatchObject({ reprise_centimes: 300_000, ouverte_en: 2024 })
    expect(verdictDeLaProvision(saisie({ reprise: '3 000,00' }), ctx(), donnees({ premierExercice: 2024 }), null))
      .toEqual({ etat: 'refuse', refus: [MOTS_DES_PROVISIONS_A_L_ECRAN.partRepriseHorsDuPremierExercice] })
    expect(verdictDeLaProvision(saisie({ reprise: '3x' }), ctx({ exercice: 2024 }), donnees({ premierExercice: 2024 }), null))
      .toEqual({ etat: 'refuse', refus: [MOTS_DES_REFUS.ciblePrecedente] })
  })

  it('propose le compte du plan selon le genre', () => {
    expect(compteDeProvisionPropose('risque', COMPTES)).toBe('151110')
    expect(compteDeProvisionPropose('depreciation_creance', COMPTES)).toBe('491100')
    expect(compteDeProvisionPropose('risque', {})).toBe('')
  })
})

describe('l’évaluation d’une provision, par différence', () => {
  const p = provision({ id: 'p1' })

  it('une première évaluation dote la cible entière (la provision précédente est nulle)', () => {
    const v = verdictDeLEvaluation(p, '5 000,00', ctx(), donnees({ provisions: [p] }))
    if (v.etat !== 'permis') throw new Error(v.refus.join(' / '))
    expect(v.precedente).toBe(0)
    expect(v.ecart).toBe(500_000)
    expect(v.ecriture?.lignes).toEqual([{ compte: '681510', sens: 'debit', centimes: 500_000 }, { compte: '151110', sens: 'credit', centimes: 500_000 }])
    expect(v.appel).toEqual({
      evaluation: { provision_id: 'p1', exercice: 2025, cible_centimes: 500_000 }, ecritures: [v.ecriture], versionLue: null,
    })
    expect(v.confirmation).toContain('Évaluer cette provision ?')
    expect(v.confirmation).toContain(`${euros(500_000)} au 31/12/2025, contre ${euros(0)} au 31/12/2024`)
    expect(v.confirmation).toContain(`Dotation au 31/12/2025 : Débit 681510 ${euros(500_000)} ; Crédit 151110 ${euros(500_000)}.`)
  })

  it('l’écart se compte sur la provision de l’exercice précédent LUE : une cible plus basse reprend la différence', () => {
    const d = donnees({ provisions: [p], operations: [operation({ id: 'e24', nature: 'provision', exercice: 2024, provision_id: 'p1', montant_centimes: 500_000, compte_resultat: '681510', compte_regularisation: '151110' })] })
    const v = verdictDeLEvaluation(p, '3 000,00', ctx(), d)
    if (v.etat !== 'permis') throw new Error(v.refus.join(' / '))
    expect(v.precedente).toBe(500_000)
    expect(v.ecart).toBe(-200_000)
    expect(v.ecriture?.lignes).toEqual([{ compte: '151110', sens: 'debit', centimes: 200_000 }, { compte: '781510', sens: 'credit', centimes: 200_000 }])
    expect(v.confirmation).toContain('Reprise au 31/12/2025')
  })

  it('un écart nul n’écrit rien : aucune écriture proposée à la base', () => {
    const d = donnees({ provisions: [p], operations: [operation({ id: 'e24', nature: 'provision', exercice: 2024, provision_id: 'p1', montant_centimes: 500_000 })] })
    const v = verdictDeLEvaluation(p, '5000', ctx(), d)
    if (v.etat !== 'permis') throw new Error(v.refus.join(' / '))
    expect(v.ecart).toBe(0)
    expect(v.ecriture).toBeNull()
    expect(v.appel.ecritures).toEqual([])
    expect(v.confirmation).toContain('Rien ne s’écrit.')
  })

  it('remplacer l’évaluation de l’exercice retient sa version lue', () => {
    const d = donnees({ provisions: [p], operations: [operation({ id: 'e25', nature: 'provision', exercice: 2025, provision_id: 'p1', montant_centimes: 100_000, version: 3 })] })
    const v = verdictDeLEvaluation(p, '2 000,00', ctx(), d)
    if (v.etat !== 'permis') throw new Error(v.refus.join(' / '))
    expect(v.appel.versionLue).toBe(3)
    expect(v.confirmation).toContain('Remplacer l’évaluation de cette provision ?')
    expect(evaluationDeLExercice(p, d.operations, 2025)?.id).toBe('e25')
    expect(evaluationDeLExercice(p, d.operations, 2026)).toBeNull()
  })

  it('refuse une cible illisible, un plan sans compte de dotation ou de reprise, un exercice validé', () => {
    expect(verdictDeLEvaluation(p, 'x', ctx(), donnees({ provisions: [p] }))).toEqual({ etat: 'refuse', refus: [MOTS_DES_REFUS.cible] })
    const sansPlan = verdictDeLEvaluation(p, '100', ctx(), donnees({ provisions: [p], comptes: {} }))
    expect(sansPlan.etat).toBe('refuse')
    if (sansPlan.etat === 'refuse') expect(sansPlan.refus[0]).toContain('Dotations aux provisions d’exploitation')
    expect(verdictDeLEvaluation(p, '100', ctx({ anneesValidees: [2025] }), donnees({ provisions: [p] })))
      .toEqual({ etat: 'refuse', refus: [MOTS_DES_REFUS.exerciceFige] })
  })

  it('dit ce que la base seule dit : pas encore ouverte, évaluée plus récemment, soldée', () => {
    expect(verdictDeLEvaluation(provision({ id: 'p1', ouverte_en: 2026 }), '100', ctx(), donnees({ provisions: [provision({ id: 'p1', ouverte_en: 2026 })] })))
      .toEqual({ etat: 'refuse', refus: [MOTS_DES_PROVISIONS_A_L_ECRAN.pasEncoreOuverte] })
    const recente = donnees({ provisions: [p], operations: [operation({ id: 'e26', nature: 'provision', exercice: 2026, provision_id: 'p1' })] })
    expect(verdictDeLEvaluation(p, '100', ctx(), recente)).toEqual({ etat: 'refuse', refus: [MOTS_DES_PROVISIONS_A_L_ECRAN.evalueePlusRecemment] })
    const soldee = donnees({ provisions: [p], operations: [operation({ id: 'e24', nature: 'provision', exercice: 2024, provision_id: 'p1', montant_centimes: 0 })] })
    expect(verdictDeLEvaluation(p, '100', ctx(), soldee)).toEqual({ etat: 'refuse', refus: [MOTS_DES_PROVISIONS_A_L_ECRAN.soldee] })
  })

  it('refuse une provision que la lecture ne rend pas', () => {
    const v = verdictDeLEvaluation(p, '100', ctx(), donnees())
    expect(v).toEqual({ etat: 'refuse', refus: ['La provision évaluée n’est pas une provision de ce dossier.'] })
  })
})

describe('les retraits', () => {
  it('une régularisation d’un exercice validé ne se retire pas, ni en trésorerie ; sinon elle se retire', () => {
    const o = operation({ id: 'o1' })
    expect(refusDuRetraitDeLOperation(o, ctx(), [o])).toBeNull()
    expect(refusDuRetraitDeLOperation(o, ctx({ anneesValidees: [2025] }), [o])).toBe(MOTS_DES_REFUS.exerciceFige)
    expect(refusDuRetraitDeLOperation(o, ctx({ mode: 'tresorerie' }), [o])).toBe(MOTS_DES_REFUS.tresorerie)
  })

  it('seule la dernière évaluation d’une provision se retire', () => {
    const e25 = operation({ id: 'e25', nature: 'provision', exercice: 2025, provision_id: 'p1' })
    const e26 = operation({ id: 'e26', nature: 'provision', exercice: 2026, provision_id: 'p1' })
    expect(refusDuRetraitDeLOperation(e25, ctx(), [e25, e26])).toBe(MOTS_DES_PROVISIONS_A_L_ECRAN.evalueePlusRecemment)
    expect(refusDuRetraitDeLOperation(e26, ctx({ exercice: 2026 }), [e25, e26])).toBeNull()
  })

  it('une provision déjà évaluée ne se retire pas ; une non évaluée se retire, sauf exercice validé', () => {
    const p = provision({ id: 'p1' })
    expect(refusDuRetraitDeLaProvision(p, ctx(), [])).toBeNull()
    expect(refusDuRetraitDeLaProvision(p, ctx(), [operation({ id: 'e', nature: 'provision', provision_id: 'p1' })])).toBe(MOTS_DES_PROVISIONS_A_L_ECRAN.dejaEvaluee)
    expect(refusDuRetraitDeLaProvision(p, ctx({ anneesValidees: [2025] }), [])).toBe(MOTS_DES_REFUS.exerciceFige)
    expect(refusDuRetraitDeLaProvision(p, ctx({ mode: 'tresorerie' }), [])).toBe(MOTS_DES_REFUS.tresorerie)
  })

  it('la confirmation d’un retrait nomme ce qui part', () => {
    const o = operation({ id: 'o1', objet: 'Assurance du local' })
    expect(confirmationDuRetrait(o)).toContain('Assurance du local')
    expect(confirmationDuRetrait(o)).toContain('31/12/2025')
    expect(confirmationDuRetrait(o)).toContain('01/01/2026')
    const e = operation({ id: 'e', nature: 'provision', objet: 'Litige', montant_centimes: 100_000 })
    expect(confirmationDuRetrait(e)).toContain('Litige')
    expect(confirmationDuRetrait(e)).not.toContain('01/01/2026')
  })
})

describe('la déclaration de l’inventaire', () => {
  it('se déclare quand l’exercice est clos ; pas avant son 31 décembre', () => {
    expect(refusDeLaDeclarationALEcran(ctx(), donnees())).toBeNull()
    expect(refusDeLaDeclarationALEcran(ctx({ exercice: 2026 }), donnees())).toContain('n’est pas clos')
  })

  it('refuse un dossier en trésorerie, un exercice validé, un inventaire déjà déclaré — aux mots de la base', () => {
    expect(refusDeLaDeclarationALEcran(ctx({ mode: 'tresorerie' }), donnees())).toBe(MOTS_DES_REFUS.tresorerie)
    expect(refusDeLaDeclarationALEcran(ctx({ anneesValidees: [2025] }), donnees())).toContain('est validé')
    expect(refusDeLaDeclarationALEcran(ctx(), donnees({ declarations: [declaration({ id: 'i1' })] }))).toContain('déjà déclaré')
  })

  it('une déclaration retirée ne compte plus : l’inventaire se déclare de nouveau', () => {
    const retiree = declaration({ id: 'i1', retire_le: '2026-11-12T08:00:00Z' })
    expect(refusDeLaDeclarationALEcran(ctx(), donnees({ declarations: [retiree] }))).toBeNull()
    expect(declarationEnVigueur([retiree], 2025)).toBeNull()
    expect(declarationEnVigueur([retiree, declaration({ id: 'i2' })], 2025)?.id).toBe('i2')
    expect(declarationEnVigueur([declaration({ id: 'i3', exercice: 2024 })], 2025)).toBeNull()
  })

  it('le retrait de la déclaration : refusé sur un exercice validé ou une déclaration déjà retirée', () => {
    expect(refusDuRetraitDeLaDeclarationALEcran(declaration({ id: 'i1' }), ctx())).toBeNull()
    expect(refusDuRetraitDeLaDeclarationALEcran(declaration({ id: 'i1' }), ctx({ anneesValidees: [2025] }))).toContain('est validé')
    expect(refusDuRetraitDeLaDeclarationALEcran(declaration({ id: 'i1', retire_le: '2026-11-12T08:00:00Z' }), ctx())).toContain('a changé')
  })

  it('le dernier exercice validé est le plus récent', () => {
    expect(derniereValidee([])).toBeNull()
    expect(derniereValidee([2023, 2025, 2024])).toBe(2025)
  })
})

describe('les écritures d’une régularisation, à jour ou à recomposer', () => {
  const o = operation({ id: 'o1' })
  const ligne = (e: EcritureDInventaire): LigneDuBrouillonDInventaire[] =>
    e.lignes.map((l) => ({ date: e.date, compte: l.compte, sens: l.sens, montant: l.centimes / 100, operation_inventaire_id: 'o1' }))

  it('à jour quand les lignes du brouillon sont la paire commandée, à recomposer sinon', () => {
    const v = verdictDeLaRegularisation(formulaire(), ctx(), donnees(), null, null)
    if (v.etat !== 'permis') throw new Error('refusé')
    const lignes = [...ligne(v.constatation), ...ligne(v.extourne)]
    expect(ecrituresAJour(o, donnees({ operations: [o], lignes }))).toBe(true)
    expect(ecrituresAJour(o, donnees({ operations: [o], lignes: lignes.slice(1) }))).toBe(false)
    expect(ecrituresAJour(o, donnees({ operations: [o], lignes: [] }))).toBe(false)
    expect(ecrituresAJour(o, donnees({ operations: [o], lignes: lignes.map((l, i) => (i === 0 ? { ...l, montant: 599.99 } : l)) }))).toBe(false)
  })
})

// LA PIÈCE CITÉE (INV5-Q1 (B)) : choisie dans l'onglet, elle part avec l'écriture ; une saisie qui remplace propose celle qui est
// déjà citée, que le cabinet change ou retire ; son refus suit ceux de la base, dans son ordre, et la confirmation la nomme.
describe('la pièce citée, choisie dans l’onglet', () => {
  const J: JustificatifsDuDossier = {
    pieces: [
      { id: 'p1', dossier_id: 'd1', nom_fichier: 'assurance-2025.pdf', date_piece: '2025-07-01', tiers: 'Assureur fictif', montant_ttc: 1200, type_piece: 'achat', statut: 'validee' },
      { id: 'v1', dossier_id: 'd1', nom_fichier: 'vente.pdf', date_piece: '2025-09-01', tiers: null, montant_ttc: 3000, type_piece: 'vente', statut: 'validee' },
    ],
    factures: [{ id: 'f1', dossier_id: 'd1', numero: 'F2025-007', statut: 'validee', type: 'facture', date_emission: '2025-10-01', tiers_nom: 'Client fictif', montant_ttc: 3000 }],
  }

  it('une saisie neuve ne cite rien ; la pièce choisie part dans l’appel et la confirmation la nomme', () => {
    expect(formulaireVide('cca', COMPTES).pieceCitee).toBeNull()
    const sans = verdictDeLaRegularisation(formulaire(), ctx(), donnees(), null, J)
    if (sans.etat !== 'permis') throw new Error('refusé')
    expect(sans.appel.operation.piece_citee_id).toBeNull()
    expect(sans.confirmation).toContain('Aucune pièce citée.')
    const avec = verdictDeLaRegularisation(formulaire({ pieceCitee: 'p1' }), ctx(), donnees(), null, J)
    if (avec.etat !== 'permis') throw new Error('refusé')
    expect(avec.appel.operation.piece_citee_id).toBe('p1')
    expect(avec.confirmation).toContain('Pièce citée : « assurance-2025.pdf »')
  })

  it('un remplacement propose la pièce déjà citée ; changée ou retirée, c’est la nouvelle qui part', () => {
    const existante = operation({ id: 'o1', version: 2, piece_citee_id: 'p1' })
    expect(formulaireDeLOperation(existante).pieceCitee).toBe('p1')
    const changee = verdictDeLaRegularisation({ ...formulaireDeLOperation(existante), pieceCitee: 'v1' }, ctx(), donnees(), existante, J)
    if (changee.etat !== 'permis') throw new Error('refusé')
    expect(changee.appel.operation).toMatchObject({ id: 'o1', piece_citee_id: 'v1' })
    const retiree = verdictDeLaRegularisation({ ...formulaireDeLOperation(existante), pieceCitee: null }, ctx(), donnees(), existante, J)
    if (retiree.etat !== 'permis') throw new Error('refusé')
    expect(retiree.appel.operation.piece_citee_id).toBeNull()
  })

  it('les pièces pas lues : la pièce déjà citée part telle quelle, la confirmation dit « déjà citée » sans la deviner', () => {
    const existante = operation({ id: 'o1', piece_citee_id: 'p1' })
    const v = verdictDeLaRegularisation(formulaireDeLOperation(existante), ctx(), donnees(), existante, null)
    if (v.etat !== 'permis') throw new Error('refusé')
    expect(v.appel.operation.piece_citee_id).toBe('p1')
    expect(v.confirmation).toContain('Pièce citée : celle qui était déjà citée.')
  })

  it('une pièce absente de ce qui est lu se refuse après la période, aux mots de la base', () => {
    const v = verdictDeLaRegularisation(formulaire({ pieceCitee: 'ailleurs', periodeDebut: '2025-12-31', periodeFin: '2025-01-01' }), ctx(), donnees(), null, J)
    expect(v).toEqual({ etat: 'refuse', refus: [MOTS_DES_REFUS.periode, MOTS_DES_JUSTIFICATIFS.pieceHorsDuDossier] })
  })

  it('une provision cite une pièce ou la facture d’une créance : l’une ou l’autre colonne, jamais les deux', () => {
    const base = { ...formulaireDeProvisionVide('depreciation_creance', COMPTES), objet: 'Créance douteuse' }
    expect(base.citation).toBeNull()
    const parFacture = verdictDeLaProvision({ ...base, citation: { genre: 'facture', id: 'f1' } }, ctx(), donnees(), J)
    if (parFacture.etat !== 'permis') throw new Error(parFacture.refus.join(' / '))
    expect(parFacture.provision).toMatchObject({ facture_id: 'f1', piece_citee_id: null })
    expect(parFacture.confirmation).toContain('Facture citée : Facture F2025-007')
    const parPiece = verdictDeLaProvision({ ...base, citation: { genre: 'piece', id: 'v1' } }, ctx(), donnees(), J)
    if (parPiece.etat !== 'permis') throw new Error(parPiece.refus.join(' / '))
    expect(parPiece.provision).toMatchObject({ facture_id: null, piece_citee_id: 'v1' })
  })

  it('le refus de ce qu’elle cite vient après l’objet et avant la part reprise, dans l’ordre de la base', () => {
    const v = verdictDeLaProvision(
      { ...formulaireDeProvisionVide('risque', COMPTES), objet: ' ', reprise: '10,00', citation: { genre: 'facture', id: 'f1' } }, ctx(), donnees(), J,
    )
    expect(v).toEqual({
      etat: 'refuse',
      refus: [MOTS_DES_REFUS.objet, MOTS_DES_JUSTIFICATIFS.factureHorsDeLaDepreciation, MOTS_DES_PROVISIONS_A_L_ECRAN.partRepriseHorsDuPremierExercice],
    })
    expect(verdictDeLaProvision({ ...formulaireDeProvisionVide('depreciation_creance', COMPTES), objet: 'x', citation: { genre: 'piece', id: 'p1' } }, ctx(), donnees(), J))
      .toEqual({ etat: 'refuse', refus: [MOTS_DES_JUSTIFICATIFS.pieceHorsDesVentes] })
  })
})

describe('l’ordre et le tri de l’exercice', () => {
  it('une exercice par exercice : les natures dans l’ordre du document, puis l’objet', () => {
    const ops = [
      operation({ id: 'b', nature: 'fnp', objet: 'B' }), operation({ id: 'a', nature: 'cca', objet: 'Z' }), operation({ id: 'c', nature: 'cca', objet: 'A' }),
      operation({ id: 'd', nature: 'provision', objet: 'P' }), operation({ id: 'x', exercice: 2024, nature: 'cca', objet: 'Autre exercice' }),
    ]
    expect(operationsDeLExercice(ops, 2025).map((o) => o.id)).toEqual(['c', 'a', 'b', 'd'])
    expect(regularisationsDeLExercice(ops, 2025).map((o) => o.id)).toEqual(['c', 'a', 'b'])
  })

  it('les provisions d’un exercice : celles ouvertes sur lui ou avant, la plus ancienne d’abord', () => {
    const ps = [provision({ id: 'b', ouverte_en: 2025 }), provision({ id: 'a', ouverte_en: 2024 }), provision({ id: 'c', ouverte_en: 2026 })]
    expect(provisionsDeLExercice(ps, 2025).map((p) => p.id)).toEqual(['a', 'b'])
  })
})

// LES MOTS QUE LA BASE SEULE DIT, confrontés à la migration `provisions` (INV4) : l'écran les redit avant le clic, et un mot
// qui dérive de la migration est une faute.
describe('les mots des provisions, ceux de la migration', () => {
  const MIGRATION = readFileSync(new URL('../../supabase/preparees/20261112230000_provisions.sql', import.meta.url), 'utf8')

  it('chaque refus que l’écran redit se trouve dans la migration, au même mot', () => {
    for (const [cle, mot] of Object.entries(MOTS_DES_PROVISIONS_A_L_ECRAN)) expect(MIGRATION, cle).toContain(mot)
  })
})

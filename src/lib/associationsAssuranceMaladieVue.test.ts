import { describe, expect, it } from 'vitest'
import {
  EN_LECTURE, assuranceMaladieDeLaFiche, associesPourLesVentes, confirmationDuLot, importsAssocies, rapprochementDeLOnglet,
  refusDuRetraitDImportDit, retenusParLesVentes, type LectureDesPaiements,
} from './associationsAssuranceMaladieVue'
import { MOTS_DU_CABINET } from './espaceVentes'
import { MUET, REFUS_DU_RETRAIT_D_UN_IMPORT_ASSOCIE, type MouvementDuRapprochement, type PaiementDuRapprochement } from './rapprochementAssuranceMaladie'

// Ce que l'écran de l'association (NOE5b) calcule et dit : rien sous le drapeau baissé ; muet tant qu'une lecture n'est pas
// revenue ou pas entière ; les crédits associés que les candidats d'une vente écartent, nuls (illisibles) sur une lecture
// partielle ; la confirmation du lot nomme chaque crédit par sa date et son montant, jamais par son libellé. Des jeux FICTIFS.

const mouvement = (o: Partial<MouvementDuRapprochement> & Pick<MouvementDuRapprochement, 'id'>): MouvementDuRapprochement => ({
  date: '2026-03-05', montant: 123.45, libelle: 'VIR CPAM 0012345678260303', libelle_brut: null, statut: 'non_rapprochee',
  prelevement_personnel: false, encaissements_de_factures: false, ...o,
})
const PAIEMENT: PaiementDuRapprochement = {
  id: 'p1', date_journee_comptable: '2026-03-03', regime: 1, caisse: 691, part: 'obligatoire', montant_centimes: 12345, nombre_de_factures: 3,
}
const lue = <T>(lignes: T[], complete = true) => ({ lignes, complete, motif: complete ? null : 'coupée' })
const ASSOCIATION = { id: 'a1', dossier_id: 'd1', paiement_id: 'p1', ligne_bancaire_id: 'm1', associe_par: 'u', associe_le: '2026-03-06T09:00:00Z' }
const lus = (associations: typeof ASSOCIATION[] | null, complete = true): LectureDesPaiements =>
  ({ etat: 'lus', paiements: lue([PAIEMENT]), associations: associations === null ? null : lue(associations, complete) })
const RELEVE = { lignes: [mouvement({ id: 'm1' })], complet: true }
const SANS_OBJET = { etat: 'sans_objet' } as const

describe('le rapprochement de l’onglet', () => {
  it('drapeau baissé : rien ; pas encore lu, ou une lecture coupée : muet, et le module dit laquelle', () => {
    expect(rapprochementDeLOnglet(false, lus([]), RELEVE, SANS_OBJET, [], '2026-11-17')).toBeNull()
    expect(rapprochementDeLOnglet(true, null, RELEVE, SANS_OBJET, [], '2026-11-17')).toEqual({ etat: 'muet', raison: EN_LECTURE })
    expect(rapprochementDeLOnglet(true, lus([]), { ...RELEVE, complet: false }, SANS_OBJET, [], '2026-11-17'))
      .toEqual({ etat: 'muet', raison: MUET.releve })
    expect(rapprochementDeLOnglet(true, lus([], false), RELEVE, SANS_OBJET, [], '2026-11-17')).toEqual({ etat: 'muet', raison: MUET.associations })
    expect(rapprochementDeLOnglet(true, lus([]), RELEVE, { etat: 'en_cours' }, [], '2026-11-17')).toEqual({ etat: 'muet', raison: MUET.ventes })
    const echec = rapprochementDeLOnglet(true, { etat: 'echec', motif: 'refus' }, RELEVE, SANS_OBJET, [], '2026-11-17')
    expect(echec?.etat === 'muet' && echec.raison).toContain('(refus)')
  })

  it('les mouvements que la règle G2 retient : aucun hors bascule, ceux des ventes lues, nuls sinon', () => {
    expect(retenusParLesVentes(SANS_OBJET)).toEqual(new Set())
    expect(retenusParLesVentes({ etat: 'incomplete', motif: 'x' })).toBeNull()
  })

  it('la fiche : muette sur un crédit de l’assurance maladie seulement ; calculée, l’état du mouvement', () => {
    const muet = { etat: 'muet', raison: EN_LECTURE } as const
    expect(assuranceMaladieDeLaFiche(muet, { id: 'm1', montant: 10, libelle: 'VIR CPAM X', libelle_brut: null }).genre).toBe('muet')
    expect(assuranceMaladieDeLaFiche(muet, { id: 'm1', montant: 10, libelle: 'VIR CLIENT', libelle_brut: null }).genre).toBe('rien')
    expect(assuranceMaladieDeLaFiche(muet, { id: 'm1', montant: -10, libelle: 'PRLV CPAM', libelle_brut: null }).genre).toBe('rien')
    expect(assuranceMaladieDeLaFiche(null, { id: 'm1', montant: 10, libelle: 'VIR CPAM', libelle_brut: null }).genre).toBe('rien')
    const r = rapprochementDeLOnglet(true, lus([]), RELEVE, SANS_OBJET, [], '2026-11-17')
    const fiche = assuranceMaladieDeLaFiche(r, { id: 'm1', montant: 123.45, libelle: 'VIR CPAM', libelle_brut: null })
    expect(fiche.genre === 'etat' && [fiche.mouvementId, fiche.etat.genre]).toEqual(['m1', 'propose'])
  })

  it('la confirmation du lot compte, nomme chaque crédit par sa date et son montant, jamais par son libellé', () => {
    const r = rapprochementDeLOnglet(true, lus([]), RELEVE, SANS_OBJET, [], '2026-11-17')
    if (r?.etat !== 'calcule') throw new Error('muet')
    const { resume, lignes } = confirmationDuLot(r)
    expect(resume).toMatch(/^Associer 1 crédit du relevé à son paiement/)
    expect(lignes.map((l) => l.replace(/[\u00a0\u202f]/g, ' '))).toEqual(
      ['Crédit du 05/03/2026 (123,45 €) ← journée comptable du 03/03/2026, organisme régime 1, caisse 691, part obligatoire, 3 factures'])
    expect(lignes.join(' ')).not.toContain('VIR CPAM')
  })
})

describe('les crédits associés, pour les candidats d’une vente (NOE5-Q4 (A))', () => {
  it('drapeau baissé : aucun ; levé, ceux des associations lues en entier ; sinon nul (illisibles)', () => {
    expect(associesPourLesVentes(false, null)).toEqual(new Set())
    expect(associesPourLesVentes(true, lus([ASSOCIATION]))).toEqual(new Set(['m1']))
    expect(associesPourLesVentes(true, lus([ASSOCIATION], false))).toBeNull()
    expect(associesPourLesVentes(true, lus(null))).toBeNull()
    expect(associesPourLesVentes(true, null)).toBeNull()
    expect(associesPourLesVentes(true, { etat: 'echec', motif: 'x' })).toBeNull()
  })
})

describe('le retrait d’un import associé, dit avant le clic', () => {
  it('les imports dont un paiement est associé ; aucun sans la table ; nul sur une lecture partielle', () => {
    const paiements = [{ id: 'p1', import_id: 'i1' }, { id: 'p2', import_id: 'i2' }]
    expect(importsAssocies(paiements, lue([{ paiement_id: 'p1' }]))).toEqual(new Set(['i1']))
    expect(importsAssocies(paiements, null)).toEqual(new Set())
    expect(importsAssocies(paiements, lue([{ paiement_id: 'p1' }], false))).toBeNull()
  })

  it('au cabinet, les mots de la base ; au praticien, à qui s’adresser, sans un mot du cabinet', () => {
    expect(refusDuRetraitDImportDit('cabinet')).toContain(REFUS_DU_RETRAIT_D_UN_IMPORT_ASSOCIE)
    const client = refusDuRetraitDImportDit('client')
    expect(MOTS_DU_CABINET.filter((m) => m.motif.test(client)).map((m) => m.nom)).toEqual([])
  })
})

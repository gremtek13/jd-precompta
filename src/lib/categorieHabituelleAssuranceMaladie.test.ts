import { describe, expect, it } from 'vitest'
import type { AssuranceMaladieDeLaFiche } from './associationsAssuranceMaladieVue'
import {
  BOUTON_CATEGORIE_HABITUELLE, categorieHabituelleDite, categorieHabituelleDuCredit,
} from './categorieHabituelleAssuranceMaladie'
import type { RapprochementCalcule } from './rapprochementAssuranceMaladie'
import type { LigneBancaire } from './types'

// NOE5B-Q1 (B) : la fiche d'un crédit associé, encore à traiter, propose la catégorie la plus fréquente des AUTRES crédits
// associés du dossier ; rien à égalité, rien sur une lecture partielle, rien d'écrit. Données FICTIVES.

const rapprochement = (associes: string[]): RapprochementCalcule => ({
  etat: 'calcule', parMouvement: new Map(), concordances: [], controles: [], mouvementsParId: new Map(), paiementsParId: new Map(),
  paiementsAssocies: new Set(), mouvementsAssocies: new Set(associes), retenusParLesVentes: new Set(), anneesValidees: new Set(),
})
const fiche = (associes: string[], o: { fige?: boolean; mouvementId?: string } = {}): AssuranceMaladieDeLaFiche => ({
  genre: 'etat', mouvementId: o.mouvementId ?? 'm0', rapprochement: rapprochement(associes),
  etat: { genre: 'associe', paiementIds: ['p0'], paiementsCentimes: 1000, coherent: true, fige: o.fige ?? false },
})
const CREDIT: Pick<LigneBancaire, 'id' | 'montant' | 'statut' | 'categorie_id'> = { id: 'm0', montant: 10, statut: 'non_rapprochee', categorie_id: null }
const mvt = (id: string, categorie_id: string | null, ventilee = false) => ({ id, categorie_id, ventilee })
const HONORAIRES = { id: 'c-hon', libelle: 'Honoraires', compte_comptable: '706000' }
const AUTRES = { id: 'c-aut', libelle: 'Autres recettes', compte_comptable: '708000' }
const FRAIS = { id: 'c-frais', libelle: 'Frais bancaires', compte_comptable: '627000' }
const toutes = { lignes: [HONORAIRES, AUTRES, FRAIS], complete: true }
const RELEVE = [mvt('m0', null), mvt('m1', 'c-hon'), mvt('m2', 'c-hon'), mvt('m3', 'c-aut'), mvt('m4', null)]
const ASSOCIES = ['m0', 'm1', 'm2', 'm3', 'm4']

describe('la catégorie habituelle d’un crédit associé', () => {
  it('la plus fréquente des autres crédits associés classés, avec ses comptes', () => {
    expect(categorieHabituelleDuCredit(fiche(ASSOCIES), CREDIT, RELEVE, toutes))
      .toEqual({ categorieId: 'c-hon', libelle: 'Honoraires', dansLaCategorie: 2, classes: 3 })
  })

  it('rien à égalité, ni sans autre crédit classé ; un crédit ventilé ne compte pas', () => {
    expect(categorieHabituelleDuCredit(fiche(['m0', 'm1', 'm3']), CREDIT, RELEVE, toutes)).toBeNull()
    expect(categorieHabituelleDuCredit(fiche(['m0', 'm4']), CREDIT, RELEVE, toutes)).toBeNull()
    const ventile = [mvt('m0', null), mvt('m1', 'c-hon'), mvt('m3', 'c-aut'), mvt('m5', 'c-aut', true)]
    expect(categorieHabituelleDuCredit(fiche(['m0', 'm1', 'm3', 'm5']), CREDIT, ventile, toutes)).toBeNull()
  })

  it('rien sur des catégories lues en partie, un crédit associé absent du relevé, une catégorie qui n’est plus une recette', () => {
    expect(categorieHabituelleDuCredit(fiche(ASSOCIES), CREDIT, RELEVE, { ...toutes, complete: false })).toBeNull()
    expect(categorieHabituelleDuCredit(fiche(ASSOCIES), CREDIT, RELEVE, null)).toBeNull()
    expect(categorieHabituelleDuCredit(fiche([...ASSOCIES, 'm9']), CREDIT, RELEVE, toutes)).toBeNull()
    expect(categorieHabituelleDuCredit(fiche(ASSOCIES), CREDIT, RELEVE, { lignes: [AUTRES, FRAIS], complete: true })).toBeNull()
    const enCharge = { lignes: [{ ...HONORAIRES, compte_comptable: '627000' }, AUTRES], complete: true }
    expect(categorieHabituelleDuCredit(fiche(ASSOCIES), CREDIT, RELEVE, enCharge)).toBeNull()
  })

  it('rien hors d’un crédit associé encore à traiter, non figé, de cette fiche', () => {
    expect(categorieHabituelleDuCredit(fiche(ASSOCIES, { fige: true }), CREDIT, RELEVE, toutes)).toBeNull()
    expect(categorieHabituelleDuCredit(fiche(ASSOCIES, { mouvementId: 'm1' }), CREDIT, RELEVE, toutes)).toBeNull()
    expect(categorieHabituelleDuCredit(fiche(ASSOCIES), { ...CREDIT, categorie_id: 'c-aut' }, RELEVE, toutes)).toBeNull()
    expect(categorieHabituelleDuCredit(fiche(ASSOCIES), { ...CREDIT, statut: 'rapprochee' }, RELEVE, toutes)).toBeNull()
    expect(categorieHabituelleDuCredit(fiche(ASSOCIES), { ...CREDIT, montant: -10 }, RELEVE, toutes)).toBeNull()
    expect(categorieHabituelleDuCredit({ genre: 'rien' }, CREDIT, RELEVE, toutes)).toBeNull()
    expect(categorieHabituelleDuCredit({ genre: 'muet', raison: 'lecture partielle' }, CREDIT, RELEVE, toutes)).toBeNull()
  })

  it('la phrase nomme la catégorie et ses comptes, dit que rien ne s’écrit avant « Affecter »', () => {
    const p = categorieHabituelleDite({ categorieId: 'c-hon', libelle: 'Honoraires', dansLaCategorie: 2, classes: 3 })
    expect(p).toContain('« Honoraires » (2 sur 3 classés)')
    expect(p).toContain('rien ne s’écrit avant « Affecter »')
    expect(categorieHabituelleDite({ categorieId: 'c-hon', libelle: 'Honoraires', dansLaCategorie: 1, classes: 1 })).toContain('(1 sur 1 classé)')
    expect(BOUTON_CATEGORIE_HABITUELLE).toBe('Choisir cette catégorie')
  })
})

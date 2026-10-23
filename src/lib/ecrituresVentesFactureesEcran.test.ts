import { describe, expect, it } from 'vitest'
import { encaissementVendu, factureVendue, ligneVendue } from '../test/ventesFacturees'
import {
  argumentsEcrireVenteFacturee, argumentsRetirerEcritureVenteFacturee, refusEcritureVenteFacturee,
  refusRetraitEcritureVenteFacturee, REFUS_COMPTE_CONTREPARTIE, REFUS_ECRITURE_VENTE,
} from './ecritureVenteFacturee'
import { ecrituresDesVentesFacturees, lignesAuBrouillon, type EcritureVenteFacturee } from './ecrituresVentesFacturees'
import {
  LIBELLE_ETAT_SOURCE, MOTIF_NE_SE_COMPOSENT_PAS, argumentsDuChoix, argumentsDuGeste, choixInchange, compositionDesSources,
  compteSaisi, confirmationDuChoix, confirmationDuGeste, ecrituresDesVentesPourLa2035, ecrituresEnClair, etatsDesVentesFacturees, ligneDUneVenteFacturee, mouvementsClassesParEncaissements, refusDuChoix,
  type EncaissementDesEcritures, type EntreesEcrituresDeVente, type EtatsDesVentes, type FactureDesEcritures,
  type LigneDuBrouillonLue, type MouvementDesEcritures, type SourceDeVenteEtat, type SourcesDesEcrituresDeVente,
} from './ecrituresVentesFactureesEcran'
import type { ExemplaireLu, LigneDeFacture } from './encaissementsFactures'
import { formatMoney } from './format'
import { PLAN_DECALE, PLAN_PAR_DEFAUT, type PlanComptable } from './planComptable'
import type { ModeComptable } from './types'
import type { PartVendue } from './ventesFacturees'

// L'ÉTAT DE CHAQUE SOURCE D'UNE VENTE FACTURÉE, DANS L'ONGLET ÉCRITURES (chantier EC-Q3, étape VF4c1 ;
// lib/ecrituresVentesFactureesEcran.ts) : chaque état, dans les deux modèles comptables et sous les deux plans ; la
// frontière d'un exercice validé ; les écritures périmées de R3 (« à réécrire », « à retirer ») ; le choix du compte de
// contrepartie, jugé sur la saisie telle qu'elle part ; et chaque refus, celui des fonctions de lib/ecritureVenteFacturee.ts,
// jamais une règle recopiée. Données FICTIVES.

const D = 'd1'
const MODES: readonly ModeComptable[] = ['tresorerie', 'engagement']
const PLANS: readonly [string, PlanComptable][] = [['plan par défaut', PLAN_PAR_DEFAUT], ['plan décalé', PLAN_DECALE]]

const facture = (o: Partial<FactureDesEcritures> = {}): FactureDesEcritures => ({ ...factureVendue(o), montant_ttc: 120, ...o })
const encaissement = (
  o: Partial<EncaissementDesEcritures> & Pick<EncaissementDesEcritures, 'id' | 'date_encaissement' | 'montant'>,
): { encaissement: EncaissementDesEcritures; part: PartVendue } => {
  const { encaissement: e, part } = encaissementVendu(o)
  return { encaissement: { ...e, compte_contrepartie: o.compte_contrepartie ?? null, cree_par: o.cree_par ?? null }, part }
}
const mouvement = (o: Partial<MouvementDesEcritures> & Pick<MouvementDesEcritures, 'id' | 'date' | 'montant'>): MouvementDesEcritures => ({
  dossier_id: D, libelle: 'VIR CLIENT FICTIF', source_fichier: 'releve-fictif.csv', encaissements_de_factures: true,
  statut: o.encaissements_de_factures === false ? 'non_rapprochee' : 'rapprochee', piece_id: null, cotisation_id: null,
  categorie_id: null, emprunt_id: null, compte_bilan: null, declaration_tva_id: null, ventilee: false, reglement_groupe: false,
  prelevement_personnel: false, ...o,
})

interface Jeu {
  factures?: FactureDesEcritures[]
  lignes?: LigneDeFacture[]
  encaissements?: { encaissement: EncaissementDesEcritures; part: PartVendue }[]
  mouvements?: MouvementDesEcritures[]
  // Les pièces désignées (étape VF5h, le virement mixte) ; aucune par défaut.
  exemplaires?: ExemplaireLu[]
}

function sources(jeu: Jeu): SourcesDesEcrituresDeVente {
  const encs = jeu.encaissements ?? []
  return {
    dossierId: D, factures: jeu.factures ?? [facture()], lignes: jeu.lignes ?? [ligneVendue('f1', 100, 20)],
    encaissements: encs.map((e) => e.encaissement), parts: encs.map((e) => e.part), mouvements: jeu.mouvements ?? [],
    exemplaires: jeu.exemplaires ?? [],
  }
}

let ligneNumero = 0
/** Les lignes que la fonction de VF4b aurait écrites pour ces écritures, proposées (ou validées). */
function auBrouillon(ecritures: readonly EcritureVenteFacturee[], statut: 'proposee' | 'validee' = 'proposee'): LigneDuBrouillonLue[] {
  return ecritures.flatMap((e) => lignesAuBrouillon(D, e).map((l) => ({
    ...l, id: `b${++ligneNumero}`, statut, immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null,
  })))
}

function etats(jeu: Jeu, o: Partial<EntreesEcrituresDeVente> = {}): Extract<EtatsDesVentes, { etat: 'lus' }> {
  const r = etatsDesVentesFacturees({
    sources: sources(jeu), brouillon: [], mode: 'tresorerie', plan: PLAN_PAR_DEFAUT, anneesValidees: [], ventesParLesFactures: true, ...o,
  })
  if (r.etat !== 'lus') throw new Error(`incohérent : ${r.motif}`)
  return r
}

const parCle = (r: { sources: SourceDeVenteEtat[] }, cle: string) => r.sources.find((s) => s.cle === cle)
const enc1 = 'encaissement|e1'

// Le cas de base : une facture de services de 120 € TTC, encaissée par un virement du même jour, que son mouvement porte.
const VIREMENT: Jeu = {
  encaissements: [encaissement({ id: 'e1', date_encaissement: '2025-11-20', montant: 120, ligne_bancaire_id: 'm1' })],
  mouvements: [mouvement({ id: 'm1', date: '2025-11-20', montant: 120 })],
}

describe('les états, dans les deux modèles et sous les deux plans', () => {
  for (const mode of MODES) {
    for (const [nomPlan, plan] of PLANS) {
      describe(`${mode}, ${nomPlan}`, () => {
        const base = { mode, plan }

        it('rien au brouillon : chaque source qui écrit est « à écrire », son geste « Écrire », sans refus', () => {
          const r = etats(VIREMENT, base)
          const e1 = parCle(r, enc1)!
          expect(e1.etat).toBe('a_ecrire')
          expect(e1.geste).toBe('ecrire')
          expect(e1.refus).toBeNull()
          expect(e1.aEcrire.length).toBeGreaterThan(0)
          // En engagement, la facture écrit sa créance ; en trésorerie (des services), rien : elle n'est pas listée.
          expect(parCle(r, 'facture|f1')?.etat).toBe(mode === 'engagement' ? 'a_ecrire' : undefined)
          // Le mouvement du même jour, sans écart : rien à écrire, rien à dire.
          expect(parCle(r, 'mouvement|m1')).toBeUndefined()
        })

        it('le brouillon porte exactement la composition : « à jour », sans geste', () => {
          const premier = etats(VIREMENT, base)
          const brouillon = premier.sources.flatMap((s) => auBrouillon(s.aEcrire))
          const r = etats(VIREMENT, { ...base, brouillon })
          for (const s of r.sources) {
            expect(s.etat, s.cle).toBe('a_jour')
            expect(s.geste, s.cle).toBeNull()
          }
          // Le libellé n'en décide pas : la base ne le compare pas.
          const relibelle = brouillon.map((l) => ({ ...l, libelle: 'autre libellé' }))
          expect(etats(VIREMENT, { ...base, brouillon: relibelle }).sources.every((s) => s.etat === 'a_jour')).toBe(true)
        })

        it('une ligne proposée qui n’est plus la composition (R3) : « à réécrire », et le geste envoie la composition', () => {
          const premier = etats(VIREMENT, base)
          const brouillon = auBrouillon(parCle(premier, enc1)!.aEcrire)
          brouillon[0] = { ...brouillon[0], montant: brouillon[0].montant + 0.01 }
          const r = etats(VIREMENT, { ...base, brouillon })
          const e1 = parCle(r, enc1)!
          expect(e1.etat).toBe('a_reecrire')
          expect(e1.geste).toBe('reecrire')
          expect(e1.proposees).toHaveLength(brouillon.length)
          expect(argumentsDuGeste(e1, r.contexte)).toEqual({
            fonction: 'ecrire_vente_facturee', args: argumentsEcrireVenteFacturee(D, e1.source, r.contexte.composition, []),
          })
        })

        it('une ligne de trop, à une date que la source n’écrit pas : « à réécrire »', () => {
          const premier = etats(VIREMENT, base)
          const brouillon = auBrouillon(parCle(premier, enc1)!.aEcrire)
          const r = etats(VIREMENT, { ...base, brouillon: [...brouillon, { ...brouillon[0], id: 'b-de-trop', date: '2025-11-21' }] })
          expect(parCle(r, enc1)!.etat).toBe('a_reecrire')
        })

        it('un encaissement retiré qui garde ses lignes (R3) : « à retirer », par la fonction du retrait, sans refus', () => {
          const premier = etats(VIREMENT, base)
          const brouillon = auBrouillon(parCle(premier, enc1)!.aEcrire)
          const retire: Jeu = {
            ...VIREMENT,
            encaissements: [encaissement({ id: 'e1', date_encaissement: '2025-11-20', montant: 120, ligne_bancaire_id: 'm1', retire_le: '2025-11-25T08:00:00Z' })],
          }
          const r = etats(retire, { ...base, brouillon })
          const e1 = parCle(r, enc1)!
          expect(e1.etat).toBe('a_retirer')
          expect(e1.geste).toBe('retirer')
          expect(e1.refus).toBeNull()
          expect(e1.aEcrire).toEqual([])
          expect(argumentsDuGeste(e1, r.contexte)).toEqual({
            fonction: 'retirer_ecriture_vente_facturee', args: argumentsRetirerEcritureVenteFacturee(D, e1.source),
          })
          // Sans ses lignes, l'encaissement retiré n'a plus rien à dire.
          expect(parCle(etats(retire, base), enc1)).toBeUndefined()
        })
      })
    }
  }
})

describe('la frontière d’un exercice validé', () => {
  for (const mode of MODES) {
    it(`${mode} : une source écrite et validée est « validée », sans geste ; datée d’un exercice validé sans écriture, « validée » et le manque dit`, () => {
      const base = { mode, plan: PLAN_PAR_DEFAUT }
      const ouvert = etats(VIREMENT, base)
      const brouillon = auBrouillon(parCle(ouvert, enc1)!.aEcrire, 'validee')
      const valide = etats(VIREMENT, { ...base, brouillon, anneesValidees: [2025] })
      const e1 = parCle(valide, enc1)!
      expect(e1.etat).toBe('validee')
      expect(e1.geste).toBeNull()
      expect(e1.validees).toBe(brouillon.length)
      expect(e1.detail).toMatch(/validées avec leur exercice/)
      const sansEcriture = parCle(etats(VIREMENT, { ...base, anneesValidees: [2025] }), enc1)!
      expect(sansEcriture.etat).toBe('validee')
      expect(sansEcriture.validees).toBe(0)
      expect(sansEcriture.detail).toMatch(/aucune écriture : rien ne s’y écrit plus/)
    })
  }

  it('engagement : une facture validée en 2025 et son encaissement de 2026 — la facture « validée », l’encaissement « à écrire »', () => {
    const jeu: Jeu = {
      encaissements: [encaissement({ id: 'e1', date_encaissement: '2026-01-15', montant: 120, ligne_bancaire_id: 'm1' })],
      mouvements: [mouvement({ id: 'm1', date: '2026-01-15', montant: 120 })],
    }
    const base = { mode: 'engagement' as const, plan: PLAN_PAR_DEFAUT }
    const facture2025 = auBrouillon(parCle(etats(jeu, base), 'facture|f1')!.aEcrire, 'validee')
    const r = etats(jeu, { ...base, brouillon: facture2025, anneesValidees: [2025] })
    expect(parCle(r, 'facture|f1')!.etat).toBe('validee')
    const e1 = parCle(r, enc1)!
    expect(e1.etat).toBe('a_ecrire')
    expect(e1.refus).toBeNull()
    expect(e1.aEcrire.every((e) => e.date > '2025-12-31')).toBe(true)
  })

  it('engagement : un bien facturé en 2025 et livré en 2026 — sa part ouverte « à écrire », et sa part validée dite', () => {
    const jeu: Jeu = { factures: [facture({ nature_operation: 'biens', date_emission: '2025-12-20', date_prestation: '2026-01-05' })] }
    const base = { mode: 'engagement' as const, plan: PLAN_PAR_DEFAUT }
    const toutes = parCle(etats(jeu, base), 'facture|f1')!.aEcrire
    expect(toutes.map((e) => e.date)).toEqual(['2025-12-20', '2026-01-05'])
    const r = etats(jeu, { ...base, brouillon: auBrouillon(toutes.slice(0, 1), 'validee'), anneesValidees: [2025] })
    const f1 = parCle(r, 'facture|f1')!
    expect(f1.etat).toBe('a_ecrire')
    expect(f1.aEcrire.map((e) => e.date)).toEqual(['2026-01-05'])
    expect(f1.detail).toMatch(/Sa part datée d’un exercice validé ne se réécrit plus\.$/)
    // Et l'écriture ouverte, une fois au brouillon, est « à jour » : la part validée n'entre pas dans la comparaison.
    const ecrite = etats(jeu, { ...base, brouillon: [...auBrouillon(toutes.slice(0, 1), 'validee'), ...auBrouillon(f1.aEcrire)], anneesValidees: [2025] })
    expect(parCle(ecrite, 'facture|f1')!.etat).toBe('a_jour')
  })

  it('un encaissement daté de l’exercice validé ne s’écrit plus : la base le dirait, l’écran ne l’offre pas', () => {
    const r = etats(VIREMENT, { anneesValidees: [2025] })
    const e1 = parCle(r, enc1)!
    expect(e1.geste).toBeNull()
    // Le module de VF4b le confirme : rien à écrire après la frontière.
    expect(refusEcritureVenteFacturee(e1.source, r.contexte)?.cle).toBe('rien_a_ecrire')
  })
})

describe('ce qui ne s’écrit pas, et pourquoi', () => {
  const compensation = (o: Partial<EncaissementDesEcritures> = {}): Jeu => ({
    encaissements: [encaissement({ id: 'e1', date_encaissement: '2025-11-20', montant: 120, moyen: 'compensation', ...o })],
  })

  it('une compensation sans compte : « ne s’écrit pas », le compte à choisir, et ce que le choix changera', () => {
    const r = etats(compensation())
    const e1 = parCle(r, enc1)!
    expect(e1.etat).toBe('ne_s_ecrit_pas')
    expect(e1.motif).toBe('compte_a_choisir')
    expect(e1.geste).toBeNull()
    expect(e1.choixDuCompte).toEqual({ encaissementId: 'e1', geste: 'choisir', actuel: null, apresLeChoix: 'a_ecrire' })
    expect(confirmationDuChoix(e1, '467100')).toMatch(/Choisir le compte 467100 comme contrepartie de l’encaissement du 20\/11\/2025 .*« à écrire »/)
  })

  it('le refus du choix se lit sur la saisie TELLE QU’ELLE PART : sans espaces, nulle quand elle est vide', () => {
    const r = etats(compensation())
    expect(compteSaisi(' 467 100 ')).toBe('467100')
    expect(compteSaisi('   ')).toBeNull()
    expect(refusDuChoix('e1', '', r.contexte)).toMatchObject({ cle: 'compte_absent' })
    expect(refusDuChoix('e1', '411000', r.contexte)).toMatchObject({ cle: 'compte_refuse' })
    expect(refusDuChoix('e1', '411000', r.contexte)?.message)
      .toBe('Le compte des clients est celui que l’encaissement solde : il n’en est pas la contrepartie.')
    expect(refusDuChoix('e1', '467 100', r.contexte)).toBeNull()
    expect(argumentsDuChoix(r.contexte, 'e1', '467 100')).toEqual({ p_dossier_id: D, p_encaissement_id: 'e1', p_compte: '467100' })
    // Les mots sont ceux de la base, rang par rang.
    expect(REFUS_COMPTE_CONTREPARTIE.map((x) => x.cle)).toContain('compte_absent')
  })

  it('un compte choisi puis remplacé (R3) : l’écriture proposée sur l’ancien compte est « à réécrire », et le compte se change encore', () => {
    const avecA = compensation({ compte_contrepartie: '467100' })
    const brouillon = auBrouillon(parCle(etats(avecA), enc1)!.aEcrire)
    expect(brouillon.some((l) => l.compte === '467100')).toBe(true)
    const r = etats(compensation({ compte_contrepartie: '467200' }), { brouillon })
    const e1 = parCle(r, enc1)!
    expect(e1.etat).toBe('a_reecrire')
    // Depuis l'étape VF4c3 (VF4C1-Q1), un compte accepté se change encore, tant que l'exercice n'est pas validé.
    expect(e1.choixDuCompte).toEqual({ encaissementId: 'e1', geste: 'changer', actuel: '467200', apresLeChoix: 'a_reecrire' })
  })

  it('« Changer le compte » (VF4C1-Q1) : offert sur un compte accepté, à écrire ou à jour ; la confirmation nomme l’ancien et le nouveau', () => {
    const avecA = compensation({ compte_contrepartie: '467100' })
    const aEcrire = parCle(etats(avecA), enc1)!
    expect(aEcrire.etat).toBe('a_ecrire')
    expect(aEcrire.choixDuCompte).toEqual({ encaissementId: 'e1', geste: 'changer', actuel: '467100', apresLeChoix: 'a_ecrire' })
    expect(confirmationDuChoix(aEcrire, '467200')).toBe(
      `Changer le compte de contrepartie de ${aEcrire.nom}, du 467100 au 467200 ? Aucune écriture n’est encore passée : il reste « à écrire ».`,
    )
    const aJour = parCle(etats(avecA, { brouillon: auBrouillon(aEcrire.aEcrire) }), enc1)!
    expect(aJour.etat).toBe('a_jour')
    expect(aJour.choixDuCompte).toEqual({ encaissementId: 'e1', geste: 'changer', actuel: '467100', apresLeChoix: 'a_reecrire' })
    expect(confirmationDuChoix(aJour, '467200')).toBe(
      `Changer le compte de contrepartie de ${aJour.nom}, du 467100 au 467200 ? Son écriture déjà passée, sur le 467100, deviendra « à réécrire » : elle se réécrit ensuite d’ici, sur un clic.`,
    )
    // Le même compte ne part pas — l'écran le dit ; la base l'accepterait, ce n'est pas un de ses refus.
    expect(choixInchange(aJour.choixDuCompte!, ' 467 100 ')).toBe(true)
    expect(choixInchange(aJour.choixDuCompte!, '467200')).toBe(false)
    expect(refusDuChoix('e1', '467100', etats(avecA).contexte)).toBeNull()
    // Un choix (à choisir, refusé) n'est jamais « inchangé ».
    expect(choixInchange({ encaissementId: 'e1', geste: 'choisir', actuel: '512000', apresLeChoix: 'a_ecrire' }, '512000')).toBe(false)
  })

  it('« Changer le compte » ne s’offre ni dans un exercice validé, ni hors d’une compensation, ni pour une contre-passation', () => {
    const avecA = compensation({ compte_contrepartie: '467100' })
    const brouillon = auBrouillon(parCle(etats(avecA), enc1)!.aEcrire, 'validee')
    const valide = parCle(etats(avecA, { brouillon, anneesValidees: [2025] }), enc1)!
    expect(valide.etat).toBe('validee')
    expect(valide.choixDuCompte).toBeNull()
    // Un virement qui cite son mouvement : son compte est celui du moyen de paiement.
    expect(parCle(etats(VIREMENT), enc1)!.choixDuCompte).toBeNull()
    // La contre-passation d'une compensation s'écrit sur le compte de l'encaissement qu'elle annule.
    const cp = etats({
      encaissements: [
        encaissement({ id: 'e1', date_encaissement: '2025-11-20', montant: 120, moyen: 'compensation', compte_contrepartie: '467100' }),
        encaissement({ id: 'c1', date_encaissement: '2025-11-25', montant: -120, moyen: 'compensation', annule_id: 'e1' }),
      ],
    })
    expect(parCle(cp, 'encaissement|c1')!.choixDuCompte).toBeNull()
    expect(parCle(cp, enc1)!.choixDuCompte?.geste).toBe('changer')
    // Un compte resté sur un encaissement qui cite un mouvement (une forme que la base refuse, qu'une restauration pourrait
    // rendre) : il s'écrit par son mouvement, et la base refuserait d'en changer le compte — rien ne s'offre.
    const avecMouvement = etats({
      encaissements: [encaissement({ id: 'e1', date_encaissement: '2025-11-20', montant: 120, moyen: 'compensation', ligne_bancaire_id: 'm1', compte_contrepartie: '467100' })],
      mouvements: [mouvement({ id: 'm1', date: '2025-11-20', montant: 120 })],
    })
    expect(parCle(avecMouvement, enc1)!.etat).toBe('a_ecrire')
    expect(parCle(avecMouvement, enc1)!.choixDuCompte).toBeNull()
  })

  it('un compte devenu refusé sur un encaissement écrit : « à retirer », et le choix d’un autre compte le rendra « à réécrire »', () => {
    const brouillon = auBrouillon(parCle(etats(compensation({ compte_contrepartie: '467100' })), enc1)!.aEcrire)
    const r = etats(compensation({ compte_contrepartie: '512000' }), { brouillon })
    const e1 = parCle(r, enc1)!
    expect(e1.etat).toBe('a_retirer')
    expect(e1.motif).toBe('compte_refuse')
    expect(e1.choixDuCompte).toEqual({ encaissementId: 'e1', geste: 'choisir', actuel: '512000', apresLeChoix: 'a_reecrire' })
    expect(e1.refus).toBe(refusRetraitEcritureVenteFacturee(e1.source, r.contexte, brouillon)?.message ?? null)
  })

  it('un mouvement d’un autre jour : classé, il s’écrit ; pas encore classé, il attend ; déclassé avec ses lignes (R3), il se retire', () => {
    const jeu = (classe: boolean): Jeu => ({
      encaissements: [encaissement({ id: 'e1', date_encaissement: '2025-11-20', montant: 120, moyen: 'cheque', ligne_bancaire_id: 'm1' })],
      mouvements: [mouvement({ id: 'm1', date: '2025-11-22', montant: 120, encaissements_de_factures: classe })],
    })
    const classe = etats(jeu(true))
    const m1 = parCle(classe, 'mouvement|m1')!
    expect(m1.etat).toBe('a_ecrire')
    expect(m1.refus).toBeNull()
    expect(m1.nom).toBe(`le mouvement du 22/11/2025 « VIR CLIENT FICTIF » (${formatMoney(120)})`)
    const nonClasse = parCle(etats(jeu(false)), 'mouvement|m1')!
    expect(nonClasse.etat).toBe('ne_s_ecrit_pas')
    expect(nonClasse.motif).toBe('mouvement_non_classe')
    expect(nonClasse.geste).toBeNull()
    const lignes = auBrouillon(m1.aEcrire)
    const declasse = etats(jeu(false), { brouillon: lignes })
    const m = parCle(declasse, 'mouvement|m1')!
    expect(m.etat).toBe('a_retirer')
    expect(m.motif).toBe('mouvement_non_classe')
    expect(m.refus).toBeNull()
    expect(m.detail).toMatch(/^Cette source ne s’écrit plus — le mouvement n’est pas encore classé/)
  })

  it('un mouvement classé AUTREMENT, cité par un encaissement retiré : ses lignes sans pièce sont de cet autre classement, rien n’est listé', () => {
    const jeu: Jeu = {
      encaissements: [encaissement({ id: 'e1', date_encaissement: '2025-11-20', montant: 120, ligne_bancaire_id: 'm1', retire_le: '2025-11-21T08:00:00Z' })],
      mouvements: [mouvement({ id: 'm1', date: '2025-11-20', montant: 120, encaissements_de_factures: false, statut: 'rapprochee', categorie_id: 'c1' })],
    }
    const affectation: LigneDuBrouillonLue = {
      id: 'b-aff', dossier_id: D, statut: 'proposee', facture_id: null, encaissement_id: null, ligne_bancaire_id: 'm1', piece_id: null,
      immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null, date: '2025-11-20', compte: '706000',
      montant: 120, sens: 'credit',
    }
    expect(etats(jeu, { brouillon: [affectation] }).sources).toEqual([])
  })

  it('une ligne sans pièce d’un mouvement libre qu’AUCUN encaissement d’une facture source ne cite : pas une vente facturée', () => {
    const orpheline: LigneDuBrouillonLue = {
      id: 'b-orph', dossier_id: D, statut: 'proposee', facture_id: null, encaissement_id: null, ligne_bancaire_id: 'm9', piece_id: null,
      immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null, date: '2025-11-20', compte: '512000',
      montant: 10, sens: 'debit',
    }
    const jeu: Jeu = { mouvements: [mouvement({ id: 'm9', date: '2025-11-20', montant: 10, encaissements_de_factures: false })] }
    expect(etats(jeu, { brouillon: [orpheline] }).sources).toEqual([])
  })

  it('un encaissement retiré dont les lignes sont validées : « validée », jamais « à retirer »', () => {
    const lignes = auBrouillon(parCle(etats(VIREMENT), enc1)!.aEcrire, 'validee')
    const retire: Jeu = {
      ...VIREMENT,
      encaissements: [encaissement({ id: 'e1', date_encaissement: '2025-11-20', montant: 120, ligne_bancaire_id: 'm1', retire_le: '2026-01-05T08:00:00Z' })],
    }
    const e1 = parCle(etats(retire, { brouillon: lignes, anneesValidees: [2025] }), enc1)!
    expect(e1.etat).toBe('validee')
    expect(e1.geste).toBeNull()
  })

  it('l’avoir d’une facture écartée, qui garde des lignes : « à retirer », et le motif est celui de sa facture', () => {
    const jeu: Jeu = {
      factures: [facture({ nature_operation: null }), facture({ id: 'a1', type: 'avoir', numero: 'A2025-0001', facture_origine_id: 'f1', montant_ttc: -12 })],
      lignes: [ligneVendue('f1', 100, 20), { ...ligneVendue('a1', 10, 20), quantite: -1 }],
    }
    const ligneAvoir: LigneDuBrouillonLue = {
      id: 'b-a1', dossier_id: D, statut: 'proposee', facture_id: 'a1', encaissement_id: null, ligne_bancaire_id: null, piece_id: null,
      immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null, date: '2025-11-10', compte: '411000',
      montant: 12, sens: 'credit',
    }
    const a1 = parCle(etats(jeu, { mode: 'engagement', brouillon: [ligneAvoir] }), 'avoir|a1')!
    expect(a1.etat).toBe('a_retirer')
    expect(a1.motif).toBe('vente_ecartee')
    expect(a1.detail).toMatch(/la facture F2025-0001 ne se compte pas sans deviner/)
  })

  it('une facture que le module écarte : elle et son encaissement « ne s’écrivent pas », sous les mots du module', () => {
    const jeu: Jeu = { ...VIREMENT, factures: [facture({ nature_operation: null })] }
    const r = etats(jeu)
    const f1 = parCle(r, 'facture|f1')!
    expect(f1.etat).toBe('ne_s_ecrit_pas')
    expect(f1.motif).toBe('vente_ecartee')
    const e1 = parCle(r, enc1)!
    expect(e1.etat).toBe('ne_s_ecrit_pas')
    expect(e1.motif).toBe('vente_ecartee')
    expect(e1.detail).toMatch(/ne dit pas si elle porte sur des biens ou sur des services/)
  })
})

describe('les refus viennent du module de la base', () => {
  it('un dossier qui n’a pas basculé : le refus de la base, sous ses mots, avant le clic', () => {
    const r = etats(VIREMENT, { ventesParLesFactures: false })
    const e1 = parCle(r, enc1)!
    expect(e1.geste).toBe('ecrire')
    expect(e1.refus).toBe(REFUS_ECRITURE_VENTE.find((x) => x.cle === 'dossier_non_bascule')!.modele)
  })

  it('chaque refus offert est exactement celui des fonctions de lib/ecritureVenteFacturee.ts', () => {
    const premier = etats(VIREMENT, { mode: 'engagement' })
    const brouillon = premier.sources.flatMap((s) => auBrouillon(s.aEcrire))
    brouillon[0] = { ...brouillon[0], montant: 1 }
    for (const ventesParLesFactures of [true, false]) {
      const r = etats(VIREMENT, { mode: 'engagement', brouillon, ventesParLesFactures })
      for (const s of r.sources) {
        const attendu = s.geste === 'retirer'
          ? refusRetraitEcritureVenteFacturee(s.source, r.contexte, brouillon)?.message ?? null
          : s.geste ? refusEcritureVenteFacturee(s.source, r.contexte)?.message ?? null : null
        expect(s.refus, s.cle).toBe(attendu)
      }
    }
  })
})

describe('la lecture qui ne se tient pas, l’ordre, les mots', () => {
  it('une écriture qui cite une facture ou un encaissement que la lecture n’a pas rendu : « incohérent », aucun état', () => {
    const ligne: LigneDuBrouillonLue = {
      id: 'b1', dossier_id: D, statut: 'proposee', facture_id: 'f-inconnue', encaissement_id: null, ligne_bancaire_id: null,
      piece_id: null, immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null,
      date: '2025-11-10', compte: '411000', montant: 120, sens: 'debit',
    }
    const entrees = { sources: sources(VIREMENT), mode: 'tresorerie' as const, plan: PLAN_PAR_DEFAUT, anneesValidees: [], ventesParLesFactures: true }
    expect(etatsDesVentesFacturees({ ...entrees, brouillon: [ligne] }).etat).toBe('incoherent')
    expect(etatsDesVentesFacturees({ ...entrees, brouillon: [{ ...ligne, facture_id: null, encaissement_id: 'e-inconnu' }] }).etat).toBe('incoherent')
    // Une ligne d'un autre dossier ne compte pas.
    expect(etatsDesVentesFacturees({ ...entrees, brouillon: [{ ...ligne, dossier_id: 'd2' }] }).etat).toBe('lus')
  })

  it('les sources se rangent par date, puis facture, avoir, encaissement, mouvement', () => {
    const jeu: Jeu = {
      factures: [facture(), facture({ id: 'a1', type: 'avoir', numero: 'A2025-0001', facture_origine_id: 'f1', date_emission: '2025-11-10', montant_ttc: -12 })],
      lignes: [ligneVendue('f1', 100, 20), { ...ligneVendue('a1', 10, 20), quantite: -1 }],
      encaissements: [encaissement({ id: 'e1', date_encaissement: '2025-11-10', montant: 108, moyen: 'cheque', ligne_bancaire_id: 'm1' })],
      mouvements: [mouvement({ id: 'm1', date: '2025-11-10', montant: 108 })],
    }
    const r = etats(jeu, { mode: 'engagement' })
    expect(r.sources.map((s) => s.cle)).toEqual(['facture|f1', 'avoir|a1', enc1])
    expect(parCle(r, 'avoir|a1')!.nom).toBe('l’avoir A2025-0001 (Client fictif)')
    expect(parCle(r, 'avoir|a1')!.montant).toBe(-12)
  })

  it('une contre-passation se nomme comme telle', () => {
    const jeu: Jeu = {
      encaissements: [
        encaissement({ id: 'e1', date_encaissement: '2025-11-20', montant: 120, moyen: 'especes' }),
        encaissement({ id: 'e2', date_encaissement: '2025-11-25', montant: -120, moyen: 'especes', annule_id: 'e1', cree_le: '2025-11-25T10:00:00Z' }),
      ],
    }
    const e2 = parCle(etats(jeu), 'encaissement|e2')!
    expect(e2.nom).toBe(`la contre-passation du 25/11/2025 de la facture F2025-0001 (Client fictif, espèces, ${formatMoney(-120)})`)
    expect(e2.etat).toBe('a_ecrire')
  })

  it('les dates d’abord : un encaissement d’avant la facture d’un autre client passe avant elle', () => {
    const jeu: Jeu = {
      factures: [facture({ id: 'f1', date_emission: '2025-11-20' }), facture({ id: 'f2', numero: 'F2025-0002', date_emission: '2025-11-25' })],
      lignes: [ligneVendue('f1', 100, 20), ligneVendue('f2', 100, 20)],
      encaissements: [encaissement({ id: 'e1', facture_id: 'f1', date_encaissement: '2025-11-22', montant: 120, moyen: 'especes' })],
    }
    expect(etats(jeu, { mode: 'engagement' }).sources.map((s) => s.cle)).toEqual(['facture|f1', enc1, 'facture|f2'])
  })

  it('chaque état a son libellé, et la confirmation nomme la source et ses lignes', () => {
    expect(Object.keys(LIBELLE_ETAT_SOURCE).sort()).toEqual(['a_ecrire', 'a_jour', 'a_reecrire', 'a_retirer', 'ne_s_ecrit_pas', 'validee'])
    const r = etats(VIREMENT)
    const e1 = parCle(r, enc1)!
    expect(e1.nom).toBe(`l’encaissement du 20/11/2025 de la facture F2025-0001 (Client fictif, virement, ${formatMoney(120)})`)
    expect(ecrituresEnClair(e1.aEcrire)).toBe(`le 20/11/2025 : 445710 au crédit ${formatMoney(20)} ; 512000 au débit ${formatMoney(120)} ; 706000 au crédit ${formatMoney(100)}`)
    expect(confirmationDuGeste(e1)).toBe(`Écrire ${e1.nom} au brouillon : ${ecrituresEnClair(e1.aEcrire)}. La base recompose l’écriture et la refuse si elle diffère.`)
    const brouillon = auBrouillon(e1.aEcrire)
    brouillon[0] = { ...brouillon[0], montant: 1 }
    const reecrire = parCle(etats(VIREMENT, { brouillon }), enc1)!
    expect(confirmationDuGeste(reecrire)).toMatch(/^Réécrire l’encaissement .* \? Ses 3 lignes proposées sont remplacées par le 20\/11\/2025 : /)
    const retirer: SourceDeVenteEtat = { ...reecrire, geste: 'retirer', validees: 2 }
    expect(confirmationDuGeste(retirer)).toMatch(/^Retirer du brouillon les 3 lignes proposées de l’encaissement .* Ses 2 lignes validées restent : un exercice validé ne se rouvre pas\.$/)
  })
})

describe('les lignes d’une vente facturée, que les contrôles d’hier ne jugent pas', () => {
  const ligne = (o: Partial<LigneDuBrouillonLue> = {}) => ({
    piece_id: null, ligne_bancaire_id: null, facture_id: null, encaissement_id: null, immobilisation_id: null, vehicule_id: null,
    declaration_tva_id: null, cotisation_id: null, ...o,
  })

  it('une facture, un encaissement : toujours ; un mouvement des ventes, sans aucune autre source ; rien d’autre', () => {
    const ventes = new Set(['m1'])
    expect(ligneDUneVenteFacturee(ligne({ facture_id: 'f1' }), ventes)).toBe(true)
    expect(ligneDUneVenteFacturee(ligne({ encaissement_id: 'e1', ligne_bancaire_id: 'm9' }), ventes)).toBe(true)
    expect(ligneDUneVenteFacturee(ligne({ ligne_bancaire_id: 'm1' }), ventes)).toBe(true)
    expect(ligneDUneVenteFacturee(ligne({ ligne_bancaire_id: 'm1', piece_id: 'p1' }), ventes)).toBe(false)
    expect(ligneDUneVenteFacturee(ligne({ ligne_bancaire_id: 'm1', cotisation_id: 'c1' }), ventes)).toBe(false)
    expect(ligneDUneVenteFacturee(ligne({ ligne_bancaire_id: 'm1', declaration_tva_id: 't1' }), ventes)).toBe(false)
    expect(ligneDUneVenteFacturee(ligne({ ligne_bancaire_id: 'm1', immobilisation_id: 'i1' }), ventes)).toBe(false)
    expect(ligneDUneVenteFacturee(ligne({ ligne_bancaire_id: 'm1', vehicule_id: 'v1' }), ventes)).toBe(false)
    expect(ligneDUneVenteFacturee(ligne({ ligne_bancaire_id: 'm2' }), ventes)).toBe(false)
    expect(ligneDUneVenteFacturee(ligne(), ventes)).toBe(false)
  })

  it('les mouvements que leurs encaissements classent', () => {
    expect([...mouvementsClassesParEncaissements([
      { id: 'm1', encaissements_de_factures: true }, { id: 'm2', encaissements_de_factures: false },
    ])]).toEqual(['m1'])
  })
})

// CE QUE LA 2035 REÇOIT DES ÉCRITURES DES VENTES FACTURÉES (ligne 28.65, VF4C3-Q1) : la composition des sources lues EN
// ENTIER pour CE dossier, ou pourquoi la 2035 ne se calcule pas. Données FICTIVES.
describe('ecrituresDesVentesPourLa2035', () => {
  const sources = (): SourcesDesEcrituresDeVente => {
    const e1 = encaissement({ id: 'e1', facture_id: 'f1', date_encaissement: '2025-11-20', montant: 120, ligne_bancaire_id: 'm1' })
    return {
      dossierId: D, factures: [facture({ id: 'f1', date_emission: '2025-11-10' })], lignes: [ligneVendue('f1', 100, 20)],
      encaissements: [e1.encaissement], parts: [e1.part], mouvements: [mouvement({ id: 'm1', date: '2025-11-20', montant: 118 })],
      exemplaires: [],
    }
  }
  const lue = (s = sources(), dossierId = D) => ({ dossierId, etat: 'lue' as const, sources: s })
  const juger = (o: Partial<Parameters<typeof ecrituresDesVentesPourLa2035>[0]> = {}) => ecrituresDesVentesPourLa2035({
    dossierId: D, ventesParLesFactures: true, facturesSources: new Set(['f1']), lecture: lue(), mode: 'tresorerie', plan: PLAN_PAR_DEFAUT, ...o,
  })

  it('un dossier qui n’a pas basculé : sans bascule, sans rien lire', () => {
    expect(juger({ ventesParLesFactures: false, facturesSources: new Set(), lecture: null })).toEqual({ etat: 'pret', ecritures: { etat: 'sans_bascule' } })
  })

  it('une facture source dans un dossier qui ne se dit pas basculé : les lectures ne se tiennent pas', () => {
    expect(juger({ ventesParLesFactures: false, lecture: null })).toEqual({
      etat: 'incomplete',
      motif: 'les ventes facturées comptent une facture source alors que le dossier ne se dit pas basculé : les lectures ne se tiennent pas',
    })
  })

  it('basculé : la composition même de l’onglet Écritures, sur les sources lues', () => {
    const r = juger()
    expect(r.etat).toBe('pret')
    const attendue = ecrituresDesVentesFacturees({
      sources: { dossierId: D, factures: sources().factures, lignes: sources().lignes, encaissements: sources().encaissements, parts: sources().parts },
      mouvements: sources().mouvements, comptesDeContrepartie: new Map(), exemplaires: [], mode: 'tresorerie', plan: PLAN_PAR_DEFAUT,
    })
    expect(r).toEqual({ etat: 'pret', ecritures: { etat: 'composees', composition: attendue } })
    // Au plan et au modèle donnés.
    const decale = juger({ plan: PLAN_DECALE, mode: 'engagement' })
    expect(decale.etat === 'pret' && decale.ecritures.etat === 'composees'
      && decale.ecritures.composition.ecritures.some((e) => e.lignes.some((l) => l.compte === PLAN_DECALE.services_bancaires))).toBe(true)
  })

  it('pas encore revenue, ou revenue pour un autre dossier : en attente', () => {
    expect(juger({ lecture: null })).toEqual({ etat: 'en_attente' })
    expect(juger({ lecture: lue(sources(), 'd-quitte') })).toEqual({ etat: 'en_attente' })
  })

  it('partielle, d’un autre dossier sous le bon, ou qui ne se compose pas : incomplète, avec le motif', () => {
    expect(juger({ lecture: { dossierId: D, etat: 'incomplete', motif: 'les encaissements : permission denied' } }))
      .toEqual({ etat: 'incomplete', motif: 'les encaissements : permission denied' })
    expect(juger({ lecture: lue({ ...sources(), dossierId: 'd-autre' }) })).toEqual({ etat: 'incomplete', motif: 'la lecture rendue est celle d’un autre dossier' })
    // Des lectures qui ne se tiennent pas (ici, des lignes de facture illisibles) : la composition lève, la 2035 ne se
    // calcule pas.
    const sansEncaissement = { ...sources(), lignes: null as unknown as LigneDeFacture[] }
    expect(compositionDesSources(sansEncaissement, 'tresorerie', PLAN_PAR_DEFAUT)).toEqual({ etat: 'incoherent', motif: MOTIF_NE_SE_COMPOSENT_PAS })
    expect(juger({ lecture: lue(sansEncaissement) })).toEqual({ etat: 'incomplete', motif: MOTIF_NE_SE_COMPOSENT_PAS })
  })

  it('le compte de contrepartie d’une compensation entre dans la composition, comme pour la section', () => {
    const e = encaissement({ id: 'e2', facture_id: 'f1', date_encaissement: '2025-11-21', montant: 120, moyen: 'compensation', compte_contrepartie: '467200' })
    const s = { ...sources(), encaissements: [e.encaissement], parts: [e.part], mouvements: [] }
    const r = compositionDesSources(s, 'tresorerie', PLAN_PAR_DEFAUT)
    expect(r.etat === 'composee' && r.composition.ecritures.some((x) => x.lignes.some((l) => l.compte === '467200'))).toBe(true)
  })
})

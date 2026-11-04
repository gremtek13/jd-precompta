import { describe, expect, it } from 'vitest'
import {
  candidatesALaReunion, confirmationDeLaReunion, jugerLaModification, lireLaSaisie, raisonDeNePasReunir, refusDeLaReunion,
  refusDuPaiementPersonnel, reunionInacheveeDite, saisieDe, valeursReunies, type ContexteDesGestes, type SaisieDeLEcheance,
} from './gestesDesEcheances'
import { refusRapprochementCotisation } from './cotisationRapprochee'
import { formatMoney } from './format'
import { PLAN_PAR_DEFAUT } from './planComptable'
import type { CotisationDeclaree, EcritureBrouillon, LigneBancaire } from './types'
import { NON_VALIDEE } from '../test/ecritures'
import { derniereDefinitionSql } from '../test/schema'

// « MODIFIER » ET « RÉUNIR » UNE ÉCHÉANCE (COT-Q3 et COT-Q1). Ce que le module seul décide : les refus, sous les mots de la
// base quand elle refuserait ; ce que le geste change au rapprochement ; les sommes d'une réunion et ce qu'en disent la
// confirmation et l'avis d'une réunion inachevée. L'écran (CotisationsTab.gestes.test.tsx) garde le câblage.

const cotisation = (o: Partial<CotisationDeclaree> = {}): CotisationDeclaree => ({
  id: 'k1', dossier_id: 'd1', echeance: '2026-11-20', montant_appele: 800, montant_verse: null, montant_csg_crds: 300,
  previsionnel: false, created_at: '2026-01-05T09:00:00Z', paiement_personnel_le: null, ...o,
})

const ligne = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id: 'l1', dossier_id: 'd1', date: '2026-11-21', montant: -2000, libelle: 'PRLV URSSAF', libelle_brut: null, statut: 'rapprochee',
  piece_id: null, cotisation_id: 'k1', categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
  compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2026-11-21T09:00:00Z', encaissements_de_factures: false, ...o,
})

const ecriture = (o: Partial<EcritureBrouillon> = {}): EcritureBrouillon => ({
  id: 'e1', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: 'l1', date: '2026-11-21', compte: '512000', libelle: 'PRLV URSSAF',
  montant: 2000, sens: 'credit', statut: 'proposee', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null,
  cotisation_id: null, encaissement_id: null, facture_id: null, created_at: '2026-11-21T09:00:00Z', ...NON_VALIDEE, ...o,
})

function contexte(o: Partial<ContexteDesGestes> & { mouvements?: Record<string, LigneBancaire> } = {}): ContexteDesGestes {
  const { mouvements = {}, ...reste } = o
  return {
    mode: 'tresorerie', plan: PLAN_PAR_DEFAUT, mouvementDe: (c) => mouvements[c.id] ?? null, figee: () => null,
    dateFigee: (date) => (date <= '2025-12-31' ? 'L\'exercice 2025 est validé' : null), ecritures: [], ...reste,
  }
}

const saisie = (c: CotisationDeclaree, o: Partial<SaisieDeLEcheance> = {}): SaisieDeLEcheance => ({ ...saisieDe(c), ...o })
const refusDe = (j: ReturnType<typeof jugerLaModification>) => ('refus' in j ? j.refus : null)
const effetsDe = (j: ReturnType<typeof jugerLaModification>) => ('refus' in j ? [] : j.effets)

describe('« Modifier » — ce que la base refuse, sous ses mots', () => {
  it('une échéance figée ne change plus : les mots de `garder_cotisation_valide`', () => {
    const j = jugerLaModification(cotisation(), saisie(cotisation(), { csg: '0' }), contexte({ figee: () => 'L\'exercice 2026 est validé' }))
    expect(refusDe(j)).toEqual({ message: 'L\'exercice 2026 est validé : cette échéance ne change plus.' })
    // Le texte de la fonction exportée, qui le lève sur une mise à jour.
    const garde = derniereDefinitionSql('garder_cotisation_valide')
    expect(garde).toContain("raise exception '% : cette échéance ne change plus.'")
    expect(garde).toContain("raise exception '% : une échéance ne s''y ajoute plus.'")
  })

  it('une échéance payée depuis le compte personnel : les mots de `garder_paiement_personnel`, puis le geste', () => {
    const c = cotisation({ paiement_personnel_le: '2026-11-25' })
    expect(refusDe(jugerLaModification(c, saisie(c, { csg: '0' }), contexte()))?.message).toBe(
      'Cette échéance est payée depuis le compte personnel, le 25/11/2026 : ni ses montants ni son dossier ne changent tant que ce '
      + 'paiement n’est pas retiré. Retire d’abord ce paiement.',
    )
    // Au caractère près, l'apostrophe typographique mise à part.
    expect(derniereDefinitionSql('garder_paiement_personnel').replaceAll("''", '’'))
      .toContain(refusDuPaiementPersonnel('2026-11-25').replace('25/11/2026', '%'))
  })

  it('une date d’un exercice figé : « une échéance ne s’y ajoute plus »', () => {
    const c = cotisation()
    expect(refusDe(jugerLaModification(c, saisie(c, { echeance: '2025-12-20' }), contexte()))?.message)
      .toBe('L\'exercice 2025 est validé : une échéance ne s’y ajoute plus.')
  })
})

describe('« Modifier » — la saisie telle qu’elle part', () => {
  it('lit les montants au centime, la virgule admise, et un champ vide comme « non saisi »', () => {
    expect(lireLaSaisie(saisie(cotisation(), { appele: '1200,5', verse: '', csg: '0' }))).toEqual({
      valeurs: { echeance: '2026-11-20', montant_appele: 1200.5, montant_verse: null, montant_csg_crds: 0, previsionnel: false },
    })
  })

  it('refuse ce qui n’est pas un montant au centime, une date absente, un appelé vide — jamais arrondi', () => {
    const c = cotisation()
    const message = (o: Partial<SaisieDeLEcheance>) => refusDe(jugerLaModification(c, saisie(c, o), contexte()))?.message
    expect(message({ appele: '800.505' })).toBe('Le montant appelé n’est pas au centime.')
    expect(message({ csg: 'abc' })).toBe('La CSG-CRDS n’est pas un montant.')
    expect(message({ appele: '' })).toBe('Le montant appelé est à renseigner.')
    expect(message({ echeance: '' })).toBe('L’échéance est à renseigner : une date, à partir de l’an 2000.')
    expect(message({ echeance: '2026-02-30' })).toBe('L’échéance est à renseigner : une date, à partir de l’an 2000.')
  })

  it('« Rien n’a changé » se dit discrètement', () => {
    expect(refusDe(jugerLaModification(cotisation(), saisie(cotisation()), contexte()))).toEqual({ message: 'Rien n’a changé.', discret: true })
  })

  it('une CSG-CRDS plus forte que l’échéance se refuse', () => {
    const c = cotisation()
    expect(refusDe(jugerLaModification(c, saisie(c, { csg: '900' }), contexte()))?.message)
      .toBe(`La CSG-CRDS (${formatMoney(900)}) dépasse le montant de l’échéance (${formatMoney(800)}).`)
  })
})

describe('« Modifier » — une échéance qu’aucun mouvement ne paie', () => {
  it('pose 0 de CSG-CRDS sur une caisse de retraite : elle n’est plus « sans ventilation », et rien ne se réécrit', () => {
    const c = cotisation({ montant_appele: 1000, montant_csg_crds: null })
    const j = jugerLaModification(c, saisie(c, { csg: '0' }), contexte())
    expect(j).toEqual({
      valeurs: { echeance: '2026-11-20', montant_appele: 1000, montant_verse: null, montant_csg_crds: 0, previsionnel: false },
      effets: [
        `Aucun mouvement ne la paie : elle compte à son échéance, le 20/11/2026, pour ${formatMoney(1000)}, tant qu’aucun paiement ne la date.`,
        'Une CSG-CRDS de 0 € dit que l’organisme n’en prélève pas : l’échéance n’est plus « sans ventilation ».',
      ],
      reecriture: null,
    })
  })

  it('un versé de 0 € sur une mensualité couverte par un crédit : elle compte pour 0', () => {
    const c = cotisation({ montant_csg_crds: null })
    expect(effetsDe(jugerLaModification(c, saisie(c, { verse: '0' }), contexte()))[0]).toContain(`pour ${formatMoney(0)}`)
  })

  it('effacer la CSG-CRDS la rend « sans ventilation », et le dit', () => {
    const c = cotisation()
    expect(effetsDe(jugerLaModification(c, saisie(c, { csg: '' }), contexte()))).toContain(
      'Sans CSG-CRDS saisie, l’échéance est « sans ventilation » : la 2035 ne sort rien d’elle de BK, et la Clôture la cite parmi les cotisations dont la CSG-CRDS n’est pas saisie.',
    )
  })
})

describe('« Modifier » — une échéance rapprochée : la règle la plus sûre que la base permet', () => {
  const mouvements = { k1: ligne() }

  it('porter la mensualité à la somme prélevée réécrit son écriture dans le même geste, et le dit avant le clic', () => {
    // D1 après coup : un prélèvement de 2 000 € rapproché de la mensualité de 800 €, la régularisation (1 200 €, dont 450 €)
    // restée à côté. La mensualité portée à 2 000 €, dont 750 € de CSG-CRDS.
    const c = cotisation()
    const j = jugerLaModification(c, saisie(c, { appele: '2000', csg: '750' }), contexte({ mouvements }))
    expect(effetsDe(j)).toEqual([
      `Le prélèvement du 21/11/2026 (${formatMoney(2000)}), qui la paie, reste rapproché : la 2035 la compte toujours à cette date, pour ce montant.`,
      `Son écriture est réécrite dans le même geste : ${formatMoney(1250)} au 646000, ${formatMoney(750)} de CSG-CRDS au 108000, face à la banque.`,
      `Sa CSG-CRDS (${formatMoney(750)}) sort de BK, et sa part déductible entre en BV.`,
    ])
    expect('refus' in j ? null : j.reecriture).toEqual({
      ligne: ligne(),
      ecritures: [
        { compte: '512000', sens: 'credit', montant: 2000, libelle: 'PRLV URSSAF' },
        { compte: '646000', sens: 'debit', montant: 1250, libelle: 'PRLV URSSAF' },
        { compte: '108000', sens: 'debit', montant: 750, libelle: 'PRLV URSSAF' },
      ],
    })
  })

  it('un montant qui ne correspond plus au prélèvement se dit, sans refus : le relevé fait foi', () => {
    const c = cotisation()
    const effets = effetsDe(jugerLaModification(c, saisie(c, { appele: '900' }), contexte({ mouvements })))
    expect(effets).toContain(`Son montant (${formatMoney(900)}) ne correspond pas à ce prélèvement : vérifie qu’il la paie bien, sinon annule ce rapprochement dans l’onglet Banque.`)
    // L'écriture ne dépend que du mouvement et de la CSG-CRDS : rien à réécrire.
    expect(effets.some((e) => e.startsWith('Son écriture'))).toBe(false)
  })

  it('refuse ce qui rendrait le rapprochement inécrivable, sous les mots de `rapprocher_cotisation`', () => {
    const c = cotisation()
    const message = (o: Partial<SaisieDeLEcheance>) => refusDe(jugerLaModification(c, saisie(c, o), contexte({ mouvements })))?.message
    const suite = ' Le prélèvement du 21/11/2026 (' + formatMoney(2000) + '), qui la paie, ne pourrait plus s’écrire : garde des montants qu’il accepte, ou annule d’abord ce rapprochement dans l’onglet Banque.'
    // Une CSG-CRDS plus forte que le mouvement (au-dessus de l'échéance aussi : portée à 3 000 €).
    expect(message({ appele: '3000', csg: '2500' })).toBe(`La CSG-CRDS de cette échéance (${formatMoney(2500)}) dépasse le mouvement (${formatMoney(2000)}).${suite}`)
    // Un remboursement : un prélèvement ne le paie pas.
    expect(message({ appele: '-800', csg: '' })).toBe(`${refusRapprochementCotisation(ligne(), cotisation({ montant_appele: -800, montant_csg_crds: null }), 'tresorerie')}${suite}`)
    // Zéro.
    expect(message({ verse: '0', csg: '0' })).toBe(`Une échéance de zéro euro ne se rapproche pas.${suite}`)
  })

  it('une écriture validée ne se remplace plus : refusée avant le clic quand l’écriture changerait, pas sinon', () => {
    const c = cotisation()
    const validee = contexte({ mouvements, ecritures: [ecriture({ statut: 'validee' })] })
    expect(refusDe(jugerLaModification(c, saisie(c, { csg: '450' }), validee))?.message)
      .toBe('L’écriture de ce mouvement est validée : elle ne se remplace plus.')
    expect(refusDe(jugerLaModification(c, saisie(c, { appele: '820' }), validee))).toBeNull()
    // Une ligne d'une pièce, d'une facture ou d'un encaissement sur le même mouvement n'est pas son écriture propre.
    const autre = contexte({ mouvements, ecritures: [ecriture({ statut: 'validee', encaissement_id: 'enc' })] })
    expect(refusDe(jugerLaModification(c, saisie(c, { csg: '450' }), autre))).toBeNull()
  })

  it('en engagement, la CSG-CRDS ne change pas l’écriture, et le dit', () => {
    const c = cotisation()
    const j = jugerLaModification(c, saisie(c, { csg: '450' }), contexte({ mouvements, mode: 'engagement' }))
    expect('refus' in j ? null : j.reecriture).toBeNull()
    expect(effetsDe(j)).toContain('Son écriture ne change pas : en engagement, la CSG-CRDS reste au 646000.')
  })
})

describe('« Réunir »', () => {
  const mensualite = cotisation({ id: 'k1', echeance: '2026-11-20', montant_appele: 800, montant_csg_crds: 300 })
  const regularisation = cotisation({ id: 'k2', echeance: '2026-11-15', montant_appele: 1200, montant_csg_crds: 450 })

  it('les conditions de chaque échéance, et pourquoi', () => {
    const c = contexte({ mouvements: { k3: ligne({ cotisation_id: 'k3' }) }, figee: (x) => (x.id === 'k4' ? 'L\'exercice 2026 est validé' : null) })
    expect(raisonDeNePasReunir(mensualite, c)).toBeNull()
    expect(raisonDeNePasReunir(cotisation({ id: 'k3' }), c)).toBe(
      'Elle est rapprochée du prélèvement du 21/11/2026 : une échéance rapprochée ne se réunit pas — porte-la à la somme avec « Modifier », puis retire l’autre.',
    )
    expect(raisonDeNePasReunir(cotisation({ id: 'k4' }), c)).toBe('L\'exercice 2026 est validé : cette échéance ne change plus.')
    expect(raisonDeNePasReunir(cotisation({ paiement_personnel_le: '2026-11-25' }), c)).toBe(refusDuPaiementPersonnel('2026-11-25'))
    expect(raisonDeNePasReunir(cotisation({ previsionnel: true }), c)).toBe('Une échéance prévisionnelle ne se réunit pas : l’appel définitif la remplace d’abord.')
    expect(raisonDeNePasReunir(cotisation({ montant_verse: 0 }), c)).toBe('Une échéance de zéro euro n’a rien à réunir.')
  })

  it('les candidates : réunissables, du même sens, jamais elle-même', () => {
    const remboursement = cotisation({ id: 'k5', montant_appele: -500 })
    const prevue = cotisation({ id: 'k6', previsionnel: true })
    expect(candidatesALaReunion(mensualite, [mensualite, regularisation, remboursement, prevue], contexte()).map((c) => c.id)).toEqual(['k2'])
    expect(candidatesALaReunion(prevue, [mensualite, regularisation], contexte())).toEqual([])
  })

  it('les sommes, en centimes : l’appelé, le versé quand l’une en porte, la CSG-CRDS ; la date de la gardée', () => {
    expect(valeursReunies(mensualite, regularisation)).toEqual({
      echeance: '2026-11-20', montant_appele: 2000, montant_verse: null, montant_csg_crds: 750, previsionnel: false,
    })
    expect(valeursReunies(cotisation({ montant_appele: 0.1, montant_verse: 0.2 }), cotisation({ montant_appele: 0.2, montant_csg_crds: 0.1 })))
      .toEqual({ echeance: '2026-11-20', montant_appele: 0.3, montant_verse: 0.4, montant_csg_crds: 300.1, previsionnel: false })
  })

  it('refuse une CSG-CRDS saisie d’un côté seulement, et le dit avec le geste', () => {
    expect(refusDeLaReunion(mensualite, { ...regularisation, montant_csg_crds: null }, contexte())).toBe(
      'La CSG-CRDS de l’échéance du 15/11/2026 n’est pas saisie : saisis-la avec « Modifier » (0 si l’organisme n’en prélève pas), puis réunis.',
    )
    // Toutes deux non saisies : la somme reste inconnue, sans rien perdre.
    expect(refusDeLaReunion({ ...mensualite, montant_csg_crds: null }, { ...regularisation, montant_csg_crds: null }, contexte())).toBeNull()
    expect(refusDeLaReunion(mensualite, regularisation, contexte())).toBeNull()
    expect(refusDeLaReunion(mensualite, cotisation({ id: 'k5', montant_appele: -500 }), contexte())).toBe('Un appel et un remboursement ne se réunissent pas.')
    expect(refusDeLaReunion(mensualite, mensualite, contexte())).toBe('Une échéance ne se réunit pas à elle-même.')
  })

  it('la confirmation nomme la date retenue, les montants, la CSG-CRDS, ce qui part et l’organisme', () => {
    expect(confirmationDeLaReunion(mensualite, regularisation, 'regul-2025.pdf')).toBe(
      `L’échéance du 20/11/2026 est gardée, à sa date, et portée à ${formatMoney(2000)} appelés, dont ${formatMoney(750)} de CSG-CRDS. `
      + `Celle du 15/11/2026 (${formatMoney(1200)} appelés, dont ${formatMoney(450)} de CSG-CRDS) est retirée : aucun mouvement ne la paie. `
      + 'Son avis « regul-2025.pdf » redevient non rattaché. '
      + 'Ne réunis que deux échéances d’un même organisme qu’un même prélèvement paie : l’application ne connaît pas l’organisme d’une échéance.',
    )
  })

  it('une réunion inachevée nomme l’état et le seul geste qui la finit, montants compris', () => {
    // La gardée telle que l'onglet l'avait lue, avant la réunion : la phrase dit la somme qu'elle porte désormais.
    expect(reunionInacheveeDite({ gardee: mensualite, retiree: regularisation, raison: 'JWT expired' })).toBe(
      `Réunion inachevée : l’échéance du 20/11/2026 porte déjà ${formatMoney(2000)} appelés, dont ${formatMoney(750)} de CSG-CRDS, `
      + `mais celle du 15/11/2026 (${formatMoney(1200)} appelés, dont ${formatMoney(450)} de CSG-CRDS) n’a pas pu être retirée : JWT expired. `
      + `Tant qu’elle reste, ses ${formatMoney(1200)} comptent deux fois. Retire l’échéance du 15/11/2026 pour finir.`,
    )
  })
})

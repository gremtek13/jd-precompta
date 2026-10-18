import { describe, expect, it } from 'vitest'
import {
  confirmationDeLaDesignation, confirmationDuRetraitDeLaDesignation, descriptionDeLaFacture, ligneDuChoix, nomDeLaFacture,
  refusDuFormulaireDeLaPiece,
} from './exemplairesDesFacturesEcran'
import { REFUS_GARDE_EXEMPLAIRE, refusDeLaPieceDesignee } from './exemplairesDesFactures'
import { remplirModele } from './encaissementsFactures'
import { formatMoney } from './format'
import type { FactureProposee } from './exemplairesDesFacturesLecture'

// LES MOTS DE L'ÉCRAN DE L'EXEMPLAIRE (lib/exemplairesDesFacturesEcran.ts) : ce que la confirmation NOMME, ce qu'elle dit que
// le geste change et ne change pas, et le refus du formulaire d'une pièce désignée, qui est celui de la garde. Données FICTIVES.
const facture = (o: Partial<FactureProposee> = {}): FactureProposee => ({
  id: 'f1', dossier_id: 'd1', statut: 'validee', type: 'facture', numero: 'F2026-0007', date_emission: '2026-03-14',
  tiers_nom: 'CLIENT FICTIF SAS', montant_ttc: 1200, ...o,
})
const avoir = facture({ id: 'a1', type: 'avoir', numero: 'A2026-0001', montant_ttc: -300, date_emission: '2026-04-02' })

describe('le nom et le choix d’une facture', () => {
  it('une facture et un avoir se nomment pour ce qu’ils sont', () => {
    expect(nomDeLaFacture(facture())).toBe('la facture F2026-0007')
    expect(nomDeLaFacture(avoir)).toBe('l’avoir A2026-0001')
    expect(nomDeLaFacture(facture({ numero: null }))).toBe('la facture (sans numéro)')
  })

  it('la description donne le client, le montant TTC (négatif pour un avoir) et la date', () => {
    expect(descriptionDeLaFacture(facture())).toBe(`CLIENT FICTIF SAS, ${formatMoney(1200)} TTC, émise le 14/03/2026`)
    expect(descriptionDeLaFacture(avoir)).toBe(`CLIENT FICTIF SAS, ${formatMoney(-300)} TTC, émise le 02/04/2026`)
  })

  it('la ligne du choix retrouve la facture sans en connaître le numéro', () => {
    expect(ligneDuChoix(facture())).toBe(`Facture F2026-0007 — 14/03/2026 — CLIENT FICTIF SAS — ${formatMoney(1200)}`)
    expect(ligneDuChoix(avoir)).toBe(`Avoir A2026-0001 — 02/04/2026 — CLIENT FICTIF SAS — ${formatMoney(-300)}`)
  })
})

describe('la confirmation de la désignation', () => {
  const texte = confirmationDeLaDesignation('vente-0007.pdf', facture())

  it('nomme la pièce et la facture : son numéro, son client, son montant TTC', () => {
    expect(texte).toContain('« vente-0007.pdf »')
    expect(texte).toContain('la facture F2026-0007')
    expect(texte).toContain('CLIENT FICTIF SAS')
    expect(texte).toContain(`${formatMoney(1200)} TTC`)
  })

  it('dit ce que le geste change et ce qu’il ne change pas', () => {
    expect(texte).toContain('« Comptée deux fois »')
    expect(texte).toContain('Désigner ne change rien à ce qui se compte aujourd’hui.')
    expect(texte).toContain('se fige avec la pièce')
  })

  it('un avoir se nomme avoir', () => {
    expect(confirmationDeLaDesignation('avoir.pdf', avoir)).toContain('l’avoir A2026-0001')
  })
})

describe('la confirmation du retrait de la désignation', () => {
  it('nomme la pièce et la facture, et dit que défaire ne change rien à ce qui se compte', () => {
    const texte = confirmationDuRetraitDeLaDesignation('vente-0007.pdf', facture(), null)
    expect(texte).toContain('« vente-0007.pdf »')
    expect(texte).toContain('la facture F2026-0007')
    expect(texte).toContain('CLIENT FICTIF SAS')
    expect(texte).toContain(`${formatMoney(1200)} TTC`)
    expect(texte).toContain('Défaire ne change rien à ce qui se compte.')
    expect(texte).not.toContain('NE RETIRE PAS')
  })

  it('vente comptée plusieurs fois : défaire fait peut-être taire l’alerte, jamais le double compte — et la confirmation le dit', () => {
    const texte = confirmationDuRetraitDeLaDesignation('vente-0007.pdf', facture(), ['facture-0007.xml'])
    expect(texte).toContain('« facture-0007.xml »')
    expect(texte).toContain('peut faire taire « Comptée deux fois »')
    expect(texte).toContain('NE RETIRE PAS le double compte : les deux pièces continuent de compter la vente')
    expect(texte).toContain('Il n’en faut garder qu’une par facture.')
  })

  it('une liste vide d’autres pièces n’est pas une vente en double', () => {
    expect(confirmationDuRetraitDeLaDesignation('x.pdf', facture(), [])).not.toContain('NE RETIRE PAS')
  })
})

describe('le refus du formulaire d’une pièce désignée', () => {
  const designee = { id: 'p1', dossier_id: 'd1', type_piece: 'vente' as const, facture_id: 'f1' }

  it('une pièce que rien ne désigne change librement', () => {
    expect(refusDuFormulaireDeLaPiece({ ...designee, facture_id: null }, 'achat', [facture()])).toBeNull()
  })

  it('désignée, elle reste une vente : le refus est celui de la garde, sous ses mots, avec le numéro', () => {
    const modele = REFUS_GARDE_EXEMPLAIRE.find((r) => r.cle === 'change_de_nature')?.modele ?? ''
    const attendu = remplirModele(modele, ['F2026-0007'])
    expect(attendu).toContain('F2026-0007')
    expect(refusDuFormulaireDeLaPiece(designee, 'achat', [facture()])).toBe(attendu)
    expect(refusDuFormulaireDeLaPiece(designee, 'achat', [facture()]))
      .toBe(refusDeLaPieceDesignee(designee, { type_piece: 'achat' }, [facture()])?.message)
    expect(refusDuFormulaireDeLaPiece(designee, 'vente', [facture()])).toBeNull()
  })

  it('la facture désignée absente de la liste lue : la règle tient, le numéro n’est pas inventé', () => {
    for (const lues of [null, [], [facture({ id: 'autre' })]]) {
      const message = refusDuFormulaireDeLaPiece(designee, 'note_frais', lues)
      expect(message, JSON.stringify(lues)).toContain('dont le numéro n’a pas pu être lu')
      expect(message).not.toContain('(sans numéro)')
      expect(refusDuFormulaireDeLaPiece(designee, 'vente', lues)).toBeNull()
    }
  })
})

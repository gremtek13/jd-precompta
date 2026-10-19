import { describe, expect, it } from 'vitest'
import {
  confirmationDeLaDesignation, confirmationDuRetraitDeLaDesignation, descriptionDeLaFacture, ligneDuChoix, nomDeLaFacture,
  PARAGRAPHE_DE_LA_DESIGNATION, phraseDeLaPieceDesignee, refusDuFormulaireDeLaPiece,
} from './exemplairesDesFacturesEcran'
import { REFUS_GARDE_EXEMPLAIRE, refusDeLaPieceDesignee } from './exemplairesDesFactures'
import { remplirModele } from './encaissementsFactures'
import { formatMoney } from './format'
import type { FactureProposee } from './exemplairesDesFacturesLecture'

// LES MOTS DE L'ÉCRAN DE L'EXEMPLAIRE (lib/exemplairesDesFacturesEcran.ts) : ce que la confirmation NOMME, ce qu'elle dit que
// le geste change et ne change pas, et le refus du formulaire d'une pièce désignée, qui est celui de la garde. Données FICTIVES.
const facture = (o: Partial<FactureProposee> = {}): FactureProposee => ({
  id: 'f1', dossier_id: 'd1', statut: 'validee', type: 'facture', numero: 'F2026-0007', date_emission: '2026-03-14',
  tiers_nom: 'CLIENT FICTIF SAS', montant_ttc: 1200, source_de_la_vente: false, ...o,
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

// CE QUI SE COMPTE DÉPEND DE LA FACTURE (étape VF3b3) : l'exemplaire d'une facture SOURCE de sa vente ne compte plus — c'est
// la facture qui compte la vente dans la 2035, la CA3, la situation intermédiaire et l'estimation —, celui d'une autre compte
// comme hier. Chaque phrase dit ce qui est vrai pour la facture choisie, et ne dit pas l'autre cas.
describe('ce que désigner ou défaire change à ce qui se compte', () => {
  const source = facture({ source_de_la_vente: true })
  const avoirSource = facture({ id: 'a1', type: 'avoir', numero: 'A2026-0001', montant_ttc: -300, source_de_la_vente: true })
  const LES_ETATS = 'la 2035, la CA3, la situation intermédiaire et l’estimation'

  it('désigner l’exemplaire d’une facture source : la pièce cessera de compter, la facture compte la vente', () => {
    const texte = confirmationDeLaDesignation('vente-0007.pdf', source)
    expect(texte).toContain('La facture F2026-0007 est la source de sa vente')
    expect(texte).toContain(`la pièce cessera de compter dans ${LES_ETATS}, où la vente ne sera plus comptée que par la facture F2026-0007.`)
    expect(texte).not.toContain('ne change rien')
    // Ce qui compte de trop, pour une facture source, est une pièce qui n'est PAS désignée.
    expect(texte).toContain('« Comptée deux fois » : une pièce de cette facture qui n’est pas désignée compte encore, en plus de la facture.')
    expect(texte).toContain('se fige avec la pièce')
    // Et elle nomme encore la pièce et la facture.
    expect(texte).toContain('« vente-0007.pdf »')
    expect(texte).toContain(`${formatMoney(1200)} TTC`)
  })

  it('désigner l’exemplaire d’une facture qui n’est pas source : rien ne change, et la phrase ne parle pas de source', () => {
    const texte = confirmationDeLaDesignation('vente-0007.pdf', facture())
    expect(texte).toContain('Désigner ne change rien à ce qui se compte aujourd’hui.')
    expect(texte).not.toContain('source')
    expect(texte).not.toContain('cessera de compter')
    expect(texte).toContain('une vente ne se compte qu’une fois, il n’en faut garder qu’une.')
  })

  it('un avoir source se nomme avoir, en tête de phrase aussi', () => {
    const texte = confirmationDeLaDesignation('avoir.pdf', avoirSource)
    expect(texte).toContain('L’avoir A2026-0001 est la source de sa vente')
    expect(texte).toContain('ne sera plus comptée que par l’avoir A2026-0001.')
  })

  it('défaire pour une facture source : la pièce compte de nouveau, en plus de la facture — la vente deux fois', () => {
    const texte = confirmationDuRetraitDeLaDesignation('vente-0007.pdf', source, null)
    expect(texte).toContain(`la désignation défaite, la pièce comptera de nouveau dans ${LES_ETATS}, EN PLUS de la facture — la vente sera comptée deux fois.`)
    expect(texte).toContain('La facture F2026-0007 est la source de sa vente, et la compte déjà')
    expect(texte).not.toContain('ne change rien')
    expect(texte).not.toContain('portée par plusieurs pièces')
    expect(texte).toContain('« vente-0007.pdf »')
  })

  it('défaire pour une facture source portée par plusieurs pièces : la vente comptée une fois de plus, l’autre pièce nommée', () => {
    const texte = confirmationDuRetraitDeLaDesignation('vente-0007.pdf', source, ['facture-0007.xml'])
    expect(texte).toContain('cette pièce et « facture-0007.xml » portent la même facture')
    expect(texte).toContain('peut faire taire « Comptée deux fois »')
    expect(texte).toContain('la vente sera comptée UNE FOIS DE PLUS : par cette pièce, en plus de la facture')
    // Pour une facture source, la pièce désignée ne compte pas aujourd'hui : « les deux pièces continuent » serait faux.
    expect(texte).not.toContain('les deux pièces continuent de compter la vente')
    expect(confirmationDuRetraitDeLaDesignation('x.pdf', source, [])).not.toContain('portée par plusieurs pièces')
  })

  it('défaire pour une facture qui n’est pas source : rien ne change, et la phrase ne parle pas de source', () => {
    for (const autres of [null, ['facture-0007.xml']]) {
      const texte = confirmationDuRetraitDeLaDesignation('vente-0007.pdf', facture(), autres)
      expect(texte, JSON.stringify(autres)).toContain('Défaire ne change rien à ce qui se compte.')
      expect(texte).not.toContain('source')
      expect(texte).not.toContain('comptera de nouveau')
    }
  })

  it('le paragraphe, écrit avant tout choix, dit les deux cas', () => {
    expect(PARAGRAPHE_DE_LA_DESIGNATION).toContain(`Pour une facture source de sa vente, la pièce désignée cesse de compter dans ${LES_ETATS} : c’est la facture qui compte la vente.`)
    expect(PARAGRAPHE_DE_LA_DESIGNATION).toContain('Pour une autre facture, désigner ne change rien à ce qui se compte.')
    expect(PARAGRAPHE_DE_LA_DESIGNATION).toContain('« Comptée deux fois »')
    // L'ancienne phrase, devenue fausse pour une facture source, ne s'y lit plus.
    expect(PARAGRAPHE_DE_LA_DESIGNATION).not.toContain('Désigner ne change rien à ce qui se compte aujourd’hui.')
  })

  it('la fiche d’une pièce désignée dit, pour une facture source seulement, qu’elle ne compte pas', () => {
    expect(phraseDeLaPieceDesignee(facture())).toBe('Cette pièce est désignée comme l’exemplaire de la facture F2026-0007.')
    expect(phraseDeLaPieceDesignee(source)).toBe(
      'Cette pièce est désignée comme l’exemplaire de la facture F2026-0007. La facture F2026-0007 est la source de sa vente : '
      + `cette pièce ne compte pas dans ${LES_ETATS}, où la vente n’est comptée que par la facture F2026-0007.`,
    )
  })
})

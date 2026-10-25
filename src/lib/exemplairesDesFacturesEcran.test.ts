import { describe, expect, it } from 'vitest'
import {
  confirmationDeLaDeclaration, confirmationDeLaDesignation, confirmationDuRetraitDeLaDeclaration,
  confirmationDuRetraitDeLaDesignation, dateDuGeste, descriptionDeLaFacture, ligneDuChoix, nomDeLaFacture,
  PARAGRAPHE_D_UN_DOSSIER_BASCULE, PARAGRAPHE_DE_LA_DESIGNATION, phraseDeLaPieceDeclaree, phraseDeLaPieceDesignee,
  phraseDuGeste, phraseDuJournalIllisible, phraseDuJournalResteAilleurs, refusDuFormulaireDeLaPiece, TITRE_DE_LA_SECTION,
  type CeQuElleEtait,
} from './exemplairesDesFacturesEcran'
import { REFUS_GARDE_EXEMPLAIRE, REFUS_GARDE_JUMELLE, refusDeLaPieceDesignee } from './exemplairesDesFactures'
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
const RIEN: CeQuElleEtait = { genre: 'rien' }

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
    expect(ligneDuChoix(facture(), null)).toBe(`Facture F2026-0007 — 14/03/2026 — CLIENT FICTIF SAS — ${formatMoney(1200)}`)
    expect(ligneDuChoix(avoir, null)).toBe(`Avoir A2026-0001 — 02/04/2026 — CLIENT FICTIF SAS — ${formatMoney(-300)}`)
  })

  it('… et dit d’une facture source que la validation d’un exercice fige qu’elle l’est (VF7e), l’avoir accordé', () => {
    expect(ligneDuChoix(facture(), 2026))
      .toBe(`Facture F2026-0007 — 14/03/2026 — CLIENT FICTIF SAS — ${formatMoney(1200)} — figée par la validation de l’exercice 2026`)
    expect(ligneDuChoix(avoir, 2026)).toMatch(/— figé par la validation de l’exercice 2026$/)
  })
})

describe('la confirmation de la désignation', () => {
  const texte = confirmationDeLaDesignation('vente-0007.pdf', facture(), RIEN, null)

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
    expect(confirmationDeLaDesignation('avoir.pdf', avoir, RIEN, null)).toContain('l’avoir A2026-0001')
  })
})

describe('la confirmation du retrait de la désignation', () => {
  it('nomme la pièce et la facture, et dit que défaire ne change rien à ce qui se compte', () => {
    const texte = confirmationDuRetraitDeLaDesignation('vente-0007.pdf', facture(), null, false)
    expect(texte).toContain('« vente-0007.pdf »')
    expect(texte).toContain('la facture F2026-0007')
    expect(texte).toContain('CLIENT FICTIF SAS')
    expect(texte).toContain(`${formatMoney(1200)} TTC`)
    expect(texte).toContain('Défaire ne change rien à ce qui se compte.')
    expect(texte).not.toContain('NE RETIRE PAS')
  })

  it('vente comptée plusieurs fois : défaire fait peut-être taire l’alerte, jamais le double compte — et la confirmation le dit', () => {
    const texte = confirmationDuRetraitDeLaDesignation('vente-0007.pdf', facture(), ['facture-0007.xml'], false)
    expect(texte).toContain('« facture-0007.xml »')
    expect(texte).toContain('peut faire taire « Comptée deux fois »')
    expect(texte).toContain('NE RETIRE PAS le double compte : les deux pièces continuent de compter la vente')
    expect(texte).toContain('Il n’en faut garder qu’une par facture.')
  })

  it('une liste vide d’autres pièces n’est pas une vente en double', () => {
    expect(confirmationDuRetraitDeLaDesignation('x.pdf', facture(), [], false)).not.toContain('NE RETIRE PAS')
  })
})

describe('le refus du formulaire d’une pièce désignée', () => {
  const designee = { id: 'p1', dossier_id: 'd1', type_piece: 'vente' as const, facture_id: 'f1', vente_hors_des_factures: false }

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
    const texte = confirmationDeLaDesignation('vente-0007.pdf', source, RIEN, null)
    expect(texte).toContain('La facture F2026-0007 est la source de sa vente')
    expect(texte).toContain(`la pièce cessera de compter dans ${LES_ETATS}, où la vente ne sera plus comptée que par la facture F2026-0007.`)
    expect(texte).not.toContain('ne change rien')
    // Ce qui compte de trop, pour une facture source, est une pièce qui n'est PAS désignée.
    expect(texte).toContain('« Comptée deux fois » : une pièce de cette facture qui n’est pas désignée compte encore, en plus de la facture.')
    // L'exemplaire d'une facture source ne porte aucune écriture : c'est l'exercice de la facture qui fige sa désignation (VF7e).
    expect(texte).toContain('La désignation se fige quand l’exercice de la facture F2026-0007 est validé.')
    expect(texte).not.toContain('se fige avec la pièce')
    // Et elle nomme encore la pièce et la facture.
    expect(texte).toContain('« vente-0007.pdf »')
    expect(texte).toContain(`${formatMoney(1200)} TTC`)
  })

  it('désigner l’exemplaire d’une facture qui n’est pas source : rien ne change, et la phrase ne parle pas de source', () => {
    const texte = confirmationDeLaDesignation('vente-0007.pdf', facture(), RIEN, null)
    expect(texte).toContain('Désigner ne change rien à ce qui se compte aujourd’hui.')
    expect(texte).not.toContain('source')
    expect(texte).not.toContain('cessera de compter')
    expect(texte).toContain('une vente ne se compte qu’une fois, il n’en faut garder qu’une.')
  })

  it('un avoir source se nomme avoir, en tête de phrase aussi', () => {
    const texte = confirmationDeLaDesignation('avoir.pdf', avoirSource, RIEN, null)
    expect(texte).toContain('L’avoir A2026-0001 est la source de sa vente')
    expect(texte).toContain('ne sera plus comptée que par l’avoir A2026-0001.')
  })

  it('désigner À une facture source que la validation d’un exercice fige (VF7e, VF7-Q1 B) : sa première désignation, aussitôt figée', () => {
    const texte = confirmationDeLaDesignation('original.pdf', source, RIEN, 2026)
    expect(texte).toContain('La facture F2026-0007 est figée par la validation de l’exercice 2026 : cette première désignation se fige '
      + 'aussitôt — elle ne se changera ni ne se retirera.')
    expect(texte).not.toContain('La désignation se fige quand')
    expect(texte).toContain('la pièce cessera de compter')
    expect(confirmationDeLaDesignation('avoir.pdf', avoirSource, RIEN, 2026)).toContain('L’avoir A2026-0001 est figé par la validation de l’exercice 2026')
  })

  it('défaire pour une facture source : la pièce compte de nouveau, en plus de la facture — la vente deux fois', () => {
    const texte = confirmationDuRetraitDeLaDesignation('vente-0007.pdf', source, null, false)
    expect(texte).toContain(`la désignation défaite, la pièce comptera de nouveau dans ${LES_ETATS}, EN PLUS de la facture — la vente sera comptée deux fois.`)
    expect(texte).toContain('La facture F2026-0007 est la source de sa vente, et la compte déjà')
    expect(texte).not.toContain('ne change rien')
    expect(texte).not.toContain('portée par plusieurs pièces')
    expect(texte).toContain('« vente-0007.pdf »')
  })

  it('défaire pour une facture source portée par plusieurs pièces : la vente comptée une fois de plus, l’autre pièce nommée', () => {
    const texte = confirmationDuRetraitDeLaDesignation('vente-0007.pdf', source, ['facture-0007.xml'], false)
    expect(texte).toContain('cette pièce et « facture-0007.xml » portent la même facture')
    expect(texte).toContain('peut faire taire « Comptée deux fois »')
    expect(texte).toContain('la vente sera comptée UNE FOIS DE PLUS : par cette pièce, en plus de la facture')
    // Pour une facture source, la pièce désignée ne compte pas aujourd'hui : « les deux pièces continuent » serait faux.
    expect(texte).not.toContain('les deux pièces continuent de compter la vente')
    expect(confirmationDuRetraitDeLaDesignation('x.pdf', source, [], false)).not.toContain('portée par plusieurs pièces')
  })

  it('défaire pour une facture qui n’est pas source : rien ne change, et la phrase ne parle pas de source', () => {
    for (const autres of [null, ['facture-0007.xml']]) {
      const texte = confirmationDuRetraitDeLaDesignation('vente-0007.pdf', facture(), autres, false)
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

// LA JUMELLE INVERSÉE, À L'ÉCRAN (étape VF6c ; VF6-Q1). Désigner REMPLACE ce que la pièce était — l'exemplaire d'une autre
// facture, ou une vente déclarée hors des factures de l'application —, d'un seul geste ; la confirmation le dit, nomme ce
// que la pièce quitte, et dit ce que le remplacement change à ce qui se compte, selon les DEUX factures. La déclaration et
// son retrait nomment la pièce, et disent ce qui se compte. Dans un dossier basculé, seule une pièce à valider se défait.
describe('le remplacement d’une désignation ou d’une déclaration (VF6-Q1)', () => {
  const source = facture({ id: 'fs', numero: 'F2026-0042', source_de_la_vente: true })
  const autreSource = facture({ id: 'fs2', numero: 'F2026-0043', source_de_la_vente: true, tiers_nom: 'AUTRE CLIENT' })
  const LES_ETATS = 'la 2035, la CA3, la situation intermédiaire et l’estimation'

  it('rien à remplacer : aucune phrase de remplacement', () => {
    const texte = confirmationDeLaDesignation('vente.pdf', facture(), RIEN, null)
    expect(texte).not.toContain('remplacée d’un seul geste')
    expect(texte).not.toContain('ne sera plus')
  })

  it('une désignation remplacée : la facture quittée nommée (numéro, client, montant), le geste unique dit', () => {
    const texte = confirmationDeLaDesignation('vente.pdf', avoir, { genre: 'designee', facture: facture() }, null)
    expect(texte).toContain('Elle ne sera plus l’exemplaire de la facture F2026-0007 (CLIENT FICTIF SAS, ')
    expect(texte).toContain(`${formatMoney(1200)} TTC, émise le 14/03/2026) : la désignation est remplacée d’un seul geste.`)
    expect(texte).toContain('comme l’exemplaire de l’avoir A2026-0001')
    expect(texte).toContain('Désigner ne change rien à ce qui se compte aujourd’hui.')
  })

  it('une déclaration remplacée : dit, sans facture inventée', () => {
    const texte = confirmationDeLaDesignation('vente.pdf', facture(), { genre: 'declaree' }, null)
    expect(texte).toContain('Elle ne sera plus déclarée vente hors des factures de l’application : la déclaration est remplacée d’un seul geste.')
    expect(texte).toContain('Désigner ne change rien à ce qui se compte aujourd’hui.')
  })

  it('d’une facture qui n’est pas source à une facture source : la pièce cessera de compter', () => {
    const texte = confirmationDeLaDesignation('vente.pdf', source, { genre: 'designee', facture: facture() }, null)
    expect(texte).toContain(`la pièce cessera de compter dans ${LES_ETATS}, où la vente ne sera plus comptée que par la facture F2026-0042.`)
  })

  it('d’une facture source à une autre facture source : la pièce ne comptait pas, ne comptera pas davantage', () => {
    const texte = confirmationDeLaDesignation('vente.pdf', autreSource, { genre: 'designee', facture: source }, null)
    expect(texte).toContain('La facture F2026-0043 est la source de sa vente, comme la facture F2026-0042 : la pièce, qui ne comptait pas, ne comptera pas davantage')
    expect(texte).not.toContain('cessera de compter')
    expect(texte).not.toContain('ne change rien')
  })

  it('d’une facture source à une facture qui ne l’est pas : la pièce comptera de nouveau — la vente peut-être deux fois', () => {
    const texte = confirmationDeLaDesignation('vente.pdf', facture(), { genre: 'designee', facture: source }, null)
    expect(texte).toContain(`La facture F2026-0042 est la source de sa vente, et la compte : la pièce, qui ne comptait pas, comptera de nouveau dans ${LES_ETATS}, comme la vente de la facture F2026-0007`)
    expect(texte).toContain('cette vente serait comptée deux fois.')
    expect(texte).not.toContain('ne change rien')
  })

  it('défaire dans un dossier basculé : la pièce à valider ne compte pas, et ne se validera que marquée de nouveau', () => {
    const texte = confirmationDuRetraitDeLaDesignation('vente.pdf', facture(), ['autre.xml'], true)
    expect(texte).toContain('« vente.pdf »')
    expect(texte).toContain('la facture F2026-0007')
    expect(texte).toContain('Elle est à valider, et ne compte pas encore.')
    expect(texte).toContain('elle ne se validera qu’à nouveau désignée exemplaire d’une facture émise, ou déclarée vente hors des factures de l’application.')
    // Ni le double compte d'hier, ni « comptera de nouveau » : une pièce à valider ne compte pas.
    expect(texte).not.toContain('NE RETIRE PAS')
    expect(texte).not.toContain('comptera de nouveau')
    expect(texte).not.toContain('source')
  })

  it('défaire l’exemplaire d’une facture source dans un dossier basculé : déclarée, elle compterait la vente une seconde fois', () => {
    const texte = confirmationDuRetraitDeLaDesignation('vente.pdf', source, null, true)
    expect(texte).toContain('La facture F2026-0042 est la source de sa vente, et la compte déjà : si la pièce est bien son exemplaire, déclarée hors des factures elle compterait la vente une seconde fois.')
  })

  it('la déclaration nomme la pièce, dit ce qu’elle affirme et ce qu’elle fait compter — le PDF d’une facture compterait deux fois', () => {
    const texte = confirmationDeLaDeclaration('recette.pdf', { genre: 'rien' })
    expect(texte).toContain('Déclarer la pièce « recette.pdf » vente hors des factures de l’application ?')
    expect(texte).toContain('aucune facture validée de l’application n’est la facture de cette vente')
    expect(texte).toContain(`Validée, la pièce compte comme une vente dans ${LES_ETATS}`)
    expect(texte).toContain('et si c’était le PDF d’une facture de l’application, la vente compterait deux fois')
    expect(texte).toContain('se fige avec la pièce')
    expect(texte).not.toContain('ne sera plus l’exemplaire')
  })

  it('la déclaration qui remplace une désignation nomme la facture quittée ; source, elle dit le double compte', () => {
    const autre = confirmationDeLaDeclaration('vente.pdf', { genre: 'designee', facture: facture() })
    expect(autre).toContain('Elle ne sera plus l’exemplaire de la facture F2026-0007 (CLIENT FICTIF SAS, ')
    expect(autre).toContain('la désignation est remplacée d’un seul geste.')
    expect(autre).not.toContain('la vente sera comptée deux fois')
    const quitteUneSource = confirmationDeLaDeclaration('vente.pdf', { genre: 'designee', facture: source })
    expect(quitteUneSource).toContain('La facture F2026-0042 est la source de sa vente, et la compte déjà : si la pièce est bien son exemplaire, la vente sera comptée deux fois.')
  })

  it('le retrait de la déclaration nomme la pièce et dit ce qu’il change, basculé ou non', () => {
    const bascule = confirmationDuRetraitDeLaDeclaration('recette.pdf', true)
    expect(bascule).toContain('Retirer la déclaration : la pièce « recette.pdf » ne sera plus une vente hors des factures de l’application ?')
    expect(bascule).toContain('ce retrait ne change rien à ce qui se compte aujourd’hui')
    expect(bascule).toContain('elle ne se validera qu’à nouveau déclarée, ou désignée exemplaire d’une facture émise')
    const ailleurs = confirmationDuRetraitDeLaDeclaration('recette.pdf', false)
    expect(ailleurs).toContain('la déclaration n’y disait rien, et la retirer ne change rien à ce qui se compte')
    expect(ailleurs).not.toContain('ne se validera')
  })
})

describe('ce que la pièce est, en phrases', () => {
  it('le titre de la section', () => {
    expect(TITRE_DE_LA_SECTION).toBe('Ce que cette pièce est')
  })

  it('le paragraphe d’un dossier basculé dit les deux marques, ce que chacune fait compter, et la validation qui les attend', () => {
    expect(PARAGRAPHE_D_UN_DOSSIER_BASCULE).toContain('désignée exemplaire de sa facture, ou déclarée vente hors des factures de l’application')
    expect(PARAGRAPHE_D_UN_DOSSIER_BASCULE).toContain('avant de la valider')
    expect(PARAGRAPHE_D_UN_DOSSIER_BASCULE).toContain('la pièce ne compte pas')
    expect(PARAGRAPHE_D_UN_DOSSIER_BASCULE).toContain('compte comme une vente')
  })

  it('une pièce déclarée : basculé, elle compte comme une vente ; ailleurs, la déclaration ne dit rien', () => {
    expect(phraseDeLaPieceDeclaree(true)).toContain('Validée, elle compte comme une vente')
    expect(phraseDeLaPieceDeclaree(false)).toContain('la déclaration n’y change rien')
  })
})

describe('le journal de la pièce, en phrases', () => {
  type Geste = 'designation' | 'retrait_designation' | 'declaration' | 'retrait_declaration'
  const ligne = (geste: Geste, facture_id: string | null) => ({ geste, facture_id })

  it('chaque geste dit ce qu’il a fait ; une facture absente de la liste lue n’est jamais nommée d’un numéro inventé', () => {
    expect(phraseDuGeste(ligne('designation', 'f1'), [facture()])).toBe('Désignée exemplaire de la facture F2026-0007')
    expect(phraseDuGeste(ligne('retrait_designation', 'a1'), [avoir])).toBe('N’est plus l’exemplaire de l’avoir A2026-0001')
    expect(phraseDuGeste(ligne('declaration', null), [])).toBe('Déclarée vente hors des factures de l’application')
    expect(phraseDuGeste(ligne('retrait_declaration', null), [])).toBe('Déclaration retirée')
    expect(phraseDuGeste(ligne('designation', 'f-absente'), [facture()]))
      .toBe('Désignée exemplaire d’une facture que la liste lue ne contient pas')
  })

  it('le moment d’un geste est un instant, dit au jour de qui le regarde', () => {
    expect(dateDuGeste({ fait_le: '2026-10-24T09:30:00Z' })).toMatch(/^2[34]\/10\/2026$/)
  })

  it('les gestes restés ailleurs : le dossier nommé quand son nom est lu, « un autre dossier » sinon', () => {
    expect(phraseDuJournalResteAilleurs(1, 'Ancien dossier')).toBe(
      'Un geste du journal de cette pièce est resté dans le dossier « Ancien dossier », d’où elle vient : une ligne du journal '
      + 'ne change pas de dossier, et il s’y lit.',
    )
    expect(phraseDuJournalResteAilleurs(3, null)).toBe(
      '3 gestes du journal de cette pièce sont restés dans un autre dossier, d’où elle vient : une ligne du journal ne change '
      + 'pas de dossier, et ils s’y lisent.',
    )
  })

  it('illisible, le journal le dit, et n’affirme rien', () => {
    const texte = phraseDuJournalIllisible('accès refusé')
    expect(texte).toContain('(accès refusé)')
    expect(texte).toContain('on ne sait pas qui l’a désignée ou déclarée, ni si des gestes sont restés dans un autre dossier')
  })
})

describe('le refus du formulaire d’une pièce déclarée (VF6c)', () => {
  const declaree = { id: 'p1', dossier_id: 'd1', type_piece: 'vente' as const, facture_id: null, vente_hors_des_factures: true }

  it('déclarée, elle reste une vente : le refus est celui de la garde étendue, sous ses mots', () => {
    const attendu = REFUS_GARDE_JUMELLE.find((r) => r.cle === 'declaree_change_de_nature')?.modele
    expect(attendu).toContain('retirer d\'abord la déclaration')
    for (const type of ['achat', 'note_frais', 'autre'] as const) {
      expect(refusDuFormulaireDeLaPiece(declaree, type, [facture()]), type).toBe(attendu)
      expect(refusDuFormulaireDeLaPiece(declaree, type, null), type).toBe(attendu)
    }
    expect(refusDuFormulaireDeLaPiece(declaree, 'vente', [facture()])).toBeNull()
    expect(refusDuFormulaireDeLaPiece({ ...declaree, vente_hors_des_factures: false }, 'achat', [facture()])).toBeNull()
  })
})

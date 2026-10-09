import { describe, expect, it } from 'vitest'
import { AUCUNE_LIGNE_SUPPRIMEE, confirmationSuppression, messageBilanSuppression } from './bilanSuppression'

describe('messageBilanSuppression', () => {
  it('ne dit rien quand tout ce qui était demandé est parti', () => {
    expect(messageBilanSuppression({ demandes: 3, supprimes: 3, motifs: [] })).toBeNull()
    expect(messageBilanSuppression({ demandes: 1, supprimes: 1, motifs: [] })).toBeNull()
  })

  it('dit d’un document seul qu’il n’est pas parti, et pourquoi', () => {
    expect(messageBilanSuppression({ demandes: 1, supprimes: 0, motifs: ['JWT expired'] })).toBe(
      'Le document n’a pas pu être supprimé, et son fichier n’a pas été touché : JWT expired.',
    )
  })

  it('ne prétend aucun succès quand aucun document n’est parti, et dit chaque raison une fois', () => {
    expect(messageBilanSuppression({
      demandes: 3, supprimes: 0, motifs: ['JWT expired', AUCUNE_LIGNE_SUPPRIMEE, 'JWT expired'],
    })).toBe(
      'Aucun des 3 documents n’a pu être supprimé, et leur fichier n’a pas été touché : '
      + `JWT expired ; ${AUCUNE_LIGNE_SUPPRIMEE}.`,
    )
  })

  it('compte ce qui est parti et ce qui est resté, au singulier comme au pluriel', () => {
    expect(messageBilanSuppression({ demandes: 3, supprimes: 2, motifs: ['refusé'] })).toBe(
      '2 documents supprimés sur 3. 1 n’a pas pu l’être, et son fichier n’a pas été touché : refusé.',
    )
    expect(messageBilanSuppression({ demandes: 3, supprimes: 1, motifs: ['refusé', 'refusé'] })).toBe(
      '1 document supprimé sur 3. 2 n’ont pas pu l’être, et leur fichier n’a pas été touché : refusé.',
    )
  })

  it('compte les restes sur la BASE, pas sur les motifs enregistrés', () => {
    // Un document resté sans motif reste un document resté : le compte ne doit pas le perdre.
    expect(messageBilanSuppression({ demandes: 4, supprimes: 1, motifs: ['refusé'] })).toBe(
      '1 document supprimé sur 4. 3 n’ont pas pu l’être, et leur fichier n’a pas été touché : refusé.',
    )
    expect(messageBilanSuppression({ demandes: 2, supprimes: 1, motifs: [] })).toBe(
      '1 document supprimé sur 2. 1 n’a pas pu l’être, et son fichier n’a pas été touché.',
    )
  })
})

describe('confirmationSuppression', () => {
  it('nomme ce qui part avec les documents', () => {
    expect(confirmationSuppression(3)).toBe(
      'Supprimer définitivement 3 documents ? Cette action est irréversible.\n\n'
      + 'Leur fichier, leur texte lu et les précisions échangées à leur sujet partent avec eux.',
    )
    expect(confirmationSuppression(1)).toBe(
      'Supprimer définitivement 1 document ? Cette action est irréversible.\n\n'
      + 'Son fichier, son texte lu et les précisions échangées à son sujet partent avec lui.',
    )
  })
})

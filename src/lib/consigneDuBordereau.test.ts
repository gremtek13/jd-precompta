import { describe, expect, it } from 'vitest'
import { importsDesLecturesDExistence, LIGNE_DU_BORDEREAU_DANS_MES_PIECES, ligneDuBordereau } from './consigneDuBordereau'
import { motsDuCabinet } from './espaceVentes'
import { CONSIGNE_DU_BORDEREAU_AU_CLIENT } from './refusDesBordereaux'

// LA LIGNE DU BORDEREAU DANS « MES PIÈCES » (BOR6TQ1-Q1 (A)) : sur les seuls dossiers de santé, par la règle de la section de
// l'assurance maladie ; muette tant que rien ne la décide ; aux mots du client. Données FICTIVES.

describe('la ligne du bordereau dans « Mes pièces »', () => {
  it('reprend la consigne de BOR6T-Q1, aux mots du client', () => {
    expect(LIGNE_DU_BORDEREAU_DANS_MES_PIECES).toBe('Un bordereau de télétransmission ne se dépose pas ici : il porte les noms '
      + 'de tes patients. Un bordereau ne se photographie pas : il s’enregistre en PDF depuis ton logiciel de télétransmission, '
      + 'puis s’importe dans « Ma banque », section « Facturé à l’assurance maladie ».')
    expect(LIGNE_DU_BORDEREAU_DANS_MES_PIECES).toContain(CONSIGNE_DU_BORDEREAU_AU_CLIENT.slice(1))
    expect(motsDuCabinet(LIGNE_DU_BORDEREAU_DANS_MES_PIECES)).toEqual([])
  })

  it('dite sur un code NAF de santé ou de la liste fermée, sans attendre les imports', () => {
    for (const code of ['86.90D', '8621Z', '47.73Z', '49.32Z']) {
      expect(ligneDuBordereau(code, 'inconnu'), code).toBe(LIGNE_DU_BORDEREAU_DANS_MES_PIECES)
    }
  })

  it('dite hors de la santé dès qu’un import est lu, d’un côté ou de l’autre', () => {
    expect(ligneDuBordereau('62.01Z', importsDesLecturesDExistence(true, false))).toBe(LIGNE_DU_BORDEREAU_DANS_MES_PIECES)
    expect(ligneDuBordereau(null, importsDesLecturesDExistence(false, true))).toBe(LIGNE_DU_BORDEREAU_DANS_MES_PIECES)
  })

  it('muette hors de la santé sans import lu, et tant que le code n’est pas lu', () => {
    expect(ligneDuBordereau('62.01Z', importsDesLecturesDExistence(false, false))).toBeNull()
    expect(ligneDuBordereau(null, 'inconnu')).toBeNull()
    expect(ligneDuBordereau('pas un code', 'inconnu')).toBeNull()
    expect(ligneDuBordereau(undefined, 'inconnu')).toBeNull()
    // Une lecture vide ne dit jamais « aucun » : seule une ligne lue change la règle.
    expect(importsDesLecturesDExistence(false, false)).toBe('inconnu')
    expect(importsDesLecturesDExistence(null, null)).toBe('inconnu')
  })
})

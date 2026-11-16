import { describe, expect, it } from 'vitest'
import { motsDuCabinet } from './espaceVentes'
import {
  FICHIER_INDISPONIBLE, FICHIER_INTROUVABLE, fichierDeLaPiece, fichierDuDocument, motDuRefus, nomAccessibleDuGeste,
  OUVERTURE_BLOQUEE, TEXTES_DE_L_OUVERTURE,
} from './ouvertureDeMesPieces'

// LE CLIENT OUVRE LE FICHIER D'UN ENVOI (16/11/2026) : quel fichier, et les mots d'un échec. Le geste et son câblage :
// ClientUpload.ouverture.test.tsx et DerniersEnvoisAccueil.test.tsx.

const piece = (o: { storage_path?: string; lisible_path?: string | null; dossier_id?: string } = {}) => ({
  storage_path: 'd1/facture.pdf', lisible_path: null, dossier_id: 'd1', ...o,
})

describe('le fichier qu’un envoi désigne', () => {
  it('une pièce : son original, ou sa version lisible quand elle en a une', () => {
    expect(fichierDeLaPiece(piece())).toEqual({ seau: 'pieces', chemin: 'd1/facture.pdf', dossierId: 'd1' })
    expect(fichierDeLaPiece(piece({ storage_path: 'd1/f.xml', lisible_path: 'd1/f.pdf' })))
      .toEqual({ seau: 'pieces', chemin: 'd1/f.pdf', dossierId: 'd1' })
  })

  it('un document : dans le même seau que les pièces', () => {
    expect(fichierDuDocument({ storage_path: 'd1/releve.csv', dossier_id: 'd1' }))
      .toEqual({ seau: 'pieces', chemin: 'd1/releve.csv', dossierId: 'd1' })
  })

  it('rien, sur un chemin vide ou hors du dossier de la ligne (CFCS-Q1) : le stockage n’est pas demandé', () => {
    expect(fichierDeLaPiece(piece({ storage_path: '' }))).toBeNull()
    for (const chemin of ['d2/facture.pdf', 'd1/../d2/facture.pdf', 'd1', '/d1/facture.pdf', 'd1/%2e%2e/d2/f.pdf']) {
      expect(fichierDeLaPiece(piece({ storage_path: chemin })), chemin).toBeNull()
      expect(fichierDuDocument({ storage_path: chemin, dossier_id: 'd1' }), chemin).toBeNull()
    }
    // La version lisible hors du dossier ne se rattrape pas par l'original : c'est elle qu'on montrerait.
    expect(fichierDeLaPiece(piece({ lisible_path: 'd2/f.pdf' }))).toBeNull()
  })
})

describe('les mots du client', () => {
  it('chaque cause a sa phrase, jamais celle du cabinet', () => {
    expect(motDuRefus('chemin')).toBe(FICHIER_INTROUVABLE)
    expect(motDuRefus('lien')).toBe(FICHIER_INDISPONIBLE)
    expect(motDuRefus('telechargement')).toBe(FICHIER_INDISPONIBLE)
    expect(motDuRefus('bloquee')).toBe(OUVERTURE_BLOQUEE)
  })

  it('au tutoiement, sans un mot du cabinet ni de jargon', () => {
    for (const texte of [...TEXTES_DE_L_OUVERTURE, nomAccessibleDuGeste('facture.pdf')]) {
      expect(motsDuCabinet(texte), texte).toEqual([])
      expect(texte, texte).not.toMatch(/stockage|chemin|URL|sign/i)
    }
  })
})

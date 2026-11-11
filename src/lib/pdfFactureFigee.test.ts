import { describe, expect, it } from 'vitest'
import { factureFigee } from '../test/mentionsFigees'
import { contenuDeLaFactureFigee, instantDeLaCopie, titreDeLaCopie } from './pdfFactureFigee'
import { pdfDeLaLettre, pdfDesBlocs } from './pdfLettreDeMission'
import type { FactureLigne } from './types'

// LA COPIE D'UNE FACTURE FIGÉE (ligne 47, LM8 ; LM8-Q3 (A)) : ses blocs se tirent des SEULES valeurs figées — l'émetteur figé,
// jamais le nom interne du dossier —, une facture d'avant ne se tire pas, un avoir sans le numéro de sa facture non plus ; le
// PDF se rend aux mêmes octets à chaque tirage (daté du jour d'émission, jamais de l'heure du clic). Données FICTIVES.

const ligne = (p: Partial<FactureLigne> = {}): FactureLigne => ({
  id: 'l1', facture_id: 'f1', ordre: 1, designation: 'Tenue de la comptabilité — novembre 2027', quantite: 1,
  prix_unitaire_ht: 100, taux_tva: 20, unite: null, reference: null, ...p,
} as FactureLigne)
const texte = (blocs: { texte: string }[] | null) => (blocs ?? []).map((b) => b.texte).join('\n')

describe('les blocs de la copie', () => {
  it('se tirent des valeurs figées : le nom légal figé, le numéro de TVA écrit par la base, les lignes et les totaux', () => {
    const blocs = contenuDeLaFactureFigee(factureFigee(), [ligne()], null)
    expect(blocs?.[0]).toEqual({ genre: 'titre', texte: 'FACTURE F2027-0001' })
    const t = texte(blocs)
    expect(t).toContain('Camille Essai EI')
    expect(t).not.toContain('Nom interne du dossier')
    expect(t).toContain('N° TVA intracommunautaire')
    expect(t).toContain('Client Fictif SAS')
    expect(t).toContain('Tenue de la comptabilité — novembre 2027')
    expect(t).toMatch(/Total TTC : 120,00/)
    expect(t).toContain('Émise le 02/11/2027')
  })

  it('ne se tirent pas d’une facture d’avant, d’un brouillon, ni d’un avoir sans le numéro de sa facture', () => {
    expect(contenuDeLaFactureFigee(factureFigee({ mentions_figees: false }), [ligne()], null)).toBeNull()
    expect(contenuDeLaFactureFigee(factureFigee({ statut: 'brouillon' }), [ligne()], null)).toBeNull()
    const avoir = factureFigee({ type: 'avoir', numero: 'A2027-0001', facture_origine_id: 'f0' })
    expect(contenuDeLaFactureFigee(avoir, [ligne()], null)).toBeNull()
    expect(contenuDeLaFactureFigee(avoir, [ligne()], ' ')).toBeNull()
    const blocs = contenuDeLaFactureFigee(avoir, [ligne()], 'F2027-0001')
    expect(blocs?.[0].texte).toBe('AVOIR A2027-0001')
    expect(texte(blocs)).toContain('En référence à la facture F2027-0001')
  })

  it('le titre et l’instant de la copie', () => {
    expect(titreDeLaCopie({ type: 'facture', numero: null })).toBe('FACTURE')
    expect(instantDeLaCopie({ date_emission: '2027-11-02' })).toBe('2027-11-02T12:00:00Z')
  })
})

describe('le PDF', () => {
  it('rend les mêmes octets à chaque tirage, et un vrai PDF', async () => {
    const blocs = contenuDeLaFactureFigee(factureFigee(), [ligne()], null)!
    const p = { titre: 'FACTURE F2027-0001', pied: 'Copie fictive', instant: instantDeLaCopie(factureFigee()) }
    const [a, b] = await Promise.all([pdfDesBlocs(blocs, p), pdfDesBlocs(blocs, p)])
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
    expect(new TextDecoder().decode(a.slice(0, 5))).toBe('%PDF-')
  })

  it('la lettre de mission passe par la même mise en page (son titre, son pied d’empreinte)', async () => {
    const blocs = [{ genre: 'titre' as const, texte: 'Lettre de mission — fictive' }]
    const lettre = await pdfDeLaLettre(blocs, { empreinte: 'abc', instant: '2027-01-01T00:00:00Z' })
    const commune = await pdfDesBlocs(blocs, { titre: 'Lettre de mission', pied: 'Empreinte du contenu : abc', instant: '2027-01-01T00:00:00Z' })
    expect(Buffer.from(lettre).equals(Buffer.from(commune))).toBe(true)
  })
})

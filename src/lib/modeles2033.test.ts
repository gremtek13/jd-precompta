import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  avertissementDuFormulaire2033, LIASSE_EXPORTEE, mentionDuPdf2033, millesimeDeLExercice2033, MODELES_2033,
  modeleDuFormulaire2033,
} from './modeles2033'
import { texteCompatiblePdf } from './gabarit2035'

// LES MODÈLES DE LA LIASSE 2033, MILLÉSIME PAR MILLÉSIME (LIA6). Source : le formulaire 2033-SD 2026, cerfa 15948*08
// (impots.gouv.fr, 2033-sd_5394.pdf, SHA-256 ce4c5190…b6cb), livré dans public/formulaires/2033-sd-2026.pdf.

describe('les modèles de la liasse 2033', () => {
  it('chaque millésime servi est le fichier de la DGFiP, à son empreinte, et dit son millésime en tête du 2033-B', async () => {
    expect(MODELES_2033.size).toBeGreaterThan(0)
    for (const [millesime, modele] of MODELES_2033) {
      expect(modele.chemin, String(millesime)).toBe(`/formulaires/2033-sd-${millesime}.pdf`)
      expect(existsSync(`public${modele.chemin}`), modele.chemin).toBe(true)
      const donnees = readFileSync(`public${modele.chemin}`)
      expect(createHash('sha256').update(donnees).digest('hex'), modele.chemin).toBe(modele.empreinte)
      const doc = await pdfjs.getDocument({ data: new Uint8Array(donnees) }).promise
      expect(doc.numPages).toBe(7)
      const texte = (await (await doc.getPage(2)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')
      expect(texte).toMatch(new RegExp(`2033-B-SD\\s+${millesime}`))
    }
  })

  it('l’exercice N se remplit sur le millésime N + 1 ; sans lui, sur le plus récent livré, marqué comme substitut', () => {
    expect(millesimeDeLExercice2033(2025)).toBe(2026)
    expect(modeleDuFormulaire2033(2025)).toMatchObject({ millesime: 2026, attendu: 2026, substitut: false })
    expect(modeleDuFormulaire2033(2026)).toMatchObject({ millesime: 2026, attendu: 2027, substitut: true })
    expect(modeleDuFormulaire2033(2024)).toMatchObject({ millesime: 2026, attendu: 2025, substitut: true })
  })

  it('l’avertissement et la mention ne se disent que d’un substitut, et la mention s’écrit en WinAnsi', () => {
    expect(avertissementDuFormulaire2033(2025)).toBeNull()
    expect(mentionDuPdf2033(2025)).toEqual([])
    expect(avertissementDuFormulaire2033(2026)).toMatch(/n’est pas encore publié/)
    expect(avertissementDuFormulaire2033(2024)).toMatch(/n’est pas dans l’application/)
    for (const ligne of mentionDuPdf2033(2026)) expect(texteCompatiblePdf(ligne)).toBe(ligne)
  })

  it('le drapeau de l’écran reste baissé : aucun écran n’offre la liasse avant LIA7', () => {
    expect(LIASSE_EXPORTEE).toBe(false)
  })
})

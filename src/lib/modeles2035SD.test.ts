import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  avertissementDuFormulaire2035SD, mentionDuPdf2035SD, millesimeDeLExercice2035SD, MODELES_2035_SD, modeleDuFormulaire2035SD,
} from './modeles2035SD'
import { MODELES_2035 } from './modeles2035'
import { texteCompatiblePdf } from './gabarit2035'

// LES MODÈLES DE LA DÉCLARATION 2035-SD, MILLÉSIME PAR MILLÉSIME. Source : la déclaration n° 2035-SD 2026, cerfa 11176*28
// (impots.gouv.fr, /sites/default/files/formulaires/2035-sd/2026/2035-sd_5382.pdf, SHA-256 2dc4ba76…82f0), livrée dans
// public/formulaires/2035-sd-declaration-2026.pdf. À ne pas confondre avec la liasse des annexes (2035-A à 2035-G).

describe('les modèles de la déclaration 2035-SD', () => {
  it('chaque millésime servi est le fichier de la DGFiP, à son empreinte, et se dit déclaration principale de son millésime', async () => {
    expect(MODELES_2035_SD.size).toBeGreaterThan(0)
    for (const [millesime, modele] of MODELES_2035_SD) {
      expect(modele.chemin, String(millesime)).toBe(`/formulaires/2035-sd-declaration-${millesime}.pdf`)
      expect(existsSync(`public${modele.chemin}`), modele.chemin).toBe(true)
      const donnees = readFileSync(`public${modele.chemin}`)
      expect(createHash('sha256').update(donnees).digest('hex'), modele.chemin).toBe(modele.empreinte)
      const doc = await pdfjs.getDocument({ data: new Uint8Array(donnees) }).promise
      expect(doc.numPages).toBe(4)
      const texte = (await (await doc.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')
      expect(texte).toContain(`N° 2035-SD – ${millesime}`)
      expect(texte).toContain('11176')
    }
  })

  it('n’est pas la liasse des annexes que l’application remplissait déjà', () => {
    for (const [millesime, modele] of MODELES_2035_SD) expect(modele.chemin).not.toBe(MODELES_2035.get(millesime))
  })

  it('l’exercice N se remplit sur le millésime N + 1 ; sans lui, sur le plus récent livré, marqué comme substitut', () => {
    expect(millesimeDeLExercice2035SD(2025)).toBe(2026)
    expect(modeleDuFormulaire2035SD(2025)).toMatchObject({ millesime: 2026, attendu: 2026, substitut: false })
    expect(modeleDuFormulaire2035SD(2026)).toMatchObject({ millesime: 2026, attendu: 2027, substitut: true })
    expect(modeleDuFormulaire2035SD(2024)).toMatchObject({ millesime: 2026, attendu: 2025, substitut: true })
  })

  it('l’avertissement et la mention ne se disent que d’un substitut, et la mention s’écrit en WinAnsi', () => {
    expect(avertissementDuFormulaire2035SD(2025)).toBeNull()
    expect(mentionDuPdf2035SD(2025)).toEqual([])
    expect(avertissementDuFormulaire2035SD(2026)).toMatch(/n’est pas encore publié/)
    expect(avertissementDuFormulaire2035SD(2024)).toMatch(/n’est pas dans l’application/)
    for (const ligne of mentionDuPdf2035SD(2026)) expect(texteCompatiblePdf(ligne)).toBe(ligne)
  })
})

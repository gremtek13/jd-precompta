import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { MODELES_2035, avertissementDuFormulaire, mentionDuPdf, millesimeDeLExercice, modeleDuFormulaire } from './modeles2035'

// UN MODÈLE PAR MILLÉSIME, ET SANS LE SIEN LE DERNIER, AVEC UN AVERTISSEMENT (étape 2035S6, 2035S-Q5 (B), 02/11/2026). Source : le formulaire 2035-SD 2026,
// « REVENUS 2025 », cerfa 15945*08 (impots.gouv.fr, 2035-sd_5384.pdf), livré dans public/formulaires/2035-sd-2026.pdf.

async function revenusDeLaPremierePage(chemin: string): Promise<number | null> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(`public${chemin}`)) }).promise
  const texte = (await (await doc.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')
  const m = /REVENUS (\d{4})/.exec(texte)
  return m ? Number(m[1]) : null
}

describe('les modèles de la 2035, millésime par millésime', () => {
  it('chaque millésime servi est un fichier livré, dont la première page dit les revenus de l’année d’avant', async () => {
    expect(MODELES_2035.size).toBeGreaterThan(0)
    for (const [millesime, chemin] of MODELES_2035) {
      expect(chemin, String(millesime)).toBe(`/formulaires/2035-sd-${millesime}.pdf`)
      expect(existsSync(`public${chemin}`), chemin).toBe(true)
      expect(await revenusDeLaPremierePage(chemin), chemin).toBe(millesime - 1)
    }
  })

  it('l’exercice N se remplit sur le millésime N + 1 ; sans lui, sur le plus récent livré, marqué comme substitut', () => {
    expect(millesimeDeLExercice(2025)).toBe(2026)
    expect(modeleDuFormulaire(2025)).toEqual({ millesime: 2026, chemin: '/formulaires/2035-sd-2026.pdf', attendu: 2026, substitut: false })
    expect(modeleDuFormulaire(2026)).toEqual({ millesime: 2026, chemin: '/formulaires/2035-sd-2026.pdf', attendu: 2027, substitut: true })
    expect(modeleDuFormulaire(2024)).toEqual({ millesime: 2026, chemin: '/formulaires/2035-sd-2026.pdf', attendu: 2025, substitut: true })
  })

  it('avertit avant le clic : un millésime pas encore publié, ou absent de l’application ; rien sur le bon', () => {
    expect(avertissementDuFormulaire(2025)).toBeNull()
    expect(avertissementDuFormulaire(2026)).toBe(
      'Le formulaire 2035 des revenus 2026 (millésime 2027) n’est pas encore publié : le PDF est rempli sur le millésime 2026, '
      + 'sous l’en-tête « REVENUS 2025 ». Il ne se dépose pas tel quel : les cases sont à reporter sur le formulaire du bon '
      + 'millésime ou sur le logiciel de dépôt.')
    expect(avertissementDuFormulaire(2024)).toMatch(/^Le formulaire 2035 des revenus 2024 \(millésime 2025\) n’est pas dans l’application : le PDF est rempli sur le millésime 2026, /)
  })

  it('la mention du PDF dit l’exercice, le millésime utilisé, l’en-tête et le millésime à reporter ; aucune sur le bon', () => {
    expect(mentionDuPdf(2025)).toEqual([])
    expect(mentionDuPdf(2026)).toEqual([
      'ATTENTION - exercice 2026 rempli sur le formulaire millésime 2026 (en-tête « REVENUS 2025 »).',
      'Ne pas déposer tel quel : reporter les cases sur le formulaire du millésime 2027 ou le logiciel de dépôt.',
    ])
  })
})

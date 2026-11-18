import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { texteDuResultat } from '../../outils/bordereau/sortie.mts'
import { bordereauFictifEnPdf, DESTINATAIRE_FICTIF, LIGNES_DU_BORDEREAU_FICTIF } from '../test/bordereauFictif'

// L'OUTIL LOCAL DU BORDEREAU DE TÉLÉTRANSMISSION (conception 59, BOR1-Q4 (B)) : le vrai lanceur, outils/bordereau/lire.mjs,
// joué dans un processus à part sur un PDF FICTIF (src/test/bordereauFictif.ts) écrit dans un dossier temporaire hors du
// dépôt. Ce qui est gardé : le résultat s'affiche (l'en-tête du lot, le régime, les totaux), et AUCUNE cellule d'une ligne de
// facture, ni le libellé du destinataire du règlement, ni le chemin du fichier ; un refus n'affiche que sa raison ; sans
// argument, l'usage. Et le texte du lanceur : aucune sortie réseau, aucune écriture de fichier.

const executer = promisify(execFile)
const LANCEUR = resolve(process.cwd(), 'outils/bordereau/lire.mjs')

let dossier = ''
let bon = ''
let faux = ''
let pasUnPdf = ''

beforeAll(async () => {
  // Un nom de dossier qui porte un faux nom de personne : il ne doit pas s'afficher.
  dossier = mkdtempSync(join(tmpdir(), 'BENEFICIAIRE-CHEMIN-'))
  bon = join(dossier, 'bordereau.pdf')
  faux = join(dossier, 'faux.pdf')
  pasUnPdf = join(dossier, 'texte.pdf')
  writeFileSync(bon, await bordereauFictifEnPdf({ destinataire: DESTINATAIRE_FICTIF }))
  writeFileSync(faux, await bordereauFictifEnPdf({ total: ['4 600,11', '4 403,91', '196,20', '0,00'] }))
  writeFileSync(pasUnPdf, 'ceci n’est pas un PDF')
})

afterAll(() => {
  if (dossier !== '') rmSync(dossier, { recursive: true, force: true })
})

async function lancer(...args: string[]): Promise<{ code: number; sortie: string; erreurs: string }> {
  try {
    const { stdout, stderr } = await executer(process.execPath, [LANCEUR, ...args], { cwd: process.cwd(), timeout: 60_000 })
    return { code: 0, sortie: stdout, erreurs: stderr }
  } catch (e) {
    const r = e as { code?: number; stdout?: string; stderr?: string }
    return { code: r.code ?? -1, sortie: r.stdout ?? '', erreurs: r.stderr ?? '' }
  }
}

function sansValeurDUneLigne(texte: string) {
  // Les cellules de texte, de date et de numéro ; parmi les montants, ceux d'une ligne qu'aucun total ne redit (la mutuelle
  // du lot est celle de sa seule ligne qui en porte : 196,20 s'affiche comme total, à bon droit).
  const cellules = LIGNES_DU_BORDEREAU_FICTIF.flat().filter((c) => c.length >= 3 && !/^[\d ]+,\d{2}$/.test(c))
  expect(cellules).toHaveLength(10)
  for (const cellule of [...cellules, '654,00', '457,80', '3 946,10']) expect(texte).not.toContain(cellule)
  expect(texte).not.toContain('BENEFICIAIRE')
  expect(texte).not.toContain(dossier)
}

describe('le lanceur, dans un processus à part, sur un PDF fictif', () => {
  it('un bordereau lu : l’en-tête, le régime, les totaux, et aucune valeur d’une ligne', async () => {
    const r = await lancer(bon)
    expect(r.code).toBe(0)
    expect(r.erreurs).toBe('')
    expect(r.sortie).toContain('BORDEREAU LU : 1 lot')
    expect(r.sortie).toContain('Numéro du lot ........ 42')
    expect(r.sortie).toContain('Créé le .............. 09/11/2026')
    expect(r.sortie).toContain('Régime ............... 01 (CPAM, d\'après le libellé)')
    expect(r.sortie).toContain('Total ................ 4 600,10 €')
    expect(r.sortie).toContain('(caisse + mutuelle) : 4 600,10 €')
    sansValeurDUneLigne(r.sortie)
  }, 60_000)

  it('un bordereau refusé : sa raison seule ; un fichier qui n’est pas un PDF, une raison fixe', async () => {
    const r = await lancer(faux)
    expect(r.code).toBe(1)
    expect(r.sortie).toContain('BORDEREAU REFUSÉ : bordereau 1 : la somme des lignes de la colonne « Total » diffère du total imprimé.')
    sansValeurDUneLigne(r.sortie)
    const p = await lancer(pasUnPdf)
    expect(p.code).toBe(1)
    expect(p.sortie).toContain('BORDEREAU REFUSÉ : le fichier ne s’ouvre pas comme un PDF.')
    sansValeurDUneLigne(p.sortie)
  }, 60_000)

  it('un chemin qui n’existe pas : une raison fixe, sans le chemin ; sans argument : l’usage', async () => {
    const absent = join(dossier, 'absent.pdf')
    const r = await lancer(absent)
    expect(r.code).toBe(1)
    expect(r.sortie).toContain('Le fichier ne se lit pas')
    expect(r.sortie).not.toContain(absent)
    const u = await lancer()
    expect(u.code).toBe(2)
    expect(u.sortie).toMatch(/^Usage : node outils\/bordereau\/lire\.mjs/)
  }, 60_000)
})

describe('le texte affiché, et le texte de l’outil', () => {
  it('un refus ne dit que sa raison', () => {
    expect(texteDuResultat({ etat: 'refuse', raison: 'bordereau 1, page 1 : x' })).toMatch(/^BORDEREAU REFUSÉ : bordereau 1, page 1 : x\./)
  })

  it('aucun réseau, aucune écriture de fichier, aucun journal hors du résultat', () => {
    const textes = ['outils/bordereau/lire.mjs', 'outils/bordereau/outil.mts', 'outils/bordereau/sortie.mts']
      .map((f) => readFileSync(resolve(process.cwd(), f), 'utf8').replace(/^\s*\/\/.*$/gm, ''))
    for (const t of textes) {
      expect(t).not.toMatch(/\bfetch\s*\(|https?:\/\/|node:https?|node:net|XMLHttpRequest|WebSocket/)
      expect(t).not.toMatch(/writeFile|appendFile|createWriteStream|mkdir/)
      expect(t).not.toMatch(/standardFontDataUrl|cMapUrl|wasmUrl|\burl\s*:/)
    }
    // Une seule écriture à l'écran, celle du résultat (et de l'usage) ; la console est muette.
    expect(textes[1].match(/process\.stdout\.write/g)).toHaveLength(1)
    expect(textes[1]).toContain('getDocument({ data: octets })')
  })
})

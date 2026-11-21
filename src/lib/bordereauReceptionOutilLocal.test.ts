import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  LECTURE_DES_PDF_MS, OCTETS_DECOMPRESSES_MAX, TAILLE_MAX_PIECE, jugerCommeLaReception, texteDuJugement,
} from '../../outils/bordereau/jugementReception.mts'
import { bordereauFictifEnPdf, DESTINATAIRE_FICTIF, LIGNES_DU_BORDEREAU_FICTIF } from '../test/bordereauFictif'

// L'OUTIL LOCAL DE LA RÉCEPTION (BOR6R-Q1) : le vrai lanceur, outils/bordereau/reception.mjs, joué dans un processus à part sur
// des PDF FICTIFS écrits dans un dossier temporaire hors du dépôt. Gardé : le bordereau fictif dit « reconnu », un PDF ordinaire
// « non reconnu » avec ses comptes, une page sans texte « 0 fragment » ; AUCUNE valeur du fichier ne s'affiche (ni une
// cellule, ni le destinataire, ni un montant, ni le texte du PDF ordinaire, ni le chemin) ; les bornes sont celles de
// receive-email ; le texte de l'outil n'a ni réseau ni écriture de fichier.

const executer = promisify(execFile)
const LANCEUR = resolve(process.cwd(), 'outils/bordereau/reception.mjs')
const TEXTE_ORDINAIRE = ['FACTURE ORDINAIRE 77123', 'Fournisseur ZORGLUB', 'Total 1 234,56']

let dossier = ''
let bordereau = ''
let ordinaire = ''
let vide = ''

async function pdfOrdinaire(lignes: readonly string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const police = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595, 842])
  lignes.forEach((l, i) => page.drawText(l, { x: 40, y: 780 - i * 20, size: 10, font: police }))
  return doc.save()
}

beforeAll(async () => {
  dossier = mkdtempSync(join(tmpdir(), 'BENEFICIAIRE-CHEMIN-'))
  bordereau = join(dossier, 'bordereau.pdf')
  ordinaire = join(dossier, 'ordinaire.pdf')
  vide = join(dossier, 'vide.pdf')
  writeFileSync(bordereau, await bordereauFictifEnPdf({ destinataire: DESTINATAIRE_FICTIF, pages: 2 }))
  writeFileSync(ordinaire, await pdfOrdinaire(TEXTE_ORDINAIRE))
  writeFileSync(vide, await pdfOrdinaire([]))
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

function sansValeurDuFichier(texte: string) {
  for (const cellule of LIGNES_DU_BORDEREAU_FICTIF.flat().filter((c) => c.length >= 3)) expect(texte).not.toContain(cellule)
  for (const valeur of ['4 600,10', '4 403,91', '196,20', 'BENEFICIAIRE', 'Televitale', '18/11/2026', '09/11/2026', dossier]) {
    expect(texte).not.toContain(valeur)
  }
  for (const valeur of ['77123', 'ZORGLUB', '1 234,56', 'ORDINAIRE']) expect(texte).not.toContain(valeur)
}

describe('le lanceur, dans un processus à part, sur des PDF fictifs', () => {
  it('le bordereau fictif : reconnu, une page lue, et aucune valeur du fichier', async () => {
    const r = await lancer(bordereau)
    expect(r.code).toBe(0)
    expect(r.erreurs).toBe('')
    expect(r.sortie).toMatch(/^RECONNU COMME UN BORDEREAU : la réception par e-mail l’écarterait\./)
    expect(r.sortie).toContain('Pages lues .............. 1 ')
    expect(r.sortie).toContain('Arrêt à une borne ....... non')
    expect(r.sortie).toMatch(/Poids du fichier \.+ [\d,]+ Kio/)
    expect(r.sortie).toMatch(/Durée de la lecture \.+ \d+ ms/)
    sansValeurDuFichier(r.sortie)
  }, 60_000)

  it('un PDF ordinaire : non reconnu, ses fragments comptés, et aucune valeur du fichier', async () => {
    const r = await lancer(ordinaire)
    expect(r.code).toBe(0)
    expect(r.sortie).toMatch(/^NON RECONNU : il serait déposé comme une pièce\./)
    expect(r.sortie).toContain('Fragments de texte lus par page : page 1 : 3')
    expect(r.sortie).toContain('Chaque page a du texte lisible.')
    sansValeurDuFichier(r.sortie)
    const v = await lancer(vide)
    expect(v.sortie).toContain('page 1 : 0')
    expect(v.sortie).toContain('Aucune page n’a de couche de texte lisible par ce lecteur')
  }, 60_000)

  it('un chemin absent : une raison fixe, sans le chemin ; sans argument : l’usage', async () => {
    const absent = join(dossier, 'absent.pdf')
    const r = await lancer(absent)
    expect(r.code).toBe(1)
    expect(r.sortie).toContain('Le fichier ne se lit pas')
    expect(r.sortie).not.toContain(absent)
    const u = await lancer()
    expect(u.code).toBe(2)
    expect(u.sortie).toMatch(/^Usage : node outils\/bordereau\/reception\.mjs/)
  }, 60_000)
})

describe('le jugement, et le texte de l’outil', () => {
  const horloge = () => 0

  it('un fichier qui n’est pas un PDF est illisible ; au-delà de 20 Mio, écarté pour son poids sans lecture', async () => {
    const j = await jugerCommeLaReception(new TextEncoder().encode('ceci n’est pas un PDF'), horloge)
    expect(j).toMatchObject({ conclusion: 'illisible', raison: 'pas-un-pdf', pages: 0 })
    expect(texteDuJugement(j)).toMatch(/^ILLISIBLE PAR CE LECTEUR \(le fichier ne commence pas comme un PDF\) : il serait déposé comme une pièce\./)
    const lourd = await jugerCommeLaReception(new Uint8Array(TAILLE_MAX_PIECE + 1), horloge)
    expect(lourd.conclusion).toBe('trop-lourd')
  })

  it('une borne atteinte se dit', () => {
    const t = texteDuJugement({ conclusion: 'illisible', octets: 10, raison: 'borne', pages: 3, dureeMs: 1001 })
    expect(t).toContain('Arrêt à une borne ....... oui')
  })

  it('les bornes sont celles de receive-email', () => {
    const source = readFileSync(resolve(process.cwd(), 'supabase/functions/receive-email/index.ts'), 'utf8')
    expect(source).toContain('export const TAILLE_MAX_PIECE = 20 * 1024 * 1024')
    expect(source).toContain('const OCTETS_DECOMPRESSES_MAX = 48 * 1024 * 1024')
    expect(source).toContain('const LECTURE_DES_PDF_MS = 1000')
    expect(source).toContain('(page) => porteLaFormeDUnBordereau([page]),')
    expect([TAILLE_MAX_PIECE, OCTETS_DECOMPRESSES_MAX, LECTURE_DES_PDF_MS]).toEqual([20 * 1024 * 1024, 48 * 1024 * 1024, 1000])
  })

  it('aucun réseau, aucune écriture de fichier, une seule écriture à l’écran', () => {
    const textes = ['outils/bordereau/reception.mjs', 'outils/bordereau/reception.mts', 'outils/bordereau/jugementReception.mts']
      .map((f) => readFileSync(resolve(process.cwd(), f), 'utf8').replace(/^\s*\/\/.*$/gm, ''))
    for (const t of textes) {
      expect(t).not.toMatch(/\bfetch\s*\(|https?:\/\/|node:https?|node:net|XMLHttpRequest|WebSocket|pdfjs/)
      expect(t).not.toMatch(/writeFile|appendFile|createWriteStream|mkdir/)
    }
    expect(textes[1].match(/process\.stdout\.write/g)).toHaveLength(1)
    // Le jugement n'appelle que les modules de src/lib, jamais la copie de receive-email.
    expect(textes[2]).toContain("from '../../src/lib/texteDUnPdf'")
    expect(textes[2]).toContain("from '../../src/lib/bordereauDeTeletransmission'")
    expect(textes[2]).not.toContain('supabase/functions')
  })
})

import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { mentionDuPdf } from './modeles2035'

// REMPLIR2035 SUR LE VRAI FORMULAIRE (2035S-Q5, (B), 02/11/2026). Le pdf.js du navigateur touche au DOM dès l'import : il est
// remplacé ici par sa version « legacy », celle que gabarit2035.test.ts lit déjà, et le fichier est servi depuis public/.
vi.mock('pdfjs-dist', async () => await import('pdfjs-dist/legacy/build/pdf.mjs'))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', async () => {
  const { createRequire } = await import('node:module')
  const { pathToFileURL } = await import('node:url')
  return { default: pathToFileURL(createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href }
})

const { remplir2035 } = await import('./remplir2035')

const ENTETE = { nom: 'DUPONT', prenom: 'Jean', siret: '12345678900011' } as unknown as Parameters<typeof remplir2035>[1]

async function texteDeLaPage(pdf: Uint8Array, numero: number): Promise<string> {
  const doc = await pdfjs.getDocument({ data: pdf.slice(0) }).promise
  return (await (await doc.getPage(numero)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')
}

async function remplir(annee: number) {
  return remplir2035(new Map([['BA', 1000]]), ENTETE, null, annee)
}

// Le remplissage et la lecture des deux PDF se paient une fois, dans un `beforeAll` : dans un test, sous la charge de la
// suite entière, le premier chargement de pdf-lib et de pdf.js dépassait les 5 s d'un test (barrière du 04/11/2026). Le
// `fetch` simulé sert le formulaire depuis public/, puis se retire, réussite ou non.
let pageDe2026 = ''
let pageDe2025 = ''
beforeAll(async () => {
  vi.stubGlobal('fetch', async (chemin: string) => {
    const octets = readFileSync(`public${chemin}`)
    return { ok: true, status: 200, arrayBuffer: async () => octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) }
  })
  try {
    pageDe2026 = await texteDeLaPage((await remplir(2026)).pdf, 1)
    pageDe2025 = await texteDeLaPage((await remplir(2025)).pdf, 1)
  } finally {
    vi.unstubAllGlobals()
  }
})

describe('remplir2035 — la mention d’un millésime absent', () => {
  it('écrit la mention en tête de la page remplie quand le formulaire de l’exercice n’est pas livré', () => {
    const texte = pageDe2026.replace(/\s+/g, ' ')
    for (const ligne of mentionDuPdf(2026)) expect(texte).toContain(ligne)
  })

  it('n’écrit rien sur le bon millésime', () => {
    expect(pageDe2025).not.toContain('ATTENTION')
  })
})

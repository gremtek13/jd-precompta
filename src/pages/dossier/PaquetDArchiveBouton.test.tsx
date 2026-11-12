import { act, fireEvent, render, screen } from '@testing-library/react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// LE BOUTON SEUL (ligne 44, INAL3a) : son verrou, son refus dit sans téléchargement, et sa place — l'onglet Écritures du
// cabinet seul. La fabrication et la lecture sont gardées par leurs modules (paquetDArchive.test.ts,
// paquetDArchiveLecture.test.ts).
const faux = vi.hoisted(() => ({
  lectures: 0,
  liberer: null as null | (() => void),
  refus: null as string | null,
  telechargements: 0,
  enregistrements: [] as Record<string, unknown>[],
  enregistrement: { ok: true } as { ok: true } | { ok: false; message: string },
  piste: { etat: 'produite', contenu: '\uFEFFDate;Compte\r\n2025-02-03;606100' } as { etat: 'produite'; contenu: string } | { etat: 'refusee'; motif: string },
  pistes: 0,
  pdf: { etat: 'rempli', octets: new Uint8Array([37, 80, 68, 70]), casesNonPlacees: [], avertissement: null } as
    { etat: 'rempli'; octets: Uint8Array; casesNonPlacees: string[]; avertissement: string | null } | { etat: 'impossible'; motif: string },
}))

// Le PDF de la 2035 (INAL3c) : remplir2035.ts charge pdf.js ; son module est gardé par paquetDArchive2035.test.ts.
vi.mock('../../lib/paquetDArchive2035', () => ({ la2035DuPaquet: async () => faux.pdf }))

// L'enregistrement du téléchargement (ligne 44, INAL5) : la lecture du départ simulée — le vrai module lit le drapeau, et
// n'écrit rien tant qu'il est baissé ; ici on voit ce que le bouton lui passe, et ce qu'il dit d'un refus.
vi.mock('../../lib/departDuClientLecture', () => ({
  enregistrerLePaquetTelecharge: async (p: Record<string, unknown>) => { faux.enregistrements.push(p); return faux.enregistrement },
}))

vi.mock('../../lib/paquetDArchiveLecture', () => ({
  lireLePaquet: () => {
    faux.lectures++
    return new Promise((resoudre) => {
      faux.liberer = () => resoudre(faux.refus !== null ? { etat: 'refusee', motif: faux.refus } : {
        etat: 'lue', piecesCitees: [], originaux: [],
        exercice: {
          dossier_id: 'd1', annee: 2025, valide_le: '2026-01-15T09:30:00Z', empreinte: 'e'.repeat(64),
          empreinte_precedente: null, forme_empreinte: 2, nb_ecritures: 1, nb_lignes: 2, declaration: { AG: 1200 },
        },
      })
    })
  },
}))

import PaquetDArchiveBouton from './PaquetDArchiveBouton'

beforeEach(() => {
  faux.lectures = 0
  faux.liberer = null
  faux.refus = null
  faux.telechargements = 0
  faux.enregistrements = []
  faux.enregistrement = { ok: true }
  faux.piste = { etat: 'produite', contenu: '\uFEFFDate;Compte\r\n2025-02-03;606100' }
  faux.pistes = 0
  faux.pdf = { etat: 'rempli', octets: new Uint8Array([37, 80, 68, 70]), casesNonPlacees: [], avertissement: null }
  URL.createObjectURL = () => 'blob:paquet'
  URL.revokeObjectURL = () => {}
  HTMLAnchorElement.prototype.click = () => { faux.telechargements++ }
})

function monter(indisponible: string | null = null, sansEmpreinte = 0) {
  render(
    <PaquetDArchiveBouton
      dossierId="d1" dossierSiret="12345678900012" annee={2025} indisponible={indisponible} sansEmpreinte={sansEmpreinte}
      fec={() => ({ nom: '123456789FEC20251231.txt', contenu: 'JournalCode\r\nAC' })}
      pisteAudit={async () => { faux.pistes++; return faux.piste }}
    />,
  )
  return screen.getByRole('button', { name: /Paquet d’archive 2025/ })
}

describe('le bouton du paquet d’archive', () => {
  it('deux clics dans le même act ne lisent et ne fabriquent qu’un paquet', async () => {
    const bouton = monter()
    act(() => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
    })
    expect(faux.lectures).toBe(1)
    await act(async () => { faux.liberer!() })
    expect(await screen.findByText(/Paquet d’archive téléchargé : 5 fichier\(s\) vérifié\(s\)/)).toBeTruthy()
    expect(faux.telechargements).toBe(1)
    expect(faux.pistes).toBe(1)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('un refus de la lecture se dit, et rien ne se télécharge', async () => {
    faux.refus = 'les pièces du dossier sont lues en partie (3 ligne(s) lue(s) sur 4 annoncée(s)).'
    fireEvent.click(monter())
    await act(async () => { faux.liberer!() })
    expect((await screen.findByRole('alert')).textContent).toContain('Aucun paquet d’archive : les pièces du dossier sont lues en partie')
    expect(faux.telechargements).toBe(0)
  })

  it('dit avant le clic les pièces citées sans empreinte de dépôt, qui entreront « non vérifiée » (INAL3-Q1)', async () => {
    const bouton = monter(null, 3)
    expect(screen.getByText(/3 pièce\(s\) citée\(s\) par l’exercice 2025 n’ont pas d’empreinte de dépôt : elles entreront au paquet/)
      .textContent).toMatch(/marquées « non vérifiée »/)
    expect(faux.lectures).toBe(0)
    fireEvent.click(bouton)
    await act(async () => { faux.liberer!() })
    expect(await screen.findByText(/Paquet d’archive téléchargé/)).toBeTruthy()
    expect(faux.telechargements).toBe(1)
  })

  it('sans pièce sans empreinte, rien n’est dit avant le clic', () => {
    monter(null, 0)
    expect(screen.queryByText(/n’ont pas d’empreinte de dépôt/)).toBeNull()
  })

  it('une lecture partielle de l’onglet retient le bouton', () => {
    const bouton = monter('Brouillon lu incomplètement')
    expect((bouton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(bouton)
    expect(faux.lectures).toBe(0)
  })

  it('il ne vit que dans l’onglet Écritures, que seul l’espace du cabinet monte', () => {
    const fichiers: string[] = []
    const parcourir = (dossier: string) => {
      for (const nom of readdirSync(dossier)) {
        const chemin = join(dossier, nom)
        if (statSync(chemin).isDirectory()) parcourir(chemin)
        else if (/\.tsx?$/.test(nom) && !/\.test\.tsx?$/.test(nom)) fichiers.push(chemin.replaceAll('\\', '/'))
      }
    }
    parcourir('src')
    const importent = (module: RegExp) => fichiers.filter((f) => module.test(readFileSync(f, 'utf8'))).sort()
    expect(importent(/from '\.\/PaquetDArchiveBouton'/)).toEqual(['src/pages/dossier/EcrituresTab.tsx'])
    expect(importent(/from '[./]*(dossier\/)?EcrituresTab'/)).toEqual(['src/pages/DossierDetail.tsx'])
    // Aucun écran de l'espace client n'importe la lecture ni la fabrication ; l'onglet Écritures compte, avant le clic, les
    // pièces citées sans empreinte de dépôt (INAL3-Q1).
    expect(importent(/paquetDArchive(Lecture)?'/)).toEqual([
      'src/lib/paquetDArchive2035.ts', 'src/lib/paquetDArchiveLecture.ts', 'src/pages/dossier/EcrituresTab.tsx', 'src/pages/dossier/PaquetDArchiveBouton.tsx',
    ])
  })
  it('le téléchargement s’enregistre APRÈS la remise au navigateur, à l’empreinte de l’exercice ; un refus se dit (INAL5)', async () => {
    faux.enregistrement = { ok: false, message: 'refus fictif' }
    const bouton = monter()
    act(() => { fireEvent.click(bouton) })
    await act(async () => { faux.liberer!() })
    await vi.waitFor(() => expect(faux.enregistrements).toHaveLength(1))
    expect(faux.telechargements).toBe(1)
    expect(faux.enregistrements[0]).toMatchObject({ dossierId: 'd1', annee: 2025, empreinteExercice: 'e'.repeat(64), nonVerifiees: 0 })
    expect(String(faux.enregistrements[0].empreinteDuManifeste)).toMatch(/^[0-9a-f]{64}$/)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('la base ne l’a pas enregistré (refus fictif)'))
  })

  it('une piste d’audit refusée (lue en partie) : aucun paquet, rien ne se télécharge ni ne s’enregistre (INAL3c)', async () => {
    faux.piste = { etat: 'refusee', motif: 'Les mouvements bancaires n’ont pas pu être lus en entier (2 sur 3).' }
    fireEvent.click(monter())
    await act(async () => { faux.liberer!() })
    expect((await screen.findByRole('alert')).textContent)
      .toContain('Aucun paquet d’archive : la piste d’audit de l’exercice n’a pas pu se produire (Les mouvements bancaires')
    expect(faux.telechargements).toBe(0)
    expect(faux.enregistrements).toHaveLength(0)
  })

  it('un PDF de la 2035 impossible : le paquet part sans lui, et l’écran le dit après le téléchargement (INAL3c)', async () => {
    faux.pdf = { etat: 'impossible', motif: 'Formulaire 2035 introuvable (404)' }
    fireEvent.click(monter())
    await act(async () => { faux.liberer!() })
    expect(await screen.findByText(/Paquet d’archive téléchargé : 4 fichier\(s\)/)).toBeTruthy()
    expect(faux.telechargements).toBe(1)
    expect((await screen.findByRole('status')).textContent)
      .toContain('Attention : le PDF de la 2035 n’est pas dans le paquet (Formulaire 2035 introuvable (404))')
  })

})

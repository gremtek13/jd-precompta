import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EncartFactureElectronique from './EncartFactureElectronique'
import { CE_QUE_ETABLIT } from '../../lib/adressesReceptionVue'
import { motsDuCabinet } from '../../lib/espaceVentes'
import type { AttenteDeLEncart } from '../../lib/encartFactureElectronique'
import { ETAT_FICTIF, ETAT_NEUF, adresseFictive, etatFictif } from '../../test/etatFactureElectronique'

// L'ENCART « FACTURE ÉLECTRONIQUE » (espace client, étape A6b2) : la carte, au cabinet et chez le client. Ce que ces cas gardent :
//  1. RIEN AVANT LA LECTURE : ni « active », ni « à compléter », ni ligne, ni « aucune » ; une autre société repart de « chargement » ;
//  2. une valeur ILLISIBLE, un refus, une requête qui lève : dits, jamais un état ni une ligne ;
//  3. lue : « Active » ou « À compléter » et ce qui manque ; l'adresse, « À venir » et « Non vérifiée » dits comme tels, avec ce
//     que sa source établit ; les plateformes, reliées ou non ;
//  4. ce qui attend (chez le client seulement) : ses comptes, ou la phrase qui dit qu'ils ne se comptent pas, sans chiffre ;
//  5. chaque ligne MÈNE à son écran, par la navigation — jamais une fenêtre ouverte d'ici ;
//  6. les mots : rien du cabinet chez le client ; au cabinet, « le client » ;
//  7. la tuile du téléphone : le corps se replie par la requête de conteneur de la grille, jamais par une largeur lue en JavaScript.
// Le faux client ne sait que `rpc` : tout autre appel (une fonction, une table) lèverait. Données FICTIVES.

const faux = vi.hoisted(() => ({
  data: null as unknown,
  erreur: null as { message: string } | null,
  leve: null as string | null,
  retenir: false,
  appels: [] as { nom: string; args: unknown }[],
  enAttente: [] as (() => void)[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: async (nom: string, args: unknown) => {
      faux.appels.push({ nom, args })
      if (faux.retenir) await new Promise<void>((r) => { faux.enAttente.push(r) })
      if (faux.leve) throw new Error(faux.leve)
      return { data: faux.erreur ? null : faux.data, error: faux.erreur }
    },
  },
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-11-20T10:00:00Z'))
  faux.data = ETAT_FICTIF
  faux.erreur = null
  faux.leve = null
  faux.retenir = false
  faux.appels = []
  faux.enAttente = []
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// Les sources se lisent depuis la racine du dépôt : sous jsdom, `import.meta.url` n'est pas un fichier.
const RACINE = join(process.cwd(), 'src')
const SOURCE_DE_LA_CARTE = join(RACINE, 'pages/dossier/EncartFactureElectronique.tsx')

const COMPTEE: AttenteDeLEncart = { etat: 'comptee', aDeclarer: 2, enRetard: 1, refusees: 1 }

function monterClient(attente: AttenteDeLEncart = COMPTEE, dossierId = 'd1') {
  const vue = (id: string, a: AttenteDeLEncart) => (
    <MemoryRouter initialEntries={['/accueil']}>
      <Routes>
        <Route path="/accueil" element={<div className="bento"><EncartFactureElectronique espace="client" dossierId={id} attente={a} /></div>} />
        <Route path="/mes-ventes" element={<p>Écran des ventes</p>} />
      </Routes>
    </MemoryRouter>
  )
  const rendu = render(vue(dossierId, attente))
  return { ...rendu, vers: (id: string, a: AttenteDeLEncart = attente) => rendu.rerender(vue(id, a)) }
}

function monterCabinet(onNavigate: (onglet: string) => void = () => {}, dossierId = 'd1') {
  return render(
    <MemoryRouter>
      <div className="bento"><EncartFactureElectronique espace="cabinet" dossierId={dossierId} onNavigate={onNavigate} /></div>
    </MemoryRouter>,
  )
}

const texte = () => (document.body.textContent ?? '').replace(/\s+/g, ' ')
const sousTitre = () => document.querySelector('.widget-sous-titre')?.textContent
const lignes = () => [...document.querySelectorAll('.encart-fe-ligne')]
const titresDeLignes = () => lignes().map((l) => l.querySelector('.encart-fe-titre')?.textContent)
const lire = async () => { await act(async () => {}); await act(async () => {}) }

// ── 1. Rien avant la lecture ─────────────────────────────────────────────────────────────────────────────────────────
describe('rien avant la lecture', () => {
  it.each(['client', 'cabinet'] as const)('%s : le titre et « Chargement… », ni état, ni ligne, ni « aucune »', async (espace) => {
    faux.retenir = true
    if (espace === 'client') monterClient()
    else monterCabinet()
    await act(async () => {})
    expect(screen.getByRole('heading', { name: 'Facture électronique' })).toBeTruthy()
    expect(sousTitre()).toBe('Chargement…')
    expect(lignes()).toHaveLength(0)
    expect(texte()).not.toMatch(/active|compléter|aucun|aucune|rien|reliée|relié/i)
    // La fonction est appelée, une fois, pour ce dossier : l'état se LIT en base.
    expect(faux.appels).toEqual([{ nom: 'etat_facture_electronique', args: { p_dossier_id: 'd1' } }])
  })

  it('une autre société repart de « Chargement… » : jamais l’état de la précédente', async () => {
    const { vers } = monterClient()
    await lire()
    expect(sousTitre()).toBe('Active')
    faux.retenir = true
    faux.data = ETAT_NEUF
    vers('d2')
    await act(async () => {})
    expect(sousTitre()).toBe('Chargement…')
    expect(lignes()).toHaveLength(0)
    expect(faux.appels.map((a) => a.args)).toEqual([{ p_dossier_id: 'd1' }, { p_dossier_id: 'd2' }])
    faux.retenir = false
    await act(async () => { for (const rendre of faux.enAttente.splice(0)) rendre() })
    await lire()
    expect(sousTitre()).toBe('À compléter : 2 points')
  })
})

// ── 2. Une lecture ratée ─────────────────────────────────────────────────────────────────────────────────────────────
describe('une valeur illisible, un refus, une requête qui lève', () => {
  const sansEtat = () => {
    expect(sousTitre()).toBe('Lecture impossible')
    expect(lignes()).toHaveLength(0)
    expect(texte()).not.toMatch(/Active|À compléter|Reçoit depuis|Plateforme agréée|Super PDP|Aucune adresse/)
  }

  it.each(['client', 'cabinet'] as const)('%s : une valeur d’une autre forme n’est jamais « active » ni « à compléter »', async (espace) => {
    faux.data = { ...ETAT_FICTIF, portee: 'x' }
    if (espace === 'client') monterClient()
    else monterCabinet()
    await lire()
    sansEtat()
    expect(texte()).toContain('n’a pas pu être lu : la base a répondu sous une forme que l’écran ne sait pas lire')
  })

  it('une valeur vide (null) est illisible aussi, pas un dossier neuf', async () => {
    faux.data = null
    monterClient()
    await lire()
    sansEtat()
  })

  it('le refus de la base : son motif, aux mots du client', async () => {
    faux.erreur = { message: 'permission denied' }
    monterClient()
    await lire()
    sansEtat()
    expect(texte()).toContain('L’état de ta facture électronique n’a pas pu être lu (permission denied).')
  })

  it('une requête qui lève : dite, au cabinet avec « le client »', async () => {
    faux.leve = 'réseau coupé'
    monterCabinet()
    await lire()
    sansEtat()
    expect(texte()).toContain('L’état de la facture électronique du client n’a pas pu être lu (réseau coupé).')
  })
})

// ── 3. Lue ───────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('lue : l’état, ce qui manque, l’adresse et les plateformes', () => {
  it('active : « Active », l’adresse, les plateformes — et rien ne manque', async () => {
    monterClient()
    await lire()
    expect(sousTitre()).toBe('Active')
    expect(titresDeLignes()).toEqual(['Adresse de réception', 'Plateformes', 'Ce qui t’attend'])
    expect(texte()).toContain('123456782 (SIREN), chez Plateforme fictive Bêta. Reçoit depuis le 01/09/2026.')
    expect(texte()).toContain('Plateforme agréée : reliée (Plateforme fictive Alpha).')
    expect(texte()).toContain('Super PDP : non relié.')
    expect(texte()).not.toContain('Ce qui manque')
  })

  it('un dossier neuf : « À compléter : 2 points », ce qui manque nommé, aucune adresse, rien de relié', async () => {
    faux.data = ETAT_NEUF
    monterClient()
    await lire()
    expect(sousTitre()).toBe('À compléter : 2 points')
    expect(titresDeLignes()).toEqual(['Ce qui manque', 'Adresse de réception', 'Plateformes', 'Ce qui t’attend'])
    expect(texte()).toContain('Aucune plateforme de réception reliée (plateforme agréée ou Super PDP).')
    expect(texte()).toContain('Aucune adresse de réception déclarée.')
    expect(texte()).toContain('Tu n’as pas encore déclaré d’adresse de réception.')
    expect(texte()).toContain('Plateforme agréée : non reliée.')
  })

  it('une adresse À VENIR se dit « À venir », et la carte est « à compléter » (A6-Q2)', async () => {
    faux.data = etatFictif({ adresse: adresseFictive({ prise_effet: '2027-12-01' }) })
    monterClient()
    await lire()
    expect(sousTitre()).toBe('À compléter : 1 point')
    expect(texte()).toContain('À venir : à partir du 01/12/2027.')
    expect(texte()).not.toContain('Reçoit depuis')
    expect(texte()).toContain('L’adresse de réception déclarée ne prend effet que le 01/12/2027.')
  })

  it('une adresse non vérifiée compte pour « active », et la carte DIT qu’elle ne l’est pas (A6-Q3)', async () => {
    monterClient()
    await lire()
    expect(sousTitre()).toBe('Active')
    expect(texte()).toContain('Non vérifiée : simple déclaration.')
    expect(texte()).toContain(CE_QUE_ETABLIT.declaration)
  })

  it.each([
    ['portail_annuaire', 'Vérifiée sur le portail de l’annuaire le 10/11/2027.'],
    ['plateforme', 'Vérifiée sur la plateforme le 10/11/2027.'],
  ] as const)('une adresse vérifiée (%s) dit sa source, son jour et ce que sa source établit (A6-Q4)', async (verification, phrase) => {
    faux.data = etatFictif({ adresse: adresseFictive({ verification, verifiee_le: '2027-11-10' }) })
    monterClient()
    await lire()
    expect(texte()).toContain(phrase)
    expect(texte()).not.toContain('Non vérifiée')
    expect(texte()).toContain(CE_QUE_ETABLIT[verification])
  })

  it('Super PDP seul est relié : active, et le nom de la plateforme agréée ne se dit pas', async () => {
    faux.data = etatFictif({ plateforme: ETAT_NEUF.plateforme, superpdp: { relie: true, depuis: '2026-09-05T14:00:00+02:00' } })
    monterClient()
    await lire()
    expect(sousTitre()).toBe('Active')
    expect(texte()).toContain('Plateforme agréée : non reliée.')
    expect(texte()).toContain('Super PDP : relié.')
  })
})

// ── 4. Ce qui attend (chez le client) ────────────────────────────────────────────────────────────────────────────────
describe('ce qui attend, chez le client seulement', () => {
  it('les comptes des listes lues en entier', async () => {
    monterClient(COMPTEE)
    await lire()
    expect(texte()).toContain('2 factures dont l’encaissement est à déclarer, dont 1 en retard.')
    expect(texte()).toContain('1 facture refusée ou rejetée sur ta plateforme.')
  })

  it('une lecture partielle des ventes : aucun compte, et la phrase qui le dit', async () => {
    monterClient({ etat: 'muette', motif: 'les factures lues en partie' })
    await lire()
    const attente = lignes().find((l) => l.querySelector('.encart-fe-titre')?.textContent === 'Ce qui t’attend')
    expect(attente?.textContent).toBe('Ce qui t’attend' + 'Ce qui t’attend ne se compte pas ici : tes ventes n’ont pas pu être toutes lues.')
    expect(attente?.textContent).not.toMatch(/\d/)
    // L'état, lui, se dit : sa lecture est la sienne.
    expect(sousTitre()).toBe('Active')
  })

  it('les ventes pas encore revenues : « Chargement… », aucun compte', async () => {
    monterClient({ etat: 'en_cours' })
    await lire()
    const attente = lignes().find((l) => l.querySelector('.encart-fe-titre')?.textContent === 'Ce qui t’attend')
    expect(attente?.querySelector('.encart-fe-texte')?.textContent).toBe('Chargement…')
  })

  it('le cabinet ne dit pas « ce qui attend » : l’onglet Factures le dit par ses pastilles', async () => {
    monterCabinet()
    await lire()
    expect(titresDeLignes()).toEqual(['Adresse de réception', 'Plateformes'])
    expect(texte()).not.toMatch(/attend|à déclarer|refusée/)
  })
})

// ── 5. Chaque ligne mène à son écran ─────────────────────────────────────────────────────────────────────────────────
describe('chaque ligne mène à son écran, par la navigation', () => {
  it('chez le client : chaque ligne et le bouton de la carte sont des liens vers « Mes ventes »', async () => {
    monterClient()
    await lire()
    const liens = [...document.querySelectorAll('a')]
    expect(liens.length).toBe(lignes().length + 1)
    for (const lien of liens) expect(lien.getAttribute('href')).toBe('/mes-ventes')
    expect(screen.getByRole('link', { name: 'Mes ventes' }).className).toContain('encart-fe-va')
    fireEvent.click(lignes()[0])
    await screen.findByText('Écran des ventes')
  })

  it('au cabinet : chaque ligne et le bouton de la carte mènent à l’onglet Justificatifs', async () => {
    const onglets: string[] = []
    monterCabinet((o) => onglets.push(o))
    await lire()
    for (const ligne of lignes()) fireEvent.click(ligne)
    fireEvent.click(screen.getByRole('button', { name: 'Justificatifs' }))
    expect(onglets).toEqual(['pieces', 'pieces', 'pieces'])
    expect(document.querySelectorAll('a')).toHaveLength(0)
  })

  it('aucune fenêtre ne s’ouvre d’ici : ni dialogue, ni fenêtre dans la source de la carte', async () => {
    // Au cabinet, chaque ligne est un bouton : cliquées toutes, aucune fenêtre n'apparaît (chez le client, une ligne est un lien
    // qui change d'écran : le cas de « Mes ventes », plus haut).
    monterCabinet()
    await lire()
    for (const ligne of lignes()) fireEvent.click(ligne)
    expect(document.querySelector('[role="dialog"], .modal-overlay, .modal')).toBeNull()
    const source = readFileSync(SOURCE_DE_LA_CARTE, 'utf8')
      .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')
    expect(source).not.toMatch(/Modal|createPortal|position:\s*fixed|window\.open|useState/)
  })

  it('l’état se lit en base et rien ne part ailleurs : une fonction de la base, rien d’autre', async () => {
    monterClient()
    await lire()
    expect(faux.appels.map((a) => a.nom)).toEqual(['etat_facture_electronique'])
  })
})

// ── 6. Les mots ──────────────────────────────────────────────────────────────────────────────────────────────────────
describe('les mots de chaque espace', () => {
  const ETATS: [string, unknown, AttenteDeLEncart][] = [
    ['active', ETAT_FICTIF, COMPTEE],
    ['neuf', ETAT_NEUF, COMPTEE],
    ['adresse à venir', etatFictif({ adresse: adresseFictive({ prise_effet: '2027-12-01' }) }), COMPTEE],
    ['adresse vérifiée', etatFictif({ adresse: adresseFictive({ verification: 'plateforme', verifiee_le: '2027-11-10' }) }), COMPTEE],
    ['ventes lues en partie', ETAT_FICTIF, { etat: 'muette', motif: 'les factures lues en partie' }],
    ['valeur illisible', { plateforme: 1 }, COMPTEE],
  ]

  it.each(ETATS)('chez le client, %s : rien du cabinet', async (_nom, data, attente) => {
    faux.data = data
    monterClient(attente)
    await lire()
    expect(motsDuCabinet(texte())).toEqual([])
  })

  it('le tutoiement : chez le client, « ta », « tu », « ton » ; jamais « le client » pour le titulaire', async () => {
    faux.data = ETAT_NEUF
    monterClient()
    await lire()
    expect(texte()).toMatch(/\bt[’']attend\b|\btu\b|\bta\b/)
    expect(texte()).not.toMatch(/le client|du client/i)
  })

  it('au cabinet : « le client », jamais le tutoiement', async () => {
    faux.data = etatFictif({ adresse: null })
    monterCabinet()
    await lire()
    expect(texte()).toContain('Aucune adresse de réception déclarée pour le client.')
    expect(texte()).not.toMatch(/(?<![\p{L}])(tu|ta|ton|tes|t[’']attend)(?![\p{L}])/iu)
  })

  // LE DÉFAUT PLANTÉ : le garde n'est pas aveugle — le même texte, tel que le cabinet le dirait au client, y tombe.
  it('le garde des mots voit un texte du cabinet', () => {
    expect(motsDuCabinet('Ouvrez l’onglet Justificatifs : la plateforme du client y est reliée.').length).toBeGreaterThan(0)
  })
})

// ── 7. La tuile du téléphone ─────────────────────────────────────────────────────────────────────────────────────────
describe('la tuile du téléphone, par la grille et non par la fenêtre', () => {
  const css = readFileSync(join(RACINE, 'index.css'), 'utf8')

  it('chez le client, la carte porte `encart-fe-client` et son lien `encart-fe-va` ; au cabinet, pas de tuile', async () => {
    monterClient()
    await lire()
    const carte = document.querySelector('section.widget')
    expect(carte?.className).toContain('encart-fe-client')
    expect(carte?.querySelector('.widget-entete .encart-fe-va')).not.toBeNull()
    expect(carte?.querySelector('.widget-corps')?.childElementCount).toBeGreaterThan(0)
    cleanup()
    monterCabinet()
    await lire()
    expect(document.querySelector('section.widget')?.className).not.toContain('encart-fe-client')
  })

  it('la feuille de style replie le corps par une requête de conteneur sur la grille, et le lien couvre la tuile', () => {
    const bloc = /@container bento \(max-width: 760px\) \{([\s\S]*?)\n\}/.exec(css.slice(css.indexOf('.encart-fe-corps')))?.[1] ?? ''
    expect(bloc).toContain('.encart-fe-client .widget-corps { display: none; }')
    expect(bloc).toMatch(/\.encart-fe-client \.encart-fe-va::after \{[^}]*position: absolute; inset: 0/)
    expect(bloc).toContain('.encart-fe-client { position: relative; }')
  })

  it('la source ne lit aucune largeur de fenêtre', () => {
    const source = readFileSync(SOURCE_DE_LA_CARTE, 'utf8')
    expect(source).not.toMatch(/innerWidth|matchMedia|ResizeObserver|clientWidth/)
  })
})

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DossiersList from './DossiersList'
import { LIBELLE_ALLER_AUX_FACTURES, avisDuChangement } from '../lib/changementDeRib'
import { AUCUN_RIB_A_CONFIRMER, LECTURE_MANQUEE_DE_LA_LISTE, MENTION_DOSSIER_ARCHIVE, phraseDuCompte, lireLesDossiersAuRibAConfirmer } from '../lib/dossiersAuRibAConfirmer'
import { CONSEIL_VERIFICATION_RIB } from '../lib/parametresFacturationVue'
import { elementRendu, idDuDossierFictif, listeRendue } from '../test/dossiersAuRibAConfirmer'

// LE TABLEAU DE BORD DU CABINET ET LES RIB PROPOSÉS QUI ATTENDENT SA CONFIRMATION (espace client, étape A5b3d) : ce que la page fait de la
// base. Elle lit `dossiers_au_rib_a_confirmer` au montage, UNE fois par compte connecté, à part de ses autres lectures, et dit : rien
// avant la réponse, rien sur une liste vide lue en entier, la liste (compte, une ligne par dossier dans l'ordre rendu, la marque d'un
// archivé, le lien vers les factures de SON dossier, le conseil une fois) sinon, une ligne discrète sur une lecture manquée. Sa panne ne
// tait que cette liste, et la panne des autres lectures de la page ne la tait pas. Drapeau baissé, ou sans session : AUCUN appel. Ce que
// le composant dit état par état : components/RibsAConfirmer.test.tsx ; les mots : lib/dossiersAuRibAConfirmer.test.ts.

const faux = vi.hoisted(() => ({
  drapeau: true,
  compte: 'u-chef' as string | null,
  rpcs: [] as string[],
  // Par compte : la réponse de la fonction ; et une porte qui la retient tant qu'on ne l'ouvre pas.
  reponses: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  portes: {} as Record<string, Promise<void>>,
  // Les tables que le tableau de bord lit et qui, ici, REFUSENT (la panne des autres lectures).
  tablesEnPanne: new Set<string>(),
  dossiers: [] as unknown[],
  // Retient la lecture des dossiers : la page reste en chargement (squelettes) tant qu'on ne l'ouvre pas.
  porteDossiers: null as Promise<void> | null,
}))

vi.mock('../lib/dossiersAuRibAConfirmer', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/dossiersAuRibAConfirmer')>(),
  get DOSSIERS_AU_RIB_A_CONFIRMER_EXPORTE() { return faux.drapeau },
}))
vi.mock('../lib/listeDossiers', () => ({ signalerMajDossiers: () => {} }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ session: faux.compte === null ? null : { user: { id: faux.compte } } }),
}))
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string) => {
      faux.rpcs.push(nom)
      const compte = faux.compte ?? ''
      const reponse = async () => {
        await faux.portes[compte]
        const r = faux.reponses[compte] ?? { data: { dossiers: [] }, error: null }
        return { ...r, count: null, status: r.error ? 400 : 200, statusText: '' }
      }
      return { then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => reponse().then(suite, echec) }
    },
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      Object.assign(chaine, {
        select: () => chaine, eq: () => chaine, gte: () => chaine, order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        then: (suite: (r: unknown) => unknown) => {
          if (faux.tablesEnPanne.has(table)) return Promise.resolve({ data: null, error: { message: 'permission denied' }, count: null }).then(suite)
          const toutes = table === 'dossiers' ? faux.dossiers : []
          const repondre = () => ({ data: toutes.slice(debut, fin + 1), error: null, count: toutes.length })
          return (table === 'dossiers' && faux.porteDossiers ? faux.porteDossiers.then(repondre) : Promise.resolve(repondre())).then(suite)
        },
      })
      return chaine
    },
  },
}))

const ANNEE = new Date().getFullYear()
function dossier(id: string, nom: string) {
  return {
    id, nom, cabinet_id: 'cabinet-de-test', siret: null, contact_nom: null, contact_email: null,
    notes: null, archive: false, created_at: `${ANNEE}-01-02T00:00:00Z`, code_email: id,
    assujetti_tva: false, statut_tva: null, article_exoneration: null, code_naf: null, libelle_naf: null, adresse: null,
  }
}

function retenir(compte: string): () => void {
  let ouvrir = () => {}
  faux.portes[compte] = new Promise<void>((resolve) => { ouvrir = resolve })
  return ouvrir
}

const appels = () => faux.rpcs.filter((n) => n === 'dossiers_au_rib_a_confirmer')
const texte = () => (document.body.textContent ?? '').replace(/[ \t\r\n]+/g, ' ')
const region = (nom: string | RegExp) => screen.queryByRole('region', { name: nom })

// La liste de la base : le plus ancien d'abord (l'ordre de la fonction), un dossier archivé parmi eux.
const ELEMENTS = [
  elementRendu(2, { nom: 'Zèbre Santé', changement: { jour: '2026-09-01', geste: 'pose', auteur: 'client' } }),
  elementRendu(1, { nom: 'Alpha Soins', archive: true, changement: { jour: '2026-10-12', geste: 'change', auteur: 'client', ribEnVigueur: 'inchange' } }),
]
const LISTE = lireLesDossiersAuRibAConfirmer(listeRendue(...ELEMENTS))
// La section de LA liste (son titre est le compte) : la ligne discrète a un autre nom.
const montree = () => region(phraseDuCompte(LISTE!))

beforeEach(() => {
  faux.drapeau = true
  faux.compte = 'u-chef'
  faux.rpcs = []
  faux.reponses = {}
  faux.portes = {}
  faux.tablesEnPanne = new Set()
  faux.porteDossiers = null
  faux.dossiers = [dossier('alpha', 'Alpha Santé'), dossier('bravo', 'Bravo Cabinet')]
})

async function monter() {
  let rendu!: ReturnType<typeof render>
  await act(async () => { rendu = render(<MemoryRouter><DossiersList /></MemoryRouter>) })
  return rendu
}

describe('DossiersList — les RIB proposés qui attendent le cabinet', () => {
  it('lit la fonction au montage, UNE fois ; rien avant la réponse, la liste après', async () => {
    expect(LISTE).not.toBeNull()
    faux.reponses['u-chef'] = { data: listeRendue(...ELEMENTS), error: null }
    const ouvrir = retenir('u-chef')
    await monter()
    expect(appels()).toEqual(['dossiers_au_rib_a_confirmer'])
    // Avant le retour : rien d'affirmé — ni liste, ni « aucun », ni ligne discrète — et le tableau de bord est là.
    expect(montree()).toBeNull()
    expect(texte()).not.toContain(AUCUN_RIB_A_CONFIRMER)
    expect(texte()).not.toContain(LECTURE_MANQUEE_DE_LA_LISTE)
    expect(screen.getByText('Tableau de bord')).toBeTruthy()
    expect(screen.getByText('Dossiers suivis')).toBeTruthy()

    await act(async () => { ouvrir() })
    expect(montree()).not.toBeNull()
    expect(appels()).toHaveLength(1)
  })

  it('la liste : le titre au compte, les lignes dans l’ordre rendu, la marque d’un archivé, chaque lien vers SES factures, le conseil une fois', async () => {
    faux.reponses['u-chef'] = { data: listeRendue(...ELEMENTS), error: null }
    await monter()
    const section = region(phraseDuCompte(LISTE!))!
    expect(section).not.toBeNull()
    const lignes = within(section).getAllByRole('listitem')
    // L'ordre de la fonction (le plus ancien d'abord), pas l'ordre alphabétique ni celui des lignes du tableau des dossiers.
    expect(lignes.map((l) => l.querySelector('.ribs-a-confirmer-nom')?.textContent)).toEqual(['Zèbre Santé', 'Alpha Soins'])
    LISTE!.dossiers.forEach((d, i) => {
      expect(lignes[i].querySelector('.ribs-a-confirmer-avis')?.textContent).toBe(avisDuChangement(d.changement, 'cabinet').phrase)
    })
    expect(within(lignes[0]).queryByText(MENTION_DOSSIER_ARCHIVE)).toBeNull()
    expect(within(lignes[1]).getByText(MENTION_DOSSIER_ARCHIVE)).toBeTruthy()
    const liens = within(section).getAllByRole('link', { name: LIBELLE_ALLER_AUX_FACTURES })
    expect(liens.map((a) => a.getAttribute('href'))).toEqual([
      `/dossiers/${idDuDossierFictif(2)}/factures`, `/dossiers/${idDuDossierFictif(1)}/factures`,
    ])
    expect(screen.getAllByText(CONSEIL_VERIFICATION_RIB)).toHaveLength(1)
    // Elle est EN TÊTE : avant la grille des tuiles chiffrées.
    expect(section.compareDocumentPosition(screen.getByText('Dossiers suivis')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('la liste vide, lue en entier : rien — ni « aucun », ni ligne', async () => {
    faux.reponses['u-chef'] = { data: listeRendue(), error: null }
    await monter()
    expect(appels()).toHaveLength(1)
    expect(montree()).toBeNull()
    expect(region(LECTURE_MANQUEE_DE_LA_LISTE)).toBeNull()
    expect(texte()).not.toContain(AUCUN_RIB_A_CONFIRMER)
    expect(screen.getByText('Dossiers suivis')).toBeTruthy()
  })

  it('illisible : la ligne discrète, jamais « aucun » ; le tableau de bord reste entier', async () => {
    faux.reponses['u-chef'] = { data: { dossiers: 'pas une liste' }, error: null }
    await monter()
    expect(region(LECTURE_MANQUEE_DE_LA_LISTE)).not.toBeNull()
    expect(screen.getByText(LECTURE_MANQUEE_DE_LA_LISTE).getAttribute('title')).toBeNull()
    expect(texte()).not.toContain(AUCUN_RIB_A_CONFIRMER)
    expect(screen.getByText('Dossiers suivis')).toBeTruthy()
    expect(screen.getByText('Tous les dossiers')).toBeTruthy()
  })

  it('refusée : la ligne discrète, le motif en infobulle', async () => {
    faux.reponses['u-chef'] = { data: null, error: { message: 'Seul le cabinet lit les RIB à confirmer.' } }
    await monter()
    expect(screen.getByText(LECTURE_MANQUEE_DE_LA_LISTE).getAttribute('title')).toBe('Seul le cabinet lit les RIB à confirmer.')
    expect(screen.getByText('Dossiers suivis')).toBeTruthy()
  })

  it('drapeau baissé : AUCUN appel de la fonction, rien de dit', async () => {
    faux.drapeau = false
    faux.reponses['u-chef'] = { data: listeRendue(...ELEMENTS), error: null }
    await monter()
    expect(appels()).toHaveLength(0)
    expect(montree()).toBeNull()
    expect(texte()).not.toContain(LECTURE_MANQUEE_DE_LA_LISTE)
    expect(screen.getByText('Dossiers suivis')).toBeTruthy()
  })

  it('sans session : AUCUN appel de la fonction, rien de dit', async () => {
    faux.compte = null
    await monter()
    expect(appels()).toHaveLength(0)
    expect(montree()).toBeNull()
    expect(texte()).not.toContain(LECTURE_MANQUEE_DE_LA_LISTE)
  })

  it('un autre compte repart de « en cours » : la liste du premier ne reste pas', async () => {
    faux.reponses['u-chef'] = { data: listeRendue(...ELEMENTS), error: null }
    faux.reponses['u-membre'] = { data: listeRendue(elementRendu(3, { nom: 'Dossier du membre' })), error: null }
    const rendu = await monter()
    expect(montree()).not.toBeNull()
    expect(texte()).toContain('Zèbre Santé')

    const ouvrirMembre = retenir('u-membre')
    faux.compte = 'u-membre'
    await act(async () => { rendu.rerender(<MemoryRouter><DossiersList /></MemoryRouter>) })
    expect(appels()).toHaveLength(2)
    // Le second compte n'a pas encore sa réponse : rien du premier ne se dit pour lui.
    expect(montree()).toBeNull()
    expect(texte()).not.toContain('Zèbre Santé')

    await act(async () => { ouvrirMembre() })
    expect(texte()).toContain('Dossier du membre')
    expect(texte()).not.toContain('Zèbre Santé')
    expect(appels()).toHaveLength(2)
  })

  it('la réponse TARDIVE d’un compte quitté ne s’inscrit pas : le compte affiché garde sa liste', async () => {
    faux.reponses['u-chef'] = { data: listeRendue(...ELEMENTS), error: null }
    faux.reponses['u-membre'] = { data: listeRendue(elementRendu(3, { nom: 'Dossier du membre' })), error: null }
    // La lecture du premier compte est retenue ; on change de compte, dont la réponse revient aussitôt ; puis la première arrive.
    const ouvrirChef = retenir('u-chef')
    const rendu = await monter()
    faux.compte = 'u-membre'
    await act(async () => { rendu.rerender(<MemoryRouter><DossiersList /></MemoryRouter>) })
    expect(texte()).toContain('Dossier du membre')

    await act(async () => { ouvrirChef() })
    expect(texte()).toContain('Dossier du membre')
    expect(texte()).not.toContain('Zèbre Santé')
  })

  it('le tableau de bord ne l’attend pas : la liste paraît pendant que ses autres lectures sont encore en cours', async () => {
    faux.reponses['u-chef'] = { data: listeRendue(...ELEMENTS), error: null }
    let libererDossiers = () => {}
    faux.porteDossiers = new Promise<void>((resolve) => { libererDossiers = resolve })
    await monter()
    // Les dossiers n'ont pas répondu : la page est en chargement (squelettes), et la liste est déjà là.
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByText('Dossiers suivis')).toBeNull()
    expect(montree()).not.toBeNull()
    await act(async () => { libererDossiers() })
    expect(screen.getByText('Dossiers suivis')).toBeTruthy()
    expect(montree()).not.toBeNull()
  })

  it('la panne des autres lectures du tableau de bord ne la tait pas', async () => {
    faux.reponses['u-chef'] = { data: listeRendue(...ELEMENTS), error: null }
    // La liste des dossiers elle-même refusée : l'écran dit « Données indisponibles », la liste des RIB reste.
    faux.tablesEnPanne = new Set(['dossiers'])
    await monter()
    expect(texte()).toContain('Données indisponibles')
    expect(montree()).not.toBeNull()
    expect(screen.getAllByRole('link', { name: LIBELLE_ALLER_AUX_FACTURES })).toHaveLength(2)
  })

  it('la panne des indicateurs (pièces, relevés) ne la tait pas non plus', async () => {
    faux.reponses['u-chef'] = { data: listeRendue(...ELEMENTS), error: null }
    faux.tablesEnPanne = new Set(['pieces', 'lignes_bancaires'])
    await monter()
    expect(texte()).toContain('Certains indicateurs')
    expect(montree()).not.toBeNull()
  })

  it('et réciproquement : sa panne ne tait pas les autres lectures', async () => {
    faux.reponses['u-chef'] = { data: null, error: { message: 'permission denied' } }
    await monter()
    expect(region(LECTURE_MANQUEE_DE_LA_LISTE)).not.toBeNull()
    expect(screen.getByText('Dossiers suivis')).toBeTruthy()
    expect(screen.getAllByText(/Alpha Santé/).length).toBeGreaterThan(0)
    expect(texte()).not.toContain('Données indisponibles')
  })

  it('la recherche du tableau de bord ne la filtre pas', async () => {
    faux.reponses['u-chef'] = { data: listeRendue(...ELEMENTS), error: null }
    await monter()
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/Rechercher un dossier/), { target: { value: 'zzz' } })
    })
    expect(screen.getByText('Aucun dossier ne correspond.')).toBeTruthy()
    expect(montree()).not.toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})

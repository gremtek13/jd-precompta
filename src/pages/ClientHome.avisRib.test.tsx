import { act, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientHome from './ClientHome'
import {
  CONSEIL_AU_CLIENT_BANQUE, CONSEIL_AU_CLIENT_VENTES, LECTURE_MANQUEE_AU_CLIENT, LIBELLE_OUVRIR_MES_VENTES, NOM_DE_L_AVIS_DU_CLIENT,
  avisDuChangement,
} from '../lib/changementDeRib'
import { motsDuCabinet } from '../lib/espaceVentes'
import { changementFictif, toutesLesCombinaisons, valeurRendue } from '../test/changementDeRib'

// L'ACCUEIL DU CLIENT ET L'AVIS DU DERNIER CHANGEMENT DU RIB (espace client, étape A5b3b) : ce que la page fait de la base. Pour la case
// que la société AFFICHÉE lui ouvre — « Ventes » (seule ou avec « Banque ») ou « Banque » seul —, elle lit `dernier_changement_de_rib`
// au montage, UNE fois, pour cette société, et dit : rien avant la réponse, rien sur « le RIB n'a jamais changé » ni sur un changement
// de plus de trente jours, UN AVIS sinon (la phrase, ce que les factures porteront, le conseil — les mots du module, jamais réécrits),
// une ligne discrète sur une lecture manquée. Sans l'une ni l'autre case : AUCUN appel (la base refuserait). Le lien vers « Mes
// ventes » n'existe que pour « Ventes ». Ce que dit l'avis : changementDeRib.test.ts et changementDeRibAvis.test.ts.

const faux = vi.hoisted(() => ({
  drapeau: true,
  dossier: 'dossier-a',
  droits: {} as Record<string, { ventes: boolean; banque: boolean }>,
  rpcs: [] as { nom: string; args: unknown }[],
  // Par société : la réponse de la fonction, et une porte qui la retient tant qu'on ne l'ouvre pas.
  changements: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  portes: {} as Record<string, Promise<void>>,
}))

vi.mock('../lib/changementDeRib', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/changementDeRib')>(),
  get CHANGEMENT_DE_RIB_EXPORTE() { return faux.drapeau },
}))

vi.mock('../lib/depot', () => ({ deposerFichier: vi.fn() }))
// Les tuiles « À encaisser » et l'encart « Facture électronique » ont leurs tests (TuilesVentesClient.test.tsx) : ici, l'avis seul.
vi.mock('./AccueilVentesClient', () => ({ default: () => null }))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => {
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        order: () => chaine,
        range: () => chaine,
        maybeSingle: () => Promise.resolve({ data: { id: 'x', nom: 'Dossier fictif' }, error: null }),
        then: (suite: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(suite),
      })
      return chaine
    },
    rpc: (nom: string, args: { p_dossier_id: string }) => {
      faux.rpcs.push({ nom, args })
      const reponse = async () => {
        if (nom === 'couverture_du_releve' || nom === 'pieces_jointes_ecartees_du_client') {
          return { data: [], error: null, count: null, status: 200, statusText: '' }
        }
        if (nom !== 'dernier_changement_de_rib') return { data: null, error: { message: `fonction inattendue : ${nom}` }, count: null, status: 404, statusText: '' }
        await faux.portes[args.p_dossier_id]
        const r = faux.changements[args.p_dossier_id] ?? { data: { changement: null }, error: null }
        return { ...r, count: null, status: r.error ? 400 : 200, statusText: '' }
      }
      return { then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => reponse().then(suite, echec) }
    },
  },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: faux.dossier, prenom: null, mesSocietes: [], droitsParDossier: faux.droits }),
}))

function retenir(dossier: string): () => void {
  let ouvrir = () => {}
  faux.portes[dossier] = new Promise<void>((resolve) => { ouvrir = resolve })
  return ouvrir
}

const texte = () => (document.body.textContent ?? '').replace(/[ \t\r\n]+/g, ' ')
const appels = () => faux.rpcs.filter((r) => r.nom === 'dernier_changement_de_rib')
const avis = () => screen.queryByRole('region', { name: NOM_DE_L_AVIS_DU_CLIENT })
const VENTES = { ventes: true, banque: false }
const BANQUE = { ventes: false, banque: true }
const LES_DEUX = { ventes: true, banque: true }
const AUCUNE = { ventes: false, banque: false }

// « Aujourd'hui » à Paris : le 17 octobre 2026. Un changement du 12 est à J + 5.
const PROPOSE = changementFictif({ jour: '2026-10-12', geste: 'pose', auteur: 'client', etat: 'propose', ribEnVigueur: 'aucun' })
const CONFIRME = changementFictif({ jour: '2026-10-12', geste: 'confirme', auteur: 'cabinet', etat: 'confirme', ribEnVigueur: 'pose' })

beforeEach(() => {
  faux.drapeau = true
  faux.dossier = 'dossier-a'
  faux.droits = { 'dossier-a': { ...VENTES }, 'dossier-b': { ...VENTES } }
  faux.rpcs = []
  faux.changements = {}
  faux.portes = {}
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-17T10:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

async function monter() {
  const rendu = render(<MemoryRouter><ClientHome /></MemoryRouter>)
  // L'accueil lu : les chiffres ont remplacé les squelettes.
  await screen.findByText('Ce qu\'il reste à envoyer')
  return rendu
}

describe('ClientHome — l’avis du dernier changement du RIB, « Ventes »', () => {
  it('lit la fonction au montage, UNE fois, pour la société affichée ; rien avant la réponse, l’avis après', async () => {
    faux.changements['dossier-a'] = { data: valeurRendue(PROPOSE), error: null }
    const ouvrir = retenir('dossier-a')
    await monter()
    expect(appels()).toEqual([{ nom: 'dernier_changement_de_rib', args: { p_dossier_id: 'dossier-a' } }])
    // Avant le retour : rien d'affirmé — ni avis, ni « aucun changement », ni ligne discrète —, et le reste de l'accueil est là.
    expect(avis()).toBeNull()
    expect(texte()).not.toMatch(/RIB/)
    expect(screen.getByText('Mes pièces')).toBeTruthy()

    await act(async () => { ouvrir() })
    const bloc = await screen.findByRole('region', { name: NOM_DE_L_AVIS_DU_CLIENT })
    const a = avisDuChangement(PROPOSE, 'ventes')
    expect(bloc.textContent).toBe(`${a.phrase}${a.factures}${CONSEIL_AU_CLIENT_VENTES}${LIBELLE_OUVRIR_MES_VENTES}`)
    // Un RIB proposé attend la confirmation du cabinet : la pastille d'attention.
    expect(bloc.querySelector('.check-dot.check-attention')).not.toBeNull()
    expect(bloc.className).toContain('avis-rib-attente')
    expect(within(bloc).getByRole('link', { name: LIBELLE_OUVRIR_MES_VENTES }).getAttribute('href')).toBe('/mes-ventes')
    expect(appels()).toHaveLength(1)
    // Aux mots du client : tutoiement, aucun onglet, jamais le RIB lui-même ni la personne.
    expect(motsDuCabinet(bloc.textContent ?? '')).toEqual([])
    expect(bloc.textContent).not.toMatch(/IBAN|BIC|titulaire/)
  })

  it('elle est sous la salutation et AVANT les tuiles, et ne remplace aucune d’elles', async () => {
    faux.changements['dossier-a'] = { data: valeurRendue(PROPOSE), error: null }
    await monter()
    const bloc = await screen.findByRole('region', { name: NOM_DE_L_AVIS_DU_CLIENT })
    const salutation = document.querySelector('.client-hero') as Element
    const tuiles = document.querySelector('.tuiles') as Element
    expect(salutation.compareDocumentPosition(bloc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(bloc.compareDocumentPosition(tuiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const libelle of ['Prendre une photo', 'Mes pièces', 'Mes informations', 'Ma simulation']) expect(screen.getByText(libelle)).toBeTruthy()
  })

  it('un changement du cabinet : la pastille neutre, la phrase du module, aucune attente', async () => {
    faux.changements['dossier-a'] = { data: valeurRendue(CONFIRME), error: null }
    await monter()
    const bloc = await screen.findByRole('region', { name: NOM_DE_L_AVIS_DU_CLIENT })
    expect(bloc.textContent).toContain(avisDuChangement(CONFIRME, 'ventes').phrase)
    expect(bloc.querySelector('.check-dot.check-neutre')).not.toBeNull()
    expect(bloc.querySelector('.check-attention')).toBeNull()
    expect(bloc.className).not.toContain('avis-rib-attente')
  })

  it('chaque combinaison que la fonction rend se dit, aux mots du client', async () => {
    for (const c of toutesLesCombinaisons('2026-10-12')) {
      faux.changements['dossier-a'] = { data: valeurRendue(c), error: null }
      faux.rpcs = []
      const { unmount } = await monter()
      const bloc = await screen.findByRole('region', { name: NOM_DE_L_AVIS_DU_CLIENT })
      expect(bloc.textContent, `${c.geste}|${c.auteur}`).toContain(avisDuChangement(c, 'ventes').phrase)
      expect(motsDuCabinet(bloc.textContent ?? ''), `${c.geste}|${c.auteur}`).toEqual([])
      unmount()
    }
  })

  it('lue sans changement (« le RIB n’a jamais changé ») : rien — ni avis, ni « aucun », ni ligne discrète', async () => {
    faux.changements['dossier-a'] = { data: { changement: null }, error: null }
    await monter()
    await waitFor(() => expect(appels()).toHaveLength(1))
    await act(async () => { await Promise.resolve() })
    expect(avis()).toBeNull()
    expect(texte()).not.toMatch(/RIB/)
  })

  it('trente jours : le dernier jour (J + 29) se dit, le suivant ne dit plus rien — le client, proposition comprise', async () => {
    // Le 10 novembre 2026 est J + 29 d'un changement du 12 octobre.
    vi.setSystemTime(new Date('2026-11-10T10:00:00Z'))
    faux.changements['dossier-a'] = { data: valeurRendue(PROPOSE), error: null }
    const premier = await monter()
    expect(await screen.findByRole('region', { name: NOM_DE_L_AVIS_DU_CLIENT })).toBeTruthy()
    premier.unmount()

    vi.setSystemTime(new Date('2026-11-11T10:00:00Z'))
    faux.rpcs = []
    await monter()
    await waitFor(() => expect(appels()).toHaveLength(1))
    await act(async () => { await Promise.resolve() })
    expect(avis()).toBeNull()
    expect(texte()).not.toMatch(/RIB/)
  })

  it.each([
    ['refusée', { data: null, error: { message: 'Accès refusé à ce dossier.' } }, 'lecture refusée : Accès refusé à ce dossier.'],
    ['illisible', { data: { changement: { jour: '2026-10-12' } }, error: null }, undefined],
  ])('%s : une ligne discrète, jamais le silence d’un « aucun changement » ; le lien vers « Mes ventes » reste', async (_nom, reponse, motif) => {
    faux.changements['dossier-a'] = reponse
    await monter()
    const bloc = await screen.findByRole('region', { name: NOM_DE_L_AVIS_DU_CLIENT })
    expect(bloc.textContent).toBe(`${LECTURE_MANQUEE_AU_CLIENT}${LIBELLE_OUVRIR_MES_VENTES}`)
    expect(bloc.className).toContain('avis-rib-discret')
    expect(bloc.querySelector('.check-dot')).toBeNull()
    const phrase = screen.getByText(LECTURE_MANQUEE_AU_CLIENT)
    if (motif === undefined) expect(phrase.getAttribute('title')).toBeNull()
    else expect(phrase.getAttribute('title')).toContain('Accès refusé à ce dossier.')
    expect(within(bloc).getByRole('link', { name: LIBELLE_OUVRIR_MES_VENTES }).getAttribute('href')).toBe('/mes-ventes')
    expect(motsDuCabinet(bloc.textContent ?? '')).toEqual([])
  })

  it('la lecture vit À PART : la panne des listes de l’accueil ne la tait pas, la sienne n’en fausse aucune', async () => {
    faux.changements['dossier-a'] = { data: null, error: { message: 'Accès refusé à ce dossier.' } }
    await monter()
    await screen.findByRole('region', { name: NOM_DE_L_AVIS_DU_CLIENT })
    expect(screen.queryByText(/Tes envois n'ont pas pu être affichés/)).toBeNull()
    expect(screen.getByText('Mes derniers envois')).toBeTruthy()
  })
})

describe('ClientHome — l’avis du dernier changement du RIB, « Banque » seul et les deux cases', () => {
  it('« Banque » seul : ses mots à lui, son conseil, et AUCUN lien (il n’a pas d’écran des paramètres)', async () => {
    faux.droits = { 'dossier-a': { ...BANQUE } }
    faux.changements['dossier-a'] = { data: valeurRendue(PROPOSE), error: null }
    await monter()
    const bloc = await screen.findByRole('region', { name: NOM_DE_L_AVIS_DU_CLIENT })
    const a = avisDuChangement(PROPOSE, 'banque')
    expect(bloc.textContent).toBe(`${a.phrase}${a.factures}${CONSEIL_AU_CLIENT_BANQUE}`)
    expect(bloc.textContent).not.toContain('Mes ventes')
    expect(within(bloc).queryByRole('link')).toBeNull()
    expect(within(bloc).queryByRole('button')).toBeNull()
    expect(appels()).toHaveLength(1)
    expect(motsDuCabinet(bloc.textContent ?? '')).toEqual([])
  })

  it('« Banque » seul, lecture manquée : la ligne discrète, sans lien', async () => {
    faux.droits = { 'dossier-a': { ...BANQUE } }
    faux.changements['dossier-a'] = { data: null, error: { message: 'Accès refusé à ce dossier.' } }
    await monter()
    const bloc = await screen.findByRole('region', { name: NOM_DE_L_AVIS_DU_CLIENT })
    expect(bloc.textContent).toBe(LECTURE_MANQUEE_AU_CLIENT)
    expect(within(bloc).queryByRole('link')).toBeNull()
  })

  it('les deux cases : l’avis « Ventes » (son conseil, son lien), et UN seul appel', async () => {
    faux.droits = { 'dossier-a': { ...LES_DEUX } }
    faux.changements['dossier-a'] = { data: valeurRendue(PROPOSE), error: null }
    await monter()
    const bloc = await screen.findByRole('region', { name: NOM_DE_L_AVIS_DU_CLIENT })
    const a = avisDuChangement(PROPOSE, 'ventes')
    expect(bloc.textContent).toBe(`${a.phrase}${a.factures}${CONSEIL_AU_CLIENT_VENTES}${LIBELLE_OUVRIR_MES_VENTES}`)
    expect(appels()).toHaveLength(1)
  })

  it('aucune des deux cases : AUCUN appel de la fonction (la base refuserait), aucun avis, aucune ligne discrète', async () => {
    faux.droits = { 'dossier-a': { ...AUCUNE } }
    faux.changements['dossier-a'] = { data: valeurRendue(PROPOSE), error: null }
    await monter()
    await act(async () => { await Promise.resolve() })
    expect(appels()).toEqual([])
    expect(avis()).toBeNull()
    expect(texte()).not.toMatch(/RIB/)
  })

  it('une société sans accès enregistré (droits absents) : aucun appel non plus', async () => {
    faux.droits = {}
    await monter()
    await act(async () => { await Promise.resolve() })
    expect(appels()).toEqual([])
    expect(avis()).toBeNull()
  })
})

describe('ClientHome — l’avis du dernier changement du RIB, d’une société à l’autre', () => {
  it('une réponse plus lente que le changement de société ne s’affiche pas pour l’autre ; chaque société relit', async () => {
    faux.changements['dossier-a'] = { data: valeurRendue(PROPOSE), error: null }
    faux.changements['dossier-b'] = { data: valeurRendue(CONFIRME), error: null }
    const ouvrirA = retenir('dossier-a')
    const ouvrirB = retenir('dossier-b')
    const { rerender } = await monter()
    faux.dossier = 'dossier-b'
    rerender(<MemoryRouter><ClientHome /></MemoryRouter>)
    await waitFor(() => expect(appels().map((a) => (a.args as { p_dossier_id: string }).p_dossier_id)).toEqual(['dossier-a', 'dossier-b']))
    // La première société répond la première : la seconde attend toujours la sienne — rien n'est dit.
    await act(async () => { ouvrirA() })
    expect(avis()).toBeNull()
    await act(async () => { ouvrirB() })
    const bloc = await screen.findByRole('region', { name: NOM_DE_L_AVIS_DU_CLIENT })
    expect(bloc.textContent).toContain(avisDuChangement(CONFIRME, 'ventes').phrase)
    expect(bloc.textContent).not.toContain(avisDuChangement(PROPOSE, 'ventes').phrase)
  })

  it('la case retirée sur la société affichée : plus d’avis', async () => {
    faux.changements['dossier-a'] = { data: valeurRendue(PROPOSE), error: null }
    const { rerender } = await monter()
    await screen.findByRole('region', { name: NOM_DE_L_AVIS_DU_CLIENT })
    faux.droits = { 'dossier-a': { ...AUCUNE } }
    rerender(<MemoryRouter><ClientHome /></MemoryRouter>)
    await waitFor(() => expect(avis()).toBeNull())
    expect(texte()).not.toMatch(/RIB/)
  })
})

describe('ClientHome — drapeau baissé : la fonction n’est pas en base', () => {
  it('aucun appel, aucun avis, aucune ligne discrète', async () => {
    faux.drapeau = false
    faux.changements['dossier-a'] = { data: valeurRendue(PROPOSE), error: null }
    await monter()
    await act(async () => { await Promise.resolve() })
    expect(appels()).toEqual([])
    expect(avis()).toBeNull()
    expect(texte()).not.toMatch(/RIB/)
  })
})

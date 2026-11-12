import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccesTab from './AccesTab'
import { libelleDeLaCase } from '../../lib/droitsAcces'
import { AUCUN_CHANGEMENT_TRACE, CE_QUE_DIT_LA_TRACE } from '../../lib/traceDesDroitsVue'

// « DROITS CHANGÉS » DANS L'ONGLET ACCÈS (étape P1-trace, ligne 51.5) : la trace lue en entier, puis lue en partie, refusée,
// rompue ; qui l'a fait, sans jamais un identifiant ; rien d'affirmé avant le retour ; la relecture avec la liste des accès.
// La règle d'affichage est testée à part (traceDesDroitsVue.test.ts), la lecture aussi (traceDesDroitsLecture.test.ts) : ici,
// que l'écran les câble — le vrai module de lecture, sous un faux client qui REND TABLE PAR TABLE ce que la base rendrait.

vi.mock('../../lib/reglageDuDossierLecture', () => ({
  lireLeReglageDuDossier: async (dossierId: string) => ({
    dossierId, reglage: { etat: 'bascule' }, caisse: { etat: 'exclu', statut: 'exonere' }, nature: { etat: 'lue', categorieId: null },
  }),
}))
vi.mock('../../lib/natureDesRecettesLecture', () => ({
  lireLesCategoriesDeLaNature: async (dossierId: string) => ({ dossierId, etat: 'lues', categories: [] }),
  fixerLaNatureDesRecettes: async () => { throw new Error('non jouée ici') },
}))
vi.mock('../../components/EnvoyerEmailModal', () => ({ default: () => null }))
// La désignation du dossier du cabinet (LM1, en production depuis le 12/11/2026), lue pour CE dossier : elle n'est pas lui, et
// le formulaire est offert. Sa lecture a son test (dossierDuCabinetLecture.test.ts), l'onglet sur le dossier du cabinet le sien
// (AccesTab.dossierDuCabinet.test.tsx, qui joue aussi le drapeau baissé).
vi.mock('../../lib/dossierDuCabinetLecture', () => ({
  useDesignationDuDossier: (dossierId: string) => ({ etat: 'lue', dossierId, dossierActuel: null }),
}))

type Ligne = Record<string, unknown>
const faux = vi.hoisted(() => ({
  acces: [] as Record<string, unknown>[],
  trace: [] as Record<string, unknown>[],
  // Les adresses des accès retirés (P1T-E2, en base depuis le 11/11/2026), que l'écran lit avec la trace.
  adresses: [] as Record<string, unknown>[],
  // 'entier' : tout ; 'muet' : la trace s'arrête après `muetApres` ligne(s) ; 'refus' ; 'leve'.
  mode: 'entier' as 'entier' | 'muet' | 'refus' | 'leve',
  muetApres: 1,
  accesRefuses: false,
  lecturesDeLaTrace: 0,
  // Une réponse de la trace retenue : la lecture ne revient qu'à sa libération.
  porteTrace: null as Promise<void> | null,
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const predicats: ReturnType<typeof predicatEq>[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            const source = table === 'trace_des_droits' ? faux.trace : table === 'adresses_des_acces_retires' ? faux.adresses : faux.acces
            const repondre = () => {
              if (table === 'trace_des_droits') {
                faux.lecturesDeLaTrace += 1
                if (faux.mode === 'leve') throw new Error('réseau coupé')
                if (faux.mode === 'refus') return { data: null, error: { message: 'accès refusé' }, count: null }
              } else if (faux.accesRefuses && table !== 'adresses_des_acces_retires') {
                return { data: null, error: { message: 'JWT expired' }, count: null }
              }
              const toutes = filtrer(source, predicats)
              const jusqua = table === 'trace_des_droits' && faux.mode === 'muet' ? Math.min(fin + 1, faux.muetApres) : fin + 1
              return { data: toutes.slice(debut, jusqua).map((l) => ({ ...l })), error: null, count: toutes.length }
            }
            const attente = table === 'trace_des_droits' && faux.porteTrace ? faux.porteTrace : Promise.resolve()
            return attente.then(repondre).then(suite, echec)
          },
        })
        return c
      },
      // `changer_droits_acces` : l'accès change, et le déclencheur de la base écrit sa ligne de trace, auteur le cabinet.
      rpc: (_nom: string, args: Record<string, unknown>) => {
        const acces = faux.acces.find((a) => a.id === args.p_membership_id)
        if (!acces) return Promise.resolve({ data: null, error: { message: 'Accès refusé à ce dossier.' } })
        acces.droit_ventes = args.p_ventes
        faux.trace.push({
          id: 't-nouveau', dossier_id: acces.dossier_id, acces_id: acces.id, client_id: acces.user_id, droit: 'ventes',
          coche: args.p_ventes, geste: 'changement', auteur_id: 'u-cabinet', fait_le: '2026-11-10T12:00:00Z',
        })
        return Promise.resolve({ data: { ...acces }, error: null })
      },
      functions: { invoke: () => new Promise(() => {}) },
      auth: { resetPasswordForEmail: async () => ({ data: {}, error: null }) },
    },
  }
})

const acces = (o: Ligne & { id: string }): Ligne => ({
  dossier_id: 'd1', user_id: `u-${o.id}`, email: null, created_at: '2026-10-01T08:00:00Z',
  droit_ventes: false, droit_banque: false, droit_caisse: false, droit_comptes: false, droit_achats: false, droit_frais: false,
  droit_documents: false, ...o,
})
const trace = (o: Ligne & { id: string }): Ligne => ({
  dossier_id: 'd1', acces_id: 'm1', client_id: 'u-m1', droit: 'ventes', coche: true, geste: 'changement', auteur_id: 'u-cabinet',
  fait_le: '2026-11-08T09:12:00Z', ...o,
})

beforeEach(() => {
  faux.mode = 'entier'
  faux.muetApres = 1
  faux.accesRefuses = false
  faux.lecturesDeLaTrace = 0
  faux.porteTrace = null
  faux.acces = [
    acces({ id: 'm1', email: 'client@exemple.fr', droit_ventes: true }),
    acces({ id: 'm2', email: 'second@exemple.fr' }),
    acces({ id: 'm3', email: null }),
  ]
  faux.trace = [
    trace({ id: 't1', droit: 'ventes', coche: true, fait_le: '2026-11-08T09:12:00Z' }),
    trace({ id: 't2', droit: 'frais', coche: false, fait_le: '2026-11-09T14:30:00Z', auteur_id: null }),
    // Le titulaire de l'accès M2, lui-même : l'auteur est le compte que la ligne enregistre.
    trace({ id: 't3', acces_id: 'm2', client_id: 'u-m2', droit: 'banque', geste: 'creation', auteur_id: 'u-m2' }),
    // Un accès retiré depuis : la trace survit, sans adresse.
    trace({ id: 't4', acces_id: 'm-parti', client_id: 'u-parti', droit: 'caisse', coche: false, geste: 'retrait', fait_le: '2026-11-05T08:00:00Z' }),
  ]
})

afterEach(() => { vi.restoreAllMocks() })

const volet = (debut: string) => {
  const resume = screen.getByText((contenu, el) => el?.tagName === 'SUMMARY' && contenu.startsWith(`Droits changés — ${debut}`))
  return { resume, volet: resume.closest('details') as HTMLElement }
}

async function ouvrir() {
  render(<AccesTab dossierId="d1" dossierNom="Cabinet Martin" codeEmail="abc123" />)
  await screen.findByText('client@exemple.fr')
}

describe('« Droits changés » — la trace lue en entier', () => {
  it('ne dit rien du vide avant le retour de la lecture, puis montre un volet par accès, aux dates de Paris', async () => {
    let liberer: () => void = () => {}
    faux.porteTrace = new Promise<void>((resolve) => { liberer = resolve })
    await ouvrir()
    // La liste des accès est revenue, la trace non : « Chargement… », ni vide, ni volet, ni bandeau.
    await screen.findByText('Chargement de la trace des droits…')
    expect(screen.queryByText(/aucun changement/i)).toBeNull()
    expect(screen.queryByText(/pas pu être lue/)).toBeNull()
    expect(screen.queryByText(/Droits changés — /)).toBeNull()
    expect(screen.getByText(CE_QUE_DIT_LA_TRACE)).toBeTruthy()
    await act(async () => { liberer() })

    const m1 = volet('client@exemple.fr')
    expect(m1.resume.textContent).toBe('Droits changés — client@exemple.fr — 2 changements')
    // Les plus récents d'abord : la note de frais décochée sans session (09/11 à 15:30 à Paris), puis « Ventes » cochée.
    const lignes = within(m1.volet).getAllByRole('row').slice(1)
    expect(lignes.map((l) => l.textContent)).toEqual([
      '09/11/2026 à 15:30Notes de fraisdécochéeSans session',
      '08/11/2026 à 10:12VentescochéeLe cabinet',
    ])
    expect(screen.queryByText(/pas pu être lue/)).toBeNull()
  })

  it('dit « le client » du titulaire qui a agi lui-même, et sans adresse un accès sans nom lisible, jamais son identifiant', async () => {
    await ouvrir()
    const m2 = await waitFor(() => volet('second@exemple.fr'))
    expect(within(m2.volet).getByText('cochée à la création de l’accès')).toBeTruthy()
    expect(within(m2.volet).getByText('Le client')).toBeTruthy()
    // M3 n'a pas d'adresse : l'intitulé le dit, et ne montre aucun identifiant.
    expect(volet('Accès sans adresse lisible').resume.textContent).toContain('aucun changement tracé')
  })

  it('un accès sans ligne dit « aucun changement tracé » et pourquoi la trace commence tard ; l’accès retiré garde la sienne', async () => {
    await ouvrir()
    const m3 = await waitFor(() => volet('Accès sans adresse lisible'))
    expect(within(m3.volet).getByText(AUCUN_CHANGEMENT_TRACE)).toBeTruthy()
    const parti = volet('Accès retiré depuis')
    expect(parti.resume.textContent).toBe('Droits changés — Accès retiré depuis (tracé dès le 05/11/2026 à 09:00) — 1 changement')
    expect(within(parti.volet).getByText('cochée jusqu’au retrait de l’accès')).toBeTruthy()
  })

  it('ne montre aucun identifiant de la base', async () => {
    await ouvrir()
    await waitFor(() => volet('second@exemple.fr'))
    const carte = screen.getByText('Droits changés', { selector: 'h3' }).closest('.card') as HTMLElement
    for (const id of ['m1', 'm2', 'm3', 'm-parti', 'u-m1', 'u-m2', 'u-parti', 'u-cabinet', 't1', 't4']) {
      expect(carte.textContent).not.toContain(id)
    }
  })

  it('se relit avec la liste des accès : une case cochée écrit une ligne de trace, vue après la relecture', async () => {
    await ouvrir()
    await waitFor(() => volet('second@exemple.fr'))
    expect(faux.lecturesDeLaTrace).toBe(1)
    // La case « Ventes » du deuxième accès.
    fireEvent.click(screen.getByRole('checkbox', { name: libelleDeLaCase('ventes', 'second@exemple.fr') }))
    await waitFor(() => expect(faux.lecturesDeLaTrace).toBe(2))
    const m2 = await waitFor(() => {
      const v = volet('second@exemple.fr')
      expect(v.resume.textContent).toContain('2 changements')
      return v
    })
    expect(within(m2.volet).getByText('10/11/2026 à 13:00')).toBeTruthy()
  })
})

describe('« Droits changés » — la trace lue en partie, refusée ou rompue', () => {
  it('lue en partie : les lignes lues restent, le bandeau dit qu’il en manque, aucun volet n’affirme le vide', async () => {
    faux.mode = 'muet'
    await ouvrir()
    expect(await screen.findByText(/La trace des droits n'a pas pu être lue en entier \(1 ligne\(s\) lue\(s\) sur 4 annoncée\(s\)\)/)).toBeTruthy()
    // Le seul volet qui a une ligne lue la montre ; les autres disent qu'ils n'ont rien lu, pas « aucun changement ».
    expect(screen.queryByText(/aucun changement/i)).toBeNull()
    expect(screen.queryByText(AUCUN_CHANGEMENT_TRACE)).toBeNull()
    expect(screen.getAllByText(/rien de lu|1 changement/).length).toBeGreaterThan(0)
  })

  it('refusée : le motif de la base, aucun volet vide affirmé', async () => {
    faux.mode = 'refus'
    await ouvrir()
    await screen.findByText(/La trace des droits n'a pas pu être lue en entier \(lecture interrompue après 0 ligne\(s\) : accès refusé\)/)
    expect(screen.queryByText(/aucun changement/i)).toBeNull()
    expect(screen.getAllByText(/rien de lu/).length).toBe(3)
  })

  it('rompue (la requête lève) : le motif, et la page reste', async () => {
    faux.mode = 'leve'
    await ouvrir()
    await screen.findByText(/La trace des droits n'a pas pu être lue en entier \(réseau coupé\)/)
    expect(screen.queryByText(/aucun changement/i)).toBeNull()
    expect(screen.getByText('client@exemple.fr')).toBeTruthy()
  })

  it('la liste des accès non lue : l’accès de la trace n’est pas dit « retiré », et le vide ne se dit pas', async () => {
    faux.accesRefuses = true
    render(<AccesTab dossierId="d1" dossierNom="Cabinet Martin" codeEmail="abc123" />)
    await screen.findAllByText(/Accès absent de la liste lue/, { selector: 'summary' })
    expect(screen.queryByText(/Accès retiré/)).toBeNull()
    expect(screen.queryByText(/aucun changement/i)).toBeNull()
  })

  it('un dossier dont rien n’a changé, trace lue en entier, le dit une fois', async () => {
    faux.trace = []
    faux.acces = []
    render(<AccesTab dossierId="d1" dossierNom="Cabinet Martin" codeEmail="abc123" />)
    await screen.findByText('Aucun changement de droits tracé pour ce dossier.')
  })
})

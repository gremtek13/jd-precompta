import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AccesTab from './AccesTab'
import {
  CE_QUE_LA_CASE_RETIENT, RAISON_DU_DOSSIER_EN_ENGAGEMENT, REFUS_CAISSE_DOSSIER_NON_EXCLU, ceQueDitLaCaseCaisse, messageDuRefus,
  raisonDuDossierNonExclu, raisonDuModeIllisible, raisonDuStatutIllisible, type EtatCaisseDuDossier,
} from '../../lib/droitsAcces'
import { MOTS_DE_LA_CAISSE, type CategorieDeLaCaisse } from '../../lib/caisse'
import { phraseDeLaNature } from '../../lib/natureDesRecettes'

// L'ONGLET ACCÈS ET LA CASE « CAISSE » (ligne 26.6, étape C11 ; la conception reprise, § 3 ; CAISSE2-Q2 et Q3). Ce qui se
// garde ici, que le module seul ne voit pas : la case suit le statut de TVA LU ; la cocher ouvre une confirmation qui nomme
// la personne, ce qui s'ouvre et la condition, et rien ne part avant elle ; la demande part à la forme à quatre ; deux clics
// du même `act` n'écrivent qu'une fois ; un statut illisible n'offre aucun geste ; rien avant le retour ; la nature des
// recettes se fixe sous la liste, sous son verrou, sur des catégories lues en entier. Données fictives.
type LigneAcces = {
  id: string; user_id: string; email: string | null; dossier_id: string; created_at: string
  droit_ventes: boolean; droit_banque: boolean; droit_caisse: boolean
}

const faux = vi.hoisted(() => ({
  lignes: [] as LigneAcces[],
  compteAnnonce: null as number | null,
  appelsRpc: [] as { nom: string; args: Record<string, unknown> }[],
  porteRpc: null as Promise<void> | null,
  reponseRpc: null as null | { data: unknown; error: unknown },
}))

// L'ÉTAT D'AVANT LA CASE « COMPTES » (étape C4a, en production depuis le 07/11/2026) : ce fichier joue l'onglet du drapeau
// baissé, éprouvé tant que son code existe ; le drapeau levé se joue dans AccesTab.comptes.test.tsx.
vi.mock('../../lib/situationsPubliees', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/situationsPubliees')>(),
  SITUATIONS_PUBLIEES_EXPORTEES: false,
}))
// La désignation du dossier du cabinet (LM1, en production depuis le 12/11/2026), lue pour CE dossier : elle n'est pas lui, et
// le formulaire est offert. Sa lecture a son test (dossierDuCabinetLecture.test.ts), l'onglet sur le dossier du cabinet le sien
// (AccesTab.dossierDuCabinet.test.tsx, qui joue aussi le drapeau baissé).
vi.mock('../../lib/dossierDuCabinetLecture', () => ({
  useDesignationDuDossier: (dossierId: string) => ({ etat: 'lue', dossierId, dossierActuel: null }),
}))
// La trace des droits (étape P1-trace) a sa lecture et son écran testés à part (traceDesDroitsLecture.test.ts, AccesTab.trace.test.tsx) :
// ici, lue en entier et vide, pour que les lectures que ce fichier compte restent celles des accès.
vi.mock('../../lib/traceDesDroitsLecture', () => ({
  lireLaTraceDuDossier: async (dossierId: string) => ({ dossierId, lignes: [], motif: null }),
  // Les adresses des accès retirés (P1T-E2, en base depuis le 11/11/2026), lues avec la trace : en entier, et aucune.
  lireLesAdressesDesAccesRetires: async (dossierId: string) => ({ dossierId, parAcces: new Map(), motif: null }),
}))
vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  // La forme à quatre de `changer_droits_acces` (migration `caisse_du_client`) ; la forme à trois lève ici.
  function changerDroitsAcces(args: Record<string, unknown>) {
    if (!('p_caisse' in args)) throw new Error('Faux client : changer_droits_acces à trois paramètres n’est pas modélisée.')
    const acces = faux.lignes.find((l) => l.id === args.p_membership_id)
    if (!acces) return { data: null, error: { message: 'Accès refusé à ce dossier.', code: '42501' } }
    if (args.p_ventes === null && args.p_banque === null && args.p_caisse === null) {
      return { data: null, error: { message: 'Aucun droit à changer : précise « Ventes », « Banque » ou « Caisse ».', code: '22023' } }
    }
    if (args.p_ventes !== null) acces.droit_ventes = args.p_ventes as boolean
    if (args.p_banque !== null) acces.droit_banque = args.p_banque as boolean
    if (args.p_caisse !== null) acces.droit_caisse = args.p_caisse as boolean
    return { data: { ...acces }, error: null }
  }
  return {
    supabase: {
      from: () => {
        const predicats: ReturnType<typeof predicatEq>[] = []
        let colonnes: string[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const chaine: Record<string, unknown> = {}
        Object.assign(chaine, {
          // Comme PostgREST, seules les colonnes DEMANDÉES reviennent : une case que la lecture oublierait se verrait.
          select: (liste: string) => { colonnes = liste.split(',').map((c) => c.trim()); return chaine },
          delete: () => ({ eq: (_c: string, id: unknown) => {
            faux.lignes = faux.lignes.filter((l) => l.id !== id)
            return Promise.resolve({ error: null })
          } }),
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return chaine },
          order: () => chaine,
          range: (d: number, f: number) => { debut = d; fin = f; return chaine },
          then: (suite: (r: unknown) => unknown) => {
            const lignes = filtrer(faux.lignes, predicats)
            const projeter = (l: LigneAcces) => Object.fromEntries(colonnes.filter((c) => c in l).map((c) => [c, l[c as keyof LigneAcces]]))
            return Promise.resolve({
              data: lignes.slice(debut, fin + 1).map(projeter), error: null, count: faux.compteAnnonce ?? lignes.length,
            }).then(suite)
          },
        })
        return chaine
      },
      functions: { invoke: () => new Promise(() => {}) },
      auth: { resetPasswordForEmail: async () => ({ data: {}, error: null }) },
      rpc: (nom: string, args: Record<string, unknown>) => {
        faux.appelsRpc.push({ nom, args })
        const repondre = () => faux.reponseRpc ?? changerDroitsAcces(args)
        return faux.porteRpc ? faux.porteRpc.then(repondre) : Promise.resolve(repondre())
      },
    },
  }
})

// La ligne du dossier : le réglage des ventes (basculé), le statut de TVA et la nature, chacun réglé par le cas.
const dossierFaux = vi.hoisted(() => ({
  caisse: { etat: 'exclu', statut: 'exonere' } as EtatCaisseDuDossier,
  nature: { etat: 'lue', categorieId: null } as { etat: 'lue'; categorieId: string | null } | { etat: 'illisible'; motif: string },
  porte: null as Promise<void> | null,
}))
vi.mock('../../lib/reglageDuDossierLecture', () => ({
  lireLeReglageDuDossier: async (dossierId: string) => {
    if (dossierFaux.porte) await dossierFaux.porte
    return { dossierId, reglage: { etat: 'bascule' }, caisse: dossierFaux.caisse, nature: dossierFaux.nature }
  },
}))

// Les catégories de la nature, et son écriture : ses appels, sa réponse, une porte pour la retenir.
const natureFaux = vi.hoisted(() => ({
  categories: [] as CategorieDeLaCaisse[],
  lecture: 'lues' as 'lues' | 'incompletes',
  ecritures: [] as (string | null)[],
  porte: null as Promise<void> | null,
  reponse: null as null | { ecrite: true; categorieId: string | null } | { ecrite: false; refus: string | null },
}))
vi.mock('../../lib/natureDesRecettesLecture', () => ({
  lireLesCategoriesDeLaNature: async (dossierId: string) => (natureFaux.lecture === 'lues'
    ? { dossierId, etat: 'lues', categories: natureFaux.categories }
    : { dossierId, etat: 'incompletes', motif: 'délai dépassé' }),
  fixerLaNatureDesRecettes: async (_dossierId: string, categorieId: string | null) => {
    natureFaux.ecritures.push(categorieId)
    if (natureFaux.porte) await natureFaux.porte
    if (natureFaux.reponse) return natureFaux.reponse
    dossierFaux.nature = { etat: 'lue', categorieId }
    return { ecrite: true, categorieId }
  },
}))

vi.mock('../../components/EnvoyerEmailModal', () => ({ default: () => null }))

const acces = (o: Partial<LigneAcces> & { id: string }): LigneAcces => ({
  user_id: `u-${o.id}`, email: null, dossier_id: 'd1', created_at: '2026-10-01T08:00:00Z', droit_ventes: false, droit_banque: false,
  droit_caisse: false, ...o,
})

const HONORAIRES: CategorieDeLaCaisse = { id: 'honoraires', dossier_id: 'd1', libelle: 'Honoraires', compte_comptable: '706000' }
const FOURNITURES: CategorieDeLaCaisse = { id: 'fournitures', dossier_id: 'd1', libelle: 'Fournitures', compte_comptable: '606000' }
const COMMUNE: CategorieDeLaCaisse = { id: 'commune', dossier_id: null, libelle: 'Produits divers', compte_comptable: '758000' }

function monter() {
  return render(<AccesTab dossierId="d1" dossierNom="Cabinet Martin" codeEmail="abc123" />)
}

const caseDe = (droit: 'Ventes' | 'Banque' | 'Caisse', personne = 'client@exemple.fr') =>
  screen.getByRole<HTMLInputElement>('checkbox', { name: `Droit « ${droit} » de ${personne}` })

const fenetre = () => screen.queryByRole('alertdialog')

function retenirLEcriture(): () => Promise<void> {
  let ouvrir = () => {}
  faux.porteRpc = new Promise<void>((resolve) => { ouvrir = resolve })
  return async () => {
    faux.porteRpc = null
    await act(async () => { ouvrir() })
  }
}

beforeEach(() => {
  faux.lignes = [
    acces({ id: 'm1', user_id: 'u1', email: 'client@exemple.fr' }),
    acces({ id: 'm2', user_id: 'u2', email: 'secretariat@exemple.fr', droit_caisse: true }),
  ]
  faux.compteAnnonce = null
  faux.appelsRpc = []
  faux.porteRpc = null
  faux.reponseRpc = null
  dossierFaux.caisse = { etat: 'exclu', statut: 'exonere' }
  dossierFaux.nature = { etat: 'lue', categorieId: null }
  dossierFaux.porte = null
  natureFaux.categories = [HONORAIRES, FOURNITURES, COMMUNE]
  natureFaux.lecture = 'lues'
  natureFaux.ecritures = []
  natureFaux.porte = null
  natureFaux.reponse = null
  window.confirm = () => true
})

describe('la case « Caisse » suit le statut de TVA lu', () => {
  it('exonéré : la case s’offre, cochée comme la base la tient, et la phrase dit ce que la base ouvre et ce que la case retient', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    expect(caseDe('Caisse').checked).toBe(false)
    expect(caseDe('Caisse').disabled).toBe(false)
    expect(caseDe('Caisse', 'secretariat@exemple.fr').checked).toBe(true)
    expect(caseDe('Caisse', 'secretariat@exemple.fr').disabled).toBe(false)
    const phrase = document.getElementById('ce-que-dit-la-case-caisse')
    expect(phrase?.textContent).toBe(ceQueDitLaCaseCaisse({ etat: 'exclu', statut: 'exonere' }))
    expect(phrase?.textContent).toContain(CE_QUE_LA_CASE_RETIENT)
  })

  it('redevable : décochée, la case est grisée et désigne sa raison ; cochée, elle se décoche sans confirmation', async () => {
    dossierFaux.caisse = { etat: 'tenue_par_le_cabinet', statut: 'redevable' }
    monter()
    await screen.findByText('client@exemple.fr')
    const grisee = caseDe('Caisse')
    expect(grisee.disabled).toBe(true)
    expect(grisee.title).toBe(raisonDuDossierNonExclu('redevable'))
    expect(grisee.getAttribute('aria-describedby')).toBe('ce-que-dit-la-case-caisse')
    expect(document.getElementById('ce-que-dit-la-case-caisse')?.textContent).toContain(raisonDuDossierNonExclu('redevable'))
    // Les deux autres cases ne lisent pas le statut.
    expect(caseDe('Banque').disabled).toBe(false)
    expect(caseDe('Ventes').disabled).toBe(false)
    const cochee = caseDe('Caisse', 'secretariat@exemple.fr')
    expect(cochee.disabled).toBe(false)
    await act(async () => { cochee.click() })
    expect(fenetre()).toBeNull()
    expect(faux.appelsRpc.map((a) => a.args)).toEqual([{ p_membership_id: 'm2', p_ventes: null, p_banque: null, p_caisse: false }])
    expect(caseDe('Caisse', 'secretariat@exemple.fr').checked).toBe(false)
    expect(caseDe('Caisse', 'secretariat@exemple.fr').disabled).toBe(true)
  })

  it('à préciser : comme redevable, et la phrase le nomme', async () => {
    dossierFaux.caisse = { etat: 'tenue_par_le_cabinet', statut: null }
    monter()
    await screen.findByText('client@exemple.fr')
    expect(caseDe('Caisse').disabled).toBe(true)
    expect(caseDe('Caisse').title).toBe(raisonDuDossierNonExclu(null))
  })

  it('statut illisible : la case ne se coche ni ne se décoche, la phrase dit le motif ; les deux autres s’offrent', async () => {
    dossierFaux.caisse = { etat: 'illisible', motif: 'lecture refusée' }
    monter()
    await screen.findByText('client@exemple.fr')
    for (const personne of ['client@exemple.fr', 'secretariat@exemple.fr']) {
      expect(caseDe('Caisse', personne).disabled, personne).toBe(true)
      expect(caseDe('Caisse', personne).title, personne).toBe(raisonDuStatutIllisible('lecture refusée'))
      expect(caseDe('Banque', personne).disabled, personne).toBe(false)
    }
    expect(document.getElementById('ce-que-dit-la-case-caisse')?.textContent).toContain('Le statut de TVA de ce dossier ne se lit pas (lecture refusée)')
  })

  it('rien avant le retour de la ligne du dossier : ni case, ni phrase de la case', async () => {
    let ouvrir = () => {}
    dossierFaux.porte = new Promise<void>((resolve) => { ouvrir = resolve })
    monter()
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)) })
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(document.getElementById('ce-que-dit-la-case-caisse')).toBeNull()
    expect(screen.queryByLabelText(/^Nature/)).toBeNull()
    await act(async () => { ouvrir() })
    expect(await screen.findAllByRole('checkbox')).toHaveLength(6)
    expect(document.getElementById('ce-que-dit-la-case-caisse')).not.toBeNull()
  })

  it('une liste lue en partie n’offre aucune case : la case « Caisse » se lit, sans se changer', async () => {
    faux.compteAnnonce = 5
    monter()
    expect(await screen.findByText('client@exemple.fr')).toBeTruthy()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    const ligne = screen.getByText('secretariat@exemple.fr').closest('tr')!
    expect(within(ligne).getAllByText(/^(Oui|Non)$/).map((e) => e.textContent)).toEqual(['Non', 'Non', 'Oui'])
  })
})

// C11-Q2 (le 04/11/2026, « La refuser à l'écran ») : sur un dossier tenu en engagement, la case ne se coche pas, dit avant
// le clic en une phrase ; décocher reste offert ; un mode illisible n'offre aucun geste. L'écran est ici plus strict que la base.
describe('la case « Caisse » suit le mode comptable lu (C11-Q2)', () => {
  it('en engagement : décochée, la case est grisée sous sa raison ; la phrase la dit ; aucune fenêtre ne s’ouvre', async () => {
    dossierFaux.caisse = { etat: 'en_engagement', statut: 'exonere' }
    monter()
    await screen.findByText('client@exemple.fr')
    const grisee = caseDe('Caisse')
    expect(grisee.disabled).toBe(true)
    expect(grisee.title).toBe(RAISON_DU_DOSSIER_EN_ENGAGEMENT)
    expect(grisee.title).toContain(`« ${MOTS_DE_LA_CAISSE.tresorerie.gabarit} »`)
    expect(grisee.getAttribute('aria-describedby')).toBe('ce-que-dit-la-case-caisse')
    expect(document.getElementById('ce-que-dit-la-case-caisse')?.textContent).toContain(RAISON_DU_DOSSIER_EN_ENGAGEMENT)
    // Un clic qui arriverait quand même n'ouvre rien et n'écrit rien.
    await act(async () => { fireEvent.click(grisee) })
    expect(fenetre()).toBeNull()
    expect(faux.appelsRpc).toEqual([])
    // Les deux autres cases ne lisent pas le mode.
    expect(caseDe('Banque').disabled).toBe(false)
    expect(caseDe('Ventes').disabled).toBe(false)
  })

  it('en engagement : cochée, la case se décoche sans confirmation — deux clics du même `act` n’écrivent qu’une fois', async () => {
    dossierFaux.caisse = { etat: 'en_engagement', statut: 'franchise' }
    monter()
    await screen.findByText('client@exemple.fr')
    const cochee = caseDe('Caisse', 'secretariat@exemple.fr')
    expect(cochee.checked).toBe(true)
    expect(cochee.disabled).toBe(false)
    const liberer = retenirLEcriture()
    await act(async () => { fireEvent.click(cochee); fireEvent.click(cochee) })
    expect(fenetre()).toBeNull()
    expect(faux.appelsRpc.map((a) => a.args)).toEqual([{ p_membership_id: 'm2', p_ventes: null, p_banque: null, p_caisse: false }])
    await liberer()
    expect(faux.appelsRpc).toHaveLength(1)
    expect(caseDe('Caisse', 'secretariat@exemple.fr').checked).toBe(false)
    expect(caseDe('Caisse', 'secretariat@exemple.fr').disabled).toBe(true)
  })

  it('mode illisible : la case ne se coche ni ne se décoche, la phrase dit le motif ; les deux autres s’offrent', async () => {
    dossierFaux.caisse = { etat: 'mode_illisible', motif: 'le mode comptable n’a pas été lu' }
    monter()
    await screen.findByText('client@exemple.fr')
    for (const personne of ['client@exemple.fr', 'secretariat@exemple.fr']) {
      expect(caseDe('Caisse', personne).disabled, personne).toBe(true)
      expect(caseDe('Caisse', personne).title, personne).toBe(raisonDuModeIllisible('le mode comptable n’a pas été lu'))
      expect(caseDe('Banque', personne).disabled, personne).toBe(false)
    }
    await act(async () => { fireEvent.click(caseDe('Caisse', 'secretariat@exemple.fr')) })
    expect(faux.appelsRpc).toEqual([])
    expect(document.getElementById('ce-que-dit-la-case-caisse')?.textContent)
      .toContain('Le mode comptable de ce dossier ne se lit pas (le mode comptable n’a pas été lu)')
  })
})

describe('cocher « Caisse » se confirme', () => {
  it('le clic ouvre la fenêtre, et RIEN ne part : elle nomme la personne, ce qui s’ouvre, la condition et la nature', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => { caseDe('Caisse').click() })
    expect(faux.appelsRpc).toEqual([])
    const f = fenetre()!
    expect(f).not.toBeNull()
    expect(f.textContent).toContain('Cocher « Caisse » pour client@exemple.fr lui ouvre aussitôt, par la base, la caisse du dossier.')
    expect(within(f).getByText('client@exemple.fr').className).toBe('courriel')
    expect(f.textContent).toContain('Tu déclares que toutes les opérations de ce dossier sont exonérées de TVA')
    expect(f.textContent).toContain(CE_QUE_LA_CASE_RETIENT)
    expect(f.textContent).toContain('Tu n’as pas fixé la nature de ses recettes en espèces')
    // La case n'a pas bougé, et les autres attendent la réponse de la fenêtre.
    expect(caseDe('Caisse').checked).toBe(false)
    expect(caseDe('Banque').disabled).toBe(true)
  })

  it('« Annuler » n’envoie rien et rend les cases', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => { caseDe('Caisse').click() })
    await act(async () => { within(fenetre()!).getByRole('button', { name: 'Annuler' }).click() })
    expect(fenetre()).toBeNull()
    expect(faux.appelsRpc).toEqual([])
    expect(caseDe('Caisse').checked).toBe(false)
    expect(caseDe('Banque').disabled).toBe(false)
  })

  it('confirmée, la demande part à la forme à quatre — « Caisse » seule non nulle —, puis la liste se relit', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => { caseDe('Caisse').click() })
    await act(async () => { within(fenetre()!).getByRole('button', { name: 'Cocher « Caisse »' }).click() })
    expect(faux.appelsRpc).toEqual([
      { nom: 'changer_droits_acces', args: { p_membership_id: 'm1', p_ventes: null, p_banque: null, p_caisse: true } },
    ])
    expect(fenetre()).toBeNull()
    expect(caseDe('Caisse').checked).toBe(true)
  })

  it('deux clics du même rendu sur « Cocher « Caisse » » n’écrivent qu’une fois ; la fenêtre attend la réponse', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => { caseDe('Caisse').click() })
    const liberer = retenirLEcriture()
    const bouton = within(fenetre()!).getByRole('button', { name: 'Cocher « Caisse »' })
    await act(async () => { fireEvent.click(bouton); fireEvent.click(bouton) })
    expect(faux.appelsRpc).toHaveLength(1)
    expect(within(fenetre()!).getByRole('button', { name: 'Enregistrement…' })).toBeTruthy()
    await liberer()
    expect(faux.appelsRpc).toHaveLength(1)
    expect(fenetre()).toBeNull()
  })

  it('un refus de la base (le statut changé ailleurs) se dit à ses mots, avec la personne, et la liste se relit', async () => {
    faux.reponseRpc = { data: null, error: { message: REFUS_CAISSE_DOSSIER_NON_EXCLU.message, code: REFUS_CAISSE_DOSSIER_NON_EXCLU.code } }
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => { caseDe('Caisse').click() })
    await act(async () => { within(fenetre()!).getByRole('button', { name: 'Cocher « Caisse »' }).click() })
    expect(screen.getByRole('alert').textContent).toBe(messageDuRefus('caisse', 'client@exemple.fr', REFUS_CAISSE_DOSSIER_NON_EXCLU.message))
    expect(caseDe('Caisse').checked).toBe(false)
    expect(fenetre()).toBeNull()
  })

  it('en franchise, la condition est celle de la franchise ; une nature fixée se nomme', async () => {
    dossierFaux.caisse = { etat: 'exclu', statut: 'franchise' }
    dossierFaux.nature = { etat: 'lue', categorieId: 'honoraires' }
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => { caseDe('Caisse').click() })
    const texte = fenetre()!.textContent ?? ''
    expect(texte).toContain('relève de la franchise en base de TVA (CGI, art. 293 B)')
    expect(texte).toContain('Ses recettes en espèces se rangeront sous « Honoraires »')
  })

  it('le statut relu pendant que la fenêtre est ouverte ne l’est plus : la fenêtre le dit, son bouton se grise, rien ne part', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => { caseDe('Caisse').click() })
    // Une relecture passe (un retrait, ici celui du second accès), et le dossier relu est devenu redevable.
    dossierFaux.caisse = { etat: 'tenue_par_le_cabinet', statut: 'redevable' }
    const autre = screen.getByText('secretariat@exemple.fr').closest('tr')!
    await act(async () => { within(autre).getByRole('button', { name: 'Retirer' }).click() })
    const f = fenetre()!
    expect(f.textContent).toContain('ne se coche plus sur ce dossier')
    expect(f.textContent).toContain(REFUS_CAISSE_DOSSIER_NON_EXCLU.message)
    const bouton = within(f).getByRole('button', { name: 'Cocher « Caisse »' }) as HTMLButtonElement
    expect(bouton.disabled).toBe(true)
    await act(async () => { fireEvent.click(bouton) })
    expect(faux.appelsRpc).toEqual([])
  })

  it('décocher ne se confirme pas, et n’envoie que « Caisse »', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => { caseDe('Caisse', 'secretariat@exemple.fr').click() })
    expect(fenetre()).toBeNull()
    expect(faux.appelsRpc.map((a) => a.args)).toEqual([{ p_membership_id: 'm2', p_ventes: null, p_banque: null, p_caisse: false }])
  })
})

describe('la nature des recettes du client, sous la liste', () => {
  it('ne propose que les catégories de produit du dossier et les communes, et dit la nature d’aujourd’hui', async () => {
    monter()
    const choix = await screen.findByLabelText<HTMLSelectElement>(/^Nature/)
    expect([...choix.options].map((o) => o.textContent)).toEqual(['Aucune — ses recettes se refusent', 'Honoraires', 'Produits divers'])
    expect(screen.getByText(phraseDeLaNature({ etat: 'absente' }))).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enregistrer la nature' }).hasAttribute('disabled')).toBe(true)
  })

  it('choisie puis enregistrée, elle part seule, puis se relit ; deux clics du même rendu n’écrivent qu’une fois', async () => {
    monter()
    const choix = await screen.findByLabelText<HTMLSelectElement>(/^Nature/)
    fireEvent.change(choix, { target: { value: 'honoraires' } })
    let ouvrir = () => {}
    natureFaux.porte = new Promise<void>((resolve) => { ouvrir = resolve })
    const bouton = screen.getByRole('button', { name: 'Enregistrer la nature' })
    await act(async () => { fireEvent.click(bouton); fireEvent.click(bouton) })
    expect(natureFaux.ecritures).toEqual(['honoraires'])
    expect(screen.getByRole('button', { name: 'Enregistrement…' }).hasAttribute('disabled')).toBe(true)
    natureFaux.porte = null
    await act(async () => { ouvrir() })
    expect(natureFaux.ecritures).toEqual(['honoraires'])
    expect(await screen.findByText(phraseDeLaNature({ etat: 'fixee', libelle: 'Honoraires' }))).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('La nature des recettes du client est enregistrée.')
  })

  it('un refus de la base se dit à ses mots ; aucune ligne rendue se dit aussi', async () => {
    natureFaux.reponse = { ecrite: false, refus: MOTS_DE_LA_CAISSE.nature_hors_produit.gabarit }
    monter()
    fireEvent.change(await screen.findByLabelText(/^Nature/), { target: { value: 'commune' } })
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer la nature' }).click() })
    expect(screen.getByRole('alert').textContent).toBe(`La nature n’a pas été enregistrée : ${MOTS_DE_LA_CAISSE.nature_hors_produit.gabarit}`)
    natureFaux.reponse = { ecrite: false, refus: null }
    fireEvent.change(screen.getByLabelText(/^Nature/), { target: { value: 'honoraires' } })
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer la nature' }).click() })
    expect(screen.getByRole('alert').textContent).toContain('Rien n’a été enregistré')
  })

  it('une nature fixée qui n’est plus une catégorie de produit se voit, et le dit', async () => {
    dossierFaux.nature = { etat: 'lue', categorieId: 'fournitures' }
    monter()
    expect(await screen.findByText(phraseDeLaNature({ etat: 'hors_produit' }))).toBeTruthy()
    const choix = screen.getByLabelText<HTMLSelectElement>(/^Nature/)
    expect(choix.value).toBe('fournitures')
    expect([...choix.options].find((o) => o.value === 'fournitures')?.disabled).toBe(true)
  })

  it('les catégories lues en partie, ou la nature illisible : aucun geste, et le bandeau dit pourquoi', async () => {
    natureFaux.lecture = 'incompletes'
    const { unmount } = monter()
    expect(await screen.findByText(/délai dépassé/)).toBeTruthy()
    expect(screen.queryByLabelText(/^Nature/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enregistrer la nature' })).toBeNull()
    unmount()
    natureFaux.lecture = 'lues'
    dossierFaux.nature = { etat: 'illisible', motif: 'colonne absente' }
    monter()
    expect(await screen.findByText(/colonne absente/)).toBeTruthy()
    expect(screen.queryByLabelText(/^Nature/)).toBeNull()
  })
})

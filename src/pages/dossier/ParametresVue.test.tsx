import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ParametresVue from './ParametresVue'
import { motsDuCabinet } from '../../lib/espaceVentes'
import {
  LIBELLE_ESCOMPTE_PARAMETRES, LIBELLE_ESCOMPTE_PARAMETRES_CLIENT, LIBELLE_MENTIONS_PARAMETRES, LIBELLE_MENTIONS_PARAMETRES_CLIENT,
  LIBELLE_PENALITES_PARAMETRES, LIBELLE_PENALITES_PARAMETRES_CLIENT, LIBELLE_PIED_DE_PAGE_PARAMETRES,
  LIBELLE_PIED_DE_PAGE_PARAMETRES_CLIENT, LIBELLE_TITULAIRE_PARAMETRES, LIBELLE_TITULAIRE_PARAMETRES_CLIENT,
} from '../../lib/droitsAcces'
import { PROPOSITIONS_PAR_DEFAUT } from '../../lib/parametresFacturation'
import { TEXTE_ROMPUE } from '../../lib/parametresFacturationVue'
import type { AccesDuDossier } from '../../lib/auteursVentes'
import { versionParametres } from '../../test/parametresFacturation'
import type { ParametresFacturation } from '../../lib/types'

// « PARAMÈTRES » (espace client, étape A5b1) : la vue montée pour le cabinet et pour le client « Ventes », sous un faux client
// qui APPLIQUE les filtres (src/test/filtresPostgrest.ts) et dont les deux fonctions de la base écrivent la table d'essai.
// Ce que ces cas gardent, et qu'aucun calcul pur ne voit :
//  1. avant la lecture, ni version, ni vide, ni geste ; lue en partie, refusée ou rompue : la vue le dit et n'offre AUCUN geste ;
//  2. sans aucune version : « Renseigner les paramètres », le formulaire prérempli des propositions, rien écrit avant le clic ;
//  3. la courante, son RIB par quatre, son état, le RIB en vigueur d'une courante proposée, l'historique dès deux versions,
//     « par le client » au cabinet seul ;
//  4. « Modifier les paramètres » : la saisie part de la courante, la version remplacée RETENUE, le refus dit avant le clic,
//     « Enregistrer » grisé tant que rien ne diffère, ce que deviendra le RIB dans chaque cas, aucune validation native ;
//  5. « Confirmer le RIB », au cabinet seul : une confirmation qui NOMME le RIB et qui l'a proposé, puis `confirmer_rib` ;
//  6. UN verrou pour les deux gestes (deux clics dans le même `act`, un seul appel), la vue relue après une écriture comme
//     après un refus — une autre saisie passée entre-temps dite ensuite avant le clic ;
//  7. les libellés des textes libres, et les mots du client (tutoiement, aucun mot du cabinet).
// IBAN FICTIFS (le code banque 99999, à clé juste) ; aucune donnée réelle.

const faux = vi.hoisted(() => ({
  versions: [] as Record<string, unknown>[],
  // L'espace de qui appelle : la fonction confirme d'emblée le RIB que le cabinet pose, propose celui du client.
  cabinet: true,
  muetApres: Infinity,
  refusLecture: null as string | null,
  lectures: 0,
  ecritures: [] as string[],
  rpcs: [] as { nom: string; params: Record<string, unknown> }[],
  refus: {} as Record<string, string>,
  // Une version enregistrée par quelqu'un d'autre pendant le refus : la relecture la verra.
  intruse: null as Record<string, unknown> | null,
  retenirLecture: false,
  lecturesEnAttente: [] as (() => void)[],
  retenirRpc: false,
  rpcEnAttente: [] as (() => void)[],
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  const instant = '2027-11-20T10:00:00Z'
  const courante = () => faux.versions.find((v) => !faux.versions.some((s) => s.remplace_id === v.id))
  return {
    supabase: {
      rpc: async (nom: string, params: Record<string, unknown>) => {
        faux.rpcs.push({ nom, params })
        if (faux.retenirRpc) await new Promise<void>((r) => { faux.rpcEnAttente.push(r) })
        const refus = faux.refus[nom]
        if (refus) {
          if (faux.intruse) faux.versions = [...faux.versions, faux.intruse]
          return { data: null, error: { message: refus } }
        }
        if (nom === 'enregistrer_parametres_facturation') {
          const p = params.p_parametres as Record<string, unknown>
          const c = courante()
          const inchange = c != null && p.iban === c.iban && p.bic === c.bic && p.titulaire_compte === c.titulaire_compte
          const etat = p.iban == null ? null : inchange ? c.rib_etat : faux.cabinet ? 'confirme' : 'propose'
          const ecrite = {
            id: `v${faux.versions.length + 1}`, dossier_id: params.p_dossier_id, ...p, rib_etat: etat,
            rib_confirme_par: etat === null ? null : inchange ? c.rib_confirme_par : faux.cabinet ? 'u-moi' : null,
            rib_confirme_le: etat === null ? null : inchange ? c.rib_confirme_le : faux.cabinet ? instant : null,
            remplace_id: params.p_remplace_id, auteur: 'u-moi', cree_le: instant,
          }
          faux.versions = [...faux.versions, ecrite]
          return { data: ecrite, error: null }
        }
        if (nom === 'confirmer_rib') {
          const v = faux.versions.find((x) => x.id === params.p_version_id) as Record<string, unknown>
          const ecrite = { ...v, rib_etat: 'confirme', rib_confirme_par: 'u-moi', rib_confirme_le: instant }
          faux.versions = faux.versions.map((x) => (x.id === v.id ? ecrite : x))
          return { data: ecrite, error: null }
        }
        throw new Error(`Fonction non attendue : ${nom}`)
      },
      from: (table: string) => {
        if (table !== 'parametres_facturation') throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: Predicat[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        let ecriture: string | null = null
        const partir = () => {
          if (ecriture) { faux.ecritures.push(`${table} ${ecriture}`); return { data: null, error: null } }
          faux.lectures += 1
          if (faux.refusLecture) return { data: null, error: { message: faux.refusLecture }, count: null }
          const toutes = filtrer(faux.versions, predicats)
          return { data: toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres)), error: null, count: toutes.length }
        }
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          update: () => { ecriture = 'update'; return c },
          insert: () => { ecriture = 'insert'; return c },
          upsert: () => { ecriture = 'upsert'; return c },
          delete: () => { ecriture = 'delete'; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            if (faux.retenirLecture) {
              return new Promise<void>((r) => { faux.lecturesEnAttente.push(r) }).then(partir).then(suite, echec)
            }
            return Promise.resolve().then(partir).then(suite, echec)
          },
        })
        return c
      },
    },
  }
})

// ── Le jeu d'essai ───────────────────────────────────────────────────────────────────────────────────────────────────
const IBAN_A = 'FR9399999000010000000000100'
const IBAN_B = 'FR1299999000010000000000200'
const IBAN_C = 'FR2899999000010000000000300'

// V1, du cabinet, pose le RIB A et le confirme d'un même geste ; V2, du client, le change en B — proposé ; V3, du cabinet,
// change le délai sans toucher au RIB : B reste proposé, A reste en vigueur.
const V1 = versionParametres({
  id: 'v1', iban: IBAN_A, bic: 'ESSAFR10', titulaire_compte: 'Atelier fictif', rib_etat: 'confirme',
  rib_confirme_par: 'u-cabinet', rib_confirme_le: '2027-10-01T09:00:00Z', auteur: 'u-cabinet', cree_le: '2027-10-01T09:00:00Z',
})
const V2 = versionParametres({
  id: 'v2', remplace_id: 'v1', iban: IBAN_B, titulaire_compte: 'Atelier fictif', rib_etat: 'propose', auteur: 'u-client',
  cree_le: '2027-10-02T09:00:00Z',
})
const V3 = versionParametres({
  id: 'v3', remplace_id: 'v2', delai_paiement_jours: 45, iban: IBAN_B, titulaire_compte: 'Atelier fictif', rib_etat: 'propose',
  auteur: 'u-cabinet', cree_le: '2027-10-03T09:00:00Z', escompte: 'Pas d’escompte.',
})
const AUTRE = versionParametres({ id: 'x1', dossier_id: 'd2', iban: IBAN_C, rib_etat: 'confirme' })
const nues = (lignes: readonly ParametresFacturation[]): Record<string, unknown>[] => lignes.map((l) => ({ ...l }))

const ACCES_LUS: AccesDuDossier = { etat: 'lus', comptes: ['u-client'] }
const lisible = (t: string | null) => (t ?? '').replace(/[  ]/g, ' ')

type Espace = 'cabinet' | 'client'
const arbre = (espace: Espace, acces: AccesDuDossier = ACCES_LUS) => (espace === 'client'
  ? <ParametresVue espace="client" dossierId="d1" />
  : <ParametresVue espace="cabinet" acces={acces} dossierId="d1" />)

function monter(espace: Espace, acces?: AccesDuDossier) {
  faux.cabinet = espace === 'cabinet'
  render(arbre(espace, acces))
}

const bouton = (nom: string | RegExp) => screen.getByRole('button', { name: nom }) as HTMLButtonElement
const fenetre = () => screen.getByRole('dialog')
const champ = (libelle: string | RegExp) => within(fenetre()).getByLabelText(libelle) as HTMLInputElement
const saisir = (libelle: string | RegExp, valeur: string) => fireEvent.change(champ(libelle), { target: { value: valeur } })
const enregistrer = () => within(fenetre()).getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement
const liberer = async () => {
  await act(async () => { faux.retenirRpc = false; for (const r of faux.rpcEnAttente.splice(0)) r() })
}
// La carte de la courante (l'historique redit les mêmes états, ligne par ligne).
const carte = () => within(screen.getByText('Paramètres en cours').closest('.card') as HTMLElement)
const GESTES = ['Modifier les paramètres', 'Renseigner les paramètres', 'Confirmer le RIB']

beforeEach(() => {
  faux.versions = nues([V1, V2, V3, AUTRE])
  faux.cabinet = true
  faux.muetApres = Infinity
  faux.refusLecture = null
  faux.lectures = 0
  faux.ecritures = []
  faux.rpcs = []
  faux.refus = {}
  faux.intruse = null
  faux.retenirLecture = false
  faux.lecturesEnAttente = []
  faux.retenirRpc = false
  faux.rpcEnAttente = []
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe.each(['cabinet', 'client'] as const)('Paramètres — avant et après la lecture (%s)', (espace) => {
  it('avant sa lecture : « Chargement… », ni version, ni vide, ni geste ; revenue, la courante', async () => {
    faux.retenirLecture = true
    monter(espace)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByText(/aucun/i)).toBeNull()
    expect(screen.queryByText(/ne lit ni n’imprime/)).toBeNull()
    for (const nom of GESTES) expect(screen.queryByRole('button', { name: nom })).toBeNull()
    await act(async () => { faux.retenirLecture = false; for (const r of faux.lecturesEnAttente.splice(0)) r() })
    expect(await screen.findByText('Paramètres en cours')).toBeTruthy()
    expect(screen.queryByText('Chargement…')).toBeNull()
  })

  it('lue en partie : le bandeau, AUCUN geste, ni courante ni « aucun »', async () => {
    faux.muetApres = 2
    monter(espace)
    expect(await screen.findByText(/n'ont pas pu être (lus|affichés) en entier/)).toBeTruthy()
    for (const nom of GESTES) expect(screen.queryByRole('button', { name: nom })).toBeNull()
    expect(screen.queryByText('Paramètres en cours')).toBeNull()
    expect(screen.queryByText(/^Aucun paramètre|^Tu n’as encore/)).toBeNull()
    expect(screen.queryByRole('table', { name: 'Historique des paramètres' })).toBeNull()
  })

  it('refusée : le bandeau, AUCUN geste', async () => {
    faux.refusLecture = 'permission denied'
    monter(espace)
    expect(await screen.findByText(/n'ont pas pu être (lus|affichés) en entier/)).toBeTruthy()
    for (const nom of GESTES) expect(screen.queryByRole('button', { name: nom })).toBeNull()
  })

  it('rompue : la vue le dit, rien d’autre — ni courante, ni historique, ni geste', async () => {
    faux.versions = nues([V2, V3])
    monter(espace)
    expect(await screen.findByText(TEXTE_ROMPUE)).toBeTruthy()
    for (const nom of GESTES) expect(screen.queryByRole('button', { name: nom })).toBeNull()
    expect(screen.queryByText('Paramètres en cours')).toBeNull()
    expect(screen.queryByRole('table', { name: 'Historique des paramètres' })).toBeNull()
  })

  // Depuis l'étape A7b (`MENTIONS_FIGEES_EXPORTEES`, levé) : la facture fige ces paramètres à sa validation et les imprime. L'état
  // d'avant se joue dans parametresFacturationVue.test.ts.
  it('la phrase d’en-tête : une facture fige ces paramètres à sa validation, et les imprime', async () => {
    monter(espace)
    expect(await screen.findByText(/ces paramètres à (sa|leur) validation — ceux en vigueur ce jour-là, le RIB confirmé seulement/)).toBeTruthy()
  })
})

describe('Paramètres — sans aucune version', () => {
  beforeEach(() => { faux.versions = nues([AUTRE]) })

  it('au cabinet : le vide dit, « Renseigner les paramètres » prérempli des propositions, rien d’écrit avant le clic', async () => {
    monter('cabinet')
    expect(await screen.findByText('Aucun paramètre de facturation n’est enregistré pour ce dossier.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Modifier les paramètres' })).toBeNull()
    fireEvent.click(bouton('Renseigner les paramètres'))
    expect(within(fenetre()).getByRole('heading', { name: 'Renseigner les paramètres' })).toBeTruthy()
    expect(within(fenetre()).getByText(/sont des propositions/)).toBeTruthy()
    expect(champ(/^Délai de paiement/).value).toBe('30')
    expect(champ(LIBELLE_ESCOMPTE_PARAMETRES).value).toBe(PROPOSITIONS_PAR_DEFAUT.escompte)
    expect(champ(LIBELLE_PENALITES_PARAMETRES).value).toBe(PROPOSITIONS_PAR_DEFAUT.penalites)
    expect(champ('IBAN').value).toBe('')
    expect(faux.rpcs).toEqual([])
    expect(enregistrer().disabled).toBe(false)
    const avant = faux.lectures
    await act(async () => { fireEvent.click(enregistrer()) })
    expect(faux.rpcs).toEqual([{
      nom: 'enregistrer_parametres_facturation',
      params: {
        p_dossier_id: 'd1', p_remplace_id: null,
        p_parametres: {
          delai_paiement_jours: 30, moyen_prefere: null, escompte: PROPOSITIONS_PAR_DEFAUT.escompte, penalites: PROPOSITIONS_PAR_DEFAUT.penalites,
          mentions_complementaires: null, pied_de_page: null, iban: null, bic: null, titulaire_compte: null,
        },
      },
    }])
    expect(faux.lectures).toBe(avant + 1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText('Paramètres en cours')).toBeTruthy()
    expect(faux.ecritures).toEqual([])
  })

  it('au client : le vide dit à lui, et les propositions aussi', async () => {
    monter('client')
    expect(await screen.findByText('Tu n’as encore enregistré aucun paramètre de facturation.')).toBeTruthy()
    fireEvent.click(bouton('Renseigner les paramètres'))
    expect(within(fenetre()).getByText(/garde-les, change-les ou vide-les/)).toBeTruthy()
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
  })

  it('tout vidé : rien à enregistrer, « Enregistrer » grisé et dit pourquoi', async () => {
    monter('cabinet')
    fireEvent.click(await screen.findByRole('button', { name: 'Renseigner les paramètres' }))
    for (const l of [/^Délai de paiement/, LIBELLE_ESCOMPTE_PARAMETRES, LIBELLE_PENALITES_PARAMETRES]) saisir(l, '')
    expect(enregistrer().disabled).toBe(true)
    expect(enregistrer().title).toBe('Rien n’est saisi.')
  })
})

describe('Paramètres — la courante et son RIB', () => {
  it('au cabinet : les conditions, le RIB par quatre, son état « par le client », le RIB en vigueur, « Confirmer le RIB »', async () => {
    monter('cabinet')
    await screen.findByText('Paramètres en cours')
    const conditions = screen.getByLabelText('Conditions')
    expect(lisible(conditions.textContent)).toContain('Délai de paiement45 jours')
    expect(within(conditions).getByText('Pas d’escompte.')).toBeTruthy()
    expect(within(conditions).getAllByText('Non renseigné').length).toBe(3)
    expect(within(screen.getByLabelText('RIB')).getByText('FR12 9999 9000 0100 0000 0000 200')).toBeTruthy()
    expect(screen.getByText('Proposé')).toBeTruthy()
    expect(carte().getByText('Proposé par le client le 02/10/2027 à 11:00 : en attente de votre confirmation.')).toBeTruthy()
    expect(screen.getByText(/^Le RIB confirmé d’avant reste en vigueur/)).toBeTruthy()
    expect(within(screen.getByLabelText('RIB en vigueur')).getByText('FR93 9999 9000 0100 0000 0000 100')).toBeTruthy()
    expect(bouton('Confirmer le RIB').disabled).toBe(false)
  })

  it('au client : son RIB proposé attend la confirmation de son cabinet, et « Confirmer le RIB » n’existe pas', async () => {
    monter('client')
    await screen.findByText('Paramètres en cours')
    expect(carte().getByText('Proposé le 02/10/2027 à 11:00 : en attente de la confirmation de ton cabinet.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Confirmer le RIB' })).toBeNull()
    expect(screen.queryByText('par le client')).toBeNull()
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
  })

  it('un RIB confirmé : ni « Confirmer le RIB », ni RIB en vigueur à part', async () => {
    faux.versions = nues([V1])
    monter('cabinet')
    expect(await screen.findByText('Posé et confirmé d’un même geste le 01/10/2027 à 11:00.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Confirmer le RIB' })).toBeNull()
    expect(screen.queryByLabelText('RIB en vigueur')).toBeNull()
  })

  it('l’historique dès deux versions, la courante d’abord, ses changements et « par le client » sur des accès lus en entier', async () => {
    monter('cabinet')
    const table = await screen.findByRole('table', { name: 'Historique des paramètres' })
    const rangs = within(table).getAllByRole('row').slice(1)
    expect(rangs.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['Courante', 'Remplacée', 'Remplacée'])
    expect(rangs[0].textContent).toContain('Délai de paiement ; Conditions d’escompte')
    expect(rangs[1].textContent).toContain('RIB changé (IBAN, BIC)')
    expect(within(rangs[1]).getByText('par le client')).toBeTruthy()
    expect(rangs[2].textContent).toContain('Première version')
    expect(within(rangs[0]).queryByText('par le client')).toBeNull()
  })

  it('les accès pas encore lus : « par le client » ne se dit de personne', async () => {
    monter('cabinet', { etat: 'en_cours' })
    await screen.findByRole('table', { name: 'Historique des paramètres' })
    expect(screen.queryByText('par le client')).toBeNull()
    expect(carte().getByText('Proposé le 02/10/2027 à 11:00 : en attente de votre confirmation.')).toBeTruthy()
  })

  it('une seule version : pas d’historique', async () => {
    faux.versions = nues([V1])
    monter('cabinet')
    await screen.findByText('Paramètres en cours')
    expect(screen.queryByRole('table', { name: 'Historique des paramètres' })).toBeNull()
  })
})

describe.each(['cabinet', 'client'] as const)('Paramètres — « Modifier les paramètres » (%s)', (espace) => {
  const L = espace === 'client'
    ? { escompte: LIBELLE_ESCOMPTE_PARAMETRES_CLIENT, penalites: LIBELLE_PENALITES_PARAMETRES_CLIENT, mentions: LIBELLE_MENTIONS_PARAMETRES_CLIENT,
      pied: LIBELLE_PIED_DE_PAGE_PARAMETRES_CLIENT, titulaire: LIBELLE_TITULAIRE_PARAMETRES_CLIENT }
    : { escompte: LIBELLE_ESCOMPTE_PARAMETRES, penalites: LIBELLE_PENALITES_PARAMETRES, mentions: LIBELLE_MENTIONS_PARAMETRES,
      pied: LIBELLE_PIED_DE_PAGE_PARAMETRES, titulaire: LIBELLE_TITULAIRE_PARAMETRES }

  async function ouvrir() {
    monter(espace)
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier les paramètres' }))
  }

  it('la saisie part de la courante, tous ses champs, sous les libellés de l’espace ; aucune validation native', async () => {
    await ouvrir()
    expect(within(fenetre()).getByRole('heading', { name: 'Modifier les paramètres' })).toBeTruthy()
    expect(within(fenetre()).queryByText(/sont des propositions/)).toBeNull()
    expect(champ(/^Délai de paiement/).value).toBe('45')
    expect((within(fenetre()).getByLabelText('Moyen de paiement proposé') as HTMLSelectElement).value).toBe('virement')
    expect(champ(L.escompte).value).toBe('Pas d’escompte.')
    for (const l of [L.penalites, L.mentions, L.pied]) expect(champ(l).value).toBe('')
    expect(champ('IBAN').value).toBe('FR12 9999 9000 0100 0000 0000 200')
    expect(champ('BIC').value).toBe('')
    expect(champ(L.titulaire).value).toBe('Atelier fictif')
    for (const el of fenetre().querySelectorAll('input, textarea, select')) {
      expect(el.hasAttribute('required')).toBe(false)
      expect(el.hasAttribute('pattern')).toBe(false)
      expect(el.getAttribute('type') ?? 'text').toBe('text')
    }
    expect(fenetre().closest('form')).toBeNull()
    if (espace === 'client') expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
  })

  it('« Enregistrer » grisé tant que rien ne diffère (des blancs ne sont pas un changement), puis offert', async () => {
    await ouvrir()
    expect(enregistrer().disabled).toBe(true)
    expect(enregistrer().title).toBe('Rien ne diffère de la version en cours.')
    saisir(L.titulaire, '  Atelier fictif  ')
    expect(enregistrer().disabled).toBe(true)
    saisir(/^Délai de paiement/, '10')
    expect(enregistrer().disabled).toBe(false)
  })

  it('le refus du module, dit avant le clic, grise « Enregistrer » ; rien ne part', async () => {
    await ouvrir()
    saisir(/^Délai de paiement/, '61')
    expect(within(fenetre()).getByText('Le délai de paiement est un nombre entier de jours, de 0 à 60.')).toBeTruthy()
    expect(enregistrer().disabled).toBe(true)
    saisir(/^Délai de paiement/, '30')
    saisir('IBAN', 'FR00 9999 9000 0100 0000 0000 100')
    expect(within(fenetre()).getByText('L\'IBAN ne passe pas sa clé de contrôle : une erreur de saisie, sans doute.')).toBeTruthy()
    expect(enregistrer().disabled).toBe(true)
    // Sous un refus, rien n'est dit de ce que deviendrait le RIB.
    expect(within(fenetre()).queryByText(/^Le RIB /)).toBeNull()
    fireEvent.click(enregistrer())
    expect(faux.rpcs).toEqual([])
  })

  // A7-Q3 (29/10/2026) : un texte libre qui porte un IBAN valide se refuse avant le clic, sur la saisie telle qu'elle part
  // (le neuvième rang d'`enregistrer_parametres_facturation`, migration `iban_hors_des_parametres`).
  it('un IBAN dans un texte libre : refusé avant le clic, sous ses mots, « Enregistrer » grisé ; une clé fausse passe', async () => {
    await ouvrir()
    const refus = (texte: string) => `Un IBAN figure dans ${texte} : sur une facture, un IBAN ne s'imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.`
    saisir(L.pied, '  Règlement sur fr13 9999 9000 0200 0000 0001 234  ')
    expect(within(fenetre()).getByText(refus('le pied de page'))).toBeTruthy()
    expect(enregistrer().disabled).toBe(true)
    if (espace === 'client') expect(motsDuCabinet(fenetre().textContent ?? '')).toEqual([])
    fireEvent.click(enregistrer())
    expect(faux.rpcs).toEqual([])
    // Une clé fausse ne se lit pas : la saisie part.
    saisir(L.pied, 'Règlement sur FR14 9999 9000 0200 0000 0001 234')
    expect(within(fenetre()).queryByText(refus('le pied de page'))).toBeNull()
    expect(enregistrer().disabled).toBe(false)
    // Dans l'ordre de la base : l'escompte avant le pied de page ; chaque texte nommé.
    saisir(L.escompte, 'Escompte versé sur FR1399999000020000000001234')
    saisir(L.pied, 'FR13 9999 9000 0200 0000 0001 234')
    expect(within(fenetre()).getByText(refus("les conditions d'escompte"))).toBeTruthy()
    saisir(L.escompte, 'Pas d’escompte.')
    saisir(L.penalites, 'Pénalités : FR1399999000020000000001234')
    expect(within(fenetre()).getByText(refus('les pénalités de retard'))).toBeTruthy()
    saisir(L.penalites, '')
    saisir(L.mentions, 'Coordonnées : FR13 9999 9000 0200 0000 0001 234')
    expect(within(fenetre()).getByText(refus('les mentions complémentaires'))).toBeTruthy()
    expect(enregistrer().disabled).toBe(true)
  })

  it('l’enregistrement : la version RETENUE à l’ouverture, la saisie telle qu’elle part, puis la vue relue', async () => {
    await ouvrir()
    saisir(/^Délai de paiement/, ' 10 ')
    saisir('IBAN', 'fr28 9999 9000 0100 0000 0000 300')
    saisir('BIC', 'essa fr10')
    const avant = faux.lectures
    await act(async () => { fireEvent.click(enregistrer()) })
    expect(faux.rpcs).toHaveLength(1)
    expect(faux.rpcs[0]).toEqual({
      nom: 'enregistrer_parametres_facturation',
      params: {
        p_dossier_id: 'd1', p_remplace_id: 'v3',
        p_parametres: {
          delai_paiement_jours: 10, moyen_prefere: 'virement', escompte: 'Pas d’escompte.', penalites: null, mentions_complementaires: null,
          pied_de_page: null, iban: IBAN_C, bic: 'ESSAFR10', titulaire_compte: 'Atelier fictif',
        },
      },
    })
    expect(faux.lectures).toBe(avant + 1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText('Paramètres enregistrés le 20/11/2027 à 11:00.')).toBeTruthy()
    expect(within(screen.getByLabelText('RIB')).getByText('FR28 9999 9000 0100 0000 0000 300')).toBeTruthy()
    expect(faux.ecritures).toEqual([])
  })

  it('deux clics du même rendu : un seul appel ; le verrou relâché après la relecture', async () => {
    await ouvrir()
    saisir(/^Délai de paiement/, '12')
    faux.retenirRpc = true
    act(() => {
      fireEvent.click(enregistrer())
      fireEvent.click(enregistrer())
      fireEvent.click(enregistrer())
    })
    expect(faux.rpcs).toHaveLength(1)
    expect(within(fenetre()).getByRole('button', { name: 'Enregistrement…' })).toBeTruthy()
    await liberer()
    expect(await screen.findByText(/^Paramètres enregistrés le/)).toBeTruthy()
    expect(faux.rpcs).toHaveLength(1)
  })

  it('un refus de la base : dit dans la fenêtre, qui reste ouverte ; la vue relue — une autre saisie passée entre-temps se dit ensuite avant le clic', async () => {
    await ouvrir()
    saisir(/^Délai de paiement/, '12')
    faux.refus.enregistrer_parametres_facturation =
      "D'autres paramètres de facturation ont été enregistrés entre-temps (le 04/10/2027 à 11:00) : relire avant d'enregistrer."
    faux.intruse = { ...versionParametres({ id: 'v4', remplace_id: 'v3', iban: IBAN_B, rib_etat: 'propose', auteur: 'u-autre', cree_le: '2027-10-04T09:00:00Z' }) }
    const avant = faux.lectures
    await act(async () => { fireEvent.click(enregistrer()) })
    expect(faux.lectures).toBe(avant + 1)
    expect(within(fenetre()).getByRole('alert').textContent).toContain('entre-temps (le 04/10/2027 à 11:00)')
    // La version remplacée reste celle de l'ouverture : le module dit le refus avant le clic, sous ses mots.
    saisir(/^Délai de paiement/, '13')
    expect(within(fenetre()).getByText("D'autres paramètres de facturation ont été enregistrés entre-temps (le 04/10/2027 à 11:00) : relire avant d'enregistrer.")).toBeTruthy()
    expect(enregistrer().disabled).toBe(true)
  })
})

describe('Paramètres — ce que deviendra le RIB, dit avant le clic', () => {
  async function ouvrir(espace: Espace, versions: ParametresFacturation[] = [V1]) {
    faux.versions = nues(versions)
    monter(espace)
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier les paramètres' }))
  }

  it('changé par le cabinet : confirmé d’emblée, en son nom', async () => {
    await ouvrir('cabinet')
    saisir('IBAN', IBAN_B)
    expect(within(fenetre()).getByText('Le RIB change : il sera confirmé d’emblée, en votre nom.')).toBeTruthy()
  })

  it('le cabinet qui retouche le BIC d’un RIB proposé en garde l’IBAN : la fenêtre dit qu’il le confirmerait, et le conseil', async () => {
    await ouvrir('cabinet', [V1, V2, V3])
    saisir('BIC', 'ESSAFR10')
    const note = within(fenetre()).getByText(/^Le RIB change, mais garde l’IBAN proposé, que vous n’avez pas confirmé/)
    expect(note.textContent).toContain('par un autre moyen que l’application')
  })

  it('changé par le client : seulement proposé jusqu’à la confirmation de son cabinet', async () => {
    await ouvrir('client')
    saisir('IBAN', IBAN_B)
    expect(within(fenetre()).getByText('Le RIB change : il ne sera que proposé, jusqu’à la confirmation de ton cabinet.')).toBeTruthy()
  })

  it('vidé par le client : retiré tout de suite (A5-Q5)', async () => {
    await ouvrir('client')
    saisir('IBAN', '')
    saisir('BIC', '')
    saisir(LIBELLE_TITULAIRE_PARAMETRES_CLIENT, '')
    expect(within(fenetre()).getByText('Tu vides le RIB : il est retiré dès l’enregistrement, sans attendre ton cabinet.')).toBeTruthy()
  })

  it('inchangé : son état gardé — proposé, le cabinet qui réenregistre ne le confirme pas (A5-Q4)', async () => {
    await ouvrir('cabinet', [V1, V2, V3])
    saisir(/^Délai de paiement/, '20')
    expect(within(fenetre()).getByText('Le RIB ne change pas : il reste seulement proposé — enregistrer ne le confirme pas, « Confirmer le RIB » le fait.')).toBeTruthy()
  })

  it('inchangé et confirmé : il reste confirmé', async () => {
    await ouvrir('client')
    saisir(/^Délai de paiement/, '20')
    expect(within(fenetre()).getByText('Le RIB ne change pas : il reste confirmé.')).toBeTruthy()
  })
})

describe('Paramètres — « Confirmer le RIB »', () => {
  async function proposer() {
    monter('cabinet')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmer le RIB' }))
    return screen.getByRole('alertdialog')
  }

  it('la confirmation, dans la page, NOMME le RIB, qui l’a proposé et quand, ce qu’elle fait, et conseille de le vérifier ailleurs', async () => {
    const dialogue = await proposer()
    expect(within(dialogue).getByText('FR12 9999 9000 0100 0000 0000 200')).toBeTruthy()
    expect(within(dialogue).getByText('Atelier fictif')).toBeTruthy()
    expect(within(dialogue).getByText('Non renseigné')).toBeTruthy()
    expect(within(dialogue).getByText('Proposé par le client le 02/10/2027 à 11:00.')).toBeTruthy()
    expect(within(dialogue).getByText(/quand elles porteront un RIB/)).toBeTruthy()
    expect(within(dialogue).getByText(/par un autre moyen que l’application/)).toBeTruthy()
    expect(faux.rpcs).toEqual([])
    fireEvent.click(within(dialogue).getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(faux.rpcs).toEqual([])
  })

  it('confirmer : `confirmer_rib` seule, sur la version proposée, puis la vue relue dit le RIB confirmé', async () => {
    const dialogue = await proposer()
    const avant = faux.lectures
    await act(async () => { fireEvent.click(within(dialogue).getByRole('button', { name: 'Confirmer le RIB' })) })
    expect(faux.rpcs).toEqual([{ nom: 'confirmer_rib', params: { p_dossier_id: 'd1', p_version_id: 'v3' } }])
    expect(faux.lectures).toBe(avant + 1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(await screen.findByText('RIB confirmé.')).toBeTruthy()
    expect(carte().getByText('Posé par le client le 02/10/2027 à 11:00, confirmé le 20/11/2027 à 11:00.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Confirmer le RIB' })).toBeNull()
  })

  it('deux clics du même rendu : un seul appel', async () => {
    const dialogue = await proposer()
    faux.retenirRpc = true
    const confirmer = within(dialogue).getByRole('button', { name: 'Confirmer le RIB' })
    act(() => {
      fireEvent.click(confirmer)
      fireEvent.click(confirmer)
      fireEvent.click(confirmer)
    })
    expect(faux.rpcs).toHaveLength(1)
    await liberer()
    expect(await screen.findByText('RIB confirmé.')).toBeTruthy()
    expect(faux.rpcs).toHaveLength(1)
  })

  it('un refus de la base : dit dans la confirmation, la vue relue ; une autre saisie passée entre-temps grise le bouton', async () => {
    const dialogue = await proposer()
    faux.refus.confirmer_rib =
      "D'autres paramètres de facturation ont été enregistrés entre-temps (le 04/10/2027 à 11:00) : relire avant de confirmer le RIB."
    faux.intruse = { ...versionParametres({ id: 'v4', remplace_id: 'v3', iban: IBAN_B, rib_etat: 'propose', auteur: 'u-autre', cree_le: '2027-10-04T09:00:00Z' }) }
    const avant = faux.lectures
    await act(async () => { fireEvent.click(within(dialogue).getByRole('button', { name: 'Confirmer le RIB' })) })
    expect(faux.lectures).toBe(avant + 1)
    const ouvert = screen.getByRole('alertdialog')
    expect(within(ouvert).getByRole('alert').textContent).toContain('relire avant de confirmer le RIB')
    expect((within(ouvert).getByRole('button', { name: 'Confirmer le RIB' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

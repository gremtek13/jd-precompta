import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdresseReceptionModal from './AdresseReceptionModal'
import { motsDuCabinet } from '../../lib/espaceVentes'
import { LIBELLE_PLATEFORME_ADRESSE, LIBELLE_PLATEFORME_ADRESSE_CLIENT } from '../../lib/droitsAcces'
import { CE_QUE_ETABLIT, LIEN_PORTAIL_ANNUAIRE } from '../../lib/adressesReceptionVue'
import { adresse, SIREN_FICTIF, SIRET_FICTIF } from '../../test/adressesReception'
import type { AdresseReception } from '../../lib/types'

// « ADRESSE DE RÉCEPTION » (espace client, étape A6b1) : la fenêtre montée pour le cabinet et pour le client « Ventes », sous un
// faux client qui APPLIQUE les filtres (src/test/filtresPostgrest.ts) et dont `declarer_adresse_reception` écrit la table
// d'essai. Ce que ces cas gardent, et qu'aucun calcul pur ne voit :
//  1. avant la lecture, ni « aucune », ni tableau, ni geste, ni lien ; lue vide en entier, elle le dit ; lue en partie, refusée,
//     rompue, ou son SIRET illisible : le message et AUCUN geste ;
//  2. l'adresse courante dite en entier — « à venir », « non vérifiée », ce que chaque source établit —, son historique, et
//     « par le client » au cabinet seul, jamais sur des accès lus en partie ni pas encore revenus ;
//  3. le formulaire : le refus de la base dit avant le clic et le bouton grisé, la maille proposée quand l'identifiant n'en
//     admet qu'une et JAMAIS choisie quand il en admet deux, le jour de vérification remis à zéro ;
//  4. l'écriture : ce que la base reçoit, UN verrou (deux puis trois clics du même rendu), relâché après la relecture ;
//     la liste relue après une écriture comme après un refus, le refus dit sous les mots de la base ;
//  5. les mots du client (tutoiement, aucun mot du cabinet), éprouvés sur les mêmes états montés pour le cabinet ;
//  6. le lien du portail : un lien, rien ne part au chargement ni sur le clic.
// Données FICTIVES.

const faux = vi.hoisted(() => ({
  adresses: [] as Record<string, unknown>[],
  dossiers: [] as Record<string, unknown>[],
  memberships: [] as Record<string, unknown>[],
  muetApres: Infinity,
  refus: {} as Record<string, string>,
  leve: {} as Record<string, boolean>,
  lectures: [] as string[],
  ecritures: [] as string[],
  rpcs: [] as { nom: string; params: Record<string, unknown> }[],
  refusRpc: null as string | null,
  avantRpc: null as (() => void) | null,
  retenirLecture: false,
  retenirTables: [] as string[],
  reponseRpc: undefined as unknown,
  lecturesEnAttente: [] as (() => void)[],
  retenirRpc: false,
  rpcEnAttente: [] as (() => void)[],
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  return {
    supabase: {
      rpc: async (nom: string, params: Record<string, unknown>) => {
        faux.rpcs.push({ nom, params })
        faux.avantRpc?.()
        if (faux.retenirRpc) await new Promise<void>((r) => { faux.rpcEnAttente.push(r) })
        if (faux.refusRpc) return { data: null, error: { message: faux.refusRpc } }
        if (faux.reponseRpc !== undefined) return { data: faux.reponseRpc, error: null }
        const ecrite = {
          id: `neuve-${faux.adresses.length + 1}`, dossier_id: params.p_dossier_id, forme: params.p_forme, identifiant: params.p_identifiant,
          plateforme: params.p_plateforme, prise_effet: params.p_prise_effet, verification: params.p_verification,
          verifiee_le: params.p_verifiee_le, remplace_id: params.p_remplace_id, auteur: 'u-moi', cree_le: '2026-10-14T10:00:00Z',
        }
        faux.adresses.push(ecrite)
        return { data: ecrite, error: null }
      },
      from: (table: string) => {
        if (!['adresses_reception', 'dossiers', 'memberships'].includes(table)) throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: Predicat[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        let unique = false
        let ecriture: string | null = null
        const source = () => (table === 'dossiers' ? faux.dossiers : table === 'memberships' ? faux.memberships : faux.adresses)
        const partir = () => {
          if (ecriture) { faux.ecritures.push(`${table} ${ecriture}`); return { data: null, error: null } }
          faux.lectures.push(table)
          if (faux.leve[table]) throw new Error('réseau coupé')
          if (faux.refus[table]) return { data: null, error: { message: faux.refus[table] }, count: null }
          const toutes = filtrer(source(), predicats)
          if (unique) return { data: toutes[0] ?? null, error: null }
          const limite = table === 'adresses_reception' ? faux.muetApres : Infinity
          return { data: toutes.slice(debut, Math.min(fin + 1, toutes.length, limite)), error: null, count: toutes.length }
        }
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          maybeSingle: () => { unique = true; return c },
          update: () => { ecriture = 'update'; return c },
          delete: () => { ecriture = 'delete'; return c },
          insert: () => { ecriture = 'insert'; return c },
          upsert: () => { ecriture = 'upsert'; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            if (faux.retenirLecture || faux.retenirTables.includes(table)) {
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
const nues = (lignes: readonly AdresseReception[]): Record<string, unknown>[] => lignes.map((l) => ({ ...l }))

const V1 = adresse({ id: 'a1', cree_le: '2026-09-01T08:00:00Z', auteur: 'u-cabinet' })
const V2 = adresse({
  id: 'a2', remplace_id: 'a1', forme: 'siren_siret', identifiant: `${SIREN_FICTIF}_${SIRET_FICTIF}`, plateforme: 'Autre plateforme fictive',
  prise_effet: '2026-09-15', verification: 'portail_annuaire', verifiee_le: '2026-09-14', auteur: 'u-client', cree_le: '2026-09-16T08:00:00Z',
})
const V3 = adresse({
  id: 'a3', remplace_id: 'a2', forme: 'siren_suffixe', identifiant: `${SIREN_FICTIF}_COMPTA`, plateforme: 'Plateforme fictive',
  prise_effet: '2026-10-01', verification: 'plateforme', verifiee_le: '2026-10-02', auteur: 'u-cabinet', cree_le: '2026-10-03T08:00:00Z',
})
const AUTRE_DOSSIER = adresse({ id: 'x9', dossier_id: 'd2', identifiant: '999999999' })

const lisible = (t: string | null) => (t ?? '').replace(/[  ]/g, ' ')

type Espace = 'cabinet' | 'client'
async function monter(espace: Espace) {
  const onClose = vi.fn()
  const rendu = render(<AdresseReceptionModal espace={espace} dossierId="d1" onClose={onClose} />)
  await waitFor(() => expect(screen.queryByText('Chargement…')).toBeNull())
  return { ...rendu, onClose }
}

const bouton = (nom: string | RegExp) => screen.getByRole('button', { name: nom }) as HTMLButtonElement
const boutons = () => screen.queryAllByRole('button').map((b) => b.textContent ?? '')
const texte = () => lisible(document.body.textContent)
const champ = (libelle: string | RegExp) => screen.getByLabelText(libelle) as HTMLInputElement
const saisir = (libelle: string | RegExp, valeur: string) => fireEvent.change(champ(libelle), { target: { value: valeur } })

// Une saisie complète et acceptée : le SIREN du dossier, une plateforme, une prise d'effet passée, vérifiée sur le portail.
function remplirTout(plateformeLibelle: string | RegExp) {
  saisir('Identifiant d’adressage', SIREN_FICTIF)
  saisir(plateformeLibelle, 'Plateforme fictive')
  saisir('Date de prise d’effet', '2026-09-01')
  fireEvent.click(screen.getByRole('radio', { name: /Vérifiée sur le portail/ }))
  saisir('Jour de la vérification', '2026-10-01')
}

beforeEach(() => {
  // Le jour de Paris : le 14/10/2026 — « à venir », la vérification qui ne se date pas du futur.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T10:00:00Z'))
  faux.adresses = []
  faux.dossiers = [{ id: 'd1', siret: SIRET_FICTIF }, { id: 'd2', siret: null }]
  faux.memberships = [{ id: 'm1', dossier_id: 'd1', user_id: 'u-client' }]
  faux.muetApres = Infinity
  faux.refus = {}
  faux.leve = {}
  faux.lectures = []
  faux.ecritures = []
  faux.rpcs = []
  faux.refusRpc = null
  faux.avantRpc = null
  faux.retenirLecture = false
  faux.retenirTables = []
  faux.reponseRpc = undefined
  faux.lecturesEnAttente = []
  faux.retenirRpc = false
  faux.rpcEnAttente = []
})
afterEach(() => { vi.useRealTimers() })

describe('rien avant la lecture', () => {
  it.each<Espace>(['cabinet', 'client'])('%s : « Chargement… », ni adresse ni vide ni tableau ni geste ni lien ; revenue, tout paraît', async (espace) => {
    faux.adresses = nues([V1])
    faux.retenirLecture = true
    render(<AdresseReceptionModal espace={espace} dossierId="d1" onClose={() => {}} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(boutons()).toEqual(['Fermer'])
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(texte()).not.toMatch(/\b(aucune?|rien)\b/i)
    expect(texte()).not.toContain(SIREN_FICTIF)
    faux.retenirLecture = false
    await act(async () => { faux.lecturesEnAttente.splice(0).forEach((r) => r()) })
    expect(await screen.findByText('Adresse courante')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Vérifier sur l’annuaire' })).toBeTruthy()
  })

  it('changer de dossier repart en chargement : la réponse du dossier quitté ne s’affiche pas', async () => {
    faux.adresses = nues([V1, AUTRE_DOSSIER])
    const { rerender } = await monter('cabinet')
    expect(texte()).toContain(SIREN_FICTIF)
    faux.retenirLecture = true
    rerender(<AdresseReceptionModal espace="cabinet" dossierId="d2" onClose={() => {}} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(texte()).not.toContain(SIREN_FICTIF)
    expect(texte()).not.toContain('999999999')
  })
})

describe('une lecture qui n’est pas entière n’offre aucun geste', () => {
  it('lue en partie : le bandeau et son motif au cabinet, ni « aucune », ni « Déclarer »', async () => {
    faux.adresses = nues([V1, V2])
    faux.muetApres = 1
    await monter('cabinet')
    expect(texte()).toContain('1 ligne(s) lue(s) sur 2 annoncée(s)')
    expect(texte()).toContain('Aucun geste n’est donc offert')
    expect(boutons().filter((b) => /Déclarer/.test(b))).toEqual([])
    expect(texte()).not.toContain('Aucune adresse de réception n’est déclarée')
    expect(screen.queryByText('Courante')).toBeNull()
  })

  it('lue en partie chez le client : le motif technique n’est qu’en infobulle', async () => {
    faux.adresses = nues([V1, V2])
    faux.muetApres = 1
    await monter('client')
    expect(texte()).not.toContain('1 ligne(s) lue(s) sur 2 annoncée(s)')
    expect(texte()).toContain('Ton adresse de réception n\'a pas pu être affichée en entier')
    expect(document.querySelector('p[title]')?.getAttribute('title')).toBe('1 ligne(s) lue(s) sur 2 annoncée(s)')
    expect(boutons().filter((b) => /Déclarer/.test(b))).toEqual([])
  })

  it.each<Espace>(['cabinet', 'client'])('%s : refusée, le message et aucun geste — jamais un vide qui se dirait lu', async (espace) => {
    faux.refus.adresses_reception = 'permission denied'
    await monter(espace)
    // Le motif technique est dit au cabinet ; chez le client, il reste en infobulle.
    if (espace === 'cabinet') expect(texte()).toContain('permission denied')
    else expect(document.querySelector('p[title]')?.getAttribute('title')).toContain('permission denied')
    expect(boutons()).toEqual(['Fermer'])
    expect(texte()).not.toMatch(/n’est déclarée pour ce dossier|pas encore déclaré/)
    expect(screen.queryByText('Adresse courante')).toBeNull()
  })

  it('une requête qui lève tombe du même côté', async () => {
    faux.leve.adresses_reception = true
    await monter('cabinet')
    expect(texte()).toContain('réseau coupé')
    expect(boutons()).toEqual(['Fermer'])
  })

  it('des versions qui ne font pas une chaîne : « rompue », dite, aucune courante, aucun geste', async () => {
    faux.adresses = nues([V1, adresse({ id: 'a2' })])
    await monter('cabinet')
    expect(screen.getByRole('alert').textContent).toContain('ne forment pas une suite de versions')
    expect(boutons().filter((b) => /Déclarer/.test(b))).toEqual([])
    expect(screen.queryByText('Reçoit depuis le 01/09/2026')).toBeNull()
  })

  it('le SIRET du dossier pas lu : dit, et aucun geste — le refus du SIREN en dépend', async () => {
    faux.adresses = nues([V1])
    faux.refus.dossiers = 'permission denied'
    await monter('cabinet')
    expect(screen.getByRole('alert').textContent).toContain('Le SIRET du dossier n’a pas pu être lu (permission denied)')
    expect(boutons().filter((b) => /Déclarer/.test(b))).toEqual([])
    // L'adresse lue se montre pourtant : c'est le geste, pas la lecture, que le SIRET suspend.
    expect(texte()).toContain(SIREN_FICTIF)
  })
})

describe('l’adresse courante', () => {
  it('lue vide en entier : « aucune adresse », et le geste « Déclarer l’adresse »', async () => {
    await monter('cabinet')
    expect(texte()).toContain('Aucune adresse de réception n’est déclarée pour ce dossier.')
    expect(boutons()).toContain('Déclarer l’adresse')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('chez le client : tutoyée', async () => {
    await monter('client')
    expect(texte()).toContain('Tu n’as pas encore déclaré d’adresse de réception.')
    expect(screen.getByRole('heading', { name: 'Ton adresse de réception' })).toBeTruthy()
  })

  it('la maille, l’identifiant, la plateforme, la prise d’effet, la vérification, le jour de déclaration et ce que la source établit', async () => {
    faux.adresses = nues([{ ...V2, remplace_id: null }])
    await monter('cabinet')
    const dl = document.querySelector('dl') as HTMLElement
    const lignes = Array.from(dl.querySelectorAll('dt')).map((dt) => [dt.textContent, lisible(dt.nextElementSibling?.textContent ?? '').trim()])
    expect(lignes).toEqual([
      ['Maille', 'SIREN_SIRET'],
      ['Identifiant', `${SIREN_FICTIF}_${SIRET_FICTIF}`],
      ['Plateforme', 'Autre plateforme fictive'],
      ['Prise d’effet', 'Reçoit depuis le 15/09/2026'],
      ['Vérification', 'Vérifiée sur le portail de l’annuaire le 14/09/2026'],
      ['Déclarée', 'le 16/09/2026 par le client'],
    ])
    expect(texte()).toContain(CE_QUE_ETABLIT.portail_annuaire)
  })

  it('une adresse à venir se dit « à venir » (A6-Q2), et le geste devient « une nouvelle adresse »', async () => {
    faux.adresses = nues([adresse({ prise_effet: '2026-10-20' })])
    await monter('cabinet')
    expect(texte()).toContain('À venir : à partir du 20/10/2026')
    expect(texte()).not.toContain('Reçoit depuis')
    expect(boutons()).toContain('Déclarer une nouvelle adresse')
  })

  it('une adresse dont la prise d’effet est le jour même est en vigueur', async () => {
    faux.adresses = nues([adresse({ prise_effet: '2026-10-14' })])
    await monter('cabinet')
    expect(texte()).toContain('Reçoit depuis le 14/10/2026')
  })

  it('une adresse non vérifiée compte, et l’écran dit qu’elle ne l’est pas (A6-Q3) et ce que cela établit (A6-Q4)', async () => {
    faux.adresses = nues([V1])
    await monter('cabinet')
    expect(texte()).toContain('Non vérifiée : simple déclaration')
    expect(texte()).toContain(CE_QUE_ETABLIT.declaration)
    expect(texte()).not.toContain(CE_QUE_ETABLIT.plateforme)
  })

  it('vérifiée sur la plateforme : la plateforme l’a confirmée', async () => {
    faux.adresses = nues([{ ...V3, remplace_id: null }])
    await monter('client')
    expect(texte()).toContain('Vérifiée sur la plateforme le 02/10/2026')
    expect(texte()).toContain(CE_QUE_ETABLIT.plateforme)
  })

  it('les adresses d’un autre dossier ne s’y mêlent pas', async () => {
    faux.adresses = nues([V1, AUTRE_DOSSIER])
    await monter('cabinet')
    expect(texte()).not.toContain('999999999')
  })
})

describe('l’historique', () => {
  it('les versions de la chaîne, la plus récente d’abord, chacune avec sa prise d’effet, sa vérification et son jour', async () => {
    faux.adresses = nues([V2, V1, V3])
    await monter('cabinet')
    const table = screen.getByRole('table', { name: 'Historique des adresses' })
    const lignes = within(table).getAllByRole('row').slice(1).map((r) => lisible(r.textContent))
    expect(lignes).toHaveLength(3)
    expect(lignes[0]).toContain('Courante')
    expect(lignes[0]).toContain(`${SIREN_FICTIF}_COMPTA`)
    expect(lignes[0]).toContain('Reçoit depuis le 01/10/2026')
    expect(lignes[0]).toContain('Vérifiée sur la plateforme le 02/10/2026')
    expect(lignes[0]).toContain('03/10/2026')
    expect(lignes[1]).toContain('Remplacée')
    expect(lignes[1]).toContain('Vérifiée sur le portail de l’annuaire le 14/09/2026')
    expect(lignes[1]).toContain('16/09/2026')
    expect(lignes[2]).toContain('Remplacée')
    expect(lignes[2]).toContain('Non vérifiée : simple déclaration')
    expect(lignes[2]).toContain('01/09/2026')
  })

  it('une seule version : pas d’historique', async () => {
    faux.adresses = nues([V1])
    await monter('cabinet')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('le jour de déclaration est le jour de qui regarde, pas le jour UTC', async () => {
    const avant = process.env.TZ
    try {
      faux.adresses = nues([adresse({ cree_le: '2026-10-13T22:30:00Z' })])
      process.env.TZ = 'Europe/Paris'
      await monter('cabinet')
      expect(texte()).toContain('le 14/10/2026')
    } finally { process.env.TZ = avant }
  })
})

describe('« par le client » : au cabinet seul, sur des accès lus en entier, jamais « par le cabinet »', () => {
  beforeEach(() => { faux.adresses = nues([V1, V2, V3]) })
  const mentions = () => screen.queryAllByText('par le client')

  it('cabinet : la version déclarée par un compte qui porte un accès du dossier — la courante n’en est pas, l’autre si', async () => {
    await monter('cabinet')
    // V2 seule est du client : dans l'historique ; la courante (V3) est du cabinet, et rien n'est dit « par le cabinet ».
    expect(mentions()).toHaveLength(1)
    expect(within(screen.getByRole('table')).getAllByRole('row')[2].textContent).toContain('par le client')
    expect(texte()).not.toContain('par le cabinet')
  })

  it('cabinet : accès lus en partie, refusés ou levés — la mention disparaît', async () => {
    faux.refus.memberships = 'permission denied'
    await monter('cabinet')
    expect(mentions()).toHaveLength(0)
    expect(texte()).not.toContain('par le cabinet')
  })

  it('cabinet : accès pas encore revenus — rien n’est dit de personne, puis la mention paraît', async () => {
    // Les adresses reviennent ; les accès, eux, sont retenus : la fenêtre ne dit rien de personne.
    faux.retenirTables = ['memberships']
    await monter('cabinet')
    expect(mentions()).toHaveLength(0)
    expect(texte()).not.toContain('par le cabinet')
    faux.retenirTables = []
    await act(async () => { faux.lecturesEnAttente.splice(0).forEach((r) => r()) })
    await waitFor(() => expect(mentions()).toHaveLength(1))
  })

  it('client : jamais de mention, et les accès du dossier ne sont même pas lus', async () => {
    await monter('client')
    expect(mentions()).toHaveLength(0)
    expect(faux.lectures).not.toContain('memberships')
  })
})

describe('le formulaire : les refus de la base, dits avant le clic', () => {
  beforeEach(() => { faux.adresses = [] })

  it('ouvert sur une saisie vide : le premier refus de la base, discret, et « Déclarer » grisé', async () => {
    await monter('cabinet')
    fireEvent.click(bouton('Déclarer l’adresse'))
    expect(bouton('Déclarer').disabled).toBe(true)
    expect(texte()).toContain('La maille de l\'adresse est l\'une des quatre de l\'annuaire')
    // Rien n'a été touché : le refus ne s'accuse pas encore (pas d'alerte).
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(/La maille de l'adresse est l'une des quatre/).className).toBe('muted')
  })

  it('il suit l’ordre de la base : l’identifiant, la prise d’effet, la plateforme, la vérification, son jour', async () => {
    await monter('cabinet')
    fireEvent.click(bouton('Déclarer l’adresse'))
    saisir('Identifiant d’adressage', SIREN_FICTIF)
    expect(texte()).toContain('La date de prise d\'effet de l\'adresse est à renseigner.')
    saisir('Date de prise d’effet', '2026-09-01')
    expect(texte()).toContain('Le nom de la plateforme de réception est à renseigner.')
    saisir(LIBELLE_PLATEFORME_ADRESSE, 'Plateforme fictive')
    expect(texte()).toContain('La vérification se fait sur le portail de l\'annuaire')
    fireEvent.click(screen.getByRole('radio', { name: /Vérifiée sur le portail/ }))
    expect(texte()).toContain('Le jour de la vérification est à renseigner.')
    expect(bouton('Déclarer').disabled).toBe(true)
    saisir('Jour de la vérification', '2026-10-01')
    expect(bouton('Déclarer').disabled).toBe(false)
    expect(texte()).not.toContain('est à renseigner')
  })

  it('un identifiant d’un autre SIREN : le refus nomme le SIREN du dossier ; le texte se montre d’alerte une fois touché', async () => {
    await monter('cabinet')
    fireEvent.click(bouton('Déclarer l’adresse'))
    saisir('Identifiant d’adressage', '999999999')
    expect(texte()).toContain(`L'adresse doit commencer par le SIREN du dossier, ${SIREN_FICTIF}.`)
    expect(screen.getByText(/doit commencer par le SIREN/).className).toBe('error-text')
    expect(bouton('Déclarer').disabled).toBe(true)
  })

  it('un jour de vérification dans le futur à Paris : refusé avant le clic', async () => {
    await monter('cabinet')
    fireEvent.click(bouton('Déclarer l’adresse'))
    remplirTout(LIBELLE_PLATEFORME_ADRESSE)
    saisir('Jour de la vérification', '2026-10-15')
    expect(texte()).toContain('Le jour de la vérification est compris entre le 01/01/2000 et aujourd\'hui.')
    expect(bouton('Déclarer').disabled).toBe(true)
  })

  it('une date que le calendrier rend de travers se dit, sans lever', async () => {
    await monter('cabinet')
    fireEvent.click(bouton('Déclarer l’adresse'))
    remplirTout(LIBELLE_PLATEFORME_ADRESSE)
    saisir('Date de prise d’effet', '275760-09-13')
    expect(texte()).toContain('Une date saisie n’est pas une date du calendrier')
    expect(bouton('Déclarer').disabled).toBe(true)
  })

  it('un dossier sans SIRET : le refus de la base en tête, jamais un SIREN inventé', async () => {
    faux.dossiers = [{ id: 'd1', siret: null }]
    await monter('cabinet')
    fireEvent.click(bouton('Déclarer l’adresse'))
    expect(screen.getByRole('alert').textContent).toContain('Le dossier n\'a pas de SIREN : renseigner son SIRET')
    remplirTout(LIBELLE_PLATEFORME_ADRESSE)
    expect(bouton('Déclarer').disabled).toBe(true)
  })

  it('Annuler ferme le formulaire sans rien écrire', async () => {
    await monter('cabinet')
    fireEvent.click(bouton('Déclarer l’adresse'))
    fireEvent.click(bouton('Annuler'))
    expect(screen.queryByLabelText('Identifiant d’adressage')).toBeNull()
    expect(faux.rpcs).toEqual([])
  })
})

describe('la maille : jamais choisie à la place de la personne', () => {
  beforeEach(() => { faux.adresses = [] })
  const maille = () => screen.getByLabelText('Maille de l’adresse') as HTMLSelectElement

  it('un identifiant qui n’en admet qu’une : proposée, et on peut en changer', async () => {
    await monter('cabinet')
    fireEvent.click(bouton('Déclarer l’adresse'))
    expect(maille().value).toBe('')
    saisir('Identifiant d’adressage', SIREN_FICTIF)
    expect(maille().value).toBe('siren')
    expect(texte()).toContain('Proposée d’après l’identifiant : vous pouvez en changer.')
    fireEvent.change(maille(), { target: { value: 'siren_siret' } })
    expect(maille().value).toBe('siren_siret')
    expect(texte()).not.toContain('La maille de l\'adresse est l\'une des quatre')
    expect(texte()).toContain('Une adresse à la maille SIREN_SIRET s\'écrit')
  })

  it('un identifiant qui en admet deux : aucune choisie, la personne choisit', async () => {
    await monter('cabinet')
    fireEvent.click(bouton('Déclarer l’adresse'))
    saisir('Identifiant d’adressage', `${SIREN_FICTIF}_${SIRET_FICTIF}`)
    expect(maille().value).toBe('')
    expect(texte()).toContain('Cet identifiant s’écrit de 2 façons : SIREN_SIRET ou SIREN_suffixe. C’est à vous de choisir')
    expect(bouton('Déclarer').disabled).toBe(true)
    fireEvent.change(maille(), { target: { value: 'siren_suffixe' } })
    expect(maille().value).toBe('siren_suffixe')
    expect(texte()).not.toContain('Cet identifiant s’écrit de 2 façons')
  })

  it('chez le client, le conseil est tutoyé', async () => {
    await monter('client')
    fireEvent.click(bouton('Déclarer l’adresse'))
    saisir('Identifiant d’adressage', `${SIREN_FICTIF}_${SIRET_FICTIF}`)
    expect(texte()).toContain('C’est à toi de choisir')
  })
})

describe('la vérification : ses trois sources, ce que chacune établit, son jour', () => {
  it('chaque source dit ce qu’elle établit ; le jour ne se demande que d’une adresse vérifiée, et se remet à zéro', async () => {
    await monter('cabinet')
    fireEvent.click(bouton('Déclarer l’adresse'))
    for (const phrase of Object.values(CE_QUE_ETABLIT)) expect(texte()).toContain(phrase)
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.queryByLabelText('Jour de la vérification')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: /Confirmée par la plateforme/ }))
    saisir('Jour de la vérification', '2026-10-01')
    fireEvent.click(screen.getByRole('radio', { name: /Déclarée sans vérification/ }))
    expect(screen.queryByLabelText('Jour de la vérification')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: /Confirmée par la plateforme/ }))
    expect(champ('Jour de la vérification').value).toBe('')
  })

  it('le lien du portail est aussi dans le formulaire, au même endroit que les sources', async () => {
    await monter('cabinet')
    fireEvent.click(bouton('Déclarer l’adresse'))
    expect(screen.getAllByRole('link', { name: 'Vérifier sur l’annuaire' })).toHaveLength(1)
  })
})

describe('l’écriture', () => {
  it('ce que la base reçoit, une première déclaration ; puis la fenêtre dit l’adresse relue', async () => {
    await monter('cabinet')
    fireEvent.click(bouton('Déclarer l’adresse'))
    remplirTout(LIBELLE_PLATEFORME_ADRESSE)
    const lecturesAvant = faux.lectures.length
    await act(async () => { fireEvent.click(bouton('Déclarer')) })
    expect(faux.rpcs).toEqual([{
      nom: 'declarer_adresse_reception',
      params: {
        p_dossier_id: 'd1', p_forme: 'siren', p_identifiant: SIREN_FICTIF, p_plateforme: 'Plateforme fictive', p_prise_effet: '2026-09-01',
        p_verification: 'portail_annuaire', p_verifiee_le: '2026-10-01', p_remplace_id: null,
      },
    }])
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe(`Adresse ${SIREN_FICTIF} déclarée.`)
    // La liste est relue (les adresses ET le SIRET), le formulaire est refermé, et la courante est celle que la base a écrite.
    expect(faux.lectures.length).toBeGreaterThan(lecturesAvant)
    expect(screen.queryByLabelText('Identifiant d’adressage')).toBeNull()
    expect(texte()).toContain('Vérifiée sur le portail de l’annuaire le 01/10/2026')
    expect(faux.ecritures).toEqual([])
  })

  it('une nouvelle adresse remplace la courante : son identifiant part, les blancs des bords s’en vont', async () => {
    faux.adresses = nues([V1])
    await monter('cabinet')
    fireEvent.click(bouton('Déclarer une nouvelle adresse'))
    expect(texte()).toContain(`Elle remplace l’adresse courante : ${SIREN_FICTIF} (SIREN), chez Plateforme fictive.`)
    saisir('Identifiant d’adressage', ` ${SIREN_FICTIF}_COMPTA \n`)
    fireEvent.change(screen.getByLabelText('Maille de l’adresse'), { target: { value: 'siren_suffixe' } })
    saisir(LIBELLE_PLATEFORME_ADRESSE, '  Plateforme fictive ')
    saisir('Date de prise d’effet', '2026-10-20')
    fireEvent.click(screen.getByRole('radio', { name: /Déclarée sans vérification/ }))
    await act(async () => { fireEvent.click(bouton('Déclarer')) })
    expect(faux.rpcs).toHaveLength(1)
    expect(faux.rpcs[0].params).toMatchObject({
      p_remplace_id: 'a1', p_forme: 'siren_suffixe', p_identifiant: `${SIREN_FICTIF}_COMPTA`, p_plateforme: 'Plateforme fictive',
      p_prise_effet: '2026-10-20', p_verification: 'declaration', p_verifiee_le: null,
    })
    await screen.findByRole('status')
    // La nouvelle courante, à venir (20/10), est celle qu'on lit ; l'ancienne est dans l'historique.
    expect(texte()).toContain('À venir : à partir du 20/10/2026')
    expect(screen.getByRole('table', { name: 'Historique des adresses' })).toBeTruthy()
  })

  it('un seul verrou : deux, puis trois clics du même rendu, une seule écriture ; relâché après la relecture', async () => {
    await monter('cabinet')
    fireEvent.click(bouton('Déclarer l’adresse'))
    remplirTout(LIBELLE_PLATEFORME_ADRESSE)
    faux.retenirRpc = true
    const b = bouton('Déclarer')
    await act(async () => { fireEvent.click(b); fireEvent.click(b); fireEvent.click(b) })
    expect(faux.rpcs).toHaveLength(1)
    expect(bouton('Enregistrement…').disabled).toBe(true)
    // La base répond ; la relecture, elle, est retenue : le verrou n'est pas relâché, le formulaire est encore là.
    faux.retenirRpc = false
    faux.retenirLecture = true
    await act(async () => { faux.rpcEnAttente.splice(0).forEach((r) => r()) })
    await act(async () => { await Promise.resolve() })
    expect(bouton('Enregistrement…').disabled).toBe(true)
    expect(faux.rpcs).toHaveLength(1)
    faux.retenirLecture = false
    await act(async () => { faux.lecturesEnAttente.splice(0).forEach((r) => r()) })
    await screen.findByRole('status')
    expect(faux.rpcs).toHaveLength(1)
    expect(screen.queryByLabelText('Identifiant d’adressage')).toBeNull()
  })

  it('un refus de la base se dit sous ses mots, la liste est relue, le formulaire reste, et on peut recommencer', async () => {
    await monter('cabinet')
    fireEvent.click(bouton('Déclarer l’adresse'))
    remplirTout(LIBELLE_PLATEFORME_ADRESSE)
    faux.refusRpc = 'Accès refusé à ce dossier.'
    const lecturesAvant = faux.lectures.length
    await act(async () => { fireEvent.click(bouton('Déclarer')) })
    expect((await screen.findByRole('alert')).textContent).toBe('Accès refusé à ce dossier.')
    expect(faux.lectures.length).toBeGreaterThan(lecturesAvant)
    expect(champ('Identifiant d’adressage').value).toBe(SIREN_FICTIF)
    expect(screen.queryByRole('status')).toBeNull()
    // Le verrou est relâché : une seconde tentative part.
    faux.refusRpc = null
    await act(async () => { fireEvent.click(bouton('Déclarer')) })
    expect(faux.rpcs).toHaveLength(2)
    expect((await screen.findByRole('status')).textContent).toBe(`Adresse ${SIREN_FICTIF} déclarée.`)
  })

  it('une autre adresse déclarée entre-temps : le refus de la base, puis la relecture fait dire le refus du module AVANT le clic', async () => {
    faux.adresses = nues([V1])
    await monter('cabinet')
    fireEvent.click(bouton('Déclarer une nouvelle adresse'))
    saisir('Identifiant d’adressage', SIREN_FICTIF)
    saisir(LIBELLE_PLATEFORME_ADRESSE, 'Plateforme fictive')
    saisir('Date de prise d’effet', '2026-10-01')
    fireEvent.click(screen.getByRole('radio', { name: /Déclarée sans vérification/ }))
    expect(bouton('Déclarer').disabled).toBe(false)
    // Un autre accès déclare, pendant que ce formulaire est ouvert : la base refuse le nôtre.
    faux.avantRpc = () => { faux.adresses.push({ ...V3, id: 'a-concurrente', remplace_id: 'a1' }) }
    faux.refusRpc = `Une autre adresse a été déclarée entre-temps (« ${SIREN_FICTIF}_COMPTA », le 03/10/2026) : relire avant de déclarer.`
    await act(async () => { fireEvent.click(bouton('Déclarer')) })
    await screen.findByRole('alert')
    // La liste relue montre la concurrente ; le bouton est grisé AVANT un second clic, sous les mots de la base.
    expect(bouton('Déclarer').disabled).toBe(true)
    expect(faux.rpcs).toHaveLength(1)
    faux.refusRpc = null
    fireEvent.click(bouton('Déclarer'))
    expect(faux.rpcs).toHaveLength(1)
  })

  it('une réponse de la base qui n’est pas l’adresse visée est dite, pas crue écrite', async () => {
    await monter('cabinet')
    fireEvent.click(bouton('Déclarer l’adresse'))
    remplirTout(LIBELLE_PLATEFORME_ADRESSE)
    faux.reponseRpc = { ...adresse({ id: 'ailleurs', dossier_id: 'd2' }) }
    await act(async () => { fireEvent.click(bouton('Déclarer')) })
    expect((await screen.findByRole('alert')).textContent).toContain('La base n’a pas rendu l’adresse déclarée')
    // Le formulaire reste : rien n'est dit déclaré.
    expect(screen.queryByRole('status')).toBeNull()
    expect(champ('Identifiant d’adressage').value).toBe(SIREN_FICTIF)
  })

  it('rien d’autre que la fonction n’écrit la table', async () => {
    faux.adresses = nues([V1])
    await monter('cabinet')
    fireEvent.click(bouton('Déclarer une nouvelle adresse'))
    expect(faux.ecritures).toEqual([])
  })
})

describe('les mots du client', () => {
  // Les mêmes états montés pour les deux espaces : le garde ne voit chez le client aucune forme du cabinet, et chez le cabinet il
  // en trouve au moins une chaque fois (son défaut planté : un garde qui ne verrait rien ne prouverait rien).
  async function etats(espace: Espace): Promise<{ nom: string; texte: string }[]> {
    const sorties: { nom: string; texte: string }[] = []
    const relever = (nom: string) => sorties.push({ nom, texte: texte() })

    faux.adresses = []
    let rendu = await monter(espace)
    relever('aucune adresse')
    fireEvent.click(bouton('Déclarer l’adresse'))
    relever('formulaire vide')
    saisir('Identifiant d’adressage', `${SIREN_FICTIF}_${SIRET_FICTIF}`)
    relever('deux mailles')
    saisir('Identifiant d’adressage', '999999999')
    relever('autre SIREN')
    remplirTout(espace === 'client' ? LIBELLE_PLATEFORME_ADRESSE_CLIENT : LIBELLE_PLATEFORME_ADRESSE)
    faux.refusRpc = 'Accès refusé à ce dossier.'
    await act(async () => { fireEvent.click(bouton('Déclarer')) })
    await screen.findByRole('alert')
    relever('refus de la base')
    rendu.unmount()

    faux.refusRpc = null
    faux.dossiers = [{ id: 'd1', siret: null }]
    rendu = await monter(espace)
    fireEvent.click(bouton('Déclarer l’adresse'))
    relever('dossier sans SIRET')
    rendu.unmount()

    faux.dossiers = [{ id: 'd1', siret: SIRET_FICTIF }, { id: 'd2', siret: null }]
    faux.adresses = nues([V1, V2, V3])
    rendu = await monter(espace)
    relever('adresse courante et historique')
    fireEvent.click(bouton('Déclarer une nouvelle adresse'))
    relever('formulaire de remplacement')
    rendu.unmount()

    faux.adresses = nues([V1, V2])
    faux.muetApres = 1
    rendu = await monter(espace)
    relever('lecture partielle')
    rendu.unmount()

    faux.muetApres = Infinity
    faux.refus.dossiers = 'permission denied'
    rendu = await monter(espace)
    relever('SIRET illisible')
    rendu.unmount()
    faux.refus = {}

    faux.adresses = nues([V1, adresse({ id: 'a2' })])
    rendu = await monter(espace)
    relever('versions rompues')
    rendu.unmount()
    return sorties
  }

  it('le client : tutoiement, aucun onglet du cabinet, jamais « le client » pour lui, sur chaque état de la fenêtre', async () => {
    const sorties = await etats('client')
    expect(sorties.length).toBeGreaterThanOrEqual(10)
    for (const { nom, texte: t } of sorties) expect(motsDuCabinet(t), nom).toEqual([])
  })

  it('le cabinet : au moins une forme du cabinet chaque fois qu’il y a du texte propre à lui — le garde n’est pas aveugle', async () => {
    const sorties = await etats('cabinet')
    const avecMots = sorties.filter(({ texte: t }) => motsDuCabinet(t).length > 0).map((s) => s.nom)
    // Les états où le texte du cabinet parle du client qui porte la case, ou vouvoie : le titre, l'introduction, les libellés.
    expect(avecMots.length).toBe(sorties.length)
  })

  it('le libellé de la plateforme dit qui le lit : au cabinet, le client « Ventes » ; chez le client, ton cabinet aussi', async () => {
    await monter('cabinet')
    fireEvent.click(bouton('Déclarer l’adresse'))
    expect(screen.getByLabelText(LIBELLE_PLATEFORME_ADRESSE)).toBeTruthy()
    expect(LIBELLE_PLATEFORME_ADRESSE).toMatch(/le client qui porte la case « Ventes » le lit/)
    document.body.innerHTML = ''
    await monter('client')
    fireEvent.click(bouton('Déclarer l’adresse'))
    expect(screen.getByLabelText(LIBELLE_PLATEFORME_ADRESSE_CLIENT)).toBeTruthy()
    expect(LIBELLE_PLATEFORME_ADRESSE_CLIENT).toMatch(/ton cabinet le lit aussi/)
  })

  it('un refus de la base qui nomme « le dossier » se réécrit pour le client', async () => {
    await monter('client')
    fireEvent.click(bouton('Déclarer l’adresse'))
    saisir('Identifiant d’adressage', '999999999')
    expect(texte()).toContain(`L'adresse doit commencer par le SIREN de ta société, ${SIREN_FICTIF}.`)
    expect(texte()).toContain('Le SIREN de ta société est')
  })
})

describe('le lien du portail', () => {
  it('un lien vers le portail public de l’annuaire, dans une autre page, sans rien qui parte seul', async () => {
    faux.adresses = nues([V1])
    await monter('cabinet')
    const lien = screen.getByRole('link', { name: 'Vérifier sur l’annuaire' }) as HTMLAnchorElement
    expect(lien.getAttribute('href')).toBe(LIEN_PORTAIL_ANNUAIRE)
    expect(lien.getAttribute('target')).toBe('_blank')
    expect(lien.getAttribute('rel')).toBe('noopener noreferrer')
    // Ce que le portail montre — et ne montre pas — est dit à côté.
    expect(texte()).toContain(CE_QUE_ETABLIT.portail_annuaire)
    // Dit UNE fois : quand le portail est la source de la courante, la phrase est déjà sous l'adresse, pas répétée sous le lien.
    expect(texte().split(CE_QUE_ETABLIT.portail_annuaire)).toHaveLength(2)
    // Au chargement et sur le clic : trois tables de la base, jamais autre chose (le faux client lève sur toute autre).
    const ouvrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    fireEvent.click(lien)
    expect(ouvrir).not.toHaveBeenCalled()
    ouvrir.mockRestore()
    expect(new Set(faux.lectures)).toEqual(new Set(['adresses_reception', 'dossiers', 'memberships']))
    expect(faux.rpcs).toEqual([])
  })

  it('la phrase du portail n’est pas répétée quand la courante est déjà vérifiée par lui', async () => {
    faux.adresses = nues([{ ...V2, remplace_id: null }])
    await monter('cabinet')
    expect(texte().split(CE_QUE_ETABLIT.portail_annuaire)).toHaveLength(2)
  })

  it('le lien est offert aux deux espaces', async () => {
    await monter('client')
    expect(screen.getByRole('link', { name: 'Vérifier sur l’annuaire' })).toBeTruthy()
  })
})

describe('Fermer', () => {
  it('ferme la fenêtre sans rien écrire', async () => {
    const { onClose } = await monter('client')
    fireEvent.click(bouton('Fermer'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(faux.rpcs).toEqual([])
  })
})

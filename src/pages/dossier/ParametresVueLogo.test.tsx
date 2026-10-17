import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ParametresVue from './ParametresVue'
import { TAILLE_MAX } from '../../lib/bornesStockage'
import { motsDuCabinet } from '../../lib/espaceVentes'
import { cheminDuLogo } from '../../lib/logoDesFactures'
import { PHRASE_LOGO_IDENTIQUE, PHRASE_REDEPOT } from '../../lib/logoDesFacturesVue'
import { champsChanges } from '../../lib/parametresFacturationVue'
import type { ParametresFacturation } from '../../lib/types'
import { empreinteDe, logoDe } from '../../test/logoFictif'
import { versionParametres } from '../../test/parametresFacturation'

// « PARAMÈTRES » ET LE LOGO DES FACTURES. Étape A5c1, la migration du logo EN BASE : le drapeau `LOGO_DES_FACTURES_EXPORTE` est
// FORCÉ ici, comme la bascule l'a levé. Ce que ces cas gardent, et qu'aucun calcul pur ne voit : le formulaire d'A5b1 n'offre
// pas le logo, et la base lit la saisie EN ENTIER — une clé absente y vaut « aucun logo » ; « Modifier les paramètres » doit donc
// ENVOYER le logo de la version qu'il remplace, sans quoi chaque modification le retirerait en silence. Et l'historique nomme ce
// qu'une version a fait du logo.
// Étape A5c2a, l'ÉCRAN du logo : le bloc « Logo des factures » de la carte « Paramètres en cours », au cabinet et au client
// « Ventes » — voir le logo (le fichier relu dans le seau, son empreinte recalculée avant toute image), le choisir sans rien
// envoyer, le poser ou le changer (le fichier d'abord, PUIS une version qui ne change que le logo), le retirer après une
// confirmation. Le seau est un faux qui note ses dépôts et ses lectures ; la base, un faux qui écrit comme la fonction. Données
// fictives : un PNG de 1 × 1 pixel écrit dans le code, jamais un fichier.

vi.mock('../../lib/logoDesFactures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/logoDesFactures')>()),
  LOGO_DES_FACTURES_EXPORTE: true,
}))

const faux = vi.hoisted(() => ({
  versions: [] as Record<string, unknown>[],
  rpcs: [] as { nom: string; params: Record<string, unknown> }[],
  // L'ordre des gestes qui écrivent : le dépôt du fichier, puis la version.
  journal: [] as string[],
  cabinet: true,
  refusRpc: null as string | null,
  seau: new Map<string, Blob>(),
  depots: [] as { chemin: string; type: string; upsert: unknown }[],
  telechargements: [] as string[],
  // Ce que le seau répond à la place de son comportement ordinaire.
  erreurDepot: null as Record<string, unknown> | null,
  erreurLecture: null as Record<string, unknown> | null,
  retenirTelechargement: false,
  telechargementsEnAttente: [] as (() => void)[],
  retenirLecture: false,
  lecturesEnAttente: [] as (() => void)[],
  lectures: 0,
  muetApres: Infinity,
  // Les adresses d'objet : créées et révoquées.
  urls: [] as { url: string; blob: Blob }[],
  revoquees: [] as string[],
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  const instant = '2027-11-20T10:00:00Z'
  const courante = () => faux.versions.find((v) => !faux.versions.some((s) => s.remplace_id === v.id))
  const erreurDuStockage = (status: number, statusCode: string, message: string) => ({ __isStorageError: true, status, statusCode, message })
  return {
    supabase: {
      rpc: async (nom: string, params: Record<string, unknown>) => {
        faux.rpcs.push({ nom, params })
        faux.journal.push('version')
        if (nom !== 'enregistrer_parametres_facturation') throw new Error(`Fonction non attendue : ${nom}`)
        if (faux.refusRpc) return { data: null, error: { message: faux.refusRpc } }
        const p = params.p_parametres as Record<string, unknown>
        const c = courante()
        // Comme la fonction : un RIB inchangé garde son état et sa confirmation ; posé ou changé, il est confirmé par le cabinet,
        // seulement proposé par le client ; une clé de logo absente vaut nul.
        const inchange = c != null && p.iban === c.iban && p.bic === c.bic && p.titulaire_compte === c.titulaire_compte
        const etat = p.iban == null ? null : inchange ? c.rib_etat : faux.cabinet ? 'confirme' : 'propose'
        const ecrite = {
          ...versionParametres({ id: `v${faux.versions.length + 1}`, dossier_id: params.p_dossier_id as string }),
          ...p, logo_chemin: p.logo_chemin ?? null, logo_sha256: p.logo_sha256 ?? null, rib_etat: etat,
          rib_confirme_par: etat === null ? null : inchange ? c.rib_confirme_par : faux.cabinet ? 'u-moi' : null,
          rib_confirme_le: etat === null ? null : inchange ? c.rib_confirme_le : faux.cabinet ? instant : null,
          remplace_id: params.p_remplace_id, auteur: 'u-moi', cree_le: instant,
        }
        faux.versions = [...faux.versions, ecrite]
        return { data: ecrite, error: null }
      },
      storage: {
        from: (seau: string) => {
          if (seau !== 'ventes') throw new Error(`Seau non attendu dans ce test : ${seau}`)
          return {
            download: async (chemin: string) => {
              faux.telechargements.push(chemin)
              if (faux.retenirTelechargement) await new Promise<void>((r) => { faux.telechargementsEnAttente.push(r) })
              if (faux.erreurLecture) return { data: null, error: faux.erreurLecture }
              const fichier = faux.seau.get(chemin)
              if (!fichier) return { data: null, error: erreurDuStockage(400, '404', 'Object not found') }
              return { data: fichier, error: null }
            },
            upload: async (chemin: string, corps: Blob, options: { upsert?: boolean }) => {
              faux.journal.push('depot')
              faux.depots.push({ chemin, type: corps.type, upsert: options.upsert })
              if (faux.erreurDepot) return { data: null, error: faux.erreurDepot }
              if (faux.seau.has(chemin)) return { data: null, error: erreurDuStockage(400, '409', 'The resource already exists') }
              faux.seau.set(chemin, corps)
              return { data: { path: chemin }, error: null }
            },
          }
        },
      },
      from: (table: string) => {
        if (table !== 'parametres_facturation') throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: Predicat[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            const partir = () => {
              faux.lectures += 1
              const toutes = filtrer(faux.versions, predicats)
              return { data: toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres)), error: null, count: toutes.length }
            }
            if (faux.retenirLecture) return new Promise<void>((r) => { faux.lecturesEnAttente.push(r) }).then(partir).then(suite, echec)
            return Promise.resolve().then(partir).then(suite, echec)
          },
        })
        return c
      },
    },
  }
})

// Un identifiant de dossier à la forme de la base : le chemin d'un logo commence par lui (`<dossier>/logos/…`).
const D = 'a5c00000-0000-4000-8000-0000000000d1'
const IBAN = 'FR9399999000010000000000100'
// Trois logos fictifs aux empreintes distinctes : A est celui de la version courante, B celui qu'on pose ou qu'on change, C un autre.
let OCTETS_A: Uint8Array<ArrayBuffer>
let OCTETS_B: Uint8Array<ArrayBuffer>
let HA: string
let HB: string
let CHEMIN_A: string
let CHEMIN_B: string
let V1: ParametresFacturation
let V2: ParametresFacturation

beforeAll(async () => {
  OCTETS_A = logoDe(1)
  OCTETS_B = logoDe(2)
  HA = await empreinteDe(OCTETS_A)
  HB = await empreinteDe(OCTETS_B)
  CHEMIN_A = cheminDuLogo(D, HA, 'image/png')
  CHEMIN_B = cheminDuLogo(D, HB, 'image/png')
  // V1 : tout renseigné, un RIB PROPOSÉ par le client, aucun logo ; V2 : la même chose avec le logo A.
  V1 = versionParametres({
    id: 'v1', dossier_id: D, delai_paiement_jours: 45, moyen_prefere: 'virement', escompte: 'Pas d’escompte.', penalites: 'Trois fois le taux légal.',
    mentions_complementaires: 'Une mention.', pied_de_page: 'Un pied de page.', iban: IBAN, bic: 'ESSAFR10', titulaire_compte: 'Atelier fictif',
    rib_etat: 'propose', auteur: 'u-client', logo_chemin: null, logo_sha256: null, cree_le: '2027-10-01T09:00:00Z',
  })
  V2 = { ...V1, id: 'v2', remplace_id: 'v1', logo_chemin: CHEMIN_A, logo_sha256: HA, cree_le: '2027-10-02T09:00:00Z' }
})

beforeEach(() => {
  faux.versions = [{ ...V1 }, { ...V2 }]
  faux.rpcs = []
  faux.journal = []
  faux.cabinet = true
  faux.refusRpc = null
  faux.seau = new Map([[CHEMIN_A, new Blob([OCTETS_A])]])
  faux.depots = []
  faux.telechargements = []
  faux.erreurDepot = null
  faux.erreurLecture = null
  faux.retenirTelechargement = false
  faux.telechargementsEnAttente = []
  faux.retenirLecture = false
  faux.lecturesEnAttente = []
  faux.lectures = 0
  faux.muetApres = Infinity
  faux.urls = []
  faux.revoquees = []
  // jsdom n'a pas de fabrique d'adresses d'objet : une fausse, qui note ce qu'elle crée et ce qu'on révoque.
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:logo-${faux.urls.length + 1}`
    faux.urls.push({ url, blob })
    return url
  }
  URL.revokeObjectURL = (url: string) => { faux.revoquees.push(url) }
})

afterEach(() => { vi.restoreAllMocks() })

const lisible = (t: string | null) => (t ?? '').replace(/[\u00a0\u202f]/g, ' ')
const fenetre = () => screen.getByRole('dialog')

type Espace = 'cabinet' | 'client'
function monter(espace: Espace, dossierId = D) {
  faux.cabinet = espace === 'cabinet'
  return render(espace === 'client'
    ? <ParametresVue espace="client" dossierId={dossierId} />
    : <ParametresVue espace="cabinet" acces={{ etat: 'lus', comptes: ['u-client'] }} dossierId={dossierId} />)
}
const bloc = () => within(screen.getByText('Logo des factures').closest('.logo-facture') as HTMLElement)
// Le bloc, une fois la vue lue.
const blocLu = async () => within((await screen.findByText('Logo des factures')).closest('.logo-facture') as HTMLElement)
const champFichier = () => screen.getByLabelText(/^Choisir (un|un autre) logo/) as HTMLInputElement
const bouton = (nom: string | RegExp) => screen.getByRole('button', { name: nom }) as HTMLButtonElement
const png = (octets: Uint8Array<ArrayBuffer>, nom = 'logo.png') => new File([octets], nom, { type: 'image/png' })
const libererLecture = () => act(async () => { faux.retenirLecture = false; for (const r of faux.lecturesEnAttente.splice(0)) r() })
const libererTelechargements = () => act(async () => { faux.retenirTelechargement = false; for (const r of faux.telechargementsEnAttente.splice(0)) r() })
// Choisir un fichier le juge (signature, borne, empreinte : du vrai calcul asynchrone) : on attend ce que le bloc en dit —
// « Logo choisi » pour un fichier pris, la phrase de son refus sinon.
async function choisir(fichier: File, attendu: RegExp = /^Logo choisi/) {
  await act(async () => { fireEvent.change(champFichier(), { target: { files: [fichier] } }) })
  await bloc().findByText(attendu)
}
// Un geste du logo traverse du vrai calcul asynchrone (l'empreinte du fichier) : on clique, puis on attend ce qu'il dit à la fin.
async function cliquer(nom: string, fin: RegExp) {
  await act(async () => { fireEvent.click(bouton(nom)) })
  await screen.findByText(fin)
}
// Appelle le gestionnaire React d'un bouton MÊME grisé : sous le `disabled`, le verrou et la seconde ceinture sont ce qui arrête
// un second geste — ils ne se voient qu'ainsi (un `fireEvent.click` sur un bouton grisé n'atteint pas le gestionnaire).
function declencher(el: HTMLElement) {
  const cle = Object.keys(el).find((k) => k.startsWith('__reactProps$')) as string
  ;(el as unknown as Record<string, { onClick: () => void }>)[cle].onClick()
}
const ticks = (n = 4) => act(async () => { for (let i = 0; i < n; i++) await new Promise<void>((r) => setTimeout(r, 0)) })

describe('Paramètres, la migration du logo en base', () => {
  it('modifier le délai d’une version qui porte un logo : la saisie envoie le logo repris, et la version neuve le garde', async () => {
    monter('cabinet')
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier les paramètres' }))
    fireEvent.change(within(fenetre()).getByLabelText(/^Délai de paiement/), { target: { value: '50' } })
    await act(async () => { fireEvent.click(within(fenetre()).getByRole('button', { name: 'Enregistrer' })) })
    expect(faux.rpcs).toHaveLength(1)
    expect(faux.rpcs[0].params).toEqual(expect.objectContaining({ p_dossier_id: D, p_remplace_id: 'v2' }))
    expect(faux.rpcs[0].params.p_parametres).toEqual(expect.objectContaining({ delai_paiement_jours: 50, logo_chemin: CHEMIN_A, logo_sha256: HA }))
    expect(faux.versions.at(-1)).toEqual(expect.objectContaining({ remplace_id: 'v2', logo_chemin: CHEMIN_A, logo_sha256: HA }))
  })

  it('l’historique nomme ce qu’une version a fait du logo', async () => {
    monter('cabinet')
    const historique = await screen.findByRole('table', { name: 'Historique des paramètres' })
    expect(within(historique).getByText('Logo posé')).toBeTruthy()
  })
})

describe.each(['cabinet', 'client'] as const)('le logo des factures, vu (%s)', (espace) => {
  it('rien avant la lecture des paramètres : ni bloc, ni image, ni « aucun logo », ni geste', async () => {
    faux.retenirLecture = true
    monter(espace)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByText('Logo des factures')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByText(/Aucun logo/)).toBeNull()
    expect(screen.queryByLabelText(/Choisir/)).toBeNull()
    expect(faux.telechargements).toEqual([])
    await libererLecture()
    expect(await screen.findByText('Logo des factures')).toBeTruthy()
  })

  it('rien avant la lecture du fichier : « Chargement du logo… », puis l’image — après la vérification de son empreinte', async () => {
    faux.retenirTelechargement = true
    monter(espace)
    expect(await screen.findByText('Chargement du logo…')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByText(/Aucun logo/)).toBeNull()
    // Le téléchargement part d'un effet. La lecture des paramètres finit HORS d'un `act` : `findByText` voit « Chargement du
    // logo… » dès qu'il est commis, et l'effet passe dans une tâche à part — sous la charge, la liste lue aussitôt ne l'avait
    // pas encore (CI du 17/10/2026, comme la ligne 24.19). Après l'image, plus bas, le téléchargement a forcément eu lieu.
    await waitFor(() => expect(faux.telechargements).toEqual([CHEMIN_A]))
    await libererTelechargements()
    const image = (await screen.findByAltText('Logo des factures')) as HTMLImageElement
    expect(image.getAttribute('src')).toBe('blob:logo-1')
    // Le corps de l'image est celui du fichier, réétiqueté à sa signature ; l'image n'est ni recadrée ni redimensionnée.
    expect(faux.urls[0].blob.type).toBe('image/png')
    expect(faux.urls[0].blob.size).toBe(OCTETS_A.byteLength)
    expect(image.className).toBe('logo-facture-image')
    expect(image.hasAttribute('width') || image.hasAttribute('height')).toBe(false)
    expect(lisible(bloc().getByText(/empreinte vérifiée/).textContent)).toBe(`PNG · ${OCTETS_A.byteLength} octets · empreinte vérifiée`)
    expect(screen.queryByText('Chargement du logo…')).toBeNull()
    // Le téléchargement n'est fait qu'une fois, pour ce chemin.
    expect(faux.telechargements).toEqual([CHEMIN_A])
  })

  it('un fichier d’une autre empreinte sous le nom du logo n’est JAMAIS montré', async () => {
    faux.seau.set(CHEMIN_A, new Blob([OCTETS_B]))
    monter(espace)
    expect(await screen.findByText(/n’est pas celui que la version désigne \(son empreinte diffère\)/)).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    expect(faux.urls).toEqual([])
    // On peut changer ou retirer ce logo, quand même.
    expect(champFichier()).toBeTruthy()
    expect(bouton('Retirer le logo')).toBeTruthy()
  })

  it.each([
    ['absent du seau', () => { faux.seau.clear() }, /n’est pas \(ou plus\) rendu par le stockage du dossier/],
    ['refusé', () => { faux.erreurLecture = { __isStorageError: true, status: 403, statusCode: '403', message: 'permission refusée' } }, /Le stockage n’a pas rendu le fichier du logo \(permission refusée\)/],
    ['illisible', () => { faux.seau.set(CHEMIN_A, new Blob([])) }, /n’a pas pu être lu comme une image PNG ou JPEG/],
  ])('%s : une ligne, aucune image, les gestes restent offerts', async (_quoi, preparer, motif) => {
    preparer()
    monter(espace)
    expect(await screen.findByText(motif)).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    expect(champFichier()).toBeTruthy()
    expect(bouton('Retirer le logo')).toBeTruthy()
    expect(bouton('Changer le logo').disabled).toBe(true)
  })

  it('sans logo : « Aucun logo », « Poser ce logo » grisé tant qu’aucun fichier n’est choisi, pas de « Retirer »', async () => {
    faux.versions = [{ ...V1 }]
    monter(espace)
    expect(await (await blocLu()).findByText('Aucun logo n’est posé.')).toBeTruthy()
    expect(faux.telechargements).toEqual([])
    expect(bouton('Poser ce logo').disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Retirer le logo' })).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('sans aucune version : une phrase dit de renseigner d’abord les paramètres, et le logo ne s’offre pas', async () => {
    faux.versions = []
    monter(espace)
    const phrase = await screen.findByText(/Le logo est un champ/)
    expect(phrase.textContent).toBe(espace === 'client'
      ? 'Le logo est un champ de tes paramètres de facturation : renseigne d’abord les paramètres, puis pose ton logo.'
      : 'Le logo est un champ d’une version des paramètres de facturation : renseignez d’abord les paramètres, puis posez le logo.')
    expect(screen.queryByLabelText(/Choisir/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Poser ce logo|Changer le logo|Retirer le logo/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Renseigner les paramètres' })).toBeTruthy()
  })

  it('une lecture des paramètres partielle : ni bloc, ni geste du logo', async () => {
    faux.muetApres = 1
    monter(espace)
    expect(await screen.findByText(/n'ont pas pu être (lus|affichés) en entier/)).toBeTruthy()
    expect(screen.queryByText('Logo des factures')).toBeNull()
    expect(screen.queryByLabelText(/Choisir/)).toBeNull()
    expect(faux.telechargements).toEqual([])
  })

  it('une version dont la lecture n’a pas rendu les colonnes du logo : rien n’en est dit, aucun geste', async () => {
    const sansColonnes = { ...V2 } as Record<string, unknown>
    delete sansColonnes.logo_chemin
    delete sansColonnes.logo_sha256
    faux.versions = [{ ...V1 }, sansColonnes]
    monter(espace)
    expect(await screen.findByText('Le logo de cette version n’a pas été lu avec elle : rien n’en est dit, et aucun geste n’est offert.')).toBeTruthy()
    expect(screen.queryByLabelText(/Choisir/)).toBeNull()
    expect(screen.queryByText(/Aucun logo/)).toBeNull()
    expect(faux.telechargements).toEqual([])
  })

  it('les mots de qui le voit', async () => {
    monter(espace)
    await screen.findByAltText('Logo des factures')
    const texte = (screen.getByText('Logo des factures').closest('.logo-facture') as HTMLElement).textContent ?? ''
    if (espace === 'client') {
      expect(texte).toContain('Ton cabinet voit ce logo et peut le changer, comme toi.')
      expect(motsDuCabinet(texte)).toEqual([])
    } else {
      expect(texte).toContain('Le client qui porte la case « Ventes » voit ce logo et peut le changer, comme vous.')
    }
  })
})

describe('l’image du logo : une adresse d’objet créée, puis révoquée', () => {
  it('révoquée au démontage', async () => {
    const { unmount } = monter('cabinet')
    await screen.findByAltText('Logo des factures')
    expect(faux.urls.map((u) => u.url)).toEqual(['blob:logo-1'])
    expect(faux.revoquees).toEqual([])
    unmount()
    expect(faux.revoquees).toEqual(['blob:logo-1'])
  })

  it('l’aperçu d’un fichier choisi est révoqué avec le bloc', async () => {
    const { unmount } = monter('cabinet')
    await screen.findByAltText('Logo des factures')
    await choisir(png(OCTETS_B))
    const [image, apercu] = faux.urls.map((u) => u.url)
    unmount()
    expect(faux.revoquees.sort()).toEqual([image, apercu].sort())
  })

  it('révoquée quand une version neuve désigne un autre logo : l’ancienne image ne reste pas', async () => {
    monter('cabinet')
    await screen.findByAltText('Logo des factures')
    await choisir(png(OCTETS_B))
    await act(async () => { fireEvent.click(bouton('Changer le logo')) })
    expect(await screen.findByText(/^Logo changé le/)).toBeTruthy()
    const image = (await screen.findByAltText('Logo des factures')) as HTMLImageElement
    // L'image d'avant (1) est révoquée ; l'aperçu du fichier choisi (2) l'est avec le bloc remplacé ; l'image montrée est la dernière.
    expect(faux.revoquees).toContain('blob:logo-1')
    expect(faux.urls.at(-1)?.url).toBe(image.getAttribute('src'))
    expect(faux.revoquees).not.toContain(image.getAttribute('src'))
  })

  it('une réponse tardive d’un autre dossier ne s’affiche pas', async () => {
    const AUTRE = 'a5c00000-0000-4000-8000-0000000000d2'
    const chemin = cheminDuLogo(AUTRE, HB, 'image/png')
    faux.versions = [
      { ...V1 }, { ...V2 },
      { ...V1, id: 'w1', dossier_id: AUTRE },
      { ...V1, id: 'w2', dossier_id: AUTRE, remplace_id: 'w1', logo_chemin: chemin, logo_sha256: HB },
    ]
    faux.seau.set(chemin, new Blob([OCTETS_B]))
    faux.retenirTelechargement = true
    const { rerender } = monter('cabinet')
    await screen.findByText('Chargement du logo…')
    // L'effet qui télécharge passe après le rendu commis : il s'attend (voir « rien avant la lecture du fichier »).
    await waitFor(() => expect(faux.telechargements).toEqual([CHEMIN_A]))
    // On passe à l'autre dossier pendant que le premier téléchargement est en vol.
    rerender(<ParametresVue espace="cabinet" acces={{ etat: 'lus', comptes: [] }} dossierId={AUTRE} />)
    await screen.findByText('Chargement du logo…')
    await ticks()
    expect(faux.telechargements).toEqual([CHEMIN_A, chemin])
    await libererTelechargements()
    const image = await screen.findByAltText('Logo des factures')
    expect(faux.urls).toHaveLength(1)
    expect(faux.urls[0].blob.size).toBe(OCTETS_B.byteLength)
    expect(image.getAttribute('src')).toBe(faux.urls[0].url)
  })
})

describe.each(['cabinet', 'client'] as const)('choisir un fichier ne fait rien partir (%s)', (espace) => {
  it('un format non pris en charge : dit tout de suite, rien ne part', async () => {
    monter(espace)
    await screen.findByAltText('Logo des factures')
    await choisir(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'logo.png', { type: 'image/png' }), /^Ce logo n’est pas pris/)
    expect(bloc().getByRole('alert').textContent).toBe('Ce logo n’est pas pris : format non pris en charge (un logo de facture se dépose en PNG ou en JPEG).')
    expect(bouton('Changer le logo').disabled).toBe(true)
    expect(screen.queryByAltText('Aperçu du logo choisi')).toBeNull()
    expect(faux.depots).toEqual([])
    expect(faux.rpcs).toEqual([])
  })

  it('un poids au-delà de la borne : dit tout de suite, avec le poids et la borne', async () => {
    monter(espace)
    await screen.findByAltText('Logo des factures')
    await choisir(png(logoDe(TAILLE_MAX.ventes)), /^Ce logo n’est pas pris/)
    expect(lisible(bloc().getByRole('alert').textContent)).toBe('Ce logo n’est pas pris : il pèse 500,1 Ko, au-delà des 500 Ko qu’un logo de facture peut peser.')
    expect(bouton('Changer le logo').disabled).toBe(true)
    expect(faux.depots).toEqual([])
    expect(faux.rpcs).toEqual([])
  })

  it('un fichier valide : un aperçu local et ce qu’il fera — rien n’est enregistré avant le clic', async () => {
    monter(espace)
    await screen.findByAltText('Logo des factures')
    await choisir(png(OCTETS_B))
    const apercu = (await screen.findByAltText('Aperçu du logo choisi')) as HTMLImageElement
    expect(apercu.getAttribute('src')).toBe(faux.urls.at(-1)?.url)
    expect(lisible(bloc().getByText(/^Logo choisi/).textContent)).toBe(`Logo choisi : PNG · ${OCTETS_B.byteLength} octets. Rien n’est enregistré avant « Changer le logo ».`)
    expect(bouton('Changer le logo').disabled).toBe(false)
    await ticks()
    expect(faux.depots).toEqual([])
    expect(faux.rpcs).toEqual([])
    expect(faux.journal).toEqual([])
  })

  it('l’aperçu du fichier choisi est révoqué quand on en choisit un autre', async () => {
    monter(espace)
    await screen.findByAltText('Logo des factures')
    await choisir(png(OCTETS_B))
    await screen.findByAltText('Aperçu du logo choisi')
    const premier = faux.urls.at(-1)?.url
    await choisir(png(logoDe(5)))
    await screen.findByAltText('Aperçu du logo choisi')
    expect(faux.revoquees).toContain(premier)
  })

  it('un fichier choisi puis remplacé avant la fin de son jugement : seule la réponse du dernier compte', async () => {
    monter(espace)
    await screen.findByAltText('Logo des factures')
    // Le premier fichier est jugé lentement (sa signature se lit après 60 ms) : le second, choisi ensuite, finit avant lui.
    const lent = png(logoDe(7))
    const vraiSlice = lent.slice.bind(lent)
    Object.defineProperty(lent, 'slice', {
      value: (debut: number, fin: number) => {
        const morceau = vraiSlice(debut, fin)
        return { arrayBuffer: async () => { await new Promise<void>((r) => setTimeout(r, 60)); return morceau.arrayBuffer() } }
      },
    })
    await act(async () => {
      fireEvent.change(champFichier(), { target: { files: [lent] } })
      fireEvent.change(champFichier(), { target: { files: [png(OCTETS_B)] } })
    })
    await bloc().findByText(/^Logo choisi/)
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 150)) })
    expect(lisible(bloc().getByText(/^Logo choisi/).textContent)).toContain(`PNG · ${OCTETS_B.byteLength} octets`)
    expect(bloc().getAllByRole('img').filter((i) => i.getAttribute('alt') === 'Aperçu du logo choisi')).toHaveLength(1)
    // Le premier choix n'a créé aucune adresse : l'image du logo, et l'aperçu du second.
    expect(faux.urls).toHaveLength(2)
  })

  it('un fichier qu’on ne peut pas lire : dit, rien ne part', async () => {
    monter(espace)
    await screen.findByAltText('Logo des factures')
    const illisible = png(OCTETS_B)
    Object.defineProperty(illisible, 'slice', { value: () => { throw new Error('disque illisible') } })
    await choisir(illisible, /^Ce fichier n’a pas pu être lu/)
    expect(bloc().getByRole('alert').textContent).toBe('Ce fichier n’a pas pu être lu : disque illisible.')
    expect(bouton('Changer le logo').disabled).toBe(true)
    expect(faux.depots).toEqual([])
  })

  it('renoncer au choix (aucun fichier) : l’aperçu part et son adresse est révoquée, le geste se grise', async () => {
    monter(espace)
    await screen.findByAltText('Logo des factures')
    await choisir(png(OCTETS_B))
    const apercu = faux.urls.at(-1)?.url
    expect(bouton('Changer le logo').disabled).toBe(false)
    await act(async () => { fireEvent.change(champFichier(), { target: { files: [] } }) })
    expect(screen.queryByAltText('Aperçu du logo choisi')).toBeNull()
    expect(screen.queryByText(/^Logo choisi/)).toBeNull()
    expect(faux.revoquees).toContain(apercu)
    expect(bouton('Changer le logo').disabled).toBe(true)
  })

  it('le fichier déjà posé : rien à poser, et rien ne part', async () => {
    monter(espace)
    await screen.findByAltText('Logo des factures')
    await choisir(png(OCTETS_A))
    expect(await bloc().findByText(PHRASE_LOGO_IDENTIQUE)).toBeTruthy()
    expect(bouton('Changer le logo').disabled).toBe(true)
    await act(async () => { fireEvent.click(bouton('Changer le logo')) })
    expect(faux.depots).toEqual([])
    expect(faux.rpcs).toEqual([])
  })

  it('le refus que la base opposerait à la version neuve se dit AVANT le clic, le bouton est grisé', async () => {
    // Une courante que la base ne réenregistrerait pas telle quelle (un IBAN qui n'en est pas un).
    faux.versions = [{ ...V1, iban: 'pas un iban' }, { ...V2, iban: 'pas un iban' }]
    monter(espace)
    await screen.findByAltText('Logo des factures')
    await choisir(png(OCTETS_B))
    const refus = await bloc().findByText(/IBAN/)
    expect(refus.className).toBe('error-text')
    expect(bouton('Changer le logo').disabled).toBe(true)
    await act(async () => { fireEvent.click(bouton('Changer le logo')) })
    expect(faux.depots).toEqual([])
    expect(faux.rpcs).toEqual([])
    // Seconde ceinture : même un gestionnaire atteint malgré le bouton grisé ne dépose rien, et dit le refus.
    await act(async () => { declencher(bouton('Changer le logo')) })
    expect(faux.depots).toEqual([])
    expect(faux.rpcs).toEqual([])
    expect(bloc().getByRole('alert').textContent).toMatch(/IBAN/)
  })
})

describe.each(['cabinet', 'client'] as const)('poser ou changer le logo : le fichier, PUIS une version qui ne change que lui (%s)', (espace) => {
  const attendu = (chemin: string, empreinte: string) => ({
    delai_paiement_jours: 45, moyen_prefere: 'virement', escompte: 'Pas d’escompte.', penalites: 'Trois fois le taux légal.',
    mentions_complementaires: 'Une mention.', pied_de_page: 'Un pied de page.', iban: IBAN, bic: 'ESSAFR10', titulaire_compte: 'Atelier fictif',
    logo_chemin: chemin, logo_sha256: empreinte,
  })

  it('poser un premier logo : le dépôt, puis la version ; tous les autres champs repris, le RIB proposé reste proposé ; la vue relue', async () => {
    faux.versions = [{ ...V1 }]
    faux.seau.clear()
    monter(espace)
    await (await blocLu()).findByText('Aucun logo n’est posé.')
    await choisir(png(OCTETS_B))
    const avant = faux.lectures
    await cliquer('Poser ce logo', /^Logo posé le/)
    expect(faux.journal).toEqual(['depot', 'version'])
    // Le dépôt : sous le nom d'empreinte, sans mise à jour, sous le type que prouve la signature.
    expect(faux.depots).toEqual([{ chemin: CHEMIN_B, type: 'image/png', upsert: false }])
    // La version : celle de la courante, tous ses champs, et le logo.
    expect(faux.rpcs).toEqual([{
      nom: 'enregistrer_parametres_facturation',
      params: { p_dossier_id: D, p_remplace_id: 'v1', p_parametres: attendu(CHEMIN_B, HB) },
    }])
    const ecrite = faux.versions.at(-1) as unknown as ParametresFacturation
    expect(champsChanges(ecrite, V1)).toEqual(['Logo posé'])
    expect(ecrite.rib_etat).toBe('propose')
    expect(ecrite.rib_confirme_par).toBeNull()
    // La vue relue : le message, l'image du nouveau logo, « Changer le logo » à la place de « Poser ce logo ».
    expect(faux.lectures).toBe(avant + 1)
    expect(await screen.findByText('Logo posé le 20/11/2027 à 11:00.')).toBeTruthy()
    expect(await screen.findByAltText('Logo des factures')).toBeTruthy()
    expect(faux.telechargements).toEqual([CHEMIN_B])
    expect(screen.queryByRole('button', { name: 'Poser ce logo' })).toBeNull()
    expect(bouton('Changer le logo')).toBeTruthy()
    expect(screen.queryByAltText('Aperçu du logo choisi')).toBeNull()
  })

  it('changer le logo : seul le logo diffère de la version remplacée', async () => {
    monter(espace)
    await screen.findByAltText('Logo des factures')
    await choisir(png(OCTETS_B))
    await cliquer('Changer le logo', /^Logo changé le/)
    expect(faux.journal).toEqual(['depot', 'version'])
    expect(faux.rpcs[0].params).toEqual({ p_dossier_id: D, p_remplace_id: 'v2', p_parametres: attendu(CHEMIN_B, HB) })
    const ecrite = faux.versions.at(-1) as unknown as ParametresFacturation
    expect(champsChanges(ecrite, V2)).toEqual(['Logo changé'])
    expect(await screen.findByText('Logo changé le 20/11/2027 à 11:00.')).toBeTruthy()
    // Le logo A reste dans le seau : un logo qu'aucune version ne désigne plus n'est pas supprimé.
    expect(faux.seau.has(CHEMIN_A)).toBe(true)
    expect(faux.seau.has(CHEMIN_B)).toBe(true)
  })

  it('trois clics du même rendu : un seul dépôt, une seule version', async () => {
    monter(espace)
    await screen.findByAltText('Logo des factures')
    await choisir(png(OCTETS_B))
    const poser = bouton('Changer le logo')
    await act(async () => {
      fireEvent.click(poser)
      fireEvent.click(poser)
      fireEvent.click(poser)
    })
    expect(await screen.findByText(/^Logo changé le/)).toBeTruthy()
    expect(faux.depots).toHaveLength(1)
    expect(faux.rpcs).toHaveLength(1)
  })

  it('le verrou tient jusqu’à la fin de la relecture : un clic entre l’écriture et la relecture n’écrit rien de plus', async () => {
    monter(espace)
    await screen.findByAltText('Logo des factures')
    await choisir(png(OCTETS_B))
    const poser = bouton('Changer le logo')
    // La relecture des paramètres est retenue ; le bouton, lui, n'est pas encore rendu grisé dans cet `act`.
    faux.retenirLecture = true
    await act(async () => {
      fireEvent.click(poser)
      // On attend que la version soit écrite : la relecture, retenue, n'a pas fini.
      for (let i = 0; i < 400 && faux.rpcs.length === 0; i++) await new Promise<void>((r) => setTimeout(r, 5))
      expect(faux.rpcs).toHaveLength(1)
      await new Promise<void>((r) => setTimeout(r, 30))
      // Le bouton est grisé depuis longtemps ; le gestionnaire, lui, est atteint : le verrou seul l'arrête.
      declencher(poser)
      await new Promise<void>((r) => setTimeout(r, 120))
    })
    expect(faux.lecturesEnAttente.length).toBeGreaterThan(0)
    expect(faux.depots).toHaveLength(1)
    expect(faux.rpcs).toHaveLength(1)
    await libererLecture()
    expect(await screen.findByText(/^Logo changé le/)).toBeTruthy()
    expect(faux.depots).toHaveLength(1)
    expect(faux.rpcs).toHaveLength(1)
  })

  it('un fichier déjà dans le seau, de la même empreinte : relu, vérifié, désigné — sans nouveau dépôt', async () => {
    faux.seau.set(CHEMIN_B, new Blob([OCTETS_B]))
    monter(espace)
    await screen.findByAltText('Logo des factures')
    await choisir(png(OCTETS_B))
    await cliquer('Changer le logo', /^Logo changé le/)
    // Le dépôt a buté sur l'unicité, le fichier qui y est a été téléchargé, puis la version a été écrite.
    expect(faux.journal).toEqual(['depot', 'version'])
    expect(faux.telechargements).toContain(CHEMIN_B)
    expect(faux.rpcs[0].params).toEqual({ p_dossier_id: D, p_remplace_id: 'v2', p_parametres: attendu(CHEMIN_B, HB) })
    expect(await screen.findByText(/^Logo changé le 20\/11\/2027 à 11:00\. Le fichier était déjà dans l’espace du dossier/)).toBeTruthy()
  })

  it('un fichier déjà dans le seau sous ce nom, mais d’une autre empreinte : refusé, dit, aucune version', async () => {
    faux.seau.set(CHEMIN_B, new Blob([logoDe(9)]))
    monter(espace)
    await screen.findByAltText('Logo des factures')
    await choisir(png(OCTETS_B))
    await act(async () => { fireEvent.click(bouton('Changer le logo')) })
    const alerte = await bloc().findByRole('alert')
    expect(faux.journal).toEqual(['depot'])
    expect(faux.rpcs).toEqual([])
    expect(alerte.textContent).toBe('Un fichier de ce nom est déjà dans l’espace du dossier, mais ce n’est pas ce logo (son empreinte diffère) : rien n’est enregistré.')
    expect(bouton('Changer le logo').disabled).toBe(false)
  })

  it('un dépôt refusé par le stockage : dit sous ses mots, aucune version, rien dans le seau', async () => {
    faux.erreurDepot = { __isStorageError: true, status: 403, statusCode: '403', message: 'new row violates row-level security policy' }
    monter(espace)
    await screen.findByAltText('Logo des factures')
    await choisir(png(OCTETS_B))
    await act(async () => { fireEvent.click(bouton('Changer le logo')) })
    expect((await bloc().findByRole('alert')).textContent).toBe('new row violates row-level security policy')
    expect(faux.rpcs).toEqual([])
    expect(faux.seau.has(CHEMIN_B)).toBe(false)
    expect(faux.versions).toHaveLength(2)
  })

  it('un dépôt réussi dont la version est refusée : le fichier reste dans le seau, les paramètres ne sont pas enregistrés, et la vue le dit', async () => {
    faux.refusRpc = 'Le logo n’est pas dans le seau des ventes du dossier : le déposer d’abord.'
    monter(espace)
    await screen.findByAltText('Logo des factures')
    await choisir(png(OCTETS_B))
    const avant = faux.lectures
    await act(async () => { fireEvent.click(bouton('Changer le logo')) })
    const alerte = (await bloc().findByRole('alert')).textContent ?? ''
    expect(faux.journal).toEqual(['depot', 'version'])
    expect(alerte).toBe(
      'Le fichier du logo est déposé dans l’espace du dossier, mais les paramètres n’ont pas été enregistrés : Le logo n’est pas dans le seau des ventes du dossier : le déposer d’abord. '
      + (espace === 'client' ? 'Le fichier y reste ; tu peux réessayer.' : 'Le fichier y reste ; vous pouvez réessayer.'),
    )
    if (espace === 'client') expect(motsDuCabinet(alerte)).toEqual([])
    expect(faux.seau.has(CHEMIN_B)).toBe(true)
    expect(faux.versions).toHaveLength(2)
    // La vue est relue même sur un refus, et rendue au geste : on peut réessayer.
    expect(faux.lectures).toBe(avant + 1)
    expect(bouton('Changer le logo').disabled).toBe(false)
  })
})

describe.each(['cabinet', 'client'] as const)('retirer le logo, après une confirmation dans la page (%s)', (espace) => {
  const ouvrir = async () => {
    monter(espace)
    await screen.findByAltText('Logo des factures')
    fireEvent.click(bouton('Retirer le logo'))
    return screen.getByRole('alertdialog')
  }

  it('la confirmation dit ce qui change, ce qui reste et ce que les factures ne font pas encore ; annuler n’écrit rien', async () => {
    const dialogue = await ouvrir()
    expect(within(dialogue).getByRole('heading', { name: 'Retirer le logo' })).toBeTruthy()
    const texte = dialogue.textContent ?? ''
    expect(texte).toContain('Une version nouvelle des paramètres est enregistrée, sans logo ; les autres champs ne changent pas.')
    expect(texte).toContain('Le fichier reste dans l’espace du dossier : il n’est pas supprimé, et l’historique des paramètres garde la trace de ce retrait (« Logo retiré »).')
    expect(texte).toContain('Aucune facture n’imprime encore ce logo : elles le feront avec une étape à venir.')
    if (espace === 'client') expect(motsDuCabinet(texte)).toEqual([])
    expect(faux.rpcs).toEqual([])
    fireEvent.click(within(dialogue).getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(faux.rpcs).toEqual([])
    expect(faux.depots).toEqual([])
  })

  it('confirmer : une version sans logo, les autres champs repris, le fichier gardé, la vue relue', async () => {
    const dialogue = await ouvrir()
    const avant = faux.lectures
    await act(async () => { fireEvent.click(within(dialogue).getByRole('button', { name: 'Retirer le logo' })) })
    expect(faux.rpcs).toHaveLength(1)
    const { p_dossier_id, p_remplace_id, p_parametres } = faux.rpcs[0].params as { p_dossier_id: string; p_remplace_id: string; p_parametres: Record<string, unknown> }
    expect([p_dossier_id, p_remplace_id]).toEqual([D, 'v2'])
    // Aucune clé de logo : une clé absente vaut « aucun logo ».
    expect(p_parametres).toEqual({
      delai_paiement_jours: 45, moyen_prefere: 'virement', escompte: 'Pas d’escompte.', penalites: 'Trois fois le taux légal.',
      mentions_complementaires: 'Une mention.', pied_de_page: 'Un pied de page.', iban: IBAN, bic: 'ESSAFR10', titulaire_compte: 'Atelier fictif',
    })
    const ecrite = faux.versions.at(-1) as unknown as ParametresFacturation
    expect(champsChanges(ecrite, V2)).toEqual(['Logo retiré'])
    expect(ecrite.rib_etat).toBe('propose')
    // Le fichier reste dans le seau ; rien n'y est supprimé.
    expect(faux.seau.has(CHEMIN_A)).toBe(true)
    expect(faux.lectures).toBe(avant + 1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(await screen.findByText('Logo retiré le 20/11/2027 à 11:00.')).toBeTruthy()
    expect(await bloc().findByText('Aucun logo n’est posé.')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retirer le logo' })).toBeNull()
  })

  it('trois clics du même rendu : une seule version', async () => {
    const dialogue = await ouvrir()
    const confirmer = within(dialogue).getByRole('button', { name: 'Retirer le logo' })
    await act(async () => {
      fireEvent.click(confirmer)
      fireEvent.click(confirmer)
      fireEvent.click(confirmer)
    })
    expect(faux.rpcs).toHaveLength(1)
    expect(await screen.findByText(/^Logo retiré le/)).toBeTruthy()
    expect(faux.rpcs).toHaveLength(1)
  })

  it('un refus de la base : dit dans la confirmation, qui reste ouverte ; la vue relue', async () => {
    const dialogue = await ouvrir()
    faux.refusRpc = 'Accès refusé.'
    const avant = faux.lectures
    await act(async () => { fireEvent.click(within(dialogue).getByRole('button', { name: 'Retirer le logo' })) })
    expect(faux.lectures).toBe(avant + 1)
    expect(within(screen.getByRole('alertdialog')).getByRole('alert').textContent).toBe('Accès refusé.')
    expect(faux.versions).toHaveLength(2)
  })

  it('la seconde ceinture : un gestionnaire atteint malgré le bouton grisé n’écrit rien', async () => {
    const dialogue = await ouvrir()
    faux.refusRpc = 'Autre refus.'
    faux.versions = [...faux.versions, { ...V2, id: 'v9', remplace_id: 'v2', cree_le: '2027-10-05T09:00:00Z' }]
    await act(async () => { fireEvent.click(within(dialogue).getByRole('button', { name: 'Retirer le logo' })) })
    expect(faux.rpcs).toHaveLength(1)
    const grise = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Retirer le logo' })
    expect((grise as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { declencher(grise) })
    expect(faux.rpcs).toHaveLength(1)
  })

  it('une autre version passée entre-temps : le refus est dit avant le clic, le bouton grisé', async () => {
    const dialogue = await ouvrir()
    faux.refusRpc = 'Autre refus.'
    // Quelqu'un a enregistré une version pendant que la confirmation était ouverte : la relecture la voit.
    faux.versions = [...faux.versions, { ...V2, id: 'v9', remplace_id: 'v2', cree_le: '2027-10-05T09:00:00Z' }]
    await act(async () => { fireEvent.click(within(dialogue).getByRole('button', { name: 'Retirer le logo' })) })
    const ouvert = screen.getByRole('alertdialog')
    expect((within(ouvert).getByRole('button', { name: 'Retirer le logo' }) as HTMLButtonElement).disabled).toBe(true)
    expect(ouvert.textContent).toMatch(/enregistrés entre-temps/)
  })
})

// Étape A5c2b : REDÉPOSER LE FICHIER que la version courante désigne quand le seau ne le rend plus (une restauration faite d'une
// sauvegarde qui ne le portait pas). Choisir CE fichier — la même empreinte — n'est pas un changement de logo : le dépôt seul,
// au chemin que la version désigne, sans écrasement, aucune version ; puis le bloc relit le fichier. Offert seulement quand la
// relecture a dit le fichier ABSENT.
describe.each(['cabinet', 'client'] as const)('redéposer le fichier que la version désigne, absent du seau (%s)', (espace) => {
  const absent = /n’est pas \(ou plus\) rendu par le stockage du dossier/

  it('le même fichier choisi : « Redéposer le fichier », dit avant le clic ; rien ne part avant lui', async () => {
    faux.seau.clear()
    monter(espace)
    await screen.findByText(absent)
    await choisir(png(OCTETS_A))
    expect(bloc().getByText(PHRASE_REDEPOT).className).toBe('note-info')
    expect(bloc().queryByText(PHRASE_LOGO_IDENTIQUE)).toBeNull()
    // Le seul geste qui a un sens : « Changer le logo » n'aurait rien à changer.
    expect(screen.queryByRole('button', { name: 'Changer le logo' })).toBeNull()
    expect(bouton('Redéposer le fichier').disabled).toBe(false)
    expect(lisible(bloc().getByText(/^Logo choisi/).textContent))
      .toBe(`Logo choisi : PNG · ${OCTETS_A.byteLength} octets. Rien n’est enregistré avant « Redéposer le fichier ».`)
    await ticks()
    expect(faux.depots).toEqual([])
    expect(faux.rpcs).toEqual([])
  })

  it('le clic : le dépôt seul, au chemin de la version, sans écrasement, aucune version ; le bloc relit le fichier et le montre', async () => {
    faux.seau.clear()
    monter(espace)
    await screen.findByText(absent)
    await choisir(png(OCTETS_A))
    const avant = faux.lectures
    await cliquer('Redéposer le fichier', /^Fichier du logo redéposé/)
    expect(faux.journal).toEqual(['depot'])
    expect(faux.depots).toEqual([{ chemin: CHEMIN_A, type: 'image/png', upsert: false }])
    expect(faux.rpcs).toEqual([])
    expect(faux.versions).toHaveLength(2)
    // La vue relue sous le verrou, puis le bloc reparti : il relit le fichier, le vérifie et le montre.
    expect(faux.lectures).toBe(avant + 1)
    expect(await screen.findByAltText('Logo des factures')).toBeTruthy()
    expect(faux.telechargements).toEqual([CHEMIN_A, CHEMIN_A])
    expect(screen.queryByText(absent)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Redéposer le fichier' })).toBeNull()
    expect(screen.queryByAltText('Aperçu du logo choisi')).toBeNull()
    expect(bouton('Changer le logo')).toBeTruthy()
    const message = screen.getByRole('status').textContent ?? ''
    expect(message).toBe('Fichier du logo redéposé dans l’espace du dossier, sous le nom que la version désigne : aucune version '
      + 'nouvelle des paramètres n’a été enregistrée.')
    if (espace === 'client') expect(motsDuCabinet(`${message} ${PHRASE_REDEPOT}`)).toEqual([])
  })

  it('trois clics du même rendu : un seul dépôt', async () => {
    faux.seau.clear()
    monter(espace)
    await screen.findByText(absent)
    await choisir(png(OCTETS_A))
    const redeposer = bouton('Redéposer le fichier')
    await act(async () => {
      fireEvent.click(redeposer)
      fireEvent.click(redeposer)
      fireEvent.click(redeposer)
    })
    expect(await screen.findByText(/^Fichier du logo redéposé/)).toBeTruthy()
    expect(faux.depots).toHaveLength(1)
    expect(faux.rpcs).toEqual([])
  })

  it('le verrou tient jusqu’à la fin de la relecture : un clic entre le dépôt et la relecture ne dépose rien de plus', async () => {
    faux.seau.clear()
    monter(espace)
    await screen.findByText(absent)
    await choisir(png(OCTETS_A))
    const redeposer = bouton('Redéposer le fichier')
    faux.retenirLecture = true
    await act(async () => {
      fireEvent.click(redeposer)
      for (let i = 0; i < 400 && faux.depots.length === 0; i++) await new Promise<void>((r) => setTimeout(r, 5))
      expect(faux.depots).toHaveLength(1)
      await new Promise<void>((r) => setTimeout(r, 30))
      // Le gestionnaire du bouton d'avant est atteint : le verrou seul l'arrête.
      declencher(redeposer)
      await new Promise<void>((r) => setTimeout(r, 120))
    })
    expect(faux.lecturesEnAttente.length).toBeGreaterThan(0)
    expect(faux.depots).toHaveLength(1)
    await libererLecture()
    expect(await screen.findByText(/^Fichier du logo redéposé/)).toBeTruthy()
    expect(faux.depots).toHaveLength(1)
  })

  it('un dépôt refusé par le stockage : dit dans le bloc, aucune version, le geste reste offert pour réessayer', async () => {
    faux.seau.clear()
    faux.erreurDepot = { __isStorageError: true, status: 403, statusCode: '403', message: 'new row violates row-level security policy' }
    monter(espace)
    await screen.findByText(absent)
    await choisir(png(OCTETS_A))
    await act(async () => { fireEvent.click(bouton('Redéposer le fichier')) })
    expect((await bloc().findByRole('alert')).textContent).toBe('new row violates row-level security policy')
    expect(faux.rpcs).toEqual([])
    expect(faux.seau.has(CHEMIN_A)).toBe(false)
    expect(bouton('Redéposer le fichier').disabled).toBe(false)
  })

  it('le fichier revenu entre-temps, le même : relu, vérifié, « déjà là », rien de déposé', async () => {
    faux.seau.clear()
    monter(espace)
    await screen.findByText(absent)
    await choisir(png(OCTETS_A))
    faux.seau.set(CHEMIN_A, new Blob([OCTETS_A]))
    await cliquer('Redéposer le fichier', /^Le fichier du logo était déjà dans l’espace du dossier/)
    expect(faux.depots).toHaveLength(1)
    expect(faux.rpcs).toEqual([])
    expect(await screen.findByAltText('Logo des factures')).toBeTruthy()
  })

  it('avant le retour de la relecture du fichier : le même fichier ne propose rien ; « absent » revenu, le redépôt s’offre', async () => {
    faux.seau.clear()
    faux.retenirTelechargement = true
    monter(espace)
    await screen.findByText('Chargement du logo…')
    await choisir(png(OCTETS_A))
    expect(bloc().getByText(PHRASE_LOGO_IDENTIQUE)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Redéposer le fichier' })).toBeNull()
    await libererTelechargements()
    expect(await bloc().findByText(PHRASE_REDEPOT)).toBeTruthy()
    expect(bouton('Redéposer le fichier').disabled).toBe(false)
  })

  it.each([
    ['présent et vérifié', () => {}],
    ['refusé', () => { faux.erreurLecture = { __isStorageError: true, status: 403, statusCode: '403', message: 'permission refusée' } }],
    ['illisible', () => { faux.seau.set(CHEMIN_A, new Blob([])) }],
    ['d’une autre empreinte', () => { faux.seau.set(CHEMIN_A, new Blob([OCTETS_B])) }],
  ])('le fichier %s : le même fichier n’offre aucun redépôt', async (_quoi, preparer) => {
    preparer()
    monter(espace)
    await screen.findByText(/^(PNG ·|Le stockage n’a pas rendu|Le fichier du logo a été rendu|Le fichier rendu n’est pas celui)/)
    await choisir(png(OCTETS_A))
    expect(bloc().getByText(PHRASE_LOGO_IDENTIQUE)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Redéposer le fichier' })).toBeNull()
    expect(bouton('Changer le logo').disabled).toBe(true)
  })

  it('un AUTRE fichier, le logo désigné absent : c’est un changement de logo, comme avant', async () => {
    faux.seau.clear()
    monter(espace)
    await screen.findByText(absent)
    await choisir(png(OCTETS_B))
    expect(screen.queryByRole('button', { name: 'Redéposer le fichier' })).toBeNull()
    expect(bloc().queryByText(PHRASE_REDEPOT)).toBeNull()
    await cliquer('Changer le logo', /^Logo changé le/)
    expect(faux.journal).toEqual(['depot', 'version'])
  })
})

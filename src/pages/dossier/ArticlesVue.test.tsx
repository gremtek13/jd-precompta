import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ArticlesVue from './ArticlesVue'
import { motsDuCabinet } from '../../lib/espaceVentes'
import {
  LIBELLE_DESCRIPTION_ARTICLE, LIBELLE_DESCRIPTION_ARTICLE_CLIENT, LIBELLE_DESIGNATION_ARTICLE, LIBELLE_DESIGNATION_ARTICLE_CLIENT,
} from '../../lib/droitsAcces'
import type { AccesDuDossier } from '../../lib/auteursVentes'
import { article } from '../../test/articles'
import type { Article } from '../../lib/types'

// « ARTICLES » (espace client, étape A2a) : la vue montée pour le cabinet et pour le client « Ventes », sous un faux client qui
// APPLIQUE les filtres (src/test/filtresPostgrest.ts) et dont les trois fonctions de la base écrivent la table d'essai.
// Ce que ces cas gardent, et qu'aucun calcul pur ne voit :
//  1. avant la lecture, ni « aucun », ni tableau, ni geste ; lue vide en entier, elle le dit ; lue en partie ou refusée, le
//     bandeau (ou le message) et AUCUN geste ;
//  2. la liste dans les deux espaces — le prix jamais arrondi, les retirés derrière leur filtre, « par le client » au cabinet
//     seul, la recherche sur la référence et la désignation, « N sur M » ;
//  3. chaque geste : ce que la base reçoit, son refus dit AVANT le clic sous les mots du module, le refus de la base dit sous
//     ses mots, la liste relue après une écriture réussie comme après un refus ;
//  4. UN verrou pour les trois gestes : trois clics du même rendu, une seule écriture ; relâché après la relecture ;
//  5. les libellés des textes que le client lit (cabinet) et ceux de son espace (client : tutoiement, aucun mot du cabinet).
// Données FICTIVES.

const faux = vi.hoisted(() => ({
  articles: [] as Record<string, unknown>[],
  muetApres: Infinity,
  leve: false,
  lectures: 0,
  ecritures: [] as string[],
  rpcs: [] as { nom: string; params: Record<string, unknown> }[],
  refus: {} as Record<string, string>,
  retenirLecture: false,
  lecturesEnAttente: [] as (() => void)[],
  retenirRpc: false,
  rpcEnAttente: [] as (() => void)[],
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  const instant = '2027-11-20T10:00:00Z'
  return {
    supabase: {
      rpc: async (nom: string, params: Record<string, unknown>) => {
        faux.rpcs.push({ nom, params })
        if (faux.retenirRpc) await new Promise<void>((r) => { faux.rpcEnAttente.push(r) })
        const refus = faux.refus[nom]
        if (refus) return { data: null, error: { message: refus } }
        const id = params.p_article_id as string | null
        const existant = faux.articles.find((a) => a.id === id)
        if (nom === 'enregistrer_article') {
          const ecrit = existant
            ? { ...existant, ...(params.p_article as object), modifie_par: 'u-moi', modifie_le: instant }
            : { id: `neuf-${faux.articles.length + 1}`, dossier_id: params.p_dossier_id, retire_le: null, retire_par: null, cree_par: 'u-moi',
              cree_le: instant, modifie_par: null, modifie_le: null, ...(params.p_article as object) }
          faux.articles = existant ? faux.articles.map((a) => (a.id === id ? ecrit : a)) : [...faux.articles, ecrit]
          return { data: ecrit, error: null }
        }
        if (!existant) return { data: null, error: { message: 'Article introuvable dans ce dossier.' } }
        const ecrit = nom === 'retirer_article'
          ? { ...existant, retire_le: instant, retire_par: 'u-moi' }
          : { ...existant, retire_le: null, retire_par: null, modifie_par: 'u-moi', modifie_le: instant }
        faux.articles = faux.articles.map((a) => (a.id === id ? ecrit : a))
        return { data: ecrit, error: null }
      },
      from: (table: string) => {
        if (table !== 'articles') throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: Predicat[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        let ecriture: string | null = null
        const partir = () => {
          if (ecriture) { faux.ecritures.push(`${table} ${ecriture}`); return { data: null, error: null } }
          if (faux.leve) throw new Error('réseau coupé')
          faux.lectures += 1
          const toutes = filtrer(faux.articles, predicats)
          return { data: toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres)), error: null, count: toutes.length }
        }
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          update: () => { ecriture = 'update'; return c },
          delete: () => { ecriture = 'delete'; return c },
          insert: () => { ecriture = 'insert'; return c },
          upsert: () => { ecriture = 'upsert'; return c },
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
const nues = (lignes: readonly Article[]): Record<string, unknown>[] => lignes.map((l) => ({ ...l }))

// Trois articles en cours, deux retirés. A2 et A4 sont du client (le dernier geste est le sien) ; A3, créé par le client, a
// été modifié ensuite par le cabinet ; A5 a été retiré par le cabinet.
const A1 = article({ id: 'a1', reference: 'CONS-01', designation: 'Consultation de conseil', description: 'Séance d’une heure', unite: 'HUR', prix_unitaire_ht: 60 })
const A2 = article({
  id: 'a2', reference: 'PIECE-1', designation: 'Pièce détachée', unite: 'H87', prix_unitaire_ht: 0.123456, taux_tva: 5.5, nature: 'biens', cree_par: 'u-client',
})
const A3 = article({
  id: 'a3', reference: null, designation: 'Forfait mensuel', unite: 'MON', prix_unitaire_ht: 1234.5, cree_par: 'u-client',
  modifie_par: 'u-cabinet', modifie_le: '2027-10-02T09:00:00Z',
})
const A4 = article({
  id: 'a4', reference: 'ANCIEN', designation: 'Ancienne prestation', cree_par: 'u-cabinet', retire_par: 'u-client', retire_le: '2027-10-05T08:00:00Z',
})
const A5 = article({
  id: 'a5', reference: 'OLD-2', designation: 'Autre ancienne prestation', cree_par: 'u-client', retire_par: 'u-cabinet', retire_le: '2027-10-06T08:00:00Z',
})
const AUTRE_DOSSIER = article({ id: 'x9', dossier_id: 'd2', reference: 'CONS-01', designation: 'Article d’un autre dossier' })

const ACCES_LUS: AccesDuDossier = { etat: 'lus', comptes: ['u-client'] }

const lisible = (t: string | null) => (t ?? '').replace(/[  ]/g, ' ')

async function monter(espace: 'cabinet' | 'client', acces: AccesDuDossier = ACCES_LUS) {
  render(espace === 'client'
    ? <ArticlesVue espace="client" dossierId="d1" />
    : <ArticlesVue espace="cabinet" acces={acces} dossierId="d1" />)
  await screen.findByRole('table', { name: 'Articles' })
}

const tableau = () => screen.findByRole('table', { name: 'Articles' })
const lignes = async () => within(await tableau()).getAllByRole('row').slice(1)
const ligneDe = async (texte: string) => (await lignes()).find((r) => r.textContent?.includes(texte)) as HTMLElement
const bouton = (nom: string | RegExp) => screen.getByRole('button', { name: nom }) as HTMLButtonElement
const rechercher = (valeur: string) =>
  fireEvent.change(screen.getByPlaceholderText('Rechercher une référence, une désignation…'), { target: { value: valeur } })
const champ = (libelle: string | RegExp) => screen.getByLabelText(libelle) as HTMLInputElement

function remplirUnArticleNeuf() {
  fireEvent.change(champ('Référence (facultative)'), { target: { value: 'NEUF-01' } })
  fireEvent.change(champ(LIBELLE_DESIGNATION_ARTICLE), { target: { value: 'Article neuf' } })
  fireEvent.change(champ('Prix hors taxes (€)'), { target: { value: '12,50' } })
  fireEvent.change(champ('Taux de TVA'), { target: { value: '5.5' } })
  fireEvent.change(champ('Nature'), { target: { value: 'biens' } })
}

beforeEach(() => {
  faux.articles = nues([A1, A2, A3, A4, A5, AUTRE_DOSSIER])
  faux.muetApres = Infinity
  faux.leve = false
  faux.lectures = 0
  faux.ecritures = []
  faux.rpcs = []
  faux.refus = {}
  faux.retenirLecture = false
  faux.lecturesEnAttente = []
  faux.retenirRpc = false
  faux.rpcEnAttente = []
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Articles — avant et après la lecture', () => {
  it('avant sa lecture : « Chargement… », ni « aucun », ni tableau, ni geste ; revenue, les lignes', async () => {
    faux.retenirLecture = true
    render(<ArticlesVue espace="cabinet" acces={ACCES_LUS} dossierId="d1" />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByText(/aucun/i)).toBeNull()
    expect(screen.queryByRole('table', { name: 'Articles' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Nouvel article/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Modifier' })).toBeNull()
    await act(async () => { faux.retenirLecture = false; for (const r of faux.lecturesEnAttente.splice(0)) r() })
    expect(await lignes()).toHaveLength(3)
    expect(screen.queryByText('Chargement…')).toBeNull()
  })

  it('un catalogue vide, lu en entier : il le dit, sans tableau', async () => {
    faux.articles = nues([AUTRE_DOSSIER])
    render(<ArticlesVue espace="cabinet" acces={ACCES_LUS} dossierId="d1" />)
    expect(await screen.findByText('Aucun article n’est enregistré pour ce dossier.')).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Articles' })).toBeNull()
    // Vide et lu en entier : le geste de création est offert.
    expect(bouton(/Nouvel article/).disabled).toBe(false)
  })

  it('au client : le vide se dit à lui, en tutoyant', async () => {
    faux.articles = []
    render(<ArticlesVue espace="client" dossierId="d1" />)
    expect(await screen.findByText('Tu n’as encore aucun article.')).toBeTruthy()
  })

  it('que des retirés, derrière leur filtre : ce n’est pas « aucun article », et le filtre les montre', async () => {
    faux.articles = nues([A4, A5])
    render(<ArticlesVue espace="cabinet" acces={ACCES_LUS} dossierId="d1" />)
    expect(await screen.findByText(/^Aucun article n’est en cours/)).toBeTruthy()
    expect(screen.queryByText(/n’est enregistré/)).toBeNull()
    fireEvent.click(screen.getByLabelText('Retirés'))
    expect(await lignes()).toHaveLength(2)
  })

  it('lue en partie : le bandeau et son motif, la liste lue, AUCUN geste, jamais « aucun article »', async () => {
    faux.muetApres = 2
    render(<ArticlesVue espace="cabinet" acces={ACCES_LUS} dossierId="d1" />)
    expect(await screen.findByText(/^Les articles du dossier n'ont pas pu être lus en entier \(2 ligne\(s\) lue\(s\) sur 5 annoncée\(s\)\)/)).toBeTruthy()
    expect(screen.getByText(/Aucun geste n’est donc offert/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Nouvel article/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Modifier' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retirer' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reprendre' })).toBeNull()
    expect(screen.queryByText(/^Aucun article/)).toBeNull()
  })

  it('lue en partie sans une ligne : il le dit, sans affirmer le vide', async () => {
    faux.muetApres = 0
    render(<ArticlesVue espace="cabinet" acces={ACCES_LUS} dossierId="d1" />)
    expect(await screen.findByText('La liste des articles n’a pas pu être lue en entier.')).toBeTruthy()
    expect(screen.queryByText(/n’est enregistré/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Nouvel article/ })).toBeNull()
  })

  it('au client, lue en partie : le motif reste en infobulle, les mots sont les siens', async () => {
    faux.muetApres = 0
    render(<ArticlesVue espace="client" dossierId="d1" />)
    const bandeau = await screen.findByText(/^Tes articles n'ont pas pu être affichés en entier\./)
    expect(bandeau.getAttribute('title')).toMatch(/lue\(s\) sur/)
    expect(bandeau.textContent).not.toMatch(/ligne\(s\)/)
    expect(screen.queryByRole('button', { name: /Nouvel article/ })).toBeNull()
  })

  it('au client, une lecture qui lève : le message est le sien', async () => {
    faux.leve = true
    render(<ArticlesVue espace="client" dossierId="d1" />)
    expect(await screen.findByText(/^Tes articles ne s’affichent pas : réseau coupé\./)).toBeTruthy()
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
  })

  it('une lecture qui lève : le message, rien d’autre — ni liste, ni geste, ni « aucun »', async () => {
    faux.leve = true
    render(<ArticlesVue espace="cabinet" acces={ACCES_LUS} dossierId="d1" />)
    expect(await screen.findByText(/^Les articles ne s’affichent pas : réseau coupé\./)).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Articles' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Nouvel article/ })).toBeNull()
    expect(screen.queryByText(/^Aucun article/)).toBeNull()
  })
})

describe('Articles — la liste', () => {
  it('au cabinet : les articles du dossier en cours, sans ceux d’un autre dossier ni les retirés', async () => {
    await monter('cabinet')
    const rows = await lignes()
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.textContent).join('|')).not.toMatch(/autre dossier|ancienne prestation/i)
    const conseil = await ligneDe('Consultation de conseil')
    expect(within(conseil).getByText('CONS-01')).toBeTruthy()
    expect(within(conseil).getByText('Séance d’une heure')).toBeTruthy()
    expect(within(conseil).getByText('heure')).toBeTruthy()
    expect(lisible(conseil.textContent)).toContain('60,00 €')
    expect(lisible(conseil.textContent)).toContain('20 %')
    expect(lisible(conseil.textContent)).toContain('Services')
    expect(within(conseil).getByText('En cours')).toBeTruthy()
  })

  it('un prix à six décimales ne s’arrondit jamais ; le taux à virgule, la nature, l’unité, la référence absente', async () => {
    await monter('cabinet')
    const piece = await ligneDe('Pièce détachée')
    expect(lisible(piece.textContent)).toContain('0,123456 €')
    expect(lisible(piece.textContent)).toContain('5,5 %')
    expect(lisible(piece.textContent)).toContain('Biens')
    expect(within(piece).getByText('pièce')).toBeTruthy()
    const forfait = await ligneDe('Forfait mensuel')
    expect(lisible(forfait.textContent)).toContain('1 234,50 €')
    expect(within(forfait).getByText('—')).toBeTruthy()
    expect(within(forfait).getByText('mois')).toBeTruthy()
  })

  it('une description longue est coupée dans la cellule, son texte entier en infobulle', async () => {
    const longue = 'mot '.repeat(60).trim()
    faux.articles = nues([article({ id: 'l1', description: longue })])
    await monter('cabinet')
    const description = within(await ligneDe('Consultation')).getByTitle(longue)
    expect(description.textContent?.endsWith('…')).toBe(true)
    expect(Array.from(description.textContent ?? '').length).toBe(141)
  })

  it('le filtre « Retirés » : sans lui, ils ne se montrent pas ; avec lui, ils suivent, dits retirés, avec « Reprendre »', async () => {
    await monter('cabinet')
    expect(await lignes()).toHaveLength(3)
    fireEvent.click(screen.getByLabelText('Retirés'))
    const rows = await lignes()
    expect(rows).toHaveLength(5)
    const ancien = await ligneDe('Ancienne prestation')
    expect(within(ancien).getByText('Retiré le 05/10/2027')).toBeTruthy()
    expect(within(ancien).getByRole('button', { name: 'Reprendre' })).toBeTruthy()
    expect(within(ancien).queryByRole('button', { name: 'Retirer' })).toBeNull()
    // Les retirés viennent après les articles en cours.
    expect(rows.slice(0, 3).map((r) => r.textContent).join('|')).not.toMatch(/prestation/)
    fireEvent.click(screen.getByLabelText('Retirés'))
    expect(await lignes()).toHaveLength(3)
  })

  it('une recherche lit la référence et la désignation, pas la description ; « N sur M » compte avant la recherche', async () => {
    await monter('cabinet')
    expect(screen.queryByText(/ sur 3$/)).toBeNull()
    rechercher('piece-1')
    expect(await lignes()).toHaveLength(1)
    expect(screen.getByText('1 sur 3')).toBeTruthy()
    rechercher('forfait')
    expect(await lignes()).toHaveLength(1)
    // « séance » n'est que dans la description : aucun résultat.
    rechercher('séance')
    expect(screen.getByText('aucun résultat')).toBeTruthy()
    expect(screen.getByText('Aucun article ne correspond à « séance ».')).toBeTruthy()
    // Accents et casse ignorés, comme partout.
    rechercher('PIECE DETACHEE')
    expect(await lignes()).toHaveLength(1)
    rechercher('')
    expect(await lignes()).toHaveLength(3)
  })

  it('le « N sur M » compte les retirés quand le filtre les montre', async () => {
    await monter('cabinet')
    fireEvent.click(screen.getByLabelText('Retirés'))
    rechercher('prestation')
    expect(await lignes()).toHaveLength(2)
    expect(screen.getByText('2 sur 5')).toBeTruthy()
  })

  it('« par le client » (cabinet) : le dernier geste d’un accès client lu en entier — créé, retiré —, jamais « par le cabinet »', async () => {
    await monter('cabinet')
    fireEvent.click(screen.getByLabelText('Retirés'))
    expect(within(await ligneDe('Pièce détachée')).getByText('par le client').getAttribute('title')).toBe('Article créé par le client')
    expect(within(await ligneDe('Ancienne prestation')).getByText('par le client').getAttribute('title')).toBe('Article retiré par le client')
    // Créé par le client puis modifié par le cabinet : le dernier geste est celui du cabinet.
    expect(within(await ligneDe('Forfait mensuel')).queryByText('par le client')).toBeNull()
    // Créé par le cabinet : rien. Retiré par le cabinet (le client l'avait créé) : rien.
    expect(within(await ligneDe('Consultation de conseil')).queryByText('par le client')).toBeNull()
    expect(within(await ligneDe('Autre ancienne prestation')).queryByText('par le client')).toBeNull()
    expect(screen.queryByText(/par le cabinet/i)).toBeNull()
  })

  it.each([
    [{ etat: 'en_cours' } as AccesDuDossier],
    [{ etat: 'incomplets', motif: 'lecture interrompue' } as AccesDuDossier],
  ])('accès %j : rien n’est dit « par le client » — on ne devine personne', async (acces) => {
    await monter('cabinet', acces)
    fireEvent.click(screen.getByLabelText('Retirés'))
    await lignes()
    expect(screen.queryByText('par le client')).toBeNull()
  })

  it('un accès retiré depuis n’est pas deviné', async () => {
    await monter('cabinet', { etat: 'lus', comptes: ['u-autre'] })
    await lignes()
    expect(screen.queryByText('par le client')).toBeNull()
  })

  it('au client : jamais « par le client », et aucun accès lu', async () => {
    await monter('client')
    fireEvent.click(screen.getByLabelText('Retirés'))
    await lignes()
    expect(screen.queryByText('par le client')).toBeNull()
  })

  it('le client ne lit aucun mot du cabinet dans la liste ; le cabinet, si', async () => {
    await monter('client')
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
    expect(document.body.textContent).toContain('Ton cabinet le lit aussi')
  })

  it('la phrase du cabinet dit que le client qui porte « Ventes » lit le catalogue', async () => {
    await monter('cabinet')
    expect(document.body.textContent).toContain('Le client qui porte la case « Ventes » le lit en entier')
  })
})

describe('Articles — « Nouvel article »', () => {
  it('une saisie neuve : l’unité générique, ni taux ni nature choisis ; le premier refus du module, discret, le bouton grisé', async () => {
    await monter('cabinet')
    fireEvent.click(bouton(/Nouvel article/))
    expect(screen.getByRole('heading', { name: 'Nouvel article' })).toBeTruthy()
    expect((champ('Unité') as unknown as HTMLSelectElement).value).toBe('C62')
    expect(champ('Taux de TVA').value).toBe('')
    expect(champ('Nature').value).toBe('')
    const refus = screen.getByText("La désignation de l'article est à renseigner.")
    expect(refus.className).toBe('muted')
    expect(bouton('Enregistrer').disabled).toBe(true)
    expect(bouton('Enregistrer').title).toBe("La désignation de l'article est à renseigner.")
    // Dès que la saisie a bougé, le refus est d'alerte.
    fireEvent.change(champ('Référence (facultative)'), { target: { value: 'X' } })
    expect(screen.getByText("La désignation de l'article est à renseigner.").className).toBe('error-text')
    expect(faux.rpcs).toEqual([])
  })

  it('les refus du module se disent avant le clic, dans l’ordre : désignation, référence prise, prix, taux, nature', async () => {
    await monter('cabinet')
    fireEvent.click(bouton(/Nouvel article/))
    fireEvent.change(champ(LIBELLE_DESIGNATION_ARTICLE), { target: { value: 'Article neuf' } })
    // La référence d'un retiré est prise aussi (A1-Q2) ; celle d'un autre dossier ne l'est pas.
    fireEvent.change(champ('Référence (facultative)'), { target: { value: 'ANCIEN' } })
    expect(screen.getByText("La référence « ANCIEN » est déjà celle de l'article « Ancienne prestation » (retiré) : une référence ne sert qu'une fois par dossier.")).toBeTruthy()
    fireEvent.change(champ('Référence (facultative)'), { target: { value: 'cons-01' } })
    // « R1 » n'est pas « r1 » : la casse compte, la référence est libre.
    expect(screen.queryByText(/est déjà celle/)).toBeNull()
    expect(screen.getByText("Le prix unitaire hors taxes de l'article est à renseigner.")).toBeTruthy()
    fireEvent.change(champ('Référence (facultative)'), { target: { value: 'CONS-01' } })
    expect(screen.getByText("La référence « CONS-01 » est déjà celle de l'article « Consultation de conseil » : une référence ne sert qu'une fois par dossier.")).toBeTruthy()
    expect(bouton('Enregistrer').disabled).toBe(true)
    fireEvent.change(champ('Référence (facultative)'), { target: { value: ' R1' } })
    expect(screen.getByText("La référence de l'article tient en un à cent caractères, sans blanc au début ni à la fin.")).toBeTruthy()
    fireEvent.change(champ('Référence (facultative)'), { target: { value: '' } })
    fireEvent.change(champ('Prix hors taxes (€)'), { target: { value: 'douze' } })
    expect(screen.getByText(/^Le prix n’est pas un nombre que l’écran sait lire/)).toBeTruthy()
    fireEvent.change(champ('Prix hors taxes (€)'), { target: { value: '0,1234567' } })
    expect(screen.getByText(/^Le prix unitaire hors taxes de l'article est positif ou nul, à six décimales au plus/)).toBeTruthy()
    fireEvent.change(champ('Prix hors taxes (€)'), { target: { value: '12,50' } })
    expect(screen.getByText("Le taux de TVA de l'article est à renseigner.")).toBeTruthy()
    fireEvent.change(champ('Taux de TVA'), { target: { value: '20' } })
    expect(screen.getByText("La nature de l'article est « biens » ou « services ».")).toBeTruthy()
    expect(bouton('Enregistrer').disabled).toBe(true)
    fireEvent.change(champ('Nature'), { target: { value: 'services' } })
    expect(bouton('Enregistrer').disabled).toBe(false)
    expect(faux.rpcs).toEqual([])
  })

  it('une saisie complète : TOUS les champs partent par `enregistrer_article`, la liste est relue, la fenêtre se ferme', async () => {
    await monter('cabinet')
    fireEvent.click(bouton(/Nouvel article/))
    remplirUnArticleNeuf()
    fireEvent.change(champ(LIBELLE_DESCRIPTION_ARTICLE), { target: { value: 'Une description' } })
    fireEvent.change(champ('Unité'), { target: { value: 'KGM' } })
    const lecturesAvant = faux.lectures
    fireEvent.click(bouton('Enregistrer'))
    expect(await screen.findByText('Article « Article neuf » enregistré.')).toBeTruthy()
    expect(faux.rpcs).toEqual([{
      nom: 'enregistrer_article',
      params: {
        p_dossier_id: 'd1', p_article_id: null,
        p_article: {
          designation: 'Article neuf', description: 'Une description', reference: 'NEUF-01', unite: 'KGM', prix_unitaire_ht: 12.5, taux_tva: 5.5, nature: 'biens',
        },
      },
    }])
    expect(faux.lectures).toBeGreaterThan(lecturesAvant)
    expect(screen.queryByRole('heading', { name: 'Nouvel article' })).toBeNull()
    const neuf = await ligneDe('Article neuf')
    expect(lisible(neuf.textContent)).toContain('12,50 €')
    expect(within(neuf).getByText('kilogramme')).toBeTruthy()
    expect(faux.ecritures).toEqual([])
  })

  it('une référence et une description laissées vides ne partent pas (null)', async () => {
    await monter('cabinet')
    fireEvent.click(bouton(/Nouvel article/))
    remplirUnArticleNeuf()
    fireEvent.change(champ('Référence (facultative)'), { target: { value: '' } })
    fireEvent.click(bouton('Enregistrer'))
    await screen.findByText('Article « Article neuf » enregistré.')
    const { p_article: envoye } = faux.rpcs[0].params as { p_article: Record<string, unknown> }
    expect(envoye.reference).toBeNull()
    expect(envoye.description).toBeNull()
  })

  it('« Annuler » ferme sans rien écrire', async () => {
    await monter('cabinet')
    fireEvent.click(bouton(/Nouvel article/))
    remplirUnArticleNeuf()
    fireEvent.click(bouton('Annuler'))
    expect(screen.queryByRole('heading', { name: 'Nouvel article' })).toBeNull()
    expect(faux.rpcs).toEqual([])
  })

  it('le refus de la base se dit sous ses mots DANS la fenêtre, qui reste ouverte ; la liste est relue', async () => {
    await monter('cabinet')
    fireEvent.click(bouton(/Nouvel article/))
    remplirUnArticleNeuf()
    faux.refus.enregistrer_article = "La référence « NEUF-01 » est déjà celle de l'article « Pris entre-temps » : une référence ne sert qu'une fois par dossier."
    const lecturesAvant = faux.lectures
    fireEvent.click(bouton('Enregistrer'))
    const alerte = await screen.findByRole('alert')
    expect(alerte.textContent).toBe(faux.refus.enregistrer_article)
    expect(screen.getByRole('heading', { name: 'Nouvel article' })).toBeTruthy()
    // Relue aussi sur un refus : la liste dit ce que la base a gardé.
    expect(faux.lectures).toBeGreaterThan(lecturesAvant)
    // Le verrou est relâché : on peut recommencer.
    expect(bouton('Enregistrer').disabled).toBe(false)
    expect(screen.queryByText(/enregistré\.$/)).toBeNull()
  })

  it('trois clics du même rendu : UNE écriture ; le verrou ne tombe qu’après la relecture', async () => {
    await monter('cabinet')
    fireEvent.click(bouton(/Nouvel article/))
    remplirUnArticleNeuf()
    const enregistrer = bouton('Enregistrer')
    faux.retenirRpc = true
    act(() => { fireEvent.click(enregistrer); fireEvent.click(enregistrer); fireEvent.click(enregistrer) })
    await vi.waitFor(() => expect(faux.rpcs).toHaveLength(1))
    expect(bouton('Enregistrement…').disabled).toBe(true)
    // La fenêtre ne se ferme pas sous l'écriture en cours.
    expect(bouton('Annuler').disabled).toBe(true)
    faux.retenirLecture = true
    await act(async () => { faux.retenirRpc = false; for (const r of faux.rpcEnAttente.splice(0)) r() })
    // L'écriture est revenue, la relecture ne l'est pas : la fenêtre est encore là, grisée, le verrou tenu.
    await vi.waitFor(() => expect(faux.lecturesEnAttente.length).toBeGreaterThan(0))
    expect(screen.getByRole('heading', { name: 'Nouvel article' })).toBeTruthy()
    expect(bouton('Enregistrement…').disabled).toBe(true)
    await act(async () => { faux.retenirLecture = false; for (const r of faux.lecturesEnAttente.splice(0)) r() })
    await vi.waitFor(() => expect(screen.queryByRole('heading', { name: 'Nouvel article' })).toBeNull())
    expect(faux.rpcs).toHaveLength(1)
    expect((await lignes()).length).toBe(4)
  })
})

describe('Articles — « Modifier »', () => {
  it('la saisie part de l’article LU, champ pour champ ; tous les champs repartent avec l’identifiant', async () => {
    await monter('cabinet')
    fireEvent.click(within(await ligneDe('Consultation de conseil')).getByRole('button', { name: 'Modifier' }))
    expect(screen.getByRole('heading', { name: 'Modifier l’article' })).toBeTruthy()
    expect(champ('Référence (facultative)').value).toBe('CONS-01')
    expect(champ(LIBELLE_DESIGNATION_ARTICLE).value).toBe('Consultation de conseil')
    expect(champ(LIBELLE_DESCRIPTION_ARTICLE).value).toBe('Séance d’une heure')
    expect(champ('Unité').value).toBe('HUR')
    expect(champ('Prix hors taxes (€)').value).toBe('60')
    expect(champ('Taux de TVA').value).toBe('20')
    expect(champ('Nature').value).toBe('services')
    // Intacte, la saisie n'a aucun refus — sa propre référence n'est pas « prise » — et ne dit rien.
    expect(bouton('Enregistrer').disabled).toBe(false)
    fireEvent.change(champ('Prix hors taxes (€)'), { target: { value: '65,5' } })
    fireEvent.click(bouton('Enregistrer'))
    expect(await screen.findByText('Article « Consultation de conseil » enregistré.')).toBeTruthy()
    expect(faux.rpcs).toEqual([{
      nom: 'enregistrer_article',
      params: {
        p_dossier_id: 'd1', p_article_id: 'a1',
        p_article: {
          designation: 'Consultation de conseil', description: 'Séance d’une heure', reference: 'CONS-01', unite: 'HUR',
          prix_unitaire_ht: 65.5, taux_tva: 20, nature: 'services',
        },
      },
    }])
    expect(lisible((await ligneDe('Consultation de conseil')).textContent)).toContain('65,50 €')
  })

  it('un article sans référence ni description : ils se montrent vides et repartent à null', async () => {
    await monter('cabinet')
    fireEvent.click(within(await ligneDe('Forfait mensuel')).getByRole('button', { name: 'Modifier' }))
    expect(champ('Référence (facultative)').value).toBe('')
    expect(champ(LIBELLE_DESCRIPTION_ARTICLE).value).toBe('')
    fireEvent.click(bouton('Enregistrer'))
    await screen.findByText('Article « Forfait mensuel » enregistré.')
    const { p_article: envoye } = faux.rpcs[0].params as { p_article: Record<string, unknown> }
    expect(envoye.reference).toBeNull()
    expect(envoye.description).toBeNull()
    expect(envoye.prix_unitaire_ht).toBe(1234.5)
  })

  it('un article retiré : « Modifier » grisé sous les mots du module, « Reprendre » à côté', async () => {
    await monter('cabinet')
    fireEvent.click(screen.getByLabelText('Retirés'))
    const ancien = await ligneDe('Ancienne prestation')
    const modifier = within(ancien).getByRole('button', { name: 'Modifier' }) as HTMLButtonElement
    expect(modifier.disabled).toBe(true)
    expect(modifier.title).toBe('Cet article est retiré : le reprendre avant de le modifier.')
    fireEvent.click(modifier)
    expect(screen.queryByRole('heading', { name: 'Modifier l’article' })).toBeNull()
  })

  it('reprendre le prix d’un autre article : la référence d’un autre est prise, la sienne ne l’est pas', async () => {
    await monter('cabinet')
    fireEvent.click(within(await ligneDe('Pièce détachée')).getByRole('button', { name: 'Modifier' }))
    fireEvent.change(champ('Référence (facultative)'), { target: { value: 'CONS-01' } })
    expect(screen.getByText(/La référence « CONS-01 » est déjà celle de l'article « Consultation de conseil »/)).toBeTruthy()
    fireEvent.change(champ('Référence (facultative)'), { target: { value: 'PIECE-1' } })
    expect(screen.queryByText(/est déjà celle/)).toBeNull()
  })
})

describe('Articles — « Retirer » et « Reprendre »', () => {
  it('« Retirer » : sa fonction seule, la liste relue, l’article n’est plus montré, le bilan dit', async () => {
    await monter('cabinet')
    const lecturesAvant = faux.lectures
    fireEvent.click(within(await ligneDe('Pièce détachée')).getByRole('button', { name: 'Retirer' }))
    expect(await screen.findByText('Article « Pièce détachée » retiré.')).toBeTruthy()
    expect(faux.rpcs).toEqual([{ nom: 'retirer_article', params: { p_dossier_id: 'd1', p_article_id: 'a2' } }])
    expect(faux.lectures).toBeGreaterThan(lecturesAvant)
    expect(await lignes()).toHaveLength(2)
    expect(faux.ecritures).toEqual([])
  })

  it('« Reprendre » : sa fonction seule, l’article revient parmi ceux en cours', async () => {
    await monter('cabinet')
    fireEvent.click(screen.getByLabelText('Retirés'))
    fireEvent.click(within(await ligneDe('Ancienne prestation')).getByRole('button', { name: 'Reprendre' }))
    expect(await screen.findByText('Article « Ancienne prestation » repris.')).toBeTruthy()
    expect(faux.rpcs).toEqual([{ nom: 'reprendre_article', params: { p_dossier_id: 'd1', p_article_id: 'a4' } }])
    fireEvent.click(screen.getByLabelText('Retirés'))
    expect(await lignes()).toHaveLength(4)
    expect(within(await ligneDe('Ancienne prestation')).getByText('En cours')).toBeTruthy()
  })

  it('le refus de la base (l’article a changé ailleurs) se dit sous ses mots ; la liste est relue pour montrer ce qui est', async () => {
    await monter('cabinet')
    faux.refus.retirer_article = 'Cet article est déjà retiré.'
    const lecturesAvant = faux.lectures
    fireEvent.click(within(await ligneDe('Pièce détachée')).getByRole('button', { name: 'Retirer' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Cet article est déjà retiré.')
    expect(faux.lectures).toBeGreaterThan(lecturesAvant)
    expect(screen.queryByText(/retiré\.$/)).toBeTruthy()
    // Le verrou est relâché.
    expect((within(await ligneDe('Pièce détachée')).getByRole('button', { name: 'Retirer' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('trois clics du même rendu : UNE écriture ; pendant la relecture, tous les gestes sont grisés', async () => {
    await monter('cabinet')
    const retirer = within(await ligneDe('Pièce détachée')).getByRole('button', { name: 'Retirer' })
    act(() => { fireEvent.click(retirer); fireEvent.click(retirer); fireEvent.click(retirer) })
    faux.retenirLecture = true
    await vi.waitFor(() => expect(faux.rpcs).toHaveLength(1))
    await vi.waitFor(() => expect(faux.lecturesEnAttente.length).toBeGreaterThan(0))
    // L'écriture est revenue, la relecture non : la liste montre encore ce qu'elle montrait, tout est grisé.
    expect(bouton(/Nouvel article/).disabled).toBe(true)
    for (const b of screen.getAllByRole('button', { name: /^(Modifier|Retirer|Reprendre)$/ })) expect((b as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { faux.retenirLecture = false; for (const r of faux.lecturesEnAttente.splice(0)) r() })
    await vi.waitFor(() => expect(bouton(/Nouvel article/).disabled).toBe(false))
    expect(faux.rpcs).toHaveLength(1)
    // Un second geste, après la relecture, est entendu.
    fireEvent.click(within(await ligneDe('Forfait mensuel')).getByRole('button', { name: 'Retirer' }))
    await vi.waitFor(() => expect(faux.rpcs).toHaveLength(2))
  })

  it('un geste ne s’efface pas d’une relecture pour un autre : le message d’un geste précédent cède la place', async () => {
    await monter('cabinet')
    fireEvent.click(within(await ligneDe('Pièce détachée')).getByRole('button', { name: 'Retirer' }))
    await screen.findByText('Article « Pièce détachée » retiré.')
    fireEvent.click(within(await ligneDe('Forfait mensuel')).getByRole('button', { name: 'Retirer' }))
    await screen.findByText('Article « Forfait mensuel » retiré.')
    expect(screen.queryByText('Article « Pièce détachée » retiré.')).toBeNull()
  })
})

describe('Articles — dans l’espace du client', () => {
  it('les mêmes gestes, par les mêmes fonctions, aux mots du client : tutoiement, aucun mot du cabinet', async () => {
    await monter('client')
    fireEvent.click(bouton(/Nouvel article/))
    // Les libellés des deux textes libres : ton cabinet les lit aussi.
    expect(champ(LIBELLE_DESIGNATION_ARTICLE_CLIENT)).toBeTruthy()
    expect(champ(LIBELLE_DESCRIPTION_ARTICLE_CLIENT)).toBeTruthy()
    expect(screen.queryByLabelText(LIBELLE_DESIGNATION_ARTICLE)).toBeNull()
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
    fireEvent.change(champ(LIBELLE_DESIGNATION_ARTICLE_CLIENT), { target: { value: 'Mon article' } })
    fireEvent.change(champ('Prix hors taxes (€)'), { target: { value: '10' } })
    fireEvent.change(champ('Taux de TVA'), { target: { value: '20' } })
    fireEvent.change(champ('Nature'), { target: { value: 'services' } })
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
    fireEvent.click(bouton('Enregistrer'))
    expect(await screen.findByText('Article « Mon article » enregistré.')).toBeTruthy()
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['enregistrer_article'])
  })

  it('retirer, modifier un retiré refusé, reprendre : comme au cabinet, sans un mot du cabinet', async () => {
    await monter('client')
    fireEvent.click(screen.getByLabelText('Retirés'))
    const ancien = await ligneDe('Ancienne prestation')
    expect((within(ancien).getByRole('button', { name: 'Modifier' }) as HTMLButtonElement).title).toBe('Cet article est retiré : le reprendre avant de le modifier.')
    fireEvent.click(within(ancien).getByRole('button', { name: 'Reprendre' }))
    await screen.findByText('Article « Ancienne prestation » repris.')
    fireEvent.click(within(await ligneDe('Pièce détachée')).getByRole('button', { name: 'Retirer' }))
    await screen.findByText('Article « Pièce détachée » retiré.')
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['reprendre_article', 'retirer_article'])
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
  })

  it('le refus de la base se dit au client sous ses mots, sans un mot du cabinet', async () => {
    await monter('client')
    faux.refus.retirer_article = 'Accès refusé à ce dossier.'
    fireEvent.click(within(await ligneDe('Pièce détachée')).getByRole('button', { name: 'Retirer' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Accès refusé à ce dossier.')
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
  })
})

describe('Articles — le dossier', () => {
  it('une lecture plus lente écrit en dernier : celle d’avant, revenue après, ne remplace pas la plus récente', async () => {
    faux.retenirLecture = true
    faux.articles = nues([article({ id: 'n1', designation: 'Version ancienne' })])
    const { rerender } = render(<ArticlesVue espace="cabinet" acces={ACCES_LUS} dossierId="d1" />)
    rerender(<ArticlesVue espace="cabinet" acces={ACCES_LUS} dossierId="d2" />)
    rerender(<ArticlesVue espace="cabinet" acces={ACCES_LUS} dossierId="d1" />)
    await act(async () => {})
    expect(faux.lecturesEnAttente).toHaveLength(3)
    // La dernière lecture (celle de d1) revient la première, avec la version à jour…
    faux.articles = nues([article({ id: 'n1', designation: 'Version à jour' })])
    await act(async () => { faux.retenirLecture = false; faux.lecturesEnAttente[2]() })
    expect(await screen.findByText('Version à jour')).toBeTruthy()
    // … puis la première, lente, rend l'ancienne : elle ne l'emporte pas.
    faux.articles = nues([article({ id: 'n1', designation: 'Version ancienne' })])
    await act(async () => { faux.lecturesEnAttente[0]() })
    expect(screen.getByText('Version à jour')).toBeTruthy()
    expect(screen.queryByText('Version ancienne')).toBeNull()
  })

  it('une relecture lancée sous un dossier quitté depuis ne remplace pas la liste du nouveau dossier', async () => {
    const { rerender } = render(<ArticlesVue espace="cabinet" acces={ACCES_LUS} dossierId="d1" />)
    await screen.findByRole('table', { name: 'Articles' })
    faux.retenirRpc = true
    fireEvent.click(within(await ligneDe('Pièce détachée')).getByRole('button', { name: 'Retirer' }))
    await vi.waitFor(() => expect(faux.rpcs).toHaveLength(1))
    // Le dossier change pendant l'écriture : le second dossier se lit et s'affiche…
    rerender(<ArticlesVue espace="cabinet" acces={ACCES_LUS} dossierId="d2" />)
    expect(await screen.findByText('Article d’un autre dossier')).toBeTruthy()
    // … puis l'écriture du premier revient et relit SON dossier : la liste du second ne bouge pas.
    await act(async () => { faux.retenirRpc = false; for (const r of faux.rpcEnAttente.splice(0)) r() })
    await act(async () => {})
    expect(screen.getByText('Article d’un autre dossier')).toBeTruthy()
    expect(screen.queryByText('Chargement…')).toBeNull()
  })

  it('un dossier lu, puis un autre : la liste du premier ne reste pas affichée pendant la lecture du second', async () => {
    const { rerender } = render(<ArticlesVue espace="cabinet" acces={ACCES_LUS} dossierId="d1" />)
    await screen.findByRole('table', { name: 'Articles' })
    faux.retenirLecture = true
    rerender(<ArticlesVue espace="cabinet" acces={ACCES_LUS} dossierId="d2" />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByText('Consultation de conseil')).toBeNull()
    expect(screen.queryByRole('button', { name: /Nouvel article/ })).toBeNull()
    await act(async () => { faux.retenirLecture = false; for (const r of faux.lecturesEnAttente.splice(0)) r() })
    expect(await screen.findByText('Article d’un autre dossier')).toBeTruthy()
  })

  it('une réponse qui arrive après un changement de dossier ne s’affiche pas', async () => {
    faux.retenirLecture = true
    const { rerender } = render(<ArticlesVue espace="cabinet" acces={ACCES_LUS} dossierId="d1" />)
    faux.articles = nues([article({ id: 'b1', dossier_id: 'd2', reference: 'AUTRE-1', designation: 'Article du second dossier' })])
    rerender(<ArticlesVue espace="cabinet" acces={ACCES_LUS} dossierId="d2" />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    await act(async () => { faux.retenirLecture = false; for (const r of faux.lecturesEnAttente.splice(0)) r() })
    expect(await screen.findByText('Article du second dossier')).toBeTruthy()
    expect(screen.queryByText('Consultation de conseil')).toBeNull()
  })
})

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FactureFormModal from './FactureFormModal'
import { choixDArticle } from '../../lib/articlesFacture'
import { mentionsLegalesParDefaut } from '../../lib/factures'
import { motsDuCabinet, pourLEspace } from '../../lib/espaceVentes'
import { MENTION_FRANCHISE } from '../../lib/statutTva'
import { LIBELLE_DESIGNATION_ARTICLE, LIBELLE_DESIGNATION_ARTICLE_CLIENT } from '../../lib/droitsAcces'
import { MENTIONS_VIDES } from '../../test/factures'
import { article } from '../../test/articles'
import type { Article, ArticleExoneration, FactureEmise, StatutTva } from '../../lib/types'

// UN ARTICLE DANS LE FORMULAIRE D'UNE FACTURE (espace client, étape A2b), monté pour le cabinet et pour le client « Ventes »,
// sous un faux client qui APPLIQUE les filtres (src/test/filtresPostgrest.ts) et dont `enregistrer_article` écrit la table
// d'essai. Ce que ces cas gardent, et qu'aucun calcul pur ne voit :
//  1. la lecture : « Chargement… » et aucun choix avant son retour ; partielle, refusée ou qui lève, elle se dit et n'offre
//     aucun geste ; les retirés ne se proposent jamais ; le drapeau d'export rebaissé, rien ne se lit ni ne s'offre ;
//  2. le choix : la ligne remplie selon le statut de TVA (redevable, franchise, exonéré, à préciser), l'avertissement sur la
//     ligne, la mention déjà proposée par le formulaire (jamais une seconde), la recherche de l'application ; une ligne déjà
//     saisie ne se remplace qu'après une confirmation qui nomme ce qui part ; la ligne reste libre (rien ne s'écrit) ;
//  3. la provenance, en mémoire : elle reste quand on retouche la ligne, tombe quand la ligne est retirée ou remplie par un
//     autre article, et une facture rouverte n'en a sur aucune ligne ;
//  4. « Mettre l'article à ce prix » : ses refus avant le clic, la confirmation, tous les champs écrits tels que lus, la
//     relecture sur un succès comme sur un refus, le verrou (deux clics du même `act`, puis trois) ;
//  5. « Enregistrer comme article » : la saisie préremplie (le taux d'un dossier redevable seulement), l'écriture, la ligne
//     qui prend le nouvel article pour provenance ;
//  6. aucun geste d'article pendant l'enregistrement de la facture, ni l'inverse ;
//  7. un prix à six décimales traverse le formulaire sans être arrondi ; les mots du client.
// Données FICTIVES.

const faux = vi.hoisted(() => ({
  articles: [] as Record<string, unknown>[],
  lignes: [] as Record<string, unknown>[],
  muetApres: Infinity,
  leve: false,
  lectures: 0,
  rpcs: [] as { nom: string; params: Record<string, unknown> }[],
  refus: {} as Record<string, string>,
  retenirLecture: false,
  lecturesEnAttente: [] as (() => void)[],
  retenirRpc: false,
  rpcEnAttente: [] as (() => void)[],
  retenirFacture: false,
  factureEnAttente: [] as (() => void)[],
  drapeau: true,
}))

// Le drapeau d'export se joue dans ses DEUX états par un accesseur, lu à chaque accès (CLAUDE.md, « Tests »).
vi.mock('../../lib/articles', async (original) => ({
  ...(await original<typeof import('../../lib/articles')>()),
  get ARTICLES_EXPORTES() { return faux.drapeau },
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  const instant = '2027-11-20T10:00:00Z'
  return {
    supabase: {
      rpc: async (nom: string, params: Record<string, unknown>) => {
        faux.rpcs.push({ nom, params })
        if (nom === 'enregistrer_facture') {
          if (faux.retenirFacture) await new Promise<void>((r) => { faux.factureEnAttente.push(r) })
          return { data: [{ facture_id: 'f-neuve', numero: null }], error: null }
        }
        if (faux.retenirRpc) await new Promise<void>((r) => { faux.rpcEnAttente.push(r) })
        const refus = faux.refus[nom]
        if (refus) return { data: null, error: { message: refus } }
        const id = params.p_article_id as string | null
        const existant = faux.articles.find((a) => a.id === id)
        if (nom !== 'enregistrer_article') throw new Error(`Fonction non attendue dans ce test : ${nom}`)
        const ecrit = existant
          ? { ...existant, ...(params.p_article as object), modifie_par: 'u-moi', modifie_le: instant }
          : { id: `neuf-${faux.articles.length + 1}`, dossier_id: params.p_dossier_id, retire_le: null, retire_par: null, cree_par: 'u-moi',
            cree_le: instant, modifie_par: null, modifie_le: null, ...(params.p_article as object) }
        faux.articles = existant ? faux.articles.map((a) => (a.id === id ? ecrit : a)) : [...faux.articles, ecrit]
        return { data: ecrit, error: null }
      },
      from: (table: string) => {
        // Les clients du dossier, lus en entier à l'ouverture (étape A4b2) : le fichier est vide ici ; leurs cas sont dans
        // FactureFormModalContacts.test.tsx.
        if (table === 'contacts') {
          const contacts = { select: () => contacts, eq: () => contacts, order: () => contacts, range: () => Promise.resolve({ data: [], error: null, count: 0 }) }
          return contacts
        }
        if (table !== 'articles' && table !== 'facture_lignes') throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: Predicat[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const partir = () => {
          if (table === 'facture_lignes') return { data: faux.lignes, error: null, count: faux.lignes.length }
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
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            if (table === 'articles' && faux.retenirLecture) {
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

const CONSULTATION = article({ id: 'a1', reference: 'CONS-01', designation: 'Consultation de conseil', description: 'Séance d’une heure', unite: 'HUR', prix_unitaire_ht: 60 })
const PIECE = article({ id: 'a2', reference: 'PIECE-1', designation: 'Pièce détachée', unite: 'H87', prix_unitaire_ht: 0.123456, taux_tva: 5.5, nature: 'biens' })
const FORFAIT = article({ id: 'a3', reference: null, designation: 'Forfait mensuel', unite: 'MON', prix_unitaire_ht: 1234.5 })
const ANCIEN = article({
  id: 'a4', reference: 'ANCIEN', designation: 'Ancienne prestation', retire_par: 'u-cabinet', retire_le: '2027-10-05T08:00:00Z',
})
const SOINS = article({ id: 'a5', reference: 'SOIN-1', designation: 'Acte de soins', prix_unitaire_ht: 40, taux_tva: 0 })
const AUTRE_DOSSIER = article({ id: 'x9', dossier_id: 'd2', reference: 'CONS-01', designation: 'Article d’un autre dossier' })

// L'insécable et la fine insécable se lisent comme des espaces (un montant ne se coupe pas en fin de ligne).
const lisible = (t: string | null) => (t ?? '').replace(/[\u00a0\u202f]/g, ' ')

function brouillon(o: Partial<FactureEmise> = {}): FactureEmise {
  return {
    id: 'f1', dossier_id: 'd1', type: 'facture', numero: null, statut: 'brouillon', date_emission: '2027-11-01', date_echeance: null,
    tiers_nom: 'Client SARL', tiers_adresse: null, tiers_siret: null, emetteur_nom: 'Dossier fictif', emetteur_siret: null, emetteur_adresse: null,
    montant_ht: 0, montant_tva: 0, montant_ttc: 0, mentions_legales: null, notes: null, facture_origine_id: null, motif_avoir: null,
    created_at: '2027-11-01T09:00:00Z', created_by: null, valide_par: null, ...MENTIONS_VIDES, ...o,
  } as FactureEmise
}

interface Options { statut?: StatutTva | null; exo?: ArticleExoneration | null; facture?: FactureEmise | null }

async function monter(espace: 'cabinet' | 'client', o: Options = {}) {
  const props = {
    dossierId: 'd1', dossierNom: 'Dossier fictif', dossierSiret: null, dossierAdresse: null, statutTva: o.statut === undefined ? 'redevable' : o.statut,
    articleExoneration: o.exo ?? null, numeroTvaAttribue: false, tvaSurDebits: false, facture: o.facture ?? null, onClose: () => {}, onSaved: () => {},
  } as const
  render(espace === 'client' ? <FactureFormModal espace="client" {...props} /> : <FactureFormModal espace="cabinet" onAdresseUpdated={() => {}} {...props} />)
  if (o.facture) await screen.findByText('Adresse de l\'émetteur', { exact: false })
}

const lignesDuFormulaire = () => Array.from(document.querySelectorAll<HTMLTableRowElement>('tbody tr'))
const champsDe = (i: number) => {
  const [designation, quantite, prix, taux] = Array.from(lignesDuFormulaire()[i].querySelectorAll<HTMLInputElement>('input'))
  return { designation, quantite, prix, taux }
}
const valeursDe = (i: number) => {
  const c = champsDe(i)
  return { designation: c.designation.value, quantite: c.quantite.value, prix: c.prix.value, taux: c.taux.value }
}
const saisir = (i: number, champ: 'designation' | 'quantite' | 'prix' | 'taux', valeur: string) =>
  fireEvent.change(champsDe(i)[champ], { target: { value: valeur } })

const boutonDeLigne = (nom: string, i = 0) => screen.getByRole('button', { name: `${nom}, ligne ${i + 1}` }) as HTMLButtonElement
const boutonsDeLigne = (nom: string) => screen.queryAllByRole('button', { name: new RegExp(`^${nom}, ligne \\d+$`) }) as HTMLButtonElement[]
const choisirUnArticle = async (i = 0) => { fireEvent.click(boutonDeLigne('Choisir un article', i)); return screen.findByRole('dialog', { name: 'Choisir un article' }) }
const bouton = (nom: string | RegExp) => screen.getByRole('button', { name: nom }) as HTMLButtonElement

async function chargerLesArticles() {
  await screen.findAllByRole('button', { name: /^Choisir un article, ligne/ })
}

async function choisir(designation: RegExp, i = 0) {
  const fenetre = await choisirUnArticle(i)
  fireEvent.click(within(fenetre).getByRole('button', { name: designation }))
}

const provenanceDeLaLigne = (i: number) => lignesDuFormulaire()[i].textContent?.match(/Article : ([^]*?)(Choisir|Mettre|Enregistrer|$)/)?.[1]?.trim() ?? null

beforeEach(() => {
  faux.articles = nues([CONSULTATION, PIECE, FORFAIT, ANCIEN, SOINS, AUTRE_DOSSIER])
  faux.lignes = []
  faux.muetApres = Infinity
  faux.leve = false
  faux.lectures = 0
  faux.rpcs = []
  faux.refus = {}
  faux.retenirLecture = false
  faux.lecturesEnAttente = []
  faux.retenirRpc = false
  faux.rpcEnAttente = []
  faux.retenirFacture = false
  faux.factureEnAttente = []
  faux.drapeau = true
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const ecritures = () => faux.rpcs.filter((r) => r.nom === 'enregistrer_article')
const facturesEnregistrees = () => faux.rpcs.filter((r) => r.nom === 'enregistrer_facture')

describe.each(['cabinet', 'client'] as const)('Un article dans la facture — la lecture (%s)', (espace) => {
  it('avant sa lecture : « Chargement… », aucun choix, aucun geste ; revenue, les choix', async () => {
    faux.retenirLecture = true
    await monter(espace)
    saisir(0, 'designation', 'Prestation')
    expect(screen.getByText(/Articles : Chargement…/)).toBeTruthy()
    expect(boutonsDeLigne('Choisir un article')).toHaveLength(0)
    expect(boutonsDeLigne('Enregistrer comme article')).toHaveLength(0)
    expect(screen.queryByText(/aucun article/i)).toBeNull()
    await act(async () => { faux.retenirLecture = false; for (const r of faux.lecturesEnAttente.splice(0)) r() })
    await chargerLesArticles()
    expect(screen.queryByText(/Articles : Chargement…/)).toBeNull()
    expect(boutonsDeLigne('Enregistrer comme article')).toHaveLength(1)
  })

  it('lue en partie : le bandeau, AUCUN choix ni geste, jamais « aucun article »', async () => {
    faux.muetApres = 2
    await monter(espace)
    saisir(0, 'designation', 'Prestation')
    const quoi = espace === 'client' ? 'Tes articles' : 'Les articles du dossier'
    await screen.findByText(new RegExp(`^${quoi} n'ont pas pu être (lus|affichés) en entier`))
    expect(screen.getByText(/Aucun article ne peut donc être choisi ni enregistré d’ici/)).toBeTruthy()
    expect(boutonsDeLigne('Choisir un article')).toHaveLength(0)
    expect(boutonsDeLigne('Enregistrer comme article')).toHaveLength(0)
    expect(screen.queryByText(/aucun article en cours/i)).toBeNull()
  })

  it('refusée ou qui lève : le message, aucun geste', async () => {
    faux.leve = true
    await monter(espace)
    saisir(0, 'designation', 'Prestation')
    await screen.findByText(new RegExp(`^${espace === 'client' ? 'Tes articles ne se lisent pas' : 'Les articles ne se lisent pas'} : réseau coupé\\.`))
    expect(boutonsDeLigne('Choisir un article')).toHaveLength(0)
    expect(boutonsDeLigne('Enregistrer comme article')).toHaveLength(0)
  })

  it('un catalogue vide, lu en entier : il le dit ; rien à choisir, mais « Enregistrer comme article » reste offert', async () => {
    faux.articles = nues([ANCIEN, AUTRE_DOSSIER])
    await monter(espace)
    saisir(0, 'designation', 'Prestation')
    await screen.findByText(/aucun article en cours/)
    expect(boutonsDeLigne('Choisir un article')).toHaveLength(0)
    expect(boutonsDeLigne('Enregistrer comme article')).toHaveLength(1)
  })

  it('les articles retirés et ceux d’un autre dossier ne se proposent jamais', async () => {
    await monter(espace)
    const fenetre = await (async () => { await chargerLesArticles(); return choisirUnArticle() })()
    const noms = within(fenetre).getAllByRole('button').map((b) => b.textContent ?? '')
    expect(noms.some((n) => /Ancienne prestation|autre dossier/i.test(n))).toBe(false)
    expect(within(fenetre).getAllByRole('listitem')).toHaveLength(4)
    // Même en cherchant le retiré par sa référence.
    fireEvent.change(within(fenetre).getByPlaceholderText('Rechercher une référence, une désignation…'), { target: { value: 'ANCIEN' } })
    expect(within(fenetre).getByText('Aucun article ne correspond à « ANCIEN ».')).toBeTruthy()
  })

  it('le drapeau d’export rebaissé : aucune lecture de la table, aucun geste, aucun mot sur les articles', async () => {
    faux.drapeau = false
    await monter(espace)
    saisir(0, 'designation', 'Prestation')
    await act(async () => { await Promise.resolve() })
    expect(faux.lectures).toBe(0)
    expect(screen.queryByText(/Chargement…/)).toBeNull()
    expect(boutonsDeLigne('Choisir un article')).toHaveLength(0)
    expect(boutonsDeLigne('Enregistrer comme article')).toHaveLength(0)
    expect(screen.queryByText(/article en cours|Articles :/)).toBeNull()
  })

  it('les articles se lisent UNE fois à l’ouverture, ceux du dossier seulement', async () => {
    await monter(espace)
    await chargerLesArticles()
    expect(faux.lectures).toBe(1)
  })
})

describe.each(['cabinet', 'client'] as const)('Un article dans la facture — le choix (%s)', (espace) => {
  it('redevable : la désignation avec sa description, la quantité 1, le prix et le taux de l’article ; la provenance dite', async () => {
    await monter(espace, { statut: 'redevable' })
    await chargerLesArticles()
    await choisir(/^Consultation de conseil/)
    expect(valeursDe(0)).toEqual({ designation: 'Consultation de conseil — Séance d’une heure', quantite: '1', prix: '60', taux: '20' })
    expect(provenanceDeLaLigne(0)).toBe('CONS-01 — Consultation de conseil')
    // La fenêtre se ferme, et rien ne s'écrit.
    expect(screen.queryByRole('dialog', { name: 'Choisir un article' })).toBeNull()
    expect(faux.rpcs).toEqual([])
  })

  it('un article à 5,5 % et six décimales : le taux et le prix de l’article, sans arrondi', async () => {
    await monter(espace, { statut: 'redevable' })
    await chargerLesArticles()
    await choisir(/^Pièce détachée/)
    expect(valeursDe(0)).toEqual({ designation: 'Pièce détachée', quantite: '1', prix: '0.123456', taux: '5.5' })
  })

  it('franchise : 0 % ; la mention de la franchise est celle que le formulaire propose déjà, jamais une seconde', async () => {
    await monter(espace, { statut: 'franchise' })
    await chargerLesArticles()
    const mentions = screen.getByLabelText('Mentions légales') as HTMLTextAreaElement
    const avant = mentions.value
    expect(avant).toBe(mentionsLegalesParDefaut('franchise', null))
    await choisir(/^Consultation de conseil/)
    expect(valeursDe(0).taux).toBe('0')
    // Le choix n'écrit pas dans les mentions.
    expect(mentions.value).toBe(avant)
    // Effacée, la mention se propose : c'est celle de l'article — une seule proposition, pas deux.
    fireEvent.change(mentions, { target: { value: '' } })
    const mention = choixDArticle(CONSULTATION, 'franchise', null).mention
    expect(mention).toBe(MENTION_FRANCHISE)
    expect(screen.getAllByText(new RegExp(`La mention « ${MENTION_FRANCHISE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} » manque`))).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Ajouter la mention' })).toHaveLength(1)
  })

  it('exonéré avec son article : 0 % et la mention de l’article, proposée par le formulaire', async () => {
    await monter(espace, { statut: 'exonere', exo: 'cgi_261_4_1' })
    await chargerLesArticles()
    await choisir(/^Consultation de conseil/)
    expect(valeursDe(0).taux).toBe('0')
    const mention = choixDArticle(CONSULTATION, 'exonere', 'cgi_261_4_1').mention
    expect(mention).toMatch(/261/)
    expect((screen.getByLabelText('Mentions légales') as HTMLTextAreaElement).value).toContain(mention as string)
    expect(lignesDuFormulaire()[0].textContent).not.toMatch(/Attention|à préciser|sans article/)
  })

  it('exonéré sans article : 0 %, et l’avertissement du module SUR LA LIGNE', async () => {
    await monter(espace, { statut: 'exonere', exo: null })
    await chargerLesArticles()
    await choisir(/^Consultation de conseil/)
    expect(valeursDe(0).taux).toBe('0')
    const avertissement = choixDArticle(CONSULTATION, 'exonere', null).avertissement as string
    expect(avertissement).toBeTruthy()
    // Dit sur la ligne, dans les mots de l'espace : au client, le renvoi à l'onglet du cabinet se réécrit.
    expect(lisible(lignesDuFormulaire()[0].textContent)).toContain(lisible(pourLEspace(espace, avertissement)))
    if (espace === 'client') expect(motsDuCabinet(lignesDuFormulaire()[0].textContent ?? '')).toEqual([])
  })

  it('statut à préciser : 0 % (jamais une ligne taxée), et l’avertissement sur la ligne', async () => {
    await monter(espace, { statut: null })
    await chargerLesArticles()
    await choisir(/^Consultation de conseil/)
    expect(valeursDe(0).taux).toBe('0')
    expect(lignesDuFormulaire()[0].textContent).toMatch(/statut de TVA/)
    expect(lignesDuFormulaire()[0].querySelector('.alerte-tva')).not.toBeNull()
  })

  it('redevable, article à 0 % sans article d’exonération : l’avertissement sur la ligne ; avec lui, la mention proposée', async () => {
    await monter(espace, { statut: 'redevable', exo: null })
    await chargerLesArticles()
    await choisir(/^Acte de soins/)
    expect(valeursDe(0).taux).toBe('0')
    expect(lignesDuFormulaire()[0].querySelector('.alerte-tva')).not.toBeNull()
    cleanup()
    await monter(espace, { statut: 'redevable', exo: 'cgi_261_4_1' })
    await chargerLesArticles()
    await choisir(/^Acte de soins/)
    expect(lignesDuFormulaire()[0].querySelector('.alerte-tva')).toBeNull()
    expect(screen.getByText(/manque aux mentions légales/).textContent).toContain(choixDArticle(SOINS, 'redevable', 'cgi_261_4_1').mention as string)
  })

  it('l’avertissement ne parle plus d’un taux que la ligne n’a plus : taux retouché, il se tait', async () => {
    await monter(espace, { statut: null })
    await chargerLesArticles()
    await choisir(/^Consultation de conseil/)
    expect(lignesDuFormulaire()[0].querySelector('.alerte-tva')).not.toBeNull()
    saisir(0, 'taux', '20')
    expect(lignesDuFormulaire()[0].querySelector('.alerte-tva')).toBeNull()
  })

  it('la recherche de l’application : référence et désignation, accents et casse ignorés ; pas la description', async () => {
    await monter(espace)
    await chargerLesArticles()
    const fenetre = await choisirUnArticle()
    const recherche = within(fenetre).getByPlaceholderText('Rechercher une référence, une désignation…')
    fireEvent.change(recherche, { target: { value: 'piece-1' } })
    expect(within(fenetre).getAllByRole('listitem')).toHaveLength(1)
    expect(within(fenetre).getByText('1 sur 4')).toBeTruthy()
    fireEvent.change(recherche, { target: { value: 'PIECE DETACHEE' } })
    expect(within(fenetre).getAllByRole('listitem')).toHaveLength(1)
    fireEvent.change(recherche, { target: { value: 'séance' } })
    expect(within(fenetre).getByText('Aucun article ne correspond à « séance ».')).toBeTruthy()
  })

  it('la fenêtre dit l’article : référence, prix sans arrondi, unité, taux ; « Annuler » ne touche pas la ligne', async () => {
    await monter(espace)
    await chargerLesArticles()
    const fenetre = await choisirUnArticle()
    const piece = within(fenetre).getByRole('button', { name: /^Pièce détachée/ })
    expect(lisible(piece.textContent)).toContain('PIECE-1 · 0,123456 € · pièce · 5,5 %')
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('dialog', { name: 'Choisir un article' })).toBeNull()
    expect(valeursDe(0).designation).toBe('')
  })
})

describe.each(['cabinet', 'client'] as const)('Un article dans la facture — une ligne déjà saisie (%s)', (espace) => {
  it('une ligne VIDE se remplit directement, sans confirmation', async () => {
    await monter(espace)
    await chargerLesArticles()
    await choisir(/^Consultation de conseil/)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(valeursDe(0).prix).toBe('60')
  })

  it('une désignation ou un prix saisis : la confirmation nomme ce qui sera remplacé ; « Annuler » laisse la ligne', async () => {
    await monter(espace)
    await chargerLesArticles()
    saisir(0, 'designation', 'Prestation à la main')
    saisir(0, 'prix', '12.5')
    await choisir(/^Consultation de conseil/)
    const confirmation = await screen.findByRole('alertdialog', { name: 'Remplacer le contenu de la ligne ?' })
    const texte = lisible(confirmation.textContent)
    expect(texte).toContain('Choisir l’article « Consultation de conseil » remplace la désignation « Prestation à la main » et le prix 12,50 € de cette ligne.')
    expect(texte).toContain('La ligne reste libre')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(valeursDe(0)).toEqual({ designation: 'Prestation à la main', quantite: '1', prix: '12.5', taux: '20' })
    expect(provenanceDeLaLigne(0)).toBeNull()
  })

  it('confirmé : la ligne est remplacée, la provenance posée, rien n’est écrit', async () => {
    await monter(espace)
    await chargerLesArticles()
    saisir(0, 'designation', 'Prestation à la main')
    saisir(0, 'quantite', '3')
    saisir(0, 'prix', '12.5')
    saisir(0, 'taux', '10')
    await choisir(/^Consultation de conseil/)
    const confirmation = await screen.findByRole('alertdialog')
    // Les quatre champs sont nommés, dans l'ordre de la ligne.
    expect(lisible(confirmation.textContent)).toContain('remplace la désignation « Prestation à la main », la quantité 3, le prix 12,50 € et le taux 10 % de cette ligne.')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Remplacer' }))
    expect(valeursDe(0)).toEqual({ designation: 'Consultation de conseil — Séance d’une heure', quantite: '1', prix: '60', taux: '20' })
    expect(provenanceDeLaLigne(0)).toBe('CONS-01 — Consultation de conseil')
    expect(faux.rpcs).toEqual([])
  })

  it('une ligne qui dit déjà ce que l’article apporte : rien à confirmer', async () => {
    await monter(espace)
    await chargerLesArticles()
    await choisir(/^Consultation de conseil/)
    await choisir(/^Consultation de conseil/)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('un autre article sur une ligne remplie par un article : confirmation, puis sa provenance remplace la première', async () => {
    await monter(espace)
    await chargerLesArticles()
    await choisir(/^Consultation de conseil/)
    await choisir(/^Forfait mensuel/)
    const confirmation = await screen.findByRole('alertdialog')
    expect(lisible(confirmation.textContent)).toContain('remplace la désignation « Consultation de conseil — Séance d’une heure »')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Remplacer' }))
    expect(provenanceDeLaLigne(0)).toBe('Forfait mensuel')
    expect(valeursDe(0).prix).toBe('1234.5')
  })
})

describe.each(['cabinet', 'client'] as const)('Un article dans la facture — la ligne reste libre, la provenance (%s)', (espace) => {
  it('retoucher la ligne n’écrit JAMAIS rien dans l’article, et la provenance reste', async () => {
    await monter(espace)
    await chargerLesArticles()
    await choisir(/^Consultation de conseil/)
    saisir(0, 'designation', 'Autre texte')
    saisir(0, 'quantite', '2')
    saisir(0, 'prix', '99')
    saisir(0, 'taux', '10')
    expect(faux.rpcs).toEqual([])
    expect(faux.articles.find((a) => a.id === 'a1')).toMatchObject({ designation: 'Consultation de conseil', prix_unitaire_ht: 60, taux_tva: 20 })
    expect(provenanceDeLaLigne(0)).toBe('CONS-01 — Consultation de conseil')
  })

  it('la ligne retirée perd sa provenance : celle qui la suit ne la reprend pas', async () => {
    await monter(espace)
    await chargerLesArticles()
    fireEvent.click(screen.getByRole('button', { name: '+ Ligne' }))
    await choisir(/^Consultation de conseil/, 0)
    await choisir(/^Forfait mensuel/, 1)
    expect(provenanceDeLaLigne(0)).toBe('CONS-01 — Consultation de conseil')
    expect(provenanceDeLaLigne(1)).toBe('Forfait mensuel')
    // On retire la première : la seconde garde SA provenance, et prend l'indice 0.
    fireEvent.click(within(lignesDuFormulaire()[0]).getByRole('button', { name: '✕' }))
    expect(lignesDuFormulaire()).toHaveLength(1)
    expect(provenanceDeLaLigne(0)).toBe('Forfait mensuel')
    // Une ligne neuve ensuite n'hérite d'aucune provenance.
    fireEvent.click(screen.getByRole('button', { name: '+ Ligne' }))
    expect(provenanceDeLaLigne(1)).toBeNull()
  })

  it('une facture rouverte n’a de provenance sur aucune de ses lignes : ni article, ni « Mettre l’article à ce prix »', async () => {
    faux.lignes = [
      { id: 'l-1', facture_id: 'f1', ordre: 1, designation: 'Consultation de conseil', quantite: 1, prix_unitaire_ht: 60, taux_tva: 20 },
      { id: 'l-2', facture_id: 'f1', ordre: 2, designation: 'Pièce détachée', quantite: 2, prix_unitaire_ht: 0.123456, taux_tva: 5.5 },
    ]
    await monter(espace, { facture: brouillon() })
    await chargerLesArticles()
    expect(lignesDuFormulaire()).toHaveLength(2)
    expect(provenanceDeLaLigne(0)).toBeNull()
    expect(provenanceDeLaLigne(1)).toBeNull()
    expect(boutonsDeLigne('Mettre l’article à ce prix')).toHaveLength(0)
    // Une ligne d'une facture rouverte, saisie à la main, peut devenir un article.
    expect(boutonsDeLigne('Enregistrer comme article')).toHaveLength(2)
    // Le prix à six décimales d'une ligne enregistrée se relit tel quel.
    expect(valeursDe(1).prix).toBe('0.123456')
  })
})

describe.each(['cabinet', 'client'] as const)('Un article dans la facture — « Mettre l’article à ce prix » (%s)', (espace) => {
  async function ligneChoisie(prix?: string) {
    await monter(espace)
    await chargerLesArticles()
    await choisir(/^Consultation de conseil/)
    if (prix != null) saisir(0, 'prix', prix)
  }

  it('offert seulement si le prix de la ligne diffère de celui de l’article tel que lu', async () => {
    await ligneChoisie()
    expect(boutonsDeLigne('Mettre l’article à ce prix')).toHaveLength(0)
    saisir(0, 'prix', '60.00')
    expect(boutonsDeLigne('Mettre l’article à ce prix')).toHaveLength(0)
    saisir(0, 'prix', '65')
    expect(boutonDeLigne('Mettre l’article à ce prix').disabled).toBe(false)
    saisir(0, 'prix', '60')
    expect(boutonsDeLigne('Mettre l’article à ce prix')).toHaveLength(0)
  })

  it('une ligne saisie à la main n’en a pas : elle n’a pas d’article', async () => {
    await monter(espace)
    await chargerLesArticles()
    saisir(0, 'designation', 'Prestation')
    saisir(0, 'prix', '65')
    expect(boutonsDeLigne('Mettre l’article à ce prix')).toHaveLength(0)
  })

  it('un prix que le module refuse : le geste est grisé sous son refus, dit avant le clic', async () => {
    await ligneChoisie('')
    expect(boutonDeLigne('Mettre l’article à ce prix').disabled).toBe(true)
    expect(boutonDeLigne('Mettre l’article à ce prix').title).toBe('Le prix unitaire hors taxes de l\'article est à renseigner.')
    // Dit aussi sous la ligne : une infobulle ne se voit pas au doigt.
    expect(lignesDuFormulaire()[0].textContent).toContain('Le prix unitaire hors taxes de l\'article est à renseigner.')
    saisir(0, 'prix', '-5')
    expect(boutonDeLigne('Mettre l’article à ce prix').title).toMatch(/positif ou nul, à six décimales au plus/)
    saisir(0, 'prix', '0.1234567')
    expect(boutonDeLigne('Mettre l’article à ce prix').disabled).toBe(true)
  })

  it('la confirmation nomme l’article, l’ancien et le nouveau prix, et dit que les factures à venir le prendront', async () => {
    await ligneChoisie('65.5')
    fireEvent.click(boutonDeLigne('Mettre l’article à ce prix'))
    const confirmation = await screen.findByRole('alertdialog', { name: 'Mettre l’article à ce prix ?' })
    const texte = lisible(confirmation.textContent)
    expect(texte).toContain('L’article « Consultation de conseil » passe de 60,00 € à 65,50 €.')
    expect(texte).toContain(espace === 'client'
      ? 'Tes prochaines factures qui choisiront cet article prendront ce prix'
      : 'Les prochaines factures de ce dossier qui choisiront cet article prendront ce prix')
    expect(texte).toContain('aucune facture déjà rédigée ne change')
    // Rien n'est écrit avant la confirmation ; « Annuler » ne change rien.
    expect(faux.rpcs).toEqual([])
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(faux.rpcs).toEqual([])
  })

  it('confirmée : TOUS les champs de l’article tel que lu partent, le prix de la ligne seul changé — jamais sa désignation ni son taux', async () => {
    await ligneChoisie()
    // La ligne est retouchée à la main : sa désignation, son taux et sa quantité ne sont pas ceux de l'article.
    saisir(0, 'designation', 'Texte retouché')
    saisir(0, 'taux', '10')
    saisir(0, 'quantite', '4')
    saisir(0, 'prix', '0.123456')
    fireEvent.click(boutonDeLigne('Mettre l’article à ce prix'))
    const confirmation = await screen.findByRole('alertdialog')
    const lecturesAvant = faux.lectures
    await act(async () => { fireEvent.click(within(confirmation).getByRole('button', { name: 'Mettre à ce prix' })) })
    expect(ecritures()).toHaveLength(1)
    expect(ecritures()[0].params).toEqual({
      p_dossier_id: 'd1', p_article_id: 'a1',
      p_article: {
        designation: 'Consultation de conseil', description: 'Séance d’une heure', reference: 'CONS-01', unite: 'HUR',
        prix_unitaire_ht: 0.123456, taux_tva: 20, nature: 'services',
      },
    })
    // La liste se relit ; la confirmation se ferme ; le geste n'a plus d'objet ; la ligne, elle, n'a pas bougé.
    expect(faux.lectures).toBe(lecturesAvant + 1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(boutonsDeLigne('Mettre l’article à ce prix')).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toBe('Article « Consultation de conseil » : prix mis à jour.')
    expect(valeursDe(0)).toEqual({ designation: 'Texte retouché', quantite: '4', prix: '0.123456', taux: '10' })
    // Une ligne neuve qui choisit l'article en reprend le nouveau prix.
    fireEvent.click(screen.getByRole('button', { name: '+ Ligne' }))
    await choisir(/^Consultation de conseil/, 1)
    expect(valeursDe(1).prix).toBe('0.123456')
  })

  it('un article retiré depuis (relu après un autre geste) : grisé sous le refus de la base, dit avant le clic', async () => {
    await ligneChoisie('99')
    // Un autre geste d'article relit la liste : entre-temps, l'article a été retiré ailleurs.
    faux.articles = faux.articles.map((a) => (a.id === 'a1' ? { ...a, retire_le: '2027-11-02T08:00:00Z', retire_par: 'u-cabinet' } : a))
    fireEvent.click(screen.getByRole('button', { name: '+ Ligne' }))
    saisir(1, 'designation', 'Prestation')
    fireEvent.click(boutonDeLigne('Enregistrer comme article', 1))
    const saisieOuverte = await screen.findByRole('dialog', { name: 'Nouvel article' })
    fireEvent.change(within(saisieOuverte).getByLabelText('Nature'), { target: { value: 'services' } })
    fireEvent.change(within(saisieOuverte).getByLabelText('Prix hors taxes (€)'), { target: { value: '5' } })
    fireEvent.change(within(saisieOuverte).getByLabelText('Taux de TVA'), { target: { value: '20' } })
    await act(async () => { fireEvent.click(within(saisieOuverte).getByRole('button', { name: 'Enregistrer' })) })
    const mettre = boutonDeLigne('Mettre l’article à ce prix', 0)
    expect(mettre.disabled).toBe(true)
    expect(mettre.title).toBe('Cet article est retiré : le reprendre avant de le modifier.')
    expect(lignesDuFormulaire()[0].textContent).toContain('Cet article est retiré : le reprendre avant de le modifier.')
    fireEvent.click(mettre)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(ecritures()).toHaveLength(1)
  })

  it('le refus de la base se dit sous ses mots dans la confirmation, et la liste se relit comme sur un succès', async () => {
    await ligneChoisie('65')
    faux.refus.enregistrer_article = 'Accès refusé à ce dossier.'
    fireEvent.click(boutonDeLigne('Mettre l’article à ce prix'))
    const confirmation = await screen.findByRole('alertdialog')
    const lecturesAvant = faux.lectures
    await act(async () => { fireEvent.click(within(confirmation).getByRole('button', { name: 'Mettre à ce prix' })) })
    expect(within(screen.getByRole('alertdialog')).getByRole('alert').textContent).toBe('Accès refusé à ce dossier.')
    expect(faux.lectures).toBe(lecturesAvant + 1)
    // Le verrou est relâché : on peut réessayer.
    faux.refus = {}
    await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Mettre à ce prix' })) })
    expect(ecritures()).toHaveLength(2)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('UN verrou : deux clics du même rendu, une seule écriture — et trois aussi ; relâché après la relecture', async () => {
    await ligneChoisie('65')
    fireEvent.click(boutonDeLigne('Mettre l’article à ce prix'))
    const confirmation = await screen.findByRole('alertdialog')
    const confirmer = within(confirmation).getByRole('button', { name: 'Mettre à ce prix' })
    faux.retenirRpc = true
    await act(async () => { confirmer.click(); confirmer.click(); confirmer.click() })
    expect(ecritures()).toHaveLength(1)
    // Pendant l'écriture, tout est grisé : la confirmation, les gestes de la ligne, et les deux boutons de la facture.
    expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Enregistrement…' }).hasAttribute('disabled')).toBe(true)
    expect(boutonDeLigne('Choisir un article').disabled).toBe(true)
    expect(bouton('Enregistrer le brouillon').disabled).toBe(true)
    expect(bouton('Valider la facture').disabled).toBe(true)
    await act(async () => { faux.retenirRpc = false; for (const r of faux.rpcEnAttente.splice(0)) r() })
    expect(ecritures()).toHaveLength(1)
    expect(boutonDeLigne('Choisir un article').disabled).toBe(false)
    expect(bouton('Valider la facture').disabled).toBe(false)
  })
})

describe.each(['cabinet', 'client'] as const)('Un article dans la facture — « Enregistrer comme article » (%s)', (espace) => {
  const NOM_DESIGNATION = espace === 'client' ? LIBELLE_DESIGNATION_ARTICLE_CLIENT : LIBELLE_DESIGNATION_ARTICLE

  async function ligneALaMain(statut: StatutTva | null, prix = '12.5', taux = '10') {
    await monter(espace, { statut })
    await chargerLesArticles()
    saisir(0, 'designation', 'Séance à la main')
    saisir(0, 'prix', prix)
    saisir(0, 'taux', taux)
  }

  it('offert sur une ligne sans provenance qui porte une désignation ; pas sur une ligne vide', async () => {
    await monter(espace)
    await chargerLesArticles()
    expect(boutonsDeLigne('Enregistrer comme article')).toHaveLength(0)
    saisir(0, 'designation', '   ')
    expect(boutonsDeLigne('Enregistrer comme article')).toHaveLength(0)
    saisir(0, 'designation', 'Séance')
    expect(boutonsDeLigne('Enregistrer comme article')).toHaveLength(1)
  })

  it('redevable : désignation, prix lu sans arrondi, taux de la ligne, unité générique, nature à choisir, aucune référence', async () => {
    await ligneALaMain('redevable', '0.123456', '10')
    fireEvent.click(boutonDeLigne('Enregistrer comme article'))
    const fenetre = await screen.findByRole('dialog', { name: 'Nouvel article' })
    expect((within(fenetre).getByLabelText(NOM_DESIGNATION) as HTMLInputElement).value).toBe('Séance à la main')
    expect((within(fenetre).getByLabelText('Prix hors taxes (€)') as HTMLInputElement).value).toBe('0,123456')
    expect((within(fenetre).getByLabelText('Taux de TVA') as HTMLSelectElement).value).toBe('10')
    expect((within(fenetre).getByLabelText('Unité') as HTMLSelectElement).value).toBe('C62')
    expect((within(fenetre).getByLabelText('Nature') as HTMLSelectElement).value).toBe('')
    expect((within(fenetre).getByLabelText('Référence (facultative)') as HTMLInputElement).value).toBe('')
    // La nature reste à choisir : le refus du module se dit avant le clic, discrètement (rien n'a été touché).
    expect(within(fenetre).getByText('La nature de l\'article est « biens » ou « services ».').className).toBe('muted')
    expect((within(fenetre).getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it.each(['franchise', 'exonere', null] as const)('statut %s : le taux reste VIDE — la ligne est à zéro du seul fait du statut', async (statut) => {
    await ligneALaMain(statut, '12.5', '0')
    fireEvent.click(boutonDeLigne('Enregistrer comme article'))
    const fenetre = await screen.findByRole('dialog', { name: 'Nouvel article' })
    expect((within(fenetre).getByLabelText('Taux de TVA') as HTMLSelectElement).value).toBe('')
    expect(within(fenetre).getByText('Le taux de TVA de l\'article est à renseigner.')).toBeTruthy()
  })

  it('écrit par `enregistrer_article` seule, un article neuf ; la ligne prend le nouvel article pour provenance ; la liste se relit', async () => {
    await ligneALaMain('redevable', '12.5', '10')
    fireEvent.click(boutonDeLigne('Enregistrer comme article'))
    const fenetre = await screen.findByRole('dialog', { name: 'Nouvel article' })
    fireEvent.change(within(fenetre).getByLabelText('Nature'), { target: { value: 'services' } })
    const lecturesAvant = faux.lectures
    await act(async () => { fireEvent.click(within(fenetre).getByRole('button', { name: 'Enregistrer' })) })
    expect(ecritures()).toHaveLength(1)
    expect(ecritures()[0].params).toEqual({
      p_dossier_id: 'd1', p_article_id: null,
      p_article: { designation: 'Séance à la main', description: null, reference: null, unite: 'C62', prix_unitaire_ht: 12.5, taux_tva: 10, nature: 'services' },
    })
    expect(faux.lectures).toBe(lecturesAvant + 1)
    expect(screen.queryByRole('dialog', { name: 'Nouvel article' })).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Article « Séance à la main » enregistré.')
    // La ligne n'a pas changé ; elle a maintenant l'article pour provenance, et le geste n'a plus d'objet.
    expect(valeursDe(0)).toEqual({ designation: 'Séance à la main', quantite: '1', prix: '12.5', taux: '10' })
    expect(provenanceDeLaLigne(0)).toBe('Séance à la main')
    expect(boutonsDeLigne('Enregistrer comme article')).toHaveLength(0)
    // Le prix est celui de l'article : « Mettre l'article à ce prix » n'a pas d'objet, et le nouvel article se choisit.
    expect(boutonsDeLigne('Mettre l’article à ce prix')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '+ Ligne' }))
    const choix = await choisirUnArticle(1)
    expect(within(choix).getByRole('button', { name: /^Séance à la main/ })).toBeTruthy()
  })

  it('franchise : le taux se choisit dans la saisie, et la ligne reste à 0 %', async () => {
    await ligneALaMain('franchise', '30', '0')
    fireEvent.click(boutonDeLigne('Enregistrer comme article'))
    const fenetre = await screen.findByRole('dialog', { name: 'Nouvel article' })
    fireEvent.change(within(fenetre).getByLabelText('Nature'), { target: { value: 'services' } })
    fireEvent.change(within(fenetre).getByLabelText('Taux de TVA'), { target: { value: '20' } })
    await act(async () => { fireEvent.click(within(fenetre).getByRole('button', { name: 'Enregistrer' })) })
    expect((ecritures()[0].params.p_article as Record<string, unknown>).taux_tva).toBe(20)
    expect(valeursDe(0).taux).toBe('0')
  })

  it('le refus du module se dit avant le clic : une référence déjà prise (même retirée), sous les mots de la base', async () => {
    await ligneALaMain('redevable')
    fireEvent.click(boutonDeLigne('Enregistrer comme article'))
    const fenetre = await screen.findByRole('dialog', { name: 'Nouvel article' })
    fireEvent.change(within(fenetre).getByLabelText('Nature'), { target: { value: 'services' } })
    fireEvent.change(within(fenetre).getByLabelText('Référence (facultative)'), { target: { value: 'ANCIEN' } })
    expect(within(fenetre).getByText('La référence « ANCIEN » est déjà celle de l\'article « Ancienne prestation » (retiré) : une référence ne sert qu\'une fois par dossier.')).toBeTruthy()
    expect((within(fenetre).getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(true)
    // Une référence d'un AUTRE dossier ne gêne pas.
    fireEvent.change(within(fenetre).getByLabelText('Référence (facultative)'), { target: { value: 'CONS-01-BIS' } })
    expect((within(fenetre).getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(false)
    expect(faux.rpcs).toEqual([])
  })

  it('le refus de la base se dit sous ses mots dans la saisie, la liste se relit, la ligne reste sans provenance', async () => {
    await ligneALaMain('redevable')
    fireEvent.click(boutonDeLigne('Enregistrer comme article'))
    const fenetre = await screen.findByRole('dialog', { name: 'Nouvel article' })
    fireEvent.change(within(fenetre).getByLabelText('Nature'), { target: { value: 'services' } })
    faux.refus.enregistrer_article = 'Accès refusé à ce dossier.'
    const lecturesAvant = faux.lectures
    await act(async () => { fireEvent.click(within(fenetre).getByRole('button', { name: 'Enregistrer' })) })
    expect(within(screen.getByRole('dialog', { name: 'Nouvel article' })).getByRole('alert').textContent).toBe('Accès refusé à ce dossier.')
    expect(faux.lectures).toBe(lecturesAvant + 1)
    expect(provenanceDeLaLigne(0)).toBeNull()
  })

  it('UN verrou : trois clics du même rendu, une seule écriture', async () => {
    await ligneALaMain('redevable')
    fireEvent.click(boutonDeLigne('Enregistrer comme article'))
    const fenetre = await screen.findByRole('dialog', { name: 'Nouvel article' })
    fireEvent.change(within(fenetre).getByLabelText('Nature'), { target: { value: 'services' } })
    const enregistrer = within(fenetre).getByRole('button', { name: 'Enregistrer' })
    faux.retenirRpc = true
    await act(async () => { enregistrer.click(); enregistrer.click(); enregistrer.click() })
    expect(ecritures()).toHaveLength(1)
    await act(async () => { faux.retenirRpc = false; for (const r of faux.rpcEnAttente.splice(0)) r() })
    expect(ecritures()).toHaveLength(1)
  })

  it('« Entrée » dans la saisie ne soumet pas la facture : la fenêtre est hors du formulaire', async () => {
    await ligneALaMain('redevable')
    fireEvent.click(boutonDeLigne('Enregistrer comme article'))
    const fenetre = await screen.findByRole('dialog', { name: 'Nouvel article' })
    expect(fenetre.closest('form')).toBeNull()
    expect(document.querySelector('form')?.contains(fenetre)).toBe(false)
    expect(facturesEnregistrees()).toHaveLength(0)
  })

  it('au client, la saisie porte les libellés de son espace (« ton cabinet les lit aussi »)', async () => {
    await ligneALaMain('redevable')
    fireEvent.click(boutonDeLigne('Enregistrer comme article'))
    const fenetre = await screen.findByRole('dialog', { name: 'Nouvel article' })
    expect(within(fenetre).getByLabelText(NOM_DESIGNATION)).toBeTruthy()
    if (espace === 'client') expect(motsDuCabinet(fenetre.textContent ?? '')).toEqual([])
  })
})

describe.each(['cabinet', 'client'] as const)('Un article dans la facture — la facture et les gestes d’article se tiennent à l’écart (%s)', (espace) => {
  it('pendant un geste d’article, la facture ne s’enregistre pas (même par la soumission du formulaire) ; il se relâche ensuite', async () => {
    await monter(espace)
    await chargerLesArticles()
    saisir(0, 'designation', 'Séance à la main')
    saisir(0, 'prix', '12.5')
    fireEvent.change(document.querySelector('#tiers-nom')!, { target: { value: 'Client SARL' } })
    fireEvent.click(boutonDeLigne('Enregistrer comme article'))
    const fenetre = await screen.findByRole('dialog', { name: 'Nouvel article' })
    fireEvent.change(within(fenetre).getByLabelText('Nature'), { target: { value: 'services' } })
    fireEvent.change(within(fenetre).getByLabelText('Taux de TVA'), { target: { value: '20' } })
    faux.retenirRpc = true
    await act(async () => { fireEvent.click(within(fenetre).getByRole('button', { name: 'Enregistrer' })) })
    expect(ecritures()).toHaveLength(1)
    // La soumission du formulaire (« Entrée ») contourne le bouton grisé : seul le verrou l'arrête.
    await act(async () => { fireEvent.submit(document.querySelector('form')!) })
    expect(facturesEnregistrees()).toHaveLength(0)
    await act(async () => { faux.retenirRpc = false; for (const r of faux.rpcEnAttente.splice(0)) r() })
    await act(async () => { fireEvent.submit(document.querySelector('form')!) })
    expect(facturesEnregistrees()).toHaveLength(1)
  })

  it('le verrou ne tombe qu’APRÈS la relecture des articles : la facture ne s’enregistre pas pendant qu’elle court', async () => {
    await monter(espace)
    await chargerLesArticles()
    saisir(0, 'designation', 'Séance à la main')
    saisir(0, 'prix', '12.5')
    fireEvent.change(document.querySelector('#tiers-nom')!, { target: { value: 'Client SARL' } })
    fireEvent.click(boutonDeLigne('Enregistrer comme article'))
    const fenetre = await screen.findByRole('dialog', { name: 'Nouvel article' })
    fireEvent.change(within(fenetre).getByLabelText('Nature'), { target: { value: 'services' } })
    fireEvent.change(within(fenetre).getByLabelText('Taux de TVA'), { target: { value: '20' } })
    // L'écriture revient, la RELECTURE reste en route : le verrou est encore posé.
    faux.retenirLecture = true
    await act(async () => { fireEvent.click(within(fenetre).getByRole('button', { name: 'Enregistrer' })) })
    expect(ecritures()).toHaveLength(1)
    expect(faux.lecturesEnAttente).toHaveLength(1)
    await act(async () => { fireEvent.submit(document.querySelector('form')!) })
    expect(facturesEnregistrees()).toHaveLength(0)
    await act(async () => { faux.retenirLecture = false; for (const r of faux.lecturesEnAttente.splice(0)) r() })
    await act(async () => { fireEvent.submit(document.querySelector('form')!) })
    expect(facturesEnregistrees()).toHaveLength(1)
  })

  it('pendant l’enregistrement de la facture, aucun geste d’article : grisés, et le verrou refuse même une confirmation déjà ouverte', async () => {
    await monter(espace)
    await chargerLesArticles()
    fireEvent.change(document.querySelector('#tiers-nom')!, { target: { value: 'Client SARL' } })
    await choisir(/^Consultation de conseil/)
    saisir(0, 'prix', '65')
    // La confirmation est ouverte AVANT que la facture ne parte.
    fireEvent.click(boutonDeLigne('Mettre l’article à ce prix'))
    const confirmation = await screen.findByRole('alertdialog')
    faux.retenirFacture = true
    await act(async () => { fireEvent.submit(document.querySelector('form')!) })
    expect(facturesEnregistrees()).toHaveLength(1)
    expect(boutonDeLigne('Choisir un article').disabled).toBe(true)
    await act(async () => { fireEvent.click(within(confirmation).getByRole('button', { name: 'Mettre à ce prix' })) })
    expect(ecritures()).toHaveLength(0)
    await act(async () => { faux.retenirFacture = false; for (const r of faux.factureEnAttente.splice(0)) r() })
  })
})

describe.each(['cabinet', 'client'] as const)('Un prix à plus de deux décimales (%s)', (espace) => {
  it('le champ du prix admet n’importe quelle décimale : le navigateur ne bloque plus l’envoi', async () => {
    await monter(espace)
    saisir(0, 'designation', 'Pièce')
    saisir(0, 'prix', '0.123456')
    const champ = champsDe(0).prix
    expect(champ.getAttribute('step')).toBe('any')
    expect(champ.validity.stepMismatch).toBe(false)
    // La vérification existe bien dans ce navigateur d'essai : avec l'ancien pas de 0,01, le même champ aurait été refusé.
    const ancien = document.createElement('input')
    ancien.type = 'number'
    ancien.step = '0.01'
    ancien.value = '0.123456'
    expect(ancien.validity.stepMismatch).toBe(true)
  })

  it('« Enregistrer le brouillon » envoie le prix à six décimales sans l’arrondir, par la soumission du formulaire', async () => {
    await monter(espace)
    fireEvent.change(document.querySelector('#tiers-nom')!, { target: { value: 'Client SARL' } })
    saisir(0, 'designation', 'Pièce')
    saisir(0, 'prix', '0.123456')
    saisir(0, 'quantite', '3')
    await act(async () => { fireEvent.click(bouton('Enregistrer le brouillon')) })
    expect(facturesEnregistrees()).toHaveLength(1)
    const lignes = facturesEnregistrees()[0].params.p_lignes as { prix_unitaire_ht: number; quantite: number }[]
    expect(lignes).toHaveLength(1)
    expect(lignes[0].prix_unitaire_ht).toBe(0.123456)
    expect(lignes[0].quantite).toBe(3)
  })

  it('un article à six décimales traverse le formulaire : choisi, le prix part tel quel', async () => {
    await monter(espace)
    await chargerLesArticles()
    fireEvent.change(document.querySelector('#tiers-nom')!, { target: { value: 'Client SARL' } })
    await choisir(/^Pièce détachée/)
    await act(async () => { fireEvent.click(bouton('Enregistrer le brouillon')) })
    expect((facturesEnregistrees()[0].params.p_lignes as { prix_unitaire_ht: number }[])[0].prix_unitaire_ht).toBe(0.123456)
  })

  it('le TOTAL reste au centime : aucun calcul ne change', async () => {
    await monter(espace)
    saisir(0, 'designation', 'Pièce')
    saisir(0, 'prix', '0.123456')
    saisir(0, 'quantite', '1000')
    saisir(0, 'taux', '0')
    expect(lisible(screen.getByText('Total HT').nextElementSibling?.textContent ?? '')).toBe('123,46 €')
  })

  it('au-delà de six décimales, le refus du générateur se dit avant le clic, comme aujourd’hui', async () => {
    await monter(espace, { statut: 'franchise' })
    fireEvent.change(document.querySelector('#tiers-nom')!, { target: { value: 'Client SARL' } })
    saisir(0, 'designation', 'Pièce')
    saisir(0, 'prix', '0.1234567')
    // Une entreprise : la facture devra pouvoir partir par une plateforme agréée, et le générateur juge ses lignes.
    fireEvent.change(document.querySelector('#type-client')!, { target: { value: 'assujetti' } })
    expect(await screen.findByText(/Ligne 1 : le prix ne s’écrit pas avec six décimales au plus\./)).toBeTruthy()
  })
})

describe('Un article dans la facture — les mots du client', () => {
  // Les textes que le client lit, états par états : les mêmes, montés pour le cabinet, portent au moins un mot du cabinet
  // quand ils en disent un — le garde n'est pas aveugle (FacturesTabClient.test.tsx).
  async function textesDuClient(): Promise<string[]> {
    const textes: string[] = []
    const noter = () => textes.push(document.body.textContent ?? '')
    await monter('client', { statut: null })
    await chargerLesArticles()
    saisir(0, 'designation', 'Séance à la main')
    saisir(0, 'prix', '12.5')
    noter()
    const choix = await choisirUnArticle()
    textes.push(choix.textContent ?? '')
    fireEvent.click(within(choix).getByRole('button', { name: /^Consultation de conseil/ }))
    const confirmation = await screen.findByRole('alertdialog')
    textes.push(confirmation.textContent ?? '')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Remplacer' }))
    noter()
    saisir(0, 'prix', '65')
    fireEvent.click(boutonDeLigne('Mettre l’article à ce prix'))
    textes.push((await screen.findByRole('alertdialog')).textContent ?? '')
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Annuler' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Ligne' }))
    saisir(1, 'designation', 'Autre séance')
    fireEvent.click(boutonDeLigne('Enregistrer comme article', 1))
    textes.push((await screen.findByRole('dialog', { name: 'Nouvel article' })).textContent ?? '')
    return textes
  }

  it('dans l’espace du client : aucun renvoi à un onglet, aucun « le client qui porte », aucun vouvoiement', async () => {
    const textes = await textesDuClient()
    expect(textes.length).toBeGreaterThanOrEqual(6)
    // Le garde lit les textes des articles et des fenêtres : on retire du texte de la page ce que le formulaire dit d'AUTRE (ses
    // propres mentions, gardées par FacturesTabClient.test.tsx) en ne lisant que les fenêtres et les lignes d'article.
    for (const t of textes.slice(1)) expect(motsDuCabinet(t), t).toEqual([])
  })

  it('le garde n’est pas aveugle : ces mêmes fenêtres, au cabinet, parlent d’un onglet ou du client qui porte la case', async () => {
    await monter('cabinet', { statut: null })
    await chargerLesArticles()
    saisir(0, 'designation', 'Séance à la main')
    fireEvent.click(boutonDeLigne('Enregistrer comme article'))
    const saisieOuverte = await screen.findByRole('dialog', { name: 'Nouvel article' })
    // La saisie dit, au cabinet, que le client « Ventes » la lit : une phrase du cabinet que le garde reconnaît.
    expect(motsDuCabinet(saisieOuverte.textContent ?? '').length).toBeGreaterThan(0)
  })
})

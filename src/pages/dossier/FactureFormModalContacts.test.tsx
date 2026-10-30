import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FactureFormModal from './FactureFormModal'
import { motsDuCabinet, pourLEspace } from '../../lib/espaceVentes'
import { REFUS_ENREGISTREMENT_CONTACT } from '../../lib/contacts'
import { LIBELLE_NOM_CONTACT, LIBELLE_NOM_CONTACT_CLIENT } from '../../lib/droitsAcces'
import { MENTIONS_VIDES, NON_BASCULE } from '../../test/factures'
import { contact } from '../../test/contacts'
import type { ArticleExoneration, Contact, FactureEmise, StatutTva } from '../../lib/types'

// L'ÉTAT D'AVANT L'ÉTAPE A7B, éprouvé tant que son code existe (CLAUDE.md, « Tests ») : le drapeau `MENTIONS_FIGEES_EXPORTEES`
// baissé, le formulaire n'envoie ni ne lit rien de neuf. Ce que le drapeau levé change se joue dans
// FactureFormModalMentionsFigees.test.tsx.
vi.mock('../../lib/mentionsFigees', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/mentionsFigees')>()), MENTIONS_FIGEES_EXPORTEES: false,
}))


// UN CLIENT DANS LE FORMULAIRE D'UNE FACTURE (espace client, étape A4b2), monté pour le cabinet et pour le client « Ventes », sous
// un faux client qui APPLIQUE les filtres (src/test/filtresPostgrest.ts) et dont `enregistrer_contact` écrit la table d'essai. Ce
// que ces cas gardent, et qu'aucun calcul pur ne voit :
//  1. la lecture : « Chargement… » et aucun geste avant son retour ; partielle, refusée ou qui lève, elle se dit et n'offre aucun
//     geste ; un fichier vide se dit ; le drapeau d'export rebaissé, rien ne se lit ni ne s'offre ;
//  2. le choix : la fenêtre (les clients en cours seulement, la recherche), le client ENTIER mis dans la facture, un champ absent
//     vidé, l'échéance du délai ; un client déjà saisi ne se remplace qu'après une confirmation qui nomme ce qui part ;
//  3. l'échéance : calculée au choix, jamais recalculée en silence — la date d'émission changée le DIT et l'offre d'un clic ;
//  4. la règle des soins : DITE dans la facture (une information, rien n'est refusé : brouillon et validation partent), les clients
//     qu'elle refuse ne se proposent pas, « Enregistrer ce client » est refusé avant le clic ;
//  5. « Enregistrer ce client » : la fenêtre préremplie, le refus du module avant le clic (un SIRET pris nomme son contact), l'écriture
//     par `enregistrer_contact` seule, la provenance, le refus de la base, le verrou (deux clics du même `act`, puis trois) ;
//  6. l'exclusion avec l'enregistrement de la facture et avec les gestes d'article, dans les deux sens ;
//  7. les mots du client. Données FICTIVES (les identifiants sont ceux des essais du dépôt).

const faux = vi.hoisted(() => ({
  contacts: [] as Record<string, unknown>[],
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
vi.mock('../../lib/contacts', async (original) => ({
  ...(await original<typeof import('../../lib/contacts')>()),
  get CONTACTS_EXPORTES() { return faux.drapeau },
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
        if (nom === 'enregistrer_article') {
          return { data: { id: 'neuf-article', dossier_id: params.p_dossier_id, retire_le: null, ...(params.p_article as object) }, error: null }
        }
        if (nom !== 'enregistrer_contact') throw new Error(`Fonction non attendue dans ce test : ${nom}`)
        const ecrit = {
          id: `neuf-${faux.contacts.length + 1}`, dossier_id: params.p_dossier_id, genre: 'client', retire_le: null, retire_par: null,
          efface_le: null, efface_par: null, cree_par: 'u-moi', cree_le: instant, modifie_par: null, modifie_le: null, ...(params.p_contact as object),
        }
        faux.contacts = [...faux.contacts, ecrit]
        return { data: ecrit, error: null }
      },
      from: (table: string) => {
        if (table !== 'contacts' && table !== 'articles' && table !== 'facture_lignes') throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: Predicat[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const partir = () => {
          if (table === 'facture_lignes') return { data: faux.lignes, error: null, count: faux.lignes.length }
          // Les articles : le catalogue est vide ici ; leurs cas sont dans FactureFormModalArticles.test.tsx.
          if (table === 'articles') return { data: [], error: null, count: 0 }
          if (faux.leve) throw new Error('réseau coupé')
          faux.lectures += 1
          const toutes = filtrer(faux.contacts, predicats)
          return { data: toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres)), error: null, count: toutes.length }
        }
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            if (table === 'contacts' && faux.retenirLecture) {
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
const nues = (lignes: readonly Contact[]): Record<string, unknown>[] => lignes.map((l) => ({ ...l }))

const AUBERT = contact({
  id: 'c1', nom: 'Aubert SAS', type_client: 'assujetti', adresse: '12 rue des Essais, 75001 Paris', siren: '123456782', siret: '12345678200010',
  adresse_electronique: '123456782', delai_paiement_jours: 30,
})
const MAIRIE = contact({
  id: 'c2', nom: 'Mairie d’Essai', type_client: 'organisme_public', adresse: '1 place fictive', siren: '100000207', siret: '10000020700017',
  adresse_electronique: '100000207', code_service: 'SERVICE-7', delai_paiement_jours: 45,
})
const PARTICULIER = contact({
  id: 'c3', nom: 'Particulier Fictif', type_client: 'non_assujetti', adresse: '3 rue fictive', siren: null, siret: null, delai_paiement_jours: null,
})
const ASSOCIATION = contact({
  id: 'c4', nom: 'Association Essai', type_client: 'non_assujetti', adresse: '4 rue fictive', siren: '123456782', siret: null, delai_paiement_jours: 15,
})
const ETRANGER = contact({
  id: 'c5', nom: 'Société Étrangère', type_client: 'etranger', adresse: '5 Fictive Street', siren: null, siret: null, delai_paiement_jours: null,
})
const RETIRE = contact({ id: 'c6', nom: 'Ancien client retiré', retire_le: '2027-10-05T08:00:00Z', retire_par: 'u-x', siren: '987654324', siret: null })
const EFFACE = contact({
  id: 'c7', nom: 'Contact effacé le 06/10/2027', efface_le: '2027-10-06T08:00:00Z', efface_par: 'u-x', type_client: null, adresse: null,
  siren: null, siret: null, adresse_electronique: null, code_service: null, email: null, delai_paiement_jours: null,
})
const AUTRE_DOSSIER = contact({ id: 'x9', dossier_id: 'd2', nom: 'Client d’un autre dossier' })
const TOUS = [AUBERT, MAIRIE, PARTICULIER, ASSOCIATION, ETRANGER, RETIRE, EFFACE, AUTRE_DOSSIER]

// L'insécable et la fine insécable se lisent comme des espaces (un montant ne se coupe pas en fin de ligne).
const lisible = (t: string | null) => (t ?? '').replace(/[  ]/g, ' ')

function brouillon(o: Partial<FactureEmise> = {}): FactureEmise {
  return {
    id: 'f1', dossier_id: 'd1', type: 'facture', numero: null, statut: 'brouillon', date_emission: '2027-11-01', date_echeance: null,
    tiers_nom: 'Client SARL', tiers_adresse: null, tiers_siret: null, emetteur_nom: 'Dossier fictif', emetteur_siret: null, emetteur_adresse: null,
    montant_ht: 0, montant_tva: 0, montant_ttc: 0, mentions_legales: null, notes: null, facture_origine_id: null, motif_avoir: null,
    created_at: '2027-11-01T09:00:00Z', created_by: null, valide_par: null, ...MENTIONS_VIDES, ...o,
  } as FactureEmise
}

interface Options { statut?: StatutTva | null; exo?: ArticleExoneration | null; facture?: FactureEmise | null; emission?: string | null }

async function monter(espace: 'cabinet' | 'client', o: Options = {}) {
  const props = {
    dossierId: 'd1', dossierNom: 'Dossier fictif', dossierSiret: null, dossierAdresse: null, statutTva: o.statut === undefined ? 'redevable' : o.statut,
    articleExoneration: o.exo ?? null, numeroTvaAttribue: false, tvaSurDebits: false, facture: o.facture ?? null, onClose: () => {}, onSaved: () => {},
  } as const
  render(espace === 'client' ? <FactureFormModal reglageDesVentes={NON_BASCULE} espace="client" {...props} /> : <FactureFormModal reglageDesVentes={NON_BASCULE} espace="cabinet" onAdresseUpdated={() => {}} {...props} />)
  if (o.facture) await screen.findByText('Adresse de l\'émetteur', { exact: false })
  // La date d'émission du jour changerait les échéances d'un test à l'autre : elle est posée, comme le ferait une saisie.
  if (o.emission !== null && !o.facture) fireEvent.change(champ('#date-emission'), { target: { value: o.emission ?? '2027-11-01' } })
}

const champ = (selecteur: string) => document.querySelector<HTMLInputElement>(selecteur)!
const valeur = (selecteur: string) => (document.querySelector(selecteur) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null)?.value
const saisirChamp = (selecteur: string, v: string) => fireEvent.change(document.querySelector(selecteur)!, { target: { value: v } })
const bouton = (nom: string | RegExp) => screen.getByRole('button', { name: nom }) as HTMLButtonElement
const boutons = (nom: string | RegExp) => screen.queryAllByRole('button', { name: nom }) as HTMLButtonElement[]

const client = () => ({
  nom: valeur('#tiers-nom'), adresse: valeur('#tiers-adresse'), siret: valeur('#tiers-siret'), type: valeur('#type-client'),
  siren: valeur('#tiers-siren'), adresseElectronique: valeur('#tiers-adresse-electronique'), codeService: valeur('#code-service'),
  echeance: valeur('#date-echeance'),
})

async function chargerLesContacts() {
  await screen.findByRole('button', { name: 'Choisir un client' })
}
const ouvrirLeChoix = async () => {
  fireEvent.click(bouton('Choisir un client'))
  return screen.findByRole('dialog', { name: 'Choisir un client' })
}
async function choisir(nom: RegExp) {
  const fenetre = await ouvrirLeChoix()
  fireEvent.click(within(fenetre).getByRole('button', { name: nom }))
}
const provenance = () => document.body.textContent?.match(/Client du fichier : ([^]*?)(Choisir un client|Enregistrer ce client|Clients :|$)/)?.[1]?.trim() ?? null
const ecritures = () => faux.rpcs.filter((r) => r.nom === 'enregistrer_contact')
const facturesEnregistrees = () => faux.rpcs.filter((r) => r.nom === 'enregistrer_facture')
const soumettre = () => act(async () => { fireEvent.submit(document.querySelector('form')!) })

beforeEach(() => {
  faux.contacts = nues(TOUS)
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

describe.each(['cabinet', 'client'] as const)('Un client dans la facture — la lecture (%s)', (espace) => {
  it('avant sa lecture : « Chargement… », aucun geste, jamais « aucun client » ; revenue, les gestes', async () => {
    faux.retenirLecture = true
    await monter(espace)
    saisirChamp('#tiers-nom', 'Client à la main')
    expect(screen.getByText(/Clients : Chargement…/)).toBeTruthy()
    expect(boutons('Choisir un client')).toHaveLength(0)
    expect(boutons('Enregistrer ce client')).toHaveLength(0)
    expect(screen.queryByText(/aucun client/i)).toBeNull()
    await act(async () => { faux.retenirLecture = false; for (const r of faux.lecturesEnAttente.splice(0)) r() })
    await chargerLesContacts()
    expect(screen.queryByText(/Clients : Chargement…/)).toBeNull()
    expect(boutons('Enregistrer ce client')).toHaveLength(1)
  })

  it('lue en partie : le bandeau, AUCUN geste, jamais « aucun client en cours »', async () => {
    faux.muetApres = 2
    await monter(espace)
    saisirChamp('#tiers-nom', 'Client à la main')
    const quoi = espace === 'client' ? 'Tes clients' : 'Les clients du dossier'
    await screen.findByText(new RegExp(`^${quoi} n'ont pas pu être (lus|affichés) en entier`))
    expect(screen.getByText(/Aucun client ne peut donc être choisi ni enregistré d’ici/)).toBeTruthy()
    expect(boutons('Choisir un client')).toHaveLength(0)
    expect(boutons('Enregistrer ce client')).toHaveLength(0)
    expect(screen.queryByText(/aucun client en cours/i)).toBeNull()
  })

  it('refusée ou qui lève : le message, aucun geste', async () => {
    faux.leve = true
    await monter(espace)
    saisirChamp('#tiers-nom', 'Client à la main')
    await screen.findByText(new RegExp(`^${espace === 'client' ? 'Tes clients ne se lisent pas' : 'Les clients ne se lisent pas'} : réseau coupé\\.`))
    expect(boutons('Choisir un client')).toHaveLength(0)
    expect(boutons('Enregistrer ce client')).toHaveLength(0)
  })

  it('un fichier vide, lu en entier : il le dit ; rien à choisir, mais « Enregistrer ce client » reste offert', async () => {
    faux.contacts = nues([RETIRE, EFFACE, AUTRE_DOSSIER])
    await monter(espace)
    saisirChamp('#tiers-nom', 'Client à la main')
    await screen.findByText(/aucun client en cours/)
    expect(boutons('Choisir un client')).toHaveLength(0)
    expect(boutons('Enregistrer ce client')).toHaveLength(1)
  })

  it('le drapeau d’export rebaissé : aucune lecture de la table, aucun geste, aucun mot sur les clients', async () => {
    faux.drapeau = false
    await monter(espace, { statut: 'exonere', exo: 'cgi_261_4_1' })
    saisirChamp('#tiers-nom', 'Client à la main')
    saisirChamp('#type-client', 'non_assujetti')
    await act(async () => { await Promise.resolve() })
    expect(faux.lectures).toBe(0)
    expect(boutons('Choisir un client')).toHaveLength(0)
    expect(boutons('Enregistrer ce client')).toHaveLength(0)
    expect(screen.queryByText(/Clients :|client en cours|soins exonérés/)).toBeNull()
  })

  it('les contacts se lisent UNE fois à l’ouverture', async () => {
    await monter(espace)
    await chargerLesContacts()
    expect(faux.lectures).toBe(1)
  })
})

describe.each(['cabinet', 'client'] as const)('Un client dans la facture — la fenêtre du choix (%s)', (espace) => {
  it('les clients EN COURS du dossier seulement : jamais un retiré, un effacé ni un client d’un autre dossier', async () => {
    await monter(espace)
    await chargerLesContacts()
    const fenetre = await ouvrirLeChoix()
    const noms = within(fenetre).getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(noms).toHaveLength(5)
    expect(noms.some((n) => /Ancien client|effacé|autre dossier/i.test(n))).toBe(false)
    // Même en cherchant le retiré par son SIREN.
    fireEvent.change(within(fenetre).getByPlaceholderText('Rechercher un nom, un SIREN, un SIRET…'), { target: { value: '987654324' } })
    expect(within(fenetre).getByText('Aucun client ne correspond à « 987654324 ».')).toBeTruthy()
  })

  it('la recherche de l’application : le nom, le SIREN et le SIRET, accents et casse ignorés', async () => {
    await monter(espace)
    await chargerLesContacts()
    const fenetre = await ouvrirLeChoix()
    const recherche = within(fenetre).getByPlaceholderText('Rechercher un nom, un SIREN, un SIRET…')
    // Les termes se cherchent en ET, accents et casse ignorés.
    fireEvent.change(recherche, { target: { value: 'mairie d essai' } })
    expect(within(fenetre).getAllByRole('listitem')).toHaveLength(1)
    fireEvent.change(recherche, { target: { value: 'mairie zzz' } })
    expect(within(fenetre.querySelector('ul') ?? fenetre).queryAllByRole('listitem')).toHaveLength(0)
    fireEvent.change(recherche, { target: { value: 'MAIRIE D’ESSAI' } })
    expect(within(fenetre).getAllByRole('listitem')).toHaveLength(1)
    fireEvent.change(recherche, { target: { value: '10000020700017' } })
    expect(within(fenetre).getAllByRole('listitem')).toHaveLength(1)
    fireEvent.change(recherche, { target: { value: '123456782' } })
    // Aubert (SIREN, SIRET) et l'association (SIREN) ; « N sur M » compte avant la recherche.
    expect(within(fenetre).getAllByRole('listitem')).toHaveLength(2)
    expect(within(fenetre).getByText('2 sur 5')).toBeTruthy()
    fireEvent.change(recherche, { target: { value: 'société étrangère' } })
    expect(within(fenetre).getAllByRole('listitem')).toHaveLength(1)
  })

  it('la fenêtre dit chaque client : identifiant, type aux mots du formulaire, délai et l’échéance qu’il donnerait', async () => {
    await monter(espace)
    await chargerLesContacts()
    const fenetre = await ouvrirLeChoix()
    const aubert = within(fenetre).getByRole('button', { name: /^Aubert SAS/ })
    expect(lisible(aubert.textContent)).toContain('SIRET 12345678200010 · une entreprise établie en France · délai 30 jours (échéance le 01/12/2027)')
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('dialog', { name: 'Choisir un client' })).toBeNull()
    expect(champ('#tiers-nom').value).toBe('')
  })
})

describe.each(['cabinet', 'client'] as const)('Un client dans la facture — le choix (%s)', (espace) => {
  it('un formulaire vide se remplit directement, sans confirmation : le client ENTIER et l’échéance ; rien ne s’écrit', async () => {
    await monter(espace)
    await chargerLesContacts()
    await choisir(/^Aubert SAS/)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(client()).toEqual({
      nom: 'Aubert SAS', adresse: '12 rue des Essais, 75001 Paris', siret: '12345678200010', type: 'assujetti', siren: '123456782',
      adresseElectronique: '123456782', codeService: undefined, echeance: '2027-12-01',
    })
    expect(provenance()).toBe('Aubert SAS')
    expect(faux.rpcs).toEqual([])
    expect(screen.queryByRole('dialog', { name: 'Choisir un client' })).toBeNull()
  })

  it('un organisme public : le code service et le SIREN arrivent, et la mention d’engagement du formulaire n’est pas touchée', async () => {
    await monter(espace)
    await chargerLesContacts()
    saisirChamp('#type-client', 'organisme_public')
    saisirChamp('#numero-engagement', 'ENG-2027-1')
    await choisir(/^Mairie d’Essai/)
    expect(client().codeService).toBe('SERVICE-7')
    expect(client().echeance).toBe('2027-12-16')
    expect(valeur('#numero-engagement')).toBe('ENG-2027-1')
  })

  it('un client sans SIREN ni adresse de facturation électronique : ces champs repartent VIDES, jamais un reste du client précédent', async () => {
    await monter(espace)
    await chargerLesContacts()
    await choisir(/^Mairie d’Essai/)
    expect(client().codeService).toBe('SERVICE-7')
    // Le formulaire porte maintenant les valeurs de la mairie : le choix suivant les remplace, après confirmation.
    await choisir(/^Particulier Fictif/)
    const confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Remplacer' }))
    expect(client()).toMatchObject({ nom: 'Particulier Fictif', type: 'non_assujetti', siren: '', siret: '' })
    // Le type « organisme public » rouvre les champs cachés : ils sont vides.
    saisirChamp('#type-client', 'organisme_public')
    expect(valeur('#code-service')).toBe('')
    expect(valeur('#tiers-adresse-electronique')).toBe('')
    saisirChamp('#type-client', 'non_assujetti')
    expect(valeur('#tiers-adresse-electronique')).toBeUndefined()
  })

  it('un client déjà saisi : la confirmation NOMME ce qui part, dans l’ordre du formulaire ; « Annuler » laisse tout', async () => {
    await monter(espace)
    await chargerLesContacts()
    saisirChamp('#tiers-nom', 'Client à la main')
    saisirChamp('#tiers-adresse', 'Une adresse à la main')
    saisirChamp('#tiers-siret', '10000020700017')
    saisirChamp('#date-echeance', '2027-12-24')
    await choisir(/^Aubert SAS/)
    const confirmation = await screen.findByRole('alertdialog', { name: 'Remplacer le client de la facture ?' })
    expect(lisible(confirmation.textContent)).toContain(
      'Choisir le client « Aubert SAS » remplace le nom « Client à la main », le SIREN 100000207, le SIRET 10000020700017, l’adresse « Une adresse à la main » '
      + 'et l’échéance du 24/12/2027 de cette facture.')
    expect(lisible(confirmation.textContent)).toContain('La facture garde sa copie du client')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(client()).toMatchObject({ nom: 'Client à la main', adresse: 'Une adresse à la main', siret: '10000020700017', echeance: '2027-12-24' })
    expect(provenance()).toBeNull()
  })

  it('confirmé : le client est remplacé, la provenance posée, rien n’est écrit', async () => {
    await monter(espace)
    await chargerLesContacts()
    saisirChamp('#tiers-nom', 'Client à la main')
    await choisir(/^Aubert SAS/)
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remplacer' }))
    expect(client()).toMatchObject({ nom: 'Aubert SAS', siret: '12345678200010', echeance: '2027-12-01' })
    expect(provenance()).toBe('Aubert SAS')
    expect(faux.rpcs).toEqual([])
  })

  it('un client qui dit déjà ce que le contact apporte : rien à confirmer', async () => {
    await monter(espace)
    await chargerLesContacts()
    await choisir(/^Aubert SAS/)
    await choisir(/^Aubert SAS/)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('sans délai, l’échéance saisie RESTE (et ne se nomme pas dans ce que le choix remplace)', async () => {
    await monter(espace)
    await chargerLesContacts()
    saisirChamp('#date-echeance', '2027-12-24')
    await choisir(/^Particulier Fictif/)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(client().echeance).toBe('2027-12-24')
    expect(screen.queryByRole('button', { name: 'Recalculer l’échéance' })).toBeNull()
  })

  it('la facture reste LIBRE : retoucher le client n’écrit rien, et la provenance reste', async () => {
    await monter(espace)
    await chargerLesContacts()
    await choisir(/^Aubert SAS/)
    saisirChamp('#tiers-nom', 'Aubert SAS (agence)')
    saisirChamp('#tiers-adresse', 'Une autre adresse')
    expect(faux.rpcs).toEqual([])
    expect(faux.contacts.find((c) => c.id === 'c1')).toMatchObject({ nom: 'Aubert SAS', adresse: '12 rue des Essais, 75001 Paris' })
    expect(provenance()).toBe('Aubert SAS')
    // Un client issu du fichier ne se range pas une seconde fois d'ici.
    expect(boutons('Enregistrer ce client')).toHaveLength(0)
  })

  it('le client choisi part dans la facture : nom, adresse, SIRET, type, SIREN, adresse électronique, échéance', async () => {
    await monter(espace)
    await chargerLesContacts()
    await choisir(/^Aubert SAS/)
    saisirChamp('#nature-operation', 'services')
    fireEvent.change(document.querySelector('tbody input')!, { target: { value: 'Séance' } })
    fireEvent.change(document.querySelectorAll('tbody input')[2], { target: { value: '100' } })
    await act(async () => { fireEvent.click(bouton('Enregistrer le brouillon')) })
    expect(facturesEnregistrees()).toHaveLength(1)
    expect(facturesEnregistrees()[0].params.p_facture).toMatchObject({
      tiers_nom: 'Aubert SAS', tiers_adresse: '12 rue des Essais, 75001 Paris', tiers_siret: '12345678200010', type_client: 'assujetti',
      tiers_siren: '123456782', tiers_adresse_electronique: '123456782', code_service: null, date_echeance: '2027-12-01',
    })
  })

  it('une facture rouverte n’a aucune provenance : « Enregistrer ce client » s’offre, et choisir confirme le remplacement', async () => {
    await monter(espace, { facture: brouillon() })
    await chargerLesContacts()
    expect(provenance()).toBeNull()
    expect(boutons('Enregistrer ce client')).toHaveLength(1)
    await choisir(/^Aubert SAS/)
    const confirmation = await screen.findByRole('alertdialog')
    expect(lisible(confirmation.textContent)).toContain('remplace le nom « Client SARL »')
  })

  it('pendant l’enregistrement de la facture, « Choisir un client » est grisé', async () => {
    await monter(espace)
    await chargerLesContacts()
    saisirChamp('#tiers-nom', 'Client SARL')
    fireEvent.change(document.querySelector('tbody input')!, { target: { value: 'Séance' } })
    fireEvent.change(document.querySelectorAll('tbody input')[2], { target: { value: '100' } })
    faux.retenirFacture = true
    await act(async () => { fireEvent.click(bouton('Enregistrer le brouillon')) })
    expect(bouton('Choisir un client').disabled).toBe(true)
    await act(async () => { faux.retenirFacture = false; for (const r of faux.factureEnAttente.splice(0)) r() })
  })
})

describe.each(['cabinet', 'client'] as const)('Un client dans la facture — l’échéance, jamais recalculée en silence (%s)', (espace) => {
  it('la date d’émission change : le formulaire le DIT, l’échéance ne bouge pas, et un clic la recalcule', async () => {
    await monter(espace)
    await chargerLesContacts()
    await choisir(/^Aubert SAS/)
    expect(screen.queryByRole('button', { name: 'Recalculer l’échéance' })).toBeNull()
    saisirChamp('#date-emission', '2027-11-10')
    // Rien n'a été recalculé.
    expect(client().echeance).toBe('2027-12-01')
    expect(lisible(document.body.textContent)).toContain(
      'La date d’émission a changé depuis le choix du client « Aubert SAS » : son délai de paiement (30 jours) donnerait une échéance au 10/12/2027.')
    await act(async () => { fireEvent.click(bouton('Recalculer l’échéance')) })
    expect(client().echeance).toBe('2027-12-10')
    expect(screen.queryByRole('button', { name: 'Recalculer l’échéance' })).toBeNull()
    // Et la nouvelle émission est celle que le formulaire suit désormais.
    saisirChamp('#date-emission', '2027-11-12')
    expect(lisible(document.body.textContent)).toContain('donnerait une échéance au 12/12/2027')
    expect(client().echeance).toBe('2027-12-10')
  })

  it('l’émission revient à celle du choix : plus rien à dire', async () => {
    await monter(espace)
    await chargerLesContacts()
    await choisir(/^Aubert SAS/)
    saisirChamp('#date-emission', '2027-11-10')
    expect(screen.getByRole('button', { name: 'Recalculer l’échéance' })).toBeTruthy()
    saisirChamp('#date-emission', '2027-11-01')
    expect(screen.queryByRole('button', { name: 'Recalculer l’échéance' })).toBeNull()
  })

  it('une échéance déjà celle du délai : rien à dire', async () => {
    await monter(espace)
    await chargerLesContacts()
    await choisir(/^Aubert SAS/)
    saisirChamp('#date-emission', '2027-11-10')
    saisirChamp('#date-echeance', '2027-12-10')
    expect(screen.queryByRole('button', { name: 'Recalculer l’échéance' })).toBeNull()
  })

  it('un choix sans délai ne laisse rien à suivre : changer l’émission ne dit rien', async () => {
    await monter(espace)
    await chargerLesContacts()
    await choisir(/^Particulier Fictif/)
    saisirChamp('#date-emission', '2027-11-10')
    expect(screen.queryByRole('button', { name: 'Recalculer l’échéance' })).toBeNull()
  })

  it('un autre client choisi remplace le délai suivi : l’ancien n’est plus dit', async () => {
    await monter(espace)
    await chargerLesContacts()
    await choisir(/^Aubert SAS/)
    await choisir(/^Particulier Fictif/)
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remplacer' }))
    saisirChamp('#date-emission', '2027-11-10')
    expect(screen.queryByRole('button', { name: 'Recalculer l’échéance' })).toBeNull()
  })

  it('l’émission d’un formulaire dont le champ est vidé : le délai est retenu, l’échéance se propose dès que la date se lit', async () => {
    await monter(espace)
    await chargerLesContacts()
    saisirChamp('#date-emission', '')
    await choisir(/^Aubert SAS/)
    expect(client().echeance).toBe('')
    saisirChamp('#date-emission', '2027-11-05')
    expect(lisible(document.body.textContent)).toContain('donnerait une échéance au 05/12/2027')
  })
})

describe.each(['cabinet', 'client'] as const)('Un client dans la facture — la règle des soins (%s)', (espace) => {
  const soins = { statut: 'exonere' as const, exo: 'cgi_261_4_1' as const }
  const info = (cle: 'soins_particulier' | 'soins_etranger') => REFUS_ENREGISTREMENT_CONTACT.find((r) => r.cle === cle)!.modele

  it('un particulier dans un dossier de soins : la facture le DIT — pourquoi, et que rien n’est refusé', async () => {
    await monter(espace, soins)
    await chargerLesContacts()
    saisirChamp('#tiers-nom', 'Particulier à la main')
    expect(screen.queryByRole('note')).toBeNull()
    saisirChamp('#type-client', 'non_assujetti')
    const note = screen.getByRole('note')
    expect(note.textContent).toContain(espace === 'client' ? 'Ta société dispense des soins exonérés' : 'Ce dossier dispense des soins exonérés')
    expect(note.textContent).toContain('une facture à un particulier y nomme un patient')
    expect(note.textContent).toContain('La facture reste possible — elle s’enregistre et se valide —')
    // Une information, pas une alerte : la teinte neutre, que le système visuel définit par ses seuls jetons.
    expect(note.className).toBe('note-info')
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    const regle = /\.note-info \{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(regle).toContain('var(--color-surface-2)')
    expect(regle).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|danger/)
  })

  it('un client établi hors de France : le second motif', async () => {
    await monter(espace, soins)
    await chargerLesContacts()
    saisirChamp('#tiers-nom', 'Abroad')
    saisirChamp('#type-client', 'etranger')
    expect(screen.getByRole('note').textContent).toContain('peut nommer un particulier, donc un patient')
  })

  it('une association (un non-assujetti qui a son SIREN), une entreprise, un type pas encore choisi : rien à dire', async () => {
    await monter(espace, soins)
    await chargerLesContacts()
    saisirChamp('#tiers-nom', 'Association')
    saisirChamp('#type-client', 'non_assujetti')
    expect(screen.getByRole('note')).toBeTruthy()
    saisirChamp('#tiers-siren', '123456782')
    expect(screen.queryByRole('note')).toBeNull()
    saisirChamp('#type-client', 'assujetti')
    expect(screen.queryByRole('note')).toBeNull()
    saisirChamp('#type-client', '')
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('un dossier qui n’est pas de soins : jamais cette information, même pour un particulier', async () => {
    await monter(espace, { statut: 'redevable' })
    await chargerLesContacts()
    saisirChamp('#tiers-nom', 'Particulier')
    saisirChamp('#type-client', 'non_assujetti')
    expect(screen.queryByRole('note')).toBeNull()
    expect(bouton('Enregistrer ce client').disabled).toBe(false)
  })

  it('c’est une INFORMATION : la facture s’enregistre et se valide quand même', async () => {
    await monter(espace, soins)
    await chargerLesContacts()
    saisirChamp('#tiers-nom', 'Particulier à la main')
    saisirChamp('#type-client', 'non_assujetti')
    fireEvent.change(document.querySelector('tbody input')!, { target: { value: 'Acte' } })
    fireEvent.change(document.querySelectorAll('tbody input')[2], { target: { value: '40' } })
    saisirChamp('#nature-operation', 'services')
    expect(screen.getByRole('note')).toBeTruthy()
    expect(bouton('Enregistrer le brouillon').disabled).toBe(false)
    expect(bouton('Valider la facture').disabled).toBe(false)
    await act(async () => { fireEvent.click(bouton('Enregistrer le brouillon')) })
    expect(facturesEnregistrees()).toHaveLength(1)
    await act(async () => { fireEvent.click(bouton('Valider la facture')) })
    expect(facturesEnregistrees()).toHaveLength(2)
    expect(facturesEnregistrees()[1].params.p_valider).toBe(true)
  })

  it('« Enregistrer ce client » est refusé avant le clic, sous les mots de la base — dits aussi sous le bouton', async () => {
    await monter(espace, soins)
    await chargerLesContacts()
    saisirChamp('#tiers-nom', 'Particulier à la main')
    saisirChamp('#type-client', 'non_assujetti')
    const b = bouton('Enregistrer ce client')
    expect(b.disabled).toBe(true)
    expect(b.title).toBe(pourLEspace(espace, info('soins_particulier')))
    expect(screen.getAllByText(pourLEspace(espace, info('soins_particulier')))).toHaveLength(1)
    fireEvent.click(b)
    expect(screen.queryByRole('dialog', { name: 'Nouveau client' })).toBeNull()
    expect(faux.rpcs).toEqual([])
    // Un SIREN donné rend le client admissible : le bouton se dégrise.
    saisirChamp('#tiers-siren', '123456782')
    expect(bouton('Enregistrer ce client').disabled).toBe(false)
  })

  it('« Choisir un client » ne propose pas ceux que la règle refuse, et le dit : combien, pourquoi, où ils s’effacent', async () => {
    await monter(espace, soins)
    await chargerLesContacts()
    const fenetre = await ouvrirLeChoix()
    const noms = within(fenetre).getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent)
    expect(noms).toEqual(['Association Essai', 'Aubert SAS', 'Mairie d’Essai'])
    const note = within(fenetre).getByRole('note')
    expect(note.textContent).toContain('2 clients rangés avant que')
    expect(note.textContent).toContain('la règle des soins les refuse')
    expect(note.textContent).toContain(espace === 'client' ? '« Mes ventes › Clients »' : 'la vue « Clients » de l’onglet Factures')
    // « N sur M » ne compte que ceux qu'on propose.
    fireEvent.change(within(fenetre).getByPlaceholderText('Rechercher un nom, un SIREN, un SIRET…'), { target: { value: 'aubert' } })
    expect(within(fenetre).getByText('1 sur 3')).toBeTruthy()
  })

  it('hors d’un dossier de soins, les mêmes clients se proposent tous', async () => {
    await monter(espace)
    await chargerLesContacts()
    const fenetre = await ouvrirLeChoix()
    expect(within(fenetre).getAllByRole('listitem')).toHaveLength(5)
    expect(within(fenetre).queryByRole('note')).toBeNull()
  })

  it('un dossier de soins dont tous les clients sont écartés : la fenêtre le dit, sans prétendre qu’il n’y en a aucun', async () => {
    faux.contacts = nues([PARTICULIER, ETRANGER])
    await monter(espace, soins)
    await chargerLesContacts()
    const fenetre = await ouvrirLeChoix()
    expect(within(fenetre).getByText('Aucun client à proposer.')).toBeTruthy()
    expect(within(fenetre).queryByText('Aucun client en cours.')).toBeNull()
  })

  it('au client, l’information et le refus se lisent aux mots de son espace', async () => {
    await monter(espace, soins)
    await chargerLesContacts()
    saisirChamp('#tiers-nom', 'Particulier à la main')
    saisirChamp('#type-client', 'non_assujetti')
    const texte = [screen.getByRole('note').textContent ?? '', bouton('Enregistrer ce client').title].join(' ')
    if (espace === 'client') expect(motsDuCabinet(texte)).toEqual([])
    else expect(texte).toContain('Un dossier qui dispense des soins exonérés')
  })
})

describe.each(['cabinet', 'client'] as const)('Un client dans la facture — « Enregistrer ce client » (%s)', (espace) => {
  const NOM_LIBELLE = espace === 'client' ? LIBELLE_NOM_CONTACT_CLIENT : LIBELLE_NOM_CONTACT

  async function clientALaMain(o: { siren?: string; siret?: string; adresse?: string; type?: string } = {}) {
    await monter(espace)
    await chargerLesContacts()
    saisirChamp('#tiers-nom', 'Nouvelle société')
    // Les identifiants d'abord : un client établi hors de France cache le SIREN, que la saisie du formulaire garde pourtant.
    saisirChamp('#tiers-siren', o.siren ?? '987654324')
    saisirChamp('#tiers-siret', o.siret ?? '98765432400019')
    saisirChamp('#tiers-adresse', o.adresse ?? '8 rue des Nouveautés')
    saisirChamp('#type-client', o.type ?? 'assujetti')
  }
  const ouvrirLaSaisie = async () => {
    fireEvent.click(bouton('Enregistrer ce client'))
    return screen.findByRole('dialog', { name: 'Nouveau client' })
  }

  it('offert sur un client saisi qui porte un nom ; pas sur un nom vide', async () => {
    await monter(espace)
    await chargerLesContacts()
    expect(boutons('Enregistrer ce client')).toHaveLength(0)
    saisirChamp('#tiers-nom', '   ')
    expect(boutons('Enregistrer ce client')).toHaveLength(0)
    saisirChamp('#tiers-nom', 'Nouvelle société')
    expect(boutons('Enregistrer ce client')).toHaveLength(1)
  })

  it('la fenêtre est PRÉREMPLIE des champs de la facture ; l’e-mail, le délai et les observations vides', async () => {
    await clientALaMain()
    saisirChamp('#tiers-adresse-electronique', '987654324')
    const fenetre = await ouvrirLaSaisie()
    expect((within(fenetre).getByLabelText(NOM_LIBELLE) as HTMLInputElement).value).toBe('Nouvelle société')
    expect((within(fenetre).getByLabelText('Type') as HTMLSelectElement).value).toBe('assujetti')
    expect((fenetre.querySelector('#contact-adresse') as HTMLTextAreaElement).value).toBe('8 rue des Nouveautés')
    expect((fenetre.querySelector('#contact-siren') as HTMLInputElement).value).toBe('987654324')
    expect((fenetre.querySelector('#contact-siret') as HTMLInputElement).value).toBe('98765432400019')
    expect((fenetre.querySelector('#contact-adresse-electronique') as HTMLInputElement).value).toBe('987654324')
    expect((fenetre.querySelector('#contact-email') as HTMLInputElement).value).toBe('')
    expect((fenetre.querySelector('#contact-delai') as HTMLInputElement).value).toBe('')
    expect((fenetre.querySelector('#contact-observations') as HTMLTextAreaElement).value).toBe('')
    expect(fenetre.closest('form')).toBeNull()
    expect(within(fenetre).getByRole('button', { name: 'Enregistrer' }).hasAttribute('disabled')).toBe(false)
    expect(ecritures()).toHaveLength(0)
  })

  it('l’adresse, facultative sur la facture, est exigée du contact : le refus du module se dit sans alerte, et dégrise à la saisie', async () => {
    await clientALaMain({ adresse: '' })
    const fenetre = await ouvrirLaSaisie()
    expect(within(fenetre).getByText('L\'adresse du contact est à renseigner.').className).toBe('muted')
    expect((within(fenetre).getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(fenetre.querySelector('#contact-adresse')!, { target: { value: '9 rue des Nouveautés' } })
    expect((within(fenetre).getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(false)
    expect(faux.rpcs).toEqual([])
  })

  it('un SIRET déjà pris : le refus du module nomme le contact qui le porte, avant le clic', async () => {
    await clientALaMain({ siren: '123456782', siret: '12345678200010' })
    const fenetre = await ouvrirLaSaisie()
    expect(within(fenetre).getByText('Le SIRET « 12345678200010 » est déjà celui du contact « Aubert SAS » : un établissement ne se range qu\'une fois par dossier.')).toBeTruthy()
    expect((within(fenetre).getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(true)
    // Le SIRET d'un contact RETIRÉ ou d'un autre dossier : le retiré garde le sien (contrainte totale), l'autre dossier non.
    fireEvent.change(fenetre.querySelector('#contact-siren')!, { target: { value: '987654324' } })
    fireEvent.change(fenetre.querySelector('#contact-siret')!, { target: { value: '' } })
    expect((within(fenetre).getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('écrit par `enregistrer_contact` seule, un contact neuf, tous ses champs ; la liste se relit ; le client prend le contact pour provenance', async () => {
    await clientALaMain()
    const fenetre = await ouvrirLaSaisie()
    const lecturesAvant = faux.lectures
    await act(async () => { fireEvent.click(within(fenetre).getByRole('button', { name: 'Enregistrer' })) })
    expect(ecritures()).toHaveLength(1)
    expect(ecritures()[0].params).toEqual({
      p_dossier_id: 'd1', p_contact_id: null,
      p_contact: {
        nom: 'Nouvelle société', type_client: 'assujetti', adresse: '8 rue des Nouveautés', siren: '987654324', siret: '98765432400019',
        adresse_electronique: null, code_service: null, email: null, delai_paiement_jours: null, observations: null,
      },
    })
    expect(faux.lectures).toBe(lecturesAvant + 1)
    expect(screen.queryByRole('dialog', { name: 'Nouveau client' })).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Client « Nouvelle société » enregistré.')
    // Le formulaire n'a pas changé ; son client a le nouveau contact pour provenance, et le geste n'a plus d'objet.
    expect(client()).toMatchObject({ nom: 'Nouvelle société', adresse: '8 rue des Nouveautés', siret: '98765432400019', echeance: '' })
    expect(provenance()).toBe('Nouvelle société')
    expect(boutons('Enregistrer ce client')).toHaveLength(0)
    // Et le nouveau client se choisit.
    const choix = await ouvrirLeChoix()
    expect(within(choix).getByRole('button', { name: /^Nouvelle société/ })).toBeTruthy()
  })

  it('un client établi hors de France : ni SIREN ni SIRET ne partent, comme sur la facture', async () => {
    await clientALaMain({ type: 'etranger' })
    const fenetre = await ouvrirLaSaisie()
    await act(async () => { fireEvent.click(within(fenetre).getByRole('button', { name: 'Enregistrer' })) })
    expect(ecritures()[0].params.p_contact).toMatchObject({ type_client: 'etranger', siren: null, siret: null })
  })

  it('le refus de la base se dit sous ses mots dans la fenêtre, la liste se relit, le client reste sans provenance, le verrou se relâche', async () => {
    await clientALaMain()
    const fenetre = await ouvrirLaSaisie()
    faux.refus.enregistrer_contact = 'Accès refusé à ce dossier.'
    const lecturesAvant = faux.lectures
    await act(async () => { fireEvent.click(within(fenetre).getByRole('button', { name: 'Enregistrer' })) })
    expect(within(screen.getByRole('dialog', { name: 'Nouveau client' })).getByRole('alert').textContent).toBe('Accès refusé à ce dossier.')
    expect(faux.lectures).toBe(lecturesAvant + 1)
    expect(provenance()).toBeNull()
    faux.refus = {}
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Nouveau client' })).getByRole('button', { name: 'Enregistrer' })) })
    expect(ecritures()).toHaveLength(2)
    expect(provenance()).toBe('Nouvelle société')
  })

  it('UN verrou : trois clics du même rendu, une seule écriture ; tout grisé pendant ; relâché après la relecture', async () => {
    await clientALaMain()
    const fenetre = await ouvrirLaSaisie()
    const enregistrer = within(fenetre).getByRole('button', { name: 'Enregistrer' })
    faux.retenirRpc = true
    await act(async () => { enregistrer.click(); enregistrer.click(); enregistrer.click() })
    expect(ecritures()).toHaveLength(1)
    expect(within(screen.getByRole('dialog', { name: 'Nouveau client' })).getByRole('button', { name: 'Enregistrement…' }).hasAttribute('disabled')).toBe(true)
    expect(bouton('Choisir un client').disabled).toBe(true)
    expect(bouton('Enregistrer le brouillon').disabled).toBe(true)
    expect(bouton('Valider la facture').disabled).toBe(true)
    await act(async () => { faux.retenirRpc = false; for (const r of faux.rpcEnAttente.splice(0)) r() })
    expect(ecritures()).toHaveLength(1)
    expect(bouton('Choisir un client').disabled).toBe(false)
    expect(bouton('Valider la facture').disabled).toBe(false)
  })

  it('deux clics du même rendu, une seule écriture', async () => {
    await clientALaMain()
    const fenetre = await ouvrirLaSaisie()
    const enregistrer = within(fenetre).getByRole('button', { name: 'Enregistrer' })
    faux.retenirRpc = true
    await act(async () => { enregistrer.click(); enregistrer.click() })
    expect(ecritures()).toHaveLength(1)
    await act(async () => { faux.retenirRpc = false; for (const r of faux.rpcEnAttente.splice(0)) r() })
  })

  it('« Entrée » dans la fenêtre ne soumet pas la facture : la fenêtre est hors du formulaire', async () => {
    await clientALaMain()
    const fenetre = await ouvrirLaSaisie()
    expect(document.querySelector('form')?.contains(fenetre)).toBe(false)
    expect(facturesEnregistrees()).toHaveLength(0)
  })

  it('les libellés de la fenêtre disent qui les lit, aux mots de l’espace', async () => {
    await clientALaMain()
    const fenetre = await ouvrirLaSaisie()
    expect(within(fenetre).getByLabelText(NOM_LIBELLE)).toBeTruthy()
    if (espace === 'client') expect(motsDuCabinet(fenetre.textContent ?? '')).toEqual([])
  })
})

describe.each(['cabinet', 'client'] as const)('Un client dans la facture — la facture et l’écriture du client se tiennent à l’écart (%s)', (espace) => {
  async function pret() {
    await monter(espace)
    await chargerLesContacts()
    fireEvent.change(document.querySelector('tbody input')!, { target: { value: 'Séance' } })
    fireEvent.change(document.querySelectorAll('tbody input')[2], { target: { value: '100' } })
    saisirChamp('#tiers-nom', 'Nouvelle société')
    saisirChamp('#type-client', 'assujetti')
    saisirChamp('#tiers-siren', '987654324')
    saisirChamp('#tiers-siret', '98765432400019')
    saisirChamp('#tiers-adresse', '8 rue des Nouveautés')
    fireEvent.click(bouton('Enregistrer ce client'))
    return screen.findByRole('dialog', { name: 'Nouveau client' })
  }

  it('pendant l’écriture du client, la facture ne s’enregistre pas (même par la soumission du formulaire) ; elle le peut ensuite', async () => {
    const fenetre = await pret()
    faux.retenirRpc = true
    await act(async () => { fireEvent.click(within(fenetre).getByRole('button', { name: 'Enregistrer' })) })
    expect(ecritures()).toHaveLength(1)
    await soumettre()
    expect(facturesEnregistrees()).toHaveLength(0)
    await act(async () => { faux.retenirRpc = false; for (const r of faux.rpcEnAttente.splice(0)) r() })
    await soumettre()
    expect(facturesEnregistrees()).toHaveLength(1)
  })

  it('le verrou ne tombe qu’APRÈS la relecture des contacts : la facture ne s’enregistre pas pendant qu’elle court', async () => {
    const fenetre = await pret()
    faux.retenirLecture = true
    await act(async () => { fireEvent.click(within(fenetre).getByRole('button', { name: 'Enregistrer' })) })
    expect(ecritures()).toHaveLength(1)
    expect(faux.lecturesEnAttente).toHaveLength(1)
    await soumettre()
    expect(facturesEnregistrees()).toHaveLength(0)
    await act(async () => { faux.retenirLecture = false; for (const r of faux.lecturesEnAttente.splice(0)) r() })
    await soumettre()
    expect(facturesEnregistrees()).toHaveLength(1)
  })

  it('pendant l’enregistrement de la facture, l’écriture du client ne part pas : même une fenêtre déjà ouverte', async () => {
    const fenetre = await pret()
    faux.retenirFacture = true
    await soumettre()
    expect(facturesEnregistrees()).toHaveLength(1)
    await act(async () => { fireEvent.click(within(fenetre).getByRole('button', { name: 'Enregistrer' })) })
    expect(ecritures()).toHaveLength(0)
    await act(async () => { faux.retenirFacture = false; for (const r of faux.factureEnAttente.splice(0)) r() })
  })

  it('un geste d’article ne part pas pendant l’écriture du client, ni l’inverse : les deux verrous s’excluent', async () => {
    await monter(espace)
    await chargerLesContacts()
    fireEvent.change(document.querySelector('tbody input')!, { target: { value: 'Séance à la main' } })
    fireEvent.change(document.querySelectorAll('tbody input')[2], { target: { value: '12.5' } })
    saisirChamp('#tiers-nom', 'Nouvelle société')
    saisirChamp('#type-client', 'assujetti')
    saisirChamp('#tiers-siren', '987654324')
    saisirChamp('#tiers-adresse', '8 rue des Nouveautés')
    // La saisie de l'article est ouverte d'abord, et tenue.
    await screen.findByRole('button', { name: 'Enregistrer comme article, ligne 1' })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer comme article, ligne 1' }))
    const saisieArticle = await screen.findByRole('dialog', { name: 'Nouvel article' })
    fireEvent.change(within(saisieArticle).getByLabelText('Nature'), { target: { value: 'services' } })
    fireEvent.change(within(saisieArticle).getByLabelText('Taux de TVA'), { target: { value: '20' } })
    // L'écriture du client part, et reste en vol : l'écriture de l'article, elle, ne part pas.
    fireEvent.click(bouton('Enregistrer ce client'))
    const saisieContact = await screen.findByRole('dialog', { name: 'Nouveau client' })
    faux.retenirRpc = true
    await act(async () => { fireEvent.click(within(saisieContact).getByRole('button', { name: 'Enregistrer' })) })
    expect(ecritures()).toHaveLength(1)
    await act(async () => { fireEvent.click(within(saisieArticle).getByRole('button', { name: 'Enregistrer' })) })
    expect(faux.rpcs.filter((r) => r.nom === 'enregistrer_article')).toHaveLength(0)
    await act(async () => { faux.retenirRpc = false; for (const r of faux.rpcEnAttente.splice(0)) r() })
    // Le verrou relâché, l'écriture de l'article part.
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Nouvel article' })).getByRole('button', { name: 'Enregistrer' })) })
    expect(faux.rpcs.filter((r) => r.nom === 'enregistrer_article')).toHaveLength(1)
  })

  it('pendant l’écriture d’un article, l’écriture du client ne part pas : même une fenêtre déjà ouverte', async () => {
    await monter(espace)
    await chargerLesContacts()
    fireEvent.change(document.querySelector('tbody input')!, { target: { value: 'Séance à la main' } })
    fireEvent.change(document.querySelectorAll('tbody input')[2], { target: { value: '12.5' } })
    saisirChamp('#tiers-nom', 'Nouvelle société')
    saisirChamp('#type-client', 'assujetti')
    saisirChamp('#tiers-siren', '987654324')
    saisirChamp('#tiers-adresse', '8 rue des Nouveautés')
    // Les deux fenêtres sont ouvertes avant qu'aucune écriture ne parte : l'article d'abord, puis le client.
    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer comme article, ligne 1' }))
    const saisieArticle = await screen.findByRole('dialog', { name: 'Nouvel article' })
    fireEvent.change(within(saisieArticle).getByLabelText('Nature'), { target: { value: 'services' } })
    fireEvent.change(within(saisieArticle).getByLabelText('Taux de TVA'), { target: { value: '20' } })
    fireEvent.click(bouton('Enregistrer ce client'))
    const saisieContact = await screen.findByRole('dialog', { name: 'Nouveau client' })
    // L'écriture de l'article part et reste en vol : celle du client, qui ne le voit pas grisée dans sa fenêtre, ne part pas.
    faux.retenirRpc = true
    await act(async () => { fireEvent.click(within(saisieArticle).getByRole('button', { name: 'Enregistrer' })) })
    expect(faux.rpcs.filter((r) => r.nom === 'enregistrer_article')).toHaveLength(1)
    await act(async () => { fireEvent.click(within(saisieContact).getByRole('button', { name: 'Enregistrer' })) })
    expect(ecritures()).toHaveLength(0)
    await act(async () => { faux.retenirRpc = false; for (const r of faux.rpcEnAttente.splice(0)) r() })
    // Le verrou de l'article relâché, l'écriture du client part.
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Nouveau client' })).getByRole('button', { name: 'Enregistrer' })) })
    expect(ecritures()).toHaveLength(1)
  })

  it('pendant un geste d’article, « Choisir un client » et « Enregistrer ce client » sont grisés', async () => {
    await monter(espace)
    await chargerLesContacts()
    fireEvent.change(document.querySelector('tbody input')!, { target: { value: 'Séance à la main' } })
    fireEvent.change(document.querySelectorAll('tbody input')[2], { target: { value: '12.5' } })
    saisirChamp('#tiers-nom', 'Nouvelle société')
    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer comme article, ligne 1' }))
    const saisieArticle = await screen.findByRole('dialog', { name: 'Nouvel article' })
    fireEvent.change(within(saisieArticle).getByLabelText('Nature'), { target: { value: 'services' } })
    fireEvent.change(within(saisieArticle).getByLabelText('Taux de TVA'), { target: { value: '20' } })
    faux.retenirRpc = true
    await act(async () => { fireEvent.click(within(saisieArticle).getByRole('button', { name: 'Enregistrer' })) })
    expect(bouton('Choisir un client').disabled).toBe(true)
    expect(bouton('Enregistrer ce client').disabled).toBe(true)
    await act(async () => { faux.retenirRpc = false; for (const r of faux.rpcEnAttente.splice(0)) r() })
  })
})

describe('Un client dans la facture — les mots du client', () => {
  // Les textes que le client lit, état par état : les mêmes, montés pour le cabinet, portent au moins un mot du cabinet quand ils en
  // disent un — le garde n'est pas aveugle (FacturesTabClient.test.tsx).
  async function textesDuClient(): Promise<string[]> {
    const textes: string[] = []
    await monter('client', { statut: 'exonere', exo: 'cgi_261_4_1' })
    await chargerLesContacts()
    saisirChamp('#tiers-nom', 'Particulier à la main')
    saisirChamp('#type-client', 'non_assujetti')
    textes.push(screen.getByRole('note').textContent ?? '', bouton('Enregistrer ce client').title)
    saisirChamp('#tiers-siren', '123456782')
    const choix = await ouvrirLeChoix()
    textes.push(choix.textContent ?? '')
    fireEvent.click(within(choix).getByRole('button', { name: /^Aubert SAS/ }))
    const confirmation = await screen.findByRole('alertdialog')
    textes.push(confirmation.textContent ?? '')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Remplacer' }))
    saisirChamp('#date-emission', '2027-11-10')
    textes.push(screen.getByRole('button', { name: 'Recalculer l’échéance' }).closest('p')?.textContent ?? '')
    cleanup()
    faux.contacts = []
    await monter('client')
    await screen.findByText(/Tu n’as encore aucun client en cours/)
    saisirChamp('#tiers-nom', 'Nouvelle société')
    saisirChamp('#type-client', 'assujetti')
    saisirChamp('#tiers-siren', '987654324')
    fireEvent.click(bouton('Enregistrer ce client'))
    textes.push((await screen.findByRole('dialog', { name: 'Nouveau client' })).textContent ?? '', document.body.textContent ?? '')
    return textes
  }

  it('dans l’espace du client : aucun renvoi à un onglet, aucun « le client qui porte », aucun vouvoiement', async () => {
    const textes = await textesDuClient()
    expect(textes.length).toBeGreaterThanOrEqual(7)
    // Le dernier est le texte entier de la page : le formulaire dit aussi d'AUTRES choses, gardées par FacturesTabClient.test.tsx.
    for (const t of textes.slice(0, -1)) expect(motsDuCabinet(t), t).toEqual([])
    expect(textes[textes.length - 1]).toContain('Tu n’as encore aucun client en cours')
  })

  it('le garde n’est pas aveugle : ces mêmes fenêtres, au cabinet, parlent d’un onglet ou du client qui porte la case', async () => {
    await monter('cabinet', { statut: 'exonere', exo: 'cgi_261_4_1' })
    await chargerLesContacts()
    const choix = await ouvrirLeChoix()
    expect(motsDuCabinet(choix.textContent ?? '').length).toBeGreaterThan(0)
    fireEvent.click(within(choix).getByRole('button', { name: 'Annuler' }))
    saisirChamp('#tiers-nom', 'Nouvelle société')
    fireEvent.click(bouton('Enregistrer ce client'))
    const saisie = await screen.findByRole('dialog', { name: 'Nouveau client' })
    // La saisie dit, au cabinet, que le client « Ventes » la lit : une phrase du cabinet que le garde reconnaît.
    expect(motsDuCabinet(saisie.textContent ?? '').length).toBeGreaterThan(0)
  })
})

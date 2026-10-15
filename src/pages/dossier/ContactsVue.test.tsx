import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ContactsVue from './ContactsVue'
import { ficheDuContactCsv, phraseDeLExportDeLaFiche } from '../../lib/contactsExport'
import { motsDuCabinet } from '../../lib/espaceVentes'
import {
  LIBELLE_ADRESSE_CONTACT, LIBELLE_ADRESSE_CONTACT_CLIENT, LIBELLE_NOM_CONTACT, LIBELLE_NOM_CONTACT_CLIENT,
  LIBELLE_OBSERVATIONS_CONTACT, LIBELLE_OBSERVATIONS_CONTACT_CLIENT,
} from '../../lib/droitsAcces'
import type { AccesDuDossier } from '../../lib/auteursVentes'
import { contact } from '../../test/contacts'
import type { ArticleExoneration, Contact } from '../../lib/types'

// « CLIENTS » (espace client, étape A4b1) : la vue montée pour le cabinet et pour le client « Ventes », sous un faux client qui
// APPLIQUE les filtres (src/test/filtresPostgrest.ts) et dont les quatre fonctions de la base écrivent la table d'essai.
// Ce que ces cas gardent, et qu'aucun calcul pur ne voit :
//  1. avant la lecture, ni « aucun », ni tableau, ni geste ; lue vide en entier, elle le dit ; lue en partie ou refusée, le
//     bandeau (ou le message) et AUCUN geste ;
//  2. la liste dans les deux espaces — JAMAIS un effacé, les retirés derrière leur filtre, « par le client » au cabinet seul, la
//     recherche sur le nom, le SIREN et le SIRET, « N sur M » ;
//  3. chaque geste : ce que la base reçoit, son refus dit AVANT le clic sous les mots du module, le refus de la base dit sous
//     ses mots, la liste relue après une écriture réussie comme après un refus ;
//  4. UN verrou pour les quatre gestes : plusieurs clics du même rendu, une seule écriture ; relâché après la relecture ;
//  5. la fenêtre : les champs que le type n'ouvre pas ne s'affichent pas, aucune validation native, les libellés des textes
//     libres que le client lit (cabinet) et ceux de son espace (client : tutoiement, aucun mot du cabinet) ;
//  6. l'effacement : une confirmation qui NOMME le contact et ce qui part, jamais d'office ;
//  7. un dossier de soins : la ligne d'information, le signalement de chaque contact rangé avant (A4-Q4), « Effacer » offert ;
//  8. « Exporter la fiche » (A4b3c) : le geste sur chaque client affiché des deux espaces (jamais un effacé), absent sans liste lue
//     en entier, grisé pendant une écriture, le téléchargement (nom et contenu), aucune écriture ni relecture, une seule phrase.
// Données FICTIVES.

const faux = vi.hoisted(() => ({
  contacts: [] as Record<string, unknown>[],
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
  telecharges: [] as { nom: string; contenu: string }[],
}))

// Le téléchargement est simulé (jsdom n'a pas d'URL d'objet) : ce que la vue donne à `telechargerTexte` se lit dans `faux.telecharges`.
vi.mock('../../lib/fec', async (original) => ({
  ...(await original<typeof import('../../lib/fec')>()),
  telechargerTexte: (nom: string, contenu: string) => { faux.telecharges.push({ nom, contenu }) },
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
        const id = params.p_contact_id as string | null
        const existant = faux.contacts.find((c) => c.id === id)
        if (nom === 'enregistrer_contact') {
          const ecrit = existant
            ? { ...existant, ...(params.p_contact as object), modifie_par: 'u-moi', modifie_le: instant }
            : { id: `neuf-${faux.contacts.length + 1}`, dossier_id: params.p_dossier_id, genre: 'client', retire_le: null, retire_par: null, efface_le: null,
              efface_par: null, cree_par: 'u-moi', cree_le: instant, modifie_par: null, modifie_le: null, ...(params.p_contact as object) }
          faux.contacts = existant ? faux.contacts.map((c) => (c.id === id ? ecrit : c)) : [...faux.contacts, ecrit]
          return { data: ecrit, error: null }
        }
        if (!existant) return { data: null, error: { message: 'Contact introuvable dans ce dossier.' } }
        const ecrit = nom === 'retirer_contact'
          ? { ...existant, retire_le: instant, retire_par: 'u-moi' }
          : nom === 'effacer_contact'
            ? {
              ...existant, nom: 'Contact effacé le 20/11/2027', type_client: null, adresse: null, siren: null, siret: null, adresse_electronique: null,
              code_service: null, email: null, delai_paiement_jours: null, observations: null, retire_le: null, retire_par: null,
              efface_le: instant, efface_par: 'u-moi',
            }
            : { ...existant, retire_le: null, retire_par: null, modifie_par: 'u-moi', modifie_le: instant }
        faux.contacts = faux.contacts.map((c) => (c.id === id ? ecrit : c))
        return { data: ecrit, error: null }
      },
      from: (table: string) => {
        if (table !== 'contacts') throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: Predicat[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        let ecriture: string | null = null
        const partir = () => {
          if (ecriture) { faux.ecritures.push(`${table} ${ecriture}`); return { data: null, error: null } }
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
// Les identifiants sont ceux des jeux d'essai du dépôt (`src/test/contacts.ts`, `src/test/facturesCii.ts`) : 123456782 et son
// établissement 12345678200010, 987654324, 100000207 et son établissement 10000020700017. Aucune donnée réelle.
const nues = (lignes: readonly Contact[]): Record<string, unknown>[] => lignes.map((l) => ({ ...l }))

const SOINS: ArticleExoneration = 'cgi_261_4_1'

// Quatre contacts en cours, deux retirés, un effacé. C2 et C3 sont du client (le dernier geste est le sien) ; C3 a été modifié ensuite
// par le cabinet ; C6 a été retiré par le client, C7 par le cabinet.
const C1 = contact({ id: 'c1', nom: 'Société Essai', email: 'contact@societe-essai-fictive.example', delai_paiement_jours: 30 })
const C2 = contact({
  id: 'c2', nom: 'Commune de Démoville', type_client: 'organisme_public', adresse: 'Hôtel de ville, place de la Mairie', siren: '100000207',
  siret: '10000020700017', adresse_electronique: '100000207', code_service: 'SERVICE-ACHATS', email: null, delai_paiement_jours: 45,
  observations: 'Engagement juridique obligatoire', cree_par: 'u-client',
})
const C3 = contact({
  id: 'c3', nom: 'Association Fictive', type_client: 'non_assujetti', adresse: 'Rue des Essais', siren: '987654324', siret: null, delai_paiement_jours: null,
  cree_par: 'u-client', modifie_par: 'u-cabinet', modifie_le: '2027-10-02T09:00:00Z',
})
const C4 = contact({
  id: 'c4', nom: 'Particulier Fictif', type_client: 'non_assujetti', adresse: 'Impasse fictive', siren: null, siret: null, delai_paiement_jours: 0,
})
const C5 = contact({ id: 'c5', nom: 'Ancien Client', siren: null, siret: null, retire_le: '2027-10-05T08:00:00Z', retire_par: 'u-client' })
const C6 = contact({
  id: 'c6', nom: 'Autre ancien client', siren: null, siret: null, cree_par: 'u-client', retire_le: '2027-10-06T08:00:00Z', retire_par: 'u-cabinet',
})
const C7 = contact({
  id: 'c7', nom: 'Contact effacé le 06/10/2027', type_client: null, adresse: null, siren: null, siret: null, delai_paiement_jours: null,
  efface_le: '2027-10-06T08:00:00Z', efface_par: 'u-client',
})
const AUTRE_DOSSIER = contact({ id: 'x9', dossier_id: 'd2', nom: 'Client d’un autre dossier', siren: null, siret: null })
// Rangés avant le passage aux soins : un client établi hors de France.
const C8 = contact({ id: 'c8', nom: 'Client étranger fictif', type_client: 'etranger', adresse: 'Rue étrangère fictive', siren: null, siret: null })

const ACCES_LUS: AccesDuDossier = { etat: 'lus', comptes: ['u-client'] }

const lisible = (t: string | null) => (t ?? '').replace(/[  ]/g, ' ')

type Reglages = { acces?: AccesDuDossier; article?: ArticleExoneration | null }
const arbre = (espace: 'cabinet' | 'client', { acces = ACCES_LUS, article = null }: Reglages = {}, dossierId = 'd1') => (espace === 'client'
  ? <ContactsVue espace="client" dossierId={dossierId} articleExoneration={article} />
  : <ContactsVue espace="cabinet" acces={acces} dossierId={dossierId} articleExoneration={article} />)

async function monter(espace: 'cabinet' | 'client', reglages: Reglages = {}) {
  render(arbre(espace, reglages))
  await screen.findByRole('table', { name: 'Clients' })
}

const tableau = () => screen.findByRole('table', { name: 'Clients' })
const lignes = async () => within(await tableau()).getAllByRole('row').slice(1)
const ligneDe = async (texte: string) => (await lignes()).find((r) => r.textContent?.includes(texte)) as HTMLElement
const bouton = (nom: string | RegExp) => screen.getByRole('button', { name: nom }) as HTMLButtonElement
const rechercher = (valeur: string) =>
  fireEvent.change(screen.getByPlaceholderText('Rechercher un nom, un SIREN, un SIRET…'), { target: { value: valeur } })
const champ = (libelle: string | RegExp) => screen.getByLabelText(libelle) as HTMLInputElement
const saisir = (libelle: string | RegExp, valeur: string) => fireEvent.change(champ(libelle), { target: { value: valeur } })
const fenetre = () => screen.getByRole('dialog')

function remplirUnContactNeuf(espace: 'cabinet' | 'client' = 'cabinet') {
  saisir(espace === 'client' ? LIBELLE_NOM_CONTACT_CLIENT : LIBELLE_NOM_CONTACT, 'Client neuf')
  saisir('Type', 'assujetti')
  saisir(espace === 'client' ? LIBELLE_ADRESSE_CONTACT_CLIENT : LIBELLE_ADRESSE_CONTACT, '1 rue du Neuf')
  saisir('SIREN', '123 456 782')
  saisir('E-mail', 'neuf@exemple.fr')
  saisir('Délai de paiement (jours, de 0 à 60)', '30')
}

beforeEach(() => {
  faux.contacts = nues([C1, C2, C3, C4, C5, C6, C7, AUTRE_DOSSIER])
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
  faux.telecharges = []
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Clients — avant et après la lecture', () => {
  it('avant sa lecture : « Chargement… », ni « aucun », ni tableau, ni geste ; revenue, les lignes', async () => {
    faux.retenirLecture = true
    render(arbre('cabinet', { article: SOINS }))
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByText(/aucun/i)).toBeNull()
    expect(screen.queryByRole('table', { name: 'Clients' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Nouveau client/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Modifier' })).toBeNull()
    // Même la ligne d'information d'un dossier de soins attend : elle ne dit rien d'une liste qu'on n'a pas lue.
    expect(screen.queryByText(/soins exonérés/)).toBeNull()
    await act(async () => { faux.retenirLecture = false; for (const r of faux.lecturesEnAttente.splice(0)) r() })
    expect(await lignes()).toHaveLength(4)
    expect(screen.queryByText('Chargement…')).toBeNull()
  })

  it('un fichier vide, lu en entier : il le dit, sans tableau, et le geste de création est offert', async () => {
    faux.contacts = nues([AUTRE_DOSSIER])
    render(arbre('cabinet'))
    expect(await screen.findByText('Aucun client n’est enregistré pour ce dossier.')).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Clients' })).toBeNull()
    expect(bouton(/Nouveau client/).disabled).toBe(false)
  })

  it('au client : le vide se dit à lui, en tutoyant', async () => {
    faux.contacts = []
    render(arbre('client'))
    expect(await screen.findByText('Tu n’as encore aucun client.')).toBeTruthy()
  })

  it('que des retirés, derrière leur filtre : ce n’est pas « aucun client », et le filtre les montre', async () => {
    faux.contacts = nues([C5, C6])
    render(arbre('cabinet'))
    expect(await screen.findByText(/^Aucun client n’est en cours/)).toBeTruthy()
    expect(screen.queryByText(/n’est enregistré/)).toBeNull()
    fireEvent.click(screen.getByLabelText('Retirés'))
    expect(await lignes()).toHaveLength(2)
  })

  it('que des effacés : aucun ne se montre, même sous « Retirés » — « aucun client », jamais « n’est en cours »', async () => {
    faux.contacts = nues([C7])
    render(arbre('cabinet'))
    expect(await screen.findByText('Aucun client n’est enregistré pour ce dossier.')).toBeTruthy()
    expect(screen.queryByText(/n’est en cours/)).toBeNull()
    fireEvent.click(screen.getByLabelText('Retirés'))
    expect(screen.queryByRole('table', { name: 'Clients' })).toBeNull()
    expect(screen.queryByText(/Contact effacé/)).toBeNull()
  })

  it('lue en partie : le bandeau et son motif, la liste lue, AUCUN geste, jamais « aucun client »', async () => {
    faux.muetApres = 2
    render(arbre('cabinet'))
    expect(await screen.findByText(/^Les clients du dossier n'ont pas pu être lus en entier \(2 ligne\(s\) lue\(s\) sur 7 annoncée\(s\)\)/)).toBeTruthy()
    expect(screen.getByText(/Aucun geste n’est donc offert/)).toBeTruthy()
    for (const nom of [/Nouveau client/, 'Modifier', 'Retirer', 'Reprendre', 'Effacer']) {
      expect(screen.queryByRole('button', { name: nom }), String(nom)).toBeNull()
    }
    expect(screen.queryByText(/^Aucun client/)).toBeNull()
  })

  it('lue en partie sans une ligne : il le dit, sans affirmer le vide', async () => {
    faux.muetApres = 0
    render(arbre('cabinet'))
    expect(await screen.findByText('La liste des clients n’a pas pu être lue en entier.')).toBeTruthy()
    expect(screen.queryByText(/n’est enregistré/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Nouveau client/ })).toBeNull()
  })

  it('au client, lue en partie : le motif reste en infobulle, les mots sont les siens', async () => {
    faux.muetApres = 0
    render(arbre('client'))
    const bandeau = await screen.findByText(/^Tes clients n'ont pas pu être affichés en entier\./)
    expect(bandeau.getAttribute('title')).toMatch(/lue\(s\) sur/)
    expect(bandeau.textContent).not.toMatch(/ligne\(s\)/)
    expect(screen.queryByRole('button', { name: /Nouveau client/ })).toBeNull()
  })

  it('au client, une lecture qui lève : le message est le sien', async () => {
    faux.leve = true
    render(arbre('client'))
    expect(await screen.findByText(/^Tes clients ne s’affichent pas : réseau coupé\./)).toBeTruthy()
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
  })

  it('une lecture qui lève : le message, rien d’autre — ni liste, ni geste, ni « aucun »', async () => {
    faux.leve = true
    render(arbre('cabinet'))
    expect(await screen.findByText(/^Les clients ne s’affichent pas : réseau coupé\./)).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Clients' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Nouveau client/ })).toBeNull()
    expect(screen.queryByText(/^Aucun client/)).toBeNull()
  })
})

describe('Clients — la liste', () => {
  it('au cabinet : les clients du dossier en cours, sans ceux d’un autre dossier, sans les retirés ni l’effacé', async () => {
    await monter('cabinet')
    const rows = await lignes()
    expect(rows).toHaveLength(4)
    expect(rows.map((r) => r.textContent).join('|')).not.toMatch(/autre dossier|Ancien Client|effacé/i)
    // Nom à la française : Association, Commune, Particulier, Société.
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent?.replace(/par le client$/, ''))).toEqual([
      'Association Fictive', 'Commune de Démoville', 'Particulier Fictif', 'Société Essai',
    ])
    const societe = await ligneDe('Société Essai')
    expect(within(societe).getByText('une entreprise établie en France')).toBeTruthy()
    expect(within(societe).getByText('12345678200010').getAttribute('title')).toBe('SIRET')
    expect(within(societe).getByText('contact@societe-essai-fictive.example')).toBeTruthy()
    expect(lisible(societe.textContent)).toContain('30 jours')
  })

  it('un organisme public, une association sans SIRET, un particulier sans identifiant : chacun sous ses mots', async () => {
    await monter('cabinet')
    const commune = await ligneDe('Commune de Démoville')
    expect(within(commune).getByText('un organisme public (Chorus Pro)')).toBeTruthy()
    expect(within(commune).getByText('10000020700017').getAttribute('title')).toBe('SIRET')
    expect(lisible(commune.textContent)).toContain('45 jours')
    const association = await ligneDe('Association Fictive')
    expect(within(association).getByText('un particulier, ou un autre non-assujetti')).toBeTruthy()
    expect(within(association).getByText('987654324').getAttribute('title')).toBe('SIREN')
    // Un délai absent et un e-mail absent ne disent rien : « — ».
    expect(within(association).getAllByText('—').length).toBeGreaterThanOrEqual(2)
    const particulier = await ligneDe('Particulier Fictif')
    expect(lisible(particulier.textContent)).toContain('0 jour')
    expect(lisible(particulier.textContent)).not.toContain('0 jours')
  })

  it('l’adresse et les observations ne se montrent pas dans la liste : elles sont dans « Modifier »', async () => {
    await monter('cabinet')
    expect(screen.queryByText(/place de la Mairie/)).toBeNull()
    expect(screen.queryByText(/Engagement juridique/)).toBeNull()
  })

  it('le filtre « Retirés » : sans lui, ils ne se montrent pas ; avec lui, ils suivent, dits retirés, avec « Reprendre » ; jamais l’effacé', async () => {
    await monter('cabinet')
    expect(await lignes()).toHaveLength(4)
    fireEvent.click(screen.getByLabelText('Retirés'))
    const rows = await lignes()
    expect(rows).toHaveLength(6)
    const ancien = await ligneDe('Ancien Client')
    expect(within(ancien).getByText('Retiré le 05/10/2027')).toBeTruthy()
    expect(within(ancien).getByRole('button', { name: 'Reprendre' })).toBeTruthy()
    expect(within(ancien).queryByRole('button', { name: 'Retirer' })).toBeNull()
    // Les retirés viennent après les clients en cours, et l'effacé n'est nulle part.
    expect(rows.slice(0, 4).map((r) => r.textContent).join('|')).not.toMatch(/Retiré le/)
    expect(screen.queryByText(/Contact effacé/)).toBeNull()
    fireEvent.click(screen.getByLabelText('Retirés'))
    expect(await lignes()).toHaveLength(4)
  })

  it('une recherche lit le nom, le SIREN et le SIRET, pas l’e-mail ni l’adresse ; « N sur M » compte avant la recherche', async () => {
    await monter('cabinet')
    expect(screen.queryByText(/ sur 4$/)).toBeNull()
    rechercher('essai')
    expect(await lignes()).toHaveLength(1)
    expect(screen.getByText('1 sur 4')).toBeTruthy()
    rechercher('987654324')
    expect(await lignes()).toHaveLength(1)
    rechercher('10000020700017')
    expect(await lignes()).toHaveLength(1)
    // L'e-mail et l'adresse ne sont pas des champs de la recherche.
    rechercher('societe-essai-fictive')
    expect(screen.getByText('aucun résultat')).toBeTruthy()
    expect(screen.getByText('Aucun client ne correspond à « societe-essai-fictive ».')).toBeTruthy()
    rechercher('place de la mairie')
    expect(screen.getByText('aucun résultat')).toBeTruthy()
    // Accents et casse ignorés, comme partout.
    rechercher('DEMOVILLE')
    expect(await lignes()).toHaveLength(1)
    rechercher('')
    expect(await lignes()).toHaveLength(4)
  })

  it('une recherche ne trouve jamais un effacé, même par ce qu’il en reste', async () => {
    await monter('cabinet')
    fireEvent.click(screen.getByLabelText('Retirés'))
    rechercher('effacé')
    expect(screen.getByText('Aucun client ne correspond à « effacé ».')).toBeTruthy()
  })

  it('le « N sur M » compte les retirés quand le filtre les montre', async () => {
    await monter('cabinet')
    fireEvent.click(screen.getByLabelText('Retirés'))
    rechercher('ancien')
    expect(await lignes()).toHaveLength(2)
    expect(screen.getByText('2 sur 6')).toBeTruthy()
  })

  it('« par le client » (cabinet) : le dernier geste d’un accès client lu en entier — créé, retiré —, jamais « par le cabinet »', async () => {
    await monter('cabinet')
    fireEvent.click(screen.getByLabelText('Retirés'))
    expect(within(await ligneDe('Commune de Démoville')).getByText('par le client').getAttribute('title')).toBe('Contact créé par le client')
    expect(within(await ligneDe('Ancien Client')).getByText('par le client').getAttribute('title')).toBe('Contact retiré par le client')
    // Créé par le client puis modifié par le cabinet : le dernier geste est celui du cabinet.
    expect(within(await ligneDe('Association Fictive')).queryByText('par le client')).toBeNull()
    // Créé par le cabinet : rien. Retiré par le cabinet (le client l'avait créé) : rien.
    expect(within(await ligneDe('Société Essai')).queryByText('par le client')).toBeNull()
    expect(within(await ligneDe('Autre ancien client')).queryByText('par le client')).toBeNull()
    expect(screen.queryByText(/par le cabinet/i)).toBeNull()
  })

  it.each([
    [{ etat: 'en_cours' } as AccesDuDossier],
    [{ etat: 'incomplets', motif: 'lecture interrompue' } as AccesDuDossier],
  ])('accès %j : rien n’est dit « par le client » — on ne devine personne', async (acces) => {
    await monter('cabinet', { acces })
    fireEvent.click(screen.getByLabelText('Retirés'))
    await lignes()
    expect(screen.queryByText('par le client')).toBeNull()
  })

  it('un accès retiré depuis n’est pas deviné', async () => {
    await monter('cabinet', { acces: { etat: 'lus', comptes: ['u-autre'] } })
    await lignes()
    expect(screen.queryByText('par le client')).toBeNull()
  })

  it('au client : jamais « par le client », et aucun accès lu', async () => {
    await monter('client')
    fireEvent.click(screen.getByLabelText('Retirés'))
    await lignes()
    expect(screen.queryByText('par le client')).toBeNull()
  })

  it('le client ne lit aucun mot du cabinet dans la liste ; le cabinet dit que le client « Ventes » la lit', async () => {
    await monter('client')
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
    expect(document.body.textContent).toContain('Ton cabinet le lit aussi')
    cleanupVue()
    await monter('cabinet')
    expect(document.body.textContent).toContain('Le client qui porte la case « Ventes » le lit en entier')
  })
})

function cleanupVue() {
  document.body.innerHTML = ''
}

describe('Clients — « Nouveau client »', () => {
  it('une saisie neuve : aucun type choisi, le premier refus du module, discret, le bouton grisé', async () => {
    await monter('cabinet')
    fireEvent.click(bouton(/Nouveau client/))
    expect(screen.getByRole('heading', { name: 'Nouveau client' })).toBeTruthy()
    expect((champ('Type') as unknown as HTMLSelectElement).value).toBe('')
    expect(within(fenetre()).getByRole('option', { name: 'À préciser' })).toBeTruthy()
    const refus = screen.getByText('Le nom du contact est à renseigner.')
    expect(refus.className).toBe('muted')
    expect(bouton('Enregistrer').disabled).toBe(true)
    expect(bouton('Enregistrer').title).toBe('Le nom du contact est à renseigner.')
    // Dès que la saisie a bougé, le refus est d'alerte.
    saisir('SIREN', '1')
    expect(screen.getByText('Le nom du contact est à renseigner.').className).toBe('error-text')
    expect(faux.rpcs).toEqual([])
  })

  it('les quatre types, aux mots du formulaire de la facture', async () => {
    await monter('cabinet')
    fireEvent.click(bouton(/Nouveau client/))
    const options = within(fenetre()).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual([
      'À préciser', 'une entreprise établie en France', 'un organisme public (Chorus Pro)', 'un particulier, ou un autre non-assujetti',
      'établi hors de France',
    ])
  })

  it('un champ que le type n’ouvre pas ne s’affiche pas : SIREN et SIRET hors de France, adresse électronique, code service', async () => {
    await monter('cabinet')
    fireEvent.click(bouton(/Nouveau client/))
    const ouverts = () => ['SIREN', 'SIRET', 'Adresse de facturation électronique', 'Code service']
      .filter((l) => screen.queryByLabelText(l) != null)
    // Sans type : SIREN et SIRET (rien n'est fermé), ni adresse électronique ni code service.
    expect(ouverts()).toEqual(['SIREN', 'SIRET'])
    saisir('Type', 'assujetti')
    expect(ouverts()).toEqual(['SIREN', 'SIRET', 'Adresse de facturation électronique'])
    saisir('Type', 'organisme_public')
    expect(ouverts()).toEqual(['SIREN', 'SIRET', 'Adresse de facturation électronique', 'Code service'])
    saisir('Type', 'non_assujetti')
    expect(ouverts()).toEqual(['SIREN', 'SIRET'])
    saisir('Type', 'etranger')
    expect(ouverts()).toEqual([])
    // L'e-mail, le délai et les observations sont de tous les types.
    for (const libelle of ['E-mail', 'Délai de paiement (jours, de 0 à 60)', LIBELLE_OBSERVATIONS_CONTACT]) expect(champ(libelle)).toBeTruthy()
  })

  it('un champ devenu sans objet part à nul : le SIREN tapé puis le type « établi hors de France » — rien ne part', async () => {
    await monter('cabinet')
    fireEvent.click(bouton(/Nouveau client/))
    saisir(LIBELLE_NOM_CONTACT, 'Client lointain')
    saisir(LIBELLE_ADRESSE_CONTACT, 'Loin')
    saisir('Type', 'assujetti')
    saisir('SIREN', '123456782')
    saisir('Type', 'etranger')
    expect(bouton('Enregistrer').disabled).toBe(false)
    fireEvent.click(bouton('Enregistrer'))
    await screen.findByText('Client « Client lointain » enregistré.')
    const { p_contact: envoye } = faux.rpcs[0].params as { p_contact: Record<string, unknown> }
    expect(envoye).toMatchObject({ type_client: 'etranger', siren: null, siret: null, adresse_electronique: null, code_service: null })
  })

  it('aucune validation native du navigateur : pas de formulaire, ni `required`, ni `pattern`, ni type courriel ou nombre', async () => {
    await monter('cabinet')
    fireEvent.click(bouton(/Nouveau client/))
    saisir('Type', 'organisme_public')
    expect(document.querySelector('form')).toBeNull()
    for (const el of fenetre().querySelectorAll('input, select, textarea')) {
      expect((el as HTMLInputElement).required, el.id).toBe(false)
      expect(el.hasAttribute('pattern'), el.id).toBe(false)
      expect(['email', 'number', 'tel', 'url']).not.toContain((el as HTMLInputElement).type)
    }
    for (const b of fenetre().querySelectorAll('button')) expect(b.getAttribute('type')).toBe('button')
  })

  it('les refus du module se disent avant le clic, dans l’ordre : nom, adresse, type, identifiants, e-mail, délai', async () => {
    await monter('cabinet')
    fireEvent.click(bouton(/Nouveau client/))
    saisir(LIBELLE_NOM_CONTACT, 'Client neuf')
    expect(screen.getByText("L'adresse du contact est à renseigner.")).toBeTruthy()
    saisir(LIBELLE_ADRESSE_CONTACT, '1 rue du Neuf')
    expect(screen.getByText(/^Le type du contact est l'un des quatre de la facture/)).toBeTruthy()
    saisir('Type', 'assujetti')
    expect(bouton('Enregistrer').disabled).toBe(false)
    saisir('SIREN', '123456783')
    expect(screen.getByText('Le SIREN du contact ne passe pas sa clé de contrôle.')).toBeTruthy()
    saisir('SIREN', '123456782')
    saisir('SIRET', '98765432400019')
    expect(screen.getByText('Le SIRET du contact ne commence pas par son SIREN.')).toBeTruthy()
    // Le SIRET d'un autre contact du dossier, retiré ou non, est « pris » — celui de la commune, ici.
    saisir('SIREN', '100000207')
    saisir('SIRET', '10000020700017')
    expect(screen.getByText(/^Le SIRET « 10000020700017 » est déjà celui du contact « Commune de Démoville »/)).toBeTruthy()
    saisir('SIREN', '')
    saisir('SIRET', '')
    saisir('Adresse de facturation électronique', 'pas valable')
    expect(screen.getByText(/^L'adresse de facturation électronique s'écrit SIREN/)).toBeTruthy()
    saisir('Adresse de facturation électronique', '')
    saisir('E-mail', 'pas une adresse')
    expect(screen.getByText(/^L'e-mail du contact n'est pas une adresse valable/)).toBeTruthy()
    saisir('E-mail', 'a@exemple.fr')
    saisir('Délai de paiement (jours, de 0 à 60)', 'abc')
    expect(screen.getByText('Le délai de paiement du contact est un nombre entier de jours, de 0 à 60.')).toBeTruthy()
    saisir('Délai de paiement (jours, de 0 à 60)', '61')
    expect(screen.getByText('Le délai de paiement du contact est un nombre entier de jours, de 0 à 60.')).toBeTruthy()
    expect(bouton('Enregistrer').disabled).toBe(true)
    saisir('Délai de paiement (jours, de 0 à 60)', '60')
    expect(bouton('Enregistrer').disabled).toBe(false)
    expect(faux.rpcs).toEqual([])
  })

  it('le SIRET d’un client retiré est pris aussi, et le refus le dit', async () => {
    faux.contacts = nues([contact({ id: 'p1', nom: 'Ancien établissement', retire_le: '2027-10-05T08:00:00Z', retire_par: 'u-x' })])
    render(arbre('cabinet'))
    // Le seul client est retiré : il ne se montre pas, mais l'unicité de son SIRET se juge sur la liste lue en entier.
    await screen.findByText(/^Aucun client n’est en cours/)
    fireEvent.click(bouton(/Nouveau client/))
    saisir(LIBELLE_NOM_CONTACT, 'Client neuf')
    saisir(LIBELLE_ADRESSE_CONTACT, 'Adresse')
    saisir('Type', 'assujetti')
    saisir('SIREN', '123456782')
    saisir('SIRET', '12345678200010')
    expect(screen.getByText(/« Ancien établissement » \(retiré\) : un établissement ne se range qu'une fois par dossier\.$/)).toBeTruthy()
  })

  it('une saisie complète : TOUS les champs partent par `enregistrer_contact`, la liste est relue, la fenêtre se ferme', async () => {
    await monter('cabinet')
    fireEvent.click(bouton(/Nouveau client/))
    remplirUnContactNeuf()
    saisir(LIBELLE_OBSERVATIONS_CONTACT, 'Une observation')
    const lecturesAvant = faux.lectures
    fireEvent.click(bouton('Enregistrer'))
    expect(await screen.findByText('Client « Client neuf » enregistré.')).toBeTruthy()
    expect(faux.rpcs).toEqual([{
      nom: 'enregistrer_contact',
      params: {
        p_dossier_id: 'd1', p_contact_id: null,
        p_contact: {
          nom: 'Client neuf', type_client: 'assujetti', adresse: '1 rue du Neuf', siren: '123456782', siret: null, adresse_electronique: null,
          code_service: null, email: 'neuf@exemple.fr', delai_paiement_jours: 30, observations: 'Une observation',
        },
      },
    }])
    expect(faux.lectures).toBeGreaterThan(lecturesAvant)
    expect(screen.queryByRole('heading', { name: 'Nouveau client' })).toBeNull()
    const neuf = await ligneDe('Client neuf')
    expect(lisible(neuf.textContent)).toContain('30 jours')
    expect(faux.ecritures).toEqual([])
  })

  it('un délai de zéro jour part comme 0 (un nombre), pas comme « absent »', async () => {
    await monter('cabinet')
    fireEvent.click(bouton(/Nouveau client/))
    remplirUnContactNeuf()
    saisir('Délai de paiement (jours, de 0 à 60)', '0')
    fireEvent.click(bouton('Enregistrer'))
    await screen.findByText('Client « Client neuf » enregistré.')
    expect((faux.rpcs[0].params.p_contact as Record<string, unknown>).delai_paiement_jours).toBe(0)
  })

  it('les champs laissés vides ne partent pas (null)', async () => {
    await monter('cabinet')
    fireEvent.click(bouton(/Nouveau client/))
    saisir(LIBELLE_NOM_CONTACT, 'Client sobre')
    saisir('Type', 'non_assujetti')
    saisir(LIBELLE_ADRESSE_CONTACT, 'Quelque part')
    fireEvent.click(bouton('Enregistrer'))
    await screen.findByText('Client « Client sobre » enregistré.')
    expect(faux.rpcs[0].params.p_contact).toEqual({
      nom: 'Client sobre', type_client: 'non_assujetti', adresse: 'Quelque part', siren: null, siret: null, adresse_electronique: null,
      code_service: null, email: null, delai_paiement_jours: null, observations: null,
    })
  })

  it('« Annuler » ferme sans rien écrire', async () => {
    await monter('cabinet')
    fireEvent.click(bouton(/Nouveau client/))
    remplirUnContactNeuf()
    fireEvent.click(bouton('Annuler'))
    expect(screen.queryByRole('heading', { name: 'Nouveau client' })).toBeNull()
    expect(faux.rpcs).toEqual([])
  })

  it('le refus de la base se dit sous ses mots DANS la fenêtre, qui reste ouverte ; la liste est relue', async () => {
    await monter('cabinet')
    fireEvent.click(bouton(/Nouveau client/))
    remplirUnContactNeuf()
    faux.refus.enregistrer_contact = "Le SIRET « 12345678200010 » est déjà celui du contact « Pris entre-temps » : un établissement ne se range qu'une fois par dossier."
    const lecturesAvant = faux.lectures
    fireEvent.click(bouton('Enregistrer'))
    const alerte = await screen.findByRole('alert')
    expect(alerte.textContent).toBe(faux.refus.enregistrer_contact)
    expect(screen.getByRole('heading', { name: 'Nouveau client' })).toBeTruthy()
    // Relue aussi sur un refus : la liste dit ce que la base a gardé.
    expect(faux.lectures).toBeGreaterThan(lecturesAvant)
    // Le verrou est relâché : on peut recommencer.
    expect(bouton('Enregistrer').disabled).toBe(false)
    expect(screen.queryByText(/enregistré\.$/)).toBeNull()
  })

  it('trois clics du même rendu : UNE écriture ; le verrou ne tombe qu’après la relecture', async () => {
    await monter('cabinet')
    fireEvent.click(bouton(/Nouveau client/))
    remplirUnContactNeuf()
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
    expect(screen.getByRole('heading', { name: 'Nouveau client' })).toBeTruthy()
    expect(bouton('Enregistrement…').disabled).toBe(true)
    await act(async () => { faux.retenirLecture = false; for (const r of faux.lecturesEnAttente.splice(0)) r() })
    await vi.waitFor(() => expect(screen.queryByRole('heading', { name: 'Nouveau client' })).toBeNull())
    expect(faux.rpcs).toHaveLength(1)
    expect((await lignes()).length).toBe(5)
  })
})

describe('Clients — « Modifier »', () => {
  it('la saisie part du contact LU, champ pour champ ; tous les champs repartent avec l’identifiant', async () => {
    await monter('cabinet')
    fireEvent.click(within(await ligneDe('Commune de Démoville')).getByRole('button', { name: 'Modifier' }))
    expect(screen.getByRole('heading', { name: 'Modifier le client' })).toBeTruthy()
    expect(champ(LIBELLE_NOM_CONTACT).value).toBe('Commune de Démoville')
    expect(champ('Type').value).toBe('organisme_public')
    expect(champ(LIBELLE_ADRESSE_CONTACT).value).toBe('Hôtel de ville, place de la Mairie')
    expect(champ('SIREN').value).toBe('100000207')
    expect(champ('SIRET').value).toBe('10000020700017')
    expect(champ('Adresse de facturation électronique').value).toBe('100000207')
    expect(champ('Code service').value).toBe('SERVICE-ACHATS')
    expect(champ('E-mail').value).toBe('')
    expect(champ('Délai de paiement (jours, de 0 à 60)').value).toBe('45')
    expect(champ(LIBELLE_OBSERVATIONS_CONTACT).value).toBe('Engagement juridique obligatoire')
    // Intacte, la saisie n'a aucun refus — son propre SIRET n'est pas « pris » — et ne dit rien.
    expect(bouton('Enregistrer').disabled).toBe(false)
    saisir('Délai de paiement (jours, de 0 à 60)', '30')
    fireEvent.click(bouton('Enregistrer'))
    expect(await screen.findByText('Client « Commune de Démoville » enregistré.')).toBeTruthy()
    expect(faux.rpcs).toEqual([{
      nom: 'enregistrer_contact',
      params: {
        p_dossier_id: 'd1', p_contact_id: 'c2',
        p_contact: {
          nom: 'Commune de Démoville', type_client: 'organisme_public', adresse: 'Hôtel de ville, place de la Mairie', siren: '100000207',
          siret: '10000020700017', adresse_electronique: '100000207', code_service: 'SERVICE-ACHATS', email: null, delai_paiement_jours: 30,
          observations: 'Engagement juridique obligatoire',
        },
      },
    }])
    expect(lisible((await ligneDe('Commune de Démoville')).textContent)).toContain('30 jours')
  })

  it('un client retiré : « Modifier » grisé sous les mots du module, « Reprendre » à côté', async () => {
    await monter('cabinet')
    fireEvent.click(screen.getByLabelText('Retirés'))
    const modifier = within(await ligneDe('Ancien Client')).getByRole('button', { name: 'Modifier' }) as HTMLButtonElement
    expect(modifier.disabled).toBe(true)
    expect(modifier.title).toBe('Ce contact est retiré : le reprendre avant de le modifier.')
    fireEvent.click(modifier)
    expect(screen.queryByRole('heading', { name: 'Modifier le client' })).toBeNull()
  })

  it('le SIRET d’un autre est pris, le sien ne l’est pas', async () => {
    await monter('cabinet')
    fireEvent.click(within(await ligneDe('Société Essai')).getByRole('button', { name: 'Modifier' }))
    saisir('SIREN', '100000207')
    saisir('SIRET', '10000020700017')
    expect(screen.getByText(/^Le SIRET « 10000020700017 » est déjà celui du contact « Commune de Démoville »/)).toBeTruthy()
    saisir('SIREN', '123456782')
    saisir('SIRET', '12345678200010')
    expect(screen.queryByText(/est déjà celui/)).toBeNull()
  })
})

describe('Clients — « Retirer » et « Reprendre »', () => {
  it('« Retirer » : sa fonction seule, la liste relue, le client n’est plus montré, le bilan dit', async () => {
    await monter('cabinet')
    const lecturesAvant = faux.lectures
    fireEvent.click(within(await ligneDe('Société Essai')).getByRole('button', { name: 'Retirer' }))
    expect(await screen.findByText('Client « Société Essai » retiré.')).toBeTruthy()
    expect(faux.rpcs).toEqual([{ nom: 'retirer_contact', params: { p_dossier_id: 'd1', p_contact_id: 'c1' } }])
    expect(faux.lectures).toBeGreaterThan(lecturesAvant)
    expect(await lignes()).toHaveLength(3)
    expect(faux.ecritures).toEqual([])
  })

  it('« Reprendre » : sa fonction seule, le client revient parmi ceux en cours', async () => {
    await monter('cabinet')
    fireEvent.click(screen.getByLabelText('Retirés'))
    fireEvent.click(within(await ligneDe('Ancien Client')).getByRole('button', { name: 'Reprendre' }))
    expect(await screen.findByText('Client « Ancien Client » repris.')).toBeTruthy()
    expect(faux.rpcs).toEqual([{ nom: 'reprendre_contact', params: { p_dossier_id: 'd1', p_contact_id: 'c5' } }])
    fireEvent.click(screen.getByLabelText('Retirés'))
    expect(await lignes()).toHaveLength(5)
    expect(within(await ligneDe('Ancien Client')).queryByText(/Retiré le/)).toBeNull()
  })

  it('le refus de la base (le client a changé ailleurs) se dit sous ses mots ; la liste est relue pour montrer ce qui est', async () => {
    await monter('cabinet')
    faux.refus.retirer_contact = 'Ce contact est déjà retiré.'
    const lecturesAvant = faux.lectures
    fireEvent.click(within(await ligneDe('Société Essai')).getByRole('button', { name: 'Retirer' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Ce contact est déjà retiré.')
    expect(faux.lectures).toBeGreaterThan(lecturesAvant)
    // Le verrou est relâché.
    expect((within(await ligneDe('Société Essai')).getByRole('button', { name: 'Retirer' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('trois clics du même rendu : UNE écriture ; pendant la relecture, tous les gestes sont grisés', async () => {
    await monter('cabinet')
    const retirer = within(await ligneDe('Société Essai')).getByRole('button', { name: 'Retirer' })
    act(() => { fireEvent.click(retirer); fireEvent.click(retirer); fireEvent.click(retirer) })
    faux.retenirLecture = true
    await vi.waitFor(() => expect(faux.rpcs).toHaveLength(1))
    await vi.waitFor(() => expect(faux.lecturesEnAttente.length).toBeGreaterThan(0))
    // L'écriture est revenue, la relecture non : la liste montre encore ce qu'elle montrait, tout est grisé.
    expect(bouton(/Nouveau client/).disabled).toBe(true)
    for (const b of screen.getAllByRole('button', { name: /^(Modifier|Retirer|Reprendre|Effacer)$/ })) expect((b as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { faux.retenirLecture = false; for (const r of faux.lecturesEnAttente.splice(0)) r() })
    await vi.waitFor(() => expect(bouton(/Nouveau client/).disabled).toBe(false))
    expect(faux.rpcs).toHaveLength(1)
    // Un second geste, après la relecture, est entendu.
    fireEvent.click(within(await ligneDe('Association Fictive')).getByRole('button', { name: 'Retirer' }))
    await vi.waitFor(() => expect(faux.rpcs).toHaveLength(2))
  })

  it('le message d’un geste précédent cède la place au suivant', async () => {
    await monter('cabinet')
    fireEvent.click(within(await ligneDe('Société Essai')).getByRole('button', { name: 'Retirer' }))
    await screen.findByText('Client « Société Essai » retiré.')
    fireEvent.click(within(await ligneDe('Association Fictive')).getByRole('button', { name: 'Retirer' }))
    await screen.findByText('Client « Association Fictive » retiré.')
    expect(screen.queryByText('Client « Société Essai » retiré.')).toBeNull()
  })
})

describe('Clients — « Effacer »', () => {
  it('une confirmation NOMME le client et ce qui part, rien ne part avant elle', async () => {
    await monter('cabinet')
    fireEvent.click(within(await ligneDe('Commune de Démoville')).getByRole('button', { name: 'Effacer' }))
    const dialogue = screen.getByRole('alertdialog')
    expect(within(dialogue).getByRole('heading', { name: 'Effacer le client « Commune de Démoville » ?' })).toBeTruthy()
    expect(within(dialogue).getByText('Effacer un client vide ses données — la ligne ne s’affichera plus nulle part :')).toBeTruthy()
    // Ce que ce client a, et rien d'autre : l'e-mail est absent, il n'est pas nommé.
    expect(within(dialogue).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'son nom', 'son adresse', 'son SIREN', 'son SIRET', 'son adresse de facturation électronique', 'son code service',
      'son délai de paiement', 'ses observations',
    ])
    expect(within(dialogue).getByText('Les factures qui le nomment gardent leur copie, dix ans (C. com., art. L123-22) : l’effacement ne les touche pas. Le geste ne se défait pas.')).toBeTruthy()
    expect(faux.rpcs).toEqual([])
  })

  it('« Annuler » ferme la confirmation sans rien écrire', async () => {
    await monter('cabinet')
    fireEvent.click(within(await ligneDe('Société Essai')).getByRole('button', { name: 'Effacer' }))
    fireEvent.click(bouton('Annuler'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(faux.rpcs).toEqual([])
    expect(await lignes()).toHaveLength(4)
  })

  it('confirmer : sa fonction seule, la liste relue, le client ne se montre plus nulle part, le bilan dit son nom d’avant', async () => {
    await monter('cabinet')
    const lecturesAvant = faux.lectures
    fireEvent.click(within(await ligneDe('Société Essai')).getByRole('button', { name: 'Effacer' }))
    fireEvent.click(bouton('Effacer le client'))
    expect(await screen.findByText('Client « Société Essai » effacé.')).toBeTruthy()
    expect(faux.rpcs).toEqual([{ nom: 'effacer_contact', params: { p_dossier_id: 'd1', p_contact_id: 'c1' } }])
    expect(faux.lectures).toBeGreaterThan(lecturesAvant)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(await lignes()).toHaveLength(3)
    // La ligne effacée n'est montrée ni parmi les autres, ni sous « Retirés », ni sous son nom d'effacé.
    fireEvent.click(screen.getByLabelText('Retirés'))
    expect(await lignes()).toHaveLength(5)
    expect(screen.queryByText(/Contact effacé/)).toBeNull()
    expect(screen.queryByText('Société Essai')).toBeNull()
    expect(faux.ecritures).toEqual([])
  })

  it('offert aussi sur un client retiré, qui s’efface comme un autre', async () => {
    await monter('cabinet')
    fireEvent.click(screen.getByLabelText('Retirés'))
    const ancien = await ligneDe('Ancien Client')
    expect((within(ancien).getByRole('button', { name: 'Effacer' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(within(ancien).getByRole('button', { name: 'Effacer' }))
    // Un retiré qui n'a que son nom et son adresse : la confirmation ne nomme que cela.
    expect(within(screen.getByRole('alertdialog')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['son nom', 'son adresse', 'son délai de paiement'])
    fireEvent.click(bouton('Effacer le client'))
    await screen.findByText('Client « Ancien Client » effacé.')
    expect(await lignes()).toHaveLength(5)
  })

  it('le refus de la base se dit sous ses mots DANS la confirmation, qui reste ouverte ; la liste est relue', async () => {
    await monter('cabinet')
    faux.refus.effacer_contact = 'Ce contact est déjà effacé.'
    fireEvent.click(within(await ligneDe('Société Essai')).getByRole('button', { name: 'Effacer' }))
    const lecturesAvant = faux.lectures
    fireEvent.click(bouton('Effacer le client'))
    expect((await screen.findByRole('alert')).textContent).toBe('Ce contact est déjà effacé.')
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(faux.lectures).toBeGreaterThan(lecturesAvant)
    expect(bouton('Effacer le client').disabled).toBe(false)
    expect(screen.queryByText(/effacé\.$/)).toBeTruthy()
  })

  it('deux clics, puis trois, du même rendu : UNE écriture ; la confirmation ne se ferme ni ne se relâche avant la relecture', async () => {
    await monter('cabinet')
    fireEvent.click(within(await ligneDe('Société Essai')).getByRole('button', { name: 'Effacer' }))
    const confirmer = bouton('Effacer le client')
    faux.retenirRpc = true
    act(() => { fireEvent.click(confirmer); fireEvent.click(confirmer) })
    await vi.waitFor(() => expect(faux.rpcs).toHaveLength(1))
    expect(bouton('Effacement…').disabled).toBe(true)
    expect(bouton('Annuler').disabled).toBe(true)
    faux.retenirLecture = true
    await act(async () => { faux.retenirRpc = false; for (const r of faux.rpcEnAttente.splice(0)) r() })
    await vi.waitFor(() => expect(faux.lecturesEnAttente.length).toBeGreaterThan(0))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    act(() => { fireEvent.click(bouton('Effacement…')); fireEvent.click(bouton('Effacement…')); fireEvent.click(bouton('Effacement…')) })
    await act(async () => { faux.retenirLecture = false; for (const r of faux.lecturesEnAttente.splice(0)) r() })
    await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(faux.rpcs).toHaveLength(1)
  })
})

describe('Clients — un dossier de soins (A4-Q4)', () => {
  const dossierDeSoins = () => {
    faux.contacts = nues([C1, C3, C4, C8, C5, AUTRE_DOSSIER])
  }

  it('la ligne d’information dit ce que la règle refuse, au-dessus de la liste ; rien dans un autre dossier', async () => {
    dossierDeSoins()
    await monter('cabinet', { article: SOINS })
    expect(screen.getByText(/^Ce dossier dispense des soins exonérés \(art\. 261, 4, 1° du CGI\) : il ne range ni particulier/)).toBeTruthy()
    cleanupVue()
    await monter('cabinet', { article: null })
    expect(screen.queryByText(/soins exonérés/)).toBeNull()
  })

  it('chaque contact que la règle refuse se dit tel, « Effacer » offert ; une association, une entreprise ne sont pas signalées', async () => {
    dossierDeSoins()
    await monter('cabinet', { article: SOINS })
    const signalement = 'Rangé avant que le dossier passe aux soins exonérés : il ne se modifie plus tel quel ni ne se reprend, il peut s’effacer.'
    expect(within(await ligneDe('Particulier Fictif')).getByText(signalement)).toBeTruthy()
    expect(within(await ligneDe('Client étranger fictif')).getByText(signalement)).toBeTruthy()
    expect((within(await ligneDe('Particulier Fictif')).getByRole('button', { name: 'Effacer' }) as HTMLButtonElement).disabled).toBe(false)
    expect(within(await ligneDe('Association Fictive')).queryByText(signalement)).toBeNull()
    expect(within(await ligneDe('Société Essai')).queryByText(signalement)).toBeNull()
    expect(screen.getAllByText(signalement)).toHaveLength(2)
  })

  it('hors des soins, ni un particulier ni un client établi hors de France ne sont signalés', async () => {
    dossierDeSoins()
    await monter('cabinet', { article: null })
    expect(screen.queryByText(/Rangé avant que/)).toBeNull()
  })

  it('« Modifier » d’un contact rangé avant : la fenêtre dit le refus avant le clic, bouton grisé, jusqu’à ce qu’un SIREN le rende admissible', async () => {
    dossierDeSoins()
    await monter('cabinet', { article: SOINS })
    const modifier = within(await ligneDe('Particulier Fictif')).getByRole('button', { name: 'Modifier' }) as HTMLButtonElement
    expect(modifier.disabled).toBe(false)
    fireEvent.click(modifier)
    const refus = screen.getByText(/^Un dossier qui dispense des soins exonérés \(art\. 261, 4, 1° du CGI\) ne range pas de particulier/)
    expect(refus.className).toBe('muted')
    expect(bouton('Enregistrer').disabled).toBe(true)
    saisir('SIREN', '987654324')
    expect(bouton('Enregistrer').disabled).toBe(false)
    fireEvent.click(bouton('Enregistrer'))
    await screen.findByText('Client « Particulier Fictif » enregistré.')
    expect(faux.rpcs).toHaveLength(1)
  })

  it('un contact retiré rangé avant : « Reprendre » grisé sous les mots du module, « Effacer » offert', async () => {
    faux.contacts = nues([C1, contact({ id: 'c9', nom: 'Ancien particulier', type_client: 'non_assujetti', siren: null, siret: null, retire_le: '2027-10-05T08:00:00Z', retire_par: 'u-x' })])
    await monter('cabinet', { article: SOINS })
    fireEvent.click(screen.getByLabelText('Retirés'))
    const ligne = await ligneDe('Ancien particulier')
    const reprendre = within(ligne).getByRole('button', { name: 'Reprendre' }) as HTMLButtonElement
    expect(reprendre.disabled).toBe(true)
    expect(reprendre.title).toMatch(/^Un dossier qui dispense des soins exonérés/)
    expect((within(ligne).getByRole('button', { name: 'Effacer' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(reprendre)
    expect(faux.rpcs).toEqual([])
  })

  it('au client : la ligne d’information, le signalement et le refus de la fenêtre sont les siens, sans un mot du cabinet', async () => {
    dossierDeSoins()
    await monter('client', { article: SOINS })
    expect(screen.getByText(/^Ta société dispense des soins exonérés \(art\. 261, 4, 1° du CGI\) : tu ne ranges ici ni particulier/)).toBeTruthy()
    expect(screen.getAllByText('Rangé avant que ta société passe aux soins exonérés : il ne se modifie plus tel quel ni ne se reprend, tu peux l’effacer.')).toHaveLength(2)
    fireEvent.click(within(await ligneDe('Particulier Fictif')).getByRole('button', { name: 'Modifier' }))
    expect(screen.getByText(/^Ta société dispense des soins exonérés \(art\. 261, 4, 1° du CGI\) : tu ne ranges pas de particulier dans tes clients, ce seraient tes patients/)).toBeTruthy()
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
  })

  it('au client, le refus de la base sur les soins se lit réécrit : « Ta société… », jamais « Un dossier… »', async () => {
    await monter('client')
    fireEvent.click(bouton(/Nouveau client/))
    remplirUnContactNeuf('client')
    faux.refus.enregistrer_contact = "Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de client établi hors de France dans ses contacts : il pourrait être un particulier, donc un patient."
    fireEvent.click(bouton('Enregistrer'))
    const alerte = await screen.findByRole('alert')
    expect(alerte.textContent).toBe('Ta société dispense des soins exonérés (art. 261, 4, 1° du CGI) : tu ne ranges pas de client établi hors de France dans tes clients, il pourrait être un particulier, donc un patient.')
  })
})

describe('Clients — dans l’espace du client', () => {
  it('les mêmes gestes, par les mêmes fonctions, aux mots du client : tutoiement, aucun mot du cabinet', async () => {
    await monter('client')
    fireEvent.click(bouton(/Nouveau client/))
    // Les libellés des trois textes libres : ton cabinet les lit aussi.
    expect(champ(LIBELLE_NOM_CONTACT_CLIENT)).toBeTruthy()
    expect(champ(LIBELLE_ADRESSE_CONTACT_CLIENT)).toBeTruthy()
    expect(champ(LIBELLE_OBSERVATIONS_CONTACT_CLIENT)).toBeTruthy()
    expect(screen.queryByLabelText(LIBELLE_NOM_CONTACT)).toBeNull()
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
    saisir(LIBELLE_NOM_CONTACT_CLIENT, 'Mon client')
    saisir('Type', 'assujetti')
    saisir(LIBELLE_ADRESSE_CONTACT_CLIENT, '1 rue du Client')
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
    fireEvent.click(bouton('Enregistrer'))
    expect(await screen.findByText('Client « Mon client » enregistré.')).toBeTruthy()
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['enregistrer_contact'])
  })

  it('retirer, modifier un retiré refusé, reprendre, effacer : comme au cabinet, sans un mot du cabinet', async () => {
    await monter('client')
    fireEvent.click(screen.getByLabelText('Retirés'))
    const ancien = await ligneDe('Ancien Client')
    expect((within(ancien).getByRole('button', { name: 'Modifier' }) as HTMLButtonElement).title).toBe('Ce contact est retiré : le reprendre avant de le modifier.')
    fireEvent.click(within(ancien).getByRole('button', { name: 'Reprendre' }))
    await screen.findByText('Client « Ancien Client » repris.')
    fireEvent.click(within(await ligneDe('Société Essai')).getByRole('button', { name: 'Retirer' }))
    await screen.findByText('Client « Société Essai » retiré.')
    fireEvent.click(within(await ligneDe('Commune de Démoville')).getByRole('button', { name: 'Effacer' }))
    // La confirmation : « Tes factures », tutoiement, aucune forme du cabinet.
    const dialogue = screen.getByRole('alertdialog')
    expect(within(dialogue).getByText(/^Tes factures qui le nomment gardent leur copie, dix ans/)).toBeTruthy()
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
    fireEvent.click(bouton('Effacer le client'))
    await screen.findByText('Client « Commune de Démoville » effacé.')
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['reprendre_contact', 'retirer_contact', 'effacer_contact'])
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
  })

  it('le refus de la base se dit au client sous ses mots, sans un mot du cabinet', async () => {
    await monter('client')
    faux.refus.retirer_contact = 'Accès refusé à ce dossier.'
    fireEvent.click(within(await ligneDe('Société Essai')).getByRole('button', { name: 'Retirer' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Accès refusé à ce dossier.')
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
  })
})

describe('Clients — le dossier', () => {
  it('une lecture plus lente écrit en dernier : celle d’avant, revenue après, ne remplace pas la plus récente', async () => {
    faux.retenirLecture = true
    faux.contacts = nues([contact({ id: 'n1', nom: 'Version ancienne' })])
    const { rerender } = render(arbre('cabinet'))
    rerender(arbre('cabinet', {}, 'd2'))
    rerender(arbre('cabinet'))
    await act(async () => {})
    expect(faux.lecturesEnAttente).toHaveLength(3)
    // La dernière lecture (celle de d1) revient la première, avec la version à jour…
    faux.contacts = nues([contact({ id: 'n1', nom: 'Version à jour' })])
    await act(async () => { faux.retenirLecture = false; faux.lecturesEnAttente[2]() })
    expect(await screen.findByText('Version à jour')).toBeTruthy()
    // … puis la première, lente, rend l'ancienne : elle ne l'emporte pas.
    faux.contacts = nues([contact({ id: 'n1', nom: 'Version ancienne' })])
    await act(async () => { faux.lecturesEnAttente[0]() })
    expect(screen.getByText('Version à jour')).toBeTruthy()
    expect(screen.queryByText('Version ancienne')).toBeNull()
  })

  it('une relecture lancée sous un dossier quitté depuis ne remplace pas la liste du nouveau dossier', async () => {
    const { rerender } = render(arbre('cabinet'))
    await screen.findByRole('table', { name: 'Clients' })
    faux.retenirRpc = true
    fireEvent.click(within(await ligneDe('Société Essai')).getByRole('button', { name: 'Retirer' }))
    await vi.waitFor(() => expect(faux.rpcs).toHaveLength(1))
    // Le dossier change pendant l'écriture : le second dossier se lit et s'affiche…
    rerender(arbre('cabinet', {}, 'd2'))
    expect(await screen.findByText('Client d’un autre dossier')).toBeTruthy()
    // … puis l'écriture du premier revient et relit SON dossier : la liste du second ne bouge pas.
    await act(async () => { faux.retenirRpc = false; for (const r of faux.rpcEnAttente.splice(0)) r() })
    await act(async () => {})
    expect(screen.getByText('Client d’un autre dossier')).toBeTruthy()
    expect(screen.queryByText('Chargement…')).toBeNull()
  })

  it('un dossier lu, puis un autre : la liste du premier ne reste pas affichée pendant la lecture du second', async () => {
    const { rerender } = render(arbre('cabinet'))
    await screen.findByRole('table', { name: 'Clients' })
    faux.retenirLecture = true
    rerender(arbre('cabinet', {}, 'd2'))
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByText('Société Essai')).toBeNull()
    expect(screen.queryByRole('button', { name: /Nouveau client/ })).toBeNull()
    await act(async () => { faux.retenirLecture = false; for (const r of faux.lecturesEnAttente.splice(0)) r() })
    expect(await screen.findByText('Client d’un autre dossier')).toBeTruthy()
  })
})

describe('Clients — « Exporter la fiche »', () => {
  // La fiche telle qu'elle doit sortir, écrite ici en toutes lettres (aucune des fonctions du module d'export n'y est appelée).
  const FICHE_DE_C1 = '\uFEFFNom ou raison sociale;Type;Adresse;SIREN;SIRET;Adresse de facturation électronique;Code service;E-mail;'
    + 'Délai de paiement (jours);Observations\r\n'
    + 'Société Essai;une entreprise établie en France;Adresse fictive;123456782;12345678200010;;;contact@societe-essai-fictive.example;30;'
  const JOUR = '2027-11-20'

  beforeEach(() => {
    // Le jour de Paris, que le nom du fichier porte : l'horloge est posée, et elle seule (sinon `findBy…` expire).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-11-20T10:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  const exporter = (ligne: HTMLElement) => within(ligne).getByRole('button', { name: 'Exporter la fiche' }) as HTMLButtonElement

  it('au cabinet : le geste est sur chaque client affiché (en cours, puis retirés sous « Retirés »), jamais sur un effacé', async () => {
    await monter('cabinet')
    expect(screen.getAllByRole('button', { name: 'Exporter la fiche' })).toHaveLength(4)
    fireEvent.click(screen.getByLabelText('Retirés'))
    expect(await lignes()).toHaveLength(6)
    expect(screen.getAllByRole('button', { name: 'Exporter la fiche' })).toHaveLength(6)
    for (const ligne of await lignes()) expect(exporter(ligne).disabled).toBe(false)
    expect(screen.queryByText(/Contact effacé/)).toBeNull()
  })

  it('un clic télécharge la fiche — le nom et le contenu attendus — sans rien écrire ni relire, et le dit', async () => {
    await monter('cabinet')
    const lecturesAvant = faux.lectures
    fireEvent.click(exporter(await ligneDe('Société Essai')))
    expect(faux.telecharges).toEqual([{ nom: `fiche-client-societe-essai-${JOUR}.csv`, contenu: FICHE_DE_C1 }])
    expect(faux.rpcs).toEqual([])
    expect(faux.ecritures).toEqual([])
    expect(faux.lectures).toBe(lecturesAvant)
    expect(screen.getByRole('status').textContent).toBe(`Fiche de « Société Essai » exportée : fiche-client-societe-essai-${JOUR}.csv.`)
  })

  it('un client retiré s’exporte aussi, sous son nom', async () => {
    await monter('cabinet')
    fireEvent.click(screen.getByLabelText('Retirés'))
    await lignes()
    fireEvent.click(exporter(await ligneDe('Ancien Client')))
    expect(faux.telecharges.map((t) => t.nom)).toEqual([`fiche-client-ancien-client-${JOUR}.csv`])
    expect(faux.telecharges[0].contenu).toBe(ficheDuContactCsv(C5))
    expect(faux.telecharges[0].contenu.split('\r\n')[1].startsWith('Ancien Client;')).toBe(true)
  })

  it('toute la fiche : les observations y sont, leurs retours à la ligne gardés, entre guillemets', async () => {
    const C9 = contact({
      id: 'c9', nom: 'Client; "à observations"', adresse: '3, rue de l’Été', siren: null, siret: null, type_client: 'non_assujetti',
      observations: 'Première ligne\r\nSeconde ; ligne "citée"', email: 'a@b.example', delai_paiement_jours: 0,
    })
    faux.contacts = nues([C9])
    await monter('cabinet')
    fireEvent.click(exporter((await lignes())[0]))
    const { contenu } = faux.telecharges[0]
    const fiche = contenu.slice(contenu.indexOf('\r\n') + 2)
    expect(fiche).toBe(
      '"Client; ""à observations""";un particulier, ou un autre non-assujetti;3, rue de l’Été;;;;;a@b.example;0;'
      + '"Première ligne\r\nSeconde ; ligne ""citée"""',
    )
  })

  it('au client : le même geste, les mêmes fichiers, aucune écriture', async () => {
    await monter('client')
    expect(screen.getAllByRole('button', { name: 'Exporter la fiche' })).toHaveLength(4)
    fireEvent.click(exporter(await ligneDe('Commune de Démoville')))
    expect(faux.telecharges).toHaveLength(1)
    expect(faux.telecharges[0].nom).toBe(`fiche-client-commune-de-demoville-${JOUR}.csv`)
    expect(faux.telecharges[0].contenu).toBe(ficheDuContactCsv(C2))
    expect(faux.telecharges[0].contenu).toContain('Engagement juridique obligatoire')
    expect(faux.rpcs).toEqual([])
    expect(faux.ecritures).toEqual([])
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
  })

  it('absent avant la lecture, sur une lecture partielle, sur une lecture refusée : ni geste ni phrase', async () => {
    faux.retenirLecture = true
    const { unmount } = render(arbre('cabinet'))
    expect(screen.queryByRole('button', { name: 'Exporter la fiche' })).toBeNull()
    expect(screen.queryByText(/Exporter la fiche/)).toBeNull()
    unmount()
    faux.retenirLecture = false
    faux.muetApres = 2
    const partielle = render(arbre('cabinet'))
    await screen.findByText(/Aucun geste n’est donc offert/)
    expect(screen.queryByRole('button', { name: 'Exporter la fiche' })).toBeNull()
    expect(screen.queryByText(/Exporter la fiche/)).toBeNull()
    partielle.unmount()
    faux.muetApres = Infinity
    faux.leve = true
    render(arbre('client'))
    await screen.findByText(/^Tes clients ne s’affichent pas/)
    expect(screen.queryByRole('button', { name: 'Exporter la fiche' })).toBeNull()
    expect(screen.queryByText(/Exporter la fiche/)).toBeNull()
    expect(faux.telecharges).toEqual([])
  })

  it('grisé pendant une écriture — et pendant la relecture qui la suit —, dégrisé après ; il ne prend aucun verrou', async () => {
    await monter('cabinet')
    // Un export ne tient rien : un geste d'écriture lancé juste après est entendu.
    fireEvent.click(exporter(await ligneDe('Société Essai')))
    faux.retenirRpc = true
    fireEvent.click(within(await ligneDe('Association Fictive')).getByRole('button', { name: 'Retirer' }))
    await vi.waitFor(() => expect(faux.rpcs).toHaveLength(1))
    for (const b of screen.getAllByRole('button', { name: 'Exporter la fiche' })) expect((b as HTMLButtonElement).disabled).toBe(true)
    // Un clic sur le bouton grisé ne télécharge rien.
    faux.telecharges = []
    fireEvent.click(screen.getAllByRole('button', { name: 'Exporter la fiche' })[0])
    expect(faux.telecharges).toEqual([])
    faux.retenirLecture = true
    await act(async () => { faux.retenirRpc = false; for (const r of faux.rpcEnAttente.splice(0)) r() })
    await vi.waitFor(() => expect(faux.lecturesEnAttente.length).toBeGreaterThan(0))
    for (const b of screen.getAllByRole('button', { name: 'Exporter la fiche' })) expect((b as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { faux.retenirLecture = false; for (const r of faux.lecturesEnAttente.splice(0)) r() })
    await vi.waitFor(() => expect(bouton(/Nouveau client/).disabled).toBe(false))
    for (const b of screen.getAllByRole('button', { name: 'Exporter la fiche' })) expect((b as HTMLButtonElement).disabled).toBe(false)
  })

  it('l’export efface l’erreur d’un geste précédent et cède sa place au message du geste suivant', async () => {
    faux.refus.retirer_contact = 'Contact introuvable dans ce dossier.'
    await monter('cabinet')
    fireEvent.click(within(await ligneDe('Société Essai')).getByRole('button', { name: 'Retirer' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Contact introuvable dans ce dossier.')
    fireEvent.click(exporter(await ligneDe('Société Essai')))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/^Fiche de « Société Essai » exportée/)
    fireEvent.click(within(await ligneDe('Association Fictive')).getByRole('button', { name: 'Retirer' }))
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.queryByText(/Fiche de « Société Essai » exportée/)).toBeNull()
  })

  it('UNE phrase au-dessus de la liste, jamais une par ligne : toute la fiche, observations comprises, et les factures qui n’y sont pas', async () => {
    await monter('cabinet')
    const phrases = screen.getAllByText(/^« Exporter la fiche » télécharge/)
    expect(phrases).toHaveLength(1)
    const phrase = phrases[0]
    expect(phrase.textContent).toBe(phraseDeLExportDeLaFiche('cabinet'))
    expect(phrase.textContent).toMatch(/toute la fiche d’un contact, observations comprises/)
    // « Le client » est le titulaire du dossier, seul : la fiche est celle d'un contact (les mots de la fenêtre de l'import).
    expect(phrase.textContent).toMatch(/pour que le client réponde à la personne qui lui demande ce qu’il garde sur elle/)
    expect(phrase.textContent).not.toMatch(/d’un client/)
    expect(phrase.textContent).toMatch(/Les factures qui la nomment gardent leur copie et n’y sont pas\.$/)
    // Au-dessus de la liste, et rattachée à chaque geste.
    expect(phrase.compareDocumentPosition(screen.getByRole('table', { name: 'Clients' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const b of screen.getAllByRole('button', { name: 'Exporter la fiche' })) {
      expect(b.getAttribute('aria-describedby')).toBe(phrase.id)
    }
  })

  it('au client, la phrase est la sienne : tutoiement, jamais « le client » pour lui, aucun mot du cabinet', async () => {
    await monter('client')
    const phrase = screen.getByText(/^« Exporter la fiche » télécharge/).textContent as string
    expect(phrase).toBe(phraseDeLExportDeLaFiche('client'))
    expect(phrase).toMatch(/d’un de tes clients/)
    expect(phrase).toMatch(/te demande ce que tu gardes sur elle/)
    expect(phrase).toMatch(/Tes factures qui la nomment gardent leur copie et n’y sont pas\.$/)
    expect(phrase).not.toMatch(/\ble client\b/i)
    expect(motsDuCabinet(phrase)).toEqual([])
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
  })

  it('un dossier de soins : un client rangé avant, que la règle ne laisse plus reprendre, s’exporte comme les autres', async () => {
    faux.contacts = nues([C1, C8])
    render(arbre('cabinet', { article: SOINS }))
    await tableau()
    const etranger = exporter(await ligneDe('Client étranger fictif'))
    expect(etranger.disabled).toBe(false)
    fireEvent.click(etranger)
    expect(faux.telecharges).toHaveLength(1)
    expect(faux.telecharges[0].contenu).toBe(ficheDuContactCsv(C8))
  })
})

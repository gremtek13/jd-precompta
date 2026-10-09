import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FacturesTab from './FacturesTab'
import type { ReleveStatuts } from '../../lib/receptionPlateforme'
import { MENTIONS_VIDES } from '../../test/factures'
import { SIRET_VENDEUR, TVA_VENDEUR } from '../../test/facturesCii'
import type {
  ArticleExoneration, EncaissementFacture, EncaissementFactureTaux, FactureEmise, FactureLigne, FactureSuperpdpEvent,
  StatutFactureRecu, StatutTva, TransmissionEncaissement, TransmissionFacture,
} from '../../lib/types'

// LE DERNIER DES DIX-SEPT ONGLETS À RECEVOIR UN TEST DE RENDU, et celui qui porte le seul document
// légal que le cabinet émet lui-même. Ce que ce test garde et qu'aucun test de `src/lib` ne peut voir,
// parce que tout vit dans le CÂBLAGE :
//
//  1. une facture VALIDÉE n'offre jamais la suppression — elle est figée, et seul un avoir la corrige ;
//     un avoir, lui, n'offre pas d'« Avoir » (on ne corrige pas une correction par une autre) ;
//  2. la suppression d'un brouillon DIT son échec, au lieu de laisser la ligne réapparaître en silence
//     sur un geste que l'opérateur vient de confirmer ;
//  3. une lecture refusée n'affirme pas « Aucune facture » — sur la suite de numéros qu'un cabinet doit
//     pouvoir présenter sans trou, le vide serait une affirmation fausse.
const faux = vi.hoisted(() => ({
  factures: [] as FactureEmise[],
  // La lecture refusée par la base : `lireTout` la rend incomplète, sans aucune ligne.
  refusLecture: null as string | null,
  // La suppression refusée : supabase-js ne lève pas, l'échec se lit dans `{ error }`.
  refusSuppression: null as string | null,
  suppressions: [] as unknown[],
  // Le compte que la base annonce, quand il ne vaut pas le nombre de factures : une lecture qui s'arrête avant lui est
  // INCOMPLÈTE (lib/lectureComplete.ts).
  compteAnnonce: null as number | null,
  // Les lignes que la fenêtre de l'avoir lit sur la facture d'origine.
  lignes: [{ designation: 'Séance', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }],
  // Les transmissions du dossier (ligne 28.5, étape c4), et le refus de leur lecture, à part de celui des factures.
  transmissions: [] as TransmissionFacture[],
  refusTransmissions: null as string | null,
  // Ce que la pastille d'encaissement lit (ligne 28.5, étape d3) : les lignes de toutes les factures du dossier, ses
  // encaissements et leurs parts — et une lecture qui s'arrête avant le compte annoncé.
  lignesDossier: [] as FactureLigne[],
  encaissements: [] as EncaissementFacture[],
  parts: [] as EncaissementFactureTaux[],
  encaissementsMuetsApres: null as number | null,
  // Ce que la pastille de déclaration lit en plus (ligne 28.5, étape d4) : les déclarations du dossier et l'historique
  // de Super PDP de ses factures — et une lecture des déclarations qui s'arrête avant le compte annoncé.
  declarations: [] as TransmissionEncaissement[],
  evenements: [] as FactureSuperpdpEvent[],
  declarationsMuettesApres: null as number | null,
  evenementsMuetsApres: null as number | null,
  // Les statuts lus sur la plateforme du client (ligne 28.5, étape d7), et une lecture qui s'arrête avant le compte.
  statuts: [] as StatutFactureRecu[],
  statutsMuetsApres: null as number | null,
  // La connexion à la plateforme, telle que `plateforme-agreee` (action « statut ») la rend ; une chaîne : son refus.
  connexion: null as unknown,
  refusConnexion: null as string | null,
  // Les appels à la fonction, hors de la lecture de la connexion ; le relevé reste EN ATTENTE jusqu'à ce que le cas le
  // résolve.
  appels: [] as Record<string, unknown>[],
  resoudreReleve: null as null | ((v: unknown) => void),
  lecturesStatuts: 0,
  lecturesConnexion: 0,
  // Les lectures qui suivent le relevé restent en attente : la relecture que le verrou doit couvrir.
  retenirRelectures: false,
  libererRelectures: null as null | (() => void),
}))

// La fenêtre de transmission a ses propres tests (TransmissionFactureModal.test.tsx) : doublée ici pour montrer ce que
// l'onglet lui PASSE — le statut de TVA du dossier et la case de son numéro, dont elle tire ce qui empêche de partir.
vi.mock('./TransmissionFactureModal', () => ({
  default: ({ facture, statutTva, numeroTvaAttribue }: { facture: { numero: string | null }; statutTva: string | null; numeroTvaAttribue: boolean }) => (
    <p>Transmettre {facture.numero} — {statutTva ?? 'à préciser'} — {numeroTvaAttribue ? 'numéro de TVA' : 'sans numéro de TVA'}</p>
  ),
}))

// La fenêtre des encaissements a ses propres tests (EncaissementsFactureModal.test.tsx) : doublée ici pour montrer ce que
// l'onglet lui passe.
vi.mock('./EncaissementsFactureModal', () => ({
  default: ({ facture, statutTva }: { facture: { numero: string | null }; statutTva: string | null }) => (
    <p>Encaissements de {facture.numero} — {statutTva ?? 'à préciser'}</p>
  ),
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  let barriere: Promise<void> | null = null
  return { supabase: {
    functions: {
      invoke: (nom: string, options: { body: Record<string, unknown> }) => {
        if (nom === 'plateforme-agreee' && options.body.action === 'statut') {
          faux.lecturesConnexion += 1
          const reponse = faux.refusConnexion
            ? { data: null, error: { context: new Response(JSON.stringify({ error: faux.refusConnexion }), { status: 403 }) } }
            : { data: { connexion: faux.connexion }, error: null }
          return (barriere ?? Promise.resolve()).then(() => reponse)
        }
        faux.appels.push({ nom, ...options.body })
        return new Promise((resolve) => {
          faux.resoudreReleve = (v) => {
            if (faux.retenirRelectures) barriere = new Promise<void>((r) => { faux.libererRelectures = () => { barriere = null; r() } })
            resolve(v)
          }
        })
      },
    },
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let suppression = false
      let idVise: unknown = null
      let plage: [number, number] | null = null
      // Les filtres des trois lectures de la pastille sont APPLIQUÉS (src/test/filtresPostgrest.ts) ; celui des lignes
      // passe par leur facture, la table n'ayant pas de dossier.
      const predicats: Predicat[] = []
      // Les colonnes demandées, et elles seules, comme PostgREST (une jointure `table!inner(…)` ne rend rien ici).
      let colonnes: string[] | null = null
      Object.assign(chaine, {
        select: (liste?: string) => {
          colonnes = !liste || liste === '*' ? null : liste.split(',').map((x) => x.trim()).filter((x) => !x.includes('('))
          return chaine
        },
        order: () => chaine,
        range: (debut: number, fin: number) => { plage = [debut, fin]; return chaine },
        delete: () => { suppression = true; return chaine },
        eq: (colonne: string, valeur: unknown) => {
          if (colonne === 'id') idVise = valeur
          predicats.push(colonne === 'factures_emises.dossier_id'
            ? (l) => faux.factures.some((f) => f.id === l.facture_id && f.dossier_id === valeur)
            : predicatEq(colonne, valeur))
          return chaine
        },
        in: (colonne: string, valeurs: unknown[]) => { predicats.push(predicatIn(colonne, valeurs)); return chaine },
        then: (suite: (r: { data: unknown[] | null; error: unknown; count: number | null }) => unknown) => {
          const tableDeLaPastille = {
            facture_lignes: faux.lignesDossier, encaissements_factures: faux.encaissements, encaissements_factures_taux: faux.parts,
            transmissions_encaissements: faux.declarations, facture_superpdp_events: faux.evenements,
            statuts_factures_recus: faux.statuts,
          }
          if (table === 'statuts_factures_recus') faux.lecturesStatuts += 1
          if (plage && table in tableDeLaPastille) {
            const toutes = filtrer(tableDeLaPastille[table as keyof typeof tableDeLaPastille] as readonly object[], predicats)
            const muetApres = table === 'encaissements_factures' ? faux.encaissementsMuetsApres
              : table === 'transmissions_encaissements' ? faux.declarationsMuettesApres
                : table === 'facture_superpdp_events' ? faux.evenementsMuetsApres
                  : table === 'statuts_factures_recus' ? faux.statutsMuetsApres : null
            const fin = muetApres != null ? Math.min(plage[1] + 1, muetApres) : plage[1] + 1
            const rendu = (toutes.slice(plage[0], fin) as Record<string, unknown>[])
              .map((l) => (colonnes ? Object.fromEntries(colonnes.map((k) => [k, l[k]])) : l))
            return (barriere ?? Promise.resolve()).then(() => ({ data: rendu, error: null, count: toutes.length })).then(suite)
          }
          if (suppression) {
            faux.suppressions.push(idVise)
            if (faux.refusSuppression) {
              return Promise.resolve({ data: null, error: { message: faux.refusSuppression }, count: null }).then(suite)
            }
            // La suppression MORD sur le faux : la relecture qui suit voit la ligne partie.
            faux.factures = faux.factures.filter((f) => f.id !== idVise)
            return Promise.resolve({ data: null, error: null, count: null }).then(suite)
          }
          if (table === 'facture_lignes') return Promise.resolve({ data: faux.lignes, error: null, count: null }).then(suite)
          if (table === 'transmissions_factures') {
            if (faux.refusTransmissions) {
              return Promise.resolve({ data: null, error: { message: faux.refusTransmissions }, count: null }).then(suite)
            }
            const lot = plage ? faux.transmissions.slice(plage[0], plage[1] + 1) : faux.transmissions
            return Promise.resolve({ data: lot, error: null, count: faux.transmissions.length }).then(suite)
          }
          if (table !== 'factures_emises') throw new Error(`Table non attendue dans ce test : ${table}`)
          if (faux.refusLecture) {
            return Promise.resolve({ data: null, error: { message: faux.refusLecture }, count: null }).then(suite)
          }
          // Les filtres s'appliquent : la lecture des numéros d'un relevé (`.in('id', …)`) n'en rend que les siens.
          const filtrees = filtrer(faux.factures, predicats)
          const tranche = plage ? filtrees.slice(plage[0], plage[1] + 1) : filtrees
          return Promise.resolve({ data: tranche, error: null, count: faux.compteAnnonce ?? filtrees.length }).then(suite)
        },
      })
      return chaine
    },
  } }
})

// Typé sans `as` : le compilateur confronte chaque champ à la table.
function facture(o: Partial<FactureEmise> = {}): FactureEmise {
  return {
    id: 'f1', dossier_id: 'dossier-de-test', numero: 'F2026-0001', statut: 'validee', type: 'facture',
    facture_origine_id: null, date_emission: '2026-03-10', date_echeance: null,
    tiers_nom: 'CLINIQUE DU PARC', tiers_adresse: null, tiers_siret: null,
    montant_ht: 1000, montant_tva: 200, montant_ttc: 1200, mentions_legales: null, notes: null,
    emetteur_nom: 'Cabinet de test', emetteur_siret: '12345678901234', emetteur_adresse: null,
    superpdp_invoice_id: null, superpdp_dernier_statut: null, tiers_email: null,
    created_by: null, created_at: '2026-03-10T09:00:00Z', validated_at: '2026-03-10T09:05:00Z', ...MENTIONS_VIDES, ...o,
  }
}

function poser(factures: FactureEmise[]) {
  faux.factures = factures
  faux.compteAnnonce = null
  faux.refusLecture = null
  faux.refusSuppression = null
  faux.suppressions = []
  faux.transmissions = []
  faux.refusTransmissions = null
  faux.lignesDossier = []
  faux.encaissements = []
  faux.parts = []
  faux.encaissementsMuetsApres = null
  faux.declarations = []
  faux.evenements = []
  faux.declarationsMuettesApres = null
  faux.evenementsMuetsApres = null
  faux.statuts = []
  faux.statutsMuetsApres = null
  faux.connexion = null
  faux.refusConnexion = null
  faux.appels = []
  faux.resoudreReleve = null
  faux.lecturesStatuts = 0
  faux.lecturesConnexion = 0
  faux.retenirRelectures = false
  faux.libererRelectures = null
}

function monter(statutTva: StatutTva | null = 'redevable', articleExoneration: ArticleExoneration | null = null, numeroTvaAttribue = false) {
  return render(
    <FacturesTab
      dossierId="dossier-de-test" dossierNom="Dossier de test" dossierSiret="12345678901234"
      dossierAdresse={null} statutTva={statutTva} articleExoneration={articleExoneration} numeroTvaAttribue={numeroTvaAttribue}
      tvaSurDebits={false} onAdresseUpdated={() => {}}
    />,
  )
}

// La ligne d'une facture, désignée par son client — le numéro d'origine d'un avoir porte aussi un
// numéro de facture, donc chercher le numéro seul trouverait deux lignes.
async function ligne(client: string) {
  return (await screen.findByText(client)).closest('tr') as HTMLElement
}

afterEach(() => { vi.restoreAllMocks() })

describe('FacturesTab — ce que chaque ligne permet', () => {
  it('une facture validée ne se supprime pas : elle se corrige par un avoir', async () => {
    poser([facture()])
    monter()

    const l = within(await ligne('CLINIQUE DU PARC'))
    l.getByText('Validée')
    expect(l.queryByRole('button', { name: 'Supprimer' })).toBeNull()
    for (const action of ['Aperçu', 'Avoir', 'Transmettre', 'Encaissements', 'Envoyer par e-mail']) l.getByRole('button', { name: action })
  })

  it('un brouillon se supprime, mais ne se transmet ni ne se corrige par un avoir', async () => {
    // Le garde symétrique du précédent : sans lui, « la validée n'offre pas la suppression » serait
    // satisfait par un écran qui n'offre la suppression à PERSONNE.
    poser([facture({ id: 'b1', numero: null, statut: 'brouillon', tiers_nom: 'CABINET VOISIN', validated_at: null })])
    monter()

    const l = within(await ligne('CABINET VOISIN'))
    l.getByText('Brouillon')
    l.getByRole('button', { name: 'Supprimer' })
    for (const action of ['Aperçu', 'Avoir', 'Transmettre', 'Encaissements', 'Envoyer par e-mail']) {
      expect(l.queryByRole('button', { name: action })).toBeNull()
    }
  })

  it("un avoir désigne la facture qu'il corrige, et n'offre pas d'avoir à son tour", async () => {
    poser([
      facture(),
      facture({
        id: 'a1', numero: 'A2026-0001', type: 'avoir', facture_origine_id: 'f1', tiers_nom: 'CLINIQUE DU PARC — AVOIR',
        montant_ht: -1000, montant_tva: -200, montant_ttc: -1200,
      }),
    ])
    monter()

    const l = within(await ligne('CLINIQUE DU PARC — AVOIR'))
    l.getByText('Avoir')
    l.getByText('→ F2026-0001')
    expect(l.queryByRole('button', { name: 'Avoir' })).toBeNull()
    // Un avoir ne s'encaisse pas : seule une facture reçoit le statut « Encaissée ».
    expect(l.queryByRole('button', { name: 'Encaissements' })).toBeNull()
    l.getByRole('button', { name: 'Aperçu' })
  })
})

// CE QUE LES AUTRES AVOIRS ONT DÉJÀ CRÉDITÉ (ligne 28.5, étape c). La fenêtre de l'avoir le dit avant le clic, et la
// base refuse un avoir qui créditerait plus que ce qui reste. La somme se fait sur la liste ENTIÈRE du dossier : un
// avoir daté de l'année suivante crédite la facture de cette année, et le filtre d'année ne doit pas le faire oublier.
describe('FacturesTab — l’avoir connaît ce que la facture a déjà reçu', () => {
  const avoir = facture({
    id: 'a1', numero: 'A2027-0001', type: 'avoir', facture_origine_id: 'f1', date_emission: '2027-01-15',
    tiers_nom: 'CLINIQUE DU PARC — AVOIR', montant_ht: -333.33, montant_tva: -66.67, montant_ttc: -400,
  })

  it('compte les avoirs de toutes les années, même hors du filtre affiché', async () => {
    poser([facture(), avoir])
    monter()
    await ligne('CLINIQUE DU PARC — AVOIR')
    fireEvent.click(screen.getByRole('tab', { name: '2026' }))
    expect(screen.queryByText('CLINIQUE DU PARC — AVOIR')).toBeNull()

    fireEvent.click(within(await ligne('CLINIQUE DU PARC')).getByRole('button', { name: 'Avoir' }))
    expect(await screen.findByText(/D'autres avoirs ont déjà crédité 400,00\s€ de cette facture : il en reste\s+800,00/)).toBeTruthy()
  })

  // Lue en partie, la liste ne dit pas ce qui a été crédité : la fenêtre le dit, et laisse la base juger.
  it('ne prétend rien savoir quand la liste n’a pas été lue en entier', async () => {
    poser([facture(), avoir])
    faux.compteAnnonce = 3
    monter()
    fireEvent.click(within(await ligne('CLINIQUE DU PARC')).getByRole('button', { name: 'Avoir' }))
    expect(await screen.findByText(/n'a pas été lue en entier/)).toBeTruthy()
    expect(screen.queryByText(/D'autres avoirs ont déjà crédité/)).toBeNull()
  })
})

describe("FacturesTab — la suppression d'un brouillon", () => {
  const brouillon = () => facture({ id: 'b1', numero: null, statut: 'brouillon', tiers_nom: 'CABINET VOISIN', validated_at: null })

  it('retire le brouillon quand on confirme', async () => {
    poser([brouillon()])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()

    const bouton = within(await ligne('CABINET VOISIN')).getByRole('button', { name: 'Supprimer' })
    await act(async () => { bouton.click() })

    expect(faux.suppressions).toEqual(['b1'])
    await screen.findByText('Aucune facture.')
  })

  it("dit un refus de la base, et la ligne reste — au lieu de réapparaître sans un mot", async () => {
    poser([brouillon()])
    faux.refusSuppression = 'permission denied for table factures_emises'
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()

    const bouton = within(await ligne('CABINET VOISIN')).getByRole('button', { name: 'Supprimer' })
    await act(async () => { bouton.click() })

    await screen.findByText(/permission denied for table factures_emises/)
    expect(screen.getByText('CABINET VOISIN')).toBeTruthy()
  })

  it('ne supprime rien quand la confirmation est refusée', async () => {
    poser([brouillon()])
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    monter()

    const bouton = within(await ligne('CABINET VOISIN')).getByRole('button', { name: 'Supprimer' })
    await act(async () => { bouton.click() })

    expect(faux.suppressions).toEqual([])
  })
})

describe('FacturesTab — une lecture refusée', () => {
  it("le dit, au lieu d'affirmer qu'il n'y a aucune facture", async () => {
    poser([facture()])
    faux.refusLecture = 'JWT expired'
    monter()

    await screen.findByText('La liste des factures n’a pas pu être lue.')
    expect(screen.queryByText('Aucune facture.')).toBeNull()
    expect(screen.getByText(/JWT expired/)).toBeTruthy()
  })

  it("affirme en revanche « Aucune facture » sur un dossier qui n'en a vraiment aucune", async () => {
    // Le garde symétrique : sans lui, « on ne dit pas aucune facture sur une panne » serait satisfait
    // par un écran qui crie à la panne sur tout dossier neuf.
    poser([])
    monter()

    await screen.findByText('Aucune facture.')
    expect(screen.queryByText('La liste des factures n’a pas pu être lue.')).toBeNull()
  })
})

describe('FacturesTab — la recherche', () => {
  it("filtre les lignes, et compte sur l'exercice affiché plutôt que sur les lignes trouvées", async () => {
    poser([
      facture(),
      facture({ id: 'f2', numero: 'F2026-0002', tiers_nom: 'CENTRE DE SANTÉ' }),
      facture({ id: 'f3', numero: 'F2025-0009', tiers_nom: 'CLINIQUE ANCIENNE', date_emission: '2025-11-02' }),
    ])
    monter()
    await ligne('CLINIQUE DU PARC')

    // L'exercice 2026 retenu, puis une recherche qui n'en garde qu'une : « 1 sur 2 », et non « 1 sur 3 ».
    await act(async () => { screen.getByRole('tab', { name: '2026' }).click() })
    fireEvent.change(screen.getByRole('searchbox', { name: /Rechercher un numéro/ }), { target: { value: 'sante' } })

    expect(screen.getByText('CENTRE DE SANTÉ')).toBeTruthy()
    expect(screen.queryByText('CLINIQUE DU PARC')).toBeNull()
    screen.getByText('1 sur 2')
  })
})

// LA FACTURE NEUVE SUIT LE STATUT DE TVA DU DOSSIER (lib/statutTva.ts, ligne 28.5) : l'onglet le passe au formulaire,
// qui en tire la mention proposée et le taux d'une ligne neuve. Un statut qui ne lui parviendrait pas ferait proposer
// à un dossier de soins exonérés une facture sans sa mention d'exonération.
describe('FacturesTab — la facture neuve reçoit le statut de TVA du dossier', () => {
  it('un dossier de soins exonérés propose sa mention ; un redevable une ligne à 20 %', async () => {
    poser([])
    const { unmount } = monter('exonere', 'cgi_261_4_1')
    fireEvent.click(await screen.findByRole('button', { name: '+ Nouvelle facture' }))
    expect((document.querySelector('#mentions') as HTMLTextAreaElement).value).toContain('Exonération de TVA, art. 261, 4, 1° du CGI.')
    unmount()

    poser([])
    monter('redevable')
    fireEvent.click(await screen.findByRole('button', { name: '+ Nouvelle facture' }))
    const taux = document.querySelectorAll('tbody tr')[0].querySelectorAll('input')[3] as HTMLInputElement
    expect(taux.value).toBe('20')
  })
})

// LA CASE DU NUMÉRO DE TVA (décision du cabinet du 08/10/2026) : l'onglet la passe au formulaire, à l'aperçu et à la
// fenêtre de transmission — chacun en tire ce que la facture d'un dossier en franchise ou exonéré peut porter.
describe('FacturesTab — la case du numéro de TVA du dossier', () => {
  const sansTva = () => facture({ emetteur_siret: SIRET_VENDEUR, montant_tva: 0, montant_ttc: 1000 })

  it('l’aperçu imprime le numéro d’un dossier en franchise qui a coché sa case, et aucun sans elle', async () => {
    poser([sansTva()])
    const { unmount } = monter('franchise', null, true)
    fireEvent.click(await screen.findByRole('button', { name: 'Aperçu' }))
    expect(await screen.findByText(`N° TVA intracommunautaire ${TVA_VENDEUR}`)).toBeTruthy()
    unmount()

    poser([sansTva()])
    monter('franchise', null, false)
    fireEvent.click(await screen.findByRole('button', { name: 'Aperçu' }))
    await screen.findByRole('button', { name: 'Imprimer / Enregistrer en PDF' })
    expect(screen.queryByText(/N° TVA intracommunautaire/)).toBeNull()
  })

  it('la fenêtre de transmission reçoit le statut et la case', async () => {
    poser([sansTva()])
    monter('franchise', null, true)
    fireEvent.click(await screen.findByRole('button', { name: 'Transmettre' }))
    expect(screen.getByText('Transmettre F2026-0001 — franchise — numéro de TVA')).toBeTruthy()
  })

  it('le formulaire d’une facture neuve la reçoit : sans elle, la règle G1.47 se dit avant la validation', async () => {
    for (const [numero, attendu] of [[false, 1], [true, 0]] as const) {
      poser([])
      const { unmount } = monter('franchise', null, numero)
      fireEvent.click(await screen.findByRole('button', { name: '+ Nouvelle facture' }))
      const champs = document.querySelectorAll('tbody tr')[0].querySelectorAll('input')
      fireEvent.change(champs[0], { target: { value: 'Séance de coaching' } })
      fireEvent.change(champs[2], { target: { value: '60' } })
      expect(screen.queryAllByText(/sa case se coche dans l’onglet TVA du dossier/), String(numero)).toHaveLength(attendu)
      unmount()
    }
  })
})

// OÙ EN EST CHAQUE FACTURE (ligne 28.5, étape c4) : la transmission active, sinon la plus récente, dit son canal et son
// état ; une facture partie par Super PDP avant que chaque envoi laisse sa transmission garde son badge d'avant.
describe('FacturesTab — la transmission de chaque facture', () => {
  function envoi(o: Partial<TransmissionFacture> = {}): TransmissionFacture {
    return {
      id: 't1', dossier_id: 'dossier-de-test', facture_id: 'f1', canal: 'plateforme', hote: 'flux.plateforme-demo.fr',
      flux_id: 'FLUX-1', sha256: 'a'.repeat(64), etat: 'depose', detail: null,
      cree_le: '2026-10-08T08:00:00+00:00', maj_le: '2026-10-08T08:00:00+00:00', ...o,
    }
  }

  it('l’active d’abord, sinon la plus récente ; une facture d’avant garde son badge Super PDP', async () => {
    poser([
      facture(),
      facture({ id: 'f2', numero: 'F2026-0002', tiers_nom: 'MAIRIE FICTIVE' }),
      facture({ id: 'f3', numero: 'F2026-0003', tiers_nom: 'ANCIEN CLIENT', superpdp_invoice_id: 42, superpdp_dernier_statut: 'fr:205' }),
      facture({ id: 'f4', numero: 'F2026-0004', tiers_nom: 'JAMAIS PARTIE' }),
    ])
    faux.transmissions = [
      envoi({ id: 't1', etat: 'echec', flux_id: null, cree_le: '2026-10-07T08:00:00+00:00' }),
      envoi({ id: 't2', etat: 'depose', cree_le: '2026-10-06T08:00:00+00:00' }),
      envoi({ id: 't3', facture_id: 'f2', canal: 'superpdp', hote: 'api.superpdp.tech', etat: 'echec', flux_id: null }),
    ]
    monter()
    within(await ligne('CLINIQUE DU PARC')).getByText('Plateforme du client · Déposée')
    within(await ligne('MAIRIE FICTIVE')).getByText('Super PDP · Refusée au dépôt')
    within(await ligne('ANCIEN CLIENT')).getByText('Super PDP · Approuvée')
    expect(within(await ligne('JAMAIS PARTIE')).queryByText(/·/)).toBeNull()
  })

  it('partie par Super PDP : le cycle de vie qu’il rend en dit plus que la transmission', async () => {
    poser([facture({ superpdp_invoice_id: 42, superpdp_dernier_statut: 'fr:210' })])
    faux.transmissions = [envoi({ canal: 'superpdp', hote: 'api.superpdp.tech', etat: 'accepte', flux_id: '42' })]
    monter()
    within(await ligne('CLINIQUE DU PARC')).getByText('Super PDP · Refusée')
  })

  // Le statut que Super PDP a rendu ne dit rien d'une facture dont la transmission courante est passée par la plateforme
  // du client : c'est elle qui dit où en est la facture.
  it('le cycle de Super PDP ne recouvre pas une transmission courante par la plateforme du client', async () => {
    poser([facture({ superpdp_dernier_statut: 'fr:213' })])
    faux.transmissions = [
      envoi({ id: 't1', canal: 'superpdp', hote: 'api.superpdp.tech', etat: 'echec', flux_id: null, cree_le: '2026-10-07T08:00:00+00:00' }),
      envoi({ id: 't2', etat: 'depose', cree_le: '2026-10-08T08:00:00+00:00' }),
    ]
    monter()
    within(await ligne('CLINIQUE DU PARC')).getByText('Plateforme du client · Déposée')
    expect(within(await ligne('CLINIQUE DU PARC')).queryByText(/Super PDP/)).toBeNull()
  })

  it('une lecture refusée des transmissions se dit à part, et la liste des factures reste', async () => {
    poser([facture()])
    faux.refusTransmissions = 'JWT expired'
    monter()
    await ligne('CLINIQUE DU PARC')
    expect(screen.getByText(/Les transmissions des factures/)).toBeTruthy()
    expect(screen.getByText(/Une facture peut paraître jamais transmise/)).toBeTruthy()
  })
})

// CE QUI EST ENCAISSÉ DE CHAQUE FACTURE (ligne 28.5, étape d3) : une pastille à côté de celle de la transmission, selon
// `resteAEncaisser` ; rien quand le statut « Encaissée » est sans objet, et rien du tout sur une lecture incomplète.
describe('FacturesTab — l’encaissement de chaque facture', () => {
  const ligneDe = (factureId: string, prix = 1000): FactureLigne => ({
    id: `l-${factureId}`, facture_id: factureId, ordre: 1, designation: 'Séance', quantite: 1, prix_unitaire_ht: prix, taux_tva: 20,
  })
  const encaisse = (factureId: string, montant: number, o: Partial<EncaissementFacture> = {}): EncaissementFacture => ({
    id: `e-${factureId}`, dossier_id: 'dossier-de-test', facture_id: factureId, date_encaissement: '2026-03-20', montant,
    moyen: 'virement', ligne_bancaire_id: null, annule_id: null, motif: null, cree_par: null, cree_le: '2026-03-20T09:00:00Z',
    retire_le: null, retire_par: null, ...o,
  })
  const partDe = (factureId: string, montant: number): EncaissementFactureTaux => ({
    encaissement_id: `e-${factureId}`, dossier_id: 'dossier-de-test', taux: 20, montant,
  })

  function poserQuatre() {
    poser([
      facture(),
      facture({ id: 'f2', numero: 'F2026-0002', tiers_nom: 'CENTRE PARTIEL' }),
      facture({ id: 'f3', numero: 'F2026-0003', tiers_nom: 'CENTRE SOLDÉ' }),
      facture({ id: 'f4', numero: 'F2026-0004', tiers_nom: 'PARTICULIER', type_client: 'non_assujetti' }),
    ])
    faux.lignesDossier = ['f1', 'f2', 'f3', 'f4'].map((id) => ligneDe(id))
    faux.encaissements = [encaisse('f2', 600), encaisse('f3', 1200)]
    faux.parts = [partDe('f2', 600), partDe('f3', 1200)]
  }

  it('« À encaisser », « Encaissée en partie — … sur … », « Encaissée » ; rien pour un particulier', async () => {
    poserQuatre()
    monter()
    within(await ligne('CLINIQUE DU PARC')).getByText('À encaisser')
    within(await ligne('CENTRE PARTIEL')).getByText(/^Encaissée en partie — 600,00\s€ sur 1\s200,00\s€$/)
    within(await ligne('CENTRE SOLDÉ')).getByText('Encaissée')
    const particulier = within(await ligne('PARTICULIER'))
    expect(particulier.queryByText(/^(À encaisser|Encaissée)/)).toBeNull()
    // Le bouton reste : l'encaissement d'un particulier s'enregistre aussi, il ne se déclare pas.
    particulier.getByRole('button', { name: 'Encaissements' })
  })

  // Une ligne qu'aucune base ne porterait — l'encaissement d'une facture de CE dossier rangé sous un autre — sert de
  // témoin : elle ne doit pas être lue, la lecture est celle du dossier.
  it('ne lit que les encaissements du dossier', async () => {
    poserQuatre()
    faux.encaissements.push(encaisse('f1', 300, { id: 'e-temoin', dossier_id: 'autre-dossier' }))
    faux.parts.push({ encaissement_id: 'e-temoin', dossier_id: 'autre-dossier', taux: 20, montant: 300 })
    monter()
    within(await ligne('CLINIQUE DU PARC')).getByText('À encaisser')
  })

  it('un encaissement retiré ne compte plus', async () => {
    poserQuatre()
    faux.encaissements = [encaisse('f2', 600, { retire_le: '2026-03-21T09:00:00Z' }), encaisse('f3', 1200)]
    monter()
    within(await ligne('CENTRE PARTIEL')).getByText('À encaisser')
  })

  it('une lecture incomplète des encaissements se dit, et aucune facture ne prétend rien', async () => {
    poserQuatre()
    faux.encaissementsMuetsApres = 1
    monter()
    await ligne('CLINIQUE DU PARC')
    screen.getByText(/Les encaissements des factures n'ont pas pu être lus en entier/)
    expect(screen.queryByText('À encaisser')).toBeNull()
    expect(screen.queryByText('Encaissée')).toBeNull()
  })

  it('le bouton ouvre la fenêtre de sa facture, avec le statut de TVA du dossier', async () => {
    poserQuatre()
    monter('franchise')
    fireEvent.click(within(await ligne('CENTRE PARTIEL')).getByRole('button', { name: 'Encaissements' }))
    screen.getByText('Encaissements de F2026-0002 — franchise')
  })
})

// CE QUI RESTE À DÉCLARER DE CHAQUE FACTURE (ligne 28.5, étape d4) : une seconde pastille, quand le statut « Encaissée »
// est DÛ — « À déclarer », « Déclaration en retard » au jour de Paris —, et rien du tout sur une lecture incomplète.
describe('FacturesTab — la déclaration des encaissements de chaque facture', () => {
  // Des prestations de services à une entreprise, émises après le 01/09/2027 : le statut « Encaissée » est dû.
  const due = (o: Partial<FactureEmise> = {}) => facture({
    date_emission: '2027-10-01', type_client: 'assujetti', nature_operation: 'services', option_debits: false, ...o,
  })
  const ligneDe = (factureId: string): FactureLigne => ({
    id: `l-${factureId}`, facture_id: factureId, ordre: 1, designation: 'Conseil', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20,
  })
  const encaisse = (factureId: string, date: string, o: Partial<EncaissementFacture> = {}): EncaissementFacture => ({
    id: `e-${factureId}`, dossier_id: 'dossier-de-test', facture_id: factureId, date_encaissement: date, montant: 600,
    moyen: 'virement', ligne_bancaire_id: null, annule_id: null, motif: null, cree_par: null, cree_le: `${date}T09:00:00Z`,
    retire_le: null, retire_par: null, ...o,
  })
  const acceptee = (factureId: string, o: Partial<TransmissionFacture> = {}): TransmissionFacture => ({
    id: `t-${factureId}`, dossier_id: 'dossier-de-test', facture_id: factureId, canal: 'plateforme', hote: 'flux.plateforme-demo.fr',
    flux_id: 'FLUX-1', sha256: 'a'.repeat(64), etat: 'accepte', detail: null, cree_le: '2027-10-02T08:00:00Z',
    maj_le: '2027-10-02T08:00:00Z', ...o,
  })
  const declaree = (encaissementId: string, factureId: string, o: Partial<TransmissionEncaissement> = {}): TransmissionEncaissement => ({
    id: `d-${encaissementId}`, dossier_id: 'dossier-de-test', encaissement_id: encaissementId, facture_id: factureId, canal: 'manuel',
    hote: 'flux.plateforme-demo.fr', flux_id: null, sha256: null, etat: 'depose', detail: null, note: null, cree_par: null,
    cree_le: '2027-10-21T08:00:00Z', maj_le: '2027-10-21T08:00:00Z', ...o,
  })

  // Le jour à Paris : le 02/11/2027. Un paiement d'octobre se déclare avant le 10/11, un de septembre avant le 10/10.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-11-02T10:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  function poserCinq() {
    poser([
      due({ tiers_nom: 'À DÉCLARER' }),
      due({ id: 'f2', numero: 'F2027-0002', tiers_nom: 'EN RETARD' }),
      due({ id: 'f3', numero: 'F2027-0003', tiers_nom: 'DÉJÀ DÉCLARÉE' }),
      due({ id: 'f4', numero: 'F2027-0004', tiers_nom: 'FACULTATIVE', date_emission: '2026-10-01' }),
      due({ id: 'f5', numero: 'F2027-0005', tiers_nom: 'JAMAIS TRANSMISE' }),
    ])
    faux.lignesDossier = ['f1', 'f2', 'f3', 'f4', 'f5'].map(ligneDe)
    faux.transmissions = ['f1', 'f2', 'f3', 'f4'].map((id) => acceptee(id))
    faux.encaissements = [
      encaisse('f1', '2027-10-20'), encaisse('f2', '2027-09-20'), encaisse('f3', '2027-09-20'), encaisse('f4', '2026-10-05'),
      encaisse('f5', '2027-10-20'),
    ]
    faux.parts = faux.encaissements.map((e) => ({ encaissement_id: e.id, dossier_id: 'dossier-de-test', taux: 20, montant: 600 }))
    faux.declarations = [declaree('e-f3', 'f3')]
  }

  it('« À déclarer », « Déclaration en retard » ; rien pour une facture déclarée, facultative, ou que l’application n’a pas transmise', async () => {
    poserCinq()
    monter()
    const pastille = (l: HTMLElement) => within(l).queryByText(/^(À déclarer|Déclaration en retard)$/)
    expect(pastille(await ligne('À DÉCLARER'))?.className).toBe('badge badge-une-ligne badge-warning')
    expect(pastille(await ligne('À DÉCLARER'))?.textContent).toBe('À déclarer')
    expect(pastille(await ligne('EN RETARD'))?.className).toBe('badge badge-une-ligne badge-danger')
    expect(pastille(await ligne('EN RETARD'))?.textContent).toBe('Déclaration en retard')
    expect(pastille(await ligne('DÉJÀ DÉCLARÉE'))).toBeNull()
    expect(pastille(await ligne('FACULTATIVE'))).toBeNull()
    // Jamais transmise par l'application : le statut reste dû, mais une déclaration faite ailleurs ne s'inscrirait pas
    // ici — la pastille s'allumerait sans que rien d'ici puisse l'éteindre. La fenêtre dit l'échéance, et pourquoi.
    expect(pastille(await ligne('JAMAIS TRANSMISE'))).toBeNull()
    // La pastille de l'encaissement reste à côté : deux faits, deux pastilles.
    within(await ligne('EN RETARD')).getByText(/^Encaissée en partie/)
  })

  it('ne lit que les déclarations du dossier', async () => {
    poserCinq()
    // Une déclaration de f1 rangée sous un autre dossier : aucune base ne la porterait, elle ne doit pas être lue.
    faux.declarations.push(declaree('e-f1', 'f1', { id: 'd-temoin', dossier_id: 'autre-dossier' }))
    monter()
    within(await ligne('À DÉCLARER')).getByText('À déclarer')
  })

  it('une facture refusée chez Super PDP ne se déclare plus : l’historique, lu par sa facture, la tait', async () => {
    poserCinq()
    faux.transmissions[0] = acceptee('f1', { canal: 'superpdp', hote: 'api.superpdp.tech' })
    faux.evenements = [
      { id: 'ev1', facture_id: 'f1', superpdp_event_id: 1, status_code: 'fr:210', status_text: 'Refusée', occurred_at: '2027-10-25T08:00:00Z' },
      // L'historique d'une facture d'un autre dossier ne compte pas.
      { id: 'ev2', facture_id: 'f-ailleurs', superpdp_event_id: 2, status_code: 'fr:210', status_text: 'Refusée', occurred_at: '2027-10-25T08:00:00Z' },
    ]
    monter()
    expect(within(await ligne('À DÉCLARER')).queryByText(/^(À déclarer|Déclaration en retard)$/)).toBeNull()
    within(await ligne('EN RETARD')).getByText('Déclaration en retard')
  })

  it('une lecture incomplète des déclarations se dit, et aucune facture ne prétend rien à déclarer', async () => {
    poserCinq()
    faux.declarations.push(declaree('e-f1', 'f1'))
    faux.declarationsMuettesApres = 1
    monter()
    await ligne('À DÉCLARER')
    screen.getByText(/^Les déclarations des encaissements n'ont pas pu être lues en entier/)
    screen.getByText(/une liste tronquée ferait dire « À déclarer » d’un encaissement déjà déclaré/)
    expect(screen.queryByText(/^(À déclarer|Déclaration en retard)$/)).toBeNull()
    // L'encaissement, lui, se lit encore : sa pastille reste.
    within(await ligne('À DÉCLARER')).getByText(/^Encaissée en partie/)
  })

  it('un historique de Super PDP lu en partie tait aussi la pastille : une facture refusée paraîtrait à déclarer', async () => {
    poserCinq()
    faux.evenements = [
      { id: 'ev1', facture_id: 'f2', superpdp_event_id: 1, status_code: 'fr:200', status_text: 'Déposée', occurred_at: '2027-10-25T08:00:00Z' },
      { id: 'ev2', facture_id: 'f1', superpdp_event_id: 2, status_code: 'fr:210', status_text: 'Refusée', occurred_at: '2027-10-25T08:00:00Z' },
    ]
    faux.evenementsMuetsApres = 1
    monter()
    await ligne('À DÉCLARER')
    screen.getByText(/^Les déclarations des encaissements n'ont pas pu être lues en entier/)
    expect(screen.queryByText(/^(À déclarer|Déclaration en retard)$/)).toBeNull()
  })

  it('une lecture refusée des transmissions tait aussi la pastille de déclaration, et le bandeau le dit', async () => {
    poserCinq()
    faux.refusTransmissions = 'JWT expired'
    monter()
    await ligne('À DÉCLARER')
    screen.getByText(/aucune ne dit ce qui reste à déclarer de ses encaissements/)
    expect(screen.queryByText(/^(À déclarer|Déclaration en retard)$/)).toBeNull()
  })

  // UN REFUS LU SUR LA PLATEFORME DU CLIENT (étape d7) : 210 « Refusée » ou 213 « Rejetée » — aucun statut « Encaissée »
  // ne suit une facture annulée par un avoir interne, et la pastille se tait d'elle-même.
  it('une facture refusée (210) ou rejetée (213) sur la plateforme du client ne se déclare plus', async () => {
    poserCinq()
    faux.statuts = [statutLu({ facture_id: 'f1', code: '210' }), statutLu({ id: 's2', facture_id: 'f2', code: '213' })]
    monter()
    expect(within(await ligne('À DÉCLARER')).queryByText(/^(À déclarer|Déclaration en retard)$/)).toBeNull()
    expect(within(await ligne('EN RETARD')).queryByText(/^(À déclarer|Déclaration en retard)$/)).toBeNull()
    within(await ligne('À DÉCLARER')).getByText('Cycle de vie · Refusée')
    within(await ligne('EN RETARD')).getByText('Cycle de vie · Rejetée')
  })

  it('un statut qui n’annule pas (207) laisse la pastille, et des statuts lus en partie la taisent', async () => {
    poserCinq()
    faux.statuts = [statutLu({ facture_id: 'f1', code: '207' })]
    monter()
    within(await ligne('À DÉCLARER')).getByText('À déclarer')
    cleanup()

    poserCinq()
    faux.statuts = [statutLu({ facture_id: 'f2', code: '205' }), statutLu({ id: 's2', facture_id: 'f1', code: '210' })]
    faux.statutsMuetsApres = 1
    monter()
    await ligne('À DÉCLARER')
    screen.getByText(/^Les statuts lus sur la plateforme du client n'ont pas pu être lus en entier/)
    screen.getByText(/laisserait dire « À déclarer » d’une facture refusée/)
    expect(screen.queryByText(/^(À déclarer|Déclaration en retard)$/)).toBeNull()
    expect(screen.queryByText(/^Cycle de vie/)).toBeNull()
  })
})

// Un statut lu sur la plateforme du client, typé sans `as`.
function statutLu(o: Partial<StatutFactureRecu> = {}): StatutFactureRecu {
  return {
    id: 's1', dossier_id: 'dossier-de-test', facture_id: 'f1', hote: 'flux.plateforme-demo.fr', flux_id: `flux-${o.id ?? 's1'}`,
    code: '205', message_id: null, emis_le: '20261005101500', createur_role: 'BY', date_statut: '2026-10-05', motifs: null,
    commentaire: null, montants: [], lu_par: null, lu_le: '2026-10-08T09:00:00Z', ...o,
  }
}

const CONNEXION = {
  nom: 'Plateforme Démo', url_flux: 'https://flux.plateforme-demo.fr', url_jeton: 'https://flux.plateforme-demo.fr/jeton',
  hote: 'flux.plateforme-demo.fr', client_id: 'cabinet', organisation_id: null, portee: null, recherche_depuis: null,
  derniere_recuperation: null, cycle_vie_depuis: null, cycle_vie_lu_le: null, created_at: '2026-10-01T08:00:00Z', version: 'v1',
}

// Le bilan d'un relevé tel que `plateforme-agreee` le rend (FICTIF).
function releve(o: Partial<ReleveStatuts> = {}): ReleveStatuts {
  return {
    hote: 'flux.plateforme-demo.fr', version: 'v1', depuis: null, issues: [],
    ecartes: { autre_flux: 0, illisible: 0, format: 0, statut_inconnu: 0, doublons: 0 },
    en_attente: 0, en_erreur: 0, reportes: 0, complete: true, motif: null, cycle_vie_depuis: '2026-10-09T08:00:00Z',
    cycle_vie_lu_le: '2026-10-09T09:00:00Z', erreur_reprise: null, ...o,
  }
}

// LE CYCLE DE VIE DES FACTURES ÉMISES DANS L'ONGLET (ligne 28.5, étape d7) : la pastille du dernier statut lu sous le
// libellé de la DGFiP — le refus, s'il y en a un —, l'avoir interne proposé, et le relevé SUR UN CLIC, jamais à
// l'ouverture : un seul appel pour trois clics, le verrou tenu jusqu'après la relecture, le bilan dit, une erreur dite.
describe('FacturesTab — les statuts lus sur la plateforme du client', () => {
  it('la pastille du dernier statut lu, sous le libellé de la DGFiP ; le refus l’emporte ; l’avoir devient interne', async () => {
    poser([
      facture(),
      facture({ id: 'f2', numero: 'F2026-0002', tiers_nom: 'CABINET REFUSANT' }),
      facture({ id: 'f3', numero: 'F2026-0003', tiers_nom: 'SANS STATUT' }),
    ])
    faux.statuts = [
      statutLu({ id: 's1', facture_id: 'f1', code: '205', lu_le: '2026-10-08T09:00:00Z' }),
      // Lus au même instant : le plus tard horodaté est le dernier.
      statutLu({ id: 's2', facture_id: 'f1', code: '207', lu_le: '2026-10-09T09:00:00Z', emis_le: '20261006080000' }),
      statutLu({ id: 's3', facture_id: 'f1', code: '206', lu_le: '2026-10-09T09:00:00Z', emis_le: '20261005080000' }),
      statutLu({ id: 's4', facture_id: 'f2', code: '210', lu_le: '2026-10-08T09:00:00Z' }),
      // Un « Encaissée » lu APRÈS le refus ne le recouvre pas.
      statutLu({ id: 's5', facture_id: 'f2', code: '212', lu_le: '2026-10-09T09:00:00Z' }),
      // Un statut d'un autre dossier n'est pas lu.
      statutLu({ id: 's6', dossier_id: 'autre-dossier', facture_id: 'f3', code: '213' }),
    ]
    monter()
    const premiere = within(await ligne('CLINIQUE DU PARC'))
    expect(premiere.getByText('Cycle de vie · En litige').className).toBe('badge badge-une-ligne badge-danger')
    premiere.getByRole('button', { name: 'Avoir' })
    const refusee = within(await ligne('CABINET REFUSANT'))
    expect(refusee.getByText('Cycle de vie · Refusée').className).toBe('badge badge-une-ligne badge-danger')
    expect(refusee.getByText('Cycle de vie · Refusée').getAttribute('title'))
      .toMatch(/^Lu sur flux\.plateforme-demo\.fr le \d\d\/10\/2026, posé par l’acheteur$/)
    const avoir = refusee.getByRole('button', { name: 'Avoir interne' })
    expect(avoir.getAttribute('title')).toContain('elle s’annule par un avoir interne, qui ne se transmet pas, puis une nouvelle facture')
    expect(refusee.queryByRole('button', { name: 'Avoir' })).toBeNull()
    expect(within(await ligne('SANS STATUT')).queryByText(/^Cycle de vie/)).toBeNull()
  })

  it('sans connexion à la plateforme : aucun bouton, et rien ne part chez elle à l’ouverture', async () => {
    poser([facture()])
    monter()
    await ligne('CLINIQUE DU PARC')
    expect(faux.lecturesConnexion).toBe(1)
    expect(screen.queryByRole('button', { name: 'Lire les statuts de la plateforme' })).toBeNull()
    expect(faux.appels).toEqual([])
  })

  it('une connexion illisible se dit, sans bouton', async () => {
    poser([facture()])
    faux.refusConnexion = 'Accès refusé à ce dossier.'
    monter()
    expect(await screen.findByText(/^Plateforme du client : Accès refusé à ce dossier\. Les statuts de ses factures ne se relèvent pas d’ici/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Lire les statuts de la plateforme' })).toBeNull()
  })

  it('trois clics, un seul relevé ; le verrou tient jusqu’après la relecture ; le bilan dit chaque statut', async () => {
    poser([facture(), facture({ id: 'f2', numero: 'F2026-0002', tiers_nom: 'CABINET REFUSANT' })])
    faux.connexion = CONNEXION
    monter()
    expect(await screen.findByText(/les statuts des factures émises n’ont pas encore été lus\./)).toBeTruthy()
    // Rien n'est relevé à l'ouverture : seule la connexion a été lue, en base.
    expect(faux.appels).toEqual([])
    const bouton = screen.getByRole('button', { name: 'Lire les statuts de la plateforme' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.appels).toEqual([{ nom: 'plateforme-agreee', action: 'relever', dossierId: 'dossier-de-test', depuisLeDebut: false }])
    expect(screen.getByRole('button', { name: 'Lecture des statuts…' })).toHaveProperty('disabled', true)

    // La plateforme a rendu un refus de f2 : la base l'a gardé, et la relecture le montrera.
    faux.statuts = [statutLu({ id: 's9', facture_id: 'f2', code: '210' })]
    faux.connexion = { ...CONNEXION, cycle_vie_lu_le: '2026-10-09T09:00:00Z' }
    faux.retenirRelectures = true
    const lecturesAvant = faux.lecturesStatuts
    await act(async () => {
      faux.resoudreReleve?.({
        data: releve({
          issues: [
            { flux: 'L1', issue: 'garde', facture_id: 'f2', code: '210', avertissements: ['L’horodatage n’est pas lisible : il est écarté.'] },
            { flux: 'L2', issue: 'garde', facture_id: 'f1', code: '205', avertissements: [] },
            { flux: 'L3', issue: 'deja_lu' },
            { flux: 'L4', issue: 'deja_lu' },
            { flux: 'L5', issue: 'ecarte', ecart: 'autre_vendeur', raison: 'Le statut désigne une autre entreprise que le dossier.', code: '210', detail: null },
            {
              flux: 'L6', issue: 'ecarte', ecart: 'autre_objet', raison: 'Le message porte sur un autre statut, pas sur une facture.', code: '601',
              detail: { reference: 'MSG-42', date_objet: '2026-10-07', motifs: 'REJ_SEMAN : donnée absente', commentaire: null },
            },
            { flux: 'L7', issue: 'echec', raison: 'La plateforme n’a pas répondu à temps (téléchargement d’un statut).', statut_http: 504 },
          ],
          en_attente: 2, reportes: 1, ecartes: { autre_flux: 3, illisible: 0, format: 0, statut_inconnu: 0, doublons: 0 },
        }),
        error: null,
      })
    })
    // La relecture court : le bouton reste pris, et un clic ne relance rien.
    expect(faux.lecturesStatuts).toBeGreaterThan(lecturesAvant)
    const pris = screen.getByRole('button', { name: 'Lecture des statuts…' })
    expect(pris).toHaveProperty('disabled', true)
    await act(async () => { pris.click() })
    expect(faux.appels).toHaveLength(1)
    await act(async () => { faux.libererRelectures?.() })

    screen.getByRole('heading', { name: /^Statuts lus sur flux\.plateforme-demo\.fr le \d\d\/10\/2026$/ })
    // Les gardés, le refus en tête, en rouge, avec sa conséquence ; ses données écartées en petit.
    const gardes = screen.getAllByText(/^F2026-000[12]$/, { selector: 'strong' }).map((n) => n.closest('li') as HTMLElement)
    expect(gardes.map((li) => li.textContent)).toEqual([
      'F2026-0002 : Refusée — elle s’annule par un avoir interne, qui ne se transmet pas, puis une nouvelle facture '
        + '(spécifications externes de la DGFiP, § 3.6.4).Données écartées du message : L’horodatage n’est pas lisible : il est écarté.',
      'F2026-0001 : Approuvée',
    ])
    expect(gardes[0].className).toBe('releve-annulation')
    screen.getByText('2 statuts déjà lus : reconnus, ils ne s’écrivent pas deux fois.')
    screen.getByText('2 statuts en attente : la plateforme n’a pas fini de les traiter, ils reviendront.')
    screen.getByText('1 statut prêt non lu cette fois (le temps ou le nombre) : le prochain relevé le lira.')
    screen.getByText('3 messages écartés : ce ne sont pas des statuts de factures émises.')
    // Les écartés avec leur raison telle quelle ; le 601 du dossier avec ce qu'il porte.
    screen.getByText('Le statut désigne une autre entreprise que le dossier.')
    screen.getByText('La plateforme de l’administration a rejeté un statut : le message MSG-42 du 07/10/2026 ; motifs : REJ_SEMAN : donnée absente.')
    screen.getByText('La plateforme n’a pas répondu à temps (téléchargement d’un statut). Le prochain relevé le reprendra.')
    // La relecture : la pastille dit le refus, l'avoir devient interne, la connexion dit quand.
    within(await ligne('CABINET REFUSANT')).getByText('Cycle de vie · Refusée')
    within(await ligne('CABINET REFUSANT')).getByRole('button', { name: 'Avoir interne' })
    screen.getByText(/statuts des factures émises lus le \d\d\/10\/2026\./)
    expect(screen.getByRole('button', { name: 'Lire les statuts de la plateforme' })).toHaveProperty('disabled', false)
  })

  it('un relevé incomplet le dit, et un point de reprise non enregistré aussi', async () => {
    poser([facture()])
    faux.connexion = CONNEXION
    monter()
    const bouton = await screen.findByRole('button', { name: 'Lire les statuts de la plateforme' })
    await act(async () => { bouton.click() })
    await act(async () => {
      faux.resoudreReleve?.({
        data: releve({
          complete: false, motif: 'cinquante statuts lus, la suite au prochain relevé', cycle_vie_lu_le: null,
          erreur_reprise: 'La connexion à la plateforme a changé entre-temps : le point de reprise des statuts n’est pas enregistré.',
        }),
        error: null,
      })
    })
    screen.getByRole('heading', { name: 'Statuts lus en partie sur flux.plateforme-demo.fr' })
    screen.getByText('Pas de nouveau statut sur une facture du dossier.')
    screen.getByText('Relevé incomplet : cinquante statuts lus, la suite au prochain relevé. Relancez la lecture pour la suite.')
    screen.getByText('La connexion à la plateforme a changé entre-temps : le point de reprise des statuts n’est pas enregistré. '
      + 'Rien n’est perdu : le prochain relevé relira ces statuts, et reconnaîtra ceux déjà gardés.')
  })

  it('un relevé refusé par la plateforme se dit, avec ce qu’il faut faire, et le verrou se relâche', async () => {
    poser([facture()])
    faux.connexion = CONNEXION
    monter()
    const bouton = await screen.findByRole('button', { name: 'Lire les statuts de la plateforme' })
    await act(async () => { bouton.click() })
    const corps = JSON.stringify({ error: 'La plateforme refuse l’identifiant ou le secret (401).', identifiants_refuses: true })
    await act(async () => { faux.resoudreReleve?.({ data: null, error: { context: new Response(corps, { status: 502 }) } }) })
    screen.getByText(/^La plateforme refuse l’identifiant ou le secret \(401\)\. L’identifiant ou le secret enregistrés ne sont plus acceptés/)
    const libre = screen.getByRole('button', { name: 'Lire les statuts de la plateforme' })
    expect(libre).toHaveProperty('disabled', false)
    await act(async () => { libre.click() })
    expect(faux.appels).toHaveLength(2)
    const acces = JSON.stringify({ error: 'La plateforme refuse l’accès (recherche des statuts, 403).', acces_refuse: true })
    await act(async () => { faux.resoudreReleve?.({ data: null, error: { context: new Response(acces, { status: 502 }) } }) })
    screen.getByText(/^La plateforme refuse l’accès \(recherche des statuts, 403\)\. Demandez au client d’ouvrir au cabinet le droit de lire/)
  })
})

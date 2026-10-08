import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FacturesTab from './FacturesTab'
import { MENTIONS_VIDES } from '../../test/factures'
import { SIRET_VENDEUR, TVA_VENDEUR } from '../../test/facturesCii'
import type { ArticleExoneration, FactureEmise, StatutTva, TransmissionFacture } from '../../lib/types'

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
}))

// La fenêtre de transmission a ses propres tests (TransmissionFactureModal.test.tsx) : doublée ici pour montrer ce que
// l'onglet lui PASSE — le statut de TVA du dossier et la case de son numéro, dont elle tire ce qui empêche de partir.
vi.mock('./TransmissionFactureModal', () => ({
  default: ({ facture, statutTva, numeroTvaAttribue }: { facture: { numero: string | null }; statutTva: string | null; numeroTvaAttribue: boolean }) => (
    <p>Transmettre {facture.numero} — {statutTva ?? 'à préciser'} — {numeroTvaAttribue ? 'numéro de TVA' : 'sans numéro de TVA'}</p>
  ),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let suppression = false
      let idVise: unknown = null
      let plage: [number, number] | null = null
      Object.assign(chaine, {
        select: () => chaine,
        order: () => chaine,
        range: (debut: number, fin: number) => { plage = [debut, fin]; return chaine },
        delete: () => { suppression = true; return chaine },
        eq: (colonne: string, valeur: unknown) => { if (colonne === 'id') idVise = valeur; return chaine },
        then: (suite: (r: { data: unknown[] | null; error: unknown; count: number | null }) => unknown) => {
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
          const tranche = plage ? faux.factures.slice(plage[0], plage[1] + 1) : faux.factures
          return Promise.resolve({ data: tranche, error: null, count: faux.compteAnnonce ?? faux.factures.length }).then(suite)
        },
      })
      return chaine
    },
  },
}))

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
    for (const action of ['Aperçu', 'Avoir', 'Transmettre', 'Envoyer par e-mail']) l.getByRole('button', { name: action })
  })

  it('un brouillon se supprime, mais ne se transmet ni ne se corrige par un avoir', async () => {
    // Le garde symétrique du précédent : sans lui, « la validée n'offre pas la suppression » serait
    // satisfait par un écran qui n'offre la suppression à PERSONNE.
    poser([facture({ id: 'b1', numero: null, statut: 'brouillon', tiers_nom: 'CABINET VOISIN', validated_at: null })])
    monter()

    const l = within(await ligne('CABINET VOISIN'))
    l.getByText('Brouillon')
    l.getByRole('button', { name: 'Supprimer' })
    for (const action of ['Aperçu', 'Avoir', 'Transmettre', 'Envoyer par e-mail']) {
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
    within(await ligne('ANCIEN CLIENT')).getByText('Super PDP · Acceptée')
    expect(within(await ligne('JAMAIS PARTIE')).queryByText(/·/)).toBeNull()
  })

  it('partie par Super PDP : le cycle de vie qu’il rend en dit plus que la transmission', async () => {
    poser([facture({ superpdp_invoice_id: 42, superpdp_dernier_statut: 'fr:210' })])
    faux.transmissions = [envoi({ canal: 'superpdp', hote: 'api.superpdp.tech', etat: 'accepte', flux_id: '42' })]
    monter()
    within(await ligne('CLINIQUE DU PARC')).getByText('Super PDP · Refusée')
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

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FactureFormModal from './FactureFormModal'
import { MENTIONS_VIDES } from '../../test/factures'
import { SIREN_CLIENT, SIRET_CLIENT, SIRET_VENDEUR } from '../../test/facturesCii'
import type { ArticleExoneration, FactureEmise, StatutTva } from '../../lib/types'

// DIXIÈME PORTEUR DU MOTIF « un verrou d'exécution est un `useRef`, jamais un état React »
// (CLAUDE.md) — et le plus cher des dix.
//
// `saving` est un état React, donc `disabled={!!saving}` ne ferme rien contre deux clics dans le
// même rendu. Deux « Valider la facture » rapprochés sur une facture NEUVE partent tous deux avec
// `p_facture_id = null` : `enregistrer_facture` prend alors sa branche INSERT deux fois, et chacune
// consomme son propre numéro de la suite annuelle (`attribuer_numero_facture`, upsert +1). Résultat :
// DEUX factures validées, identiques, numérotées à la suite, toutes deux IMMUABLES — l'écran ne
// propose la suppression que sur un brouillon, et la seule sortie légale est un avoir.
//
// Sur un brouillon EXISTANT la base rattrape (le `select … for update` sérialise, et le second appel
// se fait refuser « Une facture validée ne peut plus être modifiée ») : c'est la création qui n'a
// aucun filet, exactement comme `memberships UNIQUE` rattrape « Créer l'accès » et pas les autres.
//
// POURQUOI LE BALAYAGE DU 20/09/2026 NE L'A PAS VU, et c'est la vraie leçon : il cherchait
// `.insert(` / `functions.invoke` / `storage…upload` DANS LE CORPS DU GESTIONNAIRE. Ici l'écriture
// passe par `.rpc(` — la porte qu'`edgeFunctionsEcritures` avait déjà manquée — et depuis
// `src/lib/factures.ts`, donc hors du corps. Deux aveuglements indépendants, une seule panne : une
// liste d'inclusion tenue à la main ne contient que ce à quoi quelqu'un a pensé.

const faux = vi.hoisted(() => ({
  // Les lignes d'un brouillon rouvert, rendues par la lecture de `facture_lignes`.
  lignes: [] as Record<string, unknown>[],
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  // La promesse du premier appel reste EN ATTENTE : c'est la fenêtre réelle pendant laquelle un
  // second envoi arrive. La résoudre tout de suite supprimerait la fenêtre que le verrou ferme.
  resoudre: null as null | ((v: unknown) => void),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      return new Promise((resolve) => { faux.resoudre = resolve })
    },
    // Volontairement bruyant : une table inattendue doit nommer ce que le test n'avait pas prévu,
    // plutôt que de rendre un objet vide et de faire échouer l'écran loin de la cause.
    from: (table: string) => {
      if (table !== 'facture_lignes') throw new Error(`Table non attendue dans ce test : ${table}`)
      const requete = { select: () => requete, eq: () => requete, order: () => Promise.resolve({ data: faux.lignes, error: null }) }
      return requete
    },
  },
}))

// `enregistrerFacture` (lib/factures.ts) n'est PAS doublée : c'est elle qui appelle le RPC, donc la
// doubler compterait des appels à un faux au lieu des écritures réelles.
function monter(
  statutTva: StatutTva | null = 'franchise',
  articleExoneration: ArticleExoneration | null = null,
  autres: { facture?: FactureEmise | null; tvaSurDebits?: boolean; dossierSiret?: string | null; numeroTvaAttribue?: boolean } = {},
) {
  faux.appels = []
  faux.resoudre = null
  render(
    <FactureFormModal
      dossierId="d1"
      dossierNom="Cabinet de test"
      dossierSiret={autres.dossierSiret ?? null}
      dossierAdresse={null}
      statutTva={statutTva}
      articleExoneration={articleExoneration}
      numeroTvaAttribue={autres.numeroTvaAttribue ?? false}
      tvaSurDebits={autres.tvaSurDebits ?? false}
      facture={autres.facture ?? null}
      onAdresseUpdated={() => {}}
      onClose={() => {}}
      onSaved={() => {}}
    />,
  )

  // Un brouillon rouvert lit d'abord ses lignes : le formulaire n'existe pas encore.
  if (autres.facture) return
  // Les deux seules conditions qu'`enregistrer` exige : un nom de client, et une ligne portant une
  // désignation (la quantité vaut déjà 1 par défaut).
  fireEvent.change(document.querySelector('#tiers-nom')!, { target: { value: 'Client SARL' } })
  fireEvent.change(document.querySelectorAll('tbody input')[0]!, { target: { value: 'Prestation' } })
}

const valider = () => screen.getByRole('button', { name: 'Valider la facture' })

describe('FactureFormModal — le verrou d’enregistrement d’une facture', () => {
  it("n'enregistre qu'une seule facture quand on valide deux fois de suite", async () => {
    monter()

    // LES DEUX ENVOIS DANS LE MÊME `act` : deux `.click()` successifs ouvrent chacun leur `act`, qui
    // rend le composant en sortant — le second tomberait sur un bouton déjà re-rendu avec `saving` à
    // jour, et le test resterait VERT avec le défaut réinstallé (CLAUDE.md).
    const bouton = valider()
    await act(async () => { bouton.click(); bouton.click() })

    expect(faux.appels).toHaveLength(1)
    // La validation est ce qui consomme le numéro : l'assertion porte sur ELLE, pas sur le seul
    // nombre d'appels — un second appel en brouillon ne coûterait pas la même chose.
    expect(faux.appels[0].args.p_valider).toBe(true)
  })

  // IL FAUT TROIS ENVOIS pour distinguer un verrou posé AVANT le `try` d'un verrou posé dedans : si
  // la pose vivait dans le `try`, le `return` du deuxième sortirait par le `finally`, qui relâcherait
  // le verrou du PREMIER — encore en cours — et le troisième repartirait pour une seconde facture.
  it('un troisième envoi ne crée pas de seconde facture', async () => {
    monter()
    const bouton = valider()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.appels).toHaveLength(1)
  })

  it('relâche le verrou sur un échec, pour laisser réessayer', async () => {
    monter()
    await act(async () => { valider().click() })
    expect(faux.appels).toHaveLength(1)

    await act(async () => { faux.resoudre?.({ data: null, error: { message: 'Numérotation refusée' } }) })
    expect(screen.getByText(/Numérotation refusée/)).toBeTruthy()

    await act(async () => { valider().click() })
    expect(faux.appels).toHaveLength(2)
  })

  // LE FORMULAIRE EST LE PIRE DÉCLENCHEUR, PAS LE DOUBLE CLIC : « Enregistrer le brouillon » est un
  // `type="submit"` dans un `<form>`, donc deux « Entrée » rapprochés dans n'importe quel champ
  // suffisent. Le doublon y coûte moins cher (un brouillon se supprime) mais le geste est le plus
  // banal des deux, et c'est le même verrou qui le ferme.
  it('couvre aussi la soumission du formulaire en brouillon', async () => {
    monter()
    const brouillon = screen.getByRole('button', { name: 'Enregistrer le brouillon' })
    await act(async () => { brouillon.click(); brouillon.click(); brouillon.click() })
    expect(faux.appels).toHaveLength(1)
    expect(faux.appels[0].args.p_valider).toBe(false)
  })

  // GARDE SYMÉTRIQUE — sans lui, « on n'enregistre qu'une fois » serait satisfait par un écran qui
  // n'enregistre JAMAIS.
  it('enregistre bien quand on valide une seule fois', async () => {
    monter()
    await act(async () => { valider().click() })
    expect(faux.appels).toHaveLength(1)
    expect(faux.appels[0].nom).toBe('enregistrer_facture')
  })
})

// L'EN-TÊTE EST LE TOTAL DES LIGNES QUI PARTENT (07/10/2026). Les totaux étaient calculés sur TOUTES les lignes affichées,
// et seules celles qui portent une désignation et une quantité positive partaient : une remise saisie en quantité
// négative diminuait le total de la facture sans figurer parmi ses lignes. La base stocke l'en-tête tel qu'il est
// envoyé, donc la facture validée se contredisait — à l'aperçu imprimé comme à la plateforme qui la reçoit, dont le
// validateur refuse un total qui n'est pas la somme des lignes. Latent : les six factures en base sont cohérentes.
describe('FactureFormModal — l’en-tête est le total des lignes qui partent', () => {
  const champs = (i: number) => document.querySelectorAll('tbody tr')[i].querySelectorAll('input')

  it('une ligne écartée n’entre pas dans les montants envoyés, et l’écran le dit', async () => {
    monter('redevable')
    fireEvent.change(champs(0)[2], { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Ligne' }))
    fireEvent.change(champs(1)[0], { target: { value: 'Remise' } })
    fireEvent.change(champs(1)[1], { target: { value: '-1' } })
    fireEvent.change(champs(1)[2], { target: { value: '30' } })
    expect(screen.getByText(/Une ligne ne partira pas avec la facture/)).toBeTruthy()

    await act(async () => { valider().click() })
    const args = faux.appels[0].args as { p_facture: Record<string, unknown>; p_lignes: unknown[] }
    expect(args.p_lignes).toEqual([{ designation: 'Prestation', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }])
    expect(args.p_facture).toMatchObject({ montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
  })

  // LE GARDE SYMÉTRIQUE : une ligne neuve laissée vide n'est pas une ligne écartée qu'il faudrait signaler.
  it('ne dit rien d’une ligne neuve laissée vide', () => {
    monter('redevable')
    fireEvent.click(screen.getByRole('button', { name: '+ Ligne' }))
    expect(screen.queryByText(/ne partir(a|ont) pas/)).toBeNull()
  })
})

// LA FACTURE SUIT LE STATUT DE TVA DU DOSSIER (lib/statutTva.ts, ligne 28.5). La mention proposée était celle de la
// franchise pour tout dossier non assujetti, donc pour un dossier de soins exonérés ; et une ligne neuve partait à
// 0 % sur un redevable, que la plateforme recevait avec le motif de la franchise.
describe('FactureFormModal — la facture suit le statut de TVA du dossier', () => {
  const mentions = () => (document.querySelector('#mentions') as HTMLTextAreaElement).value
  const tauxDeLaLigne = (i = 0) => (document.querySelectorAll('tbody tr')[i].querySelectorAll('input')[3] as HTMLInputElement)

  it('un dossier de soins exonérés propose la mention de son article, jamais la franchise', () => {
    monter('exonere', 'cgi_261_4_1')
    expect(mentions()).toContain('Exonération de TVA, art. 261, 4, 1° du CGI.')
    expect(mentions()).not.toContain('293 B')
  })

  it('un dossier en franchise propose la mention de l’art. 293 B', () => {
    monter('franchise')
    expect(mentions()).toContain('TVA non applicable, art. 293 B du CGI.')
  })

  it('une ligne neuve part à 20 % sur un redevable, à 0 % ailleurs', () => {
    monter('redevable')
    expect(tauxDeLaLigne().value).toBe('20')
    fireEvent.click(screen.getByRole('button', { name: '+ Ligne' }))
    expect(tauxDeLaLigne(1).value).toBe('20')
    cleanup()
    monter('exonere', 'cgi_261_4_1')
    expect(tauxDeLaLigne().value).toBe('0')
  })

  it('une ligne taxée sur un dossier en franchise refuse la validation, et le dit', async () => {
    monter('franchise')
    fireEvent.change(tauxDeLaLigne(), { target: { value: '20' } })
    expect(screen.getByText(/Un dossier en franchise en base ne facture pas de TVA : une ligne à 20/)).toBeTruthy()
    expect(valider()).toHaveProperty('disabled', true)
    // Le brouillon reste enregistrable : le statut peut être en retard sur la réalité.
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer le brouillon' }).click() })
    expect(faux.appels).toHaveLength(1)
    expect(faux.appels[0].args.p_valider).toBe(false)
  })

  // GARDE SYMÉTRIQUE : une ligne à 0 % ne refuse rien, et un redevable facture la TVA.
  it('une ligne à 0 % d’un franchisé et une ligne taxée d’un redevable se valident', async () => {
    monter('franchise')
    expect(valider()).toHaveProperty('disabled', false)
    expect(screen.queryAllByText(/ne facture pas de TVA/)).toHaveLength(0)
    cleanup()
    monter('redevable')
    expect(valider()).toHaveProperty('disabled', false)
    await act(async () => { valider().click() })
    expect(faux.appels).toHaveLength(1)
  })

  it('une ligne à 0 % d’un redevable sans article le signale ; avec son article, propose sa mention', () => {
    monter('redevable')
    fireEvent.change(tauxDeLaLigne(), { target: { value: '0' } })
    expect(screen.getByText(/Une ligne à 0 % : sur un dossier redevable, l’exonération se justifie par son article/)).toBeTruthy()
    cleanup()

    monter('redevable', 'cgi_261_4_1')
    expect(screen.queryAllByText(/manque aux mentions légales/)).toHaveLength(0)
    fireEvent.change(tauxDeLaLigne(), { target: { value: '0' } })
    expect(screen.queryAllByText(/l’exonération se justifie par son article/)).toHaveLength(0)
    expect(screen.getByText(/La mention « Exonération de TVA, art. 261, 4, 1° du CGI\. » manque aux mentions légales/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter la mention' }))
    expect(mentions()).toMatch(/^Exonération de TVA, art. 261, 4, 1° du CGI\.\n/)
    expect(screen.queryAllByText(/manque aux mentions légales/)).toHaveLength(0)
  })

  it('une mention effacée se propose de nouveau, et la franchise citée hors de son statut se signale', () => {
    monter('exonere', 'cgi_261_4_1')
    fireEvent.change(document.querySelector('#mentions')!, { target: { value: 'TVA non applicable, art. 293 B du CGI.' } })
    expect(screen.getByText(/La mention « Exonération de TVA, art. 261, 4, 1° du CGI\. » manque aux mentions légales/)).toBeTruthy()
    expect(screen.getByText(/Les mentions citent la franchise en base/)).toBeTruthy()
  })

  it('un statut à préciser, ou un exonéré sans article, le dit sous les mentions', () => {
    monter(null)
    expect(screen.getByText(/Le statut de TVA du dossier est à préciser/)).toBeTruthy()
    cleanup()
    monter('exonere', null)
    expect(screen.getByText(/Le dossier est exonéré sans article d’exonération/)).toBeTruthy()
    expect(screen.queryAllByText(/Les mentions citent la franchise en base/)).toHaveLength(0)
  })
})

// LES MENTIONS DE LA FACTURE ÉLECTRONIQUE (ligne 28.5, étape c4 ; lib/mentionsFacture.ts). Elles vivaient en base depuis
// le premier temps, et aucun écran ne les saisissait : une facture à une entreprise se validait sans son SIREN ni la
// catégorie de l'opération, puis ne pouvait plus partir par une plateforme — une facture validée ne se corrige que par
// un avoir.
describe('FactureFormModal — les mentions de la facture électronique', () => {
  afterEach(() => { vi.restoreAllMocks() })

  const champ = (id: string) => document.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement | null
  const saisir = (id: string, value: string) => fireEvent.change(champ(id)!, { target: { value } })
  const enregistrerBrouillon = () => screen.getByRole('button', { name: 'Enregistrer le brouillon' })
  const facture = () => (faux.appels[0].args as { p_facture: Record<string, unknown> }).p_facture

  // Tout ce qu'une facture à une entreprise doit porter pour partir : l'émetteur, le client, l'échéance, la catégorie.
  function completerPourUneEntreprise() {
    saisir('emetteur-adresse', '12 rue des Exemples\n13001 Marseille')
    saisir('type-client', 'assujetti')
    saisir('tiers-siren', SIREN_CLIENT)
    saisir('tiers-adresse', '5 avenue du Port\n13002 Marseille')
    saisir('date-echeance', '2099-12-31')
    saisir('nature-operation', 'services')
    // Le prix de la ligne : une facture à zéro ne part pas.
    fireEvent.change(document.querySelectorAll('tbody input')[2]!, { target: { value: '100' } })
  }

  it('une facture à une entreprise envoie ses mentions, et rien de ce que ses choix ferment', async () => {
    monter('redevable')
    saisir('type-client', 'assujetti')
    saisir('tiers-siren', SIREN_CLIENT)
    saisir('tiers-adresse-electronique', `${SIREN_CLIENT}_FACTURES`)
    saisir('nature-operation', 'services')
    saisir('prestation', 'periode')
    saisir('periode-debut', '2026-09-01')
    saisir('periode-fin', '2026-09-30')
    expect(champ('code-service')).toBeNull()
    expect(champ('livraison-ailleurs')).toBeNull()
    await act(async () => { enregistrerBrouillon().click() })
    expect(facture()).toMatchObject({
      type_client: 'assujetti', tiers_siren: SIREN_CLIENT, tiers_adresse_electronique: `${SIREN_CLIENT}_FACTURES`,
      nature_operation: 'services', date_prestation: null, periode_debut: '2026-09-01', periode_fin: '2026-09-30',
      code_service: null, numero_engagement: null, livraison_adresse: null, livraison_pays: null,
    })
    // L'option pour les débits ne se saisit pas : la base la fige à la validation.
    expect(facture()).not.toHaveProperty('option_debits')
  })

  it('passer d’un organisme public à une entreprise efface le code service, dans la même écriture', async () => {
    monter('redevable')
    saisir('type-client', 'organisme_public')
    saisir('code-service', 'SERVICE-ACHATS')
    saisir('numero-engagement', 'EJ-42')
    saisir('type-client', 'assujetti')
    expect(champ('code-service')).toBeNull()
    await act(async () => { enregistrerBrouillon().click() })
    expect(facture()).toMatchObject({ type_client: 'assujetti', code_service: null, numero_engagement: null })
  })

  it('un SIRET saisi donne son SIREN et s’enregistre sans ses espaces ; un SIREN saisi à la main reste', async () => {
    monter('redevable')
    saisir('type-client', 'assujetti')
    saisir('tiers-siret', '987 654 324 00019')
    expect(champ('tiers-siren')!.value).toBe(SIREN_CLIENT)
    await act(async () => { enregistrerBrouillon().click() })
    expect(facture()).toMatchObject({ tiers_siret: SIRET_CLIENT, tiers_siren: SIREN_CLIENT })
    cleanup()

    monter('redevable')
    saisir('tiers-siren', '123456782')
    saisir('tiers-siret', SIRET_CLIENT)
    expect(champ('tiers-siren')!.value).toBe('123456782')
  })

  it('ce que la base refuserait se dit avant le clic, et rien ne part', async () => {
    monter('redevable')
    saisir('tiers-siren', '98765432')
    expect(screen.getByRole('alert').textContent).toContain('Le SIREN du client s’écrit en neuf chiffres.')
    expect(enregistrerBrouillon()).toHaveProperty('disabled', true)
    expect(valider()).toHaveProperty('disabled', true)
    await act(async () => { enregistrerBrouillon().click(); valider().click() })
    expect(faux.appels).toHaveLength(0)
    // Et l'encart de la transmission se tait : il y a d'abord cela à corriger.
    expect(screen.queryByText('Pour partir par une plateforme agréée')).toBeNull()
  })

  it('une facture à une entreprise qui ne pourrait pas partir le dit, et sa validation se confirme', async () => {
    monter('redevable', null, { dossierSiret: SIRET_VENDEUR })
    completerPourUneEntreprise()
    saisir('tiers-siren', '')
    expect(screen.getByText('Pour partir par une plateforme agréée')).toBeTruthy()
    expect(screen.getByText(/Le SIREN du client manque/)).toBeTruthy()

    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => { valider().click() })
    expect(confirmation).toHaveBeenCalledTimes(1)
    expect(confirmation.mock.calls[0][0]).toMatch(/ne pourra pas partir par une plateforme agréée — un point à compléter : Le SIREN du client manque/)
    expect(confirmation.mock.calls[0][0]).toContain('ne se corrige plus que par un avoir')
    expect(faux.appels).toHaveLength(0)

    confirmation.mockReturnValue(true)
    await act(async () => { valider().click() })
    expect(faux.appels).toHaveLength(1)
    expect(faux.appels[0].args.p_valider).toBe(true)
  })

  it('une facture complète à une entreprise se valide sans confirmation, et l’écran le dit', async () => {
    monter('redevable', null, { dossierSiret: SIRET_VENDEUR })
    completerPourUneEntreprise()
    expect(screen.getByText(/Rien n’empêchera cette facture, une fois validée, de partir/)).toBeTruthy()
    const confirmation = vi.spyOn(window, 'confirm')
    await act(async () => { valider().click() })
    expect(confirmation).not.toHaveBeenCalled()
    expect(faux.appels).toHaveLength(1)
  })

  // La case du numéro de TVA (décision du cabinet du 08/10/2026) : le formulaire juge comme les fonctions.
  it('un dossier en franchise : sans numéro de TVA, le refus dit où le cocher ; avec, la facture partira', () => {
    monter('franchise', null, { dossierSiret: SIRET_VENDEUR })
    completerPourUneEntreprise()
    expect(screen.getByText(/sa case se coche dans l’onglet TVA du dossier, sous son statut de TVA/)).toBeTruthy()
    cleanup()

    monter('franchise', null, { dossierSiret: SIRET_VENDEUR, numeroTvaAttribue: true })
    completerPourUneEntreprise()
    expect(screen.getByText(/Rien n’empêchera cette facture, une fois validée, de partir/)).toBeTruthy()
    expect(screen.queryByText(/règle G1\.47/)).toBeNull()
  })

  it('un particulier : l’e-reporting, sans encart ni confirmation ; à préciser : la question d’abord', async () => {
    monter('redevable')
    expect(screen.getByText(/Dis à qui la facture est adressée/)).toBeTruthy()
    saisir('type-client', 'non_assujetti')
    expect(screen.getByText(/ne passe pas par une plateforme agréée : l’opération se déclarera par l’e-reporting/)).toBeTruthy()
    expect(screen.queryByText('Pour partir par une plateforme agréée')).toBeNull()
    const confirmation = vi.spyOn(window, 'confirm')
    await act(async () => { valider().click() })
    expect(confirmation).not.toHaveBeenCalled()
    expect(faux.appels).toHaveLength(1)
  })

  it('l’option pour les débits se dit sur des services d’un redevable qui l’a prise, pas sur des biens', () => {
    monter('redevable', null, { tvaSurDebits: true })
    saisir('nature-operation', 'services')
    expect(screen.getByText(/portera l’option pour le paiement de la TVA d’après les débits/)).toBeTruthy()
    saisir('nature-operation', 'biens')
    expect(screen.queryByText(/portera l’option pour le paiement de la TVA d’après les débits/)).toBeNull()
    cleanup()
    monter('franchise', null, { tvaSurDebits: true })
    saisir('nature-operation', 'services')
    expect(screen.queryByText(/portera l’option pour le paiement de la TVA d’après les débits/)).toBeNull()
  })

  it('une livraison ailleurs demande ses quatre champs, et part en majuscules', async () => {
    monter('redevable')
    saisir('nature-operation', 'biens')
    fireEvent.click(champ('livraison-ailleurs')!)
    expect(screen.getByRole('alert').textContent).toContain('L’adresse de livraison demande la voie, le code postal, la ville et le pays.')
    saisir('livraison-adresse', '3 quai des Essais')
    saisir('livraison-code-postal', '1000')
    saisir('livraison-ville', 'Bruxelles')
    saisir('livraison-pays', 'be')
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => { enregistrerBrouillon().click() })
    expect(facture()).toMatchObject({
      livraison_adresse: '3 quai des Essais', livraison_code_postal: '1000', livraison_ville: 'Bruxelles', livraison_pays: 'BE',
    })
  })

  it('un brouillon rouvert garde ses mentions, et les renvoie', async () => {
    faux.lignes = [{ id: 'l1', facture_id: 'f1', ordre: 0, designation: 'Prestation', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }]
    const brouillon: FactureEmise = {
      id: 'f1', dossier_id: 'd1', numero: null, statut: 'brouillon', type: 'facture', facture_origine_id: null,
      date_emission: '2026-09-15', date_echeance: null, tiers_nom: 'Mairie Fictive', tiers_adresse: null, tiers_siret: null,
      montant_ht: 100, montant_tva: 20, montant_ttc: 120, mentions_legales: null, notes: null, emetteur_nom: null,
      emetteur_siret: null, emetteur_adresse: null, superpdp_invoice_id: null, superpdp_dernier_statut: null, tiers_email: null,
      created_by: null, created_at: '2026-09-15T08:00:00Z', validated_at: null,
      ...MENTIONS_VIDES, type_client: 'organisme_public', code_service: 'SERVICE-ACHATS', nature_operation: 'mixte',
      date_prestation: '2026-09-12',
    }
    monter('redevable', null, { facture: brouillon })
    expect(await screen.findByDisplayValue('SERVICE-ACHATS')).toBeTruthy()
    expect(champ('type-client')!.value).toBe('organisme_public')
    expect(champ('prestation')!.value).toBe('date')
    expect(champ('date-prestation')!.value).toBe('2026-09-12')
    await act(async () => { enregistrerBrouillon().click() })
    expect(facture()).toMatchObject({ type_client: 'organisme_public', code_service: 'SERVICE-ACHATS', nature_operation: 'mixte', date_prestation: '2026-09-12' })
    faux.lignes = []
  })
})

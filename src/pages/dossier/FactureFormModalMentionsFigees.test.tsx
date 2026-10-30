import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FactureFormModal from './FactureFormModal'
import { NON_BASCULE } from '../../test/factures'
import { article } from '../../test/articles'
import { contact } from '../../test/contacts'
import { versionParametres } from '../../test/parametresFacturation'
import { AUTRE_IBAN_ESSAI, BIC_ESSAI, IBAN_ESSAI, factureFigee, identiteDuDossier } from '../../test/mentionsFigees'
import { SIRET_VENDEUR, TVA_VENDEUR } from '../../test/facturesCii'
import { REFUS_DE_LA_PROVENANCE, REFUS_DE_LA_VALIDATION_FIGEE } from '../../lib/mentionsFigees'
import { AVIS_SANS_FORME, RETENUE_EN_LECTURE } from '../../lib/mentionsFigeesVue'
import { MODELE_IBAN_DANS_UN_TEXTE } from '../../lib/parametresFacturation'
import { motsDuCabinet } from '../../lib/espaceVentes'
import type { EspaceVentes } from '../../lib/espaceVentes'
import type { FactureEmise } from '../../lib/types'

// LA FACTURE FIGE SES MENTIONS, À L'ÉCRAN — LE FORMULAIRE (espace client, étape A7b ; lib/mentionsFigeesVue.ts), monté pour le
// cabinet et pour le client « Ventes », drapeau `MENTIONS_FIGEES_EXPORTEES` LEVÉ (l'état d'avant se joue dans les autres
// fichiers du formulaire, sous `vi.mock`). Un faux client qui applique les filtres ; ce que ces cas gardent, et qu'aucun calcul
// pur ne voit :
//  1. les clés neuves PARTENT : l'unité, la référence (sans les blancs de ses bords), la nature et l'article de chaque ligne, le
//     contact d'où vient le client — un article les apporte, modifiables ; un brouillon rouvert les retrouve ;
//  2. les refus neufs se disent AVANT le clic, sur la saisie telle qu'elle part : la provenance et un IBAN dans un texte grisent
//     les deux boutons ; ceux de la validation figée, la validation seule ;
//  3. la validation ATTEND ce qu'elle lit : pas revenu, lu en partie ou refusé, l'écran le dit et ne l'offre pas ;
//  4. la confirmation NOMME ce que la facture figera et imprimera — le nom avec « EI », le numéro de TVA, le RIB confirmé ou
//     qu'il n'y en a pas, les conditions, le logo — et, refusée, rien ne part ;
//  5. dans « Mes ventes », l'émetteur est le dossier : montré, plus saisi ; un brouillon reprend l'adresse du dossier ;
//  6. le verrou, drapeau levé. Données FICTIVES (IBAN de test au code banque 99999).

const faux = vi.hoisted(() => ({
  identite: null as Record<string, unknown> | null,
  versions: [] as Record<string, unknown>[],
  versionsMuettesApres: Infinity,
  articles: [] as Record<string, unknown>[],
  contacts: [] as Record<string, unknown>[],
  lignes: [] as Record<string, unknown>[],
  rpcs: [] as { nom: string; params: Record<string, unknown> }[],
  retenirDossier: false,
  dossierEnAttente: [] as (() => void)[],
  retenirFacture: false,
  factureEnAttente: [] as (() => void)[],
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  return {
    supabase: {
      rpc: async (nom: string, params: Record<string, unknown>) => {
        faux.rpcs.push({ nom, params })
        if (nom !== 'enregistrer_facture') throw new Error(`Fonction non attendue dans ce test : ${nom}`)
        if (faux.retenirFacture) await new Promise<void>((r) => { faux.factureEnAttente.push(r) })
        return { data: [{ facture_id: 'f-neuve', numero: null }], error: null }
      },
      from: (table: string) => {
        const predicats: Predicat[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const source = (): Record<string, unknown>[] => {
          switch (table) {
            case 'articles': return faux.articles
            case 'contacts': return faux.contacts
            case 'parametres_facturation': return faux.versions
            case 'facture_lignes': return faux.lignes
            default: throw new Error(`Table non attendue dans ce test : ${table}`)
          }
        }
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          maybeSingle: async () => {
            if (table !== 'dossiers') throw new Error(`maybeSingle non attendu sur ${table}`)
            if (faux.retenirDossier) await new Promise<void>((r) => { faux.dossierEnAttente.push(r) })
            return { data: faux.identite ? filtrer([faux.identite], predicats)[0] ?? null : null, error: null }
          },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => Promise.resolve().then(() => {
            const toutes = filtrer(source(), predicats)
            const muet = table === 'parametres_facturation' ? faux.versionsMuettesApres : Infinity
            return { data: toutes.slice(debut, Math.min(fin + 1, toutes.length, muet)), error: null, count: toutes.length }
          }).then(suite, echec),
        })
        return c
      },
    },
  }
})

const nues = <T extends object>(l: readonly T[]) => l.map((x) => ({ ...x }) as Record<string, unknown>)
const RIB_CONFIRME = versionParametres({
  iban: IBAN_ESSAI, bic: BIC_ESSAI, titulaire_compte: 'CAMILLE ESSAI', rib_etat: 'confirme',
  escompte: 'Pas d’escompte pour paiement anticipé.',
})
const SEANCE = article({ id: 'a1', designation: 'Séance d’essai', reference: 'SEA-01', unite: 'HUR', nature: 'services', prix_unitaire_ht: 60, taux_tva: 0 })
const AUBERT = contact({ id: 'c1', nom: 'Aubert SAS' })

let confirmations: string[] = []
let reponseConfirmation = true

beforeEach(() => {
  faux.identite = { id: 'd1', ...identiteDuDossier() }
  faux.versions = nues([RIB_CONFIRME])
  faux.versionsMuettesApres = Infinity
  faux.articles = nues([SEANCE])
  faux.contacts = nues([AUBERT])
  faux.lignes = []
  faux.rpcs = []
  faux.retenirDossier = false
  faux.dossierEnAttente = []
  faux.retenirFacture = false
  faux.factureEnAttente = []
  confirmations = []
  reponseConfirmation = true
  vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { confirmations.push(m ?? ''); return reponseConfirmation })
})

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function monter(espace: EspaceVentes, o: { facture?: FactureEmise | null; dossierAdresse?: string | null; dossierSiret?: string | null } = {}) {
  const commun = {
    dossierId: 'd1', dossierNom: 'Nom interne du dossier', dossierSiret: o.dossierSiret === undefined ? SIRET_VENDEUR : o.dossierSiret,
    dossierAdresse: o.dossierAdresse === undefined ? '1 rue des Essais\n69000 Lyon' : o.dossierAdresse,
    statutTva: 'redevable' as const, articleExoneration: null, numeroTvaAttribue: false, tvaSurDebits: false,
    reglageDesVentes: NON_BASCULE, facture: o.facture ?? null, onClose: () => {}, onSaved: () => {},
  }
  render(espace === 'cabinet'
    ? <FactureFormModal espace="cabinet" onAdresseUpdated={() => {}} {...commun} />
    : <FactureFormModal espace="client" {...commun} />)
}

const ligneDuFormulaire = (i = 0) => document.querySelectorAll('tbody tr')[i] as HTMLElement
const designation = (i = 0) => ligneDuFormulaire(i).querySelector('input') as HTMLInputElement
const champ = (nom: string, i = 0) => screen.getByLabelText(`${nom}, ligne ${i + 1}`) as HTMLInputElement | HTMLSelectElement
const valider = () => screen.getByRole('button', { name: 'Valider la facture' }) as HTMLButtonElement
const brouillon = () => screen.getByRole('button', { name: 'Enregistrer le brouillon' }) as HTMLButtonElement
const envoi = () => faux.rpcs.filter((r) => r.nom === 'enregistrer_facture').at(-1)!.params

async function remplir() {
  // Ce que la validation lit est revenu : le formulaire ne retient plus la validation.
  await screen.findAllByRole('button', { name: /^Choisir un article, ligne/ })
  fireEvent.change(document.querySelector('#tiers-nom')!, { target: { value: 'Patient fictif' } })
  fireEvent.change(designation(), { target: { value: 'Séance' } })
  fireEvent.change(ligneDuFormulaire().querySelectorAll('input')[2], { target: { value: '60' } })
  await waitFor(() => expect(valider().disabled).toBe(false))
}

for (const espace of ['cabinet', 'client'] as const) {
  describe(`le formulaire d’une facture qui fige ses mentions (${espace})`, () => {
    it('une ligne saisie à la main choisit son unité, sa référence et sa nature ; elles partent, la référence sans ses blancs', async () => {
      monter(espace)
      await remplir()
      fireEvent.change(champ('Unité'), { target: { value: 'DAY' } })
      fireEvent.change(champ('Référence'), { target: { value: '  JOUR-1 ' } })
      fireEvent.change(champ('Nature'), { target: { value: 'services' } })
      await act(async () => { brouillon().click() })
      expect(envoi().p_lignes).toEqual([{
        designation: 'Séance', quantite: 1, prix_unitaire_ht: 60, taux_tva: 20, unite: 'DAY', reference: 'JOUR-1', nature: 'services', article_id: null,
      }])
      expect((envoi().p_facture as Record<string, unknown>).contact_id).toBeNull()
      expect(envoi().p_valider).toBe(false)
    })

    it('un article apporte son unité, sa référence et sa nature, modifiables, et la ligne part avec lui', async () => {
      monter(espace)
      await remplir()
      fireEvent.click(screen.getByRole('button', { name: 'Choisir un article, ligne 1' }))
      const fenetre = await screen.findByRole('dialog', { name: 'Choisir un article' })
      fireEvent.click(within(fenetre).getByRole('button', { name: /Séance d’essai/ }))
      // La ligne déjà saisie se remplace après la confirmation qui nomme ce qui part.
      const remplacer = screen.queryByRole('button', { name: 'Remplacer' })
      if (remplacer) fireEvent.click(remplacer)
      expect(champ('Unité').value).toBe('HUR')
      expect(champ('Référence').value).toBe('SEA-01')
      expect(champ('Nature').value).toBe('services')
      fireEvent.change(champ('Unité'), { target: { value: 'LS' } })
      await act(async () => { brouillon().click() })
      expect(envoi().p_lignes).toEqual([expect.objectContaining({ unite: 'LS', reference: 'SEA-01', nature: 'services', article_id: 'a1' })])
    })

    it('le contact d’où vient le client part avec la facture', async () => {
      monter(espace)
      await remplir()
      fireEvent.click(screen.getByRole('button', { name: 'Choisir un client' }))
      const fenetre = await screen.findByRole('dialog', { name: 'Choisir un client' })
      fireEvent.click(within(fenetre).getByRole('button', { name: /Aubert SAS/ }))
      const remplacer = screen.queryByRole('button', { name: 'Remplacer' })
      if (remplacer) fireEvent.click(remplacer)
      await act(async () => { brouillon().click() })
      expect((envoi().p_facture as Record<string, unknown>).contact_id).toBe('c1')
    })

    it('la confirmation NOMME ce que la facture figera et imprimera ; refusée, rien ne part ; acceptée, la validation part', async () => {
      monter(espace)
      await remplir()
      reponseConfirmation = false
      await act(async () => { valider().click() })
      expect(faux.rpcs).toEqual([])
      const texte = confirmations[0]
      expect(texte).toMatch(/^Validée, la facture figera et imprimera :/)
      expect(texte).toContain('– le nom « Camille Essai EI »')
      expect(texte).toContain(`– le numéro de TVA ${TVA_VENDEUR}`)
      expect(texte).toContain('– le RIB FR76 9999 9000 0100 0000 0000 600, BIC ESSAFR10, au nom de CAMILLE ESSAI')
      expect(texte).toContain('– les conditions de paiement (moyen préféré : virement ; escompte : « Pas d’escompte pour paiement anticipé. »)')
      expect(texte).toContain('– aucun logo')
      if (espace === 'client') expect(motsDuCabinet(texte)).toEqual([])
      reponseConfirmation = true
      await act(async () => { valider().click() })
      expect(envoi().p_valider).toBe(true)
    })

    it('une facture qui ne pourrait pas partir : UNE confirmation, ce qu’on perd d’abord, puis ce qui se fige, puis la question', async () => {
      monter(espace)
      await remplir()
      // Une entreprise sans SIREN : la plateforme ne la recevrait pas.
      fireEvent.change(document.querySelector('#type-client')!, { target: { value: 'assujetti' } })
      reponseConfirmation = false
      await act(async () => { valider().click() })
      expect(confirmations).toHaveLength(1)
      const texte = confirmations[0]
      const perte = texte.indexOf('ne pourra pas partir par une plateforme agréée')
      const fige = texte.indexOf('Validée, la facture figera et imprimera :')
      expect(perte).toBeGreaterThan(-1)
      expect(fige).toBeGreaterThan(perte)
      expect(texte.endsWith('La valider quand même ?')).toBe(true)
    })

    it('un RIB seulement proposé : « aucun RIB confirmé : la facture n’en imprimera pas »', async () => {
      faux.versions = nues([versionParametres({ iban: AUTRE_IBAN_ESSAI, rib_etat: 'propose' })])
      monter(espace)
      await remplir()
      reponseConfirmation = false
      await act(async () => { valider().click() })
      expect(confirmations[0]).toContain('– aucun RIB confirmé : la facture n’en imprimera pas')
      expect(confirmations[0]).not.toContain('FR60')
    })

    it('avant que ce qu’elle lit revienne, la validation n’est pas offerte et l’écran le dit ; le brouillon s’enregistre', async () => {
      faux.retenirDossier = true
      monter(espace)
      await screen.findAllByRole('button', { name: /^Choisir un article, ligne/ })
      fireEvent.change(document.querySelector('#tiers-nom')!, { target: { value: 'Patient fictif' } })
      fireEvent.change(designation(), { target: { value: 'Séance' } })
      expect(screen.getByText(RETENUE_EN_LECTURE)).toBeTruthy()
      expect(valider().disabled).toBe(true)
      // Seconde ceinture : un clic forcé ne valide rien.
      await act(async () => { fireEvent.click(valider()) })
      expect(faux.rpcs).toEqual([])
      expect(brouillon().disabled).toBe(false)
      await act(async () => { faux.dossierEnAttente.forEach((r) => r()) })
      await waitFor(() => expect(valider().disabled).toBe(false))
    })

    it('des paramètres lus en partie : l’écran le dit, la validation n’est pas offerte', async () => {
      faux.versions = nues([versionParametres({ id: 'v1' }), versionParametres({ id: 'v2', remplace_id: 'v1' })])
      faux.versionsMuettesApres = 1
      monter(espace)
      await screen.findAllByRole('button', { name: /^Choisir un article, ligne/ })
      fireEvent.change(document.querySelector('#tiers-nom')!, { target: { value: 'Patient fictif' } })
      fireEvent.change(designation(), { target: { value: 'Séance' } })
      expect(await screen.findByText(/n’a pas pu être lu entier \(les paramètres de facturation ne sont lus qu’en partie/)).toBeTruthy()
      expect(valider().disabled).toBe(true)
      expect(brouillon().disabled).toBe(false)
    })

    it('un IBAN dans la désignation d’une ligne : dit avant le clic, et rien ne part — ni brouillon, ni validation', async () => {
      monter(espace)
      await remplir()
      fireEvent.change(designation(), { target: { value: `Séance — virement au ${IBAN_ESSAI}` } })
      expect(screen.getByText(MODELE_IBAN_DANS_UN_TEXTE.replace('%', 'la désignation de la ligne 1'))).toBeTruthy()
      expect(brouillon().disabled).toBe(true)
      expect(valider().disabled).toBe(true)
    })

    it('une référence de plus de cent caractères : refusée avant le clic, sous les mots de la base', async () => {
      monter(espace)
      await remplir()
      fireEvent.change(champ('Référence'), { target: { value: 'R'.repeat(101) } })
      const refus = REFUS_DE_LA_PROVENANCE.find((r) => r.cle === 'reference')!.modele.replace('%', '1')
      expect(screen.getByText(refus)).toBeTruthy()
      expect(brouillon().disabled).toBe(true)
    })

    it('l’entrepreneur individuel sans « EI » : la validation refusée pour TOUT auteur, avant le clic ; le brouillon passe', async () => {
      faux.identite = { id: 'd1', ...identiteDuDossier({ denomination_imprimee: 'Camille Essai' }) }
      monter(espace)
      await screen.findAllByRole('button', { name: /^Choisir un article, ligne/ })
      fireEvent.change(document.querySelector('#tiers-nom')!, { target: { value: 'Patient fictif' } })
      fireEvent.change(designation(), { target: { value: 'Séance' } })
      const refus = REFUS_DE_LA_VALIDATION_FIGEE.find((r) => r.cle === 'entrepreneur_individuel')!.modele
      expect(await screen.findByText(refus)).toBeTruthy()
      expect(valider().disabled).toBe(true)
      expect(brouillon().disabled).toBe(false)
    })

    it('un brouillon rouvert retrouve l’unité, la référence, la nature et l’article de ses lignes, et le contact de son client', async () => {
      faux.lignes = [{ id: 'l1', facture_id: 'b1', ordre: 0, designation: 'Séance d’essai', quantite: 1, prix_unitaire_ht: 60, taux_tva: 20, unite: 'HUR', reference: 'SEA-01', nature: 'services', article_id: 'a1' }]
      monter(espace, { facture: factureFigee({ id: 'b1', statut: 'brouillon', numero: null, mentions_figees: false, contact_id: 'c1', emetteur_adresse: '1 rue des Essais\n69000 Lyon' }) })
      await screen.findAllByRole('button', { name: /^Choisir un article, ligne/ })
      expect(champ('Référence').value).toBe('SEA-01')
      expect(screen.getByText(/Article : SEA-01 — Séance d’essai/)).toBeTruthy()
      await act(async () => { brouillon().click() })
      expect(envoi().p_lignes).toEqual([expect.objectContaining({ unite: 'HUR', reference: 'SEA-01', nature: 'services', article_id: 'a1' })])
      expect((envoi().p_facture as Record<string, unknown>).contact_id).toBe('c1')
    })

    it('le verrou, drapeau levé : deux puis trois clics du même rendu, une seule validation', async () => {
      faux.retenirFacture = true
      monter(espace)
      await remplir()
      const bouton = valider()
      await act(async () => { bouton.click(); bouton.click(); bouton.click() })
      expect(faux.rpcs.filter((r) => r.nom === 'enregistrer_facture')).toHaveLength(1)
      await act(async () => { faux.factureEnAttente.forEach((r) => r()) })
    })
  })
}

describe('« Mes ventes » : l’émetteur est le dossier, et le client ne valide que ce que le cabinet a réglé', () => {
  it('l’adresse de l’émetteur est montrée, plus saisie ; un brouillon reprend celle du dossier', async () => {
    faux.lignes = [{ id: 'l1', facture_id: 'b1', ordre: 0, designation: 'Séance', quantite: 1, prix_unitaire_ht: 60, taux_tva: 20 }]
    monter('client', { facture: factureFigee({ id: 'b1', statut: 'brouillon', numero: null, mentions_figees: false, emetteur_adresse: 'Ancienne adresse' }) })
    await screen.findAllByRole('button', { name: /^Choisir un article, ligne/ })
    expect(document.querySelector('#emetteur-adresse')).toBeNull()
    expect(screen.getByText('Émetteur')).toBeTruthy()
    await act(async () => { brouillon().click() })
    expect((envoi().p_facture as Record<string, unknown>).emetteur_adresse).toBe('1 rue des Essais\n69000 Lyon')
    expect((envoi().p_facture as Record<string, unknown>).emetteur_siret).toBe(SIRET_VENDEUR)
  })

  it('un dossier sans adresse : la phrase dit que le cabinet doit l’enregistrer, le brouillon passe, la validation est refusée', async () => {
    faux.identite = { id: 'd1', ...identiteDuDossier({ adresse: null }) }
    monter('client', { dossierAdresse: null })
    await remplirSansAttendre()
    expect(screen.getByText(/Ton cabinet n’a pas encore enregistré l’adresse de ta société : ton brouillon s’enregistre/)).toBeTruthy()
    expect(screen.queryByText(/saisis-la ici/)).toBeNull()
    const refus = REFUS_DE_LA_VALIDATION_FIGEE.find((r) => r.cle === 'adresse_a_poser')!.modele
    expect(await screen.findByText(refus)).toBeTruthy()
    expect(valider().disabled).toBe(true)
    expect(brouillon().disabled).toBe(false)
  })

  it('sans forme juridique : refusée au client ; au cabinet, offerte, et l’écran le lui dit', async () => {
    faux.identite = { id: 'd1', ...identiteDuDossier({ forme_juridique: null, denomination_imprimee: 'Société Essai' }) }
    monter('client')
    await remplirSansAttendre()
    expect(await screen.findByText(REFUS_DE_LA_VALIDATION_FIGEE.find((r) => r.cle === 'forme_a_regler')!.modele)).toBeTruthy()
    expect(valider().disabled).toBe(true)
    cleanup()
    monter('cabinet')
    await remplir()
    expect(screen.getByText(AVIS_SANS_FORME)).toBeTruthy()
    expect(valider().disabled).toBe(false)
  })

  it('le SIRET et l’adresse du dossier changés depuis la lecture de la page : refusés avant le clic', async () => {
    faux.identite = { id: 'd1', ...identiteDuDossier({ adresse: '9 rue nouvelle' }) }
    monter('client')
    await remplirSansAttendre()
    expect(await screen.findByText(REFUS_DE_LA_VALIDATION_FIGEE.find((r) => r.cle === 'adresse_du_dossier')!.modele)).toBeTruthy()
    expect(valider().disabled).toBe(true)
  })
})

async function remplirSansAttendre() {
  await screen.findAllByRole('button', { name: /^Choisir un article, ligne/ })
  fireEvent.change(document.querySelector('#tiers-nom')!, { target: { value: 'Patient fictif' } })
  fireEvent.change(designation(), { target: { value: 'Séance' } })
}

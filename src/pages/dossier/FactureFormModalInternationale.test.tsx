import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SANS_ACOMPTE } from '../../lib/acomptesDesFactures'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FactureFormModal from './FactureFormModal'
import { NON_BASCULE } from '../../test/factures'
import { article } from '../../test/articles'
import { contact } from '../../test/contacts'
import { versionParametres } from '../../test/parametresFacturation'
import { BIC_ESSAI, CABINET_DU_DOSSIER, IBAN_ESSAI, identiteDuDossier } from '../../test/mentionsFigees'
import { SIRET_VENDEUR } from '../../test/facturesCii'
import type { LectureDuMandataire } from '../../lib/mentionsFigeesVue'
import { motsDuCabinet } from '../../lib/espaceVentes'
import type { EspaceVentes } from '../../lib/espaceVentes'
import type { ArticleExoneration, FactureEmise, StatutTva } from '../../lib/types'
import { MENTIONS_DES_REGIMES, REFUS_DE_LA_FACTURE_INTERNATIONALE } from '../../lib/factureInternationale'

// LA FACTURE À UN CLIENT ÉTABLI HORS DE FRANCE, À L'ÉCRAN — LE FORMULAIRE (étape e7b ; lib/factureInternationaleVue.ts), monté
// pour le cabinet et pour le client « Ventes », le drapeau `FACTURE_INTERNATIONALE_EXPORTEE` joué par un accesseur, état par
// état (les mentions figées levées, comme en production ; le faux client est celui de FactureFormModalMentionsFigees.test.tsx).
// Ce que ces cas gardent, et qu'aucun calcul pur ne voit :
//  1. drapeau baissé, rien de neuf : aucun champ, aucune clé dans `p_facture` ;
//  2. levé, les trois colonnes PARTENT telles que la saisie les donne (capitales, sans blanc), et un refus du module se dit
//     AVANT le clic — la forme grise les deux boutons, la garde la validation seule ; un type qui ferme le bloc les remet à nul ;
//  3. la confirmation NOMME ce que la validation figera du client établi hors de France ;
//  4. le verrou. Données FICTIVES.
const drapeau = vi.hoisted(() => ({ leve: true }))
vi.mock('../../lib/factureInternationale', async (original) => {
  const vrai = await original<typeof import('../../lib/factureInternationale')>()
  return { ...vrai, get FACTURE_INTERNATIONALE_EXPORTEE() { return drapeau.leve } }
})

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
  // « Aujourd'hui » : les dates de ces jeux d'essai sont de novembre 2027, et la validation d'une facture refuse une date à venir
  // (rang 17 de la garde, dit avant le clic) : le jour de Paris est posé APRÈS elles. Seule `Date` est figée.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-11-20T10:00:00Z'))
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

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); drapeau.leve = true })

type Options = {
  facture?: FactureEmise | null; dossierAdresse?: string | null; dossierSiret?: string | null
  statutTva?: StatutTva; articleExoneration?: ArticleExoneration | null
  // Le nom du cabinet, tel que l'onglet l'a lu (P4) : lu par défaut ; `null` tant que la lecture n'est pas revenue.
  mandataire?: LectureDuMandataire | null
}

function formulaire(espace: EspaceVentes, o: Options = {}) {
  const mandataire = o.mandataire === undefined ? CABINET_DU_DOSSIER : o.mandataire
  const commun = {
    dossierId: 'd1', dossierNom: 'Nom interne du dossier', dossierSiret: o.dossierSiret === undefined ? SIRET_VENDEUR : o.dossierSiret,
    dossierAdresse: o.dossierAdresse === undefined ? '1 rue des Essais\n69000 Lyon' : o.dossierAdresse,
    statutTva: o.statutTva ?? 'redevable', articleExoneration: o.articleExoneration ?? null, numeroTvaAttribue: false, tvaSurDebits: false,
    reglageDesVentes: NON_BASCULE, facture: o.facture ?? null, onClose: () => {}, onSaved: () => {},
  }
  return espace === 'cabinet'
    ? <FactureFormModal acompte={SANS_ACOMPTE} modelesDeNumerotation={null} facturesDeLaSerie={[]} espace="cabinet" onAdresseUpdated={() => {}} mandataire={mandataire} {...commun} />
    : <FactureFormModal acompte={SANS_ACOMPTE} modelesDeNumerotation={null} facturesDeLaSerie={[]} espace="client" {...commun} />
}

function monter(espace: EspaceVentes, o: Options = {}) {
  return render(formulaire(espace, o))
}

const ligneDuFormulaire = (i = 0) => document.querySelectorAll('tbody tr')[i] as HTMLElement
const designation = (i = 0) => ligneDuFormulaire(i).querySelector('input') as HTMLInputElement
const valider = () => screen.getByRole('button', { name: 'Valider la facture' }) as HTMLButtonElement
const brouillon = () => screen.getByRole('button', { name: 'Enregistrer le brouillon' }) as HTMLButtonElement
const envoi = () => faux.rpcs.filter((r) => r.nom === 'enregistrer_facture').at(-1)!.params

async function remplirPourLEtranger() {
  await screen.findAllByRole('button', { name: /^Choisir un article, ligne/ })
  fireEvent.change(document.querySelector('#tiers-nom')!, { target: { value: 'Müller GmbH' } })
  fireEvent.change(document.querySelector('#tiers-adresse')!, { target: { value: 'Hauptstraße 1, 10115 Berlin' } })
  fireEvent.change(document.querySelector('#type-client')!, { target: { value: 'etranger' } })
  fireEvent.change(document.querySelector('#nature-operation')!, { target: { value: 'services' } })
  fireEvent.change(designation(), { target: { value: 'Conseil' } })
  fireEvent.change(ligneDuFormulaire().querySelectorAll('input')[2], { target: { value: '600' } })
}
const saisir = (selecteur: string, valeur: string) => fireEvent.change(document.querySelector(selecteur)!, { target: { value: valeur } })
const tauxDeLaLigne = () => ligneDuFormulaire().querySelectorAll('input')[3] as HTMLInputElement
const LU = 'une autoliquidation par le client'

for (const espace of ['cabinet', 'client'] as const) {
  describe(`le client établi hors de France, dans le formulaire (${espace})`, () => {
    it('drapeau baissé : aucun champ, aucune clé neuve — le formulaire d’hier', async () => {
      drapeau.leve = false
      monter(espace)
      await remplirPourLEtranger()
      expect(document.querySelector('#client-pays')).toBeNull()
      expect(document.querySelector('#regime-international')).toBeNull()
      await act(async () => { brouillon().click() })
      const p = envoi().p_facture as Record<string, unknown>
      expect(p).not.toHaveProperty('client_pays')
      expect(p).not.toHaveProperty('client_numero_tva')
      expect(p).not.toHaveProperty('regime_international')
    })

    it('levé : le refus de la garde se dit avant le clic et grise la validation seule ; corrigé, les trois colonnes partent', async () => {
      monter(espace)
      await remplirPourLEtranger()
      saisir('#client-pays', 'de')
      saisir('#client-numero-tva', 'de 123 456 789')
      saisir('#regime-international', 'autoliquidation_ue')
      expect(screen.getByText(`La facture imprimera « ${MENTIONS_DES_REGIMES.autoliquidation_ue} »`)).toBeTruthy()
      // La ligne neuve d'un redevable est à 20 % : une autoliquidation ne porte pas de TVA française.
      const refus = REFUS_DE_LA_FACTURE_INTERNATIONALE[15].replace('%', LU)
      await waitFor(() => expect(screen.getByText(refus)).toBeTruthy())
      expect(valider().disabled).toBe(true)
      expect(brouillon().disabled).toBe(false)
      fireEvent.change(tauxDeLaLigne(), { target: { value: '0' } })
      await waitFor(() => expect(valider().disabled).toBe(false))
      expect(screen.queryByText(refus)).toBeNull()
      reponseConfirmation = false
      await act(async () => { valider().click() })
      expect(faux.rpcs).toEqual([])
      expect(confirmations[0]).toContain(
        `Elle figera aussi le pays du client, DE, son numéro de TVA, DE123456789, le régime de l'opération, ${LU}, sous la mention « ${MENTIONS_DES_REGIMES.autoliquidation_ue} ».`)
      if (espace === 'client') expect(motsDuCabinet(confirmations[0])).toEqual([])
      reponseConfirmation = true
      await act(async () => { valider().click() })
      expect(envoi().p_facture).toEqual(expect.objectContaining({
        type_client: 'etranger', client_pays: 'DE', client_numero_tva: 'DE123456789', regime_international: 'autoliquidation_ue',
      }))
      expect(envoi().p_valider).toBe(true)
    })

    it('levé : la forme refuse les deux boutons ; un type qui ferme le bloc remet les trois colonnes à nul', async () => {
      monter(espace)
      await remplirPourLEtranger()
      saisir('#client-pays', 'FR')
      await waitFor(() => expect(screen.getAllByText(/^Le pays du client s'écrit en deux capitales/).length).toBeGreaterThan(0))
      expect(brouillon().disabled).toBe(true)
      expect(valider().disabled).toBe(true)
      saisir('#type-client', 'assujetti')
      await waitFor(() => expect(brouillon().disabled).toBe(false))
      expect(document.querySelector('#client-pays')).toBeNull()
      await act(async () => { brouillon().click() })
      expect(envoi().p_facture).toEqual(expect.objectContaining({ client_pays: null, client_numero_tva: null, regime_international: null }))
    })

    it('levé : le verrou — trois clics du même rendu, une seule validation', async () => {
      faux.retenirFacture = true
      monter(espace)
      await remplirPourLEtranger()
      saisir('#client-pays', 'CH')
      saisir('#regime-international', 'prestation_hors_ue')
      fireEvent.change(tauxDeLaLigne(), { target: { value: '0' } })
      await waitFor(() => expect(valider().disabled).toBe(false))
      const bouton = valider()
      await act(async () => { bouton.click(); bouton.click(); bouton.click() })
      expect(faux.rpcs.filter((r) => r.nom === 'enregistrer_facture')).toHaveLength(1)
      await act(async () => { faux.factureEnAttente.forEach((r) => r()) })
    })
  })
}

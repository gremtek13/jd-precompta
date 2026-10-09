// @vitest-environment jsdom
// Le message du statut « Encaissée » (cdarEncaissee.ts). Les encaissements sont FICTIFS (src/test/cdarEncaissee.ts).
//
// CHAQUE DONNÉE DU MESSAGE EST CONFRONTÉE À LA SOURCE QUI LA FONDE : son chemin tel que l'annexe 2 des spécifications
// externes de la DGFiP l'écrit (v2.3 du 30/04/2026, onglet « CDV FE - CI ARM », colonne I), recopié ici, et la règle de
// l'annexe 7 (v1.9, onglet « Règles de gestion ») citée en commentaire. LA FORME EST JUGÉE PAR L'INSTRUMENT : chaque
// exemple figé dans outils/facturation/cdar/exemples/ a passé le schéma CDAR D22B de l'UN/CEFACT
// (outils/facturation/cdar/valider.mjs, qui écrit valides.json), et le dernier test refuse un exemple dont l'empreinte
// n'y figure pas — un exemple qui change repasse au validateur avant de partir. jsdom : la relecture passe par
// l'analyseur XML du navigateur.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AUTRE_PLATEFORME, choixCdar, donneesCdar, encaissementCdar, EXEMPLES_CDAR, factureCdar, ligneCdar, NOM_VENDEUR_CDAR,
  partCdar, PLATEFORME, PLATEFORME_ADMINISTRATION, SIREN_VENDEUR_CDAR, VENDEUR_SIREN, VENDEUR_SIRET,
} from '../test/cdarEncaissee'
import { SIRET_VENDEUR } from '../test/facturesCii'
import {
  CODE_MONTANT_ENCAISSE, CODE_STATUT_ENCAISSEE, FUSEAUX_CDAR, horodatage204, LIBELLE_STATUT_ENCAISSEE,
  LONGUEUR_MAX_MOTIF_CDAR, messageEncaissee, partieVendeur, PORTEURS_DATE_ENCAISSEMENT, PROFILS_CDAR,
  REFERENCE_CDV_FACTURE, refusMessageEncaissee, ROLES_PARTIE_CDAR, SCHEMAS_PARTIE_CDAR, TYPE_FACTURE_CDAR,
  type ChoixCdar, type DonneesCdar, type EncaissementPourCdar, type FacturePourCdar, type FuseauCdar,
  type LignePourCdar, type PartieCdar, type PartPourCdar, type PorteurDateEncaissement, type ProfilCdar,
} from './cdarEncaissee'
import { LONGUEUR_MAX_TEXTE } from './encaissementsFactures'
import { decimal, TAUX_ADMIS } from './factureCii'
import type { EncaissementFacture, EncaissementFactureTaux, FactureEmise, FactureLigne } from './types'

// Depuis la racine du dépôt, d'où la suite se lance : sous jsdom, import.meta.url n'est pas une adresse de fichier.
const DOSSIER_EXEMPLES = `${resolve(process.cwd(), 'outils/facturation/cdar/exemples')}/`

const NS: Record<string, string> = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossDomainAcknowledgementAndResponse:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
  qdt: 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
}

function xmlDe(d: DonneesCdar): string {
  const r = messageEncaissee(d)
  if (r.xml === null) throw new Error(`refusé : ${r.refus.join(' | ')}`)
  return r.xml
}

function lire(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('XML illisible')
  return doc
}

// Les valeurs qu'un chemin de l'annexe 2 désigne, depuis la racine du message ; un attribut s'écrit « /@format » ou,
// comme MDT-217-1, « @unitCode ». Les éléments sont cherchés par leur espace de noms, pas par leur préfixe.
function valeurs(doc: Document, chemin: string): string[] {
  const at = chemin.lastIndexOf('@')
  const attribut = at >= 0 ? chemin.slice(at + 1) : null
  const segments = (at >= 0 ? chemin.slice(0, at) : chemin).split('/').filter((s) => s !== '')
  let courants: Element[] = [doc.documentElement]
  for (const s of segments) {
    const [prefixe, local] = s.split(':')
    courants = courants.flatMap((e) => [...e.children].filter((x) => x.namespaceURI === NS[prefixe] && x.localName === local))
  }
  return courants.map((e) => (attribut ? e.getAttribute(attribut) ?? '' : e.textContent ?? ''))
}

const un = (doc: Document, chemin: string): string | undefined => {
  const v = valeurs(doc, chemin)
  expect(v, chemin).toHaveLength(1)
  return v[0]
}

const RRD = '/rsm:AcknowledgementDocument/ram:ReferenceReferencedDocument'
const STATUT = `${RRD}/ram:SpecifiedDocumentStatus`
const CARAC = `${STATUT}/ram:SpecifiedDocumentCharacteristic`

// Les refus du module, tels que l'écran les dira.
const RETIRE = 'Cet encaissement est retiré : il n’a jamais été déclaré, et ne se déclare plus.'
const AUTRE_FACTURE = 'Cet encaissement n’est pas un encaissement de cette facture.'
const NON_VALIDEE = 'Seul l’encaissement d’une facture validée se déclare.'
const AVOIR = 'Un avoir ne reçoit pas le statut « Encaissée » : seule une facture le reçoit.'
const SIREN_FAUX = 'Le SIRET du dossier, figé sur la facture, ne donne pas un SIREN valide (neuf chiffres et leur clé).'
const PAS_AU_CENTIME = 'Le montant de l’encaissement ne s’écrit pas au centime.'
const NUL = 'Un encaissement nul ne se déclare pas.'
const SIGNE = 'Le registre se contredit : un encaissement est positif, et seule une contre-passation est négative.'
const SANS_MOTIF = 'Une contre-passation porte son motif d’annulation : il manque.'
const MOTIF_LONG = 'Le motif de la contre-passation dépasse 2 000 caractères.'
const MOTIF_EN_TROP = 'Le registre se contredit : un encaissement ne porte pas de motif, seule une contre-passation en a un.'
const DATE_FAUSSE = 'La date de l’encaissement n’est pas une date.'
const SANS_PARTS = 'L’encaissement n’a pas de répartition par taux : la plateforme de l’administration rejetterait le statut.'
const IDENTIFIANT = 'L’identifiant du message est vide, dépasse 50 caractères ou porte un caractère que la plateforme n’admettrait pas.'
const MAINTENANT = 'L’instant du message n’est pas un instant.'
const RECEPTION = 'La réception de la facture par la plateforme n’est pas un instant.'
const RECUE_APRES = 'La plateforme aurait reçu la facture après le message de son statut.'
const RECUE_AVANT = 'La plateforme aurait reçu la facture avant sa date d’émission.'
const SANS_DESTINATAIRE = 'Le message n’a pas de destinataire.'

describe('les exemples', () => {
  it.each(EXEMPLES_CDAR)('$nom : aucun refus, et le XML est figé', async (e) => {
    expect(refusMessageEncaissee(e.donnees)).toEqual([])
    await expect(xmlDe(e.donnees)).toMatchFileSnapshot(`${DOSSIER_EXEMPLES}${e.nom}.xml`)
  })

  it.each(EXEMPLES_CDAR)('$nom : se relit, racine CrossDomainAcknowledgementAndResponse de l’espace de noms D22B', (e) => {
    const doc = lire(xmlDe(e.donnees))
    expect(doc.documentElement.localName).toBe('CrossDomainAcknowledgementAndResponse')
    expect(doc.documentElement.namespaceURI).toBe(NS.rsm)
  })
})

describe('chaque donnée du message, confrontée à la règle qui la fonde', () => {
  const doc = lire(xmlDe(donneesCdar()))

  it('MDT-3 : le profil choisi (S1.06 ; choix 1)', () => {
    expect(un(doc, '/rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID')).toBe('urn.cpro.gouv.fr:1p0:CDV:einvoicingF2')
  })

  it('MDT-4, MDT-5 : l’identifiant et le nom du message, requis', () => {
    expect(un(doc, '/rsm:ExchangedDocument/ram:ID')).toBe('0b6c7f0e-3a51-4c11-9d2e-5f0000000001')
    expect(un(doc, '/rsm:ExchangedDocument/ram:Name')).toBe('Statut Encaissée de la facture F2027-0042')
  })

  it('MDT-8 : la création du message, AAAAMMJJHHMMSS au format 204 (G7.06)', () => {
    expect(un(doc, '/rsm:ExchangedDocument/ram:IssueDateTime/udt:DateTimeString')).toBe('20271105093000')
    expect(un(doc, '/rsm:ExchangedDocument/ram:IssueDateTime/udt:DateTimeString/@format')).toBe('204')
  })

  it('MDG-9, MDG-16, MDG-23 : l’émetteur, le créateur et le destinataire choisis (G1.73, G7.01, G7.32 ; choix 2)', () => {
    expect(un(doc, '/rsm:ExchangedDocument/ram:SenderTradeParty/ram:GlobalID')).toBe(SIREN_VENDEUR_CDAR)
    expect(un(doc, '/rsm:ExchangedDocument/ram:SenderTradeParty/ram:GlobalID/@schemeID')).toBe('0002')
    expect(un(doc, '/rsm:ExchangedDocument/ram:SenderTradeParty/ram:Name')).toBe(NOM_VENDEUR_CDAR)
    expect(un(doc, '/rsm:ExchangedDocument/ram:SenderTradeParty/ram:RoleCode')).toBe('SE')
    expect(un(doc, '/rsm:ExchangedDocument/ram:IssuerTradeParty/ram:GlobalID')).toBe(SIREN_VENDEUR_CDAR)
    expect(un(doc, '/rsm:ExchangedDocument/ram:IssuerTradeParty/ram:GlobalID/@schemeID')).toBe('0002')
    expect(un(doc, '/rsm:ExchangedDocument/ram:IssuerTradeParty/ram:Name')).toBe(NOM_VENDEUR_CDAR)
    expect(un(doc, '/rsm:ExchangedDocument/ram:IssuerTradeParty/ram:RoleCode')).toBe('SE')
    // G7.32 : sur un objet métier, MDT-56, MDT-57 et MDT-59 sont renseignés ; G7.46 : une plateforme se passe de nom.
    expect(un(doc, '/rsm:ExchangedDocument/ram:RecipientTradeParty/ram:GlobalID')).toBe('9991')
    expect(un(doc, '/rsm:ExchangedDocument/ram:RecipientTradeParty/ram:GlobalID/@schemeID')).toBe('0238')
    expect(valeurs(doc, '/rsm:ExchangedDocument/ram:RecipientTradeParty/ram:Name')).toEqual([])
    expect(un(doc, '/rsm:ExchangedDocument/ram:RecipientTradeParty/ram:RoleCode')).toBe('WK')
  })

  it('MDT-74 : un seul objet métier — « false », la forme que le schéma admet du « False » de l’annexe (P1.14)', () => {
    expect(un(doc, '/rsm:AcknowledgementDocument/ram:MultipleReferencesIndicator/udt:Indicator')).toBe('false')
    // P1.14 : « le bloc MDG-32 doit donc être unique ».
    expect(valeurs(doc, RRD)).toHaveLength(1)
    expect(valeurs(doc, '/rsm:AcknowledgementDocument')).toHaveLength(1)
  })

  it('MDT-78 : la date et l’heure du statut, celles du message (G7.06)', () => {
    expect(un(doc, '/rsm:AcknowledgementDocument/ram:IssueDateTime/udt:DateTimeString')).toBe('20271105093000')
    expect(un(doc, '/rsm:AcknowledgementDocument/ram:IssueDateTime/udt:DateTimeString/@format')).toBe('204')
  })

  it('MDT-87, MDT-91 : le numéro de la facture (G7.23, G1.05) et son type, 380 (G7.15, G1.01)', () => {
    expect(un(doc, `${RRD}/ram:IssuerAssignedID`)).toBe('F2027-0042')
    expect(un(doc, `${RRD}/ram:TypeCode`)).toBe('380')
    expect(TYPE_FACTURE_CDAR).toBe('380')
  })

  it('MDT-95 : la réception de la facture par la plateforme, requise, au format 204 (G7.06)', () => {
    expect(un(doc, `${RRD}/ram:ReceiptDateTime/udt:DateTimeString`)).toBe('20271001091500')
    expect(un(doc, `${RRD}/ram:ReceiptDateTime/udt:DateTimeString/@format`)).toBe('204')
  })

  it('MDT-97 : le code d’un cycle de vie sur une facture (G7.14)', () => {
    expect(un(doc, `${RRD}/ram:ReferenceTypeCode`)).toBe('urn.cpro.gouv.fr:1p0:CDV:einvoicingF2')
    expect(REFERENCE_CDV_FACTURE).toBe('urn.cpro.gouv.fr:1p0:CDV:einvoicingF2')
  })

  it('MDT-100 : la date d’émission de la facture (G7.31), au format 204 de MDT-100-1, à minuit (G1.114)', () => {
    expect(un(doc, `${RRD}/ram:FormattedIssueDateTime/qdt:DateTimeString`)).toBe('20271001000000')
    expect(un(doc, `${RRD}/ram:FormattedIssueDateTime/qdt:DateTimeString/@format`)).toBe('204')
  })

  it('MDT-105, MDT-106 : 212, « Encaissée » (onglet « Statuts » ; G7.09, G7.44)', () => {
    expect(un(doc, `${RRD}/ram:ProcessConditionCode`)).toBe('212')
    expect(un(doc, `${RRD}/ram:ProcessCondition`)).toBe('Encaissée')
    expect([CODE_STATUT_ENCAISSEE, LIBELLE_STATUT_ENCAISSEE]).toEqual(['212', 'Encaissée'])
  })

  it('MDT-129, MDT-130 : le SIREN du vendeur, schéma 0002, une seule fois (G7.17)', () => {
    expect(valeurs(doc, `${RRD}/ram:IssuerTradeParty/ram:GlobalID`)).toEqual([SIREN_VENDEUR_CDAR])
    expect(un(doc, `${RRD}/ram:IssuerTradeParty/ram:GlobalID/@schemeID`)).toBe('0002')
  })

  it('MDT-124-2 : un seul détail de statut, numéroté 1', () => {
    expect(valeurs(doc, STATUT)).toHaveLength(1)
    expect(un(doc, `${STATUT}/ram:SequenceNumeric`)).toBe('1')
  })

  it('MDG-43 : une caractéristique MEN par taux — montant en euros et taux (G7.12, G7.45, P1.15, P1.18)', () => {
    expect(valeurs(doc, `${CARAC}/ram:TypeCode`)).toEqual(['MEN'])
    expect(valeurs(doc, `${CARAC}/ram:ValueAmount`)).toEqual(['1200'])
    expect(valeurs(doc, `${CARAC}/ram:ValueAmount/@currencyID`)).toEqual(['EUR'])
    expect(valeurs(doc, `${CARAC}/ram:ValuePercent`)).toEqual(['20'])
    expect(CODE_MONTANT_ENCAISSE).toBe('MEN')
  })

  it('un encaissement ne porte ni motif (P1.17 ne le demande qu’au décaissement), ni reste à payer (P1.16 : « peut »)', () => {
    expect(valeurs(doc, `${STATUT}/ram:IncludedNote`)).toEqual([])
    expect(valeurs(doc, `${CARAC}/ram:TypeCode`).filter((c) => c === 'RAP')).toEqual([])
  })

  it('ni pièce jointe (G7.49), ni indicateur de test (P1.13), ni cadre de facturation (MDT-2, optionnel)', () => {
    expect(valeurs(doc, `${RRD}/ram:AttachmentBinaryObject`)).toEqual([])
    expect(valeurs(doc, '/rsm:ExchangedDocumentContext/ram:TestIndicator')).toEqual([])
    expect(valeurs(doc, '/rsm:ExchangedDocumentContext/ram:BusinessProcessSpecifiedDocumentContextParameter')).toEqual([])
  })
})

describe('plusieurs taux, et la contre-passation', () => {
  const [, plusieurs, contre] = EXEMPLES_CDAR

  it('un encaissement à quatre taux : quatre caractéristiques, du taux le plus fort au plus faible, 0 % comprise', () => {
    const doc = lire(xmlDe(plusieurs.donnees))
    expect(valeurs(doc, `${CARAC}/ram:TypeCode`)).toEqual(['MEN', 'MEN', 'MEN', 'MEN'])
    expect(valeurs(doc, `${CARAC}/ram:ValuePercent`)).toEqual(['20', '10', '5.5', '0'])
    expect(valeurs(doc, `${CARAC}/ram:ValueAmount`)).toEqual(['335.01', '92.13', '58.9', '13.96'])
    // G7.45 : la somme des montants par taux fait le montant encaissé.
    const centimes = valeurs(doc, `${CARAC}/ram:ValueAmount`).reduce((s, v) => s + Math.round(Number(v) * 100), 0)
    expect(centimes).toBe(50000)
  })

  it('une contre-passation : montants négatifs (P1.15, P1.17), même statut 212, et son motif d’annulation en MDT-126 (P1.17)', () => {
    const doc = lire(xmlDe(contre.donnees))
    expect(un(doc, `${RRD}/ram:ProcessConditionCode`)).toBe('212')
    expect(valeurs(doc, `${CARAC}/ram:ValueAmount`)).toEqual(['-335.01', '-92.13', '-58.9', '-13.96'])
    expect(un(doc, `${STATUT}/ram:IncludedNote/ram:Content`)).toBe('Chèque revenu impayé : « provision insuffisante » & frais < 5 €.')
    expect(un(doc, '/rsm:ExchangedDocument/ram:Name')).toBe('Contre-passation du statut Encaissée de la facture F2027-0043')
  })
})

describe('les quatre choix, sans valeur par défaut', () => {
  it('le type ne laisse omettre aucun choix (vérifié par le compilateur)', () => {
    const base = choixCdar()
    // @ts-expect-error — le profil n'a pas de valeur par défaut.
    const sansProfil: ChoixCdar = { emetteur: base.emetteur, createur: base.createur, destinataires: base.destinataires, dateEncaissement: base.dateEncaissement, fuseau: base.fuseau }
    // @ts-expect-error — l'émetteur non plus.
    const sansEmetteur: ChoixCdar = { profil: base.profil, createur: base.createur, destinataires: base.destinataires, dateEncaissement: base.dateEncaissement, fuseau: base.fuseau }
    // @ts-expect-error — ni le créateur.
    const sansCreateur: ChoixCdar = { profil: base.profil, emetteur: base.emetteur, destinataires: base.destinataires, dateEncaissement: base.dateEncaissement, fuseau: base.fuseau }
    // @ts-expect-error — ni les destinataires.
    const sansDestinataire: ChoixCdar = { profil: base.profil, emetteur: base.emetteur, createur: base.createur, dateEncaissement: base.dateEncaissement, fuseau: base.fuseau }
    // @ts-expect-error — ni le porteur de la date.
    const sansPorteur: ChoixCdar = { profil: base.profil, emetteur: base.emetteur, createur: base.createur, destinataires: base.destinataires, fuseau: base.fuseau }
    // @ts-expect-error — ni le fuseau.
    const sansFuseau: ChoixCdar = { profil: base.profil, emetteur: base.emetteur, createur: base.createur, destinataires: base.destinataires, dateEncaissement: base.dateEncaissement }
    // À l'exécution, un choix absent — un JSON incomplet — est refusé, jamais remplacé.
    for (const incomplet of [sansProfil, sansEmetteur, sansCreateur, sansDestinataire, sansPorteur, sansFuseau]) {
      expect(() => refusMessageEncaissee(donneesCdar({ choix: incomplet }))).not.toThrow()
    }
    expect(refusMessageEncaissee(donneesCdar({ choix: sansProfil }))).toEqual(['Le profil undefined n’est pas l’un de ceux que les sources publiques nomment.'])
    expect(refusMessageEncaissee(donneesCdar({ choix: sansEmetteur }))).toEqual(['L’émetteur du message manque.'])
    expect(refusMessageEncaissee(donneesCdar({ choix: sansCreateur }))).toEqual(['Le créateur du message manque.'])
    expect(refusMessageEncaissee(donneesCdar({ choix: sansDestinataire }))).toEqual([SANS_DESTINATAIRE])
    expect(refusMessageEncaissee(donneesCdar({ choix: sansPorteur }))).toEqual(['La donnée qui porterait la date de l’encaissement (undefined) n’est ni MDT-110 ni MDT-219.'])
    expect(refusMessageEncaissee(donneesCdar({ choix: sansFuseau }))).toEqual(['Le fuseau undefined n’est ni Europe/Paris ni UTC.'])
    // Un destinataire absent DANS la liste se refuse aussi, sans lever.
    expect(refusMessageEncaissee(donneesCdar({ choix: choixCdar({ destinataires: [PLATEFORME, null as unknown as PartieCdar] }) })))
      .toEqual(['Le destinataire du message manque.'])
  })

  describe('1. le profil (MDT-3)', () => {
    it('les deux candidats, chacun avec sa source ; MDT-97 ne suit pas le profil (G7.14)', () => {
      expect(PROFILS_CDAR.map((p) => p.identifiant)).toEqual(['urn.cpro.gouv.fr:1p0:CDV:einvoicingF2', 'urn:cpro.gouv.fr:1p0:CDV:invoice'])
      for (const p of PROFILS_CDAR) {
        expect(p.source).not.toBe('')
        const doc = lire(xmlDe(donneesCdar({ choix: choixCdar({ profil: p.identifiant }) })))
        expect(un(doc, '/rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID')).toBe(p.identifiant)
        expect(un(doc, `${RRD}/ram:ReferenceTypeCode`)).toBe(REFERENCE_CDV_FACTURE)
      }
    })

    it('S1.06 et G7.14 nomment le même URN pour un cycle de vie sur une facture', () => {
      expect(PROFILS_CDAR[0].identifiant).toBe(REFERENCE_CDV_FACTURE)
    })
  })

  describe('2. les parties (MDG-9, MDG-16, MDG-23)', () => {
    it('une plateforme émettrice, un vendeur créateur désigné par son SIRET, deux destinataires dont l’administration', () => {
      const doc = lire(xmlDe(EXEMPLES_CDAR[1].donnees))
      expect(un(doc, '/rsm:ExchangedDocument/ram:SenderTradeParty/ram:GlobalID')).toBe('9991')
      expect(un(doc, '/rsm:ExchangedDocument/ram:SenderTradeParty/ram:GlobalID/@schemeID')).toBe('0238')
      expect(valeurs(doc, '/rsm:ExchangedDocument/ram:SenderTradeParty/ram:Name')).toEqual([])
      expect(un(doc, '/rsm:ExchangedDocument/ram:SenderTradeParty/ram:RoleCode')).toBe('WK')
      expect(un(doc, '/rsm:ExchangedDocument/ram:IssuerTradeParty/ram:GlobalID')).toBe(SIRET_VENDEUR)
      expect(un(doc, '/rsm:ExchangedDocument/ram:IssuerTradeParty/ram:GlobalID/@schemeID')).toBe('0009')
      expect(valeurs(doc, '/rsm:ExchangedDocument/ram:RecipientTradeParty/ram:GlobalID')).toEqual(['9992', '9999'])
      expect(valeurs(doc, '/rsm:ExchangedDocument/ram:RecipientTradeParty/ram:Name')).toEqual(['Plateforme Fictive'])
      expect(valeurs(doc, '/rsm:ExchangedDocument/ram:RecipientTradeParty/ram:RoleCode')).toEqual(['WK', 'DFH'])
      // Le vendeur du document référencé reste désigné par son SIREN, quel que soit le créateur (G7.17).
      expect(valeurs(doc, `${RRD}/ram:IssuerTradeParty/ram:GlobalID`)).toEqual([SIREN_VENDEUR_CDAR])
    })

    it('partieVendeur : le vendeur figé sur la facture, par son SIREN ou son SIRET, au choix de l’appelant (G6.26)', () => {
      const f = { emetteur_nom: NOM_VENDEUR_CDAR, emetteur_siret: SIRET_VENDEUR }
      expect(partieVendeur(f, '0002')).toEqual(VENDEUR_SIREN)
      expect(partieVendeur(f, '0009')).toEqual(VENDEUR_SIRET)
      expect(partieVendeur({ emetteur_nom: 'X', emetteur_siret: ' 123 456 782 00010 ' }, '0002').identifiant).toBe('123456782')
      expect(partieVendeur({ emetteur_nom: 'X', emetteur_siret: ' 123 456 782 00010 ' }, '0009').identifiant).toBe(SIRET_VENDEUR)
      // Un SIRET qui ne donne pas de SIREN reste tel quel : la partie se refuse, rien n'est inventé.
      const fausse = partieVendeur({ emetteur_nom: 'X', emetteur_siret: '12A' }, '0002')
      expect(fausse.identifiant).toBe('12A')
      expect(refusMessageEncaissee(donneesCdar({ choix: choixCdar({ createur: fausse }) })))
        .toEqual(['Le créateur du message est désigné par un SIREN qui n’en est pas un (neuf chiffres et leur clé).'])
      expect(partieVendeur({ emetteur_nom: null, emetteur_siret: null }, '0009')).toEqual({ identifiant: '', schema: '0009', nom: null, role: 'SE' })
    })

    it('les schémas et les rôles admis (G1.73, G7.01)', () => {
      expect(SCHEMAS_PARTIE_CDAR).toEqual(['0002', '0009', '0238'])
      expect(ROLES_PARTIE_CDAR).toEqual(['SE', 'WK', 'DFH'])
    })
  })

  describe('3. la date de l’encaissement (MDT-110, MDT-219)', () => {
    const porte = (porteur: PorteurDateEncaissement) => {
      const doc = lire(xmlDe(EXEMPLES_CDAR[1].donnees.choix.dateEncaissement === porteur
        ? EXEMPLES_CDAR[1].donnees
        : { ...EXEMPLES_CDAR[1].donnees, choix: { ...EXEMPLES_CDAR[1].donnees.choix, dateEncaissement: porteur } }))
      return {
        mdt110: valeurs(doc, `${STATUT}/ram:ReferenceDateTime/udt:DateTimeString`),
        format110: valeurs(doc, `${STATUT}/ram:ReferenceDateTime/udt:DateTimeString/@format`),
        mdt219: valeurs(doc, `${CARAC}/ram:ValueDateTime/udt:DateTimeString`),
        format219: valeurs(doc, `${CARAC}/ram:ValueDateTime/udt:DateTimeString/@format`),
      }
    }

    it('les trois options, et aucune autre', () => {
      expect(PORTEURS_DATE_ENCAISSEMENT).toEqual(['MDT-110', 'MDT-219', 'MDT-110 et MDT-219'])
    })

    it('MDT-110 : la date du détail de statut, à minuit, au format 204 (G7.06) ; aucune date dans les caractéristiques', () => {
      expect(porte('MDT-110')).toEqual({ mdt110: ['20271020000000'], format110: ['204'], mdt219: [], format219: [] })
    })

    it('MDT-219 : la date dans chaque caractéristique, au format 102 de MDT-220 ; rien en MDT-110', () => {
      expect(porte('MDT-219')).toEqual({ mdt110: [], format110: [], mdt219: Array(4).fill('20271020'), format219: Array(4).fill('102') })
    })

    it('les deux', () => {
      expect(porte('MDT-110 et MDT-219')).toEqual({
        mdt110: ['20271020000000'], format110: ['204'], mdt219: Array(4).fill('20271020'), format219: Array(4).fill('102'),
      })
    })

    it('MDT-78, l’horodatage du statut, n’est pas la date d’encaissement : il reste celui du message', () => {
      const doc = lire(xmlDe(donneesCdar()))
      expect(un(doc, '/rsm:AcknowledgementDocument/ram:IssueDateTime/udt:DateTimeString')).toBe('20271105093000')
      expect(un(doc, `${STATUT}/ram:ReferenceDateTime/udt:DateTimeString`)).toBe('20271015000000')
    })
  })

  describe('4. le fuseau des horodatages', () => {
    it('les deux options', () => {
      expect(FUSEAUX_CDAR).toEqual(['Europe/Paris', 'UTC'])
    })

    it('les instants (MDT-8, MDT-78, MDT-95) s’écrivent dans le fuseau choisi ; les dates civiles (MDT-100, MDT-110, MDT-219) jamais', () => {
      const instants = (fuseau: FuseauCdar) => {
        const doc = lire(xmlDe({ ...EXEMPLES_CDAR[1].donnees, choix: { ...EXEMPLES_CDAR[1].donnees.choix, fuseau, dateEncaissement: 'MDT-110 et MDT-219' } }))
        return [
          un(doc, '/rsm:ExchangedDocument/ram:IssueDateTime/udt:DateTimeString'),
          un(doc, '/rsm:AcknowledgementDocument/ram:IssueDateTime/udt:DateTimeString'),
          un(doc, `${RRD}/ram:ReceiptDateTime/udt:DateTimeString`),
          un(doc, `${RRD}/ram:FormattedIssueDateTime/qdt:DateTimeString`),
          un(doc, `${STATUT}/ram:ReferenceDateTime/udt:DateTimeString`),
          valeurs(doc, `${CARAC}/ram:ValueDateTime/udt:DateTimeString`)[0],
        ]
      }
      // 23 h 30 en UTC le 05/11, minuit et demi à Paris le 06/11 (heure d'hiver, UTC+1).
      expect(instants('UTC')).toEqual(['20271105233000', '20271105233000', '20271001223000', '20271001000000', '20271020000000', '20271020'])
      expect(instants('Europe/Paris')).toEqual(['20271106003000', '20271106003000', '20271002003000', '20271001000000', '20271020000000', '20271020'])
    })

    it('horodatage204 : l’heure d’été et d’hiver à Paris, ses deux bascules, le passage de l’an', () => {
      const h = (iso: string, fuseau: FuseauCdar) => horodatage204(new Date(iso), fuseau)
      expect(h('2027-01-15T12:00:00Z', 'Europe/Paris')).toBe('20270115130000')
      expect(h('2027-07-15T12:00:00Z', 'Europe/Paris')).toBe('20270715140000')
      // Le dernier dimanche de mars 2027 (le 28), à 1 h UTC, Paris passe de 2 h à 3 h.
      expect(h('2027-03-28T00:59:59Z', 'Europe/Paris')).toBe('20270328015959')
      expect(h('2027-03-28T01:00:00Z', 'Europe/Paris')).toBe('20270328030000')
      // Le dernier dimanche d'octobre 2027 (le 31), à 1 h UTC, Paris repasse de 3 h à 2 h.
      expect(h('2027-10-31T00:59:59Z', 'Europe/Paris')).toBe('20271031025959')
      expect(h('2027-10-31T01:00:00Z', 'Europe/Paris')).toBe('20271031020000')
      expect(h('2027-12-31T23:30:00Z', 'Europe/Paris')).toBe('20280101003000')
      expect(h('2027-12-31T23:30:00Z', 'UTC')).toBe('20271231233000')
      expect(h('2027-03-28T01:00:00Z', 'UTC')).toBe('20270328010000')
      // Minuit s'écrit 00, jamais 24.
      expect(h('2027-06-30T22:00:00Z', 'Europe/Paris')).toBe('20270701000000')
    })

    it('horodatage204 : ni un instant qui n’en est pas un, ni un fuseau inconnu (Intl lèverait)', () => {
      expect(horodatage204(new Date(Number.NaN), 'UTC')).toBeNull()
      expect(horodatage204(new Date('2027-01-15T12:00:00Z'), 'America/Cayenne' as FuseauCdar)).toBeNull()
      expect(horodatage204('2027-01-15' as unknown as Date, 'UTC')).toBeNull()
      // Au-delà de l'an 9999, l'année a cinq chiffres : ce n'est plus le format 204.
      expect(horodatage204(new Date('+010000-01-01T00:00:00Z'), 'UTC')).toBeNull()
    })

    it('le fuseau du poste n’y change rien (la suite tourne sous quatre fuseaux)', () => {
      expect(xmlDe(donneesCdar())).toContain('<udt:DateTimeString format="204">20271105093000</udt:DateTimeString>')
    })
  })
})

describe('les montants et les taux au format de la DGFiP', () => {
  // G7.07 : 19 chiffres au plus, 6 décimales au plus, le point pour séparateur, le signe « - » en tête.
  const G707 = (v: string) => /^-?\d+(\.\d{1,6})?$/.test(v) && v.replace(/[-.]/g, '').length <= 19

  it('chaque montant des exemples respecte G7.07, et chaque taux G1.24 (MDT-224 : trois chiffres, deux décimales)', () => {
    for (const e of EXEMPLES_CDAR) {
      const doc = lire(xmlDe(e.donnees))
      for (const v of valeurs(doc, `${CARAC}/ram:ValueAmount`)) expect(G707(v), v).toBe(true)
      for (const v of valeurs(doc, `${CARAC}/ram:ValuePercent`)) {
        expect(TAUX_ADMIS).toContain(Number(v))
        expect(v).toMatch(/^\d{1,3}(\.\d{1,2})?$/)
      }
    }
  })

  it('le plus grand montant que le registre garde (moins de dix mille milliards d’euros) tient dans G7.07', () => {
    const grand = 9_999_999_999_999.99
    const d = donneesCdar({ encaissement: encaissementCdar({ montant: grand }), parts: [partCdar(20, grand)] })
    const v = valeurs(lire(xmlDe(d)), `${CARAC}/ram:ValueAmount`)
    expect(v).toEqual(['9999999999999.99'])
    expect(G707(v[0])).toBe(true)
  })

  it('un centime, et un montant négatif', () => {
    const d = donneesCdar({ encaissement: encaissementCdar({ montant: 0.01 }), parts: [partCdar(20, 0.01)] })
    expect(valeurs(lire(xmlDe(d)), `${CARAC}/ram:ValueAmount`)).toEqual(['0.01'])
    expect(valeurs(lire(xmlDe(EXEMPLES_CDAR[2].donnees)), `${CARAC}/ram:ValueAmount`).every((v) => v.startsWith('-') && G707(v))).toBe(true)
  })

  it('un montant que la virgule flottante écrit juste en dessous du centime (4,35 × 100) reste au centime', () => {
    const d = donneesCdar({ encaissement: encaissementCdar({ montant: 4.35 }), parts: [partCdar(20, 4.35)] })
    expect(valeurs(lire(xmlDe(d)), `${CARAC}/ram:ValueAmount`)).toEqual(['4.35'])
  })

  it('un montant que `decimal` refuserait à tort (le plus petit trouvé, au-delà de 2²⁷ €) s’écrit au centime', () => {
    const montant = 134_228_634.83
    expect(decimal(montant, 2)).toBeNull()
    const d = donneesCdar({ encaissement: encaissementCdar({ montant }), parts: [partCdar(20, montant)] })
    expect(valeurs(lire(xmlDe(d)), `${CARAC}/ram:ValueAmount`)).toEqual(['134228634.83'])
  })
})

describe('ce que le message échappe', () => {
  it('une raison sociale et un motif portant & < > " et un caractère de contrôle se relisent tels quels, le caractère interdit en moins', () => {
    const nom = 'Démo & Fils <Conseil> "Paris"\u0001'
    const motif = 'Rendu : 5 < 6 & 7 > 3, « guillemets » "droits"\u0008 et\nun saut de ligne.'
    const vendeur: PartieCdar = { ...VENDEUR_SIREN, nom }
    const d = donneesCdar({
      encaissement: encaissementCdar({ montant: -1200, annule_id: 'encaissement-0', motif }),
      parts: [partCdar(20, -1200)],
      choix: choixCdar({ emetteur: vendeur, createur: vendeur }),
    })
    const xml = xmlDe(d)
    expect(xml).not.toContain('\u0001')
    // Échappé comme factureCii.ts échappe : les cinq formes, même là où XML tolérerait le caractère brut.
    expect(xml).toContain('<ram:Name>Démo &amp; Fils &lt;Conseil&gt; &quot;Paris&quot;</ram:Name>')
    const doc = lire(xml)
    expect(un(doc, '/rsm:ExchangedDocument/ram:SenderTradeParty/ram:Name')).toBe('Démo & Fils <Conseil> "Paris"')
    expect(un(doc, `${STATUT}/ram:IncludedNote/ram:Content`)).toBe('Rendu : 5 < 6 & 7 > 3, « guillemets » "droits" et\nun saut de ligne.')
  })

  it('les bornes de XML 1.0 : U+D7FF, U+E000, U+FFFD, U+10000 et U+10FFFF restent ; U+0000, U+001F, U+FFFE, U+FFFF et un substitut isolé partent', () => {
    const car = (n: number) => String.fromCodePoint(n)
    const gardes = [0xd7ff, 0xe000, 0xfffd, 0x10000, 0x10ffff].map(car).join('')
    const retires = [0x0, 0x1f, 0xfffe, 0xffff, 0xd800].map(car).join('')
    const d = donneesCdar({
      encaissement: encaissementCdar({ montant: -1200, annule_id: 'encaissement-0', motif: `a${gardes}b${retires}c` }),
      parts: [partCdar(20, -1200)],
    })
    expect(un(lire(xmlDe(d)), `${STATUT}/ram:IncludedNote/ram:Content`)).toBe(`a${gardes}bc`)
  })

  it('une raison sociale sur plusieurs lignes s’écrit sur une seule', () => {
    const doc = lire(xmlDe(donneesCdar({ choix: choixCdar({ createur: { ...VENDEUR_SIREN, nom: '  Atelier\n  Démo   Conseil ' } }) })))
    expect(un(doc, '/rsm:ExchangedDocument/ram:IssuerTradeParty/ram:Name')).toBe('Atelier Démo Conseil')
  })
})

// ── Les refus ──────────────────────────────────────────────────────────────────────────────────────────────────────

describe('les refus, un par faute', () => {
  const refus = (o: Partial<DonneesCdar>) => refusMessageEncaissee(donneesCdar(o))
  const enc = (o: Partial<EncaissementPourCdar>) => refus({ encaissement: encaissementCdar(o) })
  const fac = (o: Partial<FacturePourCdar>) => refus({ facture: factureCdar(o) })
  const contrePassation = (o: Partial<EncaissementPourCdar>) =>
    refus({ encaissement: encaissementCdar({ montant: -1200, annule_id: 'encaissement-0', motif: 'Erreur de saisie.', ...o }), parts: [partCdar(20, -1200)] })

  it('l’encaissement et sa facture', () => {
    expect(enc({ retire_le: '2027-10-16T08:00:00Z' })).toEqual([RETIRE])
    expect(enc({ facture_id: 'facture-autre' })).toEqual([AUTRE_FACTURE])
    expect(fac({ statut: 'brouillon' })).toEqual([NON_VALIDEE])
    expect(fac({ numero: null })).toEqual([NON_VALIDEE])
    expect(fac({ numero: '' })).toEqual([NON_VALIDEE])
    // G1.05.
    expect(fac({ numero: 'F2027 0042 !' })).toEqual(['Le numéro F2027 0042 ! ne peut pas désigner la facture : 35 caractères au plus — chiffres, lettres, espace, « - », « + », « _ » et « / ».'])
    expect(fac({ numero: 'F'.repeat(36) })).toHaveLength(1)
    expect(fac({ numero: 'F'.repeat(35) })).toEqual([])
    expect(fac({ type: 'avoir' })).toEqual([AVOIR])
    expect(fac({ date_emission: '2027-02-29' })).toEqual(['La date d’émission de la facture (2027-02-29) n’est pas une date.'])
    expect(fac({ date_emission: '01/10/2027' })).toEqual(['La date d’émission de la facture (01/10/2027) n’est pas une date.'])
    // Le 29/02/2028 existe — mais la facture aurait alors été reçue avant d'être émise.
    expect(fac({ date_emission: '2028-02-29' })).toEqual([RECUE_AVANT])
    // Les années séculaires ne sont bissextiles que divisibles par 400.
    expect(fac({ date_emission: '2000-02-29' })).toEqual([])
    for (const date of ['1900-02-29', '2100-02-29', '2027-10-00', '2027-00-10', '2027-13-10', '2027-04-31']) {
      expect(fac({ date_emission: date }), date).toEqual([`La date d’émission de la facture (${date}) n’est pas une date.`])
    }
    // Une date qui n'en est pas une ne se compare pas à la réception : sa faute est déjà dite.
    expect(fac({ date_emission: '9999-99-99' })).toEqual(['La date d’émission de la facture (9999-99-99) n’est pas une date.'])
    // Une date se lit entière : rien avant, rien après.
    expect(fac({ date_emission: '2027-10-01T00:00:00' })).toEqual(['La date d’émission de la facture (2027-10-01T00:00:00) n’est pas une date.'])
  })

  it('le vendeur : le SIREN tiré du SIRET figé (G7.17)', () => {
    expect(fac({ emetteur_siret: null })).toEqual([SIREN_FAUX])
    expect(fac({ emetteur_siret: '12345678300010' })).toEqual([SIREN_FAUX])
    expect(fac({ emetteur_siret: '123456782' })).toEqual([])
  })

  it('le montant, son signe et son motif (P1.15, P1.17)', () => {
    expect(enc({ montant: 1200.005 })).toEqual([PAS_AU_CENTIME])
    expect(enc({ montant: Number.NaN })).toEqual([PAS_AU_CENTIME])
    expect(enc({ montant: 0 })).toEqual([NUL])
    expect(refus({ encaissement: encaissementCdar({ montant: -1200 }), parts: [partCdar(20, -1200)] })).toEqual([SIGNE])
    expect(refus({ encaissement: encaissementCdar({ montant: 1200, annule_id: 'encaissement-0', motif: 'x' }) })).toEqual([SIGNE])
    expect(contrePassation({})).toEqual([])
    expect(contrePassation({ motif: null })).toEqual([SANS_MOTIF])
    expect(contrePassation({ motif: '' })).toEqual([SANS_MOTIF])
    expect(contrePassation({ motif: '   ' })).toEqual([SANS_MOTIF])
    // Comme la base : `btrim` n'ôte que des espaces, et un saut de ligne est un motif pour elle.
    expect(contrePassation({ motif: '\n' })).toEqual([])
    expect(contrePassation({ motif: 'x'.repeat(LONGUEUR_MAX_MOTIF_CDAR + 1) })).toEqual([MOTIF_LONG])
    expect(contrePassation({ motif: 'x'.repeat(LONGUEUR_MAX_MOTIF_CDAR) })).toEqual([])
    // Des caractères, pas des unités UTF-16 : 2 000 emoji en font 4 000.
    expect(contrePassation({ motif: '😀'.repeat(LONGUEUR_MAX_MOTIF_CDAR) })).toEqual([])
    expect(enc({ motif: 'Note' })).toEqual([MOTIF_EN_TROP])
  })

  it('la date de l’encaissement : une date, déjà arrivée à Paris quand le message part', () => {
    expect(enc({ date_encaissement: '2027-13-01' })).toEqual([DATE_FAUSSE])
    expect(enc({ date_encaissement: '' })).toEqual([DATE_FAUSSE])
    expect(enc({ date_encaissement: ' 2027-10-15' })).toEqual([DATE_FAUSSE])
    expect(enc({ date_encaissement: '2027-11-06' })).toEqual(['L’encaissement est daté du 06/11/2027, qui n’est pas encore arrivé quand le message part.'])
    expect(enc({ date_encaissement: '2027-11-05' })).toEqual([])
    // Le 06/11 à 0 h 30 à Paris est encore le 05/11 en UTC : la date civile se juge à Paris, quel que soit le fuseau.
    const minuitPasse = new Date('2027-11-05T23:30:00Z')
    expect(refus({ encaissement: encaissementCdar({ date_encaissement: '2027-11-06' }), maintenant: minuitPasse, choix: choixCdar({ fuseau: 'UTC' }) })).toEqual([])
    // Un acompte, payé avant la date de la facture, se déclare.
    expect(enc({ date_encaissement: '2027-09-20' })).toEqual([])
  })

  it('la répartition par taux (G7.45, G1.24, P1.18)', () => {
    expect(refus({ parts: [] })).toEqual([SANS_PARTS])
    // Les parts d'un autre encaissement, les lignes d'une autre facture : le module filtre lui-même.
    expect(refus({ parts: [partCdar(20, 1200, 'encaissement-autre')] })).toEqual([SANS_PARTS])
    expect(refus({ lignes: [ligneCdar(20, 'facture-autre')] })).toEqual(['La part à 20 % : ce taux n’est pas un taux de la facture.'])
    expect(refus({ lignes: [ligneCdar(19)], parts: [partCdar(19, 1200)] })).toEqual(['La part à 19 % : ce taux n’est pas un taux de TVA admis.'])
    // Un taux non admis n'est pas, EN PLUS, dit hors de la facture : une faute, un refus.
    expect(refus({ lignes: [ligneCdar(20)], parts: [partCdar(19, 1200)] })).toEqual(['La part à 19 % : ce taux n’est pas un taux de TVA admis.'])
    // Les parts d'un encaissement nul ne se jugent pas sur son signe : sa faute est déjà dite.
    expect(refus({ encaissement: encaissementCdar({ montant: 0 }), parts: [partCdar(20, -5)] })).toEqual([NUL])
    expect(refus({ parts: [partCdar(10, 1200)] })).toEqual(['La part à 10 % : ce taux n’est pas un taux de la facture.'])
    expect(refus({ parts: [partCdar(20, 600), partCdar(20, 600)] })).toEqual(['Le taux de 20 % figure deux fois dans la répartition.'])
    expect(refus({ parts: [partCdar(20, 1199.995)] })).toEqual(['La part à 20 % ne s’écrit pas au centime.'])
    expect(refus({ lignes: [ligneCdar(20), ligneCdar(10)], parts: [partCdar(20, 1200), partCdar(10, 0)] })).toEqual(['La part à 10 % est nulle.'])
    expect(refus({ lignes: [ligneCdar(20), ligneCdar(10)], parts: [partCdar(20, 1300), partCdar(10, -100)] }))
      .toEqual(['La part à 10 % n’est pas du signe de l’encaissement.'])
    expect(refus({ parts: [partCdar(20, 1000)] })).toEqual(['La répartition (1000,00 €) ne fait pas le montant de l’encaissement (1200,00 €).'])
    expect(refus({ lignes: [ligneCdar(5.5)], parts: [partCdar(5.5, 1199.99)] })).toEqual(['La répartition (1199,99 €) ne fait pas le montant de l’encaissement (1200,00 €).'])
    // Le taux décimal se dit à la française.
    expect(refus({ lignes: [ligneCdar(5.5)], parts: [partCdar(5.5, 1200), partCdar(5.5, 0.01)] })).toContain('Le taux de 5,5 % figure deux fois dans la répartition.')
  })

  it('le message : son identifiant (MDT-4, 50 caractères) et ses deux instants', () => {
    for (const id of ['', ' a', 'a ', 'a  b', 'a#b', 'é', 'x'.repeat(51)]) expect(refus({ identifiant: id }), JSON.stringify(id)).toEqual([IDENTIFIANT])
    for (const id of ['x'.repeat(50), 'a b', 'A-1+2_3/4']) expect(refus({ identifiant: id }), id).toEqual([])
    expect(refus({ maintenant: new Date(Number.NaN) })).toEqual([MAINTENANT])
    expect(refus({ receptionFacture: new Date(Number.NaN) })).toEqual([RECEPTION])
    // Un instant que Paris sait écrire et UTC non : vers l'an 1000, Paris vit à l'heure moyenne de son méridien
    // (+0 h 09 min 21 s) et entre dans l'an 1000 quand UTC est encore en 999, une année de trois chiffres. Le message
    // s'écrirait en UTC : l'instant est refusé, et ne se compare à rien d'autre.
    const an1000 = new Date('0999-12-31T23:55:00Z')
    expect(horodatage204(an1000, 'Europe/Paris')).toBe('10000101000421')
    expect(horodatage204(an1000, 'UTC')).toBeNull()
    expect(refus({ maintenant: an1000, choix: choixCdar({ fuseau: 'UTC' }) }))
      .toEqual(['L’encaissement est daté du 15/10/2027, qui n’est pas encore arrivé quand le message part.', MAINTENANT])
    expect(refus({ receptionFacture: new Date('2027-11-05T08:30:01Z') })).toEqual([RECUE_APRES])
    expect(refus({ receptionFacture: new Date('2027-11-05T08:30:00Z') })).toEqual([])
    // Le 01/10 commence à Paris le 30/09 à 22 h UTC (heure d'été).
    expect(refus({ receptionFacture: new Date('2027-09-30T21:59:59Z') })).toEqual([RECUE_AVANT])
    expect(refus({ receptionFacture: new Date('2027-09-30T22:00:00Z') })).toEqual([])
  })

  it('les choix : un profil, un porteur, un fuseau parmi ceux que le module connaît', () => {
    expect(refus({ choix: choixCdar({ profil: 'urn:inconnu' as ProfilCdar }) })).toEqual(['Le profil urn:inconnu n’est pas l’un de ceux que les sources publiques nomment.'])
    expect(refus({ choix: choixCdar({ dateEncaissement: 'MDT-78' as PorteurDateEncaissement }) }))
      .toEqual(['La donnée qui porterait la date de l’encaissement (MDT-78) n’est ni MDT-110 ni MDT-219.'])
    // Un fuseau inconnu se dit une fois : les instants, eux, restent des instants.
    expect(refus({ choix: choixCdar({ fuseau: 'America/Cayenne' as FuseauCdar }) })).toEqual(['Le fuseau America/Cayenne n’est ni Europe/Paris ni UTC.'])
  })

  it('les parties : schéma et identifiant (G1.73, G7.54), rôle (G7.01), raison sociale (G7.46)', () => {
    const avec = (p: Partial<PartieCdar>, quelle: 'emetteur' | 'createur' = 'emetteur') =>
      refus({ choix: choixCdar({ [quelle]: { ...VENDEUR_SIREN, ...p } }) })
    expect(avec({ schema: '0088' as PartieCdar['schema'] })).toEqual(['L’émetteur du message a un schéma d’identifiant inconnu (0088) : 0002 (SIREN), 0009 (SIRET) ou 0238 (matricule d’une plateforme).'])
    expect(avec({ identifiant: '123456789' })).toEqual(['L’émetteur du message est désigné par un SIREN qui n’en est pas un (neuf chiffres et leur clé).'])
    expect(avec({ schema: '0009', identifiant: SIREN_VENDEUR_CDAR })).toEqual(['L’émetteur du message est désigné par un SIRET qui n’en est pas un (quatorze chiffres et leur clé).'])
    expect(avec({ schema: '0009', identifiant: SIRET_VENDEUR })).toEqual([])
    for (const m of ['999', '99999', 'ABCD', ' 999']) {
      expect(avec({ schema: '0238', identifiant: m, role: 'WK' }), m).toEqual(['L’émetteur du message est désigné par un matricule de plateforme qui n’a pas quatre chiffres.'])
    }
    expect(avec({ schema: '0238', identifiant: '0001', role: 'WK', nom: null })).toEqual([])
    expect(avec({ role: 'BY' as PartieCdar['role'] })).toEqual(['L’émetteur du message a un rôle inconnu (BY) : SE (le vendeur), WK (une plateforme) ou DFH (celle de l’administration).'])
    expect(avec({ nom: null }, 'createur')).toEqual(['Le créateur du message n’a pas de raison sociale : seule une plateforme peut s’en passer.'])
    expect(avec({ nom: ' \n ' }, 'createur')).toEqual(['Le créateur du message n’a pas de raison sociale : seule une plateforme peut s’en passer.'])
    expect(avec({ nom: 'x'.repeat(151) }, 'createur')).toEqual(['La raison sociale du créateur du message dépasse 150 caractères.'])
    expect(avec({ nom: `${'x'.repeat(150)}  ` }, 'createur')).toEqual([])
    expect(refus({ choix: choixCdar({ destinataires: [] }) })).toEqual([SANS_DESTINATAIRE])
    expect(refus({ choix: choixCdar({ destinataires: [PLATEFORME, { ...AUTRE_PLATEFORME, identifiant: '12' }] }) }))
      .toEqual(['Le destinataire du message est désigné par un matricule de plateforme qui n’a pas quatre chiffres.'])
    expect(refus({ choix: choixCdar({ destinataires: [{ ...PLATEFORME_ADMINISTRATION, nom: 'x'.repeat(151) }] }) }))
      .toEqual(['La raison sociale du destinataire du message dépasse 150 caractères.'])
    expect(refus({ choix: choixCdar({ emetteur: { ...PLATEFORME, nom: 'x'.repeat(151) } }) }))
      .toEqual(['La raison sociale de l’émetteur du message dépasse 150 caractères.'])
  })

  it('toutes les fautes ensemble, dans l’ordre où l’écran les dit ; rien n’est écrit', () => {
    const d = donneesCdar({
      facture: factureCdar({ statut: 'brouillon', type: 'avoir', emetteur_siret: null }),
      encaissement: encaissementCdar({ retire_le: '2027-10-16T08:00:00Z', facture_id: 'facture-autre', montant: 0, motif: 'x', date_encaissement: '2027-13-01' }),
      parts: [],
      identifiant: '',
      maintenant: new Date(Number.NaN),
      receptionFacture: new Date(Number.NaN),
      choix: choixCdar({
        profil: 'p' as ProfilCdar, dateEncaissement: 'd' as PorteurDateEncaissement, fuseau: 'f' as FuseauCdar,
        emetteur: { ...VENDEUR_SIREN, role: 'BY' as PartieCdar['role'] }, createur: { ...VENDEUR_SIREN, nom: null }, destinataires: [],
      }),
    })
    const attendus = [
      RETIRE, AUTRE_FACTURE, NON_VALIDEE, AVOIR, SIREN_FAUX, NUL, MOTIF_EN_TROP, DATE_FAUSSE, SANS_PARTS, IDENTIFIANT,
      MAINTENANT, RECEPTION,
      'Le profil p n’est pas l’un de ceux que les sources publiques nomment.',
      'La donnée qui porterait la date de l’encaissement (d) n’est ni MDT-110 ni MDT-219.',
      'Le fuseau f n’est ni Europe/Paris ni UTC.',
      'L’émetteur du message a un rôle inconnu (BY) : SE (le vendeur), WK (une plateforme) ou DFH (celle de l’administration).',
      'Le créateur du message n’a pas de raison sociale : seule une plateforme peut s’en passer.',
      SANS_DESTINATAIRE,
    ]
    expect(refusMessageEncaissee(d)).toEqual(attendus)
    expect(messageEncaissee(d)).toEqual({ xml: null, refus: attendus })
  })
})

// ── Ce qui est confronté hors du module ────────────────────────────────────────────────────────────────────────────

describe('ce que le module partage avec le reste du dépôt', () => {
  it('les quinze taux admis (G1.24) s’écrivent de même par `decimal(·, 2)`, comme le CII, et par String', () => {
    expect(TAUX_ADMIS).toHaveLength(15)
    for (const t of TAUX_ADMIS) expect(decimal(t, 2), String(t)).toBe(String(t))
  })

  it('le motif : 2 000 caractères, la longueur du registre (MDT-126 : 2000)', () => {
    expect(LONGUEUR_MAX_MOTIF_CDAR).toBe(LONGUEUR_MAX_TEXTE)
    expect(LONGUEUR_MAX_MOTIF_CDAR).toBe(2000)
  })

  it('une facture, ses lignes, un encaissement et ses parts de types.ts se lisent comme le module les lit (le compilateur, sans `as`)', () => {
    const facture = (f: FactureEmise): FacturePourCdar => f
    const ligne = (l: FactureLigne): LignePourCdar => l
    const encaissement = (e: EncaissementFacture): EncaissementPourCdar => e
    const part = (p: EncaissementFactureTaux): PartPourCdar => p
    expect([facture, ligne, encaissement, part]).toHaveLength(4)
  })
})

// ── Le dernier mot est au validateur ───────────────────────────────────────────────────────────────────────────────

describe('les exemples ont passé le schéma CDAR D22B de l’UN/CEFACT', () => {
  it('chaque exemple figé porte l’empreinte que outils/facturation/cdar/valider.mjs a écrite', () => {
    const fichiers = readdirSync(DOSSIER_EXEMPLES).filter((f) => f.endsWith('.xml')).sort()
    expect(fichiers).toEqual(EXEMPLES_CDAR.map((e) => `${e.nom}.xml`).sort())
    const manifeste = JSON.parse(readFileSync(`${DOSSIER_EXEMPLES}valides.json`, 'utf8')) as { fichiers: Record<string, { sha256: string }> }
    expect(Object.keys(manifeste.fichiers).sort()).toEqual(fichiers)
    for (const f of fichiers) {
      const empreinte = createHash('sha256').update(readFileSync(`${DOSSIER_EXEMPLES}${f}`)).digest('hex')
      expect(manifeste.fichiers[f].sha256, `${f} a changé depuis sa validation : relancer valider.mjs`).toBe(empreinte)
    }
  })
})

// Les statuts REÇUS, FICTIFS, que lit cdarRecu.ts : des messages de cycle de vie qu'une plateforme rendrait au vendeur
// des factures d'exemple (SIREN 123456782, identifiants valides par leur clé mais inventés), de la part de l'acheteur
// fictif (SIREN 987654324), d'une plateforme inventée (matricule 9992) ou de celle de l'administration (9999). Les
// fichiers vivent dans outils/facturation/cdar/recus/ et passent au schéma CDAR D22B (outils/facturation/cdar/valider.mjs,
// qui écrit recus/valides.json) ; les trois messages du statut « Encaissée » de d5 (exemples/) servent d'échos.
import { readFileSync } from 'node:fs'
import type { FacturePourStatutRecu, StatutRecuLu } from '../lib/cdarRecu'

export const SIREN_VENDEUR_RECU = '123456782'
export const SIRET_VENDEUR_RECU = '12345678200010'
export const SIREN_ACHETEUR_RECU = '987654324'

export const DOSSIER_RECUS = new URL('../../outils/facturation/cdar/recus/', import.meta.url)
export const DOSSIER_ECHOS = new URL('../../outils/facturation/cdar/exemples/', import.meta.url)

export const messageRecu = (nom: string): string => readFileSync(new URL(nom, DOSSIER_RECUS), 'utf8')
export const echoRecu = (nom: string): string => readFileSync(new URL(nom, DOSSIER_ECHOS), 'utf8')

export function factureRecue(o: Partial<FacturePourStatutRecu> = {}): FacturePourStatutRecu {
  return {
    id: 'facture-42',
    numero: 'F2027-0042',
    statut: 'validee',
    type: 'facture',
    date_emission: '2027-10-01',
    emetteur_siret: SIRET_VENDEUR_RECU,
    ...o,
  }
}

/** Ce qu'un message lu porte, champ par champ — ce que les tests attendent d'un exemple. */
export function statutLu(o: Partial<StatutRecuLu>): StatutRecuLu {
  return {
    objet: 'facture',
    code: '210',
    reference: 'F2027-0042',
    typeObjet: '380',
    siren: SIREN_VENDEUR_RECU,
    dateObjet: '2027-10-01',
    messageId: null,
    emisLe: null,
    createurRole: null,
    dateStatut: null,
    motifs: null,
    commentaire: null,
    montants: [],
    avertissements: [],
    ...o,
  }
}

// Chaque message reçu d'exemple, et ce que le module doit en lire. Un exemple ajouté ici passe au schéma (valider.mjs),
// est lu par cdarRecu.test.ts et par la copie de plateforme-agreee (cdarRecuCopie.test.ts).
export const EXEMPLES_RECUS: { fichier: string; lu: StatutRecuLu }[] = [
  {
    fichier: 'refus-210.xml',
    lu: statutLu({
      code: '210', messageId: 'REFUS-2027-000017', emisLe: '20271008143000', createurRole: 'BY', dateStatut: '2027-10-08',
      motifs: 'MONTANT_ERR : Montant de la facture erroné',
      commentaire: 'La quantité facturée ne correspond pas au bon de commande n° BC-17 & ses deux avenants.',
    }),
  },
  {
    fichier: 'rejet-213.xml',
    lu: statutLu({
      code: '213', reference: 'F2027-0043', messageId: 'REJET-2027-000003', emisLe: '20271002080000', createurRole: 'WK',
      motifs: 'DEST_INC : Destinataire inconnu',
    }),
  },
  {
    fichier: 'rejet-601.xml',
    lu: statutLu({
      objet: 'statut', code: '601', reference: '0b6c7f0e-3a51-4c11-9d2e-5f0000000001', typeObjet: '305', dateObjet: '2027-11-05',
      messageId: 'PPF-CDV-2027-0000000009', emisLe: '20271105120000', createurRole: 'DFH',
      motifs: 'REJ_ENCAISSEMENT : Contrôle des encaissements',
      commentaire: '[G7.45] Le montant encaissé n’est pas réparti par taux de TVA. (MDT-224)',
    }),
  },
  {
    fichier: 'approuvee-205-autres-prefixes.xml',
    lu: statutLu({ code: '205', messageId: 'APPRO-2027-000101', emisLe: '20271004101500', createurRole: 'BY' }),
  },
  {
    fichier: 'litige-207.xml',
    lu: statutLu({
      code: '207', reference: 'F2027-0044', dateObjet: '2027-10-05', messageId: 'LITIGE-2027-000044', emisLe: '20271006161000',
      createurRole: 'BY', motifs: 'QTE_ERR : Quantité facturée incorrecte',
      commentaire: 'Deux journées facturées, une seule réalisée <selon le planning>.',
    }),
  },
  {
    fichier: 'paiement-211.xml',
    lu: statutLu({
      code: '211', messageId: 'PAIEMENT-2027-000077', emisLe: '20271014090000', createurRole: 'BY', dateStatut: '2027-10-13',
      montants: [{ code: 'MPA', montant: '1200.00', devise: 'EUR', taux: null, date: '2027-10-13' }],
    }),
  },
]

// Les trois messages du statut « Encaissée » que le module de d5 écrit, relus comme des échos : un 212 reçu.
export const ECHOS_RECUS: { fichier: string; lu: StatutRecuLu }[] = [
  {
    fichier: 'encaissement-un-taux.xml',
    lu: statutLu({
      code: '212', messageId: '0b6c7f0e-3a51-4c11-9d2e-5f0000000001', emisLe: '20271105093000', createurRole: 'SE',
      dateStatut: '2027-10-15', montants: [{ code: 'MEN', montant: '1200', devise: 'EUR', taux: '20', date: null }],
    }),
  },
  {
    fichier: 'encaissement-plusieurs-taux.xml',
    lu: statutLu({
      code: '212', reference: 'F2027-0043', messageId: '0b6c7f0e-3a51-4c11-9d2e-5f0000000002', emisLe: '20271105233000',
      createurRole: 'SE',
      montants: [
        { code: 'MEN', montant: '335.01', devise: 'EUR', taux: '20', date: '2027-10-20' },
        { code: 'MEN', montant: '92.13', devise: 'EUR', taux: '10', date: '2027-10-20' },
        { code: 'MEN', montant: '58.9', devise: 'EUR', taux: '5.5', date: '2027-10-20' },
        { code: 'MEN', montant: '13.96', devise: 'EUR', taux: '0', date: '2027-10-20' },
      ],
    }),
  },
  {
    fichier: 'contre-passation.xml',
    lu: statutLu({
      code: '212', reference: 'F2027-0043', messageId: '0b6c7f0e-3a51-4c11-9d2e-5f0000000003', emisLe: '20271120110000',
      createurRole: 'SE', dateStatut: '2027-10-28',
      commentaire: 'Chèque revenu impayé : « provision insuffisante » & frais < 5 €.',
      montants: [
        { code: 'MEN', montant: '-335.01', devise: 'EUR', taux: '20', date: '2027-10-28' },
        { code: 'MEN', montant: '-92.13', devise: 'EUR', taux: '10', date: '2027-10-28' },
        { code: 'MEN', montant: '-58.9', devise: 'EUR', taux: '5.5', date: '2027-10-28' },
        { code: 'MEN', montant: '-13.96', devise: 'EUR', taux: '0', date: '2027-10-28' },
      ],
    }),
  },
]

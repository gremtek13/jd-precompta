// Les encaissements FICTIFS du message du statut « Encaissée » (cdarEncaissee.ts) : le vendeur des factures d'exemple
// de la facture électronique (identifiants valides par leur clé mais inventés), des factures et des encaissements de
// démonstration, des matricules de plateforme inventés (999x). Ils servent aux tests du module (cdarEncaissee.test.ts),
// à son garde de copie (cdarEncaisseeCopie.test.ts), et serviront à celui des Edge Functions qui le recopieront (d6,
// d8) : un exemple ajouté ici est éprouvé des deux côtés sans qu'on ait à y penser.
import type {
  ChoixCdar, DonneesCdar, EncaissementPourCdar, FacturePourCdar, LignePourCdar, PartieCdar, PartPourCdar,
} from '../lib/cdarEncaissee'
import { SIRET_VENDEUR } from './facturesCii'

export const SIREN_VENDEUR_CDAR = '123456782'
export const NOM_VENDEUR_CDAR = 'Atelier Démo Conseil'
export const MATRICULE_PLATEFORME = '9991'
export const MATRICULE_AUTRE_PLATEFORME = '9992'

export const VENDEUR_SIREN: PartieCdar = { identifiant: SIREN_VENDEUR_CDAR, schema: '0002', nom: NOM_VENDEUR_CDAR, role: 'SE' }
export const VENDEUR_SIRET: PartieCdar = { identifiant: SIRET_VENDEUR, schema: '0009', nom: NOM_VENDEUR_CDAR, role: 'SE' }
export const PLATEFORME: PartieCdar = { identifiant: MATRICULE_PLATEFORME, schema: '0238', nom: null, role: 'WK' }
export const AUTRE_PLATEFORME: PartieCdar = { identifiant: MATRICULE_AUTRE_PLATEFORME, schema: '0238', nom: 'Plateforme Fictive', role: 'WK' }
export const PLATEFORME_ADMINISTRATION: PartieCdar = { identifiant: '9999', schema: '0238', nom: null, role: 'DFH' }

export function factureCdar(o: Partial<FacturePourCdar> = {}): FacturePourCdar {
  return {
    id: 'facture-42',
    statut: 'validee',
    type: 'facture',
    numero: 'F2027-0042',
    date_emission: '2027-10-01',
    emetteur_siret: SIRET_VENDEUR,
    ...o,
  }
}

export function ligneCdar(taux: number, factureId = 'facture-42'): LignePourCdar {
  return { facture_id: factureId, taux_tva: taux }
}

export function encaissementCdar(o: Partial<EncaissementPourCdar> = {}): EncaissementPourCdar {
  return {
    id: 'encaissement-1',
    facture_id: 'facture-42',
    date_encaissement: '2027-10-15',
    montant: 1200,
    annule_id: null,
    motif: null,
    retire_le: null,
    ...o,
  }
}

export function partCdar(taux: number, montant: number, encaissementId = 'encaissement-1'): PartPourCdar {
  return { encaissement_id: encaissementId, taux, montant }
}

export function choixCdar(o: Partial<ChoixCdar> = {}): ChoixCdar {
  return {
    profil: 'urn.cpro.gouv.fr:1p0:CDV:einvoicingF2',
    emetteur: VENDEUR_SIREN,
    createur: VENDEUR_SIREN,
    destinataires: [PLATEFORME],
    dateEncaissement: 'MDT-110',
    fuseau: 'Europe/Paris',
    ...o,
  }
}

// Un encaissement de 1 200,00 € d'une facture à un seul taux (1 000,00 € HT à 20 %), message parti le 05/11/2027 à
// 9 h 30 à Paris.
export function donneesCdar(o: Partial<DonneesCdar> = {}): DonneesCdar {
  return {
    facture: factureCdar(),
    lignes: [ligneCdar(20)],
    encaissement: encaissementCdar(),
    parts: [partCdar(20, 1200)],
    identifiant: '0b6c7f0e-3a51-4c11-9d2e-5f0000000001',
    maintenant: new Date('2027-11-05T08:30:00Z'),
    receptionFacture: new Date('2027-10-01T07:15:00Z'),
    choix: choixCdar(),
    ...o,
  }
}

// La facture à quatre taux : 1 000,00 € HT à 20 %, 300,00 € à 10 %, 200,00 € à 5,5 % et 50,00 € à 0 %, soit 1 791,00 €
// TTC. Un encaissement partiel de 500,00 € se répartit au prorata des restes (décision du cabinet du 08/10/2026, Q3,
// `repartitionProposee`) : 335,01 €, 92,13 €, 58,90 € et 13,96 €.
const FACTURE_QUATRE_TAUX = factureCdar({ id: 'facture-43', numero: 'F2027-0043' })
const LIGNES_QUATRE_TAUX = [20, 10, 5.5, 0].map((t) => ligneCdar(t, 'facture-43'))
const PARTIEL: EncaissementPourCdar = encaissementCdar({ id: 'encaissement-2', facture_id: 'facture-43', montant: 500, date_encaissement: '2027-10-20' })
const PARTS_DU_PARTIEL = [partCdar(5.5, 58.9, 'encaissement-2'), partCdar(20, 335.01, 'encaissement-2'), partCdar(0, 13.96, 'encaissement-2'), partCdar(10, 92.13, 'encaissement-2')]

export interface ExempleCdar {
  nom: string
  donnees: DonneesCdar
}

// Un cas par refus du module, chacun seul : le garde des copies les fait passer par la copie ET par l'original, si bien
// que chaque branche de `refusMessageEncaissee` est éprouvée des deux côtés. cdarEncaissee.test.ts dit, lui, le message
// exact de chacun.
const contrePasse = (o: Partial<EncaissementPourCdar>): Partial<DonneesCdar> => ({
  encaissement: encaissementCdar({ montant: -1200, annule_id: 'encaissement-0', motif: 'Erreur de saisie.', ...o }),
  parts: [partCdar(20, -1200)],
})
const PARTIE_SANS_NOM: PartieCdar = { ...VENDEUR_SIREN, nom: null }
export const CAS_DE_REFUS_CDAR: [string, Partial<DonneesCdar>][] = [
  ['retiré', { encaissement: encaissementCdar({ retire_le: '2027-10-16T08:00:00Z' }) }],
  ['autre facture', { encaissement: encaissementCdar({ facture_id: 'facture-autre' }) }],
  ['brouillon', { facture: factureCdar({ statut: 'brouillon' }) }],
  ['sans numéro', { facture: factureCdar({ numero: null }) }],
  ['numéro non admis', { facture: factureCdar({ numero: 'F2027 0042 !' }) }],
  ['avoir', { facture: factureCdar({ type: 'avoir' }) }],
  ['date d’émission fausse', { facture: factureCdar({ date_emission: '2027-02-29' }) }],
  ['SIRET sans SIREN', { facture: factureCdar({ emetteur_siret: null }) }],
  ['montant hors centime', { encaissement: encaissementCdar({ montant: 1200.005 }) }],
  ['montant nul', { encaissement: encaissementCdar({ montant: 0 }) }],
  ['signe contredit', { encaissement: encaissementCdar({ montant: -1200 }), parts: [partCdar(20, -1200)] }],
  ['motif absent', contrePasse({ motif: null })],
  ['motif d’espaces', contrePasse({ motif: '   ' })],
  ['motif trop long', contrePasse({ motif: 'x'.repeat(2001) })],
  ['motif d’un encaissement', { encaissement: encaissementCdar({ motif: 'Note' }) }],
  ['date d’encaissement fausse', { encaissement: encaissementCdar({ date_encaissement: '2027-13-01' }) }],
  ['date d’encaissement à venir', { encaissement: encaissementCdar({ date_encaissement: '2027-11-06' }) }],
  ['sans répartition', { parts: [] }],
  ['taux non admis', { lignes: [ligneCdar(19)], parts: [partCdar(19, 1200)] }],
  ['taux hors facture', { parts: [partCdar(10, 1200)] }],
  ['taux répété', { parts: [partCdar(20, 600), partCdar(20, 600)] }],
  ['part hors centime', { parts: [partCdar(20, 1199.995)] }],
  ['part nulle', { lignes: [ligneCdar(20), ligneCdar(10)], parts: [partCdar(20, 1200), partCdar(10, 0)] }],
  ['part de signe contraire', { lignes: [ligneCdar(20), ligneCdar(10)], parts: [partCdar(20, 1300), partCdar(10, -100)] }],
  ['somme fausse', { parts: [partCdar(20, 1000)] }],
  ['identifiant', { identifiant: 'a  b' }],
  ['instant du message', { maintenant: new Date(Number.NaN) }],
  ['instant de réception', { receptionFacture: new Date(Number.NaN) }],
  ['reçue après le message', { receptionFacture: new Date('2027-11-05T08:30:01Z') }],
  ['reçue avant l’émission', { receptionFacture: new Date('2027-09-30T21:59:59Z') }],
  ['profil inconnu', { choix: choixCdar({ profil: 'urn:inconnu' as ChoixCdar['profil'] }) }],
  ['porteur inconnu', { choix: choixCdar({ dateEncaissement: 'MDT-78' as ChoixCdar['dateEncaissement'] }) }],
  ['fuseau inconnu', { choix: choixCdar({ fuseau: 'America/Cayenne' as ChoixCdar['fuseau'] }) }],
  ['schéma inconnu', { choix: choixCdar({ emetteur: { ...VENDEUR_SIREN, schema: '0088' as PartieCdar['schema'] } }) }],
  ['SIREN faux', { choix: choixCdar({ emetteur: { ...VENDEUR_SIREN, identifiant: '123456789' } }) }],
  ['SIRET faux', { choix: choixCdar({ createur: { ...VENDEUR_SIRET, identifiant: SIREN_VENDEUR_CDAR } }) }],
  ['matricule faux', { choix: choixCdar({ destinataires: [{ ...PLATEFORME, identifiant: '999' }] }) }],
  ['rôle inconnu', { choix: choixCdar({ emetteur: { ...VENDEUR_SIREN, role: 'BY' as PartieCdar['role'] } }) }],
  ['raison sociale absente', { choix: choixCdar({ createur: PARTIE_SANS_NOM }) }],
  ['raison sociale trop longue', { choix: choixCdar({ createur: { ...VENDEUR_SIREN, nom: 'x'.repeat(151) } }) }],
  ['partie absente', { choix: choixCdar({ emetteur: null as unknown as PartieCdar }) }],
  ['sans destinataire', { choix: choixCdar({ destinataires: [] }) }],
]

// Les exemples figés dans outils/facturation/cdar/exemples/, que outils/facturation/cdar/valider.mjs fait juger par le
// schéma CDAR D22B. Ensemble, ils passent chaque forme du message devant le schéma : un taux et quatre (0 % compris),
// un encaissement et une contre-passation (montants négatifs, motif à échapper), les deux profils, les trois porteurs
// de la date, les deux fuseaux, un vendeur désigné par son SIREN et par son SIRET, une plateforme émettrice, deux
// destinataires dont celle de l'administration.
export const EXEMPLES_CDAR: ExempleCdar[] = [
  { nom: 'encaissement-un-taux', donnees: donneesCdar() },
  {
    nom: 'encaissement-plusieurs-taux',
    donnees: donneesCdar({
      facture: FACTURE_QUATRE_TAUX,
      lignes: LIGNES_QUATRE_TAUX,
      encaissement: PARTIEL,
      parts: PARTS_DU_PARTIEL,
      identifiant: '0b6c7f0e-3a51-4c11-9d2e-5f0000000002',
      // Minuit passé à Paris, pas encore à Greenwich : le 06/11 à Paris, le 05/11 en UTC.
      maintenant: new Date('2027-11-05T23:30:00Z'),
      receptionFacture: new Date('2027-10-01T22:30:00Z'),
      choix: choixCdar({
        profil: 'urn:cpro.gouv.fr:1p0:CDV:invoice',
        emetteur: PLATEFORME,
        createur: VENDEUR_SIRET,
        destinataires: [AUTRE_PLATEFORME, PLATEFORME_ADMINISTRATION],
        dateEncaissement: 'MDT-219',
        fuseau: 'UTC',
      }),
    }),
  },
  {
    nom: 'contre-passation',
    donnees: donneesCdar({
      facture: FACTURE_QUATRE_TAUX,
      lignes: LIGNES_QUATRE_TAUX,
      encaissement: encaissementCdar({
        id: 'encaissement-3',
        facture_id: 'facture-43',
        montant: -500,
        date_encaissement: '2027-10-28',
        annule_id: 'encaissement-2',
        motif: 'Chèque revenu impayé : « provision insuffisante » & frais < 5 €.',
      }),
      parts: PARTS_DU_PARTIEL.map((p) => partCdar(p.taux, -p.montant, 'encaissement-3')),
      identifiant: '0b6c7f0e-3a51-4c11-9d2e-5f0000000003',
      maintenant: new Date('2027-11-20T10:00:00Z'),
      receptionFacture: new Date('2027-10-01T22:30:00Z'),
      choix: choixCdar({ dateEncaissement: 'MDT-110 et MDT-219' }),
    }),
  },
]

// LES DOCUMENTS ET LES DEMANDES DU CABINET, À L'ÉCRAN (espace client, ligne 51.5, étape B3a ; la base : B2,
// lib/documentsEtDemandes.ts). Ce module dit ce que les écrans montrent — les lignes telles que la base les rend, qui a
// ouvert un document, ce qu'une confirmation nomme, ce qu'un client peut joindre à sa réponse — sans lire ni écrire : la
// lecture vit dans lib/documentsEtDemandesLecture.ts, les gestes dans les écrans et lib/documentsEtDemandesEcriture.ts.
// Les écrans ne se montent que sous `DOCUMENTS_ET_DEMANDES_PREVUS`, baissé tant que la migration n'est pas en base.
//
// Ce que le CLIENT lit ici se dit à lui, au tutoiement, sans un mot du cabinet (MOTS_DU_CABINET, lib/espaceVentes.ts) :
// documentsEtDemandesVue.test.ts passe chacune de ses phrases au garde des mots.

import {
  CE_QU_ATTEND_UNE_DEMANDE, etatDUneDemande, MOTIFS_DE_CLOTURE, NATURES_DES_DOCUMENTS, type EtatDUneDemande,
} from './documentsEtDemandes'

// ── Les lignes, telles que la migration les pose ──────────────────────────────────────────────────────────────────────
export interface DocumentDuCabinet {
  id: string
  dossier_id: string
  titre: string
  nature: string
  exercice: number | null
  chemin: string
  nom_fichier: string
  sha256: string
  taille: number
  type_mime: string
  publie_par: string
  publie_le: string
  retire_par: string | null
  retire_le: string | null
}

export interface LectureDUnDocument {
  id: string
  dossier_id: string
  document_id: string
  lecteur: string
  lu_le: string
}

export interface DemandeDuCabinet {
  id: string
  dossier_id: string
  objet: string
  detail: string | null
  echeance: string | null
  attendu: string
  auteur: string
  ouverte_le: string
  close_par: string | null
  close_le: string | null
  motif_de_cloture: string | null
}

export interface ReponseALaDemande {
  id: string
  dossier_id: string
  demande_id: string
  auteur: string
  texte: string | null
  fichier: string | null
  piece_id: string | null
  document_id: string | null
  fichier_sha256: string | null
  ecrite_le: string
}

export interface RelanceDeLaDemande {
  id: string
  dossier_id: string
  demande_id: string
  canal: string
  email_id: string | null
  relancee_par: string
  relancee_le: string
}

/** Un accès du dossier, tel que le cabinet le lit (`memberships`) : le compte, son adresse, sa case « Documents ». */
export interface AccesDuDossier {
  user_id: string
  email: string | null
  droit_documents: boolean | null
}

/** Un dépôt du chemin d'aujourd'hui, qu'une réponse peut citer : une pièce ou un document du dossier. */
export interface DepotCitable {
  genre: 'piece' | 'document'
  id: string
  nom_fichier: string
  created_at: string
}

// ── Les mots d'une ligne ──────────────────────────────────────────────────────────────────────────────────────────────
/** La nature d'un document dite, ou « nature inconnue » — jamais une valeur devinée. */
export function natureDite(nature: string): string {
  return nature in NATURES_DES_DOCUMENTS ? NATURES_DES_DOCUMENTS[nature as keyof typeof NATURES_DES_DOCUMENTS] : 'Nature inconnue'
}

/** Ce qu'une demande attend, dit. */
export function attenduDit(attendu: string): string {
  return attendu in CE_QU_ATTEND_UNE_DEMANDE ? CE_QU_ATTEND_UNE_DEMANDE[attendu as keyof typeof CE_QU_ATTEND_UNE_DEMANDE] : 'Inconnu'
}

/** Le motif d'une clôture, dit. */
export function motifDit(motif: string | null): string {
  return motif !== null && motif in MOTIFS_DE_CLOTURE ? MOTIFS_DE_CLOTURE[motif as keyof typeof MOTIFS_DE_CLOTURE] : 'Motif inconnu'
}

/** Le titre d'un document, avec sa nature et son exercice : « Liasse 2025 — La liasse fiscale, exercice 2025 ». */
export function documentDit(d: Pick<DocumentDuCabinet, 'titre' | 'nature' | 'exercice'>): string {
  return `« ${d.titre} » — ${natureDite(d.nature)}${d.exercice === null ? '' : `, exercice ${d.exercice}`}`
}

// ── Qui a ouvert un document (côté cabinet) ──────────────────────────────────────────────────────────────────────────
export interface OuvertureDite {
  /** L'adresse de l'accès ; nulle quand le compte n'est plus un accès du dossier (son accès retiré). */
  email: string | null
  lu_le: string
}

/**
 * Les premières ouvertures d'un document, par ordre de date, chacune sous l'adresse de son accès. Un compte qui n'est plus
 * un accès du dossier se dit sans adresse : la preuve reste, l'adresse ne se devine pas.
 */
export function ouverturesDuDocument(
  documentId: string, lectures: readonly LectureDUnDocument[], acces: readonly AccesDuDossier[],
): OuvertureDite[] {
  const parCompte = new Map(acces.map((a) => [a.user_id, a.email]))
  return lectures
    .filter((l) => l.document_id === documentId)
    .sort((a, b) => Date.parse(a.lu_le) - Date.parse(b.lu_le) || (a.id < b.id ? -1 : 1))
    .map((l) => ({ email: parCompte.get(l.lecteur) ?? null, lu_le: l.lu_le }))
}

/** Les accès qui portent la case « Documents » : ceux qui liront un document publié. */
export function lecteursDesDocuments(acces: readonly AccesDuDossier[]): string[] {
  return acces.filter((a) => a.droit_documents === true).map((a) => a.email ?? 'un accès sans adresse lue')
}

// ── Ce que nomment les confirmations du cabinet ───────────────────────────────────────────────────────────────────────
export interface Confirmation {
  titre: string
  paragraphes: readonly string[]
  bouton: string
}

/** Publier : le document, son fichier, et QUI le lira — les accès « Documents » lus en entier, ou personne. */
export function confirmationDeLaPublication(
  saisie: { titre: string; nature: string; exercice: number | null }, nomFichier: string, lecteurs: readonly string[],
): Confirmation {
  return {
    titre: `Publier ${documentDit(saisie)}`,
    paragraphes: [
      `Le fichier « ${nomFichier} » se dépose dans l’espace privé des documents du dossier, sous son empreinte : son nom n’y va pas, il reste dans la liste.`,
      lecteurs.length === 0
        ? 'Aucun accès de ce dossier ne porte la case « Documents » : personne ne le lira tant que tu ne la coches pas sur un accès (onglet Accès client).'
        : `Le liront, dans leur espace : ${lecteurs.join(', ')} — les accès qui portent la case « Documents ». Leur première ouverture se date.`,
      'Un document publié ne se modifie pas : pour le corriger, retire-le et publie le bon.',
    ],
    bouton: 'Déposer et publier',
  }
}

/** Retirer : le document, et ce qui reste — le fichier, la ligne, la preuve de ses lectures (nul : non comptée, ouvertures lues en partie). */
export function confirmationDuRetrait(document: DocumentDuCabinet, nombreDOuvertures: number | null): Confirmation {
  return {
    titre: `Retirer ${documentDit(document)}`,
    paragraphes: [
      'Les accès « Documents » ne le liront plus. Le retrait ne se défait pas : pour le remettre, publie-le de nouveau.',
      nombreDOuvertures === null
        ? 'Le fichier, la ligne et la preuve de ses ouvertures restent au dossier.'
        : nombreDOuvertures === 0
        ? 'Personne ne l’a encore ouvert. Le fichier et la ligne restent au dossier.'
        : `Le fichier, la ligne et la preuve de ${nombreDOuvertures === 1 ? 'sa première ouverture' : `ses ${nombreDOuvertures} premières ouvertures`} restent au dossier.`,
    ],
    bouton: 'Retirer le document',
  }
}

/** Clore : la demande, le motif, et ce que la clôture change (plus de réponse, plus de relance). */
export function confirmationDeLaCloture(demande: Pick<DemandeDuCabinet, 'objet'>, motif: string): Confirmation {
  return {
    titre: `Clore la demande « ${demande.objet} »`,
    paragraphes: [
      `Motif : ${motifDit(motif)}.`,
      'Une demande close ne se rouvre pas : le client n’y répond plus, et elle ne se relance plus. Les réponses déjà écrites restent.',
      ...(motif === 'remplacee' ? ['Ouvre ensuite la demande qui la remplace : une demande ne se modifie pas.'] : []),
    ],
    bouton: 'Clore la demande',
  }
}

// ── Les demandes et leurs états ───────────────────────────────────────────────────────────────────────────────────────
export interface DemandeDite {
  demande: DemandeDuCabinet
  etat: EtatDUneDemande
  reponses: ReponseALaDemande[]
  relances: RelanceDeLaDemande[]
}

/**
 * Chaque demande avec son état DÉDUIT, ses réponses et ses relances par ordre de date — sur des listes lues EN ENTIER :
 * l'appelant ne l'appelle qu'alors (l'état « ouverte » d'une demande dont une réponse manquerait mentirait). Les demandes
 * ouvertes d'abord (en retard, puis ouvertes, puis répondues), les closes ensuite, chaque groupe de la plus récente à la
 * plus ancienne.
 */
export function demandesDites(
  demandes: readonly DemandeDuCabinet[], reponses: readonly ReponseALaDemande[], relances: readonly RelanceDeLaDemande[],
  aujourdhui: string,
): DemandeDite[] {
  const parDate = <T extends { id: string }>(date: (x: T) => string) => (a: T, b: T) =>
    Date.parse(date(a)) - Date.parse(date(b)) || (a.id < b.id ? -1 : 1)
  const rang: Record<EtatDUneDemande, number> = { en_retard: 0, ouverte: 1, repondue: 2, close: 3 }
  return demandes
    .map((demande) => {
      const siennes = reponses.filter((r) => r.demande_id === demande.id).sort(parDate((r) => r.ecrite_le))
      return {
        demande,
        etat: etatDUneDemande(demande, siennes.length, aujourdhui),
        reponses: siennes,
        relances: relances.filter((r) => r.demande_id === demande.id).sort(parDate((r) => r.relancee_le)),
      }
    })
    .sort((a, b) => rang[a.etat] - rang[b.etat] || parDate<DemandeDuCabinet>((d) => d.ouverte_le)(b.demande, a.demande))
}

/** Ce qu'une réponse a joint, dit — y compris quand le cabinet a supprimé le dépôt depuis (B2-Q3). */
export function fichierDeLaReponseDit(r: ReponseALaDemande, nomDuDepot: string | null): string | null {
  if (r.fichier === null) return null
  const genre = r.fichier === 'piece' ? 'une pièce' : 'un document'
  const lien = r.fichier === 'piece' ? r.piece_id : r.document_id
  if (lien === null) return `Un fichier était joint (${genre}) ; il n’est plus au dossier.`
  return nomDuDepot === null ? `Fichier joint : ${genre}.` : `Fichier joint : « ${nomDuDepot} ».`
}

// ── Côté client ───────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Ce que le client peut joindre à sa réponse, comme la base le juge (`repondre_a_la_demande`) : une pièce qu'il a déposée
 * lui-même, ou un document du dossier, depuis l'ouverture de la demande, qu'aucune réponse ne cite encore. Les plus
 * récents d'abord. Sur des listes lues en entier seulement : l'appelant n'offre rien sinon.
 */
export function depotsCitables(
  demande: Pick<DemandeDuCabinet, 'ouverte_le'>,
  pieces: readonly { id: string; nom_fichier: string; created_at: string; uploaded_by: string | null }[],
  documents: readonly { id: string; nom_fichier: string; created_at: string }[],
  reponses: readonly ReponseALaDemande[],
  moi: string,
): DepotCitable[] {
  const depuis = Date.parse(demande.ouverte_le)
  const pieceCitee = new Set(reponses.map((r) => r.piece_id).filter((x): x is string => x !== null))
  const documentCite = new Set(reponses.map((r) => r.document_id).filter((x): x is string => x !== null))
  const rendus: DepotCitable[] = [
    ...pieces
      .filter((p) => p.uploaded_by === moi && Date.parse(p.created_at) >= depuis && !pieceCitee.has(p.id))
      .map((p) => ({ genre: 'piece' as const, id: p.id, nom_fichier: p.nom_fichier, created_at: p.created_at })),
    ...documents
      .filter((d) => Date.parse(d.created_at) >= depuis && !documentCite.has(d.id))
      .map((d) => ({ genre: 'document' as const, id: d.id, nom_fichier: d.nom_fichier, created_at: d.created_at })),
  ]
  return rendus.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || (a.id < b.id ? -1 : 1))
}

/** Qui a écrit une réponse, dit au client : lui, ou un autre accès de son dossier — jamais un nom deviné. */
export function auteurDitAuClient(auteur: string, moi: string): string {
  return auteur === moi ? 'Toi' : 'Un autre accès de ton dossier'
}

/** La phrase d'en-tête de « Mes documents ». */
export const PRESENTATION_DE_MES_DOCUMENTS = 'Les documents que ton cabinet met à ta disposition : ta 2035, ta liasse, tes '
  + 'comptes annuels, une attestation, ta lettre de mission, un courrier. Ton cabinet voit que tu as ouvert un document, et '
  + 'quand : la première fois seulement.'

/** La phrase d'en-tête de « Mes demandes ». */
export const PRESENTATION_DE_MES_DEMANDES = 'Ce que ton cabinet te demande. Pour joindre un fichier, dépose-le d’abord dans '
  + '« Mes pièces », puis choisis-le ici. Ta réponse ne se modifie pas une fois envoyée ; tu peux en envoyer une autre tant '
  + 'que la demande n’est pas close.'

/** Ce que dit « Mes documents » à un accès qui ne porte plus « Documents » sur la société affichée. */
export const SANS_LA_CASE_DOCUMENTS = 'Ton accès ne porte plus « Documents » sur cette société : ses documents ne s’affichent '
  + 'pas ici. Pour les retrouver, demande à ton cabinet d’ajouter « Documents » à ton accès.'

// ── Les entrées de l'espace client ────────────────────────────────────────────────────────────────────────────────────
/**
 * « Mes documents » existe-t-il ? Avec la migration (`DOCUMENTS_ET_DEMANDES_PREVUS`) ET la case « Documents » sur la
 * société AFFICHÉE, lue à la connexion ; l'écran la relit à la base. Sans elle, la RLS rendrait les documents VIDES.
 */
export function mesDocumentsOuverts(migrationEnBase: boolean, droitDocuments: boolean): boolean {
  return migrationEnBase && droitDocuments
}

/** « Mes demandes » existe-t-il ? Avec la migration seulement : tout accès du dossier lit ses demandes (MEG2-Q9). */
export function mesDemandesOuvertes(migrationEnBase: boolean): boolean {
  return migrationEnBase
}

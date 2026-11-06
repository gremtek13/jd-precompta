import { contenuADeclarer, type ContenuDeclare } from './declarationsEreporting'
import { offreDeDeclaration, type LigneDePeriode } from './ereportingEcran'
import {
  fichierFrr, refusFichierFrr, type ChoixFrr, type DeclarationPourFrr, type DonneesFrr, type RefusFrr, type ResultatFrr,
} from './fluxEreporting'
import type { ObjetEreporting, PeriodeEreporting } from './periodesEreporting'
import type { DeclarationEreportingHorsApplication, Dossier } from './types'

// LE FICHIER D'UNE DÉCLARATION D'E-REPORTING, À L'ÉCRAN (ligne 28.5, étape e6b). Ce que la fenêtre de l'e-reporting donne au
// module du fichier (lib/fluxEreporting.ts, étape e6), qui écrit le XML du flux 10 de la DGFiP depuis le CONTENU FIGÉ d'une
// déclaration — jamais un recalcul — et dit ses refus avant le clic (`refusFichierFrr`). Pur : ni base, ni horloge, ni DOM ;
// le téléchargement est un Blob local, aucun appel réseau.
//
// L'ORDRE (E6-Q8, décision du cabinet du 18/10/2026) : le fichier se télécharge, se dépose sur la plateforme, PUIS la
// déclaration s'inscrit. Son identifiant de transmission (TT-1) est donc TIRÉ au téléchargement (un UUID), puis DONNÉ à la
// base avec la déclaration, qui garde aussi le contenu même du fichier : ce que la plateforme a reçu est ce que la base
// fige. Le fichier d'une déclaration déjà inscrite se retire de son contenu figé, sous l'identifiant qu'elle garde ; une
// déclaration inscrite sans fichier n'en a pas (son identifiant ne se sait pas), et une remplacée se refuse (E6-Q6).
//
// LES CHOIX DU CABINET (18/10/2026, tous à la recommandation) : l'émetteur (TG-3) est la plateforme du dossier — celle que
// la première plateforme essayée dira, à défaut celle du dossier (E6-Q1) —, sous son matricule de l'annuaire, que
// l'application ne connaît pas : le cabinet le saisit, et sans lui rien ne s'écrit (le paramètre reste sans défaut) ;
// l'horodatage à Paris (E6-Q2) ; le code 5 pour l'option sur les débits (E6-Q3) ; un paiement négatif écrit avec son signe
// (E6-Q4) ; la raison sociale du déclarant telle que le dossier la porte au moment du fichier (E6-Q5). E6-Q7 (le motif des
// parts AE, K, G et O) attend le premier essai réel.

export const FUSEAU_DU_FICHIER = 'Europe/Paris' satisfies ChoixFrr['fuseau']
export const CODE_OPTION_DEBITS_DU_FICHIER = '5' satisfies ChoixFrr['codeOptionDebits']
export const PAIEMENTS_NEGATIFS_DU_FICHIER = 'ecrits_avec_leur_signe' satisfies ChoixFrr['paiementsNegatifs']

/** Ce que le cabinet saisit pour l'émetteur : le matricule de la plateforme du dossier (quatre chiffres) et son nom — celui
 * sous lequel la déclaration s'inscrira. */
export interface SaisieDeLEmetteur {
  matricule: string
  plateforme: string
}

/** Les choix du fichier : l'émetteur saisi, sous le schéma 0238 et le rôle WK d'une plateforme (G6.22, G7.51), et les trois
 * choix tranchés. */
export function choixDuFichier(saisie: SaisieDeLEmetteur): ChoixFrr {
  return {
    emetteur: { identifiant: saisie.matricule.trim(), schema: '0238', nom: saisie.plateforme.trim(), role: 'WK' },
    fuseau: FUSEAU_DU_FICHIER,
    codeOptionDebits: CODE_OPTION_DEBITS_DU_FICHIER,
    paiementsNegatifs: PAIEMENTS_NEGATIFS_DU_FICHIER,
  }
}

/** Le fichier qu'une période à déclarer fait déposer : le contenu qu'elle figera, sous l'identifiant tiré, initial ou
 * rectificatif selon l'offre de la ligne. Nul quand la ligne ne se déclare pas. */
export interface FichierADeposer {
  declaration: DeclarationPourFrr & { contenu: ContenuDeclare }
}

export function fichierADeposer(l: LigneDePeriode, identifiant: string): FichierADeposer | null {
  const offre = offreDeDeclaration(l)
  const contenu = contenuADeclarer(l.calcul)
  if (offre.genre === 'aucune' || contenu == null) return null
  const rectificative = offre.genre === 'rectificative'
  return {
    declaration: {
      id: identifiant, objet: l.objet, periode_debut: l.periode.debut, periode_fin: l.periode.fin,
      type_transmission: rectificative ? 'RE' : 'IN', remplace_id: rectificative ? l.active?.id ?? null : null, etat: 'declaree', contenu,
    },
  }
}

/** Le fichier d'une déclaration inscrite, tiré de son contenu FIGÉ sous l'identifiant qu'elle garde ; nul quand elle a été
 * inscrite sans fichier tiré d'ici. */
export function declarationDuFichierInscrit(
  d: Pick<DeclarationEreportingHorsApplication, 'objet' | 'periode_debut' | 'periode_fin' | 'type_transmission' | 'remplace_id' | 'etat' | 'contenu'>
    & Partial<Pick<DeclarationEreportingHorsApplication, 'identifiant_fichier'>>,
): DeclarationPourFrr | null {
  if (d.identifiant_fichier == null) return null
  return {
    id: d.identifiant_fichier, objet: d.objet, periode_debut: d.periode_debut, periode_fin: d.periode_fin,
    type_transmission: d.type_transmission, remplace_id: d.remplace_id, etat: d.etat, contenu: d.contenu,
  }
}

/** Ce que le module du fichier reçoit : la déclaration, la raison sociale du dossier telle quelle (E6-Q5), l'instant et les
 * choix. */
export function donneesDuFichier(
  declaration: DeclarationPourFrr, dossier: Pick<Dossier, 'denomination_imprimee'>, saisie: SaisieDeLEmetteur, maintenant: Date,
): DonneesFrr {
  return { declaration, nomDuDeclarant: dossier.denomination_imprimee ?? '', maintenant, choix: choixDuFichier(saisie) }
}

// Où se corrige ce que le module refuse, quand l'écran le sait.
const OU_CORRIGER: Partial<Record<RefusFrr['cle'], string>> = {
  nom_du_declarant: 'La dénomination du dossier se saisit dans l’onglet Informations (« Identité du dossier »).',
  emetteur_matricule: 'Saisissez le matricule de la plateforme : quatre chiffres, ceux de l’annuaire de la facturation électronique.',
  emetteur_nom: 'Nommez la plateforme sur laquelle le fichier se dépose.',
}

/** Les refus du fichier, dits avant le clic : ceux du module, dans son ordre, chacun avec où le corriger. Vide : il s'écrit. */
export function refusDuFichier(d: DonneesFrr): string[] {
  return refusFichierFrr(d).map((r) => (OU_CORRIGER[r.cle] ? `${r.message} ${OU_CORRIGER[r.cle]}` : r.message))
}

/** Le fichier lui-même : le XML, ou les refus. */
export function fichierDeLaDeclaration(d: DonneesFrr): ResultatFrr {
  return fichierFrr(d)
}

/** « e-reporting-paiements-2027-10-01-2027-10-31.xml » : l'objet et la période — « -rectificative » pour une rectificative
 * —, jamais le nom du dossier. */
export function nomDuFichierFrr(objet: ObjetEreporting, periode: Pick<PeriodeEreporting, 'debut' | 'fin'>, type: string): string {
  return `e-reporting-${objet}-${periode.debut}-${periode.fin}${type === 'RE' ? '-rectificative' : ''}.xml`
}

/** Ce que la déclaration dit du fichier téléchargé dans la fenêtre, avant le clic : la base gardera son identifiant et son
 * contenu — celui que la plateforme a reçu, même si l'application calcule autre chose depuis. */
export function phraseDuFichierTire(nom: string, identifiant: string, changeDepuis: boolean): string {
  return `Le fichier « ${nom} » (identifiant ${identifiant}) a été téléchargé dans cette fenêtre : la déclaration gardera son `
    + 'identifiant et le contenu qu’il porte.'
    + (changeDepuis
      ? ' Ce que l’application calcule a changé depuis : la déclaration garde ce que le fichier déposé porte, et la période se dira « à rectifier ».'
      : '')
}

/** Sans fichier téléchargé dans la fenêtre, la déclaration s'inscrit sans identifiant de fichier : le dire avant le clic. */
export const SANS_FICHIER_TIRE = 'Aucun fichier n’a été téléchargé dans cette fenêtre pour cette période : la déclaration '
  + 's’inscrira sans l’identifiant d’un fichier (une période déposée autrement sur la plateforme).'

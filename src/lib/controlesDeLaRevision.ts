import type { DossierTab } from './ongletsDossier'
import type { PointsDeLaChecklist } from './pointsDeLaChecklist'

// LES CONTRÔLES EXISTANTS QUE LA RÉVISION RANGE PAR CYCLE (ligne 41, étape R3 ; conception, § 4.2) : les points de la
// Vue d'ensemble qui ont QUELQUE CHOSE À DIRE, tels qu'elle les dit (lib/pointsDeLaChecklist.ts). La révision ne refait
// aucun contrôle : elle les montre dans le cycle qu'ils concernent (`controlesParCycle`, lib/revisionCycles.ts), avec
// leur nombre et l'onglet où agir. Un module PUR.
//
// Les points à traiter portent sur TOUT le dossier — la Vue d'ensemble les compte ainsi —, et l'écran le dit. Les
// documents attendus d'un exercice (`banque-2025`, `factures-2025`…) ne se rangent que sous la révision de CET
// exercice : un relevé manquant de 2026 ne dit rien des soldes de 2025. Les autres (`informations`, le véhicule, les
// justificatifs à cocher) valent pour tout exercice.
//
// Les préalables de la validation (lib/prealablesValidation.ts) n'y sont pas encore : ils demandent la 2035 de l'exercice
// et sa concordance, que Clôture calcule (étape R6).

export interface ControleExistant {
  id: string
  // Le libellé de la Vue d'ensemble, son nombre devant quand il en compte un.
  libelle: string
  detail: string | null
  cible: DossierTab
  action: string
  gravite: 'erreur' | 'attention'
}

const ANNEE_DU_DOCUMENT = /-(\d{4})$/

export function controlesPourLaRevision(
  points: Pick<PointsDeLaChecklist, 'pointsATraiter' | 'documentsAttendus'>,
  annee: number,
): ControleExistant[] {
  const aTraiter = points.pointsATraiter.map((p): ControleExistant => ({
    id: p.id, libelle: p.sansNombre ? p.label : `${p.nb} ${p.label}`, detail: p.detail ?? null, cible: p.cible,
    action: p.action, gravite: p.severite,
  }))
  const documents = points.documentsAttendus
    .filter((d) => {
      if (d.ok) return false
      const anneeDuDocument = ANNEE_DU_DOCUMENT.exec(d.id)
      return anneeDuDocument === null || Number(anneeDuDocument[1]) === annee
    })
    .map((d): ControleExistant => ({
      id: d.id, libelle: d.label, detail: d.detail ?? null,
      // Un justificatif à cocher n'a pas d'onglet : il se coche dans la Vue d'ensemble.
      cible: d.cible ?? 'checklist', action: d.cible ? (d.action ?? 'Voir') : 'Le cocher dans la Vue d’ensemble',
      gravite: 'attention',
    }))
  return [...aTraiter, ...documents]
}

import { describe, expect, it } from 'vitest'
import { ADRESSES_DES_ACCES_RETIRES_PREVUES } from './adressesDesAccesRetires'
import { ADRESSES_RECEPTION_EXPORTEES } from './adressesReception'
import { ARTICLES_EXPORTES } from './articles'
import { CAISSE_EXPORTEE } from './caisse'
import { COMPTES_BANCAIRES_PREVUS } from './comptesBancaires'
import { CONTACTS_EXPORTES } from './contacts'
import { ACOMPTES_PREVUS, DEVIS_EXPORTES, ENVOI_DES_DEVIS_PREVU } from './devis'
import { EXEMPLAIRES_DES_FACTURES_EXPORTES, JUMELLE_INVERSEE_EXPORTEE } from './exemplairesDesFactures'
import { FACTURES_IMPORTEES_PREVUES } from './facturesImportees'
import { NUMEROTATION_CONTINUE_PREVUE } from './numerotationContinue'
import { PIECE_D_UNE_FACTURE_REPRISE_PREVUE } from './pieceDUneFactureReprise'
import { PARAMETRES_FACTURATION_EXPORTES } from './parametresFacturation'
import { TRACE_DES_DROITS_PREVUE } from './traceDesDroits'
import { SITUATIONS_PUBLIEES_EXPORTEES } from './situationsPubliees'
import { LETTRES_DE_MISSION_PREVUES } from './lettresDeMission'
import { ORIGINAUX_RETENUS_PREVUS } from './originauxRetenus'
import { HONORAIRES_FACTURES_PREVUS } from './honorairesAFacturer'
import { DEPART_DU_CLIENT_PREVU } from './departDuClient'
import { SAISIES_2035_EN_BASE } from './saisies2035'
import { PARAMETRES_DES_COTISATIONS_EXPORTES } from './parametresDesCotisations'
import {
  auGrapheDeLaCaisse,
  auGrapheDeLEnvoiDesDevis,
  auGrapheDesAcomptes,
  auGrapheDesExemplaires,
  auPlan,
  auPlanAujourdHui,
  auPlanDeLaCaisse,
  auPlanDeLaNumerotationContinue, auPlanDeLaPieceDUneFactureReprise,
  auPlanDeLaTraceDesDroits,
  auPlanDesAdressesDesAccesRetires,
  auPlanDesFacturesImportees,
  auPlanDesSituationsPubliees,
  auPlanDesSaisies2035,
  auPlanDesParametresDesCotisations,
  auPlanDesComptesBancaires,
  auGrapheDesComptesBancaires,
  auPlanDesOriginauxLiberes,
  auPlanDesAdressesReception,
  auPlanDesArticles,
  auPlanDesContacts,
  auPlanDesParametresFacturation,
  auPlanDuJournalDesDesignations,
  CHEMINS_DOSSIER,
  CHEMINS_DOSSIER_PREVUS,
  CLES_PRIMAIRES,
  CLES_PRIMAIRES_PREVUES,
  LIENS_GARDES,
  ORDRE_RESTAURATION,
  ORDRE_RESTAURATION_PREVU,
  planExportDossier,
  RELATIONS,
  RELATIONS_PREVUES,
  TABLES_DES_DEVIS,
  tablesSansChemin,
  violationsOrdre, auPlanDesLettresDeMission, auPlanDesHonorairesFactures,
  auPlanDuDepart, TABLES_DU_DEPART,
} from './sauvegarde'

// LES DEVIS AU PLAN DE SAUVEGARDE (espace client, étape P5). Leurs migrations attendent l'accord du cabinet : tant que
// l'export ne les porte pas, le plan effectif ne doit RIEN dire d'eux — une sauvegarde lirait une table absente et
// échouerait —, et le plan PRÉVU doit déjà être juste, pour que lever `DEVIS_EXPORTES` suffise le jour venu. Les tests qui
// confrontent le plan au schéma exporté (`sauvegardeRelations`, `sauvegardeTables`, `sauvegardeClesPrimaires`) jugent
// l'état effectif ; celui-ci juge les deux, et leur lien.

describe('le filtre du plan', () => {
  it('une table des devis n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    for (const table of TABLES_DES_DEVIS) {
      expect(auPlan(table, false), table).toBe(false)
      expect(auPlan(table, true), table).toBe(true)
    }
    for (const table of ['dossiers', 'factures_emises', 'devis_inconnu', 'exercices_valides']) {
      expect(auPlan(table, false), table).toBe(true)
      expect(auPlan(table, true), table).toBe(true)
    }
  })

  it('le plan effectif est le plan prévu filtré par les drapeaux, liste par liste', () => {
    // Depuis l'étape A1, le filtre du jour compose celui des devis et celui des articles (sauvegardeArticles.test.ts) ;
    // depuis l'étape A6a, celui des adresses de réception (sauvegardeAdressesReception.test.ts) ; depuis l'étape A4a, celui
    // des contacts (sauvegardeContacts.test.ts) ; depuis l'étape A5a, celui des paramètres de facturation
    // (sauvegardeParametresFacturation.test.ts) ; depuis l'étape VF1a, le graphe retire aussi la relation de l'exemplaire d'une
    // facture tant que sa migration n'est pas exportée (sauvegardeExemplaires.test.ts) ; depuis l'étape VF6b, celui du journal
    // des désignations (sauvegardeDesignations.test.ts) ; depuis l'étape C2, celui de la caisse, et le graphe retire ses
    // relations — dont celle du brouillon vers une opération — tant que ses migrations ne sont pas exportées
    // (sauvegardeCaisse.test.ts) ; depuis l'étape P6c1, le graphe retire le devis envoyé tant que la migration de l'envoi
    // n'est pas exportée (sauvegardeEnvoiDesDevis.test.ts) ; depuis l'étape P1-trace, celui de la trace des droits
    // (sauvegardeTraceDesDroits.test.ts) ; depuis l'étape A8a, celui des factures reprises (sauvegardeFacturesImportees.test.ts) ;
    // depuis l'étape A9a, celui de la numérotation qui continue (sauvegardeNumerotationContinue.test.ts) ; depuis le lot MCB1,
    // celui des comptes bancaires, et le graphe retire les clés des mouvements et des contrôles vers leur compte
    // (sauvegardeComptesBancaires.test.ts) ; depuis P1T-E2, celui de l'adresse des accès retirés
    // (sauvegardeAdressesDesAccesRetires.test.ts) ; depuis LM7, celui des factures d'honoraires
    // (sauvegardeHonorairesFactures.test.ts) ; depuis INAL5, celui du départ d'un client (sauvegardeDepartDuClient.test.ts).
    for (const table of ORDRE_RESTAURATION_PREVU) {
      expect(auPlanAujourdHui(table), table).toBe(auPlan(table, DEVIS_EXPORTES) && auPlanDesArticles(table, ARTICLES_EXPORTES)
        && auPlanDesAdressesReception(table, ADRESSES_RECEPTION_EXPORTEES) && auPlanDesContacts(table, CONTACTS_EXPORTES)
        && auPlanDesParametresFacturation(table, PARAMETRES_FACTURATION_EXPORTES)
        && auPlanDuJournalDesDesignations(table, JUMELLE_INVERSEE_EXPORTEE) && auPlanDeLaCaisse(table, CAISSE_EXPORTEE)
        && auPlanDeLaTraceDesDroits(table, TRACE_DES_DROITS_PREVUE)
        && auPlanDesAdressesDesAccesRetires(table, ADRESSES_DES_ACCES_RETIRES_PREVUES)
        && auPlanDesSituationsPubliees(table, SITUATIONS_PUBLIEES_EXPORTEES) && auPlanDesSaisies2035(table, SAISIES_2035_EN_BASE)
        && auPlanDesFacturesImportees(table, FACTURES_IMPORTEES_PREVUES)
        && auPlanDeLaNumerotationContinue(table, NUMEROTATION_CONTINUE_PREVUE)
        && auPlanDeLaPieceDUneFactureReprise(table, PIECE_D_UNE_FACTURE_REPRISE_PREVUE)
        && auPlanDesParametresDesCotisations(table, PARAMETRES_DES_COTISATIONS_EXPORTES)
        && auPlanDesComptesBancaires(table, COMPTES_BANCAIRES_PREVUS)
        && auPlanDesLettresDeMission(table, LETTRES_DE_MISSION_PREVUES)
        && auPlanDesOriginauxLiberes(table, ORIGINAUX_RETENUS_PREVUS)
        && auPlanDesHonorairesFactures(table, HONORAIRES_FACTURES_PREVUS)
        && auPlanDuDepart(table, DEPART_DU_CLIENT_PREVU))
    }
    expect(RELATIONS).toEqual(RELATIONS_PREVUES
      .filter((r) => auPlanAujourdHui(r.enfant) && auGrapheDesExemplaires(r, EXEMPLAIRES_DES_FACTURES_EXPORTES)
        && auGrapheDeLaCaisse(r, CAISSE_EXPORTEE) && auGrapheDeLEnvoiDesDevis(r, ENVOI_DES_DEVIS_PREVU)
        && auGrapheDesAcomptes(r, ACOMPTES_PREVUS) && auGrapheDesComptesBancaires(r, COMPTES_BANCAIRES_PREVUS)))
    expect(ORDRE_RESTAURATION).toEqual(ORDRE_RESTAURATION_PREVU.filter((t) => auPlanAujourdHui(t)))
    expect(Object.keys(CHEMINS_DOSSIER)).toEqual(Object.keys(CHEMINS_DOSSIER_PREVUS).filter((t) => auPlanAujourdHui(t)))
    expect(Object.keys(CLES_PRIMAIRES)).toEqual(Object.keys(CLES_PRIMAIRES_PREVUES).filter((t) => auPlanAujourdHui(t)))
  })

  it('drapeau baissé, le plan effectif ne nomme aucune table des devis — drapeau levé, toutes', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...Object.keys(CLES_PRIMAIRES),
    ])
    for (const table of TABLES_DES_DEVIS) expect(nommees.has(table), table).toBe(DEVIS_EXPORTES)
  })
})

describe('le plan prévu, tables des devis comprises', () => {
  it('les trois tables y entrent ensemble : l’ordre, les chemins, le graphe ; la série, sa clé', () => {
    for (const table of TABLES_DES_DEVIS) {
      expect(ORDRE_RESTAURATION_PREVU, table).toContain(table)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      expect(RELATIONS_PREVUES.some((r) => r.enfant === table), table).toBe(true)
    }
    expect(CLES_PRIMAIRES_PREVUES.devis_numerotation).toEqual(['dossier_id', 'annee'])
  })

  it('leurs relations, telles que la migration devis_du_client les déclare', () => {
    const desDevis = RELATIONS_PREVUES.filter((r) => TABLES_DES_DEVIS.includes(r.enfant))
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`)
    expect(desDevis.sort()).toEqual([
      'devis.dossier_id → dossiers (cascade)',
      'devis_factures.devis_id → devis (cascade)',
      'devis_factures.dossier_id → dossiers (cascade)',
      'devis_factures.facture_id → factures_emises (cascade)',
      'devis_numerotation.dossier_id → dossiers (cascade)',
    ])
  })

  it('l’ordre prévu respecte toutes les dépendances, et les chemins se suivent', () => {
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    const plan = planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)
    for (const table of TABLES_DES_DEVIS) expect(plan, table).toContain(table)
  })

  it('juste avant le journal des e-mails, qui cite un devis envoyé (étape P6c1) : la série, les devis, puis leurs liens', () => {
    const debut = ORDRE_RESTAURATION_PREVU.indexOf('devis_numerotation')
    expect(ORDRE_RESTAURATION_PREVU.slice(debut, debut + 4)).toEqual(['devis_numerotation', 'devis', 'devis_factures', 'emails_envoyes'])
    // Les exercices validés en dernier — seules les tables du départ d'un client les suivent (INAL5 : la conservation en
    // cours garde les exercices validés, elle se restaure après eux), qu'aucune garde de la validation ne retient.
    expect(ORDRE_RESTAURATION_PREVU.filter((t) => !TABLES_DU_DEPART.includes(t)).at(-1)).toBe('exercices_valides')
    expect(ORDRE_RESTAURATION_PREVU.slice(ORDRE_RESTAURATION_PREVU.indexOf('exercices_valides') + 1)).toEqual([...TABLES_DU_DEPART])
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(rang('devis_factures')).toBeGreaterThan(rang('factures_emises'))
    expect(rang('devis')).toBeGreaterThan(rang('dossiers'))
  })

  it('un défaut planté se voit : le lien avant son devis', () => {
    const plante = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'devis_factures')
    plante.splice(plante.indexOf('devis'), 0, 'devis_factures')
    expect(violationsOrdre(plante, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('devis_factures → devis')
  })
})

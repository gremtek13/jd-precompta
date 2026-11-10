import { FACTURES_IMPORTEES_PREVUES } from './facturesImportees'

// ── LES LECTEURS S'OUVRENT NOMMÉMENT (étape A8c) ──────────────────────────────────────────────────────────────────────────
//
// Une facture reprise (`statut = 'importee'`) compte par son REGISTRE, ses encaissements d'après la date de reprise, sous
// les règles d'une facture source (EC3-Q9, A8-Q1 ; la migration `factures_reprises_encaissements`, A8b). Un lecteur qui la
// compte ne le fait jamais en élargissant un filtre en silence : il appelle `estUneVente` là où il testait l'égalité à
// « validee », et `estUneFactureReprise` là où sa règle diffère (ni document, ni exigibilité de livraison ou de débits, le
// cumul qui part de l'encaissé avant la reprise). Le drapeau baissé, ni l'un ni l'autre ne reconnaît une reprise : les
// calculs d'aujourd'hui rendent exactement ce qu'ils rendaient. facturesReprisesLecteurs.test.ts tient la liste des modules
// ouverts, et de ceux qui restent à ouvrir, au nombre près.
//
// Le drapeau se lit À CHAQUE APPEL, jamais au chargement d'un module : les tests jouent ses deux états par un accesseur sur
// lib/facturesImportees.ts — d'où ce module à part, qui le lit par son import.

/** Un état de facture tel que la base le porte : `StatutFacture` (types.ts) ne connaîtra « importee » qu'avec la migration. */
type AvecUnStatut = { readonly statut: string }

/** La facture est-elle une facture REPRISE de l'ancien logiciel, que l'application compte ? Jamais le drapeau baissé. */
export function estUneFactureReprise(f: AvecUnStatut): boolean {
  return FACTURES_IMPORTEES_PREVUES && f.statut === 'importee'
}

/**
 * La facture compte-t-elle pour la vente — une facture validée, ou, le drapeau levé, une facture reprise ? Le prédicat que
 * les lecteurs ouverts appellent à la place de `statut === 'validee'`.
 */
export function estUneVente(f: AvecUnStatut): boolean {
  return f.statut === 'validee' || estUneFactureReprise(f)
}

/** Les états qu'une lecture des ventes demande à la base : la validée, et, le drapeau levé, la reprise. */
export function etatsDesVentes(): string[] {
  return FACTURES_IMPORTEES_PREVUES ? ['validee', 'importee'] : ['validee']
}

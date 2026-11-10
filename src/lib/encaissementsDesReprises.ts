// LES ENCAISSEMENTS ET L'AVOIR D'UNE FACTURE REPRISE (ligne 51.5, étape A8b ; EC3-Q9, A8-Q1, A8-Q2, A8-Q6). La migration
// `factures_reprises_encaissements` (supabase/preparees/20261110130000_factures_reprises_encaissements.sql, PRÉPARÉE, pas
// appliquée, à COLLER après A8a et A9a) ouvre à une facture reprise de l'ancien logiciel le registre de ses encaissements,
// la règle du cumul (`calcul_vente_facturee`, `ecritures_attendues_de_la_periode`) et l'avoir que l'application émet sur
// elle (`enregistrer_facture`). Le récit : HISTORIQUE.md, « A8B : LES ENCAISSEMENTS ET L'AVOIR D'UNE FACTURE REPRISE, EN
// BASE (PRÉPARÉE, PAS APPLIQUÉE) » ; l'essai : supabase/essais/encaissementsDesReprises.sql.
//
// CE MODULE NE DIT QUE LES REFUS NEUFS, à leur place dans ceux d'hier, sous les mots de la migration, que
// encaissementsDesReprises.test.ts confronte à son texte. Rien ne les lit encore : la fenêtre des encaissements et le
// formulaire de l'avoir refusent une facture reprise dès son état (`refusDeLaFacture`, `refusAvoir` : « validee » seule),
// et c'est A8c qui les ouvrira nommément. Le jour où la migration entre dans l'export, `REFUS_ENREGISTREMENT`
// (encaissementsFactures.ts) doit les porter à leur rang — encaissementsFactures.test.ts le confronte à la dernière
// définition exportée, et virera au rouge jusque-là — ; `refusAvoir` (factures.ts) aussi, avec l'état « importee » et les
// avoirs repris dans ce qui est déjà crédité.

/** Un refus neuf : sa clé, ses mots (le texte de la fonction, « % » à remplir) et le refus d'hier qu'il suit. */
export interface RefusNeuf<C extends string> {
  cle: C
  modele: string
  /** La clé du refus d'hier qu'il suit immédiatement dans le texte de la fonction. */
  apres: string
}

// Les quatre refus neufs d'`enregistrer_encaissement`, dans l'ordre du texte. `apres` nomme une clé de
// `REFUS_ENREGISTREMENT` (encaissementsFactures.ts), dans sa forme exportée d'aujourd'hui.
export const REFUS_ENCAISSEMENT_D_UNE_REPRISE = [
  // A8B-Q1 : une facture reprise qui mêle biens et services ne reçoit pas encore d'encaissement.
  {
    cle: 'reprise_mixte',
    modele: "La facture % est reprise de l'ancien logiciel et mêle biens et services : ses encaissements ne se répartissent pas encore entre les deux, et elle n'en reçoit pas — un paiement d'après la reprise se classe dans le relevé, comme une recette.",
    apres: 'rejetee',
  },
  // A8-Q2 : un encaissement d'une facture reprise se date de la reprise, ou d'après.
  {
    cle: 'avant_la_reprise',
    modele: "La facture % est reprise de l'ancien logiciel : un encaissement s'y date du jour de la reprise des factures, le %, ou d'après — ce qui en était encaissé avant est déjà dans sa reprise.",
    apres: 'date_future',
  },
  // A8-Q6 : ce qui lui reste, au total puis à chaque taux, net de ses avoirs (de l'application et repris) et de ce qui en
  // était encaissé avant la reprise.
  {
    cle: 'plafond_reprise',
    modele: "L'encaissement dépasserait ce que la facture reprise porte encore, nette de ses avoirs et de ce qui en était encaissé avant la reprise : il reste % € à encaisser.",
    apres: 'repartition_somme',
  },
  {
    cle: 'plafond_reprise_taux',
    modele: "À % %%, l'encaissement dépasserait ce que la facture reprise porte encore, nette de ses avoirs et de ce qui en était encaissé avant la reprise : il reste % € à encaisser à ce taux.",
    apres: 'plafond_facture_net',
  },
] as const satisfies readonly RefusNeuf<string>[]

export type CleRefusEncaissementDUneReprise = (typeof REFUS_ENCAISSEMENT_D_UNE_REPRISE)[number]['cle']

// Les deux refus neufs d'`enregistrer_facture`, dans la branche de l'avoir, après « Un avoir ne précède pas la facture qu'il
// corrige ». `apres` nomme ce refus d'hier par ses mots : aucun module ne range ceux d'`enregistrer_facture` sous des clés.
export const AVOIR_NE_PRECEDE_PAS = "Un avoir ne précède pas la facture qu'il corrige (émise le %)."

export const REFUS_AVOIR_D_UNE_REPRISE = [
  // A8B-Q1 : l'avoir d'une facture reprise qui mêle biens et services ne se fait pas encore.
  {
    cle: 'avoir_reprise_mixte',
    modele: "La facture % est reprise de l'ancien logiciel et mêle biens et services : son avoir ne se fait pas encore dans l'application, qui ne sait pas répartir entre les deux ce qu'il crédite.",
    apres: AVOIR_NE_PRECEDE_PAS,
  },
  // A8-Q2 : l'avoir d'une facture reprise se date de la reprise, ou d'après.
  {
    cle: 'avoir_avant_la_reprise',
    modele: "La facture % est reprise de l'ancien logiciel : son avoir se date du jour de la reprise des factures, le %, ou d'après — ce qui précède, l'ancien logiciel l'a émis.",
    apres: 'avoir_reprise_mixte',
  },
] as const satisfies readonly RefusNeuf<string>[]

/**
 * Une liste de refus d'hier, les refus neufs insérés chacun après celui qu'il suit (`apres`, une clé de la liste ou d'un
 * refus neuf déjà placé) : l'ordre du texte de la fonction remplacée. Une clé `apres` introuvable lève — une liste d'hier
 * qui aurait changé sans que ce module suive.
 */
export function refusAvecLesNeufs<C extends string>(
  hier: readonly { cle: string; modele: string }[],
  neufs: readonly RefusNeuf<C>[],
): { cle: string; modele: string }[] {
  const liste = hier.map((r) => ({ cle: r.cle, modele: r.modele }))
  for (const n of neufs) {
    const i = liste.findIndex((r) => r.cle === n.apres)
    if (i < 0) throw new Error(`Le refus « ${n.apres} », que « ${n.cle} » suit, n'est plus dans la liste d'hier.`)
    liste.splice(i + 1, 0, { cle: n.cle, modele: n.modele })
  }
  return liste
}

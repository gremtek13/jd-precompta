// QUI PEUT QUOI DANS LES FONCTIONS DE LA VENTE (espace client, étape P3) : la table du §3.5 de la conception de l'espace
// client, fonction par fonction — ce que chaque `QUI_PEUT_QUOI` doit dire. `droitsDeLAppelantCopie.test.ts` la confronte
// au texte des sources, les matrices de `contratsFonctions.ts` à leur conduite en HTTP.
//
// « ventes » : le cabinet du dossier, ou un accès client qui porte la case « Ventes » ; « cabinet » : le cabinet seul.
// EC-Q4 (« le client relie aussi sa plateforme », et Super PDP) est une HYPOTHÈSE que le cabinet n'a pas encore
// tranchée : s'il répond « le cabinet seul », `enregistrer`, `retirer`, `tester`, `save` et `remove` passent à
// « cabinet » — ici, et dans la fonction, une ligne chacun.

export type DroitExigeAttendu = 'cabinet' | 'ventes'

export const QUI_PEUT_QUOI_ATTENDU = {
  'plateforme-agreee': {
    statut: 'ventes', enregistrer: 'ventes', retirer: 'ventes', tester: 'ventes',
    lister: 'cabinet', telecharger: 'cabinet', retenir: 'cabinet', repartir: 'cabinet',
    deposer: 'ventes', suivre: 'ventes', relever: 'ventes',
  },
  'superpdp-credentials': { status: 'ventes', save: 'ventes', remove: 'ventes' },
  'superpdp-emit': { envoyer: 'ventes', actualiser: 'ventes' },
  'send-email': { facture: 'ventes', relance_pieces: 'cabinet' },
} as const satisfies Record<string, Record<string, DroitExigeAttendu>>

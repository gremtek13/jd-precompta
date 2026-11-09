// LA RESTAURATION INTERROMPUE ET CE QUE LA SAUVEGARDE NE PORTE PAS (RESTAU-Q2 et RESTAU-Q3, 09/11/2026). Module pur : ni
// client de la base ni réseau, pour que l'écran de la restauration et ses tests le lisent sans rien simuler.
//
// RESTAU-Q2. Une restauration n'est pas atomique (`restaurerSauvegarde`) : si elle s'arrête APRÈS avoir écrit la ligne du
// dossier, elle laisse en base un dossier à moitié restauré, et un nouvel essai se refuse (« existe déjà » : la
// restauration n'écrit jamais par-dessus). L'écran propose alors de retirer ce dossier partiel, sur une confirmation qui
// le nomme, par la suppression de la ligne du dossier, que la base fait cascader. Jamais seul, et jamais sur un dossier
// que la restauration n'a pas créé elle-même dans cette tentative : la seule preuve admise est une `RestaurationInterrompue`
// levée par `restaurerSauvegarde`, qui ne la lève qu'après avoir constaté le dossier ABSENT avant toute écriture, puis
// écrit sa ligne sans erreur. Une erreur d'une autre forme — un refus d'avant la première écriture, la ligne du dossier
// refusée, un objet qui imiterait le champ — ne propose rien (`dossierPartielDe`).
//
// LE STOCKAGE N'EST PAS VIDÉ, à la différence de « Supprimer ce dossier » (`supprimerDossierDefinitivement`). La règle
// est la même que pour le dossier : ne retirer que ce que la tentative a créé. Or une restauration ne s'interrompt que
// pendant l'écriture des lignes, AVANT l'étape des logos : elle n'a rien déposé. Les fichiers rangés sous le préfixe du
// dossier — ses pièces et ses packs, que la sauvegarde ne porte pas, un logo « déjà là » — existaient avant elle, et ce
// sont précisément ceux que la restauration vient rejoindre : les retirer détruirait ce qu'elle cherche à rendre.

/** Le dossier qu'une tentative de restauration a créé puis laissé inachevé. */
export interface DossierPartiel {
  id: string
  /** Le nom que la sauvegarde lui donne ; vide s'il n'en a pas (l'identifiant le nomme alors). */
  nom: string
  /** Ce que la tentative a écrit avant de s'arrêter, table par table (la table qui a échoué n'y est pas). */
  lignesEcrites: Record<string, number>
  /** Les lignes communes à tous les dossiers (`dossier_id` nul) que la tentative a écrites : elles ne partent pas avec lui. */
  partageesEcrites: number
}

/** L'arrêt d'une restauration après la création du dossier : le seul cas où un retrait se propose. */
export class RestaurationInterrompue extends Error {
  readonly dossierPartiel: DossierPartiel
  constructor(message: string, dossierPartiel: DossierPartiel) {
    super(message)
    this.name = 'RestaurationInterrompue'
    this.dossierPartiel = dossierPartiel
  }
}

/** Le dossier partiel qu'une erreur de restauration désigne, ou `null` : seule une `RestaurationInterrompue` en désigne un. */
export function dossierPartielDe(erreur: unknown): DossierPartiel | null {
  return erreur instanceof RestaurationInterrompue ? erreur.dossierPartiel : null
}

export const LIBELLE_RETRAIT_DU_DOSSIER_PARTIEL = 'Retirer le dossier partiel'

/** Le nom à taper pour confirmer : celui du dossier, son identifiant s'il n'en a pas. */
export function nomDuDossierPartiel(partiel: DossierPartiel): string {
  return partiel.nom || partiel.id
}

/** Ce que l'écran dit sous l'erreur, avant d'offrir le retrait. */
export function avisDuDossierPartiel(partiel: DossierPartiel): string {
  return `La restauration s'est arrêtée après avoir créé le dossier « ${nomDuDossierPartiel(partiel)} » : il est en base, ` +
    'à moitié restauré, et un nouvel essai serait refusé tant qu\'il y reste. Rien ne le retire sans ton accord.'
}

/** La confirmation du retrait : elle NOMME le dossier et dit ce qui part, et ce qui reste. */
export function descriptionDuRetrait(partiel: DossierPartiel): string {
  const tables = Object.entries(partiel.lignesEcrites).filter(([, n]) => n > 0)
  const lignes = tables.reduce((s, [, n]) => s + n, 0)
  const phrases = [
    `Cette action supprime définitivement le dossier « ${nomDuDossierPartiel(partiel)} » (${partiel.id}), que cette ` +
      'restauration vient de créer et n\'a pas achevée, avec tout ce qui lui est rattaché : ' +
      `les ${lignes} ligne(s) déjà réinsérées sur ${tables.length} table(s).`,
    'Le stockage n\'est pas touché : la tentative s\'est arrêtée avant d\'y déposer quoi que ce soit, et les fichiers déjà ' +
      'rangés sous ce dossier (ses pièces, que la sauvegarde ne porte pas) sont ceux que la restauration vient rejoindre.',
  ]
  if (partiel.partageesEcrites > 0) {
    phrases.push(
      `${partiel.partageesEcrites} ligne(s) communes à tous les dossiers (catégories, natures d'immobilisation), réinsérées ` +
        'par cette tentative, restent : elles ne lui appartiennent pas, et la prochaine tentative les retrouvera telles quelles.',
    )
  }
  phrases.push('Le fichier de sauvegarde ne change pas : la restauration pourra repartir une fois le dossier retiré.')
  return phrases.join('\n\n')
}

/** Ce que l'écran dit une fois la ligne du dossier rendue par la base comme supprimée. */
export function messageApresRetrait(partiel: DossierPartiel): string {
  return `Dossier partiel « ${nomDuDossierPartiel(partiel)} » retiré, avec ce que la tentative avait écrit. ` +
    'Le stockage n\'a pas été touché. La restauration peut repartir.'
}

// RESTAU-Q3. Ce que la sauvegarde tait aujourd'hui, dit dans son manifeste (« hors périmètre ») et à l'écran de la
// restauration. Ces tables n'ont aucune policy : leur lecture rend zéro ligne, par sécurité (le secret d'une connexion ne
// revient jamais au navigateur), et la sauvegarde les lit donc vides — sans le dire jusqu'ici.
export const CONNEXIONS_HORS_PERIMETRE: readonly string[] = [
  'Les connexions bancaires (`connexions_bancaires`) ne sont pas incluses : leur table n’a aucune policy, sa lecture rend zéro ligne, par sécurité. Après une restauration, la connexion se refait depuis l’onglet Banque, et la banque redemande l’accord du titulaire.',
  'Les connexions aux plateformes agréées du client (`connexions_plateformes`) ne sont pas incluses, pour la même raison : leur secret ne quitte jamais la base. Après une restauration, la plateforme du client se relie depuis l’onglet Pièces (« Plateforme du client »), son secret ressaisi.',
  'Les identifiants Super PDP (`superpdp_credentials`) ne sont pas inclus, pour la même raison. Après une restauration, ils se ressaisissent depuis l’onglet Pièces (« Facturation électronique — Super PDP »).',
]

// Vérifié dans le texte exporté avant d'être écrit : `prochain_numero_facture` (migrations factures_validees_figees et
// ventes_du_client) et `enregistrer_devis` (migration devis_citent_un_contact) prennent le plus grand du repère et du plus
// haut numéro déjà émis de la série (`greatest(...) + 1`), et posent le repère s'il manque.
export const NUMEROTATION_HORS_PERIMETRE =
  'Les compteurs de numérotation des factures et des devis (`facture_numerotation`, `devis_numerotation`) ne sont pas inclus : leurs tables n’ont aucune policy, leur lecture rend zéro ligne. Rien n’est perdu : la numérotation reprend du plus haut numéro émis de la série, que les factures et les devis restaurés portent, et le compteur se repose à la première facture ou au premier devis émis ensuite.'

/** Ce que la sauvegarde tait et que la restauration fait refaire, ajouté à la liste du manifeste (RESTAU-Q3). */
export const HORS_PERIMETRE_DES_SECRETS: readonly string[] = [...CONNEXIONS_HORS_PERIMETRE, NUMEROTATION_HORS_PERIMETRE]

/**
 * La liste « hors périmètre » que l'écran de la restauration montre : celle du manifeste, telle que la sauvegarde l'a
 * écrite, puis ce qu'une sauvegarde d'avant RESTAU-Q3 taisait — vrai d'elle aussi, ces tables n'ayant jamais été lues.
 */
export function horsPerimetreAAfficher(manifeste: { horsPerimetre: readonly string[] }): string[] {
  const dites = new Set(manifeste.horsPerimetre)
  return [...manifeste.horsPerimetre, ...HORS_PERIMETRE_DES_SECRETS.filter((ligne) => !dites.has(ligne))]
}

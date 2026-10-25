// QUI REGARDE LES VENTES : LE CABINET, OU LE CLIENT QUI PORTE LA CASE « VENTES » (espace client, étape P4a ; conception :
// HISTORIQUE.md, « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE GESTION DU CLIENT : LA CONCEPTION », §2.4 et §5).
//
// L'onglet Factures du cabinet et ses fenêtres servent aussi « Mes ventes › Factures », réutilisés et non recopiés : une
// seule propriété, OBLIGATOIRE, dit qui regarde. Les gestes sont les mêmes — la base (P2) et les fonctions de la vente (P3)
// les ouvrent au client « Ventes » —, sauf ceux du cabinet (l'adresse du dossier, le statut de TVA, la réception des
// factures d'achat ; la liaison d'une plateforme s'ouvre au client à l'étape P4b, sous EC-Q4). Les MOTS changent : le client n'est jamais « le client » de son propre dossier, aucun onglet du cabinet ne
// lui est désigné, et on le tutoie (lib/resteAEnvoyer.ts : on tutoie le client, on vouvoie le cabinet).
//
// Ce module dit les mots. Les phrases des écrans ont leur variante écrite à côté d'elles ; celles des MODULES partagés ne
// peuvent pas changer à la source — plusieurs vivent dans des copies gardées des Edge Functions, recopiées au caractère près
// (bloc `statutTva`, générateur CII) — et se RÉÉCRIVENT ici, à l'affichage, pour le client seulement. Une erreur rendue par
// la base ou par une fonction passe par la même réécriture : elle peut porter les mêmes phrases.

export type EspaceVentes = 'cabinet' | 'client'

/**
 * « Mes ventes » s'offre-t-il au client (sa route, App.tsx ; son entrée, Layout.tsx) ? Avec la case « Ventes » sur la société
 * AFFICHÉE, et seulement une fois les ventes du client en base (`VENTES_DU_CLIENT_EXPORTEES`, étape P2) : avant elles, la
 * RLS rendrait ses factures VIDES sans erreur, et l'écran dirait « Aucune facture » d'une société qui en a.
 */
export function mesVentesOuvertes(ventesExportees: boolean, droitVentes: boolean): boolean {
  return ventesExportees && droitVentes
}

// Chaque réécriture : une phrase telle que son module la produit, et ce que lit le client. La plus longue d'abord — une
// phrase entière l'emporte sur les mots qu'elle contient. espaceVentes.test.ts appelle le module qui produit chacune et
// exige qu'elle y figure telle quelle : une phrase changée à la source ne se réécrirait plus, et le garde des mots le dirait.
export const REECRITURES_CLIENT: readonly { de: string; vers: string }[] = [
  // lib/statutTva.ts, `motifExoneration` (copie gardée dans plateforme-agreee et superpdp-emit).
  {
    de: 'Le statut de TVA du dossier est à préciser : choisis-le dans l’onglet TVA du dossier avant de transmettre une facture.',
    vers: 'Ton cabinet doit d’abord préciser ton statut de TVA : tes factures ne peuvent pas partir.',
  },
  {
    de: 'Le dossier est exonéré sans article d’exonération : choisis-le dans l’onglet TVA du dossier avant de transmettre une facture à 0 %.',
    vers: 'Ta société est exonérée sans article d’exonération : ton cabinet doit d’abord le préciser, sans quoi une facture '
      + 'à 0 % ne peut pas partir.',
  },
  {
    de: 'Une ligne à 0 % d’un dossier redevable demande l’article de son exonération : choisis-le dans l’onglet TVA du dossier, ou corrige le taux.',
    vers: 'Une ligne à 0 % d’une société redevable demande l’article de son exonération : ton cabinet doit le préciser, ou '
      + 'corrige le taux.',
  },
  // lib/statutTva.ts, `refusTauxPositif` : le statut de TVA se change au cabinet.
  {
    de: 'S’il a dépassé les seuils de la franchise, il est redevable : change son statut de TVA.',
    vers: 'Si ta société a dépassé les seuils de la franchise, elle est redevable : ton cabinet doit changer son statut de TVA.',
  },
  // lib/statutTva.ts, `manqueMentionTva`.
  {
    de: 'Le statut de TVA du dossier est à préciser (onglet TVA du dossier) : la mention de TVA de la facture en dépend.',
    vers: 'Ton cabinet doit d’abord préciser ton statut de TVA : la mention de TVA de la facture en dépend.',
  },
  {
    de: 'Le dossier est exonéré sans article d’exonération : saisis la mention de la facture, ou choisis l’article dans l’onglet TVA du dossier.',
    vers: 'Ta société est exonérée sans article d’exonération : saisis la mention de la facture, ou demande à ton cabinet de '
      + 'préciser l’article.',
  },
  // lib/factureCii.ts, `refusEmission` (règle G1.47 ; copie gardée dans les deux fonctions qui transmettent).
  {
    de: 's’il en a un, sa case se coche dans l’onglet TVA du dossier, sous son statut de TVA.',
    vers: 'si ta société en a un, c’est ton cabinet qui l’indique, avec ton statut de TVA.',
  },
  // lib/encaissementsFactures.ts, `obligationEncaissee`.
  {
    de: 'le statut de TVA du dossier, dont l’obligation dépend, n’est pas encore choisi (onglet TVA du dossier).',
    vers: 'ton statut de TVA, dont l’obligation dépend, n’est pas encore précisé par ton cabinet.',
  },
  // lib/encaissementsFactures.ts, les refus des fonctions des encaissements que la fenêtre dit au client (étape VF5b) : le
  // classement d'un mouvement se retire au cabinet seul (`retirer_classement_par_encaissements`), et le client ne le fait
  // pas ; une contre-passation se retire, au tutoiement.
  { de: "le cabinet retire d'abord ce classement", vers: "ton cabinet retire d'abord ce classement" },
  { de: "— retirer d'abord ce classement", vers: "— ton cabinet retire d'abord ce classement" },
  { de: "retirez d'abord celle-ci", vers: "retire d'abord celle-ci" },
  // La garde de la frontière des encaissements (étape VF7a, `REFUS_GARDE_FRONTIERE`), que les fonctions du client
  // atteignent (un mouvement figé cité) : ses mots ne nomment ni le cabinet ni un onglet, et ne vouvoient pas — aucune
  // réécriture ; espaceVentes.test.ts le garde.
  // lib/encaissementsFactures.ts, le refus du rang 7 du classement (le virement mixte, étape VF5h) : la fenêtre le cite au
  // client quand son geste laisserait un mouvement inclassable (`inclassableApres`) ; l'exemplaire d'une facture, c'est son
  // cabinet qui le désigne.
  { de: "Désignez d'abord l'exemplaire de la facture", vers: "Ton cabinet doit d'abord désigner l'exemplaire de la facture" },
  // lib/statutsLus.ts, `refusDuReleve` : l'identité ouverte sur la plateforme est celle de l'entreprise du client, et depuis

  // l'étape P4b il la relie lui-même, dans « Tes plateformes » (« Mes ventes »).
  {
    de: 'L’identifiant ou le secret enregistrés ne sont plus acceptés : demandez-en de nouveaux au client, puis saisissez-les '
      + 'par « Modifier » dans la fenêtre « Plateforme du client » (onglet Justificatifs).',
    vers: 'L’identifiant ou le secret enregistrés ne sont plus acceptés : crée-en de nouveaux sur ta plateforme, puis '
      + 'saisis-les par « Modifier » dans « Gérer ta plateforme » (« Tes plateformes »).',
  },
  {
    de: 'Demandez au client d’ouvrir au cabinet le droit de lire les flux de son entreprise sur sa plateforme.',
    vers: 'Ouvre, sur ta plateforme, à l’accès relié ici le droit de lire les flux de ton entreprise.',
  },
  // lib/statutsLus.ts, `bilanDuReleve` et `verificationAvantDeclaration`.
  { de: 'Relancez la lecture pour la suite.', vers: 'Relance la lecture pour la suite.' },
  {
    de: ' Aucune plateforme n’est reliée au dossier pour les lire : reliez-la dans l’onglet Justificatifs (« Plateforme du client »).',
    vers: ' Aucune plateforme n’est reliée à ta société pour les lire : relie-la dans « Tes plateformes », au-dessus de tes '
      + 'factures.',
  },
  { de: 'n’ont pas encore été lus : lisez-les avant de déclarer', vers: 'n’ont pas encore été lus : lis-les avant de déclarer' },
  // lib/receptionPlateforme.ts, `lireSynchronisationSuperPdp` : la section « Tes plateformes » lit l'état de Super PDP.
  { de: 'La synchronisation Super PDP du dossier n’a pas pu être lue.', vers: 'L’état de Super PDP n’a pas pu être lu.' },
  // Les refus de `plateforme-agreee` que les gestes de la liaison rendent (relier, tester, retirer, relire les statuts,
  // étape P4b) : la fonction parle au cabinet, et elle ne change pas pour l'écran. Les phrases d'abord, puis les verbes au
  // vouvoiement qu'elles portent — chacun lu dans la source de la fonction.
  { de: 'L\'identifiant du cabinet chez la plateforme', vers: 'L\'identifiant chez ta plateforme' },
  { de: 'l\'identité ouverte au cabinet n\'a ', vers: 'l\'identité enregistrée n\'a ' },
  { de: 'Donnez à la plateforme', vers: 'Donne à ta plateforme' },
  { de: 'ressaisissez', vers: 'ressaisis' },
  { de: 'vérifiez', vers: 'vérifie' },
  { de: 'laissez-la', vers: 'laisse-la' },
  { de: 'Réessayez', vers: 'Réessaie' },
  { de: 'réessayez', vers: 'réessaie' },
  { de: 'relancez', vers: 'relance' },
  { de: 'suivez-la', vers: 'suis-la' },
  { de: 'rechargez', vers: 'recharge' },
  // lib/transmissionsFactures.ts (`libelleCanal`, `libelleCourtCanal`), lib/receptionPlateforme.ts et tout ce qui nomme la
  // plateforme agréée du TITULAIRE : pour lui, c'est la sienne.
  { de: 'la plateforme du client', vers: 'ta plateforme' },
  { de: 'Plateforme du client', vers: 'Ta plateforme' },
  // lib/adressesReception.ts, `REFUS_DECLARATION_ADRESSE` (étape A6b1) : les deux refus qui nomment « le dossier » ; les dix-sept
  // autres se lisent tels quels. Le SIRET d'un dossier se renseigne au cabinet.
  {
    de: "Le dossier n'a pas de SIREN : renseigner son SIRET avant de déclarer son adresse de réception.",
    vers: 'Le SIRET de ta société n’est pas renseigné : demande à ton cabinet de le renseigner avant de déclarer ton adresse '
      + 'de réception.',
  },
  { de: 'le SIREN du dossier', vers: 'le SIREN de ta société' },
  // lib/sourceDeLaVente.ts, `REFUS_VALIDATION_SOURCE` (étape VF8c) : les deux refus qui nomment « un dossier » ; le troisième,
  // la frontière, ne se dit au client qu'après l'envoi, sous la phrase d'`exercice_fige`, sans dossier.
  {
    de: 'Dans un dossier dont les factures sont la source de leurs ventes, une facture qui mêle biens et services',
    vers: 'Tes factures étant la source de tes ventes, une facture qui mêle biens et services',
  },
  {
    de: 'Dans un dossier dont les factures sont la source de leurs ventes, une facture dit',
    vers: 'Tes factures étant la source de tes ventes, chacune dit',
  },
  // lib/contacts.ts, `REFUS_ENREGISTREMENT_CONTACT` et `REFUS_REPRISE_CONTACT` (étape A4b1) : les deux refus de la règle des soins
  // parlent d'« un dossier » et de « ses patients » ; les vingt-cinq autres se lisent tels quels. Aucun des deux ne renvoie à un
  // onglet : le client ne range pas un particulier, ni un client établi hors de France, dans SES clients.
  {
    de: 'Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de particulier dans ses contacts : '
      + "ce seraient ses patients. Un autre non-assujetti, une association par exemple, s'y range avec son SIREN.",
    vers: 'Ta société dispense des soins exonérés (art. 261, 4, 1° du CGI) : tu ne ranges pas de particulier dans tes clients, '
      + 'ce seraient tes patients. Un autre non-assujetti, une association par exemple, s’y range avec son SIREN.',
  },
  {
    de: 'Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de client établi hors de France dans '
      + 'ses contacts : il pourrait être un particulier, donc un patient.',
    vers: 'Ta société dispense des soins exonérés (art. 261, 4, 1° du CGI) : tu ne ranges pas de client établi hors de France '
      + 'dans tes clients, il pourrait être un particulier, donc un patient.',
  },
]

/** Le texte tel que l'espace le lit : celui du cabinet tel quel ; pour le client, ses phrases du cabinet réécrites. */
export function pourLEspace(espace: EspaceVentes, texte: string): string {
  if (espace === 'cabinet') return texte
  return REECRITURES_CLIENT.reduce((t, r) => t.split(r.de).join(r.vers), texte)
}

/** De même pour un texte facultatif (un message d'erreur, un refus) : nul reste nul. */
export function pourLEspaceSiTexte(espace: EspaceVentes, texte: string | null): string | null {
  return texte == null ? null : pourLEspace(espace, texte)
}

// ── Le garde des mots ────────────────────────────────────────────────────────────────────────────────────────────────
// Ce qu'un texte montré au CLIENT ne dit jamais. Défini par des formes, pas par des phrases : une phrase neuve qui renvoie
// à un onglet du cabinet, nomme le titulaire « le client » à la manière du cabinet, ou le vouvoie, tombe sous l'une d'elles.
// « Le client » qui désigne l'ACHETEUR reste permis — les modules partagés le nomment ainsi, et le client de l'espace n'est
// jamais nommé « le client » nulle part ailleurs : le mot ne désigne donc plus que l'acheteur.
export const MOTS_DU_CABINET: readonly { nom: string; motif: RegExp }[] = [
  // Aucun onglet n'existe dans l'espace du client : « l'onglet Justificatifs », « l'onglet TVA », « l'onglet Factures »…
  { nom: 'un onglet', motif: /\bonglets?\b/i },
  // La plateforme agréée du titulaire, nommée comme le cabinet la nomme.
  { nom: 'la plateforme du client', motif: /plateformes? (agréées? )?du client/i },
  { nom: 'celle du client', motif: /\bcelle du client\b/i },
  // Ce que le cabinet demande au titulaire.
  { nom: 'demander au client', motif: /\bdemande[rz]?(-en)?\b[^.!?]*\bau client\b/i },
  // Les libellés des textes partagés, du point de vue du cabinet.
  { nom: 'le client qui porte la case', motif: /\bclient qui porte\b/i },
  { nom: 'le cabinet ou le client', motif: /\bcabinet ou le client\b|\bclient ou le cabinet\b/i },
  // On tutoie le client : ni « vous », ni l'impératif ou le présent en « -ez » (« Saisissez », « reliez-la »…). « chez » et
  // « assez » n'en sont pas.
  { nom: 'le vouvoiement', motif: /\b(vous|votre|vos)\b/i },
  { nom: 'le vouvoiement', motif: /(?<![\p{L}])(?!chez\b|assez\b)\p{L}{2,}ez\b/iu },
]

/** Les formes du cabinet qu'un texte porte, chacune avec l'extrait qui la porte ; aucune pour un texte du client. */
export function motsDuCabinet(texte: string): string[] {
  const trouves: string[] = []
  for (const { nom, motif } of MOTS_DU_CABINET) {
    const m = motif.exec(texte)
    if (m) trouves.push(`${nom} : « ${texte.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).trim()} »`)
  }
  return trouves
}

// ── Les droits de la société affichée, tels que la BASE les voit ───────────────────────────────────────────────────────
// « Mes ventes » existe selon les droits qu'AuthContext a lus à la connexion ; l'application installée reste ouverte des
// jours, et une case retirée entre-temps ne se verrait qu'à la connexion suivante. L'écran relit donc les cases à la base
// (`droits_sur_le_dossier`, étape P1) avec la société, comme « Ma simulation » relit « Banque » (lib/couvertureReleve.ts) :
// sans « Banque », la fenêtre des encaissements ne lirait plus qu'un relevé que la RLS rend vide sans le dire.
export interface DroitsDeLaBase {
  ventes: boolean
  banque: boolean
}

/**
 * Les cases « Ventes » et « Banque » rendues par `droits_sur_le_dossier`. Seul `true` accorde ; un refus, ou une réponse
 * d'une autre forme, ne rend AUCUN droit, avec son motif : l'échec tombe du côté fermé.
 */
export function droitsVentesDeLaBase(
  reponse: { data: unknown; error: unknown },
  motifDuRefus: (erreur: unknown) => string,
): { droits: DroitsDeLaBase; motif: null } | { droits: null; motif: string } {
  if (reponse.error) return { droits: null, motif: motifDuRefus(reponse.error) }
  const d = reponse.data
  if (d === null || typeof d !== 'object' || Array.isArray(d)) return { droits: null, motif: 'droits illisibles' }
  const cases = d as Record<string, unknown>
  return { droits: { ventes: cases.ventes === true, banque: cases.banque === true }, motif: null }
}

/**
 * Les cases lues par l'écran : `lireLesDroitsVentes(supabase.rpc('droits_sur_le_dossier', { p_dossier_id }), …)`. La
 * requête est ATTENDUE (`await`) — un constructeur de requête n'est pas une promesse (CLAUDE.md, « La banque du client en
 * base ») — et une requête qui lève FERME, avec son motif, comme `lireLeDroitBanque` (lib/couvertureReleve.ts).
 */
export async function lireLesDroitsVentes(
  requete: PromiseLike<{ data: unknown; error: unknown }>,
  motifDuRefus: (erreur: unknown) => string,
): Promise<{ droits: DroitsDeLaBase; motif: null } | { droits: null; motif: string }> {
  try {
    return droitsVentesDeLaBase(await requete, motifDuRefus)
  } catch (erreur) {
    return droitsVentesDeLaBase({ data: null, error: erreur }, motifDuRefus)
  }
}

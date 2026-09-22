// CE QU'IL RESTE À ENVOYER — L'ARITHMÉTIQUE D'EXERCICE PARTAGÉE PAR LES TROIS ÉCRANS.
//
// `ClientHome`, `ClientUpload` et la Checklist du cabinet posent la même question à trois publics
// différents, et CLAUDE.md exige depuis toujours qu'ils « disent la même chose au même moment ».
// Cette exigence était tenue par recopie : le même calcul écrit trois fois, à trois endroits, et il
// a déjà divergé deux fois (le mois en cours compté comme dû d'un côté seulement, puis l'année figée
// au chargement du module sur un seul des trois). Une règle recopiée trois fois n'attend pas de
// diverger, elle attend un quatrième appelant.
//
// CE QUI VIT ICI est ce qui a divergé : QUELS EXERCICES sont encore réclamés, et quels MOIS sont
// attendus dans chacun. Ce qui reste aux écrans est ce qui diffère LÉGITIMEMENT — les libellés (on
// tutoie le client, on vouvoie le cabinet) et surtout le critère de comptage des pièces : les écrans
// client comptent les DÉPÔTS (« ai-je envoyé quelque chose ? »), la Checklist compte les pièces
// DATÉES de l'exercice (« ai-je de quoi travailler dessus ? »). Mesuré sur le dossier vivant, 43
// pièces déposées en 2026 pour UNE SEULE datée de 2026 : les fondre serait une régression, pas une
// simplification.
//
// ── LE 1ER JANVIER, LA LISTE REPARTAIT À ZÉRO ET CESSAIT DE RÉCLAMER L'EXERCICE QU'ON CLÔTURE ──
//
// Les trois écrans ne connaissaient que l'année en cours. Au 1er janvier, « ce qu'il reste à
// envoyer » oubliait d'un coup décembre — et les onze autres mois — de l'exercice révolu, au moment
// précis où un cabinet court après les pièces de l'exercice qu'il clôture. Une bonne nouvelle
// fabriquée, le pire sens de cette famille : personne ne va vérifier une bonne nouvelle.
//
// La borne retenue est la CLÔTURE (`exercices_clotures`, posée par le bouton de `ClotureTab`), et
// c'est le choix du cabinet du 22/09/2026 : on continue de réclamer l'exercice précédent tant que
// personne n'a coché qu'il est clos. Une date fixe (« jusqu'au 30 avril ») aurait été arbitraire, et
// se serait trompée sur tous les dossiers en retard — c'est-à-dire ceux qui ont justement besoin
// qu'on réclame.
import { anneeDe, moisDe } from './format'

export interface ExerciceAReclamer {
  annee: number
  // Les mois (1-12) pour lesquels un relevé est attendu. L'exercice révolu les attend tous ; celui
  // en cours n'attend que les mois RÉVOLUS — réclamer un relevé du mois en cours, c'est réclamer un
  // document qui n'existe pas encore.
  moisAttendus: number[]
  enCours: boolean
}

// CE QUI EST RÉCLAMÉ, ET CE QUI NE L'EST PLUS — un arbitrage écrit, parce qu'il a une limite.
//
// On rend l'exercice en cours, et le PRÉCÉDENT tant qu'il n'est pas clôturé. Pas ceux d'avant : un
// dossier ouvert depuis cinq ans dont personne n'a jamais coché la clôture afficherait cinq
// exercices réclamés en permanence, et une mise en garde permanente cesse d'être lue puis emporte
// ses voisines dans son discrédit (même arbitrage que `dotationsNonProratisees`).
//
// CE QUE ÇA LAISSE DEHORS, dit plutôt que tu : un exercice jamais clôturé cesse d'être réclamé ici
// quand il devient N-2. Ce n'est pas un oubli silencieux — l'onglet Clôture, lui, porte l'exercice
// choisi dans l'en-tête et ne dépend d'aucune fenêtre glissante.
//
// `anneesCloturees` INCONNU (lecture refusée) se passe en liste vide, donc on continue de réclamer :
// l'échec tombe du côté qui demande un document de trop, jamais du côté qui se tait. L'inverse
// fabriquerait la bonne nouvelle que ce module existe pour empêcher.
export function exercicesAReclamer(
  annee: number, moisEcoules: number, anneesCloturees: number[],
): ExerciceAReclamer[] {
  const exercices: ExerciceAReclamer[] = []
  if (!anneesCloturees.includes(annee - 1)) {
    exercices.push({ annee: annee - 1, moisAttendus: MOIS_DE_L_ANNEE, enCours: false })
  }
  exercices.push({
    annee,
    moisAttendus: Array.from({ length: moisEcoules }, (_, i) => i + 1),
    enCours: true,
  })
  return exercices
}

const MOIS_DE_L_ANNEE = Array.from({ length: 12 }, (_, i) => i + 1)

// Les mois de CET exercice dont aucune ligne bancaire ne porte la date. `lignes` est la collection
// entière du dossier : c'est le module qui filtre sur l'année, pas l'appelant — c'est exactement
// l'appariement année/mois qui a déjà été fait de travers.
export function moisManquantsDe(
  exercice: ExerciceAReclamer, lignes: { date: string }[],
): number[] {
  const presents = new Set(
    lignes.filter((l) => anneeDe(l.date) === exercice.annee).map((l) => moisDe(l.date)),
  )
  return exercice.moisAttendus.filter((m) => !presents.has(m))
}

// UN POINT SATISFAIT SUR UN EXERCICE RÉVOLU N'APPREND RIEN, DONC IL NE S'AFFICHE PAS.
//
// Sans ce filtre, un dossier parfaitement à jour afficherait SIX points là où trois suffisent, et la
// liste « ce qu'il reste à envoyer » passerait son temps à dire qu'il ne reste rien. L'exercice en
// cours garde ses points satisfaits — ils disent où on en est (« 8/8 mois reçus »), ce qui est le
// métier de cet écran ; l'exercice révolu, lui, n'a plus d'avancement à raconter, seulement un
// éventuel manque.
export function pointsUtiles<T extends { annee: number; ok: boolean }>(
  points: T[], anneeEnCours: number,
): T[] {
  return points.filter((p) => p.annee === anneeEnCours || !p.ok)
}

// CE QU'ON DIT QUAND ON N'A PAS PU SAVOIR SI L'EXERCICE EST CLOS.
//
// La lecture refusée se passe en « rien de clos », donc on CONTINUE de réclamer : c'est le sens sûr,
// mais il n'est pas gratuit — le cabinet peut se voir redemander des documents d'un exercice qu'il a
// déjà bouclé. Le taire rendrait ces points-là incompréhensibles ; les fabriquer en bonne nouvelle
// serait pire. On le dit donc, une fois, et dans les DEUX registres depuis un seul endroit : ces
// trois écrans ne doivent pas pouvoir diverger sur la phrase comme ils ont divergé sur le calcul.
//
// Rendue `null` quand la lecture a réussi — une mise en garde permanente cesse d'être lue.
export function reserveCloturesInconnues(
  motif: string | null, annee: number, options: { technique: boolean },
): string | null {
  if (!motif) return null
  if (!options.technique) {
    return `Certains documents demandés ci-dessus peuvent concerner une année que ton comptable a `
      + `déjà bouclée — dans ce cas il te le dira, tu n'as rien à faire.`
  }
  return `Impossible de vérifier si l'exercice ${annee - 1} est clôturé (${motif}) : il reste donc `
    + `réclamé ci-dessous. Si sa clôture est déjà cochée dans l'onglet Clôture, ces points-là sont à ignorer.`
}

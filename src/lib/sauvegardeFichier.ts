import { dateLocaleDe, slugify } from './format'
import type { Manifeste, SauvegardeDossier } from './sauvegardeDonnees'

// Le fichier de sauvegarde lui-même : ce qui sort de la plateforme, et ce qui permettra d'y rentrer.
//
// Ce module ne parle ni au réseau ni à la base — il ne connaît de `sauvegardeDonnees` que ses TYPES,
// importés en `import type`, donc effacés à la compilation. C'est ce qui le rend testable sans
// simuler quoi que ce soit.
//
// Trois choix de format, et chacun répond à la même question : ce fichier doit être lisible dans dix
// ans, éventuellement sans cette application.
//
//   - Du JSON, en clair, indenté. Pas d'archive, pas de compression, pas de format binaire. Une
//     sauvegarde compressée ajoute un mode de panne (l'archive illisible) à la chose dont le seul but
//     est de survivre ; et le jour où on en a besoin, on n'a pas forcément l'outil qui l'a écrite.
//     Le coût est la taille, et c'est le bon échange.
//   - Une empreinte SHA-256, parce qu'une fois le fichier parti — disque externe, service tiers,
//     courriel — plus rien ne garantit qu'il revienne intact. Un octet retourné ne se voit pas à
//     l'œil, et se verrait à la restauration sous la forme d'une erreur incompréhensible.
//   - Cette empreinte porte sur une forme CANONIQUE, clés triées et sans espaces, pas sur le texte du
//     fichier. Sans cela, ouvrir la sauvegarde dans un éditeur et l'enregistrer suffirait à la faire
//     déclarer corrompue — et un contrôle qui accuse à tort finit désactivé, ce qui est bien pire que
//     de ne pas l'avoir.

/** Ce qui est réellement écrit sur le disque. */
export interface EnveloppeSauvegarde {
  manifeste: Manifeste
  /** SHA-256 de la forme canonique de `contenu`. Recalculée et comparée à la lecture. */
  empreinte: string
  contenu: Record<string, Record<string, unknown>[]>
}

// Sérialisation canonique : clés triées à tous les niveaux, aucun espace. Deux sauvegardes du même
// contenu rendent la même chaîne, quel que soit l'ordre dans lequel PostgREST a rendu ses colonnes —
// et c'est précisément ce que l'empreinte doit mesurer.
export function serialiserCanonique(valeur: unknown): string {
  if (valeur === null || typeof valeur !== 'object') return JSON.stringify(valeur) ?? 'null'
  if (Array.isArray(valeur)) return `[${valeur.map(serialiserCanonique).join(',')}]`
  const entrees = Object.entries(valeur as Record<string, unknown>)
    // `undefined` n'a pas de représentation JSON : le laisser passer rendrait une chaîne invalide,
    // et l'écarter ici le fait de la même façon que `JSON.stringify` l'écarterait à l'écriture.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entrees.map(([c, v]) => `${JSON.stringify(c)}:${serialiserCanonique(v)}`).join(',')}}`
}

/** SHA-256 d'un texte, en hexadécimal. */
export async function empreinte(texte: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Le nom du fichier : le dossier et le jour, de quoi s'y retrouver dans un répertoire de sauvegardes. */
export function nomFichierSauvegarde(manifeste: Manifeste): string {
  // `faiteLe` est un INSTANT ; le nom de fichier veut un jour, celui de qui regarde le répertoire.
  const jour = dateLocaleDe(manifeste.faiteLe)
  return `sauvegarde_${slugify(manifeste.dossierNom) || manifeste.dossierId}_${jour}.json`
}

export async function serialiserSauvegarde(sauvegarde: SauvegardeDossier): Promise<string> {
  const enveloppe: EnveloppeSauvegarde = {
    manifeste: sauvegarde.manifeste,
    empreinte: await empreinte(serialiserCanonique(sauvegarde.contenu)),
    contenu: sauvegarde.contenu,
  }
  // Indenté : une sauvegarde se lit aussi à l'œil, pour vérifier qu'on tient bien le bon dossier
  // avant d'écraser quoi que ce soit.
  return JSON.stringify(enveloppe, null, 2)
}

// Relit un fichier de sauvegarde, et REFUSE tout ce qu'il ne peut pas garantir.
//
// Le danger que ces refus écartent : un fichier tronqué — téléchargement interrompu, copie sur une
// clé retirée trop tôt, disque qui a vieilli — reste souvent du JSON valide, ou le redevient après un
// `}` de trop. Lu sans contrôle, il rend une sauvegarde d'apparence normale mais amputée de ses
// dernières tables. On ne s'en apercevrait qu'en restaurant, c'est-à-dire le jour où il est trop tard
// pour en refaire une.
export async function lireSauvegarde(texte: string): Promise<SauvegardeDossier> {
  let brut: unknown
  try {
    brut = JSON.parse(texte)
  } catch {
    throw new Error("Ce fichier n'est pas une sauvegarde lisible : le JSON est illisible ou tronqué.")
  }

  const enveloppe = brut as Partial<EnveloppeSauvegarde>
  if (!enveloppe || typeof enveloppe !== 'object' || !enveloppe.manifeste || !enveloppe.contenu) {
    throw new Error("Ce fichier n'est pas une sauvegarde : il lui manque son manifeste ou son contenu.")
  }

  const attendue = enveloppe.empreinte
  const calculee = await empreinte(serialiserCanonique(enveloppe.contenu))
  if (attendue !== calculee) {
    throw new Error(
      `Sauvegarde corrompue : l'empreinte enregistrée (${String(attendue).slice(0, 12)}…) ne correspond pas au ` +
        `contenu relu (${calculee.slice(0, 12)}…). Le fichier a été modifié ou abîmé depuis son écriture.`,
    )
  }

  // Le second contrôle, et il ne fait pas double emploi : l'empreinte dit que le contenu est celui
  // qu'on a écrit, le manifeste dit ce qu'on CROYAIT écrire. Les deux peuvent diverger si la
  // sauvegarde a été écrite par une version fautive — auquel cas l'empreinte, elle, sera parfaite.
  const ecarts: string[] = []
  for (const [table, nb] of Object.entries(enveloppe.manifeste.lignesParTable ?? {})) {
    const reel = enveloppe.contenu[table]?.length ?? 0
    if (reel !== nb) ecarts.push(`${table} : ${nb} annoncées, ${reel} présentes`)
  }
  for (const table of Object.keys(enveloppe.contenu)) {
    if (!(table in (enveloppe.manifeste.lignesParTable ?? {}))) {
      ecarts.push(`${table} : présente dans le contenu, absente du manifeste`)
    }
  }
  if (ecarts.length > 0) {
    throw new Error(`Sauvegarde incohérente avec son manifeste :\n- ${ecarts.join('\n- ')}`)
  }

  return { manifeste: enveloppe.manifeste, contenu: enveloppe.contenu }
}

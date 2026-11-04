// UN RÉSERVOIR DE TÂCHES : au plus `capacite` à la fois, les autres attendent leur tour, dans l'ordre d'arrivée.
//
// Né du dépôt de « Mes pièces » (relecture du 04/11/2026, D6 ; PIECES-Q4, sur la recommandation) : un `Promise.all` sur
// le lot entier lançait autant de lectures qu'il y avait de fichiers — quarante photos, quarante appels à Textract et au
// modèle au même instant, au-delà de leurs quotas, chacun pouvant finir coupé par le mur de 150 s et la pièce arriver sans
// montant. Le cabinet, lui, importe un fichier à la fois. Un seul réservoir par écran (un `useRef`), partagé entre les lots
// comme les empreintes en vol : deux lots lancés coup sur coup ne doublent pas le débit.
//
// Une tâche qui lève libère sa place comme une autre : le réservoir ne se bloque jamais sur un échec, et l'erreur revient
// à qui l'a confiée.

export interface Reservoir {
  /** Exécute la tâche dès qu'une place se libère, et rend ce qu'elle rend (ou lève ce qu'elle lève). */
  executer<T>(tache: () => Promise<T>): Promise<T>
  /** Les tâches en cours, et celles qui attendent : de quoi dire « en attente » d'un fichier qui n'est pas encore lu. */
  readonly enCours: number
  readonly enAttente: number
}

export function creerReservoir(capacite: number): Reservoir {
  if (!Number.isInteger(capacite) || capacite < 1) throw new Error(`capacité d'un réservoir invalide : ${capacite}`)
  let enCours = 0
  const file: (() => void)[] = []

  // La place passe DIRECTEMENT à la suivante, sans redescendre : aucune tâche arrivée entre-temps ne la lui prend.
  const liberer = () => {
    const suivante = file.shift()
    if (suivante) suivante()
    else enCours -= 1
  }

  return {
    async executer<T>(tache: () => Promise<T>): Promise<T> {
      if (enCours < capacite) enCours += 1
      else await new Promise<void>((tour) => { file.push(tour) })
      try {
        return await tache()
      } finally {
        liberer()
      }
    },
    get enCours() { return enCours },
    get enAttente() { return file.length },
  }
}

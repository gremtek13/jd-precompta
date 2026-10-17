import type { ChangementDeRib } from '../lib/changementDeRib'

// LE DERNIER CHANGEMENT DU RIB, FICTIF, tel que `dernier_changement_de_rib` le rend (espace client, étape A5b3b) : par défaut, un RIB
// PROPOSÉ par un accès client quand aucun n'était confirmé — la combinaison `pose|client|propose|aucun`, une des quinze que la fonction
// rend. Typé sans `as` : le compilateur confronte chaque champ à la forme que le module lit (lib/changementDeRib.ts). Aucun IBAN, aucun
// BIC, aucun titulaire, aucune personne : la fonction n'en rend jamais.
export function changementFictif(o: Partial<ChangementDeRib> = {}): ChangementDeRib {
  return { jour: '2026-10-12', geste: 'pose', auteur: 'client', etat: 'propose', ribEnVigueur: 'aucun', ...o }
}

/** La valeur que la base rend : `{ changement: null }` (le RIB n'a jamais changé) ou le changement, aux clés de la fonction. */
export function valeurRendue(c: ChangementDeRib | null): unknown {
  return c === null
    ? { changement: null }
    : { changement: { jour: c.jour, geste: c.geste, auteur: c.auteur, etat: c.etat, rib_en_vigueur: c.ribEnVigueur } }
}

/** Les quinze combinaisons que la fonction rend, chacune en un changement fictif au jour donné. */
export function toutesLesCombinaisons(jour: string): ChangementDeRib[] {
  const combinaisons: Partial<ChangementDeRib>[] = [
    { geste: 'pose', auteur: 'cabinet', etat: 'confirme', ribEnVigueur: 'pose' },
    { geste: 'pose', auteur: 'client', etat: 'propose', ribEnVigueur: 'aucun' },
    { geste: 'change', auteur: 'cabinet', etat: 'confirme', ribEnVigueur: 'pose' },
    { geste: 'change', auteur: 'cabinet', etat: 'confirme', ribEnVigueur: 'change' },
    { geste: 'change', auteur: 'cabinet', etat: 'confirme', ribEnVigueur: 'inchange' },
    { geste: 'change', auteur: 'client', etat: 'propose', ribEnVigueur: 'aucun' },
    { geste: 'change', auteur: 'client', etat: 'propose', ribEnVigueur: 'inchange' },
    { geste: 'retire', auteur: 'inconnu', etat: 'retire', ribEnVigueur: 'aucun' },
    { geste: 'retire', auteur: 'inconnu', etat: 'retire', ribEnVigueur: 'retire' },
    { geste: 'confirme', auteur: 'cabinet', etat: 'confirme', ribEnVigueur: 'pose' },
    { geste: 'confirme', auteur: 'cabinet', etat: 'confirme', ribEnVigueur: 'change' },
    { geste: 'confirme', auteur: 'cabinet', etat: 'confirme', ribEnVigueur: 'inchange' },
    { geste: 'confirme', auteur: 'inconnu', etat: 'confirme', ribEnVigueur: 'pose' },
    { geste: 'confirme', auteur: 'inconnu', etat: 'confirme', ribEnVigueur: 'change' },
    { geste: 'confirme', auteur: 'inconnu', etat: 'confirme', ribEnVigueur: 'inchange' },
  ]
  return combinaisons.map((c) => changementFictif({ ...c, jour }))
}

// LA NUMÉROTATION QUI CONTINUE (ligne 51.5, étape A9a ; MEG1-Q5, tranchée par le cabinet le 16/10/2026 : deux séries par
// dossier, celle du client et celle du cabinet mandataire, choisie selon QUI valide ; le client qui quitte son ancien
// logiciel continue sa série). La migration `numerotation_continue` (supabase/schema/20261110143033_numerotation_continue.sql,
// collée par le cabinet le 10/11/2026, par-dessus A8a) pose le modèle de numéro d'un dossier (`modeles_numerotation`), la
// série de qui valide, la continuité d'une suite reprise (`continuite_des_series` : la fin confirmée, les trous levés) et
// la chronologie de la série. Ce module redit, au caractère près, ce que la carte du cabinet (A9b) dira AVANT le clic : les
// refus d'un modèle (`refus_du_modele`), son numéro (`numero_du_modele`), son motif (`motif_du_modele`), le recouvrement de
// deux séries (`modeles_se_recouvrent`) et le jugement d'une série (`jugement_de_la_serie`). La base reste seule juge ; le
// module ne fait que le dire plus tôt. numerotationContinue.test.ts le confronte au texte de la migration et rejoue les cas
// de son essai (supabase/essais/numerotationContinue.sql) tels que la réplique y a répondu. Le récit : HISTORIQUE.md,
// « A9A : LA NUMÉROTATION QUI CONTINUE, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) ».
//
// LE DRAPEAU DE LA MIGRATION : levé le 10/11/2026, la migration dans l'export ; ses deux tables sont au plan de sauvegarde
// (`auPlanAujourdHui`, src/lib/sauvegarde.ts). sauvegardeNumerotationContinue.test.ts éprouve le plan prévu et le plan du
// jour, sous chaque état du drapeau.
export const NUMEROTATION_CONTINUE_PREVUE: boolean = true

// LE DRAPEAU DE LA CARTE (A9b), à part depuis le jour J du 10/11/2026 : la carte « Numérotation des factures » de l'onglet
// Informations offre au chef trois gestes (poser un modèle, confirmer la fin d'une suite reprise, lever des trous), et un
// geste ne s'ouvre que sur la décision du cabinet. Baissé, la carte ne rend ni ne lit rien ; son test joue les deux états.
// Levé le 11/11/2026 sur la réponse du cabinet à A9B-Q0 (« L'ouvrir maintenant ») : la base d'A9a est en production depuis
// le 10/11/2026. NumerotationDesFacturesCard.test.tsx garde l'état baissé éprouvé tant que ce drapeau existe.
export const CARTE_DE_LA_NUMEROTATION_OFFERTE: boolean = true

/** La nature d'une série : les factures, ou les avoirs. */
export type NatureDeSerie = 'facture' | 'avoir'
/** Qui émet : le client lui-même (un accès « Ventes »), ou le cabinet, son mandataire (G1.45). */
export type Emetteur = 'client' | 'mandataire'

/** Le modèle d'un emplacement qui n'en a pas (`modele_par_defaut`) : celui d'hier pour le client ; pour le cabinet, une
 *  racine propre au mandataire (A9A-Q1). */
export const MODELES_PAR_DEFAUT: Readonly<Record<Emetteur, Readonly<Record<NatureDeSerie, string>>>> = {
  client: { facture: 'F{AAAA}-{N:4}', avoir: 'A{AAAA}-{N:4}' },
  mandataire: { facture: 'M{AAAA}-{N:4}', avoir: 'MA{AAAA}-{N:4}' },
}

/** Les refus d'un modèle, dans l'ordre de `refus_du_modele`, sous ses mots (la longueur porte le nombre de caractères). */
export const REFUS_DU_MODELE = {
  alphabet: "Un modèle de numéro s'écrit en lettres, chiffres, espaces et signes « - + _ / », avec l'année {AAAA} et le compteur {N:k}, k de 1 à 9 (DGFiP, annexe 7, G1.05).",
  compteur: 'Un modèle de numéro porte un compteur, et un seul : {N:k}, au moins k chiffres (k de 1 à 9).',
  annee: "Un modèle de numéro porte l'année une fois au plus : {AAAA}.",
  espaces: "Un numéro ne commence ni ne finit par une espace, et n'en porte jamais deux de suite (DGFiP, annexe 7, G1.05).",
  annuelSansAnnee: "Un compteur qui repart de 1 chaque année porte l'année dans le numéro, {AAAA} : sans elle, deux factures auraient le même numéro d'une année sur l'autre.",
  apresLeTiret: "Après son premier tiret, un numéro porte un nombre seul jusqu'au tiret suivant — le compteur, l'année ou des chiffres, neuf au plus — : la garde des factures y lit le rang d'une facture pour en suivre l'ordre.",
  longueur: (caracteres: number) =>
    `Ce modèle donnerait des numéros de ${caracteres} caractères, le compteur compté sur neuf chiffres : un numéro en compte 35 au plus (DGFiP, annexe 7, G1.05).`,
} as const

const JETON_COMPTEUR = /\{N:([1-9])\}/
const JETONS_COMPTEUR = /\{N:[1-9]\}/g
const JETONS_ANNEE = /\{AAAA\}/g

/** Le refus d'un modèle, ou null : ce que `refus_du_modele` rend. */
export function refusDuModele(modele: string | null, annuel: boolean): string | null {
  if (modele === null) return REFUS_DU_MODELE.alphabet
  const reste = modele.replace(JETONS_ANNEE, '').replace(JETONS_COMPTEUR, '')
  if (!/^[-+_/A-Za-z0-9 ]*$/.test(reste)) return REFUS_DU_MODELE.alphabet
  if ((modele.match(JETONS_COMPTEUR) ?? []).length !== 1) return REFUS_DU_MODELE.compteur
  if ((modele.match(JETONS_ANNEE) ?? []).length > 1) return REFUS_DU_MODELE.annee
  if (modele.startsWith(' ') || modele.endsWith(' ') || modele.includes('  ')) return REFUS_DU_MODELE.espaces
  if (annuel && !modele.includes('{AAAA}')) return REFUS_DU_MODELE.annuelSansAnnee
  // La garde d'hier lit le rang d'une facture après son premier tiret : un nombre seul, neuf chiffres au plus.
  const tiret = modele.indexOf('-')
  if (tiret >= 0) {
    const segment = modele.slice(tiret + 1).split('-')[0]
    if (!(/^\{N:[1-9]\}$/.test(segment) || /^[0-9]{1,9}$/.test(segment.replaceAll('{AAAA}', '0000')))) {
      return REFUS_DU_MODELE.apresLeTiret
    }
  }
  const k = Number(JETON_COMPTEUR.exec(modele)?.[1])
  const longueur = modele.replaceAll('{AAAA}', '0000').replace(JETONS_COMPTEUR, '').length + Math.max(k, 9)
  if (longueur > 35) return REFUS_DU_MODELE.longueur(longueur)
  return null
}

/** Le numéro d'un compteur (`numero_du_modele`) : l'année sur quatre chiffres, le compteur sur k chiffres au moins. */
export function numeroDuModele(modele: string, annee: number, compteur: number): string {
  const k = Number(JETON_COMPTEUR.exec(modele)?.[1])
  return modele.replaceAll('{AAAA}', String(annee).padStart(4, '0')).replace(JETON_COMPTEUR, String(compteur).padStart(k, '0'))
}

/** Le motif d'une série (`motif_du_modele`), ancré, le compteur canonique pour seul groupe ; l'année est celle de la série
 *  pour un compteur annuel, toute année sinon. */
export function motifDuModele(modele: string, annuel: boolean, annee: number): string {
  const k = JETON_COMPTEUR.exec(modele)?.[1] ?? ''
  return '^' + modele.replaceAll('+', '\\+')
    .replaceAll('{AAAA}', annuel ? String(annee).padStart(4, '0') : '[0-9]{4}')
    .replace(JETON_COMPTEUR, `([0-9]{${k}}|[1-9][0-9]{${k},})`) + '$'
}

/** Le compteur d'un numéro dans une série, ou null s'il n'en est pas. */
export function compteurDansLaSerie(numero: string, modele: string, annuel: boolean, annee: number): number | null {
  const m = new RegExp(motifDuModele(modele, annuel, annee)).exec(numero)
  return m ? Number(m[1]) : null
}

/** Deux modèles peuvent-ils produire un même numéro (`modeles_se_recouvrent`) ? La tête, le compteur et la queue de
 *  chacun, l'année comme quatre chiffres quelconques ; position par position, pour chaque longueur où les deux tiennent,
 *  jusqu'à ce que rien ne change plus. */
export function modelesSeRecouvrent(un: string, autre: string): boolean {
  const morceaux = (m: string) => {
    const i = m.indexOf('{N:')
    return { h: m.slice(0, i).replaceAll('{AAAA}', '####'), t: m.slice(i + 5).replaceAll('{AAAA}', '####'), k: Number(m[i + 3]) }
  }
  const a = morceaux(un)
  const b = morceaux(autre)
  const classe = (x: { h: string; t: string }, l: number, p: number) =>
    p < x.h.length ? x.h[p] : p >= l - x.t.length ? x.t[p - (l - x.t.length)] : '#'
  const chiffre = (c: string) => c >= '0' && c <= '9'
  const min = Math.max(a.h.length + a.k + a.t.length, b.h.length + b.k + b.t.length)
  const max = Math.max(min, Math.max(a.h.length, b.h.length) + Math.max(a.t.length, b.t.length) + Math.max(a.k, b.k)) + 1
  for (let l = min; l <= max; l++) {
    let ensemble = true
    for (let p = 0; p < l; p++) {
      const c1 = classe(a, l, p)
      const c2 = classe(b, l, p)
      if (!(c1 === c2 || (c1 === '#' && chiffre(c2)) || (c2 === '#' && chiffre(c1)))) {
        ensemble = false
        break
      }
    }
    if (ensemble) return true
  }
  return false
}

/** La clé d'une série dans `facture_numerotation` (`cle_de_serie`). */
export function cleDeSerie(modele: string, annuel: boolean): string {
  if (annuel && modele === 'F{AAAA}-{N:4}') return 'facture'
  if (annuel && modele === 'A{AAAA}-{N:4}') return 'avoir'
  return `modele:${annuel ? 'a' : 'c'}:${modele}`
}

/** Ce que les messages disent d'une série (`libelle_de_serie`). */
export function libelleDeSerie(modele: string, annuel: boolean, annee: number): string {
  return `du modèle ${modele}${annuel ? ` (${annee})` : ''}`
}

/** Un intervalle de compteurs, bornes comprises. */
export type Intervalle = readonly [number, number]

export interface SerieAJuger {
  modele: string
  annuel: boolean
  annee: number
  /** Le premier numéro posé avec le modèle (`premier_numero`), qui vaut pour son année d'effet (`depuis`) seulement quand
   *  le compteur est annuel ; null, `depuis`, pour le modèle d'un emplacement qui n'en a pas. */
  premierNumero: number
  depuis: number | null
  /** Les numéros du dossier, validés ou repris de l'ancien logiciel (les autres états n'ont pas de numéro). */
  numeros: readonly { numero: string; statut: 'validee' | 'importee' }[]
  /** Les fins confirmées de la série (geste `fin`), et ses trous levés (geste `trous`). */
  fins: readonly number[]
  levees: readonly Intervalle[]
}

export interface JugementDeLaSerie {
  premier: number
  emis: number | null
  importes: number
  valides: number
  fin: number | null
  trous: Intervalle[]
  refus: string | null
  prochain: number
}

/** Le jugement d'une série pour une année (`jugement_de_la_serie`) : sa suite reprise — une facture reprise de l'ancien
 *  logiciel en a le motif, ou une fin y est confirmée — se confirme tant que l'application n'y a rien validé, et n'a aucun
 *  trou que le cabinet n'ait levé ; une série de l'application seule ne se juge pas. */
export function jugementDeLaSerie(s: SerieAJuger): JugementDeLaSerie {
  const premier = !s.annuel || s.depuis === s.annee ? s.premierNumero : 1
  const lus = s.numeros
    .map((n) => ({ statut: n.statut, c: compteurDansLaSerie(n.numero, s.modele, s.annuel, s.annee) }))
    .filter((n): n is { statut: 'validee' | 'importee'; c: number } => n.c !== null)
  const emis = lus.length > 0 ? Math.max(...lus.map((n) => n.c)) : null
  const repris = lus.filter((n) => n.statut === 'importee')
  const maxRepris = repris.length > 0 ? Math.max(...repris.map((n) => n.c)) : null
  const valides = lus.filter((n) => n.statut === 'validee').length
  const fin = s.fins.length > 0 ? Math.max(...s.fins) : null
  let refus: string | null = null
  const trous: Intervalle[] = []
  const libelle = libelleDeSerie(s.modele, s.annuel, s.annee)
  if (repris.length > 0 || fin !== null) {
    if (valides === 0 && (fin === null || (maxRepris !== null && fin < maxRepris))) {
      refus = `La suite reprise de la série ${libelle} n'est pas confirmée : le cabinet dit le dernier numéro que l'ancien logiciel y a émis (${numeroDuModele(s.modele, s.annee, Math.max(maxRepris ?? 1, 1))} au moins) avant que l'application la continue.`
    }
    const haut = Math.max(emis ?? 0, fin ?? 0)
    if (haut >= premier) {
      // Les numéros lus et les trous levés, entre deux sentinelles : chaque écart entre deux couvertures consécutives est un trou.
      const couvert: [number, number][] = [
        ...lus.filter((n) => n.c >= premier && n.c <= haut).map((n): [number, number] => [n.c, n.c]),
        ...s.levees.filter(([a, b]) => b >= premier && a <= haut).map(([a, b]): [number, number] => [Math.max(a, premier), Math.min(b, haut)]),
        [premier - 1, premier - 1],
        [haut + 1, haut + 1],
      ]
      couvert.sort((x, y) => x[0] - y[0] || x[1] - y[1])
      let avant = -Infinity
      for (const [debut, finIntervalle] of couvert) {
        if (avant !== -Infinity && debut > avant + 1) trous.push([avant + 1, debut - 1])
        avant = Math.max(avant, finIntervalle)
      }
    }
    if (refus === null && trous.length > 0) {
      const nom = ([a, b]: Intervalle) => a === b
        ? numeroDuModele(s.modele, s.annee, a)
        : `${numeroDuModele(s.modele, s.annee, a)} à ${numeroDuModele(s.modele, s.annee, b)}`
      const total = trous.reduce((somme, [a, b]) => somme + b - a + 1, 0)
      const suite = trous.length > 5
        ? ` — et ${trous.length === 6 ? 'un intervalle' : `${trous.length - 5} intervalles`} de plus, ${total} numéros manquants en tout`
        : ''
      refus = `La série ${libelle} a des trous : ${trous.slice(0, 5).map(nom).join(', ')}${suite}. Chaque numéro manquant s'importe, ou le cabinet le lève, motif écrit, avant que l'application continue la série.`
    }
  }
  return {
    premier, emis, importes: repris.length, valides, fin, trous, refus,
    prochain: Math.max(emis ?? 0, fin ?? 0, premier - 1) + 1,
  }
}

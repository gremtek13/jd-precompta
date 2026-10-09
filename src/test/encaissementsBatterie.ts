import {
  refusEnregistrement, repartitionProposee, resteAEncaisser,
  type CleRefusEnregistrement, type ContexteFacture, type EncaissementLu, type FacturePourEncaissement, type LigneDeFacture,
  type MouvementLu, type PartLue, type PartSaisie, type SaisieEncaissement,
} from '../lib/encaissementsFactures'
import { TAUX_ADMIS } from '../lib/factureCii'
import type { CodeStatutRecu } from '../lib/cdarRecu'
import { ajouterJours, anneeDe } from '../lib/format'
import { calculerTotaux } from '../lib/montantsFacture'
import type { EtatTransmission } from '../lib/types'

// LA BATTERIE DES REFUS D'`enregistrer_encaissement` (ligne 28.5, étape d2) : un monde FICTIF — deux dossiers, quatorze
// factures, dix mouvements, des encaissements vivants, retirés, annulés et en excès, et depuis l'étape d7 des statuts lus
// sur la plateforme du client — et des saisies tirées au hasard
// par un générateur déterministe. encaissementsBatterie.test.ts passe chaque saisie au module ; la base, elle, les a
// jugées une à une sur une réplique locale du schéma de production (les neuf familles d'objets à l'empreinte de la
// production, le 08/10/2026), et le test confronte les deux par l'empreinte de leurs réponses. Les noms (`F1`,
// `M1355`…) deviennent des identifiants en base ; ici ils servent d'identifiants. Le script qui l'a jouée construit ce
// monde dans une transaction, appelle la fonction en chef du cabinet pour chaque saisie, annule tout : il vit dans le
// dépôt depuis l'étape d4 (supabase/essais/batterieEncaissements.mjs), et la batterie se rejoue n'importe quel jour.
//
// Ce que la batterie ne joue pas, et que les tests unitaires jouent : une date qui n'en est pas une (PostgREST ne la
// lirait pas comme une date, la fonction ne la reçoit jamais), un nombre qui n'en est pas un (JSON l'écrit `null`).

/** Le jour où la base a jugé la batterie dont encaissementsBatterie.test.ts fige l'empreinte : elle lit sa date à Paris,
 * le module la reçoit. Les saisies visent ce jour, le lendemain et le 1er janvier qui suit : elles en dépendent. */
export const AUJOURD_HUI_RELEVE = '2026-10-09'

/** Le nombre de saisies de la batterie, et la graine de son tirage. */
export const SAISIES_DE_LA_BATTERIE = 4000
export const GRAINE_DE_LA_BATTERIE = 20261008

export const DOSSIERS = { A: 'ac538d93-7da3-4403-bca6-2d7836810a6f', B: '001c7ed7-c23b-4590-901e-693489f8af24' } as const
type NomDossier = keyof typeof DOSSIERS

export interface LigneDuMonde {
  quantite: number
  prix: number
  taux: number
}

export interface FactureDuMonde {
  id: string
  dossier: NomDossier
  statut: 'brouillon' | 'validee'
  type: 'facture' | 'avoir'
  date: string
  lignes: LigneDuMonde[]
  /** L'en-tête enregistré : celui des lignes, sauf la facture dont le monde le veut faux. */
  entete: { ht: number; tva: number; ttc: number }
  /** La facture qu'un avoir corrige. */
  origine: string | null
}

export interface MouvementDuMonde {
  id: string
  dossier: NomDossier
  montant: number
}

export interface EncaissementDuMonde {
  id: string
  facture: string
  montant: number
  mouvement: string | null
  annule: string | null
  retire: boolean
  parts: PartSaisie[]
}

export interface Monde {
  factures: FactureDuMonde[]
  mouvements: MouvementDuMonde[]
  encaissements: EncaissementDuMonde[]
  transmissions: { facture: string; etat: EtatTransmission }[]
  evenements: { facture: string; code: string }[]
  /** Les statuts lus sur la plateforme du client (`statuts_factures_recus`, étape d7). */
  statutsRecus: { facture: string; code: CodeStatutRecu }[]
}

function facture(
  id: string, lignes: LigneDuMonde[], o: Partial<Omit<FactureDuMonde, 'id' | 'lignes'>> = {},
): FactureDuMonde {
  const t = calculerTotaux(lignes.map((l) => ({ quantite: l.quantite, prix_unitaire_ht: l.prix, taux_tva: l.taux })))
  return {
    id, dossier: 'A', statut: 'validee', type: 'facture', date: '2026-09-15', lignes,
    entete: { ht: t.montant_ht, tva: t.montant_tva, ttc: t.montant_ttc }, origine: null, ...o,
  }
}

export const MONDE: Monde = {
  factures: [
    // La facture de l'essai de production : 1 200,00 € à 20 %, 105,50 € à 5,5 %, 50,00 € à 0 %.
    facture('F1', [{ quantite: 1, prix: 1000, taux: 20 }, { quantite: 1, prix: 100, taux: 5.5 }, { quantite: 1, prix: 50, taux: 0 }]),
    // Des lignes que la virgule flottante arrondit autrement que les décimaux : 3 × 1,005 € vaut 3,01 € HT.
    facture('F2', [{ quantite: 3, prix: 1.005, taux: 20 }, { quantite: 2, prix: 33.333333, taux: 10 }]),
    facture('F3', [{ quantite: 1, prix: 100, taux: 19 }, { quantite: 1, prix: 50, taux: 20 }]),
    facture('F4', [{ quantite: 1, prix: 100, taux: 20 }], { entete: { ht: 100, tva: 21, ttc: 121 } }),
    facture('F5', [{ quantite: 1, prix: 10, taux: 20 }], { statut: 'brouillon' }),
    facture('F6', [{ quantite: -1, prix: 1, taux: 0 }], { type: 'avoir', origine: 'F1', entete: { ht: -1, tva: 0, ttc: -1 } }),
    facture('F7', [{ quantite: 1, prix: 500, taux: 20 }]),
    facture('F8', [{ quantite: 1, prix: 500, taux: 20 }]),
    facture('F9', [{ quantite: 1, prix: 100, taux: 20 }], { dossier: 'B' }),
    facture('F10', [{ quantite: 1, prix: 1200, taux: 20 }, { quantite: 1, prix: 300, taux: 5.5 }, { quantite: 1, prix: 37.37, taux: 2.1 }]),
    // Rejetée ET d'un en-tête faux : la base dit le rejet d'abord.
    facture('F11', [{ quantite: 1, prix: 100, taux: 20 }], { entete: { ht: 100, tva: 21, ttc: 121 } }),
    // Plus qu'encaissée (une restauration écrit sans les plafonds) : en tout pour F12, à un taux seulement pour F13.
    facture('F12', [{ quantite: 1, prix: 100, taux: 20 }]),
    facture('F13', [{ quantite: 1, prix: 100, taux: 20 }, { quantite: 1, prix: 100, taux: 0 }]),
    // Refusée par l'acheteur, ce que seule sa plateforme a dit (étape d7) : un statut 210 lu, rien d'autre.
    facture('F14', [{ quantite: 1, prix: 250, taux: 20 }]),
  ],
  mouvements: [
    { id: 'M1355', dossier: 'A', montant: 1355.5 }, { id: 'M100', dossier: 'A', montant: 100 },
    { id: 'M98', dossier: 'A', montant: 98 }, { id: 'M1000', dossier: 'A', montant: 1000 },
    { id: 'M2000', dossier: 'A', montant: 2000 }, { id: 'M50', dossier: 'A', montant: 50 },
    { id: 'M73', dossier: 'A', montant: 73.34 }, { id: 'Mdebit', dossier: 'A', montant: -50 },
    { id: 'Mzero', dossier: 'A', montant: 0 }, { id: 'Mautre', dossier: 'B', montant: 100 },
  ],
  encaissements: [
    { id: 'e1', facture: 'F1', montant: 500, mouvement: 'M1355', annule: null, retire: false,
      parts: [{ taux: 20, montant: 442.64 }, { taux: 5.5, montant: 38.92 }, { taux: 0, montant: 18.44 }] },
    { id: 'e2', facture: 'F1', montant: 100, mouvement: 'M100', annule: null, retire: true, parts: [{ taux: 20, montant: 100 }] },
    { id: 'e3', facture: 'F1', montant: 200, mouvement: null, annule: null, retire: false, parts: [{ taux: 20, montant: 200 }] },
    { id: 'a3', facture: 'F1', montant: -200, mouvement: null, annule: 'e3', retire: false, parts: [{ taux: 20, montant: -200 }] },
    { id: 'e4', facture: 'F10', montant: 600, mouvement: 'M1000', annule: null, retire: false, parts: [{ taux: 20, montant: 600 }] },
    { id: 'e5', facture: 'F2', montant: 3.61, mouvement: 'M2000', annule: null, retire: false, parts: [{ taux: 20, montant: 3.61 }] },
    { id: 'e6', facture: 'F10', montant: 100, mouvement: 'M98', annule: null, retire: false, parts: [{ taux: 5.5, montant: 100 }] },
    { id: 'e7', facture: 'F12', montant: 130, mouvement: null, annule: null, retire: false, parts: [{ taux: 20, montant: 130 }] },
    { id: 'e8', facture: 'F13', montant: 130, mouvement: null, annule: null, retire: false, parts: [{ taux: 20, montant: 130 }] },
  ],
  transmissions: [
    { facture: 'F7', etat: 'rejete' }, { facture: 'F1', etat: 'accepte' }, { facture: 'F10', etat: 'echec' }, { facture: 'F11', etat: 'rejete' },
  ],
  evenements: [{ facture: 'F8', code: 'fr:210' }, { facture: 'F1', code: 'fr:205' }],
  // Un litige (207) et un paiement transmis (211) ne refusent rien ; un refus (210) lu seul, si.
  statutsRecus: [{ facture: 'F1', code: '207' }, { facture: 'F1', code: '211' }, { facture: 'F14', code: '210' }],
}

export interface CasDeBatterie {
  dossier: NomDossier
  facture: string
  date: string | null
  montant: number | null
  moyen: string | null
  /** Un mouvement du monde, `inconnu` (aucun), ou null. */
  ligne: string | null
  repartition: PartSaisie[]
}

// Ce que le module lit, construit du monde comme la base le lit.
export function lecturesDuMonde(m: Monde): {
  factures: Map<string, FacturePourEncaissement>
  lignes: LigneDeFacture[]
  encaissements: EncaissementLu[]
  parts: PartLue[]
  mouvements: MouvementLu[]
  transmissions: ContexteFacture['transmissions']
  evenements: ContexteFacture['evenementsSuperpdp']
  statutsRecus: ContexteFacture['statutsRecus']
} {
  const factures = new Map(m.factures.map((f) => [f.id, {
    id: f.id, dossier_id: DOSSIERS[f.dossier], statut: f.statut, type: f.type, numero: null, date_emission: f.date,
    emetteur_siret: null, montant_ht: f.entete.ht, montant_tva: f.entete.tva, montant_ttc: f.entete.ttc, superpdp_invoice_id: null,
    tiers_nom: 'Essai',
  } satisfies FacturePourEncaissement]))
  const dossierDe = (factureId: string) => (factures.get(factureId) as FacturePourEncaissement).dossier_id
  return {
    factures,
    lignes: m.factures.flatMap((f) => f.lignes.map((l, i) => ({
      facture_id: f.id, ordre: i + 1, designation: 'x', quantite: l.quantite, prix_unitaire_ht: l.prix, taux_tva: l.taux,
    }))),
    encaissements: m.encaissements.map((e) => ({
      id: e.id, dossier_id: dossierDe(e.facture), facture_id: e.facture, montant: e.montant, ligne_bancaire_id: e.mouvement,
      annule_id: e.annule, retire_le: e.retire ? '2026-10-01T10:00:00Z' : null,
    })),
    parts: m.encaissements.flatMap((e) => e.parts.map((p) => ({ encaissement_id: e.id, taux: p.taux, montant: p.montant }))),
    mouvements: m.mouvements.map((x) => ({ id: x.id, dossier_id: DOSSIERS[x.dossier], date: '2026-09-20', montant: x.montant })),
    transmissions: m.transmissions.map((t) => ({
      facture_id: t.facture, canal: 'plateforme' as const, etat: t.etat, hote: 'pa.exemple.fr', flux_id: 'flux-1',
    })),
    evenements: m.evenements.map((e) => ({ facture_id: e.facture, status_code: e.code })),
    statutsRecus: m.statutsRecus.map((s) => ({ facture_id: s.facture, code: s.code })),
  }
}

/** Le contexte et la saisie d'un cas, tels que l'écran les donnerait au module. */
export function entreeDuCas(m: Monde, cas: CasDeBatterie): { contexte: ContexteFacture; saisie: SaisieEncaissement; mouvements: MouvementLu[] } {
  const l = lecturesDuMonde(m)
  return {
    contexte: {
      dossierId: DOSSIERS[cas.dossier], facture: l.factures.get(cas.facture) as FacturePourEncaissement, lignes: l.lignes,
      transmissions: l.transmissions, evenementsSuperpdp: l.evenements, statutsRecus: l.statutsRecus,
      encaissements: l.encaissements, parts: l.parts,
    },
    saisie: { date: cas.date, montant: cas.montant, moyen: cas.moyen, ligneBancaireId: cas.ligne, repartition: cas.repartition },
    mouvements: l.mouvements,
  }
}

// Un tirage déterministe sur 32 bits (« mulberry32 ») : la même graine rend toujours la même suite. Ses opérations sont
// EXACTES (Math.imul, décalages) — un générateur congruentiel écrit `(x × 1103515245 + 12345) % 2³¹` en virgule
// flottante passe 2⁵³ à la multiplication, perd ses derniers chiffres et retombe vite dans un cycle : la première
// batterie, tirée ainsi, ne comptait que 1 210 saisies distinctes sur 4 000. C'est le générateur de TOUT test qui tire
// ses cas au hasard (tirage.test.ts refuse l'autre forme partout dans le dépôt) : il rend un flottant de [0, 1) ;
// `entierTire` en fait un entier.
export function tirage(graine: number): () => number {
  let a = graine | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Un entier de [0, n) tiré par `suivant` (un `tirage`), `n` entier positif. Chaque entier de la plage peut sortir tant
 * que `n` ne dépasse pas 2³², le nombre de valeurs d'un tirage ; au-delà, la plage est parcourue à pas de n / 2³² — ce
 * que fait la batterie, qui tire un montant jusqu'à 10¹⁵ centimes pour passer un plafond, pas pour en toucher chaque
 * centime. Sans plafond donc, puisque la batterie dont la base a jugé l'empreinte le tire ainsi. */
export function entierTire(suivant: () => number, n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`entierTire : ${n} n'est pas un entier positif`)
  return Math.floor(suivant() * n)
}

function generateur(graine: number) {
  const suivant = tirage(graine)
  const entier = (n: number) => entierTire(suivant, n)
  const parmi = <T>(liste: readonly T[]): T => liste[entier(liste.length)]
  // Un choix pondéré : [poids, valeur] ; les poids n'ont pas à faire 1.
  const pondere = <T>(choix: readonly [number, () => T][]): T => {
    const total = choix.reduce((s, [p]) => s + p, 0)
    let r = suivant() * total
    for (const [p, f] of choix) {
      if (r < p) return f()
      r -= p
    }
    return choix[choix.length - 1][1]()
  }
  return { suivant, entier, parmi, pondere }
}

const euros = (centimes: number) => centimes / 100

/** Les saisies de la batterie, dans leur ordre, pour une base qui la juge le jour `aujourdHui` (à Paris). */
export function batterie(nombre: number, graine: number, aujourdHui: string): CasDeBatterie[] {
  const demain = ajouterJours(aujourdHui, 1)
  const anneeSuivante = `${anneeDe(aujourdHui) + 1}-01-01`
  const g = generateur(graine)
  const l = lecturesDuMonde(MONDE)
  const tauxDe = (factureId: string) => [...new Set(MONDE.factures.find((f) => f.id === factureId)?.lignes.map((x) => x.taux))]
  const cas: CasDeBatterie[] = []
  for (let n = 0; n < nombre; n++) {
    const factureId = g.pondere<string>([
      [30, () => 'F1'], [12, () => 'F2'], [25, () => 'F10'], [6, () => 'F3'], [5, () => 'F4'], [4, () => 'F5'],
      [4, () => 'F6'], [4, () => 'F7'], [4, () => 'F8'], [6, () => 'F9'], [3, () => 'F11'], [4, () => 'F12'], [5, () => 'F13'],
      [4, () => 'F14'],
    ])
    const dossier: NomDossier = factureId === 'F9' ? g.pondere<NomDossier>([[4, () => 'B'], [1, () => 'A']]) : g.pondere<NomDossier>([[24, () => 'A'], [1, () => 'B']])
    const f = l.factures.get(factureId) as FacturePourEncaissement
    const contexte: ContexteFacture = {
      dossierId: DOSSIERS[dossier], facture: f, lignes: l.lignes, transmissions: l.transmissions,
      evenementsSuperpdp: l.evenements, statutsRecus: l.statutsRecus, encaissements: l.encaissements, parts: l.parts,
    }
    const reste = resteAEncaisser(contexte)
    const taux = tauxDe(factureId)

    const date = g.pondere<string | null>([
      [4, () => null], [4, () => '1999-12-31'], [3, () => '2000-01-01'], [10, () => aujourdHui], [4, () => demain],
      [2, () => anneeSuivante],
      [73, () => `2026-${String(1 + g.entier(9)).padStart(2, '0')}-${String(1 + g.entier(28)).padStart(2, '0')}`],
    ])

    const ligne = g.pondere<string | null>([
      [45, () => null], [50, () => g.parmi(MONDE.mouvements.map((m) => m.id))], [5, () => 'inconnu'],
    ])

    // LA FRONTIÈRE DU SEUIL DES FRAIS, là où un calcul en virgule flottante et un calcul exact se sépareraient : le total
    // des encaissements du mouvement juste au plus haut que la base accepte, ou un centime au-delà — 2 % du total
    // (100 × (total − crédit) ≤ 2 × total, soit total ≤ 100 × crédit / 98) ou 5 € au-dessus du crédit. Le calcul des
    // encaissements qui le prennent déjà ne sert qu'à viser : la base et le module en jugent chacun de leur côté.
    const mouvement = MONDE.mouvements.find((m) => m.id === ligne)
    const frontiere = (): number | null => {
      if (!mouvement || mouvement.montant <= 0) return null
      const credit = Math.round(mouvement.montant * 100)
      const autres = l.encaissements
        .filter((e) => e.ligne_bancaire_id === mouvement.id && e.retire_le == null
          && !l.encaissements.some((a) => a.annule_id === e.id && a.retire_le == null))
        .reduce((s, e) => s + Math.round(e.montant * 100), 0)
      const bas = Math.floor((100 * credit) / 98)
      const montantC = g.parmi([bas, bas + 1, credit + 500, credit + 501]) - autres
      return montantC > 0 ? euros(montantC) : null
    }

    const resteC = Math.max(reste.resteCentimes, 1)
    const ttcDUnTaux = reste.parTaux.length > 0 ? g.parmi(reste.parTaux).ttcCentimes : 100
    const montant = g.pondere<number | null>([
      [3, () => null], [2, () => 0], [2, () => -euros(1 + g.entier(10000))], [1, () => 10_000_000_000_000],
      // Un montant au millième, que la base refuse au centime.
      [4, () => Math.round(g.suivant() * 100000) / 1000 + 0.001],
      [14, () => euros(reste.resteCentimes)], [6, () => euros(reste.resteCentimes + 1)], [4, () => euros(reste.resteCentimes - 1)],
      [25, () => euros(1 + g.entier(resteC))], [8, () => euros(1 + g.entier(2 * resteC + 1))],
      [6, () => euros(ttcDUnTaux + g.parmi([-1, 0, 1]))], [8, () => euros(1 + g.entier(500))], [5, () => euros(1 + g.entier(30000))],
      [ligne ? 20 : 0, () => frontiere() ?? euros(1 + g.entier(500))],
    ])

    const moyen = g.pondere<string | null>([
      [90, () => g.parmi(['virement', 'cheque', 'carte', 'prelevement', 'especes', 'effet', 'compensation', 'autre'])],
      [4, () => 'troc'], [3, () => null], [3, () => ''],
    ])

    const base = montant ?? 1
    const baseC = Math.round(base * 100)
    const repartition = g.pondere<PartSaisie[]>([
      [40, () => {
        const proposee = repartitionProposee(baseC, reste.parTaux)
        return proposee ? proposee.map((p) => ({ taux: p.taux, montant: euros(p.centimes) })) : [{ taux: taux[0] ?? 20, montant: base }]
      }],
      [15, () => {
        // Un partage au hasard entre les taux de la facture : le dernier prend le reste, qui peut tomber à zéro ou moins.
        const parts: PartSaisie[] = []
        let restant = baseC
        taux.forEach((t, i) => {
          const c = i === taux.length - 1 ? restant : g.entier(Math.max(restant, 1) + 1)
          parts.push({ taux: t, montant: euros(c) })
          restant -= c
        })
        return parts
      }],
      [5, () => []],
      [5, () => [{ taux: taux[0] ?? 20, montant: euros(Math.floor(baseC / 2)) }, { taux: taux[0] ?? 20, montant: euros(baseC - Math.floor(baseC / 2)) }]],
      [5, () => [{ taux: g.parmi([10, 7, 13]), montant: base }]],
      [4, () => [{ taux: g.parmi([19, 3.3, 21]), montant: base }]],
      [6, () => [{ taux: taux[0] ?? 20, montant: g.parmi([0, -1, -0.5]) }, { taux: taux[1] ?? 10, montant: base }]],
      [8, () => [{ taux: taux[0] ?? 20, montant: euros(baseC + g.parmi([-1, 1])) }]],
      [4, () => [{ taux: taux[0] ?? 20, montant: Math.round(base * 1000 + 1) / 1000 }]],
      [8, () => [{ taux: g.parmi(taux.length > 0 ? taux : [...TAUX_ADMIS]), montant: base }]],
    ])
    // L'ordre des parts compte (la base dit la première en excès) : il se mélange parfois.
    if (repartition.length > 1 && g.suivant() < 0.3) repartition.reverse()
    cas.push({ dossier, facture: factureId, date, montant, moyen, ligne, repartition })
  }
  return cas
}

// Le code de chaque refus, dans la famille que la base lui donne ; les autres sont des paramètres invalides (22023).
const CODES_DES_REFUS: Partial<Record<CleRefusEnregistrement, string>> = { acces: '42501', facture_introuvable: 'P0002' }

/** Ce que le module répond à chaque saisie, écrit comme la base l'écrit : `ok`, ou le code et le message du refus. */
export function reponsesDuModule(cas: readonly CasDeBatterie[], aujourdHui: string): string[] {
  return cas.map((c) => {
    const e = entreeDuCas(MONDE, c)
    const r = refusEnregistrement(e.contexte, e.saisie, e.mouvements, aujourdHui)
    return r ? `${CODES_DES_REFUS[r.cle] ?? '22023'} ${r.message}` : 'ok'
  })
}

import { libelleExploitable } from './appariementBanque'
import { caseDuPoste } from './cases2035'
import { libellePeriode } from './declarationTva'
import type { ContributionDeclaration, Declaration2035, SourceDeclaration } from './declaration2035'
import { nomDuVehicule } from './forfaitKilometrique'
import { anneeDe, formatDate, formatMoney } from './format'
import type { EcritureBrouillon } from './types'

// LA 2035 SE RETROUVE-T-ELLE DANS LES ÉCRITURES ? (ligne 26.6 de la feuille de route, étape c)
//
// La 2035 se calcule depuis les SOURCES (lib/declaration2035.ts) : les pièces, les mouvements du relevé, le
// registre des biens, le cadre 7, les échéances de cotisation. Le FEC, depuis le BROUILLON. Depuis l'étape (b),
// chacune de ces sources s'écrit ; mais une écriture est un brouillon qu'on génère, qu'on régénère, qu'on
// oublie d'écrire — et un vérificateur qui additionne le FEC doit retrouver la déclaration signée. C'est le
// contrôle de concordance d'une liasse avec sa balance, fait SOURCE PAR SOURCE ET COMPTE PAR COMPTE : un écart
// de total ne dit pas où chercher, une source oui.
//
// LA 2035 RESTE CALCULÉE DEPUIS LES SOURCES, et c'est un choix : tirée des écritures, elle dépendrait de cinq
// gestes « Écrire » répartis dans cinq onglets, et un brouillon en retard donnerait une déclaration fausse
// sans que rien ne le dise. Comparée à elles, elle dit au contraire ce qui manque au FEC pour la porter.
//
// LA PART D'UNE VENTE FACTURÉE (ligne 28.6, chantier EC-Q3 ; étapes VF3b1 puis VF4c3) se rapproche des écritures de SON
// ENCAISSEMENT, comme toute source : la 2035 la porte au compte que la composition écrit pour elle (`compteDuProduit`,
// lib/ecrituresVentesFacturees.ts), et l'écriture que l'onglet Écritures passe (`ecrire_vente_facturee`) la désigne par
// `encaissement_id` — une facture ou un avoir par `facture_id`, qu'un modèle de trésorerie n'écrit jamais en résultat. Ici
// la 2035 est celle de la trésorerie : en engagement, elle n'est pas produite, et la concordance non plus. Rapprochées
// source par source et compte par compte, elles concordent quand l'écriture est à jour. Sinon l'écart garde un motif à
// lui, qui envoie à la section « Ventes facturées » de l'onglet Écritures plutôt qu'aux gestes d'une pièce
// (« régénérer ») : `vente_facturee_non_ecrite` (aucune écriture de l'exercice ne la porte : à écrire),
// `vente_facturee_a_reecrire` (une écriture qui n'est plus celle que l'encaissement commande), `vente_facturee_a_retirer`
// (une écriture d'un encaissement que la 2035 ne compte pas dans l'exercice).
//
// ET LES FRAIS D'UN MOUVEMENT QUE SES ENCAISSEMENTS CLASSENT (`frais_d_encaissements`) : l'écart entre ce que les
// encaissements portent et ce que la banque a crédité, sous le seuil des frais, s'écrit au compte des services bancaires
// (627000) — une charge de l'exercice. La 2035 ne la compte pas : elle ne lit des ventes facturées que leurs parts, et le
// mouvement, réservé à ses encaissements, n'est pas une part du relevé. Un écart VRAI, que la concordance dit sans
// l'imputer à l'écriture : c'est la 2035 qui manque d'une dépense, et aucun geste de l'application ne la lui donne encore.
//
// CE QUI N'EST PAS UN ÉCART, PAR CONSTRUCTION : la CSG déductible (case BV). La CSG-CRDS passe entière au
// 108000, hors résultat, et seule sa part déductible entre en BV — la présentation relevée sur la 2035 déposée
// par le cabinet. Elle est dite à part : le résultat du FEC dépasse celui de la 2035 de son montant.
//
// Les montants sont comparés EN CENTIMES ENTIERS, et l'effet de chaque côté est celui sur le RÉSULTAT : une
// recette l'augmente, une dépense le diminue — au crédit ou au débit d'un compte de classe 7 ou 6, pour les
// écritures. Un compte de bilan (la banque, la TVA, le compte du dirigeant, une immobilisation) n'entre pas
// dans le résultat, ni d'un côté ni de l'autre.

// Ce que la concordance ne sait pas rapprocher d'une source de la 2035 : une écriture sans pièce, sans
// mouvement, sans bien, ni véhicule, ni déclaration de TVA, ni échéance payée depuis le compte personnel, ni facture ni
// encaissement — le lien a été rompu (sa pièce supprimée, la clé mise à nul). Une échéance de cotisation sans mouvement a
// pour référence l'échéance elle-même : payée depuis le compte personnel, son écriture la désigne (`cotisation_id`) ; sans
// paiement, elle n'a pas d'écriture.
export type ReferenceEcriture = {
  type: 'piece' | 'mouvement' | 'bien' | 'vehicule' | 'cotisation' | 'declaration' | 'encaissement' | 'facture' | 'ecriture'
  id: string
}

export type MotifEcart =
  // La 2035 compte la source ; aucune écriture de l'exercice ne la porte.
  | 'sans_ecriture'
  // ... son écriture est datée d'un autre exercice.
  | 'ecriture_autre_exercice'
  // ... sa catégorie n'a pas de compte : rien ne peut l'écrire.
  | 'sans_compte'
  // ... une échéance de cotisation comptée à son échéance, sans prélèvement rapproché ni paiement depuis le compte
  // personnel : rien à écrire.
  | 'echeance_sans_paiement'
  // ... une échéance rapprochée d'un mouvement qui ne peut pas la payer par une écriture (un encaissement sur
  // un appel, une CSG-CRDS qui dépasse le mouvement) : comptée à son échéance, son rapprochement est à revoir.
  | 'rapprochement_refuse'
  // ... une échéance payée depuis le compte personnel dont le paiement ne peut pas s'écrire (une CSG-CRDS qui dépasse
  // l'échéance — une sauvegarde restaurée, que la base n'a pas jugée) : comptée à son échéance, son paiement est à
  // reprendre.
  | 'paiement_personnel_refuse'
  // ... la dotation d'un bien sans nature : son compte d'amortissement n'est pas connu, rien ne peut l'écrire.
  | 'bien_sans_nature'
  // ... la part d'un encaissement d'une facture source, qu'aucune écriture de l'exercice ne porte : à écrire depuis la
  // section « Ventes facturées » de l'onglet Écritures.
  | 'vente_facturee_non_ecrite'
  // ... la part d'un encaissement que son écriture ne porte plus telle que l'encaissement la commande (un montant, un
  // compte) : à réécrire depuis la même section.
  | 'vente_facturee_a_reecrire'
  // Une écriture d'un encaissement, ou d'une facture, que la 2035 ne compte pas dans l'exercice (l'encaissement retiré, la
  // facture que le calcul écarte) : à retirer depuis la même section.
  | 'vente_facturee_a_retirer'
  // Une écriture de résultat d'un mouvement que ses encaissements classent — l'écart des frais, au 627 : la 2035 ne la
  // compte pas encore.
  | 'frais_d_encaissements'
  // Les deux, mais pas le même montant.
  | 'montant_different'
  // Le même montant, sur un autre compte.
  | 'compte_different'
  // Une écriture de l'exercice que la 2035 ne compte pas, avec sa raison.
  | 'piece_non_validee'
  | 'piece_immobilisee'
  | 'piece_sans_date'
  | 'sans_poste'
  | 'sans_montant'
  | 'hors_resultat'
  | 'compte_autre_exercice'
  | 'non_comptee'
  // Une écriture que rien ne justifie plus.
  | 'sans_justificatif'

export interface EcartDeSource {
  cle: string
  // La source de la 2035, quand la 2035 la compte ; sinon ce que l'écriture désigne.
  source: SourceDeclaration | null
  reference: ReferenceEcriture
  libelle: string
  date: string | null
  // L'effet sur le résultat, en euros : une recette positive, une dépense négative.
  declaration: number
  ecritures: number
  comptesDeclaration: (string | null)[]
  comptesEcritures: string[]
  // Les exercices d'une écriture qui manque à celui-ci, quand elle existe ailleurs.
  autresExercices: number[]
  motif: MotifEcart
}

export interface TotauxResultat {
  recettes: number
  depenses: number
  resultat: number
}

export interface Concordance2035 {
  annee: number
  // Antérieur à l'ouverture d'un dossier repris : sa comptabilité est celle de l'ancien logiciel, que la
  // balance reprise résume. Rien n'est comparé.
  anterieurALOuverture: boolean
  declaration: TotauxResultat
  ecritures: TotauxResultat
  // La CSG déductible de la case BV, sans écriture par construction (voir plus haut).
  csgDeductible: number
  ecarts: EcartDeSource[]
  // Vrai quand aucune source ne diffère : les deux résultats ne s'écartent alors que de la CSG déductible.
  concorde: boolean
}

const RESULTAT = /^[67]/

function cleDeSource(s: SourceDeclaration): string {
  switch (s.type) {
    case 'piece': return `piece:${s.id}`
    case 'mouvement': return `mouvement:${s.id}`
    case 'bien': return `bien:${s.id}`
    case 'vehicule': return `vehicule:${s.id}`
    // L'écriture d'une échéance désigne le MOUVEMENT qui la paie, pas l'échéance.
    case 'cotisation': return s.ligne ? `mouvement:${s.ligne.id}` : `cotisation:${s.id}`
    case 'csg': return 'csg'
    // L'arrondi d'une liquidation de TVA : son écriture désigne la déclaration.
    case 'declaration': return `declaration:${s.id}`
    // Un encaissement d'une facture source : ses parts, une par taux, se retrouvent ensemble.
    case 'encaissement': return `encaissement:${s.id}`
  }
}

function referenceDeLEcriture(e: EcritureBrouillon): ReferenceEcriture {
  if (e.piece_id) return { type: 'piece', id: e.piece_id }
  // Une écriture d'une vente facturée désigne sa source (lib/ecrituresVentesFacturees.ts, `colonnesDeLaSource`) : son
  // encaissement — avant le mouvement qu'elle porte aussi quand l'encaissement est du jour du crédit —, ou sa facture.
  if (e.encaissement_id) return { type: 'encaissement', id: e.encaissement_id }
  if (e.facture_id) return { type: 'facture', id: e.facture_id }
  if (e.immobilisation_id) return { type: 'bien', id: e.immobilisation_id }
  if (e.vehicule_id) return { type: 'vehicule', id: e.vehicule_id }
  if (e.declaration_tva_id) return { type: 'declaration', id: e.declaration_tva_id }
  // Le paiement d'une échéance depuis le compte personnel : son écriture désigne l'échéance, comme la source.
  if (e.cotisation_id) return { type: 'cotisation', id: e.cotisation_id }
  if (e.ligne_bancaire_id) return { type: 'mouvement', id: e.ligne_bancaire_id }
  return { type: 'ecriture', id: e.id }
}

const cleDeReference = (r: ReferenceEcriture) => `${r.type}:${r.id}`

function referenceDeSource(s: SourceDeclaration): ReferenceEcriture {
  if (s.type === 'cotisation') return s.ligne ? { type: 'mouvement', id: s.ligne.id } : { type: 'cotisation', id: s.id }
  if (s.type === 'csg') return { type: 'ecriture', id: 'csg' }
  return { type: s.type, id: s.id }
}

// Le nom d'une source tel que la carte le dit, et la date qu'on lit sous lui — celle du document ou du
// mouvement. Une échéance de cotisation porte ses deux dates dans son nom : l'échéance, et le prélèvement
// qui la paie quand il y en a un ; une date seule, sous elle, ne dirait pas laquelle des deux.
function libelleDeSource(s: SourceDeclaration): { libelle: string; date: string | null } {
  switch (s.type) {
    case 'piece': return { libelle: s.piece.tiers ?? s.piece.nom_fichier, date: s.piece.date_piece }
    case 'mouvement': return { libelle: libelleExploitable(s.ligne) || s.ligne.libelle, date: s.ligne.date }
    case 'bien': return { libelle: `Dotation : ${s.immobilisation.libelle}`, date: null }
    case 'vehicule': return { libelle: `Forfait kilométrique : ${nomDuVehicule(s.vehicule)}`, date: null }
    case 'cotisation': return {
      libelle: `Échéance de cotisation du ${formatDate(s.cotisation.echeance)}${s.ligne ? `, prélevée le ${formatDate(s.ligne.date)}`
        : s.paiementPersonnel ? `, réglée sur le compte personnel le ${formatDate(s.paiementPersonnel)}` : ''}`,
      date: null,
    }
    case 'csg': return { libelle: 'CSG déductible', date: null }
    case 'declaration': return {
      libelle: `Arrondi de la CA3 ${libellePeriode(s.declaration.periode_debut, s.declaration.periode_fin)}`,
      date: s.declaration.periode_fin,
    }
    // La facture par son numéro et son client ; une contre-passation se dit telle, l'opposé de l'encaissement qu'elle annule.
    case 'encaissement': return {
      libelle: `${s.part.annuleId ? 'Contre-passation d’un encaissement' : 'Encaissement'} de la facture ${s.part.numero ?? 'sans numéro'} — ${s.part.tiers}`,
      date: s.part.date,
    }
  }
}

const enCentimes = (montant: number) => Math.round(montant * 100)
const effetDeContribution = (c: ContributionDeclaration) => (c.nature === 'recette' ? c.centimes : -c.centimes)
// Au crédit d'un compte de résultat, l'écriture l'augmente ; au débit, elle le diminue.
const effetDeLEcriture = (e: EcritureBrouillon) => (e.sens === 'credit' ? enCentimes(e.montant) : -enCentimes(e.montant))

interface Groupe {
  source: SourceDeclaration | null
  reference: ReferenceEcriture
  declaration: Map<string | null, number>
  ecritures: Map<string, number>
  premiereEcriture: EcritureBrouillon | null
}

// Ce qui explique qu'une écriture de l'exercice ne soit pas comptée par la 2035 : les pièces validées, les factures des
// biens du registre, que la 2035 compte par leur dotation, et les mouvements que leurs encaissements classent
// (`mouvementsClassesParEncaissements`, lib/ecrituresVentesFactureesEcran.ts), dont la 2035 ne compte pas les frais.
export interface ContexteDeLaConcordance {
  piecesValidees: ReadonlySet<string>
  piecesImmobilisees: ReadonlySet<string>
  mouvementsDesVentesFacturees: ReadonlySet<string>
}

// La concordance d'un exercice. `ecritures` : TOUT le brouillon du dossier — une écriture datée d'un autre
// exercice dit pourquoi elle manque à celui-ci. `contexte` : ce qui explique qu'une écriture de l'exercice ne soit pas
// comptée par la 2035 (`ContexteDeLaConcordance`), sans valeur par défaut. `ouverture` : la date des à-nouveaux d'un
// dossier repris, ou null.
export function concordance2035(
  declaration: Declaration2035,
  ecritures: readonly EcritureBrouillon[],
  contexte: ContexteDeLaConcordance,
  ouverture: string | null,
): Concordance2035 {
  const annee = declaration.annee
  const centimesCsg = declaration.contributions
    .filter((c) => c.source.type === 'csg')
    .reduce((s, c) => s + c.centimes, 0)
  const totauxDeclaration: TotauxResultat = {
    recettes: declaration.totalRecettes, depenses: declaration.totalDepenses, resultat: declaration.resultat,
  }

  if (ouverture && `${annee}-12-31` < ouverture) {
    return {
      annee, anterieurALOuverture: true, declaration: totauxDeclaration,
      ecritures: { recettes: 0, depenses: 0, resultat: 0 }, csgDeductible: centimesCsg / 100, ecarts: [], concorde: true,
    }
  }

  const groupes = new Map<string, Groupe>()
  const groupe = (cle: string, reference: ReferenceEcriture, source: SourceDeclaration | null): Groupe => {
    let g = groupes.get(cle)
    if (!g) {
      g = { source, reference, declaration: new Map(), ecritures: new Map(), premiereEcriture: null }
      groupes.set(cle, g)
    }
    if (source && !g.source) g.source = source
    return g
  }

  for (const c of declaration.contributions) {
    if (c.source.type === 'csg') continue
    const g = groupe(cleDeSource(c.source), referenceDeSource(c.source), c.source)
    g.declaration.set(c.compte, (g.declaration.get(c.compte) ?? 0) + effetDeContribution(c))
  }

  // Les écritures de résultat, de cet exercice et des autres : celles des autres disent pourquoi une source
  // manque ici.
  let recettesEcrites = 0
  let depensesEcrites = 0
  const exercicesParCle = new Map<string, Set<number>>()
  for (const e of ecritures) {
    if (!RESULTAT.test(e.compte)) continue
    const reference = referenceDeLEcriture(e)
    const cle = cleDeReference(reference)
    const exercice = anneeDe(e.date)
    if (exercice !== annee) {
      // LES ÉCRITURES D'UN BIEN DANS LES AUTRES EXERCICES SONT SES AUTRES DOTATIONS, pas celle-ci écrite ailleurs :
      // une dotation tombe au 31 décembre de son exercice, la base l'impose. Les compter ici faisait dire de la
      // dotation de l'exercice qu'elle était « datée » de l'exercice d'avant, « à régénérer » — dès la deuxième année
      // d'un bien, tant que sa dotation n'est pas écrite —, au lieu de l'envoyer l'écrire.
      if (reference.type !== 'bien') exercicesParCle.set(cle, (exercicesParCle.get(cle) ?? new Set()).add(exercice))
      continue
    }
    const effet = effetDeLEcriture(e)
    if (e.compte.startsWith('7')) recettesEcrites += effet
    else depensesEcrites -= effet
    const g = groupe(cle, reference, null)
    g.ecritures.set(e.compte, (g.ecritures.get(e.compte) ?? 0) + effet)
    g.premiereEcriture ??= e
  }

  const exclusions = declaration.exclusions
  const piecesSansDate = new Set(exclusions.sansDate.map((p) => p.id))
  const piecesSansPoste = new Set(exclusions.sansPoste.map((p) => p.id))
  const piecesSansMontant = new Set(exclusions.sansMontant.map((p) => p.id))
  const mouvementsSansPoste = new Set(exclusions.mouvementsSansPoste.map((p) => p.ligne.id))
  const mouvementsHorsResultat = new Set(exclusions.mouvementsHorsResultat.map((p) => p.ligne.id))

  const ecarts: EcartDeSource[] = []
  for (const [cle, g] of groupes) {
    const declare = new Map([...g.declaration].filter(([, v]) => v !== 0))
    const ecrit = new Map([...g.ecritures].filter(([, v]) => v !== 0))
    const comptes = new Set<string | null>([...declare.keys(), ...ecrit.keys()])
    const concorde = [...comptes].every((compte) => (declare.get(compte) ?? 0) === (compte === null ? 0 : ecrit.get(compte) ?? 0))
    if (concorde) continue

    const totalDeclare = [...declare.values()].reduce((s, v) => s + v, 0)
    const totalEcrit = [...ecrit.values()].reduce((s, v) => s + v, 0)
    const autresExercices = [...(exercicesParCle.get(cle) ?? [])].sort((a, b) => a - b)
    const motif = motifDeLEcart({
      g, cle, declare, ecrit, totalDeclare, totalEcrit, autresExercices,
      contexte, piecesSansDate, piecesSansPoste, piecesSansMontant, mouvementsSansPoste, mouvementsHorsResultat,
    })
    const identite = g.source ? libelleDeSource(g.source)
      : { libelle: g.premiereEcriture?.libelle ?? '', date: g.premiereEcriture?.date ?? null }
    ecarts.push({
      cle, source: g.source, reference: g.reference, ...identite,
      declaration: totalDeclare / 100, ecritures: totalEcrit / 100,
      comptesDeclaration: [...declare.keys()], comptesEcritures: [...ecrit.keys()],
      autresExercices, motif,
    })
  }

  // Les plus gros écarts d'abord : c'est par eux qu'on commence.
  ecarts.sort((a, b) => Math.abs(b.declaration - b.ecritures) - Math.abs(a.declaration - a.ecritures) || a.cle.localeCompare(b.cle))

  return {
    annee,
    anterieurALOuverture: false,
    declaration: totauxDeclaration,
    ecritures: { recettes: recettesEcrites / 100, depenses: depensesEcrites / 100, resultat: (recettesEcrites - depensesEcrites) / 100 },
    csgDeductible: centimesCsg / 100,
    ecarts,
    concorde: ecarts.length === 0,
  }
}

function motifDeLEcart(x: {
  g: Groupe
  cle: string
  declare: ReadonlyMap<string | null, number>
  ecrit: ReadonlyMap<string, number>
  totalDeclare: number
  totalEcrit: number
  autresExercices: number[]
  contexte: ContexteDeLaConcordance
  piecesSansDate: ReadonlySet<string>
  piecesSansPoste: ReadonlySet<string>
  piecesSansMontant: ReadonlySet<string>
  mouvementsSansPoste: ReadonlySet<string>
  mouvementsHorsResultat: ReadonlySet<string>
}): MotifEcart {
  const { g, declare, ecrit } = x
  // UNE VENTE FACTURÉE, avant tout autre motif : ses gestes sont ceux de la section « Ventes facturées », jamais
  // « régénérer » une pièce ni régler une catégorie. La 2035 compte la part et rien ne la porte dans l'exercice : à
  // écrire ; elle ne la compte pas et une écriture la porte : à retirer ; les deux, autrement : à réécrire.
  if (g.source?.type === 'encaissement' || g.reference.type === 'encaissement' || g.reference.type === 'facture') {
    if (declare.size === 0) return 'vente_facturee_a_retirer'
    return ecrit.size === 0 ? 'vente_facturee_non_ecrite' : 'vente_facturee_a_reecrire'
  }
  // Une écriture de résultat d'un mouvement que ses encaissements classent, que la 2035 ne compte pas : ses frais.
  if (declare.size === 0 && g.reference.type === 'mouvement' && x.contexte.mouvementsDesVentesFacturees.has(g.reference.id)) {
    return 'frais_d_encaissements'
  }
  // Une catégorie sans compte : rien ne peut l'écrire — ni maintenant, ni réécrire une écriture restée sur
  // l'ancien compte.
  if (declare.has(null)) return 'sans_compte'
  if (declare.size > 0 && ecrit.size === 0) {
    // Une échéance que rien ne date : sans paiement, ou avec un paiement qui ne s'écrit pas. Payée depuis le compte
    // personnel et sans écriture, elle n'est pas « sans paiement » : son écriture manque (`sans_ecriture`).
    if (g.source?.type === 'cotisation' && !g.source.ligne && !g.source.paiementPersonnel) {
      if (!g.source.refus) return 'echeance_sans_paiement'
      return g.source.cotisation.paiement_personnel_le ? 'paiement_personnel_refuse' : 'rapprochement_refuse'
    }
    if (g.source?.type === 'bien' && !g.source.immobilisation.nature_id) return 'bien_sans_nature'
    return x.autresExercices.length > 0 ? 'ecriture_autre_exercice' : 'sans_ecriture'
  }
  if (declare.size === 0) {
    const { type, id } = g.reference
    if (type === 'ecriture') return 'sans_justificatif'
    if (type === 'piece') {
      if (!x.contexte.piecesValidees.has(id)) return 'piece_non_validee'
      if (x.contexte.piecesImmobilisees.has(id)) return 'piece_immobilisee'
      if (x.piecesSansPoste.has(id)) return 'sans_poste'
      if (x.piecesSansMontant.has(id)) return 'sans_montant'
      if (x.piecesSansDate.has(id)) return 'piece_sans_date'
      return 'compte_autre_exercice'
    }
    if (type === 'mouvement') {
      if (x.mouvementsHorsResultat.has(id)) return 'hors_resultat'
      if (x.mouvementsSansPoste.has(id)) return 'sans_poste'
    }
    return 'non_comptee'
  }
  // Une pièce dont une part n'a pas de date : l'écriture la porte au dépôt, la 2035 nulle part — régénérer
  // n'y changerait rien.
  if (g.reference.type === 'piece' && x.piecesSansDate.has(g.reference.id)) return 'piece_sans_date'
  return x.totalDeclare === x.totalEcrit ? 'compte_different' : 'montant_different'
}

// Le nom court d'un motif, pour le décompte que l'écran fait avant la liste.
export const LIBELLES_MOTIFS: Readonly<Record<MotifEcart, string>> = {
  sans_ecriture: 'sans écriture',
  ecriture_autre_exercice: 'écrite dans un autre exercice',
  sans_compte: 'catégorie sans compte',
  echeance_sans_paiement: 'échéance sans prélèvement rapproché',
  rapprochement_refuse: 'rapprochement qui ne s’écrit pas',
  paiement_personnel_refuse: 'paiement personnel qui ne s’écrit pas',
  bien_sans_nature: 'bien sans nature',
  vente_facturee_non_ecrite: 'vente facturée à écrire',
  vente_facturee_a_reecrire: 'vente facturée à réécrire',
  vente_facturee_a_retirer: 'écriture d’une vente facturée à retirer',
  frais_d_encaissements: 'frais d’un mouvement d’encaissements',
  montant_different: 'montant différent',
  compte_different: 'compte différent',
  piece_non_validee: 'pièce non validée',
  piece_immobilisee: 'facture d’un bien du registre',
  piece_sans_date: 'pièce sans date',
  sans_poste: 'catégorie sans poste',
  sans_montant: 'pièce sans montant',
  hors_resultat: 'compte hors résultat',
  compte_autre_exercice: 'comptée dans un autre exercice',
  non_comptee: 'que la 2035 ne compte pas',
  sans_justificatif: 'écriture sans justificatif',
}

// La phrase d'un écart, telle que l'écran la dit : ce qui diffère, et ce qui le corrige.
export function phraseDeLEcart(e: EcartDeSource): string {
  const comptes = (cs: readonly (string | null)[]) => cs.map((c) => c ?? 'aucun compte').join(', ')
  switch (e.motif) {
    case 'sans_ecriture':
      return `La 2035 la compte (${formatMoney(Math.abs(e.declaration))}), aucune écriture ne la porte : à écrire.`
    case 'ecriture_autre_exercice':
      return `Son écriture est datée de ${e.autresExercices.join(', ')}, la 2035 la compte cet exercice : à régénérer.`
    case 'sans_compte':
      return e.comptesEcritures.length > 0
        ? `Sa catégorie n’a plus de compte comptable : son écriture est restée au ${comptes(e.comptesEcritures)}, et rien ne peut la réécrire tant qu’elle n’en a pas.`
        : 'Sa catégorie n’a pas de compte comptable : la 2035 la compte, rien ne peut l’écrire.'
    case 'echeance_sans_paiement':
      return 'Comptée à son échéance faute de prélèvement rapproché : aucune écriture ne la porte tant que son paiement n’est pas rapproché.'
    case 'bien_sans_nature':
      return 'Sans nature, son compte d’amortissement n’est pas connu : rien ne peut écrire sa dotation. Choisir sa nature, puis l’écrire.'
    case 'rapprochement_refuse':
      return `Son rapprochement ne s’écrit pas, elle reste comptée à son échéance. ${e.source?.type === 'cotisation' ? e.source.refus : ''}`.trim()
    case 'paiement_personnel_refuse':
      return `Son paiement depuis le compte personnel ne s’écrit pas, elle reste comptée à son échéance. ${e.source?.type === 'cotisation' ? e.source.refus : ''}`.trim()
    case 'vente_facturee_non_ecrite':
      return `La 2035 compte cet encaissement d’une facture (${formatMoney(Math.abs(e.declaration))}), aucune écriture de l’exercice ne le porte : à écrire depuis la section « Ventes facturées », qui dit aussi ce qui l’en empêcherait (un compte à choisir, un mouvement à classer).`
    case 'vente_facturee_a_reecrire':
      return `Son écriture porte ${formatMoney(Math.abs(e.ecritures))} au ${e.comptesEcritures.join(', ')}, la 2035 ${formatMoney(Math.abs(e.declaration))} au ${comptes(e.comptesDeclaration)} : elle n’est plus celle que l’encaissement commande, à réécrire depuis la section « Ventes facturées ».`
    case 'vente_facturee_a_retirer':
      return 'Écriture d’une vente facturée que la 2035 ne compte pas dans cet exercice (un encaissement retiré, une facture que le calcul écarte) : à retirer depuis la section « Ventes facturées ».'
    case 'frais_d_encaissements':
      return `Les frais que la banque a retenus sur ce mouvement, que ses encaissements de factures classent (${formatMoney(Math.abs(e.ecritures))} au ${e.comptesEcritures.join(', ')}) : l’écriture les porte, la 2035 ne les compte pas encore — une dépense qui lui manque, que l’application ne sait pas encore lui donner.`
    case 'montant_different':
      return `L’écriture porte ${formatMoney(Math.abs(e.ecritures))}, la 2035 ${formatMoney(Math.abs(e.declaration))} : à régénérer ou à réécrire.`
    case 'compte_different':
      return `L’écriture est au ${e.comptesEcritures.join(', ')}, la 2035 l’attend au ${e.comptesDeclaration.join(', ')} : à régénérer ou à réécrire.`
    case 'piece_non_validee':
      return 'Écriture d’une pièce qui n’est pas validée : la 2035 ne la compte pas.'
    case 'piece_immobilisee':
      return 'Écriture en charge de la facture d’un bien du registre : la 2035 compte le bien par sa dotation. À retirer ou à régénérer sur le compte du bien.'
    case 'piece_sans_date':
      return 'Pièce sans date : son écriture est datée du dépôt, la 2035 ne la compte dans aucun exercice.'
    case 'sans_poste':
      return 'Sa catégorie n’a pas de poste 2035 : l’écriture existe, la 2035 ne la compte pas.'
    case 'sans_montant':
      return 'Pièce sans montant lisible : la 2035 ne la compte pas, son écriture si.'
    case 'hors_resultat':
      return 'Le compte de sa catégorie n’est plus un compte de résultat : à réaffecter.'
    case 'compte_autre_exercice':
      return 'La 2035 la compte dans un autre exercice, au paiement : son écriture est à régénérer.'
    case 'non_comptee':
      return 'La 2035 ne la compte pas dans cet exercice : son écriture ne suit plus sa source.'
    case 'sans_justificatif':
      return 'Écriture sans pièce, sans mouvement, sans bien ni véhicule : la 2035 ne peut pas la compter.'
  }
}

// OÙ AGIR, par l'onglet qui porte le geste : générer ou régénérer une pièce (Écritures), écrire une dotation
// (Immobilisations), un forfait (la carte Véhicules d'Informations du dossier) ou une échéance (Cotisations),
// rapprocher un prélèvement ou réaffecter un mouvement (Banque), compléter un poste (Clôture), retrouver la
// liquidation d'une déclaration (TVA). Un mouvement affecté ou ventilé se réaffecte ou se réécrit dans Écritures.
// Un paiement depuis le compte personnel qui ne s'écrit pas se reprend dans Cotisations.
export function ouAgir(e: EcartDeSource): string {
  if (e.motif === 'sans_poste') return 'Clôture — Postes manquants'
  if (e.motif === 'sans_compte') return 'Écritures — Comptes manquants'
  // Les écritures d'une vente facturée se passent, se réécrivent et se retirent dans leur section de l'onglet Écritures.
  if (e.motif === 'vente_facturee_non_ecrite' || e.motif === 'vente_facturee_a_reecrire' || e.motif === 'vente_facturee_a_retirer') {
    return 'Écritures — Ventes facturées'
  }
  // Aucun onglet ne porte le geste : le dire, plutôt qu'envoyer changer une écriture qui est juste.
  if (e.motif === 'frais_d_encaissements') return 'Pas encore dans l’application'
  switch (e.source?.type ?? e.reference.type) {
    case 'piece':
      return e.motif === 'piece_non_validee' ? 'Justificatifs' : 'Écritures'
    case 'bien':
      return 'Immobilisations'
    case 'vehicule':
      return 'Informations du dossier — Véhicules'
    case 'cotisation':
      return e.motif === 'echeance_sans_paiement' || e.motif === 'rapprochement_refuse' ? 'Banque' : 'Cotisations'
    case 'mouvement':
      return e.motif === 'hors_resultat' ? 'Banque' : 'Écritures'
    case 'declaration':
      return 'TVA'
    default:
      return 'Écritures'
  }
}

// UN COMPTE, DEUX CASES : le FEC ne peut pas justifier leur partage. Un vérificateur rattache un COMPTE à une
// case de la 2035 ; quand deux postes de cases différentes passent par le même compte — deux catégories qui le
// partagent, ou une catégorie sur le compte d'une cotisation (646000) rattachée à un autre poste que la ligne
// 25 —, la somme du compte se retrouve dans la 2035, pas sa répartition entre les deux cases. Tiré des
// contributions de l'exercice : seuls les comptes qui servent. Un poste sans case est dit ailleurs.
export interface ComptePartage {
  compte: string
  cases: { code: string; postes: string[] }[]
}

export function comptesPartagesEntreCases(declaration: Declaration2035): ComptePartage[] {
  const parCompte = new Map<string, Map<string, Set<string>>>()
  for (const c of declaration.contributions) {
    if (!c.compte) continue
    const code = caseDuPoste(c.poste)?.code
    if (!code) continue
    const cases = parCompte.get(c.compte) ?? new Map<string, Set<string>>()
    cases.set(code, (cases.get(code) ?? new Set()).add(c.poste))
    parCompte.set(c.compte, cases)
  }
  return [...parCompte.entries()]
    .filter(([, cases]) => cases.size > 1)
    .map(([compte, cases]) => ({
      compte,
      cases: [...cases.entries()].map(([code, postes]) => ({ code, postes: [...postes].sort() })).sort((a, b) => a.code.localeCompare(b.code)),
    }))
    .sort((a, b) => a.compte.localeCompare(b.compte))
}

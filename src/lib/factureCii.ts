import { calculerLigne } from './montantsFacture'
import { formatDate } from './format'
import { motifExoneration, refusTauxPositif } from './statutTva'
import type { ArticleExoneration, FactureEmise, NatureOperation, StatutTva } from './types'

// LA FACTURE ÉLECTRONIQUE ÉMISE (ligne 28.5 de la feuille de route, étape c) : une facture validée de l'application,
// écrite dans la syntaxe CII de la norme EN 16931, pour qu'une plateforme agréée la transmette à son destinataire — une
// entreprise, ou un organisme public par Chorus Pro. Le module est pur : il ne lit rien en base et n'appelle personne ;
// la fonction de dépôt (étape c3) lui donne la facture, ses lignes et l'identité du dossier.
//
// SES SOURCES SONT PUBLIQUES, ET C'EST UNE RÈGLE DU PROJET : la norme AFNOR XP Z12-012 interdit qu'on l'exploite par une
// IA, donc rien ici n'en vient. L'ordre des éléments est celui du schéma CII D16B que publient les artefacts de
// validation de la norme EN 16931 (Commission européenne, CEN/TC 434) ; les règles BR- sont celles de leur Schematron ;
// les règles G1. et G2. sont celles des spécifications externes de la DGFiP (annexe 7, v1.9) ; le code service et le
// numéro d'engagement d'un organisme public suivent l'annexe EDI de Chorus Pro (AIFE). Chaque fichier que ce module
// produit pour ses tests est passé au validateur officiel de la norme (outils/facturation/valider.mjs) avant d'y être
// figé.
//
// UN AVOIR DE LA NORME PORTE DES MONTANTS POSITIFS : son type (381) dit que c'est un avoir. L'application le stocke
// négatif, quantités comprises (voir FactureEmise.type) : le document se lit donc dans le sens de son type, et chaque
// ligne se recalcule sur la quantité de ce sens. C'est exactement le calcul qui a fait l'en-tête de l'avoir (`creerAvoir`
// totalise les lignes créditées, positives, puis rend l'en-tête négatif) : les montants transmis sont ceux qu'on a
// validés, au centime, et le module le vérifie plutôt que de le supposer.
//
// RIEN N'EST DEVINÉ. Ce qui manque à la facture pour être transmise est dit, tout ensemble et avant le clic
// (`refusEmission`) ; le module ne comble rien — ni un SIREN absent, ni une catégorie de TVA, ni une adresse.

// ── DÉBUT COPIE factureCii ───────────────────────────────────────────────────────────────────────────────────────────
// Ce bloc est recopié AU CARACTÈRE PRÈS dans les Edge Functions qui transmettent une facture (superpdp-emit,
// plateforme-agreee), après ceux de montantsFacture.ts et de statutTva.ts : elles sont auto-portées, et ce qu'elles
// transmettent doit être le fichier que les tests de ce module ont passé au validateur officiel. Il ne nomme rien
// d'autre hors de lui que trois types, que chaque fonction déclare comme types.ts les déclare (StatutTva,
// ArticleExoneration, NatureOperation). `copiesFacturation.test.ts` compare chaque copie à celui-ci et l'exécute.

export const PROFIL_EN16931 = 'urn:cen.eu:en16931:2017'

// L'unité « pièce » de la recommandation 20 de la CEE-ONU : l'application ne distingue pas encore les unités par ligne
// (une heure, un kilogramme), et la règle BR-23 en exige une sur chaque ligne.
export const UNITE_GENERIQUE = 'C62'

// Les taux que la DGFiP admet (règle G1.24), en pour cent.
export const TAUX_ADMIS: readonly number[] = [0, 0.9, 1.05, 1.75, 2.1, 5.5, 7, 8.5, 9.2, 9.6, 10, 13, 19.6, 20, 20.6]

// L'adresse électronique d'une partie dans l'annuaire de la facturation électronique : le schéma « FRCTC electronic
// address » (0225 de la liste ISO 6523, que l'annexe 7 de la DGFiP ajoute), dont la valeur est le SIREN, puis au besoin
// le SIRET, un code de routage ou un suffixe, séparés par « _ » (règles G1.93, G1.95 et G1.115).
export const SCHEMA_ADRESSE_ELECTRONIQUE = '0225'
const SCHEMA_SIREN = '0002'
const SCHEMA_SIRET = '0009'

const NS = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  qdt: 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
} as const

export interface VendeurCii {
  // L'identité de l'émetteur, telle que la facture l'a figée à sa validation (emetteur_nom, emetteur_siret,
  // emetteur_adresse) — jamais celle d'aujourd'hui.
  nom: string | null
  siret: string | null
  adresse: string | null
  // Le numéro de TVA intracommunautaire du dossier (BT-31). Celui d'un dossier redevable se calcule sur son SIREN
  // (`numeroTvaFrancais`) ; un dossier en franchise ou exonéré n'en a pas toujours un : il se calcule de même quand le
  // cabinet a dit qu'il en a un (`numero_tva_attribue`), et le module ne l'invente jamais.
  numeroTva: string | null
  // Le cabinet a dit que ce dossier en franchise ou exonéré a un numéro de TVA (la case de l'onglet TVA) : s'il manque
  // encore, c'est qu'il ne se calcule pas, et ce n'est plus la case qui se réclame.
  numeroTvaAttribue: boolean
  statutTva: StatutTva | null
  articleExoneration: ArticleExoneration | null
}

export interface OrigineCii {
  numero: string | null
  date_emission: string
}

// Une ligne de la facture (`facture_lignes`), telle que le générateur la lit.
export interface LigneCii {
  ordre: number
  designation: string
  quantite: number
  prix_unitaire_ht: number
  taux_tva: number
}

// La facture (`factures_emises`), telle que le générateur la lit : les colonnes dont il se sert, sous leurs types en
// base. FactureEmise (types.ts) en porte d'autres, et le compilateur vérifie qu'elle se lit comme celle-ci
// (copiesFacturation.test.ts) : une valeur ajoutée à l'une de ses listes fermées ne passerait pas ici en silence.
export interface FactureCii {
  numero: string | null
  statut: 'brouillon' | 'validee'
  type: 'facture' | 'avoir'
  date_emission: string
  date_echeance: string | null
  tiers_nom: string
  tiers_adresse: string | null
  tiers_siret: string | null
  montant_ht: number
  montant_tva: number
  montant_ttc: number
  mentions_legales: string | null
  type_client: 'assujetti' | 'organisme_public' | 'non_assujetti' | 'etranger' | null
  tiers_siren: string | null
  tiers_adresse_electronique: string | null
  code_service: string | null
  numero_engagement: string | null
  nature_operation: NatureOperation | null
  date_prestation: string | null
  periode_debut: string | null
  periode_fin: string | null
  livraison_adresse: string | null
  livraison_code_postal: string | null
  livraison_ville: string | null
  livraison_pays: string | null
  option_debits: boolean | null
}

export interface DonneesCii {
  facture: FactureCii
  lignes: LigneCii[]
  vendeur: VendeurCii
  // La facture qu'un avoir corrige (règles BR-55 et G1.31 : son numéro, et sa date).
  origine: OrigineCii | null
  // AAAA-MM-JJ : une facture ne se date pas dans l'avenir (règle G1.07).
  aujourdHui: string
}

// ── Identifiants ───────────────────────────────────────────────────────────────────────────────────────────────────

// La clé de Luhn : le dernier chiffre d'un SIREN ou d'un SIRET contrôle les autres (INSEE). Elle attrape la faute de
// frappe que l'annuaire refuserait — après la transmission, et sans dire laquelle.
function luhn(chiffres: string): boolean {
  let somme = 0
  for (let i = 0; i < chiffres.length; i++) {
    let d = Number(chiffres[chiffres.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    somme += d
  }
  return somme % 10 === 0
}

export function sirenValide(siren: string | null | undefined): siren is string {
  return siren != null && /^\d{9}$/.test(siren) && luhn(siren)
}

// Les établissements de La Poste (SIREN 356000000), trop nombreux pour la clé de Luhn, ont un SIRET dont la somme des
// chiffres est un multiple de 5 (INSEE) ; son siège (35600000000048) garde la clé de Luhn.
const SIEGE_DE_LA_POSTE = '35600000000048'

export function siretValide(siret: string | null | undefined): siret is string {
  if (siret == null || !/^\d{14}$/.test(siret)) return false
  if (siret.startsWith('356000000') && siret !== SIEGE_DE_LA_POSTE) {
    return [...siret].reduce((s, c) => s + Number(c), 0) % 5 === 0
  }
  return luhn(siret)
}

export function sirenDe(siret: string | null | undefined): string | null {
  const chiffres = (siret ?? '').replace(/\s/g, '')
  return /^\d{9}(\d{5})?$/.test(chiffres) ? chiffres.slice(0, 9) : null
}

// Le numéro de TVA intracommunautaire français d'une entreprise : FR, une clé de deux chiffres, le SIREN (CGI, art. 286
// ter ; clé = (12 + 3 × (SIREN modulo 97)) modulo 97).
export function numeroTvaFrancais(siren: string): string {
  const cle = (12 + 3 * (Number(siren) % 97)) % 97
  return `FR${String(cle).padStart(2, '0')}${siren}`
}

// ── Adresse ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AdresseStructuree {
  lignes: string[]
  codePostal: string | null
  ville: string | null
}

// Une adresse saisie en texte libre, rangée dans les champs de la norme (BT-35 à BT-38) : la ligne qui commence par un
// code postal français de cinq chiffres donne le code postal et la ville, les autres sont les lignes de l'adresse.
// Une adresse sur une seule ligne qui finit par « , 75001 Paris » se lit de même. Rien d'autre n'est interprété : sans
// code postal reconnu, tout reste dans les lignes, telles qu'écrites.
export function adresseStructuree(texte: string | null): AdresseStructuree {
  let lignes = (texte ?? '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l !== '')
  if (lignes.length === 1) {
    const m = /^(.+?),\s*(\d{5}\s+\S.*)$/.exec(lignes[0])
    if (m) lignes = [m[1].trim(), m[2].trim()]
  }
  for (let i = lignes.length - 1; i >= 0; i--) {
    const m = /^(\d{5})\s+(\S.*)$/.exec(lignes[i])
    if (m) return { lignes: lignes.filter((_, j) => j !== i), codePostal: m[1], ville: m[2] }
  }
  return { lignes, codePostal: null, ville: null }
}

// ── Lignes et montants ─────────────────────────────────────────────────────────────────────────────────────────────

export type CategorieTva = 'S' | 'E'

export interface LigneDocument {
  numero: number
  libelle: string
  // Dans le sens du document : positives sur une facture comme sur un avoir, sauf une remise, négative.
  quantite: number
  prix: number
  taux: number
  categorie: CategorieTva
  htCentimes: number
  tvaCentimes: number
}

export interface GroupeTva {
  categorie: CategorieTva
  taux: number
  baseCentimes: number
  tvaCentimes: number
  codeMotif: string | null
  motif: string | null
}

export interface MontantsDocument {
  lignes: LigneDocument[]
  groupes: GroupeTva[]
  htCentimes: number
  tvaCentimes: number
  ttcCentimes: number
}

const centimes = (euros: number) => Math.round(euros * 100)

// La ligne dans le sens du document. Le prix d'une ligne de la norme n'est jamais négatif (règle BR-27, G1.16) : une
// remise saisie avec un prix négatif se transmet avec une quantité négative, au même produit — donc au même montant,
// au bit près, puisque le produit de deux flottants ne dépend pas de leurs signes.
export function montantsDuDocument(facture: Pick<FactureCii, 'type'>, lignes: LigneCii[], motif: { code: string; texte: string } | null): MontantsDocument {
  const sens = facture.type === 'avoir' ? -1 : 1
  const triees = [...lignes].sort((a, b) => a.ordre - b.ordre)
  const doc: LigneDocument[] = triees.map((l, i) => {
    let quantite = l.quantite * sens
    let prix = l.prix_unitaire_ht
    if (prix < 0) {
      quantite = -quantite
      prix = -prix
    }
    const c = calculerLigne(quantite, prix, l.taux_tva)
    return {
      numero: i + 1,
      libelle: l.designation,
      quantite: quantite === 0 ? 0 : quantite,
      prix,
      taux: l.taux_tva,
      categorie: l.taux_tva > 0 ? 'S' : 'E',
      htCentimes: centimes(c.montant_ht),
      tvaCentimes: centimes(c.montant_tva),
    }
  })
  const groupes: GroupeTva[] = []
  for (const l of doc) {
    let g = groupes.find((x) => x.categorie === l.categorie && x.taux === l.taux)
    if (!g) {
      g = {
        categorie: l.categorie,
        taux: l.taux,
        baseCentimes: 0,
        tvaCentimes: 0,
        codeMotif: l.categorie === 'E' ? motif?.code ?? null : null,
        motif: l.categorie === 'E' ? motif?.texte ?? null : null,
      }
      groupes.push(g)
    }
    g.baseCentimes += l.htCentimes
    g.tvaCentimes += l.tvaCentimes
  }
  // Dans un ordre qui ne dépend pas de la saisie : les taux du plus fort au plus faible.
  groupes.sort((a, b) => b.taux - a.taux)
  const htCentimes = doc.reduce((s, l) => s + l.htCentimes, 0)
  const tvaCentimes = doc.reduce((s, l) => s + l.tvaCentimes, 0)
  return { lignes: doc, groupes, htCentimes, tvaCentimes, ttcCentimes: htCentimes + tvaCentimes }
}

// ── Ce qui empêche de transmettre ──────────────────────────────────────────────────────────────────────────────────

// Un nombre décimal écrit sans exposant, avec au plus `decimales` chiffres après le point ; null s'il en porte plus, ou
// s'il ne s'écrit pas exactement — infini, ou au-delà de 2^53 unités de sa dernière décimale, où un nombre à virgule
// flottante ne dit plus ses derniers chiffres : `Number.isSafeInteger` écarte les deux. Les quantités admettent quatre
// décimales (G1.15), les prix six (G1.16).
export function decimal(x: number, decimales: number): string | null {
  const f = 10 ** decimales
  const entier = Math.round(x * f)
  if (!Number.isSafeInteger(entier) || Math.abs(x * f - entier) > 1e-6) return null
  const a = Math.abs(entier)
  const fraction = String(a % f).padStart(decimales, '0').replace(/0+$/, '')
  return `${entier < 0 ? '-' : ''}${Math.floor(a / f)}${fraction ? `.${fraction}` : ''}`
}

// Une date AAAA-MM-JJ écrite JJ/MM/AAAA, comme l'écrit formatDate (format.ts), que le bloc ne peut pas nommer ;
// une valeur d'une autre forme est rendue telle quelle.
function dateLisible(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso
}

const NUMERO_ADMIS = /^[A-Za-z0-9 +_/-]{1,35}$/
const BORNES = '(années 2000 à 2099)'

// Le numéro d'une facture (G1.05) : 35 caractères au plus, chiffres, lettres, espace, « - », « + », « _ » et « / »,
// sans espace en tête, en fin ni doublé.
export function numeroAdmis(numero: string): boolean {
  return NUMERO_ADMIS.test(numero) && numero.trim() === numero && !numero.includes('  ')
}

const ADRESSE_ELECTRONIQUE = /^\d{9}(_[A-Za-z0-9._-]+(_[A-Za-z0-9_-]+)?)?$/

// Une année de 2000 à 2099, dans toute date que la facture transmet (règle G1.36).
function anneeAdmise(date: string): boolean {
  const annee = Number(date.slice(0, 4))
  return annee >= 2000 && annee <= 2099
}

// Les codes d'exonération qui sortent une facture entre entreprises de la facturation électronique (règle G2.32) :
// une facture qui ne porte QUE des opérations exonérées par les articles 261 à 261 E ne se transmet pas — sauf à un
// organisme public, que la règle excepte. La règle en énumère dix-neuf, et ce sont exactement les codes de la liste
// VATEX qui commencent ainsi (artefacts de validation 1.3.16) : le préfixe ne désigne rien d'autre.
function exonerationHorsChamp(code: string | null): boolean {
  return code != null && code.startsWith('VATEX-FR-CGI261')
}

// Tout ce qui empêche de transmettre la facture, dans l'ordre où l'écran le dit ; vide quand elle peut partir.
export function refusEmission(d: DonneesCii): string[] {
  const { facture: f, vendeur: v } = d
  const refus: string[] = []

  if (f.statut !== 'validee' || !f.numero) return ['Seule une facture validée se transmet.']
  if (!numeroAdmis(f.numero)) {
    refus.push(`Le numéro ${f.numero} ne peut pas être transmis : 35 caractères au plus — chiffres, lettres, espace, « - », « + », « _ » et « / ».`)
  }
  if (!anneeAdmise(f.date_emission)) refus.push(`La date d’émission (${dateLisible(f.date_emission)}) n’est pas une date admise ${BORNES}.`)
  else if (f.date_emission > d.aujourdHui) refus.push(`La facture est datée du ${dateLisible(f.date_emission)}, qui n’est pas encore arrivé.`)

  // Le destinataire. Un particulier et un client établi hors de France ne reçoivent pas de facture électronique :
  // l'opération se déclare par l'e-reporting.
  switch (f.type_client) {
    case null:
      refus.push('Dis à qui la facture est adressée : une entreprise assujettie, ou un organisme public.')
      break
    case 'non_assujetti':
      refus.push('Une facture à un particulier ne passe pas par la plateforme : l’opération se déclare par l’e-reporting.')
      break
    case 'etranger':
      refus.push('Une facture à un client établi hors de France ne passe pas par la plateforme : l’opération se déclare par l’e-reporting.')
      break
  }
  const versEntreprise = f.type_client === 'assujetti' || f.type_client === 'organisme_public'

  if (f.nature_operation == null) {
    refus.push('Dis si la facture porte sur des livraisons de biens, des prestations de services, ou les deux.')
  }

  // Le vendeur.
  const sirenVendeur = sirenDe(v.siret)
  if (!v.nom?.trim()) refus.push('Le nom du dossier manque à la facture.')
  if (!sirenValide(sirenVendeur)) refus.push('Le SIRET du dossier, figé sur la facture, ne donne pas un SIREN valide (neuf chiffres et leur clé).')
  if (!v.adresse?.trim()) refus.push('L’adresse du dossier manque à la facture.')

  // Le client.
  if (versEntreprise) {
    if (!f.tiers_nom.trim()) refus.push('Le nom du client manque.')
    if (!sirenValide(f.tiers_siren)) refus.push('Le SIREN du client manque ou ne passe pas sa clé de contrôle.')
    if (!f.tiers_adresse?.trim()) refus.push('L’adresse du client manque.')
    const siret = f.tiers_siret?.replace(/\s/g, '') ?? null
    if (f.type_client === 'organisme_public' && !siret) {
      refus.push('Un organisme public se désigne par son SIRET (Chorus Pro) : indique celui du service destinataire.')
    }
    // Ce qui découle du SIREN ne se juge que sur un SIREN valide : son refus est déjà dit, et le redire sous une autre
    // forme ferait chercher deux fautes là où il n'y en a qu'une.
    if (siret) {
      if (!siretValide(siret)) refus.push('Le SIRET du client ne passe pas sa clé de contrôle.')
      else if (sirenValide(f.tiers_siren) && !siret.startsWith(f.tiers_siren)) refus.push('Le SIRET du client ne commence pas par son SIREN.')
    }
    const adresse = f.tiers_adresse_electronique
    if (adresse != null && !ADRESSE_ELECTRONIQUE.test(adresse)) {
      refus.push('L’adresse de facturation électronique du client n’a pas la forme que l’annuaire publie : SIREN, SIREN_SIRET ou SIREN_suffixe.')
    } else if (adresse != null && sirenValide(f.tiers_siren) && !adresse.startsWith(f.tiers_siren)) {
      refus.push('L’adresse de facturation électronique du client ne commence pas par son SIREN.')
    }
  }

  // La TVA, ligne par ligne.
  const motifConnu = motifExoneration(v.statutTva, v.articleExoneration)
  if (v.statutTva == null && motifConnu.refus) refus.push(motifConnu.refus)
  const triees = [...d.lignes].sort((a, b) => a.ordre - b.ordre)
  if (triees.length === 0) refus.push('La facture n’a aucune ligne.')
  const motifs = new Set<string>()
  triees.forEach((l, i) => {
    const n = i + 1
    if (!l.designation.trim()) refus.push(`Ligne ${n} : sa désignation manque.`)
    if (decimal(l.quantite, 4) == null) refus.push(`Ligne ${n} : la quantité ne s’écrit pas avec quatre décimales au plus.`)
    if (decimal(Math.abs(l.prix_unitaire_ht), 6) == null) refus.push(`Ligne ${n} : le prix ne s’écrit pas avec six décimales au plus.`)
    if (!TAUX_ADMIS.includes(l.taux_tva)) {
      refus.push(`Ligne ${n} : le taux de ${String(l.taux_tva).replace('.', ',')} % n’est pas un taux de TVA admis.`)
    } else if (l.taux_tva > 0) {
      const r = refusTauxPositif(v.statutTva, l.taux_tva)
      if (r) refus.push(`Ligne ${n} : ${r}`)
    } else if (v.statutTva != null && motifConnu.refus) {
      motifs.add(motifConnu.refus)
    }
  })
  for (const m of motifs) refus.push(m)

  const motif = motifConnu.motif ? { code: motifConnu.motif.code, texte: motifConnu.motif.texte } : null
  const m = montantsDuDocument(f, triees, motif)
  const sens = f.type === 'avoir' ? -1 : 1
  if (triees.length > 0) {
    if (m.ttcCentimes <= 0) {
      refus.push(f.type === 'avoir'
        ? 'Un avoir crédite un montant : son total doit être positif.'
        : 'Le total de la facture n’est pas positif : un montant à rendre au client se fait par un avoir.')
    }
    if (centimes(sens * f.montant_ht) !== m.htCentimes || centimes(sens * f.montant_tva) !== m.tvaCentimes
      || centimes(sens * f.montant_ttc) !== m.ttcCentimes) {
      refus.push('Les montants enregistrés de la facture ne se retrouvent pas dans ses lignes : elle ne peut pas être transmise telle quelle.')
    }
  }

  // Entre entreprises, une facture qui ne porte que des opérations exonérées par l'article 261 sort du champ (G2.32) :
  // c'est alors tout ce qu'il y a à dire, et réclamer le numéro de TVA du dossier laisserait croire qu'il suffirait.
  const horsChamp = f.type_client === 'assujetti' && m.groupes.length > 0
    && m.groupes.every((g) => g.categorie === 'E' && exonerationHorsChamp(g.codeMotif))
  if (horsChamp) {
    refus.push('Une facture dont toutes les opérations sont exonérées par les articles 261 à 261 E du CGI n’entre pas dans la facturation électronique entre entreprises.')
  }

  // Une ligne à 0 % ou au taux normal demande le numéro de TVA du vendeur (règles BR-S-02, BR-E-02, G1.47). Celui d'un
  // dossier redevable découle de son SIREN, comme celui d'un dossier en franchise ou exonéré dont le cabinet a dit qu'il
  // en a un, et un statut à préciser se dit déjà : un numéro absent ne se réclame que s'il ne découle pas d'une faute
  // déjà dite.
  if (triees.length > 0 && !horsChamp) {
    if (!v.numeroTva) {
      if ((v.statutTva === 'franchise' || v.statutTva === 'exonere') && !v.numeroTvaAttribue) {
        refus.push('Le numéro de TVA intracommunautaire du dossier est nécessaire à une facture sans TVA (règle G1.47 de la DGFiP) : '
          + 's’il en a un, sa case se coche dans l’onglet TVA du dossier, sous son statut de TVA.')
      } else if (v.statutTva !== null && sirenValide(sirenVendeur)) {
        refus.push('Le numéro de TVA intracommunautaire du dossier manque.')
      }
    } else if (sirenValide(sirenVendeur) && v.numeroTva !== numeroTvaFrancais(sirenVendeur)) {
      refus.push('Le numéro de TVA intracommunautaire du dossier ne correspond pas à son SIREN.')
    }
  }

  // Ce que la facture doit dire du paiement et de l'opération.
  if (f.type === 'facture' && !f.date_echeance) {
    refus.push('Indique la date d’échéance : la facture porte la date à laquelle le règlement doit intervenir (art. L441-9 du code de commerce).')
  }
  if (f.type === 'facture' && f.date_echeance && !anneeAdmise(f.date_echeance)) refus.push(`La date d’échéance n’est pas une date admise ${BORNES}.`)
  if (f.type === 'avoir') {
    if (!d.origine || !d.origine.numero) refus.push('L’avoir doit citer la facture qu’il corrige.')
    else {
      // La facture corrigée se transmet par son numéro et sa date (BT-25, BT-26) : les mêmes règles que les siens.
      if (!numeroAdmis(d.origine.numero)) refus.push(`Le numéro de la facture corrigée (${d.origine.numero}) ne peut pas être transmis.`)
      if (!anneeAdmise(d.origine.date_emission)) refus.push(`La date de la facture corrigée n’est pas une date admise ${BORNES}.`)
    }
  }
  if (f.periode_debut && f.periode_fin) {
    if (!anneeAdmise(f.periode_debut) || !anneeAdmise(f.periode_fin)) refus.push(`La période de la prestation porte une date qui n’est pas admise ${BORNES}.`)
    else if (f.periode_fin < f.periode_debut) refus.push('La période de la prestation finit avant de commencer.')
  }
  if (f.date_prestation && !anneeAdmise(f.date_prestation)) refus.push(`La date de la livraison ou de la prestation n’est pas une date admise ${BORNES}.`)

  return refus
}

// ── Écriture ───────────────────────────────────────────────────────────────────────────────────────────────────────

interface Noeud {
  nom: string
  attributs?: Record<string, string>
  texte?: string
  enfants?: (Noeud | null)[]
}

// Les caractères que XML 1.0 n'admet pas sont retirés, les autres échappés.
function echapper(t: string): string {
  return t
    .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const uneLigne = (t: string) => t.replace(/\s+/g, ' ').trim()

function el(nom: string, contenu: string | (Noeud | null)[], attributs?: Record<string, string>): Noeud {
  return typeof contenu === 'string' ? { nom, attributs, texte: contenu } : { nom, attributs, enfants: contenu }
}

function serialiser(n: Noeud, profondeur: number): string {
  const retrait = '  '.repeat(profondeur)
  const attributs = Object.entries(n.attributs ?? {}).map(([k, v]) => ` ${k}="${echapper(v)}"`).join('')
  if (n.texte !== undefined) return `${retrait}<${n.nom}${attributs}>${echapper(n.texte)}</${n.nom}>`
  const enfants = (n.enfants ?? []).filter((e): e is Noeud => e !== null)
  if (enfants.length === 0) return `${retrait}<${n.nom}${attributs}/>`
  return [`${retrait}<${n.nom}${attributs}>`, ...enfants.map((e) => serialiser(e, profondeur + 1)), `${retrait}</${n.nom}>`].join('\n')
}

const date102 = (iso: string) => iso.slice(0, 10).replace(/-/g, '')

function dateCii(nom: string, iso: string, prefixe: 'udt' | 'qdt' = 'udt'): Noeud {
  return el(nom, [el(`${prefixe}:DateTimeString`, date102(iso), { format: '102' })])
}

function montant(c: number): string {
  const a = Math.abs(c)
  return `${c < 0 ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`
}

function adresseCii(nom: string, adresse: AdresseStructuree, pays: string): Noeud {
  const lignes = adresse.lignes.length > 3 ? [...adresse.lignes.slice(0, 2), adresse.lignes.slice(2).join(', ')] : adresse.lignes
  return el(nom, [
    adresse.codePostal ? el('ram:PostcodeCode', adresse.codePostal) : null,
    lignes[0] ? el('ram:LineOne', lignes[0]) : null,
    lignes[1] ? el('ram:LineTwo', lignes[1]) : null,
    lignes[2] ? el('ram:LineThree', lignes[2]) : null,
    adresse.ville ? el('ram:CityName', adresse.ville) : null,
    el('ram:CountryID', pays),
  ])
}

const CADRES: Record<NatureOperation, string> = { biens: 'B1', services: 'S1', mixte: 'M1' }

// Le cadre de facturation (BT-23, règle G1.02) : le dépôt d'une facture de biens, de services, ou des deux. Les cadres
// « déjà payée », « définitive après acompte », de sous-traitance ou de cotraitance ne sont pas modélisés.
export function cadreDeFacturation(nature: NatureOperation): string {
  return CADRES[nature]
}

// L'option pour la TVA sur les débits ne vise que les prestations de services : sur une facture de biens seuls, elle
// ne dit rien (règle G1.43).
function optionDebitsApplicable(f: Pick<FactureCii, 'option_debits' | 'nature_operation'>): boolean {
  return f.option_debits === true && (f.nature_operation === 'services' || f.nature_operation === 'mixte')
}

export type ResultatCii = { xml: string; refus: [] } | { xml: null; refus: string[] }

// La facture en CII, ou ce qui l'empêche de l'être.
export function factureCii(d: DonneesCii): ResultatCii {
  const refus = refusEmission(d)
  if (refus.length > 0) return { xml: null, refus }
  const { facture: f, vendeur: v } = d
  const motifConnu = motifExoneration(v.statutTva, v.articleExoneration).motif
  const motif = motifConnu ? { code: motifConnu.code, texte: motifConnu.texte } : null
  const m = montantsDuDocument(f, d.lignes, motif)
  const sirenVendeur = sirenDe(v.siret) as string
  const siretClient = f.tiers_siret?.replace(/\s/g, '') || null
  // L'option pour les débits se dit dans chaque ventilation de TVA (règle G1.43, et S1.13 des spécifications : la même
  // valeur partout), dès que le prestataire a opté — comme la mention imprimée (11° bis), qui ne regarde pas les lignes.
  const debits = optionDebitsApplicable(f)
  // L'adresse de livraison n'existe que sur une facture de biens ou mixte : la base le garantit
  // (factures_emises_livraison_de_biens), et ses quatre champs vont ensemble (factures_emises_livraison_complete).
  const livraison = f.livraison_adresse && f.livraison_code_postal && f.livraison_ville && f.livraison_pays
    ? { lignes: [uneLigne(f.livraison_adresse)], codePostal: f.livraison_code_postal, ville: f.livraison_ville, pays: f.livraison_pays }
    : null

  const lignes = m.lignes.map((l) => el('ram:IncludedSupplyChainTradeLineItem', [
    el('ram:AssociatedDocumentLineDocument', [el('ram:LineID', String(l.numero))]),
    el('ram:SpecifiedTradeProduct', [el('ram:Name', uneLigne(l.libelle))]),
    el('ram:SpecifiedLineTradeAgreement', [
      el('ram:NetPriceProductTradePrice', [el('ram:ChargeAmount', decimal(l.prix, 6) as string)]),
    ]),
    el('ram:SpecifiedLineTradeDelivery', [el('ram:BilledQuantity', decimal(l.quantite, 4) as string, { unitCode: UNITE_GENERIQUE })]),
    el('ram:SpecifiedLineTradeSettlement', [
      el('ram:ApplicableTradeTax', [
        el('ram:TypeCode', 'VAT'),
        el('ram:CategoryCode', l.categorie),
        el('ram:RateApplicablePercent', decimal(l.taux, 2) as string),
      ]),
      el('ram:SpecifiedTradeSettlementLineMonetarySummation', [el('ram:LineTotalAmount', montant(l.htCentimes))]),
    ]),
  ]))

  const document = el('rsm:CrossIndustryInvoice', [
    el('rsm:ExchangedDocumentContext', [
      el('ram:BusinessProcessSpecifiedDocumentContextParameter', [el('ram:ID', cadreDeFacturation(f.nature_operation as NatureOperation))]),
      el('ram:GuidelineSpecifiedDocumentContextParameter', [el('ram:ID', PROFIL_EN16931)]),
    ]),
    el('rsm:ExchangedDocument', [
      el('ram:ID', f.numero as string),
      el('ram:TypeCode', f.type === 'avoir' ? '381' : '380'),
      dateCii('ram:IssueDateTime', f.date_emission),
      // Seules les mentions légales partent avec la facture (BT-22). Les notes sont INTERNES : l'écran le dit en les
      // saisissant — « n'apparaissent pas sur la facture », et le motif d'un avoir, « note interne » —, l'aperçu ne les
      // imprime pas, et ce que le cabinet y écrit pour lui-même n'a rien à faire chez le client.
      f.mentions_legales?.trim() ? el('ram:IncludedNote', [el('ram:Content', f.mentions_legales.trim())]) : null,
    ]),
    el('rsm:SupplyChainTradeTransaction', [
      ...lignes,
      el('ram:ApplicableHeaderTradeAgreement', [
        f.type_client === 'organisme_public' && f.code_service ? el('ram:BuyerReference', uneLigne(f.code_service)) : null,
        el('ram:SellerTradeParty', [
          el('ram:Name', uneLigne(v.nom as string)),
          el('ram:SpecifiedLegalOrganization', [el('ram:ID', sirenVendeur, { schemeID: SCHEMA_SIREN })]),
          adresseCii('ram:PostalTradeAddress', adresseStructuree(v.adresse), 'FR'),
          el('ram:URIUniversalCommunication', [el('ram:URIID', sirenVendeur, { schemeID: SCHEMA_ADRESSE_ELECTRONIQUE })]),
          el('ram:SpecifiedTaxRegistration', [el('ram:ID', v.numeroTva as string, { schemeID: 'VA' })]),
        ]),
        el('ram:BuyerTradeParty', [
          siretClient ? el('ram:GlobalID', siretClient, { schemeID: SCHEMA_SIRET }) : null,
          el('ram:Name', uneLigne(f.tiers_nom)),
          el('ram:SpecifiedLegalOrganization', [el('ram:ID', f.tiers_siren as string, { schemeID: SCHEMA_SIREN })]),
          adresseCii('ram:PostalTradeAddress', adresseStructuree(f.tiers_adresse), 'FR'),
          el('ram:URIUniversalCommunication', [
            el('ram:URIID', f.tiers_adresse_electronique ?? (f.tiers_siren as string), { schemeID: SCHEMA_ADRESSE_ELECTRONIQUE }),
          ]),
        ]),
        f.type_client === 'organisme_public' && f.numero_engagement
          ? el('ram:BuyerOrderReferencedDocument', [el('ram:IssuerAssignedID', uneLigne(f.numero_engagement))])
          : null,
      ]),
      el('ram:ApplicableHeaderTradeDelivery', [
        livraison
          ? el('ram:ShipToTradeParty', [adresseCii('ram:PostalTradeAddress', livraison, livraison.pays)])
          : null,
        f.date_prestation
          ? el('ram:ActualDeliverySupplyChainEvent', [dateCii('ram:OccurrenceDateTime', f.date_prestation)])
          : null,
      ]),
      el('ram:ApplicableHeaderTradeSettlement', [
        el('ram:InvoiceCurrencyCode', 'EUR'),
        ...m.groupes.map((g) => el('ram:ApplicableTradeTax', [
          el('ram:CalculatedAmount', montant(g.tvaCentimes)),
          el('ram:TypeCode', 'VAT'),
          g.motif ? el('ram:ExemptionReason', g.motif) : null,
          el('ram:BasisAmount', montant(g.baseCentimes)),
          el('ram:CategoryCode', g.categorie),
          g.codeMotif ? el('ram:ExemptionReasonCode', g.codeMotif) : null,
          debits ? el('ram:DueDateTypeCode', '5') : null,
          el('ram:RateApplicablePercent', decimal(g.taux, 2) as string),
        ])),
        f.periode_debut && f.periode_fin
          ? el('ram:BillingSpecifiedPeriod', [dateCii('ram:StartDateTime', f.periode_debut), dateCii('ram:EndDateTime', f.periode_fin)])
          : null,
        el('ram:SpecifiedTradePaymentTerms', [
          f.type === 'avoir' && d.origine?.numero
            ? el('ram:Description', `Avoir sur la facture ${d.origine.numero} du ${dateLisible(d.origine.date_emission)}.`)
            : null,
          f.type === 'facture' && f.date_echeance ? dateCii('ram:DueDateDateTime', f.date_echeance) : null,
        ]),
        el('ram:SpecifiedTradeSettlementHeaderMonetarySummation', [
          el('ram:LineTotalAmount', montant(m.htCentimes)),
          el('ram:TaxBasisTotalAmount', montant(m.htCentimes)),
          el('ram:TaxTotalAmount', montant(m.tvaCentimes), { currencyID: 'EUR' }),
          el('ram:GrandTotalAmount', montant(m.ttcCentimes)),
          el('ram:DuePayableAmount', montant(m.ttcCentimes)),
        ]),
        f.type === 'avoir' && d.origine?.numero
          ? el('ram:InvoiceReferencedDocument', [
            el('ram:IssuerAssignedID', d.origine.numero),
            dateCii('ram:FormattedIssueDateTime', d.origine.date_emission, 'qdt'),
          ])
          : null,
      ]),
    ]),
  ], { 'xmlns:rsm': NS.rsm, 'xmlns:qdt': NS.qdt, 'xmlns:ram': NS.ram, 'xmlns:udt': NS.udt })

  return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n${serialiser(document, 0)}\n`, refus: [] }
}
// La facture telle que la base la garde, avec l'émetteur qu'elle a figé à sa validation.
export interface FactureEnBase extends FactureCii {
  emetteur_nom: string | null
  emetteur_siret: string | null
  emetteur_adresse: string | null
}

// Ce que le générateur reçoit, assemblé depuis la base — le même assemblage pour l'écran qui dit les refus avant le clic
// et pour les fonctions qui transmettent. Le vendeur est l'émetteur que la facture a figé ; le statut de TVA est celui du
// dossier aujourd'hui, que la facture ne fige pas ; le numéro de TVA se calcule sur le SIREN figé. Un dossier en
// franchise ou exonéré n'a de numéro que si le cabinet l'a dit (`numero_tva_attribue`, décision du 08/10/2026) : sans
// cela, aucun n'est inventé, et `refusEmission` le réclame.
export interface DossierCii {
  statut_tva: StatutTva | null
  article_exoneration: ArticleExoneration | null
  numero_tva_attribue: boolean
}

export function donneesDeLaFacture(
  facture: FactureEnBase,
  lignes: LigneCii[],
  dossier: DossierCii,
  origine: OrigineCii | null,
  aujourdHui: string,
): DonneesCii {
  const siren = sirenDe(facture.emetteur_siret)
  const sansNumero = (dossier.statut_tva === 'franchise' || dossier.statut_tva === 'exonere') && !dossier.numero_tva_attribue
  return {
    facture,
    lignes,
    vendeur: {
      nom: facture.emetteur_nom,
      siret: facture.emetteur_siret,
      adresse: facture.emetteur_adresse,
      numeroTva: !sansNumero && sirenValide(siren) ? numeroTvaFrancais(siren) : null,
      numeroTvaAttribue: dossier.numero_tva_attribue,
      statutTva: dossier.statut_tva,
      articleExoneration: dossier.article_exoneration,
    },
    origine,
    aujourdHui,
  }
}
// ── FIN COPIE factureCii ─────────────────────────────────────────────────────────────────────────────────────────────

// ── Mentions imprimées ─────────────────────────────────────────────────────────────────────────────────────────────

export interface MentionImprimee {
  libelle: string
  texte: string
}

const NATURES: Record<NatureOperation, string> = {
  biens: 'Livraisons de biens',
  services: 'Prestations de services',
  mixte: 'Livraisons de biens et prestations de services',
}

const SIREN_LISIBLE = (siren: string) => siren.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3')

// Les mentions que la facture imprimée doit porter depuis le décret du 7 octobre 2022 (CGI, ann. II, art. 242 nonies
// A, I) — le SIREN du client (1°), l'adresse de livraison (7° bis), la nature des opérations (8° bis), la date ou la
// période de l'opération quand elle diffère de la date de la facture (10°) et l'option pour les débits (11° bis) —, plus
// ce qu'un organisme public demande. Une mention qu'on n'a pas ne s'imprime pas : elle ne se devine pas.
export function mentionsImprimees(f: FactureEmise): MentionImprimee[] {
  const mentions: MentionImprimee[] = []
  if (f.tiers_siren) mentions.push({ libelle: 'SIREN du client', texte: SIREN_LISIBLE(f.tiers_siren) })
  if (f.nature_operation) mentions.push({ libelle: 'Opérations', texte: NATURES[f.nature_operation] })
  if (f.date_prestation) mentions.push({ libelle: 'Date de la livraison ou de la prestation', texte: formatDate(f.date_prestation) })
  if (f.periode_debut && f.periode_fin) {
    mentions.push({ libelle: 'Période', texte: `du ${formatDate(f.periode_debut)} au ${formatDate(f.periode_fin)}` })
  }
  if (f.livraison_adresse && f.livraison_code_postal && f.livraison_ville) {
    const pays = f.livraison_pays && f.livraison_pays !== 'FR' ? `, ${f.livraison_pays}` : ''
    mentions.push({
      libelle: 'Adresse de livraison',
      texte: `${uneLigne(f.livraison_adresse)}, ${f.livraison_code_postal} ${f.livraison_ville}${pays}`,
    })
  }
  if (optionDebitsApplicable(f)) mentions.push({ libelle: 'TVA', texte: 'Option pour le paiement de la taxe d’après les débits' })
  if (f.type_client === 'organisme_public') {
    if (f.code_service) mentions.push({ libelle: 'Code service', texte: f.code_service })
    if (f.numero_engagement) mentions.push({ libelle: 'Numéro d’engagement', texte: f.numero_engagement })
  }
  return mentions
}

// Le numéro de TVA intracommunautaire que la facture imprimée porte sous l'identité de l'émetteur (CGI, ann. II,
// art. 242 nonies A, I, 2°) : celui que porte la facture électronique, calculé du SIRET figé (`donneesDeLaFacture`) —
// et aucun pour un statut à préciser, qui ne dit pas si le dossier en a un : l'imprimer l'inventerait peut-être.
export function numeroTvaImprime(f: Pick<FactureEmise, 'emetteur_siret'>, dossier: DossierCii): string | null {
  if (dossier.statut_tva == null) return null
  if ((dossier.statut_tva === 'franchise' || dossier.statut_tva === 'exonere') && !dossier.numero_tva_attribue) return null
  const siren = sirenDe(f.emetteur_siret)
  return sirenValide(siren) ? numeroTvaFrancais(siren) : null
}

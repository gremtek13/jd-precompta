import {
  NOMS_DES_DESTINATIONS, NOMS_DES_ORIGINES, capitauxPropresAvant, type LigneDAffectation, type OrganeDeLaDecision,
} from './affectationDuResultat'
import { exerciceDeLaDateValide, type DecisionLue, type IdentiteDeLaSociete, type LueDeLAffectation } from './affectationEcran'
import { categorieJuridique } from './categoriesJuridiques'
import type { BlocDuPdf } from './lettresDeMissionVue'
import { pdfDesBlocs } from './pdfLettreDeMission'

// LE PROCÈS-VERBAL D'AFFECTATION (ligne 45, lot AFF5 ; conception docs/conceptions/45-affectation-et-approbation.md, § 3.7,
// AFF-Q6 (A), AFF-Q12 (A)). Pur, sans réseau : le document — procès-verbal d'assemblée, de consultation écrite, acte unanime
// ou décision de l'associé unique — se compose des SEULES valeurs que la base a figées avec la version de la décision (le
// résultat, la forme, le capital, les soldes des capitaux propres) et de sa répartition ; jamais d'une saisie pour un chiffre.
// Ce que l'application ne sait pas — le lieu, l'heure, les associés présents et leurs parts, les débats, les votes, les
// dividendes des trois exercices précédents, les signatures — reste en blanc, à compléter : l'application ne garde aucun nom
// d'associé (RGPD.md, LIA-Q10). Le contenu suit C. com. R223-24 (le procès-verbal d'une SARL : date et lieu, associés présents
// ou représentés, documents soumis, résumé des débats, texte des résolutions, résultat des votes ; la réponse de chaque associé
// annexée à celui d'une consultation écrite) et R223-26 (la décision de l'associé unique, répertoriée au registre) ; CGI,
// art. 243 bis (les dividendes des trois exercices précédents). Le pied dit que c'est un PROJET : la régularité de la décision
// relève des associés et de leurs statuts, la validation juridique reste au cabinet.
//
// Le document signé revient par `joindre_document_affectation` seule (une fois par version, au chemin de sa décision, son
// empreinte SHA-256) : `lib/procesVerbalEcriture.ts`. Les échéances de l'approbation : `lib/echeancesFiscales.ts`.

const BLANC = '______'

/** Le pied de chaque page, et la dernière mention du document. */
export const PIED_DU_PROCES_VERBAL =
  'Projet préparé par le cabinet — la régularité de la décision relève des associés et de leurs statuts.'

/** Le titre du document, selon l'organe qui décide. */
export function titreDuDocument(organe: OrganeDeLaDecision): string {
  switch (organe) {
    case 'assemblee': return 'Procès-verbal de l’assemblée générale ordinaire'
    case 'consultation_ecrite': return 'Procès-verbal de la consultation écrite des associés'
    case 'acte_unanime': return 'Acte constatant les décisions unanimes des associés'
    case 'associe_unique': return 'Décision de l’associé unique'
  }
}

/** Le nom du fichier téléchargé : l'exercice et la version, jamais un nom de personne. */
export function nomDuFichierDuDocument(annee: number, decision: Pick<DecisionLue, 'organe' | 'version'>): string {
  const genre = decision.organe === 'associe_unique' ? 'decision-associe-unique' : 'proces-verbal'
  return `${genre}-affectation-${annee}-version-${decision.version}.pdf`
}

/** Le chemin du document signé : celui que `joindre_document_affectation` exige, `<dossier>/affectations/<décision>.pdf`. */
export function cheminDuProcesVerbal(dossierId: string, decisionId: string): string {
  return `${dossierId}/affectations/${decisionId}.pdf`
}

/**
 * Un montant en euros, au centime, chiffres groupés par une espace ORDINAIRE : pdf-lib ne connaît que WinAnsi, et
 * `Intl.NumberFormat('fr-FR')` y glisse des espaces fines insécables (CLAUDE.md, « Le moteur de la 2035 »). En entiers.
 */
export function montantDuDocument(centimes: number): string {
  const signe = centimes < 0 ? '-' : ''
  const absolu = Math.abs(centimes)
  const euros = String(Math.floor(absolu / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${signe}${euros},${String(absolu % 100).padStart(2, '0')} €`
}

const dateDite = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

/** « à la réserve légale », « au report à nouveau créditeur », « aux dividendes ». */
function versLaDestination(nom: string): string {
  if (nom.startsWith('le ')) return `au ${nom.slice(3)}`
  if (nom.startsWith('les ')) return `aux ${nom.slice(4)}`
  return `à ${nom}`
}

/** Une ligne de la répartition, dite. */
export function phraseDeLaRepartition(l: LigneDAffectation): string {
  return `prélevé sur ${NOMS_DES_ORIGINES[l.origine]} : ${montantDuDocument(l.centimes)} ${versLaDestination(NOMS_DES_DESTINATIONS[l.destination])}`
}

function resultatDit(centimes: number): string {
  if (centimes > 0) return `un bénéfice de ${montantDuDocument(centimes)}`
  if (centimes < 0) return `une perte de ${montantDuDocument(-centimes)}`
  return 'un résultat nul'
}

/** Ce que le document imprime, tiré des valeurs figées de la version et de sa répartition. */
export interface EntreeDuProcesVerbal {
  annee: number
  identite: IdentiteDeLaSociete
  decision: DecisionLue
}

/** Les chiffres du document, tous tirés des valeurs figées : le résultat, les capitaux propres avant et après, les dividendes. */
export function chiffresDuDocument(d: DecisionLue): { resultat: number; avant: number; dividendes: number; apres: number } {
  const avant = capitauxPropresAvant(d.figee.soldes, d.figee.resultatCentimes)
  const dividendes = d.comptesApprouves
    ? d.lignes.filter((l) => l.destination === 'dividendes').reduce((s, l) => s + l.centimes, 0)
    : 0
  return { resultat: d.figee.resultatCentimes, avant, dividendes, apres: avant - dividendes }
}

/** Le contenu du document, en blocs que `pdfDesBlocs` met en page. */
export function contenuDuProcesVerbal({ annee, identite, decision: d }: EntreeDuProcesVerbal): BlocDuPdf[] {
  const blocs: BlocDuPdf[] = []
  const titre = (texte: string) => blocs.push({ genre: 'titre', texte })
  const intertitre = (texte: string) => blocs.push({ genre: 'intertitre', texte })
  const texte = (t: string) => blocs.push({ genre: 'texte', texte: t })
  const mention = (t: string) => blocs.push({ genre: 'mention', texte: t })
  const cloture = `31/12/${annee}`
  const unique = d.organe === 'associe_unique'
  const sujet = { assemblee: 'L’assemblée', consultation_ecrite: 'Les associés', acte_unanime: 'Les associés', associe_unique: 'L’associé unique' }[d.organe]
  const approuve = d.organe === 'assemblee' || unique ? 'approuve' : 'approuvent'
  const decide = d.organe === 'assemblee' || unique ? 'décide' : 'décident'
  const chiffres = chiffresDuDocument(d)
  const forme = categorieJuridique(d.figee.formeJuridique)?.libelle ?? `forme ${d.figee.formeJuridique}`

  titre(titreDuDocument(d.organe))
  texte(`Approbation des comptes de l’exercice clos le ${cloture} et affectation du résultat`)
  texte([
    identite.denomination,
    `${forme} au capital de ${montantDuDocument(d.figee.capitalCentimes)}`,
    identite.adresse ? `Siège : ${identite.adresse}` : `Siège : ${BLANC}`,
    identite.rcsVille && identite.siret ? `RCS ${identite.rcsVille} ${identite.siret.slice(0, 9)}` : `RCS : ${BLANC}`,
  ].join('\n'))

  switch (d.organe) {
    case 'assemblee':
      texte(`Le ${dateDite(d.dateDecision)}, à ${BLANC} heures, les associés se sont réunis en assemblée générale ordinaire, à ${BLANC} (lieu), sur convocation de la gérance.`)
      texte(`Associés présents ou représentés (identité, nombre de parts) : ${BLANC}\nPrésident de séance : ${BLANC}`)
      texte('Documents soumis à l’assemblée : les comptes annuels de l’exercice (bilan, compte de résultat, annexe), le rapport de gestion s’il est établi, le rapport du commissaire aux comptes s’il en est désigné un, le texte des résolutions proposées.')
      texte(`Résumé des débats : ${BLANC}`)
      break
    case 'consultation_ecrite':
      texte(`Le ${dateDite(d.dateDecision)}, les associés ont été consultés par écrit ; le texte des résolutions et les documents nécessaires à leur information (les comptes annuels de l’exercice, le rapport de gestion s’il est établi) leur ont été adressés le ${BLANC}.`)
      texte(`Réponses reçues (identité, nombre de parts, sens du vote) : ${BLANC}\nLa réponse de chaque associé est annexée au présent procès-verbal.`)
      break
    case 'acte_unanime':
      texte(`Le ${dateDite(d.dateDecision)}, les associés soussignés, représentant la totalité du capital, ont pris à l’unanimité les décisions suivantes, après avoir pris connaissance des comptes annuels de l’exercice et du rapport de gestion s’il est établi.`)
      texte(`Associés (identité, nombre de parts) : ${BLANC}`)
      break
    case 'associe_unique':
      texte(`Le ${dateDite(d.dateDecision)}, ${BLANC} (identité), associé unique, après avoir pris connaissance des comptes annuels de l’exercice (bilan, compte de résultat, annexe) et du rapport de gestion s’il est établi, a pris les décisions suivantes.`)
      break
  }

  intertitre('Les comptes de l’exercice')
  texte([
    `Résultat de l’exercice clos le ${cloture} : ${resultatDit(chiffres.resultat)}.`,
    `Capitaux propres avant affectation : ${montantDuDocument(chiffres.avant)}.`,
    `Capital social : ${montantDuDocument(d.figee.capitalCentimes)}.`,
  ].join('\n'))

  const vote = () => {
    if (d.organe === 'assemblee' || d.organe === 'consultation_ecrite') {
      texte(`Résultat du vote : pour ${BLANC} parts, contre ${BLANC} parts, abstention ${BLANC} parts — résolution ${BLANC} (adoptée ou rejetée).`)
    }
  }
  const resolution = unique ? 'décision' : 'résolution'
  intertitre(`Première ${resolution} — approbation des comptes`)
  if (d.comptesApprouves) {
    texte(`${sujet} ${approuve} les comptes annuels de l’exercice clos le ${cloture} tels qu’ils ont été présentés, qui font apparaître ${resultatDit(chiffres.resultat)}.`)
  } else {
    texte(`Les comptes annuels de l’exercice clos le ${cloture}, qui font apparaître ${resultatDit(chiffres.resultat)}, ne sont pas approuvés. Aucune affectation n’est décidée : le résultat reste en attente d’affectation.`)
  }
  vote()

  if (d.comptesApprouves) {
    intertitre(`Deuxième ${resolution} — affectation du résultat`)
    if (d.lignes.length === 0) {
      texte('Aucune affectation n’est décidée.')
    } else {
      texte(`${sujet} ${decide} l’affectation suivante :\n${d.lignes.map((l) => `– ${phraseDeLaRepartition(l)}`).join('\n')}`)
    }
    if (chiffres.dividendes > 0) {
      texte(`Le dividende total s’élève à ${montantDuDocument(chiffres.dividendes)}. ${d.dateMiseEnPaiement
        ? `Sa mise en paiement interviendra le ${dateDite(d.dateMiseEnPaiement)}.`
        : `Sa mise en paiement interviendra le ${BLANC}, au plus tard le 30/09/${annee + 1} (C. com., L232-13).`}`)
    }
    texte(`Capitaux propres après affectation : ${montantDuDocument(chiffres.apres)}.`)
    texte(`Conformément à l’article 243 bis du code général des impôts, dividendes distribués au titre des trois exercices précédents : ${BLANC}.`)
    vote()
  }

  intertitre(`${d.comptesApprouves ? 'Troisième' : 'Deuxième'} ${resolution} — pouvoirs`)
  texte(`Tous pouvoirs sont donnés au porteur d’une copie ${unique ? 'de la présente décision' : 'du présent procès-verbal'} pour accomplir les formalités de dépôt au greffe.`)
  vote()

  intertitre('Signatures')
  switch (d.organe) {
    case 'assemblee': texte(`Le président de séance : ${BLANC}\nUn associé, le cas échéant : ${BLANC}`); break
    case 'consultation_ecrite': texte(`Le gérant : ${BLANC}`); break
    case 'acte_unanime': texte(`Chacun des associés : ${BLANC}`); break
    case 'associe_unique': texte(`L’associé unique : ${BLANC}`); break
  }

  if (unique) {
    mention('Décision à répertorier au registre des décisions de l’associé unique (C. com., R223-26 pour une SARL ; L227-9 pour une SAS).')
    // AFF-Q12 (A) : dans l'EURL dont l'associé unique, personne physique, est seul gérant, le dépôt des comptes vaut
    // approbation ; la décision d'affectation se date et se garde quand même.
    if (d.figee.formeJuridique.startsWith('54')) {
      mention('Si l’associé unique, personne physique, est seul gérant, le dépôt au registre du commerce de l’inventaire et des comptes annuels signés vaut approbation des comptes (C. com., L223-31) ; la décision d’affectation reste à répertorier au registre.')
    }
  }
  mention(`Version ${d.version} de la décision enregistrée dans l’application ; les chiffres sont ceux que la base a figés avec elle.`)
  mention(PIED_DU_PROCES_VERBAL)
  return blocs
}

/**
 * Le PDF du document (pdf-lib, Helvetica, A4) : daté du jour de la décision, jamais de l'heure du clic — deux téléchargements
 * de la même version rendent les mêmes octets. Il ne se garde pas : c'est le document SIGNÉ qui revient, et son empreinte.
 */
export function pdfDuProcesVerbal(e: EntreeDuProcesVerbal): Promise<Uint8Array> {
  return pdfDesBlocs(contenuDuProcesVerbal(e), {
    titre: titreDuDocument(e.decision.organe),
    pied: PIED_DU_PROCES_VERBAL,
    instant: `${e.decision.dateDecision}T12:00:00Z`,
  })
}

// ── Le document signé, joint ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Le refus de JOINDRE un document à une version, avant le clic, aux mots de `joindre_document_affectation` : une version
 * qui n'est plus en vigueur, un document déjà joint, l'exercice de sa date validé. Nul : le dépôt est offert.
 */
export function refusDeJoindre(lue: LueDeLAffectation, decision: DecisionLue): string | null {
  if (decision.etat !== 'en_vigueur') return 'Seule la décision en vigueur reçoit son document signé.'
  if (decision.document !== null) {
    return 'Le procès-verbal de cette décision est déjà joint : une version nouvelle de la décision en produit un nouveau.'
  }
  if (exerciceDeLaDateValide(decision.dateDecision, lue.anneesValidees)) {
    return `L’exercice qui contient le ${dateDite(decision.dateDecision)} est validé : une écriture n’y entre plus.`
  }
  return null
}

/** La confirmation du dépôt : nomme la version, l'exercice, le fichier, son poids et son empreinte, et ce qui ne se défait pas. */
export function confirmationDuDepot(annee: number, decision: DecisionLue, fichier: { nom: string; poids: string; empreinte: string }): string {
  return `Joindre « ${fichier.nom} » (${fichier.poids}, empreinte SHA-256 ${fichier.empreinte}) comme document signé de la décision `
    + `version ${decision.version} du ${dateDite(decision.dateDecision)} sur l’exercice ${annee} ?\n\n`
    + 'Il ne se remplace pas : une version nouvelle de la décision en produit un nouveau.'
}

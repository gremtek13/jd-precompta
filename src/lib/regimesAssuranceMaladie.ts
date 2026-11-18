// LES GRANDS RÉGIMES DE L'ASSURANCE MALADIE OBLIGATOIRE, ET LE RÉGIME D'UN ORGANISME IMPRIMÉ SUR UN BORDEREAU (conception 59,
// BOR1-Q5 ; la note du cabinet du 18/11/2026 : « tu peux pas voir les autres régimes ? et les mettre tous ? »).
//
// POURQUOI : les paiements de NOE3 se rangent sous deux entiers, le régime et la caisse (la migration préparée de NOE3,
// `regime` de 0 à 99, `caisse` de 0 à 999 ; ce module ne nomme pas sa table, qu'il ne lit pas). Le bordereau
// de télétransmission de Télévitale imprime l'organisme sous un code de caisse de trois chiffres et un libellé
// (« NNN - CPAM - VILLE »), SANS le régime (conception 59, § 12.1). Le rapprochement du facturé et du payé (BOR5) a besoin du
// régime : ce module le tire du libellé imprimé quand une source publique le permet, et sinon il le laisse « à choisir par
// celui qui importe », dans la liste fermée ci-dessous. Il ne devine jamais.
//
// LA SOURCE DE LA LISTE : le jeu de valeurs « JDV_Code_regime » publié par l'Agence du numérique en santé (ANS) dans ses
// Terminologies de santé — OID 1.2.250.1.213.3.4.134, version du 22/03/2024, codes du système 1.2.250.1.213.3.3.104 :
// https://interop.esante.gouv.fr/publication/TDD-html-20241112T130040/voc-1.2.250.1.213.3.4.134-2024-03-22T192103.html
// (consulté le 18/11/2026). Chaque ligne de `GRANDS_REGIMES` est une ligne de ce jeu, son code et son intitulé recopiés tels
// quels ; une ligne qui cite une seconde source le dit dans sa propre `source`. Aucune norme AFNOR, aucun code d'un tiers.
//
// LA RÈGLE DE RATTACHEMENT D'UN LIBELLÉ (la seule) : le premier segment du libellé imprimé, avant le premier « - » (« CPAM »
// dans « CPAM - VILLE »), comparé sans accents ni casse ni espaces doubles à l'intitulé d'une ligne du jeu, À L'IDENTIQUE.
// Jamais une sous-chaîne, jamais un mot du reste du libellé (la ville), jamais le code de caisse : le même code de caisse
// existe sous plusieurs régimes. Un premier segment qui n'est l'intitulé d'aucune ligne est « à choisir ».
//
// CE QUE LES SOURCES NE DISENT PAS, ET QUI RESTE DONC « À CHOISIR » OU À VÉRIFIER :
//   - la façon dont Télévitale IMPRIME l'organisme d'un régime autre que le régime général : seule une page « CPAM » a été
//     vue (BOR0). Que la MSA s'imprime « MSA - … » est vraisemblable, pas vérifié ; un autre libellé tombe à « à choisir »,
//     jamais sous un régime faux ;
//   - les caisses générales de sécurité sociale d'outre-mer (« CGSS »), les caisses communes, la CAMIEG, le régime d'Alsace-
//     Moselle : aucune ligne du jeu ne porte leur sigle ; elles restent « à choisir » ;
//   - le régime 03 (« RSI ») : le jeu le garde, mais le régime social des indépendants a été supprimé et ses assurés repris
//     par le régime général (loi n° 2017-1836 du 30 décembre 2017, art. 15) ; un libellé « RSI » ne peut venir que d'un ancien
//     lot. La ligne reste, telle que le jeu la donne ;
//   - l'intitulé du code 90 (« CAMAC ») est recopié tel quel ; son sens n'est pas établi ici.
//
// UN MODULE PUR : il ne lit rien en base, n'appelle personne, n'importe rien.

/** Une ligne du jeu de valeurs JDV_Code_regime de l'ANS. */
export interface GrandRegime {
  /** Le code du régime, tel que le jeu le donne (un entier de 1 à 99 ; « 01 » s'imprime sur deux chiffres). */
  code: number
  /** L'intitulé du jeu, recopié tel quel. */
  intitule: string
  /** D'où vient la ligne. */
  source: string
}

const JDV = 'ANS, JDV_Code_regime (OID 1.2.250.1.213.3.4.134, 22/03/2024)'

/** La liste fermée des grands régimes : celle du rattachement d'un libellé, et celle du choix de celui qui importe. */
export const GRANDS_REGIMES: readonly GrandRegime[] = [
  { code: 1, intitule: 'CPAM', source: `${JDV} ; code de la sécurité sociale, art. L. 211-1 (les caisses primaires, organismes du régime général)` },
  { code: 2, intitule: 'MSA', source: JDV },
  { code: 3, intitule: 'RSI', source: `${JDV} ; supprimé par la loi n° 2017-1836, art. 15 (un ancien lot seulement)` },
  { code: 4, intitule: 'SNCF', source: JDV },
  { code: 5, intitule: 'RATP', source: JDV },
  { code: 6, intitule: 'ENIM', source: JDV },
  { code: 7, intitule: 'MINES', source: JDV },
  { code: 8, intitule: 'CNMSS', source: JDV },
  { code: 9, intitule: 'CPM Banque de France', source: JDV },
  { code: 10, intitule: 'CRPCEN', source: JDV },
  { code: 12, intitule: 'RSAM CCIP', source: JDV },
  { code: 14, intitule: 'Assemblée nationale', source: JDV },
  { code: 15, intitule: 'SENAT', source: JDV },
  { code: 16, intitule: 'PORT AUTONOME DE BORDEAUX', source: JDV },
  { code: 17, intitule: 'Français à l\'étranger', source: JDV },
  { code: 80, intitule: 'MINISTERE DES ANCIENS COMBATTANTS', source: JDV },
  { code: 90, intitule: 'CAMAC', source: JDV },
  { code: 91, intitule: 'MGEN', source: JDV },
  { code: 92, intitule: 'MG', source: JDV },
  { code: 93, intitule: 'MGP', source: JDV },
  { code: 94, intitule: 'MFP', source: JDV },
  { code: 95, intitule: 'MNH', source: JDV },
  { code: 96, intitule: 'MNAM', source: JDV },
  { code: 99, intitule: 'SLM', source: JDV },
]

/** Le régime d'un organisme imprimé : reconnu par la liste, ou à choisir par celui qui importe. */
export type RegimeDeLOrganisme =
  | { etat: 'reconnu'; regime: GrandRegime }
  | { etat: 'a_choisir' }

function comparable(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[   \t]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
}

const PAR_INTITULE: ReadonlyMap<string, GrandRegime> = new Map(GRANDS_REGIMES.map((r) => [comparable(r.intitule), r]))

/**
 * Le régime d'un organisme, d'après son libellé imprimé (« CPAM - VILLE ») : le premier segment avant « - », comparé à
 * l'identique à l'intitulé d'une ligne de `GRANDS_REGIMES`. Sinon « à choisir » — jamais deviné.
 */
export function regimeDuLibelle(libelle: string): RegimeDeLOrganisme {
  const premier = comparable(libelle.split('-')[0] ?? '')
  const regime = premier === '' ? undefined : PAR_INTITULE.get(premier)
  return regime === undefined ? { etat: 'a_choisir' } : { etat: 'reconnu', regime }
}

/** Le régime que celui qui importe a choisi, s'il est dans la liste fermée ; nul sinon (un code hors liste se refuse). */
export function regimeChoisi(code: number): GrandRegime | null {
  return GRANDS_REGIMES.find((r) => r.code === code) ?? null
}

/** Le code d'un régime sur deux chiffres, comme il s'imprime (« 01 »). */
export function codeDuRegime(regime: GrandRegime): string {
  return String(regime.code).padStart(2, '0')
}

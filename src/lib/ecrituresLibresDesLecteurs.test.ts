import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { BanquesDuDossier } from './banqueDuMouvement'
import { SEPARATEUR_DU_POSTE, type ChoixChampsBnc } from './champsBncDuFec'
import { OPERATIONS_DE_CAISSE_ABSENTES } from './controlesDeLaCaisse'
import { posteDuFormulaire } from './cases2035'
import { ECRITURES_LIBRES_PREVUES } from './ecritureLibre'
import {
  ECRITURES_LIBRES_ABSENTES, libellesSaisisDesComptes, posteDeLaLigneLibre, referenceDeLEcritureLibre,
  type EcritureLibreDeLEtat, type EcrituresLibresDesExports,
} from './ecrituresLibresDesExports'
import {
  contenuDeLEtat, effetDeLaLigne, genererEtatDesEcrituresLibresCsv, lignesDeLEtat, nomDuFichierDeLEtat, pdfDeLEtat,
} from './etatDesEcrituresLibres'
import {
  CHAMPS_BNC_NON_EXPORTES, ENTETES_FEC_BNC, formaterFec, genererFec, libelleCompte, numeroterFec, type ChampsBncDuFec,
  type EntreesDesChampsBnc,
} from './fec'
import { lettrages } from './lettrage'
import { absenceFec, genererPisteAuditCsv, pisteAudit, rupturesPisteAudit, type RegistreAudit } from './pisteAudit'
import { PLAN_PAR_DEFAUT } from './planComptable'
import type { EcritureBrouillon, Piece } from './types'
import { defautsDeNumerotation } from './validationExercice'
import { anomaliesDgfip, colonnes, desequilibresDgfip } from '../test/fecDgfip'
import { composerLeFecFictif } from '../test/fecFictif'
import { migrationRangee } from '../test/schema'
import { modeleDeTest } from '../test/modeles'
import { SANS_ECRITURE_DE_VENTE, SANS_VENTE_FACTUREE } from '../test/ventesFacturees'

// L'ÉCRITURE LIBRE DE L'EXPERT-COMPTABLE CHEZ LES LECTEURS DU BROUILLON (EL3 ; conception 54, § 3.6, § 5.6, § 5.7) : le FEC (la
// sorte `libre`, au journal OD, l'état des écritures libres pour pièce, ses quatre champs d'un BNC), la numérotation que la
// validation enverra, la piste d'audit et ses détecteurs, `absenceFec`, le lettrage, et l'état des écritures libres (CSV, PDF).
// Le drapeau `ECRITURES_LIBRES_PREVUES` baissé, la colonne `ecriture_libre_id` n'est pas en base et les exports reçoivent
// `ECRITURES_LIBRES_ABSENTES` : le FEC d'hier à l'octet. Levé (EL5, EL8), l'appelant passe les écritures libres lues (`lues`) :
// c'est cet état que les tests jouent, sans drapeau à forcer — aucun de ces modules ne le lit. Données FICTIVES ; des noms de
// patient plantés dans le motif, le tiers et le nom de fichier de la pièce citée, qu'aucun export ne doit porter.

const PATIENTE = 'DUPONTEL Marguerite'
const MOTIF = `Rétrocession de décembre réglée par l’exploitant ; voir la note de ${PATIENTE} ; justifiée par le contrat`
const AUTEUR = 'a0000000-0000-4000-8000-000000000001'

const ligne = (o: Partial<EcritureBrouillon>): EcritureBrouillon => ({
  id: 'e', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, date: '2026-12-31', libelle: 'Rétrocession de décembre',
  sens: 'debit', statut: 'proposee', compte: '622600', montant: 300, created_at: '2026-12-31T09:00:00Z',
  date_reglement: null, mode_reglement: null, nature_operation: null, poste_rattache: null, identification_client: null, ...o,
} as EcritureBrouillon)

const libre = (o: Partial<EcritureLibreDeLEtat>): EcritureLibreDeLEtat => ({
  id: 'el-3', dossier_id: 'd1', exercice: 2026, numero: 3, date: '2026-12-31', libelle: 'Rétrocession de décembre', motif: MOTIF,
  lignes: [], avec_extourne: false, piece_citee_id: null, version: 1, cree_par: AUTEUR, cree_le: '2026-12-31T10:15:00Z',
  modifie_par: null, modifie_le: null, ...o,
})

// Une rétrocession payée par l'exploitant, comptée sous son poste, qui cite une pièce ; puis une charge hors de la 2035 au 31
// décembre, face à un compte d'attente que l'application ne nomme pas, avec son extourne au 1er janvier.
const PIECE_CITEE: Piece = {
  id: 'p-citee', dossier_id: 'd1', tiers: PATIENTE, nom_fichier: `note-${PATIENTE}.pdf`, storage_hash: 'abcdef0123456789abcdef',
  created_at: '2026-12-20T08:00:00Z', date_piece: '2026-12-18', type_piece: 'autre', montant_ttc: 300,
} as Piece
const EL3 = libre({
  lignes: [
    { compte: '622600', sens: 'debit', centimes: 30000, poste_2035: 'Honoraires rétrocédés', compte_lib: null },
    { compte: '108000', sens: 'credit', centimes: 30000, poste_2035: null, compte_lib: null },
  ],
  piece_citee_id: 'p-citee', version: 2, modifie_par: AUTEUR, modifie_le: '2027-01-05T16:40:00Z',
})
const COMPTE_D_ATTENTE = '471900'
// Un compte de charge que ni l'application, ni une catégorie, ni le plan comptable ne nomment : son libellé est celui saisi.
const COMPTE_NON_NOMME = '658900'
const EL4 = libre({
  id: 'el-4', numero: 4, libelle: 'Écart de rapprochement constaté', motif: 'Écart relevé à la révision ; à solder en janvier',
  avec_extourne: true,
  lignes: [
    { compte: COMPTE_NON_NOMME, sens: 'debit', centimes: 5000, poste_2035: null, compte_lib: 'Écart de l’expert-comptable' },
    { compte: COMPTE_D_ATTENTE, sens: 'credit', centimes: 5000, poste_2035: null, compte_lib: null },
  ],
})
const BROUILLON_2026 = [
  ligne({ id: 'b1', compte: '622600', sens: 'debit', montant: 300, ecriture_libre_id: 'el-3' }),
  ligne({ id: 'b2', compte: '108000', sens: 'credit', montant: 300, ecriture_libre_id: 'el-3' }),
  ligne({ id: 'b3', compte: COMPTE_NON_NOMME, sens: 'debit', montant: 50, libelle: EL4.libelle, ecriture_libre_id: 'el-4' }),
  ligne({ id: 'b4', compte: COMPTE_D_ATTENTE, sens: 'credit', montant: 50, libelle: EL4.libelle, ecriture_libre_id: 'el-4' }),
]
const EXTOURNE_2027 = [
  ligne({ id: 'x3', date: '2027-01-01', compte: COMPTE_NON_NOMME, sens: 'credit', montant: 50, libelle: `Extourne — ${EL4.libelle}`, ecriture_libre_id: 'el-4' }),
  ligne({ id: 'x4', date: '2027-01-01', compte: COMPTE_D_ATTENTE, sens: 'debit', montant: 50, libelle: `Extourne — ${EL4.libelle}`, ecriture_libre_id: 'el-4' }),
]
const AUTEURS = new Map([[AUTEUR, 'expert@cabinet.test']])
const LUES: EcrituresLibresDesExports = { etat: 'lues', ecritures: [EL3, EL4], auteurs: AUTEURS }

const TRESORERIE = modeleDeTest('tresorerie')
const ENGAGEMENT = modeleDeTest('engagement')
const ROLE: BanquesDuDossier = { cas: 'role', compte: PLAN_PAR_DEFAUT.banque, connus: null }
const DATE_DE_L_ECRITURE: ChoixChampsBnc = { sansReglement: 'date_de_l_ecriture' }
const entrees = (): EntreesDesChampsBnc => ({
  choix: DATE_DE_L_ECRITURE, paiements: new Map(), registre: [], factures: [], cotisations: [], ventilations: [], acquisitions: new Map(),
  plan: PLAN_PAR_DEFAUT,
})
const EXPORTES: ChampsBncDuFec = { etat: 'exportes', entrees: entrees() }
const numeroter = (ecritures: EcritureBrouillon[], libres: EcrituresLibresDesExports, champs: ChampsBncDuFec = CHAMPS_BNC_NON_EXPORTES) =>
  numeroterFec(ecritures, [], [], [], TRESORERIE, [], SANS_ECRITURE_DE_VENTE, OPERATIONS_DE_CAISSE_ABSENTES, champs, libres)
const fec = (ecritures: EcritureBrouillon[], libres: EcrituresLibresDesExports, champs: ChampsBncDuFec) =>
  genererFec(ecritures, [], [], [], TRESORERIE, [], new Map(), SANS_ECRITURE_DE_VENTE, OPERATIONS_DE_CAISSE_ABSENTES, champs, libres)
const sha = (texte: string) => createHash('sha256').update(texte).digest('hex')

describe('le drapeau baissé : le FEC d’hier, à l’octet', () => {
  it('le drapeau suit la migration EL2 : levé si et seulement si elle est rangée dans l’export', () => {
    expect(ECRITURES_LIBRES_PREVUES).toBe(migrationRangee('ecritures_libres'))
  })

  it('le FEC fictif d’une année entière, à dix-huit et à vingt-deux colonnes : les empreintes d’avant EL3', () => {
    // Relevées sur le commit 0688348d (avant EL3) par le même calcul : la sorte neuve et le paramètre ne changent pas un octet
    // d'un fichier qui n'a aucune écriture libre.
    const f = composerLeFecFictif(DATE_DE_L_ECRITURE)
    expect(sha(f.dixHuit)).toBe(EMPREINTE_DIX_HUIT)
    expect(sha(f.vingtDeux)).toBe(EMPREINTE_VINGT_DEUX)
  })

  it('sans écriture libre, le défaut, l’absence passée et une liste lue vide rendent le même fichier', () => {
    const sansLibre = BROUILLON_2026.map((l) => ({ ...l, ecriture_libre_id: undefined, immobilisation_id: 'bien' }))
    for (const champs of [CHAMPS_BNC_NON_EXPORTES, EXPORTES]) {
      const parDefaut = genererFec(sansLibre, [], [], [], TRESORERIE, [], new Map(), SANS_ECRITURE_DE_VENTE, OPERATIONS_DE_CAISSE_ABSENTES, champs)
      expect(fec(sansLibre, ECRITURES_LIBRES_ABSENTES, champs)).toBe(parDefaut)
      expect(fec(sansLibre, { etat: 'lues', ecritures: [], auteurs: new Map() }, champs)).toBe(parDefaut)
      // Des écritures libres lues qu'aucune ligne ne cite, sans libellé saisi, ne changent rien non plus ; un libellé saisi, lui,
      // nomme son compte partout dans le fichier (un CompteNum, un CompteLib), et lui seul.
      expect(fec(sansLibre, { etat: 'lues', ecritures: [EL3], auteurs: AUTEURS }, champs)).toBe(parDefaut)
      const renomme = fec(sansLibre, LUES, champs)
      expect(renomme).not.toBe(parDefaut)
      expect(renomme.replaceAll('Écart de l’expert-comptable', COMPTE_NON_NOMME)).toBe(parDefaut)
    }
  })

  it('le chemin par défaut : une ligne qui cite une écriture libre, les écritures libres absentes, reste hors du fichier', () => {
    const parDefaut = numeroterFec(BROUILLON_2026, [], [], [], TRESORERIE, [], SANS_ECRITURE_DE_VENTE, OPERATIONS_DE_CAISSE_ABSENTES,
      CHAMPS_BNC_NON_EXPORTES)
    expect(parDefaut.horsFec.map((e) => e.id)).toEqual(['b1', 'b2', 'b3', 'b4'])
    expect(parDefaut.lignes).toEqual([])
    // Lue, mais pas celle que la ligne cite : dehors aussi, jamais devinée.
    expect(numeroter(BROUILLON_2026, { etat: 'lues', ecritures: [EL3], auteurs: AUTEURS }).horsFec.map((e) => e.id)).toEqual(['b3', 'b4'])
  })
})

describe('le FEC : une écriture par écriture libre et par date, au journal OD, sous « EL<année>-<numéro> »', () => {
  it('la référence : l’exercice et le numéro sur quatre chiffres, tous les chiffres au-delà', () => {
    expect(referenceDeLEcritureLibre({ exercice: 2026, numero: 3 })).toBe('EL2026-0003')
    expect(referenceDeLEcritureLibre({ exercice: 2026, numero: 12345 })).toBe('EL2026-12345')
  })

  it('dix-huit colonnes : le journal, le numéro, la pièce, sa date, le libellé de l’expert ; équilibré, une date', () => {
    const f = fec(BROUILLON_2026, LUES, CHAMPS_BNC_NON_EXPORTES)
    expect(colonnes(f).slice(1).map((r) => [r[0], r[2], r[3], r[4], r[8], r[9], r[10]])).toEqual([
      ['OD', 'OD00001', '20261231', '622600', 'EL2026-0003', '20261231', 'Rétrocession de décembre'],
      ['OD', 'OD00001', '20261231', '108000', 'EL2026-0003', '20261231', 'Rétrocession de décembre'],
      ['OD', 'OD00002', '20261231', COMPTE_NON_NOMME, 'EL2026-0004', '20261231', EL4.libelle],
      ['OD', 'OD00002', '20261231', COMPTE_D_ATTENTE, 'EL2026-0004', '20261231', EL4.libelle],
    ])
    expect(anomaliesDgfip(f)).toEqual([])
    expect(desequilibresDgfip(f)).toEqual([])
    expect(defautsDeNumerotation(numeroter(BROUILLON_2026, LUES))).toEqual([])
  })

  it('CompteLib : celui de l’application, et le libellé saisi d’un compte qu’elle ne nomme que par son numéro', () => {
    expect(libelleCompte(COMPTE_NON_NOMME, [])).toBe(COMPTE_NON_NOMME)
    const parCompte = new Map(colonnes(fec(BROUILLON_2026, LUES, CHAMPS_BNC_NON_EXPORTES)).slice(1).map((r) => [r[4], r[5]]))
    expect(parCompte.get(COMPTE_NON_NOMME)).toBe('Écart de l’expert-comptable')
    expect(parCompte.get('622600')).toBe(libelleCompte('622600', []))
    expect(parCompte.get(COMPTE_D_ATTENTE)).toBe(libelleCompte(COMPTE_D_ATTENTE, []))
    // Un libellé saisi ne remplace jamais le nom que l'application connaît : seulement un numéro.
    const surUnCompteNomme: EcrituresLibresDesExports = { etat: 'lues', auteurs: AUTEURS,
      ecritures: [{ ...EL3, lignes: EL3.lignes.map((l) => ({ ...l, compte_lib: l.compte === '108000' ? 'Autre nom' : null })) }, EL4] }
    expect(libelleCompte('108000', [])).not.toBe('108000')
    expect(colonnes(fec(BROUILLON_2026, surUnCompteNomme, CHAMPS_BNC_NON_EXPORTES)).slice(1).find((r) => r[4] === '108000')![5])
      .toBe(libelleCompte('108000', []))
    expect(libellesSaisisDesComptes(LUES)).toEqual(new Map([[COMPTE_NON_NOMME, 'Écart de l’expert-comptable']]))
    expect(libellesSaisisDesComptes(ECRITURES_LIBRES_ABSENTES)).toEqual(new Map())
  })

  it('l’extourne du 1er janvier garde la pièce de son écriture, l’état de 2026, à la date de l’écriture', () => {
    const n = numeroter(EXTOURNE_2027, LUES)
    expect(n.horsFec).toEqual([])
    expect(new Set(n.lignes.map((l) => `${l.journal}|${l.numero}|${l.pieceRef}|${l.pieceDate}`))).toEqual(new Set(['OD|1|EL2026-0004|2026-12-31']))
    expect(defautsDeNumerotation(n)).toEqual([])
  })

  it('vingt-deux colonnes : sans règlement, aucun client, NatOp la nature et le poste saisi d’une ligne qui compte', () => {
    const f = fec(BROUILLON_2026, LUES, EXPORTES)
    const [entete, ...corps] = colonnes(f)
    expect(entete).toEqual([...ENTETES_FEC_BNC])
    const rangee = new Map(corps.map((r) => [r[4], r.slice(18)]))
    const poste = posteDuFormulaire('Honoraires rétrocédés', 'depense')
    expect(poste).not.toBeNull()
    expect(rangee.get('622600')).toEqual(['20261231', 'Sans règlement', `Dépense${SEPARATEUR_DU_POSTE}${poste}`, ''])
    expect(rangee.get('108000')).toEqual(['20261231', 'Sans règlement', 'Dépense', ''])
    // Hors de la 2035 : la nature seule, jamais un poste.
    expect(rangee.get(COMPTE_NON_NOMME)).toEqual(['20261231', 'Sans règlement', 'Dépense', ''])
    expect(rangee.get(COMPTE_D_ATTENTE)).toEqual(['20261231', 'Sans règlement', 'Dépense', ''])
    expect(anomaliesDgfip(f)).toEqual([])
  })

  it('le poste d’une ligne : même compte et même sens à sa date, sens inverse à son extourne ; deux postes n’en disent aucun', () => {
    expect(posteDeLaLigneLibre(EL3, { date: '2026-12-31', compte: '622600', sens: 'debit' })).toBe('Honoraires rétrocédés')
    expect(posteDeLaLigneLibre(EL3, { date: '2027-01-01', compte: '622600', sens: 'credit' })).toBe('Honoraires rétrocédés')
    expect(posteDeLaLigneLibre(EL3, { date: '2026-12-31', compte: '622600', sens: 'credit' })).toBeNull()
    const deux = { ...EL3, lignes: [...EL3.lignes, { compte: '622600', sens: 'debit' as const, centimes: 100, poste_2035: 'Achats', compte_lib: null }] }
    expect(posteDeLaLigneLibre(deux, { date: '2026-12-31', compte: '622600', sens: 'debit' })).toBeNull()
  })

  it('aucun nom de patient, jamais le motif : ni au FEC à dix-huit ou vingt-deux colonnes, ni dans la piste d’audit', () => {
    for (const champs of [CHAMPS_BNC_NON_EXPORTES, EXPORTES]) {
      const f = fec([...BROUILLON_2026, ...EXTOURNE_2027], LUES, champs)
      expect(f).not.toContain('DUPONTEL')
      expect(f).not.toContain('Marguerite')
      expect(f).not.toContain('contrat')
      expect(f).not.toContain('révision')
    }
    // La pièce citée parmi les pièces validées du dossier (`factures`), hors de celles de l'exercice : la piste la cite ici
    // par l'écriture libre seule.
    const csv = genererPisteAuditCsv(pisteAudit(BROUILLON_2026, [], [], [], { ...registre(LUES), factures: [PIECE_CITEE] }))
    expect(csv).not.toContain('DUPONTEL')
    expect(csv).not.toContain('contrat')
  })

  it('le FEC formaté d’une numérotation : celui de genererFec, la sorte comprise', () => {
    expect(formaterFec(numeroter(BROUILLON_2026, LUES, EXPORTES), new Map(), 'tresorerie')).toBe(fec(BROUILLON_2026, LUES, EXPORTES))
  })
})

const registre = (libres?: EcrituresLibresDesExports): RegistreAudit => ({
  immobilisations: [], factures: [], vehicules: [], ventes: SANS_VENTE_FACTUREE, caisse: OPERATIONS_DE_CAISSE_ABSENTES,
  plan: PLAN_PAR_DEFAUT, banques: ROLE, ...(libres === undefined ? {} : { ecrituresLibres: libres }),
})
const sansSource = (lignes: EcritureBrouillon[]) => lignes.map((l) => ({ ...l, ecriture_libre_id: null }))

describe('la piste d’audit : l’état des écritures libres pour justificatif, aucune rupture', () => {
  it('ni rupture ni absence du FEC ; sans la source, les mêmes lignes rompent et se comptent', () => {
    expect(rupturesPisteAudit(BROUILLON_2026, new Set(), PLAN_PAR_DEFAUT, ROLE)).toEqual([])
    expect(absenceFec(BROUILLON_2026, new Set())).toEqual({ nb: 0, debit: 0, credit: 0 })
    expect(rupturesPisteAudit(sansSource(BROUILLON_2026), new Set(), PLAN_PAR_DEFAUT, ROLE).map((r) => r.motif))
      .toEqual(['sans_justificatif', 'sans_justificatif', 'sans_justificatif', 'sans_justificatif'])
    expect(absenceFec(sansSource(BROUILLON_2026), new Set())).toEqual({ nb: 4, debit: 350, credit: 350 })
  })

  it('la ligne cite l’état, sa version, son auteur et son instant à Paris, et la pièce citée par son dépôt et son empreinte', () => {
    const lignes = pisteAudit(BROUILLON_2026, [PIECE_CITEE], [], [], registre(LUES))
    const b1 = lignes.find((l) => l.ecritureId === 'b1')!
    expect(b1.pieceFichier).toBe('État des écritures libres 2026 (EL2026-0003), version 2 du 05/01/2027 par expert@cabinet.test'
      + ' ; pièce citée : Pièce déposée le 20/12/2026, empreinte abcdef01')
    expect(b1.pieceEmpreinte).toBe('abcdef0123456789abcdef')
    expect(b1.pieceDate).toBe('2026-12-31')
    expect(b1.pieceTiers).toBeNull()
    expect(b1.manque).toEqual([])
    const b3 = lignes.find((l) => l.ecritureId === 'b3')!
    expect(b3.pieceFichier).toBe('État des écritures libres 2026 (EL2026-0004), version 1 du 31/12/2026 par expert@cabinet.test')
    expect(b3.pieceEmpreinte).toBeNull()
  })

  it('ce qui manque se dit : l’écriture libre hors du jeu chargé, la pièce citée hors du jeu chargé, l’auteur inconnu', () => {
    expect(pisteAudit(BROUILLON_2026, [], [], [], registre()).find((l) => l.ecritureId === 'b1')!.manque)
      .toEqual(['écriture libre hors du jeu chargé'])
    const sansPiece = pisteAudit(BROUILLON_2026, [], [], [], registre({ etat: 'lues', ecritures: [EL3, EL4], auteurs: new Map() }))
    const b1 = sansPiece.find((l) => l.ecritureId === 'b1')!
    expect(b1.manque).toEqual(['pièce citée hors du jeu chargé'])
    expect(b1.pieceFichier).toContain('par le cabinet')
  })
})

describe('le lettrage : une ligne de tiers d’une écriture libre reste non lettrée (le lettrage se déduit du rapprochement)', () => {
  it('en engagement, un 401 soldé par deux écritures libres ne reçoit aucun code', () => {
    const lignes = [
      ligne({ id: 'l1', compte: '401000', sens: 'credit', montant: 80, ecriture_libre_id: 'el-a' }),
      ligne({ id: 'l2', compte: '622600', sens: 'debit', montant: 80, ecriture_libre_id: 'el-a' }),
      ligne({ id: 'l3', date: '2027-01-01', compte: '401000', sens: 'debit', montant: 80, ecriture_libre_id: 'el-a' }),
      ligne({ id: 'l4', date: '2027-01-01', compte: '622600', sens: 'credit', montant: 80, ecriture_libre_id: 'el-a' }),
    ]
    expect(lettrages(lignes, [], [], ENGAGEMENT, { ecritures: [], factures: [], encaissements: [] })).toEqual(new Map())
  })
})

describe('l’état des écritures libres : la pièce de chaque écriture, le motif compris', () => {
  // Sans le lien de la contre-passation : l'état d'avant EL7, que ces cas gardent (le lien : etatDesEcrituresLibres.test.ts).
  const contexte = { mode: 'tresorerie' as const, auteurs: AUTEURS, pieces: new Map([[PIECE_CITEE.id, PIECE_CITEE]]), contrePassation: false }

  it('une ligne par ligne saisie, dans l’ordre des numéros ; l’effet sur la 2035 ; seulement l’exercice demandé', () => {
    const lignes = lignesDeLEtat([EL4, EL3, libre({ id: 'el-25', exercice: 2025, numero: 1, date: '2025-06-30' })], 2026, contexte)
    expect(lignes.map((l) => [l.reference, l.compte, l.debitCentimes, l.creditCentimes, l.effetSur2035])).toEqual([
      ['EL2026-0003', '622600', 30000, 0, 'Honoraires rétrocédés'],
      ['EL2026-0003', '108000', 0, 30000, '—'],
      ['EL2026-0004', COMPTE_NON_NOMME, 5000, 0, 'Hors de la 2035'],
      ['EL2026-0004', COMPTE_D_ATTENTE, 0, 5000, '—'],
    ])
    expect(lignes[0]).toMatchObject({
      motif: MOTIF, version: 2, auteur: 'expert@cabinet.test', instant: '05/01/2027 à 17:40',
      pieceCitee: 'Pièce déposée le 20/12/2026, empreinte abcdef01', pieceEmpreinte: 'abcdef0123456789abcdef',
    })
    expect(lignes[2]).toMatchObject({ extourne: true, pieceCitee: '', auteur: 'expert@cabinet.test', instant: '31/12/2026 à 11:15' })
    // Le nom du fichier et le tiers de la pièce citée ne sont jamais repris.
    expect(JSON.stringify(lignes.map(({ motif: _motif, ...reste }) => reste))).not.toContain('DUPONTEL')
  })

  it('en engagement, aucune ligne n’a d’effet sur la 2035 ; une pièce citée non lue se dit', () => {
    expect(effetDeLaLigne({ compte: '622600', poste_2035: 'Achats' }, 'engagement')).toBe('—')
    const lignes = lignesDeLEtat([EL3], 2026, { ...contexte, pieces: new Map() })
    expect(lignes[0].pieceCitee).toBe('Pièce citée hors du jeu chargé')
    expect(lignes[0].pieceEmpreinte).toBe('')
  })

  it('le CSV : BOM UTF-8, point-virgule, CRLF, chaque texte par champCsv, virgule décimale', () => {
    const ecriture = libre({ ...EL3, motif: 'Un motif ; sur\ndeux lignes, avec des "guillemets"' })
    const csv = genererEtatDesEcrituresLibresCsv(lignesDeLEtat([ecriture], 2026, contexte), false)
    expect(csv.startsWith('﻿Numéro;Date;Libellé;Motif;Compte;')).toBe(true)
    const rangs = csv.slice(1).split('\r\n')
    expect(rangs).toHaveLength(3)
    expect(rangs[1]).toBe('EL2026-0003;31/12/2026;Rétrocession de décembre;"Un motif ; sur deux lignes, avec des ""guillemets""";622600;;'
      + '300,00;;Honoraires rétrocédés;non;2;expert@cabinet.test;05/01/2027 à 17:40;Pièce déposée le 20/12/2026, empreinte abcdef01;'
      + 'abcdef0123456789abcdef')
    expect(rangs[2]).toContain(';108000;;;300,00;—;')
    expect(nomDuFichierDeLEtat(2026, 'csv')).toBe('etat-des-ecritures-libres-2026.csv')
  })

  it('le PDF : ses blocs, et les mêmes octets à chaque téléchargement', async () => {
    const lignes = lignesDeLEtat([EL3, EL4], 2026, contexte)
    const blocs = contenuDeLEtat(lignes, 2026)
    expect(blocs.map((b) => b.genre)).toEqual([
      'titre', 'intertitre', 'texte', 'texte', 'texte', 'mention', 'intertitre', 'texte', 'texte', 'texte', 'texte', 'mention',
    ])
    expect(blocs[2].texte).toBe('622600 : Débit 300,00 € — 2035 : Honoraires rétrocédés')
    expect(contenuDeLEtat([], 2026)[1].texte).toBe('Aucune écriture libre dans cet exercice.')
    const [a, b] = await Promise.all([pdfDeLEtat([EL3, EL4], 2026, contexte), pdfDeLEtat([EL3, EL4], 2026, contexte)])
    expect(new TextDecoder().decode(a.slice(0, 5))).toBe('%PDF-')
    expect(sha(new TextDecoder('latin1').decode(a))).toBe(sha(new TextDecoder('latin1').decode(b)))
  })
})

const EMPREINTE_DIX_HUIT = 'b8d1e80eb52430ffd59907b5a4b4255fc915ed6a7809354480a23d4d282008bd'
const EMPREINTE_VINGT_DEUX = '179433443b353be7d037f740a869af2d1857154db42605c197d12722b70b73ec'

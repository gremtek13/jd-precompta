import { describe, expect, it } from 'vitest'
import {
  absenceFec,
  genererPisteAuditCsv,
  nomFichierPisteAudit,
  pisteAudit,
  rupturesPisteAudit,
} from './pisteAudit'
import { genererFec } from './fec'
import { COMPTE_BANQUE } from './comptes'
import { analyserEcritures } from './ecritures'
import type { ModeleComptable } from './engagement'
import type { ANouveau, Categorie, EcritureBrouillon, LigneBancaire, Piece } from './types'

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }

const piece = (id: string, o: Partial<Piece> = {}): Piece => ({
  id, dossier_id: 'd1', nom_fichier: `${id}.pdf`, chemin_stockage: '', statut: 'validee',
  type_piece: 'achat', date_piece: '2026-03-10', montant_ht: null, montant_tva: null,
  montant_ttc: 100, tiers: null, categorie_id: 'c1', sous_dossier_id: null, notes: null,
  created_at: '2026-03-10T00:00:00Z', ...o,
} as Piece)

const ecriture = (o: Partial<EcritureBrouillon> = {}): EcritureBrouillon => ({
  id: `e-${o.compte ?? '606100'}-${o.piece_id ?? 'nulle'}`, dossier_id: 'd1', piece_id: 'p1',
  ligne_bancaire_id: null, date: '2026-03-10', libelle: 'Fournisseur', sens: 'debit',
  statut: 'proposee', compte: '606100', montant: 100, created_at: '2026-03-10T00:00:00Z', ...o,
} as EcritureBrouillon)

describe('rupturesPisteAudit', () => {
  it('signale une écriture qui ne désigne aucun justificatif', () => {
    const orpheline = ecriture({ piece_id: null, montant: 199.99 })
    const ruptures = rupturesPisteAudit([ecriture(), orpheline], new Set())
    expect(ruptures).toHaveLength(1)
    expect(ruptures[0].motif).toBe('sans_justificatif')
    expect(ruptures[0].ecriture.montant).toBe(199.99)
  })

  it("signale une contrepartie banque qui n'indique aucun mouvement", () => {
    // Ne peut venir que d'une ligne bancaire supprimée : l'insertion pose toujours le lien.
    const ruptures = rupturesPisteAudit([ecriture({ compte: COMPTE_BANQUE, ligne_bancaire_id: null })], new Set())
    expect(ruptures.map((r) => r.motif)).toEqual(['sans_mouvement'])
  })

  it('ne signale pas une contrepartie banque correctement reliée', () => {
    expect(rupturesPisteAudit([ecriture({ compte: COMPTE_BANQUE, ligne_bancaire_id: 'l1' })], new Set())).toEqual([])
  })

  it("ne signale pas une écriture de charge sans ligne bancaire — ce n'est pas une contrepartie", () => {
    // Le cas NORMAL et de loin le plus fréquent : la ligne de charge n'a jamais de lien bancaire,
    // seule la contrepartie en porte un. Confondre les deux ferait crier au loup sur tout le brouillon.
    expect(rupturesPisteAudit([ecriture({ compte: '606100', ligne_bancaire_id: null })], new Set())).toEqual([])
  })

  it('rend les DEUX ruptures quand une contrepartie a tout perdu', () => {
    const ruptures = rupturesPisteAudit([ecriture({ compte: COMPTE_BANQUE, piece_id: null, ligne_bancaire_id: null })], new Set())
    expect(ruptures.map((r) => r.motif).sort()).toEqual(['sans_justificatif', 'sans_mouvement'])
  })

  it('rend une liste vide sur un brouillon sain', () => {
    expect(rupturesPisteAudit([ecriture(), ecriture({ compte: COMPTE_BANQUE, ligne_bancaire_id: 'l1' })], new Set())).toEqual([])
  })

  // Ligne 26.6 : l'écriture d'un mouvement affecté à une catégorie n'a pas de pièce, par
  // construction — son justificatif est le relevé.
  const encaissement = [
    ecriture({ piece_id: null, ligne_bancaire_id: 'l-cpam', compte: '706000', sens: 'credit', montant: 250 }),
    ecriture({ piece_id: null, ligne_bancaire_id: 'l-cpam', compte: COMPTE_BANQUE, sens: 'debit', montant: 250 }),
  ]

  it('ne signale pas l’écriture d’un mouvement affecté : son justificatif est le relevé', () => {
    expect(rupturesPisteAudit(encaissement, new Set(['l-cpam']))).toEqual([])
    // Le garde symétrique : sans l'affectation, ce sont deux écritures sans justificatif.
    expect(rupturesPisteAudit(encaissement, new Set()).map((r) => r.motif)).toEqual(['sans_justificatif', 'sans_justificatif'])
  })

  it('redevient une rupture quand le mouvement a disparu', () => {
    // `ecritures_brouillon.ligne_bancaire_id` est en `ON DELETE SET NULL` : un relevé retiré laisse
    // l'écriture sans rien derrière.
    const perdue = encaissement.map((e) => ({ ...e, ligne_bancaire_id: null }))
    expect(rupturesPisteAudit(perdue, new Set(['l-cpam'])).map((r) => r.motif).sort())
      .toEqual(['sans_justificatif', 'sans_justificatif', 'sans_mouvement'])
  })
})

describe("l'angle mort que ce module ferme", () => {
  // Le cœur du chantier : cette écriture existe, pèse 199,99 € et n'est vue par rien.
  const orpheline = ecriture({ piece_id: null, montant: 199.99, compte: '606100' })
  const saine = ecriture({ piece_id: 'p1', montant: 100 })

  it('est invisible aux trois contrôles de analyserEcritures', () => {
    const { nbSansContrepartie, groupesDesequilibres, piecesDesynchronisees } =
      analyserEcritures([orpheline], [], true, new Map(), TRESORERIE)
    expect(nbSansContrepartie).toBe(0)
    expect(groupesDesequilibres).toEqual([])
    expect(piecesDesynchronisees).toEqual([])
  })

  it('est absente du FEC', () => {
    const categories: Categorie[] = []
    const lignes = genererFec([orpheline, saine], [piece('p1')], categories, [], 'tresorerie', []).split('\r\n').filter(Boolean)
    // En-tête + la seule écriture justifiée : l'orpheline n'y est pas.
    expect(lignes).toHaveLength(2)
    expect(lignes.join('\n')).not.toContain('199,99')
  })

  it('mais pèse dans les totaux — et absenceFec chiffre exactement ce que le FEC ne dira pas', () => {
    expect(absenceFec([orpheline, saine], new Set())).toEqual({ nb: 1, debit: 199.99, credit: 0 })
  })
})

describe('absenceFec', () => {
  it('sépare le débit du crédit', () => {
    const r = absenceFec([
      ecriture({ piece_id: null, montant: 10, sens: 'debit' }),
      ecriture({ piece_id: null, montant: 4, sens: 'credit' }),
      ecriture({ piece_id: 'p1', montant: 999, sens: 'debit' }),
    ], new Set())
    expect(r).toEqual({ nb: 2, debit: 10, credit: 4 })
  })

  it('rend des zéros sur un brouillon sain', () => {
    expect(absenceFec([ecriture(), ecriture({ compte: COMPTE_BANQUE, ligne_bancaire_id: 'l1' })], new Set()))
      .toEqual({ nb: 0, debit: 0, credit: 0 })
  })

  it('ne compte pas l’écriture d’un mouvement affecté : le FEC la porte au journal de banque', () => {
    const frais = [
      ecriture({ piece_id: null, ligne_bancaire_id: 'l-frais', compte: '627000', sens: 'debit', montant: 8.5 }),
      ecriture({ piece_id: null, ligne_bancaire_id: 'l-frais', compte: COMPTE_BANQUE, sens: 'credit', montant: 8.5 }),
    ]
    expect(absenceFec(frais, new Set(['l-frais']))).toEqual({ nb: 0, debit: 0, credit: 0 })
    expect(absenceFec(frais, new Set())).toEqual({ nb: 2, debit: 8.5, credit: 8.5 })
  })
})

const ligneBancaire = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id: 'l1', dossier_id: 'd1', date: '2026-03-12', libelle: 'PRLV SEPA TRANSMEDICAL',
  montant: -100, statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, categorie_id: null, taux_tva: null,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, id_externe: null,
  prelevement_personnel: false, source_fichier: null, libelle_brut: null,
  created_at: '2026-03-12T00:00:00Z', ...o,
})

describe('pisteAudit — la chaîne complète, dans les deux sens', () => {
  it("remonte de l'écriture au justificatif puis à l'opération réelle", () => {
    const lignes = pisteAudit(
      [ecriture({ compte: COMPTE_BANQUE, piece_id: 'p1', ligne_bancaire_id: 'l1', sens: 'credit' })],
      [piece('p1', { tiers: 'Transmedical', storage_hash: 'abc123', montant_ttc: 100 })],
      [ligneBancaire()],
      [],
    )
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({
      compte: COMPTE_BANQUE, debit: 0, credit: 100,
      pieceTiers: 'Transmedical', pieceMontantTtc: 100, pieceEmpreinte: 'abc123',
      mouvementDate: '2026-03-12', mouvementLibelle: 'PRLV SEPA TRANSMEDICAL', mouvementMontant: -100,
      manque: [],
    })
  })

  it("nomme ce qui manque plutôt que de laisser des colonnes vides s'expliquer toutes seules", () => {
    const lignes = pisteAudit([ecriture({ piece_id: null, montant: 199.99 })], [], [], [])
    expect(lignes[0].manque).toEqual(['justificatif'])
    expect(lignes[0].debit).toBe(199.99)
    expect(lignes[0].pieceEmpreinte).toBeNull()
  })

  it('distingue « le lien est nul » de « la pièce est hors du jeu chargé »', () => {
    // La seconde n'est PAS une rupture comptable : c'est un filtre de l'appelant (EcrituresTab ne
    // charge que les pièces validées). Les confondre ferait passer un artefact de chargement pour
    // une charge sans justificatif — l'erreur qui rend un avertissement inécoutable.
    const lignes = pisteAudit([ecriture({ piece_id: 'p-absente' })], [], [], [])
    expect(lignes[0].manque).toEqual(['justificatif hors du jeu chargé'])
  })

  it("signale la contrepartie banque dont le mouvement a disparu, sans toucher aux lignes de charge", () => {
    const lignes = pisteAudit(
      [
        ecriture({ compte: COMPTE_BANQUE, ligne_bancaire_id: null }),
        ecriture({ compte: '606100', ligne_bancaire_id: null }),
      ],
      [piece('p1')],
      [],
      [],
    )
    const parCompte = new Map(lignes.map((l) => [l.compte, l.manque]))
    expect(parCompte.get(COMPTE_BANQUE)).toEqual(['mouvement bancaire'])
    expect(parCompte.get('606100')).toEqual([])
  })

  it("dit quand le mouvement désigné est hors du jeu chargé, plutôt que trois colonnes vides", () => {
    // Ne peut pas venir d'une suppression (ON DELETE SET NULL tomberait dans « mouvement bancaire »)
    // mais seulement d'un jeu restreint par l'appelant — et une colonne vide muette se lit comme une
    // absence de preuve.
    const lignes = pisteAudit([ecriture({ compte: COMPTE_BANQUE, ligne_bancaire_id: 'l-absente' })], [piece('p1')], [], [])
    expect(lignes[0].manque).toEqual(['mouvement hors du jeu chargé'])
    expect(lignes[0].mouvementMontant).toBeNull()
  })

  it("cumule les deux manques sur une contrepartie qui a tout perdu", () => {
    const lignes = pisteAudit(
      [ecriture({ compte: COMPTE_BANQUE, piece_id: null, ligne_bancaire_id: null })], [], [], [])
    expect(lignes[0].manque).toEqual(['justificatif', 'mouvement bancaire'])
  })

  it("descend dans l'autre sens : un justificatif validé que rien ne comptabilise", () => {
    const lignes = pisteAudit([], [piece('p9', { tiers: 'Boulanger', montant_ttc: 199.99 })], [], [])
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({
      ecritureId: null, compte: '', debit: 0, credit: 0,
      pieceId: 'p9', pieceMontantTtc: 199.99, manque: ['écriture'],
    })
  })

  it("nomme la date manquante d'une pièce non comptabilisée — elle n'est d'aucun exercice", () => {
    // Elle apparaîtra dans l'export de chaque exercice ; sans cette mention, sa présence se lirait
    // comme « elle est de cette année-là ».
    const lignes = pisteAudit([], [piece('p9', { date_piece: null })], [], [])
    expect(lignes[0].manque).toEqual(['écriture', 'date'])
    expect(lignes[0].date).toBe('')
  })

  it("ne redouble pas une pièce déjà citée par une écriture", () => {
    const lignes = pisteAudit([ecriture({ piece_id: 'p1' })], [piece('p1')], [], [])
    expect(lignes).toHaveLength(1)
    expect(lignes[0].manque).toEqual([])
  })

  it('retombe sur le nom du fichier quand la pièce non comptabilisée n\'a pas de tiers', () => {
    // Une ligne de piste sans libellé ne désigne rien ; le nom du fichier est le dernier repère.
    const lignes = pisteAudit([], [piece('p9', { tiers: null })], [], [])
    expect(lignes[0].libelle).toBe('p9.pdf')
  })

  it('montre une empreinte absente comme absente, sans fabriquer une preuve', () => {
    // storage_hash est nul sur les pièces déposées avant l'introduction du champ. Afficher le nom
    // du fichier à la place laisserait croire à une preuve d'intégrité qui n'existe pas.
    const lignes = pisteAudit([ecriture({ piece_id: 'p1' })], [piece('p1', { storage_hash: null })], [], [])
    expect(lignes[0].pieceEmpreinte).toBeNull()
    expect(lignes[0].pieceFichier).toBe('p1.pdf')
  })
})

describe('pisteAudit — un mouvement affecté sans justificatif', () => {
  const affecte = ligneBancaire({
    id: 'l-cpam', piece_id: null, categorie_id: 'c-recettes', montant: 250, libelle: 'VIR CPAM',
    source_fichier: 'releve-mars-2026.pdf',
  })
  const ecritures = [
    ecriture({ id: 'e1', piece_id: null, ligne_bancaire_id: 'l-cpam', compte: '706000', sens: 'credit', montant: 250, date: '2026-03-12' }),
    ecriture({ id: 'e2', piece_id: null, ligne_bancaire_id: 'l-cpam', compte: COMPTE_BANQUE, sens: 'debit', montant: 250, date: '2026-03-12' }),
  ]

  it('donne le relevé pour justificatif, sans rien déclarer manquant', () => {
    const lignes = pisteAudit(ecritures, [], [affecte], [])
    expect(lignes.map((l) => [l.ecritureId, l.pieceFichier, l.pieceDate, l.mouvementLibelle, l.manque])).toEqual([
      ['e2', 'Relevé bancaire : releve-mars-2026.pdf', '2026-03-12', 'VIR CPAM', []],
      ['e1', 'Relevé bancaire : releve-mars-2026.pdf', '2026-03-12', 'VIR CPAM', []],
    ])
    // Pas d'empreinte : le mouvement n'est relié qu'au NOM du fichier importé.
    expect(lignes.every((l) => l.pieceEmpreinte === null)).toBe(true)
  })

  it('dit « Relevé bancaire » quand l’import n’a pas gardé le nom du fichier', () => {
    const [ligne] = pisteAudit(ecritures.slice(0, 1), [], [{ ...affecte, source_fichier: null }], [])
    expect(ligne.pieceFichier).toBe('Relevé bancaire')
  })

  it('déclare le justificatif manquant quand le mouvement n’est plus affecté', () => {
    const [ligne] = pisteAudit(ecritures.slice(0, 1), [], [{ ...affecte, categorie_id: null, statut: 'non_rapprochee' }], [])
    expect(ligne.manque).toEqual(['justificatif'])
    expect(ligne.pieceFichier).toBeNull()
  })

  it('donne aussi le relevé pour justificatif à un virement personnel', () => {
    // lib/virementPersonnel.ts : le prélèvement de l'exploitant s'écrit sur son compte, sans pièce.
    const perso = ligneBancaire({
      id: 'l-perso', piece_id: null, categorie_id: null, statut: 'ignoree', prelevement_personnel: true,
      montant: -500, libelle: 'VIR PERSO', source_fichier: 'releve-mars-2026.pdf',
    })
    const [ligne] = pisteAudit(
      [ecriture({ id: 'v1', piece_id: null, ligne_bancaire_id: 'l-perso', compte: '108000', montant: 500, date: '2026-03-12' })],
      [], [perso], [],
    )
    expect([ligne.pieceFichier, ligne.mouvementLibelle, ligne.manque]).toEqual(['Relevé bancaire : releve-mars-2026.pdf', 'VIR PERSO', []])
    // Remis à traiter, il n'a plus de justificatif.
    const [remis] = pisteAudit(
      [ecriture({ id: 'v1', piece_id: null, ligne_bancaire_id: 'l-perso', compte: '108000', montant: 500, date: '2026-03-12' })],
      [], [{ ...perso, statut: 'non_rapprochee', prelevement_personnel: false }], [],
    )
    expect(remis.manque).toEqual(['justificatif'])
  })

  it('donne aussi le relevé pour justificatif à une échéance d’emprunt', () => {
    // lib/echeanceEmprunt.ts : le prélèvement d'un prêt s'écrit sur le 164, le 661 et le 616, sans pièce.
    const pret = ligneBancaire({
      id: 'l-pret', piece_id: null, categorie_id: null, montant: -540, libelle: 'ECHEANCE PRET',
      source_fichier: 'releve-mars-2026.pdf', emprunt_id: 'emp1', emprunt_echeance: 2, emprunt_interets: 36, emprunt_assurance: 0,
    })
    const interets = [ecriture({ id: 'i1', piece_id: null, ligne_bancaire_id: 'l-pret', compte: '661100', montant: 36, date: '2026-03-06' })]
    const [ligne] = pisteAudit(interets, [], [pret], [])
    expect([ligne.pieceFichier, ligne.mouvementLibelle, ligne.manque]).toEqual(['Relevé bancaire : releve-mars-2026.pdf', 'ECHEANCE PRET', []])
    // Le rapprochement retiré, elle n'a plus de justificatif.
    const [retire] = pisteAudit(interets, [], [{ ...pret, statut: 'non_rapprochee', emprunt_id: null }], [])
    expect(retire.manque).toEqual(['justificatif'])
  })

  it('donne aussi le relevé pour justificatif à une échéance de cotisation', () => {
    // lib/cotisationRapprochee.ts : le prélèvement de l'Urssaf s'écrit sur le 646000 et le 108000, sans pièce.
    const urssaf = ligneBancaire({
      id: 'l-urssaf', piece_id: null, categorie_id: null, cotisation_id: 'c1', montant: -500, libelle: 'PRLV URSSAF',
      source_fichier: 'releve-mars-2026.pdf',
    })
    const cotisation = [ecriture({ id: 'u1', piece_id: null, ligne_bancaire_id: 'l-urssaf', compte: '646000', montant: 500, date: '2026-03-05' })]
    const [ligne] = pisteAudit(cotisation, [], [urssaf], [])
    expect([ligne.pieceFichier, ligne.pieceDate, ligne.mouvementLibelle, ligne.manque])
      .toEqual(['Relevé bancaire : releve-mars-2026.pdf', urssaf.date, 'PRLV URSSAF', []])
    // Le rapprochement annulé, elle n'a plus de justificatif.
    const [annule] = pisteAudit(cotisation, [], [{ ...urssaf, statut: 'non_rapprochee', cotisation_id: null }], [])
    expect(annule.manque).toEqual(['justificatif'])
  })

  it('donne aussi le relevé pour justificatif à un mouvement ventilé', () => {
    // lib/ventilationBanque.ts : une ligne par part, sans pièce.
    const telephone = ligneBancaire({
      id: 'l-tel', piece_id: null, categorie_id: null, montant: -120, libelle: 'PRLV OPERATEUR',
      source_fichier: 'releve-mars-2026.pdf', ventilee: true, id_externe: null,
    })
    const part = [ecriture({ id: 't1', piece_id: null, ligne_bancaire_id: 'l-tel', compte: '626000', montant: 84, date: '2026-03-15' })]
    const [ligne] = pisteAudit(part, [], [telephone], [])
    expect([ligne.pieceFichier, ligne.mouvementLibelle, ligne.manque]).toEqual(['Relevé bancaire : releve-mars-2026.pdf', 'PRLV OPERATEUR', []])
    // La ventilation annulée, elle n'a plus de justificatif.
    const [annule] = pisteAudit(part, [], [{ ...telephone, statut: 'non_rapprochee', ventilee: false, reglement_groupe: false, id_externe: null }], [])
    expect(annule.manque).toEqual(['justificatif'])
  })
})

describe('pisteAudit — un ordre chronologique, et le même à chaque export', () => {
  it('classe par date', () => {
    const lignes = pisteAudit(
      [
        ecriture({ id: 'e-mars', date: '2026-03-10' }),
        ecriture({ id: 'e-janv', date: '2026-01-05' }),
        ecriture({ id: 'e-fevr', date: '2026-02-20' }),
      ],
      [piece('p1')], [],
      [],
    )
    expect(lignes.map((l) => l.date)).toEqual(['2026-01-05', '2026-02-20', '2026-03-10'])
  })

  it('remonte les lignes sans date EN TÊTE, jamais noyées au milieu', () => {
    // Une pièce validée dont la date n'a pas été lue est exactement ce qu'il faut voir en premier :
    // elle n'appartient à aucun mois, donc à aucun exercice, et personne ne la cherchera au milieu.
    const lignes = pisteAudit([], [piece('p1', { date_piece: '2026-06-01' }), piece('p2', { date_piece: null })], [], [])
    expect(lignes.map((l) => l.pieceId)).toEqual(['p2', 'p1'])
  })

  it('départage à date égale, pour que deux exports du même brouillon soient identiques', () => {
    // L'ordre de retour d'une requête Postgres n'est pas garanti : sans ce départage, deux exports
    // du même brouillon différeraient, et un vérificateur ne pourrait pas les comparer.
    const a = ecriture({ id: 'e-b', compte: '606100' })
    const b = ecriture({ id: 'e-a', compte: '606100' })
    const c = ecriture({ id: 'e-c', compte: '401000' })
    expect(pisteAudit([a, b, c], [piece('p1')], [], []).map((l) => l.ecritureId))
      .toEqual(pisteAudit([c, a, b], [piece('p1')], [], []).map((l) => l.ecritureId))
    expect(pisteAudit([a, b, c], [piece('p1')], [], []).map((l) => l.ecritureId)).toEqual(['e-c', 'e-a', 'e-b'])
  })
})

describe('pisteAudit — les à-nouveaux', () => {
  const aNouveau = (o: Partial<ANouveau> = {}): ANouveau => ({
    id: 'an-1', dossier_id: 'd1', date: '2026-01-01', compte: COMPTE_BANQUE, compte_origine: '51210000',
    libelle: 'Banque Populaire', sens: 'debit', montant: 6000, source_nom: 'balance-2025.csv',
    source_empreinte: 'f'.repeat(64), created_at: '2026-09-26T10:00:00Z', ...o,
  })

  it('les justifie par la balance reprise et son empreinte, sans rien déclarer manquant', () => {
    const [ligne] = pisteAudit([], [], [], [aNouveau()])
    expect(ligne).toMatchObject({
      ecritureId: 'an-1', date: '2026-01-01', compte: COMPTE_BANQUE,
      libelle: 'À-nouveau 51210000 Banque Populaire', debit: 6000, credit: 0,
      pieceFichier: 'balance-2025.csv', pieceEmpreinte: 'f'.repeat(64), manque: [],
    })
  })

  it('les range dans l’ordre chronologique, avec les écritures', () => {
    const lignes = pisteAudit(
      [ecriture({ id: 'e-mars', date: '2026-03-10', piece_id: 'p1' })],
      [piece('p1')], [],
      [aNouveau({ id: 'an-2', compte: '108', compte_origine: '108', sens: 'credit' }), aNouveau()],
    )
    expect(lignes.map((l) => l.ecritureId)).toEqual(['an-2', 'an-1', 'e-mars'])
  })
})

describe('genererPisteAuditCsv', () => {
  const uneLigne = () =>
    pisteAudit(
      [ecriture({ compte: COMPTE_BANQUE, piece_id: 'p1', ligne_bancaire_id: 'l1', montant: 1234.5 })],
      [piece('p1', { tiers: 'Transmedical', montant_ttc: 1234.5, storage_hash: 'abc' })],
      [ligneBancaire({ montant: -1234.5 })],
      [],
    )

  it('écrit un en-tête et une ligne par ligne de piste', () => {
    const csv = genererPisteAuditCsv(uneLigne())
    const lignes = csv.replace(/^\uFEFF/, '').split('\r\n')
    expect(lignes).toHaveLength(2)
    expect(lignes[0].split(';')[0]).toBe('Date')
    expect(lignes[0]).toContain('Empreinte SHA-256')
  })

  it("commence par un BOM UTF-8, sans quoi Excel en français casse tous les accents", () => {
    // « Libellé » ouvert en CP1252 devient « LibellÃ© ». Sur un fichier qu'un vérificateur va relire,
    // un accent cassé à chaque ligne jette le doute sur tout le reste.
    expect(genererPisteAuditCsv(uneLigne()).startsWith('\uFEFF')).toBe(true)
  })

  it('formate les montants à la française — virgule décimale, deux décimales', () => {
    const csv = genererPisteAuditCsv(uneLigne())
    expect(csv).toContain('1234,50')
    expect(csv).not.toContain('1234.5')
  })

  it('laisse une colonne vide plutôt que d\'écrire un zéro qui serait faux', () => {
    // Un montant de pièce absent n'est pas un montant nul : 0,00 se lirait comme « facture gratuite ».
    const csv = genererPisteAuditCsv(pisteAudit([ecriture({ piece_id: null })], [], [], []))
    const champs = csv.split('\r\n')[1].split(';')
    expect(champs[7]).toBe('')
  })

  it('neutralise ce qui casserait la structure du fichier', () => {
    // Même piège que le FEC : un libellé OCR porte des sauts de ligne et des guillemets, et un
    // point-virgule non protégé décale toutes les colonnes suivantes sans que rien ne le signale.
    const csv = genererPisteAuditCsv(
      pisteAudit([ecriture({ piece_id: null, libelle: 'ACHAT ; "urgent"\nsuite du libellé' })], [], [], []))
    expect(csv.split('\r\n')).toHaveLength(2)
    expect(csv).toContain('"ACHAT ; ""urgent"" suite du libellé"')
  })

  it('garde exactement autant de colonnes sur chaque ligne que dans l\'en-tête', () => {
    // L'invariant qui compte : un tableur doit aligner les colonnes, sinon l'empreinte d'une ligne
    // se lit sous « Date mouvement » de la suivante.
    const csv = genererPisteAuditCsv([
      ...uneLigne(),
      ...pisteAudit([ecriture({ piece_id: null, libelle: 'a;b' })], [piece('p1', { tiers: 'X"Y' })], [], []),
    ])
    const lignes = csv.replace(/^\uFEFF/, '').split('\r\n')
    const nbColonnes = (l: string) => decouperCsv(l).length
    expect(lignes.map(nbColonnes)).toEqual(lignes.map(() => nbColonnes(lignes[0])))
    expect(nbColonnes(lignes[0])).toBe(14)
  })
})

// Découpage CSV minimal respectant les guillemets — pour vérifier l'alignement des colonnes sans
// faire confiance au même `split(';')` que celui qu'on cherche à mettre en défaut.
function decouperCsv(ligne: string): string[] {
  const champs: string[] = []
  let courant = ''
  let dansGuillemets = false
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i]
    if (c === '"') {
      if (dansGuillemets && ligne[i + 1] === '"') { courant += '"'; i++ } else dansGuillemets = !dansGuillemets
    } else if (c === ';' && !dansGuillemets) { champs.push(courant); courant = '' } else courant += c
  }
  champs.push(courant)
  return champs
}

describe('nomFichierPisteAudit', () => {
  it("porte le dossier et l'exercice, sans caractère qu'un système de fichiers refuserait", () => {
    expect(nomFichierPisteAudit('Café Martin / SELARL', 2026)).toBe('piste-audit-caf-martin-selarl-2026.csv')
  })

  it('ne laisse ni tiret de tête ni tiret de queue', () => {
    expect(nomFichierPisteAudit('  Dupont  ', 2025)).toBe('piste-audit-dupont-2025.csv')
  })
})

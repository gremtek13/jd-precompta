import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { entierTire, tirage } from '../test/encaissementsBatterie'
import { POSTES_RATTACHES, posteRattache } from './cases2035'
import * as champs from './champsBncDuFec'
import {
  LIENS_DU_RELEVE, MODE_DU_MOYEN, MODES_REGLEMENT, NATURES_OPERATION, REGLES_DES_SORTES, SANS_REGLEMENT, SEPARATEUR_DU_POSTE,
  champsDeLaTvaDUneFacture, champsDesANouveaux, champsDUnEncaissement, champsDUneDotation, champsDUneLiquidation,
  champsDUnForfait, champsDUnMouvementDesEncaissements, champsDUnMouvementDuReleve, champsDUneOperationDeCaisse,
  champsDUnePiece, champsDUnPaiementPersonnel, identificationDuClient, natOpDeLaLigne, reglementsDeLaPieceALaDate,
  type ChampsBnc, type ChoixChampsBnc, type EncaissementDuRegistre, type FactureDuClient, type LigneACaracteriser,
  type MouvementDuFec, type PieceDuFec, type PosteLu, type ReglementDUnePiece,
} from './champsBncDuFec'
import {
  POSTE_AMORTISSEMENTS, POSTE_ARRONDIS_TVA_CHARGE, POSTE_COTISATIONS, POSTE_INDEMNITES_KM, POSTE_VENTES_FACTUREES,
} from './declaration2035'
import { POSTE_INTERETS_EMPRUNT } from './echeanceEmprunt'
import type { MoyenEncaissement, OperationCaisse } from './types'
import type { PaiementDePiece } from './rattachement'

// LES QUATRE CHAMPS DU FEC D'UN BNC EN TRÉSORERIE (lot FEC22a) : un cas par sorte d'écriture de la table « CE QUE CHAQUE
// ÉCRITURE PORTE » de la conception, positif et négatif ; le scanner qui part de toutes les sortes que `numeroterFec`
// distingue ; « aucun nom », sur une batterie tirée ; le choix de FEC22-Q1 dans ses deux états ; IdClient. Toutes les
// données sont FICTIVES : les noms plantés n'appartiennent à personne, les SIREN et SIRET sont fabriqués pour passer (ou
// non) la clé de Luhn.

const RACINE = new URL('../../', import.meta.url)
const lire = (chemin: string) => readFileSync(new URL(chemin, RACINE), 'utf8')

// ── Les noms plantés, que rien ne doit rendre ──
const NOMS = [
  'Zéphyrin Fictif-Dupré', 'Cabinet Imaginaire Oxalis', 'Mme Ondine Inventée', 'patient-ficelle-0427', 'Kinésithérapie Brumaire',
  'VIR SEPA ZEPHYRIN FICTIF', 'CHQ 4711 ONDINE', 'releve-imaginaire-mars.csv', 'ordonnance-ondine.pdf', 'Motif : Ondine a payé deux fois',
] as const

// ── Des SIREN et SIRET FICTIFS ──
const SIREN_VALIDE = '123456782'
const SIRET_VALIDE = '12345678200010'
// La clé du SIRET passe, pas celle de son SIREN : un numéro qui ne désigne aucune entreprise.
const SIRET_AU_SIREN_INVALIDE = '98765432000017'
const SIRET_INVALIDE = '12345678200011'

// ── Les fabriques, typées Partial<T> => T ──
// Le nom du client et le motif d'un encaissement ne sont pas dans les types que le module lit : on les plante à côté,
// comme une lecture trop large les rendrait, et aucun ne doit sortir.
type FactureLueEnTrop = FactureDuClient & { tiers_nom: string | null }
type EncaissementLuEnTrop = EncaissementDuRegistre & { motif: string | null }
const facture = (f: Partial<FactureLueEnTrop>): FactureLueEnTrop => ({
  id: 'facture-1', numero: 'F2026-0007', statut: 'validee', tiers_siret: null, tiers_nom: NOMS[0], source_de_la_vente: true, ...f,
})
const encaissement = (e: Partial<EncaissementLuEnTrop>): EncaissementLuEnTrop => ({
  id: 'enc-1', dossier_id: 'dossier-1', facture_id: 'facture-1', date_encaissement: '2026-04-10', montant: 100, moyen: 'virement',
  ligne_bancaire_id: null, annule_id: null, retire_le: null, motif: NOMS[9], ...e,
})
const piece = (p: Partial<PieceDuFec>): PieceDuFec => ({
  id: 'piece-1', type_piece: 'achat', facture_id: null, date_piece: '2026-03-02', montant_ttc: 120, created_at: '2026-03-05T10:00:00Z',
  tiers: NOMS[1], nom_fichier: NOMS[8], ...p,
})
const mouvement = (m: Partial<MouvementDuFec>): MouvementDuFec => ({
  id: 'mvt-1', date: '2026-05-12', montant: -45.5, libelle: NOMS[5], libelle_brut: NOMS[6], source_fichier: NOMS[7],
  statut: 'rapprochee', categorie_id: null, emprunt_id: null, emprunt_echeance: null, cotisation_id: null, ventilee: false,
  compte_bilan: null, declaration_tva_id: null, prelevement_personnel: false, ...m,
})
const paiement = (p: Partial<PaiementDePiece>): PaiementDePiece => ({ id: 'mvt-1', date: '2026-03-20', montant: -120, origine: 'rapprochement', ...p })
const categorie = (poste: string | null, libelle: string): PosteLu => ({ de: 'categorie', categorie: { libelle, poste_2035: poste } })
const ligne = (id: string, compte: string, poste: PosteLu): LigneACaracteriser => ({ id, compte, libelle: NOMS[2], poste })
const AUCUN: PosteLu = { de: 'aucun' }
const VIDES: ChoixChampsBnc = { sansReglement: 'vides' }
const DATE_ECRITURE: ChoixChampsBnc = { sansReglement: 'date_de_l_ecriture' }
const MOYENS: MoyenEncaissement[] = ['virement', 'cheque', 'carte', 'prelevement', 'especes', 'effet', 'compensation', 'autre']

// Les quatre valeurs d'une écriture, telles que le fichier les écrira, NatOp ligne par ligne.
const valeurs = (c: ChampsBnc) => [c.dateRglt, c.modeRglt, c.idClient, ...c.natOp.values()]

describe('les listes fermées', () => {
  it('chaque moyen du registre a son mode, dans la liste des modes ; les listes sont sans doublon', () => {
    expect(Object.keys(MODE_DU_MOYEN).sort()).toEqual([...MOYENS].sort())
    for (const m of MOYENS) expect(MODES_REGLEMENT).toContain(MODE_DU_MOYEN[m])
    expect(new Set(MODES_REGLEMENT).size).toBe(MODES_REGLEMENT.length)
    expect(new Set(NATURES_OPERATION).size).toBe(NATURES_OPERATION.length)
    expect(SANS_REGLEMENT).toEqual(['vides', 'date_de_l_ecriture'])
  })

  it('le moyen se traduit en toutes lettres, jamais recopié', () => {
    expect(MODE_DU_MOYEN.cheque).toBe('Chèque')
    expect(MODE_DU_MOYEN.carte).toBe('Carte bancaire')
    expect(MODE_DU_MOYEN.especes).toBe('Espèces')
  })
})

describe('NatOp : la nature, et le poste de la 2035 sur une ligne de charge ou de produit (FEC22-Q3, (C))', () => {
  it('écrit le poste de la catégorie, jamais son libellé', () => {
    // Le libellé de la catégorie est un poste connu : le lire écrirait « Dépense — Achats ».
    expect(natOpDeLaLigne('Dépense', ligne('l', '606400', categorie('Fournitures de bureau', 'Achats')))).toBe('Dépense — Fournitures de bureau')
    expect(natOpDeLaLigne('Dépense', ligne('l', '606400', categorie(null, 'Achats')))).toBe('Dépense')
    expect(natOpDeLaLigne('Dépense', ligne('l', '606400', categorie(null, NOMS[4])))).toBe('Dépense')
  })

  it("écrit le poste sous l'orthographe du rattachement, pas sous celle qu'a tapée le cabinet", () => {
    expect(natOpDeLaLigne('Dépense', ligne('l', '607000', categorie('  ACHATS ', 'x')))).toBe('Dépense — Achats')
    // L'apostrophe typographique et la droite ont la même clé : l'orthographe du code l'emporte.
    expect(posteRattache('primes d’assurance', 'depense')).toBe("Primes d'assurance")
    expect(posteRattache("primes d'assurances", 'depense')).toBe("Primes d'assurances")
  })

  it('un poste inconnu, ou de l’autre cadre, laisse la nature seule — comme la 2035 le dit « sans case »', () => {
    expect(natOpDeLaLigne('Dépense', ligne('l', '606400', categorie('Ma rubrique', 'x')))).toBe('Dépense')
    expect(natOpDeLaLigne('Dépense', ligne('l', '606400', categorie(NOMS[0], 'x')))).toBe('Dépense')
    // Une recette (classe 7) sous un poste de dépenses : aucun poste.
    expect(natOpDeLaLigne('Recette', ligne('l', '706000', categorie('Achats', 'x')))).toBe('Recette')
    expect(natOpDeLaLigne('Recette', ligne('l', '706000', categorie('Recettes', 'x')))).toBe('Recette — Recettes')
    expect(natOpDeLaLigne('Recette', ligne('l', '706000', { de: 'categorie', categorie: null }))).toBe('Recette')
  })

  it('une ligne de bilan, de banque ou de TVA porte la nature seule, même avec une catégorie', () => {
    for (const compte of ['512000', '445660', '108000', '411000', '218300']) {
      expect(natOpDeLaLigne('Dépense', ligne('l', compte, categorie('Achats', 'Achats')))).toBe('Dépense')
    }
  })

  it('un poste du moteur se lit comme celui d’une catégorie', () => {
    expect(natOpDeLaLigne('Dotation aux amortissements', ligne('l', '681100', { de: 'moteur', poste: POSTE_AMORTISSEMENTS })))
      .toBe('Dotation aux amortissements — Amortissements')
    expect(natOpDeLaLigne('Recette', ligne('l', '706000', { de: 'moteur', poste: POSTE_VENTES_FACTUREES })))
      .toBe(`Recette — ${POSTE_VENTES_FACTUREES}`)
  })
})

describe('IdClient (FEC22-Q4, (D)) : le SIREN d’une entreprise, sinon le numéro de la facture, jamais le nom', () => {
  it('un SIRET valide donne son SIREN', () => {
    expect(identificationDuClient(facture({ tiers_siret: SIRET_VALIDE }))).toBe(SIREN_VALIDE)
    expect(identificationDuClient(facture({ tiers_siret: SIREN_VALIDE }))).toBe(SIREN_VALIDE)
  })

  it('un SIRET invalide, absent, avec des lettres ou des espaces donne le numéro de la facture', () => {
    for (const s of [SIRET_INVALIDE, SIRET_AU_SIREN_INVALIDE, null, '', '1234567820001A', '123 456 782 00010', 'Zéphyrin Fictif',
      '1234567820001', '123456783']) {
      expect(identificationDuClient(facture({ tiers_siret: s }))).toBe('F2026-0007')
    }
  })

  it('une facture qui n’est pas figée n’identifie personne', () => {
    expect(identificationDuClient(facture({ statut: 'brouillon', numero: null, tiers_siret: SIRET_VALIDE }))).toBe('')
    expect(identificationDuClient(facture({ numero: null, tiers_siret: SIRET_VALIDE }))).toBe('')
    // Défensif : un brouillon qui porterait un numéro, un numéro vide, ne sont pas une facture figée.
    expect(identificationDuClient(facture({ statut: 'brouillon', tiers_siret: SIRET_VALIDE }))).toBe('')
    expect(identificationDuClient(facture({ numero: '', tiers_siret: null }))).toBe('')
  })

  it('le nom du client ne paraît jamais, même quand il ressemble à un numéro', () => {
    expect(identificationDuClient(facture({ tiers_nom: SIREN_VALIDE, tiers_siret: null }))).toBe('F2026-0007')
  })
})

describe('une pièce', () => {
  const lignesAchat = [ligne('charge', '606400', categorie('Fournitures de bureau', NOMS[4])), ligne('banque', '512000', AUCUN)]
  const base = (r: ReglementDUnePiece, p: PieceDuFec, exemplaireDe: FactureDuClient | null) => champsDUnePiece({
    piece: p, reglement: r, dateDeLEcriture: '2027-01-01', cible: { immobilisation: false }, exemplaireDe, lignes: lignesAchat, choix: VIDES,
  })

  it('payée par le relevé : la date du PAIEMENT (jamais celle de l’écriture), « Banque », « Dépense », aucun client', () => {
    // L'opération découverte après coup (B9) : écrite au 1er janvier N+1, réglée en N.
    const c = base({ par: 'releve', date: '2026-12-18' }, piece({}), null)
    expect(c).toMatchObject({ dateRglt: '2026-12-18', modeRglt: 'Banque', nature: 'Dépense', idClient: '' })
    expect(c.natOp).toEqual(new Map([['charge', 'Dépense — Fournitures de bureau'], ['banque', 'Dépense']]))
  })

  it('une pièce de vente est une recette ; un bien, une acquisition d’immobilisation', () => {
    expect(base({ par: 'releve', date: '2026-03-20' }, piece({ type_piece: 'vente' }), null).nature).toBe('Recette')
    const bien = champsDUnePiece({
      piece: piece({}), reglement: { par: 'releve', date: '2026-03-20' }, dateDeLEcriture: '2026-03-20', cible: { immobilisation: true },
      exemplaireDe: null, lignes: [ligne('bien', '218300', categorie('Achats', 'x')), ligne('b', '512000', AUCUN)], choix: VIDES,
    })
    expect(bien.nature).toBe("Acquisition d'immobilisation")
    expect(bien.natOp.get('bien')).toBe("Acquisition d'immobilisation")
  })

  it('l’exemplaire désigné d’une facture qui n’est pas source porte l’identité de cette facture ; une source, une autre pièce, non', () => {
    const avant = facture({ id: 'facture-avant', source_de_la_vente: false, tiers_siret: SIRET_VALIDE })
    const vente = piece({ type_piece: 'vente', facture_id: 'facture-avant' })
    expect(base({ par: 'releve', date: '2026-03-20' }, vente, avant).idClient).toBe(SIREN_VALIDE)
    expect(base({ par: 'aucun' }, vente, avant).idClient).toBe(SIREN_VALIDE)
    expect(base({ par: 'releve', date: '2026-03-20' }, vente, { ...avant, source_de_la_vente: true }).idClient).toBe('')
    expect(base({ par: 'releve', date: '2026-03-20' }, piece({ type_piece: 'vente', facture_id: 'autre' }), avant).idClient).toBe('')
    expect(base({ par: 'releve', date: '2026-03-20' }, piece({ type_piece: 'achat', facture_id: 'facture-avant' }), avant).idClient).toBe('')
  })

  it('payée par un virement mixte : le moyen de l’encaissement de sa facture, et son identité', () => {
    const avant = facture({ id: 'facture-avant', source_de_la_vente: false, tiers_siret: null, numero: 'F2025-0102' })
    const vente = piece({ type_piece: 'vente', facture_id: 'facture-avant' })
    const c = base({ par: 'virement_mixte', date: '2026-02-03', encaissement: encaissement({ moyen: 'cheque' }) }, vente, avant)
    expect(c).toMatchObject({ dateRglt: '2026-02-03', modeRglt: 'Chèque', nature: 'Recette', idClient: 'F2025-0102' })
    // L'encaissement que la lecture ne rend pas : le mode reste vide, jamais « Banque » deviné.
    expect(base({ par: 'virement_mixte', date: '2026-02-03', encaissement: null }, vente, avant).modeRglt).toBe('')
  })

  it('une note de frais : « Compte personnel » à la date que la 2035 compte ; la caisse : « Espèces »', () => {
    expect(base({ par: 'note_de_frais', date: '2026-06-01' }, piece({ type_piece: 'note_frais' }), null))
      .toMatchObject({ dateRglt: '2026-06-01', modeRglt: 'Compte personnel', nature: 'Dépense' })
    expect(base({ par: 'caisse', date: '2026-06-02' }, piece({}), null)).toMatchObject({ dateRglt: '2026-06-02', modeRglt: 'Espèces' })
  })

  it('sans paiement : le choix de FEC22-Q1, dans ses deux états', () => {
    expect(base({ par: 'aucun' }, piece({}), null)).toMatchObject({ dateRglt: '', modeRglt: '' })
    const avecDate = champsDUnePiece({
      piece: piece({}), reglement: { par: 'aucun' }, dateDeLEcriture: '2026-03-02', cible: { immobilisation: false }, exemplaireDe: null,
      lignes: lignesAchat, choix: DATE_ECRITURE,
    })
    expect(avecDate).toMatchObject({ dateRglt: '2026-03-02', modeRglt: 'Sans règlement', nature: 'Dépense', idClient: '' })
  })
})

describe('les règlements d’une pièce à une date, lus de ses paiements', () => {
  const avant = 'facture-avant'
  const vente = piece({ type_piece: 'vente', facture_id: avant, montant_ttc: 300 })

  it('un rapprochement et la part d’un règlement groupé : « releve », une fois', () => {
    const ps = [paiement({ id: 'm1', origine: 'rapprochement', montant: 100 }), paiement({ id: 'm2', origine: 'groupe', montant: 20 })]
    expect(reglementsDeLaPieceALaDate(piece({}), ps, '2026-03-20', [])).toEqual([{ par: 'releve', date: '2026-03-20' }])
    expect(reglementsDeLaPieceALaDate(piece({}), ps, '2026-03-21', [])).toEqual([])
  })

  it('« Banque » pour un mouvement rapproché, même quand le registre cite ce mouvement avec un moyen', () => {
    const ps = [paiement({ id: 'm1', montant: -120 })]
    const registre = [encaissement({ ligne_bancaire_id: 'm1', facture_id: 'autre', moyen: 'cheque' })]
    const [r] = reglementsDeLaPieceALaDate(piece({}), ps, '2026-03-20', registre)
    expect(champsDUnePiece({
      piece: piece({}), reglement: r, dateDeLEcriture: '2026-03-20', cible: { immobilisation: false }, exemplaireDe: null, lignes: [],
      choix: VIDES,
    }).modeRglt).toBe('Banque')
  })

  it('le virement mixte retrouve l’encaissement de SA facture, vivant, qui n’est pas une contre-passation', () => {
    const ps = [paiement({ id: 'm9', date: '2026-02-03', montant: 300, origine: 'encaissements' })]
    const bon = encaissement({ id: 'bon', ligne_bancaire_id: 'm9', facture_id: avant, moyen: 'carte' })
    const registre = [
      encaissement({ id: 'autre-facture', ligne_bancaire_id: 'm9', facture_id: 'facture-source', moyen: 'virement' }),
      encaissement({ id: 'retire', ligne_bancaire_id: 'm9', facture_id: avant, moyen: 'especes', retire_le: '2026-02-04T08:00:00Z' }),
      encaissement({ id: 'annulation', ligne_bancaire_id: 'm9', facture_id: avant, moyen: 'effet', annule_id: 'bon', montant: -300 }),
      bon,
    ]
    expect(reglementsDeLaPieceALaDate(vente, ps, '2026-02-03', registre)).toEqual([{ par: 'virement_mixte', date: '2026-02-03', encaissement: bon }])
    expect(reglementsDeLaPieceALaDate(vente, ps, '2026-02-03', registre.slice(0, 3)))
      .toEqual([{ par: 'virement_mixte', date: '2026-02-03', encaissement: null }])
    expect(reglementsDeLaPieceALaDate({ ...vente, facture_id: null }, ps, '2026-02-03', [bon]))
      .toEqual([{ par: 'virement_mixte', date: '2026-02-03', encaissement: null }])
  })

  it('une note de frais sans remboursement : sa part, à la date de la pièce', () => {
    const note = piece({ type_piece: 'note_frais', date_piece: '2026-06-01' })
    expect(reglementsDeLaPieceALaDate(note, [], '2026-06-01', [])).toEqual([{ par: 'note_de_frais', date: '2026-06-01' }])
  })

  it('une pièce sans paiement ni date : « aucun », au jour du dépôt, comme son écriture', () => {
    expect(reglementsDeLaPieceALaDate(piece({ date_piece: null, created_at: '2026-03-05T10:00:00Z' }), [], '2026-03-05', []))
      .toEqual([{ par: 'aucun' }])
    expect(reglementsDeLaPieceALaDate(piece({}), [], '2026-03-02', [])).toEqual([{ par: 'aucun' }])
  })

  it('deux modes le même jour font deux règlements, que le fichier scindera (FEC22c)', () => {
    // Une note de frais de 120 € remboursée de 50 € par un virement daté du jour de la note.
    const note = piece({ type_piece: 'note_frais', date_piece: '2026-06-01', montant_ttc: 120 })
    const ps = [paiement({ id: 'm3', date: '2026-06-01', montant: -50 })]
    expect(reglementsDeLaPieceALaDate(note, ps, '2026-06-01', [])).toEqual([
      { par: 'releve', date: '2026-06-01' }, { par: 'note_de_frais', date: '2026-06-01' },
    ])
  })
})

describe('un mouvement justifié par le relevé : « Banque », sa date, aucun client', () => {
  const plan = { caisse: '530000' }
  const releve = (m: Partial<MouvementDuFec>, lignes: LigneACaracteriser[]) => champsDUnMouvementDuReleve(mouvement(m), lignes, plan)

  it('affecté à une catégorie : la nature de son compte, le poste de sa catégorie', () => {
    const recette = releve({ montant: 312.4, categorie_id: 'cat' }, [ligne('p', '706000', categorie('Recettes', NOMS[4])), ligne('b', '512000', AUCUN)])
    expect(recette).toMatchObject({ dateRglt: '2026-05-12', modeRglt: 'Banque', nature: 'Recette', idClient: '' })
    expect(recette?.natOp).toEqual(new Map([['p', 'Recette — Recettes'], ['b', 'Recette']]))
    expect(releve({ categorie_id: 'cat' }, [ligne('c', '627000', categorie('Divers', 'Frais bancaires')), ligne('b', '512000', AUCUN)])?.nature)
      .toBe('Dépense')
  })

  it('ventilé sur une recette et une dépense : « Recette et dépense », un poste par ligne', () => {
    const c = releve({ montant: 50, ventilee: true }, [
      ligne('r', '706000', categorie('Recettes', 'x')), ligne('d', '627000', categorie('Divers', 'y')),
      ligne('p', '108000', AUCUN), ligne('b', '512000', AUCUN),
    ])
    expect(c?.nature).toBe('Recette et dépense')
    expect(c?.natOp).toEqual(new Map([
      ['r', 'Recette et dépense — Recettes'], ['d', 'Recette et dépense — Divers'], ['p', 'Recette et dépense'], ['b', 'Recette et dépense'],
    ]))
    // Sans ligne de résultat : une opération de bilan.
    expect(releve({ categorie_id: 'cat' }, [ligne('x', '108000', categorie(null, 'x')), ligne('b', '512000', AUCUN)])?.nature)
      .toBe('Opération de bilan')
  })

  it('un virement personnel : le signe du mouvement', () => {
    expect(releve({ montant: -800, prelevement_personnel: true, statut: 'ignoree' }, [])?.nature).toBe("Prélèvement de l'exploitant")
    expect(releve({ montant: 800, prelevement_personnel: true, statut: 'ignoree' }, [])?.nature).toBe("Apport de l'exploitant")
  })

  it('un emprunt : l’échéance ou le déblocage', () => {
    const echeance = releve({ emprunt_id: 'emp', emprunt_echeance: 3 }, [
      ligne('i', '661100', { de: 'moteur', poste: POSTE_INTERETS_EMPRUNT }), ligne('k', '164000', AUCUN), ligne('b', '512000', AUCUN),
    ])
    expect(echeance?.nature).toBe("Échéance d'emprunt")
    expect(echeance?.natOp.get('i')).toBe("Échéance d'emprunt — Frais financiers")
    expect(releve({ montant: 20000, emprunt_id: 'emp', emprunt_echeance: null }, [])?.nature).toBe("Déblocage d'emprunt")
  })

  it('une échéance de cotisation, un compte de bilan, la caisse du plan, une déclaration de TVA', () => {
    expect(releve({ cotisation_id: 'c' }, [ligne('k', '646000', { de: 'moteur', poste: POSTE_COTISATIONS })])?.natOp.get('k'))
      .toBe(`Cotisation sociale — ${POSTE_COTISATIONS}`)
    expect(releve({ compte_bilan: '580000' }, [])?.nature).toBe('Opération de bilan')
    expect(releve({ montant: 200, compte_bilan: '530000' }, [])?.nature).toBe("Versement d'espèces")
    // Un débit sur la caisse (des espèces retirées pour elle) n'est pas un versement : les mots de la fiche du mouvement.
    expect(releve({ montant: -80, compte_bilan: '530000' }, [])?.nature).toBe("Retrait d'espèces pour la caisse")
    // Le compte de la caisse est celui du PLAN du dossier, jamais un 53 deviné.
    expect(champsDUnMouvementDuReleve(mouvement({ montant: 200, compte_bilan: '530000' }), [], { caisse: '530100' })?.nature)
      .toBe('Opération de bilan')
    expect(releve({ declaration_tva_id: 'd' }, [])?.nature).toBe('Paiement de TVA')
    expect(releve({ montant: 90, declaration_tva_id: 'd' }, [])?.nature).toBe('Remboursement de TVA')
  })

  it('un mouvement que le relevé ne justifie pas n’est pas de cette sorte', () => {
    expect(releve({}, [])).toBe(null)
    expect(releve({ statut: 'non_rapprochee', categorie_id: 'cat' }, [])).toBe(null)
  })

  it('« Banque » et la date du mouvement, quel que soit le lien', () => {
    for (const lien of [{ categorie_id: 'c' }, { cotisation_id: 'c' }, { emprunt_id: 'e', emprunt_echeance: 1 }, { compte_bilan: '275000' },
      { declaration_tva_id: 'd' }, { ventilee: true }, { prelevement_personnel: true }]) {
      expect(releve(lien, [])).toMatchObject({ dateRglt: '2026-05-12', modeRglt: 'Banque', idClient: '' })
    }
  })
})

describe('une opération de caisse : « Espèces », sa date, aucun client', () => {
  const op = (o: Partial<OperationCaisse>) => champsDUneOperationDeCaisse({ id: 'op', genre: 'recette', date: '2026-07-03', montant: 65, ...o },
    [ligne('p', '706000', categorie('Recettes', NOMS[3])), ligne('c', '530000', AUCUN)])

  it('une recette, et des espèces rendues : « Recette »', () => {
    expect(op({})).toMatchObject({ dateRglt: '2026-07-03', modeRglt: 'Espèces', nature: 'Recette', idClient: '' })
    expect(op({})?.natOp.get('p')).toBe('Recette — Recettes')
    expect(op({ montant: -10 })?.nature).toBe('Recette')
  })

  it('un apport, un prélèvement de l’exploitant ; le paiement d’une pièce n’est pas de cette sorte', () => {
    expect(op({ genre: 'apport' })?.nature).toBe("Apport de l'exploitant")
    expect(op({ genre: 'prelevement' })?.nature).toBe("Prélèvement de l'exploitant")
    expect(op({ genre: 'paiement' })).toBe(null)
  })
})

describe('les écritures qui ne sont pas un règlement : le choix de FEC22-Q1, dans ses deux états', () => {
  const dot = [ligne('d', '681100', { de: 'moteur', poste: POSTE_AMORTISSEMENTS }), ligne('a', '281830', AUCUN)]
  const cas: [string, (choix: ChoixChampsBnc) => ChampsBnc, string][] = [
    ['dotation', (c) => champsDUneDotation('2026-12-31', dot, c), 'Dotation aux amortissements'],
    ['forfait', (c) => champsDUnForfait('2026-12-31', [ligne('k', '625100', { de: 'moteur', poste: POSTE_INDEMNITES_KM })], c),
      'Frais de véhicule (barème)'],
    ['liquidation', (c) => champsDUneLiquidation('2026-12-31', [ligne('r', '658000', { de: 'moteur', poste: POSTE_ARRONDIS_TVA_CHARGE })], c),
      'Liquidation de TVA'],
    ['à-nouveaux', (c) => champsDesANouveaux([{ id: 'an', compte: '512000', libelle: NOMS[7] }], '2026-12-31', c), 'À-nouveaux'],
    ['TVA due', (c) => champsDeLaTvaDUneFacture(facture({}), '2026-12-31', [ligne('c', '411000', AUCUN)], c), 'TVA due sur facture'],
  ]
  for (const [nom, champsDe, nature] of cas) {
    it(`${nom} : vides, ou la date de l’écriture et « Sans règlement »`, () => {
      expect(champsDe(VIDES)).toMatchObject({ dateRglt: '', modeRglt: '', nature })
      expect(champsDe(DATE_ECRITURE)).toMatchObject({ dateRglt: '2026-12-31', modeRglt: 'Sans règlement', nature })
    })
  }

  it('NatOp de chacune : la dotation, le forfait, l’arrondi portent leur poste ; les à-nouveaux jamais', () => {
    expect(champsDUneDotation('2026-12-31', dot, VIDES).natOp)
      .toEqual(new Map([['d', 'Dotation aux amortissements — Amortissements'], ['a', 'Dotation aux amortissements']]))
    expect(cas[1][1](VIDES).natOp.get('k')).toBe(`Frais de véhicule (barème) — ${POSTE_INDEMNITES_KM}`)
    expect(cas[2][1](VIDES).natOp.get('r')).toBe(`Liquidation de TVA — ${POSTE_ARRONDIS_TVA_CHARGE}`)
    expect(cas[3][1](VIDES).natOp).toEqual(new Map([['an', 'À-nouveaux']]))
    expect(champsDUneDotation('2026-12-31', dot, VIDES).idClient).toBe('')
  })

  it('la TVA due d’une facture ou d’un avoir porte l’identité du document', () => {
    expect(champsDeLaTvaDUneFacture(facture({ tiers_siret: SIRET_VALIDE }), '2026-12-31', [], VIDES).idClient).toBe(SIREN_VALIDE)
    expect(champsDeLaTvaDUneFacture(facture({ id: 'av', numero: 'A2026-0002' }), '2026-12-31', [], VIDES).idClient).toBe('A2026-0002')
  })
})

describe('l’échéance payée depuis le compte personnel', () => {
  it('la date du paiement saisie, « Compte personnel », « Cotisation sociale »', () => {
    const c = champsDUnPaiementPersonnel({ id: 'ech', paiement_personnel_le: '2026-02-15' },
      [ligne('k', '646000', { de: 'moteur', poste: POSTE_COTISATIONS }), ligne('x', '108000', AUCUN)])
    expect(c).toMatchObject({ dateRglt: '2026-02-15', modeRglt: 'Compte personnel', nature: 'Cotisation sociale', idClient: '' })
    expect(champsDUnPaiementPersonnel({ id: 'ech', paiement_personnel_le: null }, []).dateRglt).toBe('')
  })
})

describe('les écritures d’une vente facturée', () => {
  it('l’encaissement : sa date au registre, son moyen, « Recette », l’identité de sa facture', () => {
    for (const moyen of MOYENS) {
      const c = champsDUnEncaissement(encaissement({ moyen, date_encaissement: '2026-04-10' }), facture({ tiers_siret: SIRET_VALIDE }),
        [ligne('p', '706000', { de: 'moteur', poste: POSTE_VENTES_FACTUREES }), ligne('b', '512000', AUCUN)])
      expect(c).toMatchObject({ dateRglt: '2026-04-10', modeRglt: MODE_DU_MOYEN[moyen], nature: 'Recette', idClient: SIREN_VALIDE })
      expect(c.natOp.get('p')).toBe(`Recette — ${POSTE_VENTES_FACTUREES}`)
    }
  })

  it('la contre-passation : sa date, son moyen, « Annulation de recette » ; une facture qui n’est pas la sienne, aucun client', () => {
    const cp = encaissement({ id: 'cp', annule_id: 'enc-1', montant: -100, moyen: 'cheque', date_encaissement: '2026-04-28' })
    expect(champsDUnEncaissement(cp, facture({}), [])).toMatchObject({
      dateRglt: '2026-04-28', modeRglt: 'Chèque', nature: 'Annulation de recette', idClient: 'F2026-0007',
    })
    expect(champsDUnEncaissement(cp, facture({ id: 'facture-2' }), []).idClient).toBe('')
  })

  it('le mouvement que ses encaissements classent : un seul moyen le dit, plusieurs disent « Banque »', () => {
    const m = { id: 'remise', date: '2026-04-12', montant: 230, libelle: NOMS[6], libelle_brut: NOMS[5], source_fichier: NOMS[7] }
    const cheques = [
      encaissement({ id: 'a', ligne_bancaire_id: 'remise', moyen: 'cheque' }), encaissement({ id: 'b', ligne_bancaire_id: 'remise', moyen: 'cheque' }),
    ]
    expect(champsDUnMouvementDesEncaissements(m, cheques, [])).toMatchObject({
      dateRglt: '2026-04-12', modeRglt: 'Chèque', nature: 'Remise en banque', idClient: '',
    })
    const mixte = [...cheques, encaissement({ id: 'c', ligne_bancaire_id: 'remise', moyen: 'virement' })]
    expect(champsDUnMouvementDesEncaissements(m, mixte, []).modeRglt).toBe('Banque')
    // Le virement retiré, et un encaissement qu'une contre-passation sans mouvement annule, ne justifient plus le mouvement.
    const retire = [...cheques, encaissement({ id: 'c', ligne_bancaire_id: 'remise', moyen: 'virement', retire_le: '2026-04-13T09:00:00Z' })]
    expect(champsDUnMouvementDesEncaissements(m, retire, []).modeRglt).toBe('Chèque')
    const annule = [...mixte, encaissement({ id: 'x', annule_id: 'c', montant: -100, moyen: 'virement', ligne_bancaire_id: null })]
    expect(champsDUnMouvementDesEncaissements(m, annule, []).modeRglt).toBe('Chèque')
    // Rien qui le justifie à la lecture : un règlement par le relevé, « Banque » (FEC22-Q2).
    expect(champsDUnMouvementDesEncaissements(m, [], []).modeRglt).toBe('Banque')
  })

  it('un débit que ses contre-passations classent : « Annulation de recette »', () => {
    const debit = { id: 'impaye', date: '2026-05-02', montant: -100, libelle: NOMS[5], libelle_brut: null, source_fichier: null }
    const cp = encaissement({ id: 'cp', annule_id: 'enc-1', montant: -100, moyen: 'cheque', ligne_bancaire_id: 'impaye' })
    expect(champsDUnMouvementDesEncaissements(debit, [encaissement({ ligne_bancaire_id: 'credit' }), cp], []))
      .toMatchObject({ dateRglt: '2026-05-02', modeRglt: 'Chèque', nature: 'Annulation de recette' })
  })
})

// ── AUCUN NOM : une batterie tirée de toutes les sortes, des noms plantés partout où une lecture en porte ──
describe('aucun nom ne paraît dans les quatre valeurs', () => {
  it('500 écritures tirées (graine fixe) : ni tiers, ni nom de client, ni libellé, ni fichier, ni motif ; des valeurs des listes', () => {
    const suivant = tirage(20261031)
    const parmi = <T>(liste: readonly T[]): T => liste[entierTire(suivant, liste.length)]
    const nom = () => parmi(NOMS)
    const postes: PosteLu[] = [
      { de: 'aucun' }, { de: 'categorie', categorie: null }, categorie(null, 'Achats'), categorie('Achats', NOMS[4]),
      categorie('Recettes', NOMS[3]), categorie(NOMS[0], NOMS[1]), { de: 'moteur', poste: POSTE_AMORTISSEMENTS },
    ]
    const comptes = ['512000', '606400', '706000', '445660', '108000', '681100', '530000']
    const lignes = () => Array.from({ length: 1 + entierTire(suivant, 4) }, (_, i): LigneACaracteriser => ({
      id: `l${i}`, compte: parmi(comptes), libelle: nom(), poste: parmi(postes),
    }))
    const sirets = [SIRET_VALIDE, SIRET_INVALIDE, null, NOMS[0], '1234567820001A']
    const fac = () => facture({ tiers_nom: nom(), tiers_siret: parmi(sirets), source_de_la_vente: parmi([true, false]) })
    const enc = () => encaissement({ motif: nom(), moyen: parmi(MOYENS), ligne_bancaire_id: parmi(['m1', null]) })
    const choix = () => parmi([VIDES, DATE_ECRITURE])
    const typesDePiece: PieceDuFec['type_piece'][] = ['achat', 'vente', 'note_frais', 'autre']
    const genres: OperationCaisse['genre'][] = ['recette', 'apport', 'prelevement']
    const sortes: (() => ChampsBnc | null)[] = [
      () => champsDUnePiece({
        piece: piece({ tiers: nom(), nom_fichier: nom(), type_piece: parmi(typesDePiece), facture_id: 'facture-1' }),
        reglement: parmi<ReglementDUnePiece>([{ par: 'releve', date: '2026-03-20' }, { par: 'aucun' }, { par: 'note_de_frais', date: '2026-03-01' },
          { par: 'virement_mixte', date: '2026-03-21', encaissement: enc() }, { par: 'caisse', date: '2026-03-22' }]),
        dateDeLEcriture: '2026-03-20', cible: { immobilisation: parmi([true, false]) }, exemplaireDe: fac(), lignes: lignes(), choix: choix(),
      }),
      () => champsDUnMouvementDuReleve(mouvement({
        libelle: nom(), libelle_brut: nom(), source_fichier: nom(), montant: parmi([-30, 30]),
        ...parmi([{ categorie_id: 'c' }, { ventilee: true }, { prelevement_personnel: true }, { cotisation_id: 'c' }, { compte_bilan: '530000' }]),
      }), lignes(), { caisse: '530000' }),
      () => champsDUneOperationDeCaisse({ id: 'op', genre: parmi(genres), date: '2026-07-03', montant: 10 }, lignes()),
      () => champsDUneDotation('2026-12-31', lignes(), choix()),
      () => champsDUnForfait('2026-12-31', lignes(), choix()),
      () => champsDUneLiquidation('2026-12-31', lignes(), choix()),
      () => champsDesANouveaux([{ id: 'an', compte: '512000', libelle: nom() }], '2026-01-01', choix()),
      () => champsDUnPaiementPersonnel({ id: 'e', paiement_personnel_le: '2026-02-15' }, lignes()),
      () => champsDeLaTvaDUneFacture(fac(), '2026-03-31', lignes(), choix()),
      () => champsDUnEncaissement(enc(), fac(), lignes()),
      () => champsDUnMouvementDesEncaissements({ id: 'm1', date: '2026-04-12', montant: 50, libelle: nom(), libelle_brut: nom(), source_fichier: nom() },
        [enc(), enc()], lignes()),
    ]
    expect(sortes.length).toBe(Object.keys(REGLES_DES_SORTES).length)
    const vus = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const c = parmi(sortes)()
      if (c === null) continue
      for (const v of valeurs(c)) for (const n of NOMS) if (v.includes(n)) throw new Error(`écriture ${i} : « ${n} » dans « ${v} »`)
      expect(c.modeRglt === '' || MODES_REGLEMENT.some((m) => m === c.modeRglt)).toBe(true)
      expect(NATURES_OPERATION).toContain(c.nature)
      expect(c.dateRglt === '' || /^\d{4}-\d{2}-\d{2}$/.test(c.dateRglt)).toBe(true)
      expect(['', SIREN_VALIDE, 'F2026-0007']).toContain(c.idClient)
      for (const v of c.natOp.values()) {
        const reste = v.slice(c.nature.length)
        const poste = reste.slice(SEPARATEUR_DU_POSTE.length)
        expect(v.startsWith(c.nature) && (reste === '' || (reste.startsWith(SEPARATEUR_DU_POSTE) && POSTES_RATTACHES.includes(poste)))).toBe(true)
        vus.add(v)
      }
    }
    // Un plancher : la batterie a bien rencontré des postes, pas seulement des natures.
    expect([...vus].filter((v) => v.includes(SEPARATEUR_DU_POSTE)).length).toBeGreaterThanOrEqual(5)
  })
})

// ── LE SCANNER : de TOUTES les sortes que `numeroterFec` distingue à une règle ici ──

interface Lecture { sortes: Set<string>; fautes: string[]; horsFec: number }

// Les clés d'écriture que `numeroterFec` donne (lib/fec.ts), et celles que la composition donne aux ventes facturées
// (lib/ecrituresVentesFacturees.ts), lues sur le TEXTE : toute affectation `cle = …` du corps de la fonction ; une forme
// non reconnue est une faute. Les à-nouveaux, que la fonction rend à part, comptent pour une sorte.
function lireLesSortes(fec: string, composition: string): Lecture {
  const debut = fec.indexOf('export function numeroterFec(')
  const fin = fec.indexOf('\nexport function ', debut + 1)
  if (debut < 0 || fin < 0) return { sortes: new Set(), fautes: ['numeroterFec introuvable'], horsFec: 0 }
  const corps = fec.slice(debut, fin)
  const sortes = new Set<string>()
  const fautes: string[] = []
  for (const m of corps.matchAll(/\bcle = ([^\n]+)/g)) {
    const expr = m[1].trim()
    if (expr === 'vente.cle') {
      const cles = [...composition.matchAll(/export const cleFec\w+ = \([^)]*\) => `([a-z][a-z-]*)\|/g)]
      if (cles.length === 0) fautes.push('aucune clé de la composition des ventes facturées')
      for (const c of cles) sortes.add(c[1])
      continue
    }
    const prefixe = /^`([a-z][a-z-]*)\|/.exec(expr)
    if (prefixe) {
      sortes.add(prefixe[1])
      continue
    }
    // La clé d'une pièce : sa source (la pièce, en trésorerie) et sa date.
    if (expr === '`${source}|${e.date}`' && /const source = [^\n]*: e\.piece_id\n/.test(corps)) {
      sortes.add('piece')
      continue
    }
    fautes.push(`forme de clé inconnue : ${expr}`)
  }
  if (/\n\s+aNouveaux: \[\.\.\.aNouveaux\]/.test(corps)) sortes.add('a-nouveaux')
  return { sortes, fautes, horsFec: corps.split('horsFec.push(e)').length - 1 }
}

function fautesDesRegles(lecture: Lecture, regles: Readonly<Record<string, string>>): string[] {
  const exportees = new Map(Object.entries(champs))
  const fautes = [...lecture.fautes]
  for (const s of lecture.sortes) if (!(s in regles)) fautes.push(`la sorte « ${s} » n'a pas de règle`)
  for (const [s, fonction] of Object.entries(regles)) {
    if (!lecture.sortes.has(s)) fautes.push(`la règle « ${s} » ne répond à aucune sorte de numeroterFec`)
    if (typeof exportees.get(fonction) !== 'function') fautes.push(`la règle « ${s} » nomme ${fonction}, qui n'est pas exportée`)
  }
  return fautes
}

describe('le scanner des sortes d’écriture du FEC', () => {
  const fec = lire('src/lib/fec.ts')
  const composition = lire('src/lib/ecrituresVentesFacturees.ts')

  it('chaque sorte que numeroterFec distingue a sa règle, et chaque règle sa sorte', () => {
    const lecture = lireLesSortes(fec, composition)
    expect(fautesDesRegles(lecture, REGLES_DES_SORTES)).toEqual([])
    // Le plancher : onze sortes — une lecture devenue aveugle ne rendrait pas « zéro faute ».
    expect(lecture.sortes.size).toBe(11)
    // Les trois sorties hors du fichier — une ligne d'une vente à réécrire, une opération de caisse que la lecture ne rend
    // pas, le reste d'une pièce supprimée — n'ont pas de règle : elles ne sont pas dans le fichier. Comptées : une
    // quatrième serait une sorte à juger.
    expect(lecture.horsFec).toBe(3)
  })

  it('une sorte neuve sans règle est une faute (défaut planté)', () => {
    const plantee = fec.replace('    } else if (e.immobilisation_id) {',
      '    } else if (e.nouvelle_source_id) {\n      cle = `nouvelle|${e.nouvelle_source_id}`\n    } else if (e.immobilisation_id) {')
    expect(plantee).not.toBe(fec)
    expect(fautesDesRegles(lireLesSortes(plantee, composition), REGLES_DES_SORTES)).toEqual(["la sorte « nouvelle » n'a pas de règle"])
  })

  it('une clé neuve de la composition, une forme de clé inconnue, une règle retirée sont des fautes', () => {
    const composee = composition.replace('export const cleFecMouvementEncaissements',
      'export const cleFecAcompte = (id: string) => `acompte|${id}`\nexport const cleFecMouvementEncaissements')
    expect(fautesDesRegles(lireLesSortes(fec, composee), REGLES_DES_SORTES)).toEqual(["la sorte « acompte » n'a pas de règle"])
    const inconnue = fec.replace('cle = `dotation|${e.immobilisation_id}|${e.date}`', 'cle = e.id')
    expect(fautesDesRegles(lireLesSortes(inconnue, composition), REGLES_DES_SORTES)).toContain('forme de clé inconnue : e.id')
    const sansForfait = Object.fromEntries(Object.entries(REGLES_DES_SORTES).filter(([s]) => s !== 'forfait'))
    expect(fautesDesRegles(lireLesSortes(fec, composition), sansForfait)).toEqual(["la sorte « forfait » n'a pas de règle"])
    expect(fautesDesRegles(lireLesSortes(fec, composition), { ...REGLES_DES_SORTES, forfait: 'champsInexistants' }))
      .toEqual(["la règle « forfait » nomme champsInexistants, qui n'est pas exportée"])
  })

  it('chaque lien qui fait d’un mouvement une écriture du relevé a sa règle (défaut planté)', () => {
    const affectation = lire('src/lib/affectationBanque.ts')
    const liens = (texte: string) => {
      const debut = texte.indexOf('export function mouvementJustifieParLeReleve(')
      const corps = texte.slice(texte.indexOf('): boolean {', debut), texte.indexOf('\n}\n', debut))
      return [...new Set([...corps.matchAll(/\bligne\.(\w+)/g)].map((m) => m[1]))].filter((l) => l !== 'statut').sort()
    }
    expect(liens(affectation)).toEqual([...LIENS_DU_RELEVE].sort())
    const plante = affectation.replace('|| !!ligne.declaration_tva_id))', '|| !!ligne.declaration_tva_id || !!ligne.nouveau_lien))')
    expect(plante).not.toBe(affectation)
    expect(liens(plante)).not.toEqual([...LIENS_DU_RELEVE].sort())
  })
})

// ── AUCUNE VALEUR PAR DÉFAUT dans le module : ni champ facultatif, ni paramètre qui se remplit seul ──
describe('le module ne prend aucune valeur par défaut', () => {
  // Le texte sans ses commentaires : une phrase qui dit « ? : » ne compte pas.
  const sansCommentaires = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  // Les listes de paramètres de chaque fonction, parenthèses équilibrées.
  function parametres(texte: string): { fonction: string; liste: string }[] {
    const trouves: { fonction: string; liste: string }[] = []
    for (const m of texte.matchAll(/function (\w+)(?:<[^>]*>)?\(/g)) {
      let profondeur = 1
      let i = m.index + m[0].length
      for (; i < texte.length && profondeur > 0; i++) {
        if (texte[i] === '(') profondeur++
        if (texte[i] === ')') profondeur--
      }
      trouves.push({ fonction: m[1], liste: texte.slice(m.index + m[0].length, i - 1) })
    }
    return trouves
  }
  const fautes = (texte: string) => {
    const t = sansCommentaires(texte)
    return [
      ...[...t.matchAll(/(\w+)\?\s*:/g)].map((m) => `champ facultatif : ${m[1]}`),
      ...parametres(t).filter((p) => /[^=!<>]=[^=>]/.test(p.liste)).map((p) => `valeur par défaut : ${p.fonction}`),
    ]
  }
  const module = lire('src/lib/champsBncDuFec.ts')

  it('aucune dans le module ; le plancher : douze fonctions au moins lues', () => {
    expect(fautes(module)).toEqual([])
    expect(parametres(sansCommentaires(module)).length).toBeGreaterThanOrEqual(12)
  })

  it('une valeur par défaut, un champ facultatif plantés sont vus', () => {
    expect(fautes(module.replace('export function champsDUneDotation(dateDeLEcriture: string,',
      "export function champsDUneDotation(dateDeLEcriture: string = '2026-12-31',"))).toEqual(['valeur par défaut : champsDUneDotation'])
    expect(fautes(module.replace('  sansReglement: SansReglement\n', '  sansReglement?: SansReglement\n')))
      .toEqual(['champ facultatif : sansReglement'])
  })
})

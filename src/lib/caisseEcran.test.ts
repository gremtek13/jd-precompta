import { describe, expect, it } from 'vitest'
import {
  ecritureDeLOperation, ensembleDuJour, jugerLaSaisie, premierJourNegatif, refusDeLaSaisie, refusDeLaSaisieDUnMois,
  type EtatDeLaCaisse,
} from './caisse'
import {
  CAISSE_ABSENTE_DE_LA_FICHE, caisseDeBanque, caisseDeLaFiche, confirmationDuRemplacement, confirmationDuRetrait,
  dossierDeLEcran, especesDuJour, etatDeLaCaisseLu, etatDUneOperationRetiree, FORMULAIRE_VIDE, journalDeLaCaisse,
  libelleDeLaLigne, ligneVide, lireLeMontantSaisi, MONTANT_ILLISIBLE, nomDeLOperation, operationsRetirees,
  phraseDesEspecesDuJour, refusDuRetraitDeLOperation, saisieDuFormulaire, soldeAuJour, TAUX_PROPOSES, totauxDuJournal,
  verdictDuFormulaire, verdictDuMois, type ContexteDeLaCaisse, type DonneesDeLaCaisse, type EntreesDeLaCaisseDeBanque,
  type FormulaireDeCaisse,
} from './caisseEcran'
import { operationsDeCaisseDuDossier } from './controlesDeLaCaisse'
import type { ModeleComptable } from './engagement'
import { PLAN_PAR_DEFAUT } from './planComptable'
import type { Categorie, OperationCaisse } from './types'
import { entierTire, tirage } from '../test/encaissementsBatterie'

// CE QUE L'ÉCRAN DE LA CAISSE DIT ET ENVOIE (ligne 26.6, étape C4 ; lib/caisseEcran.ts). Ce module ne recopie aucune règle : ces
// cas gardent qu'il ASSEMBLE bien — la caisse rejouée sur ce que l'écran a lu, le journal qui retrouve chaque flux du solde, la
// saisie telle qu'elle PART (l'écriture que compose `ecritureDeLOperation`, l'ensemble du jour que `ensembleDuJour` reconnaît),
// les refus du module redits sans un mot de plus ni de moins, et la caisse que la fiche d'un mouvement juge. Des jeux FICTIFS.

const MODELE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }
const CAISSE = PLAN_PAR_DEFAUT.caisse
const AUJOURDHUI = '2026-10-29'
const sansEspaceInsecable = (s: string) => s.replace(/[  ]/g, ' ')

const HONORAIRES: Categorie = {
  id: '00000000-0000-4000-8000-0000000000a1', dossier_id: null, code: 'honoraires', libelle: 'Honoraires', ordre: 1, compte_comptable: '706000', poste_2035: 'Recettes',
}
const LOYER: Categorie = {
  id: '00000000-0000-4000-8000-0000000000a2', dossier_id: 'd1', code: 'loyer', libelle: 'Loyer', ordre: 2, compte_comptable: '613200', poste_2035: 'Loyers',
}

function operation(o: Partial<OperationCaisse> & Pick<OperationCaisse, 'id'>): OperationCaisse {
  return {
    dossier_id: 'd1', genre: 'apport', date: '2026-03-01', montant: 100, categorie_id: null, taux_tva: null, encaissements_du_jour: null,
    piece_id: null, origine: 'cabinet', remplace_id: null, cree_le: '2026-03-01T08:00:00Z', cree_par: 'u', retire_le: null, retire_par: null, ...o,
  }
}

function donnees(o: Partial<DonneesDeLaCaisse> = {}): DonneesDeLaCaisse {
  return { operations: [], ouvertures: [], mouvements: [], especes: { etat: 'sans_objet' }, categories: [HONORAIRES, LOYER], ...o }
}

function contexte(o: Partial<ContexteDeLaCaisse> = {}): ContexteDeLaCaisse {
  return { modele: MODELE, assujettiTva: false, aujourdhui: AUJOURDHUI, anneesValidees: [], ...o }
}

function formulaire(o: Partial<FormulaireDeCaisse> = {}): FormulaireDeCaisse {
  return { ...FORMULAIRE_VIDE, ...o }
}

const FACTURE = { id: 'f1', numero: 'F-2026-0012', source_de_la_vente: true }
const ESPECES = (id: string, jour: string, montant: number, facture = 'f1', annule: string | null = null) => ({
  id, facture_id: facture, date_encaissement: jour, montant, moyen: 'especes' as const, ligne_bancaire_id: null, annule_id: annule, retire_le: null,
})

// Une caisse de mars 2026 : 50 € d'ouverture, un apport de 100 € le 1er, une recette de 85 € le 3, un prélèvement de 40 € le 4,
// 30 € d'espèces d'une facture source le 10, un versement en banque de 120 € le 5 ; et une recette retirée, qui ne compte pas.
function mars(): DonneesDeLaCaisse {
  return donnees({
    ouvertures: [{ id: 'a1', dossier_id: 'd1', date: '2026-01-01', compte: CAISSE, compte_origine: '530', libelle: 'Caisse', sens: 'debit', montant: 50, source_nom: 'b.csv', source_empreinte: 'x', created_at: '2026-01-01T00:00:00Z', compte_lib: null, ecriture_lib: null }],
    operations: [
      operation({ id: 'o1', genre: 'apport', date: '2026-03-01', montant: 100 }),
      operation({ id: 'o2', genre: 'recette', date: '2026-03-03', montant: 85, categorie_id: HONORAIRES.id, encaissements_du_jour: [] }),
      operation({ id: 'o3', genre: 'prelevement', date: '2026-03-04', montant: 40 }),
      operation({ id: 'o4', genre: 'recette', date: '2026-03-03', montant: 999, categorie_id: HONORAIRES.id, encaissements_du_jour: [], retire_le: '2026-03-04T09:00:00Z' }),
    ],
    mouvements: [{ id: 'm1', date: '2026-03-05', montant: 120, libelle: 'VERSEMENT ESPECES', compte_bilan: CAISSE }],
    especes: { etat: 'lues', encaissements: [ESPECES('e1', '2026-03-10', 30)], factures: [FACTURE] },
  })
}

describe('la caisse rejouée sur ce que l’écran a lu', () => {
  it('le compte de la caisse est celui du plan, les espèces des factures celles d’un dossier basculé seulement', () => {
    const etat = etatDeLaCaisseLu(MODELE, mars())
    expect(etat.compteCaisse).toBe(CAISSE)
    expect(etat.encaissements.map((e) => e.id)).toEqual(['e1'])
    expect(etat.factures.map((f) => f.numero)).toEqual(['F-2026-0012'])
    const sans = etatDeLaCaisseLu(MODELE, donnees({ especes: { etat: 'sans_objet' } }))
    expect([sans.encaissements, sans.factures]).toEqual([[], []])
    const decale = etatDeLaCaisseLu({ ...MODELE, plan: { ...PLAN_PAR_DEFAUT, caisse: '531000' } }, donnees())
    expect(decale.compteCaisse).toBe('531000')
  })

  it('le dossier jugé est celui du cabinet : l’ouverture est la plus ancienne date de la reprise, tout compte confondu', () => {
    const reprise = (date: string, compte: string) => ({ ...mars().ouvertures[0], id: `a-${date}-${compte}`, date, compte })
    const dossier = dossierDeLEcran(contexte({ assujettiTva: true, anneesValidees: [2025] }),
      donnees({ ouvertures: [reprise('2026-02-01', '512000'), reprise('2026-01-15', CAISSE)] }))
    expect(dossier).toMatchObject({ quiEcrit: 'cabinet', utilisateur: null, assujetti: true, aujourdhui: AUJOURDHUI, ouverture: '2026-01-15', anneesValidees: [2025] })
    expect(dossierDeLEcran(contexte(), donnees()).ouverture).toBeNull()
  })

  it('le solde au jour : celui du dernier jour qui porte un flux, au plus tard ce jour-là', () => {
    const etat = etatDeLaCaisseLu(MODELE, mars())
    expect(soldeAuJour(etat, '2025-12-31')).toBe(0)
    expect(soldeAuJour(etat, '2026-01-01')).toBe(5000)
    expect(soldeAuJour(etat, '2026-03-02')).toBe(15000)
    expect(soldeAuJour(etat, '2026-03-03')).toBe(15000 + 8500)
    expect(soldeAuJour(etat, '2026-03-04')).toBe(15000 + 8500 - 4000)
    expect(soldeAuJour(etat, '9999-12-31')).toBe(15000 + 8500 - 4000 - 12000 + 3000)
  })
})

describe('le journal : la caisse jour par jour', () => {
  const etat = etatDeLaCaisseLu(MODELE, mars())
  const journal = journalDeLaCaisse(etat, mars().operations, mars().mouvements)

  it('chaque flux du solde est une ligne, sous son jour, du plus ancien au plus récent ; la recette retirée n’y est pas', () => {
    expect(journal.map((j) => j.jour)).toEqual(['2026-01-01', '2026-03-01', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-10'])
    expect(journal.flatMap((j) => j.lignes.map((l) => l.nature))).toEqual(['ouverture', 'operation', 'operation', 'operation', 'mouvement', 'encaissement'])
    expect(journal.flatMap((j) => j.lignes).filter((l) => l.nature === 'operation').map((l) => (l.nature === 'operation' ? l.operation.id : '')))
      .toEqual(['o1', 'o2', 'o3'])
  })

  it('le solde de chaque jour est le cumul des flux, et son dernier jour le solde de la caisse', () => {
    expect(journal.map((j) => j.solde)).toEqual([5000, 15000, 23500, 19500, 7500, 10500])
    expect(journal.at(-1)!.solde).toBe(soldeAuJour(etat, '9999-12-31'))
    // Aucun flux ne se perd ni ne se compte deux fois : la somme des lignes est le dernier solde.
    expect(journal.flatMap((j) => j.lignes).reduce((s, l) => s + l.centimes, 0)).toBe(10500)
    for (const j of journal) expect(j.entrees - j.sorties).toBe(j.lignes.reduce((s, l) => s + l.centimes, 0))
  })

  it('ce qui entre et ce qui sort : un versement en banque sort, les espèces d’une facture entrent', () => {
    const jour = (d: string) => journal.find((j) => j.jour === d)!
    expect([jour('2026-03-05').entrees, jour('2026-03-05').sorties]).toEqual([0, 12000])
    expect([jour('2026-03-10').entrees, jour('2026-03-10').sorties]).toEqual([3000, 0])
    const ligneDuVersement = jour('2026-03-05').lignes[0]
    expect(ligneDuVersement.nature === 'mouvement' && ligneDuVersement.mouvement.libelle).toBe('VERSEMENT ESPECES')
    const ligneDeLaFacture = jour('2026-03-10').lignes[0]
    expect(ligneDeLaFacture.nature === 'encaissement' && ligneDeLaFacture.numero).toBe('F-2026-0012')
  })

  it('les totaux : les recettes (des espèces rendues en déduction), les apports, les prélèvements, les versements, les espèces des factures', () => {
    expect(totauxDuJournal(journal)).toEqual({
      recettes: 8500, apports: 10000, prelevements: 4000, versements: 12000, retraits: 0, especesDesFactures: 3000,
    })
    const rendues = etatDeLaCaisseLu(MODELE, donnees({ operations: [
      operation({ id: 'r1', genre: 'recette', date: '2026-03-03', montant: 85, categorie_id: HONORAIRES.id, encaissements_du_jour: [] }),
      operation({ id: 'r2', genre: 'recette', date: '2026-03-04', montant: -20, categorie_id: HONORAIRES.id, encaissements_du_jour: [] }),
    ] }))
    const ops = [
      operation({ id: 'r1', genre: 'recette', date: '2026-03-03', montant: 85, categorie_id: HONORAIRES.id, encaissements_du_jour: [] }),
      operation({ id: 'r2', genre: 'recette', date: '2026-03-04', montant: -20, categorie_id: HONORAIRES.id, encaissements_du_jour: [] }),
    ]
    expect(totauxDuJournal(journalDeLaCaisse(rendues, ops, [])).recettes).toBe(6500)
    expect(totauxDuJournal([])).toEqual({ recettes: 0, apports: 0, prelevements: 0, versements: 0, retraits: 0, especesDesFactures: 0 })
  })

  it('un retrait d’espèces pour la caisse (un débit du relevé) entre dans la caisse', () => {
    const d = donnees({ mouvements: [{ id: 'm2', date: '2026-03-02', montant: -60, libelle: 'RETRAIT DAB', compte_bilan: CAISSE }] })
    const j = journalDeLaCaisse(etatDeLaCaisseLu(MODELE, d), [], d.mouvements)
    expect(j).toHaveLength(1)
    expect([j[0].entrees, j[0].sorties, j[0].solde]).toEqual([6000, 0, 6000])
    expect(totauxDuJournal(j)).toMatchObject({ retraits: 6000, versements: 0 })
  })

  it('les mots d’une ligne ne nomment personne : la nature, le taux, le libellé du relevé, le numéro de la facture', () => {
    const lignes = journal.flatMap((j) => j.lignes)
    expect(lignes.map((l) => libelleDeLaLigne(l, [HONORAIRES]))).toEqual([
      'Ouverture : les espèces en caisse dans les comptes repris',
      'Apport en caisse de l’exploitant',
      'Recettes en espèces — Honoraires',
      'Prélèvement en espèces de l’exploitant',
      'Versement en banque — VERSEMENT ESPECES',
      'Espèces reçues pour la facture F-2026-0012',
    ])
    const assujettie = operation({ id: 'x', genre: 'recette', montant: -12, taux_tva: 5.5, categorie_id: HONORAIRES.id })
    expect(libelleDeLaLigne({ nature: 'operation', centimes: -1200, operation: assujettie }, [HONORAIRES])).toBe('Espèces rendues — Honoraires · TVA 5,5 %')
    expect(libelleDeLaLigne({ nature: 'operation', centimes: 1200, operation: { ...assujettie, montant: 12 } }, [])).toBe('Recettes en espèces — catégorie non lue · TVA 5,5 %')
    expect(libelleDeLaLigne({ nature: 'operation', centimes: 500, operation: operation({ id: 'p', genre: 'paiement' }) }, [])).toBe('Paiement d’une pièce par la caisse')
    const contrePassation = ESPECES('e2', '2026-03-12', -30, 'f1', 'e1')
    expect(libelleDeLaLigne({ nature: 'encaissement', centimes: -3000, encaissement: contrePassation, numero: null }, []))
      .toBe('Espèces rendues sur la facture (sans numéro)')
  })
})

describe('un montant tapé', () => {
  it('se lit en nombre : la virgule, les espaces, le signe', () => {
    expect([lireLeMontantSaisi('125,50'), lireLeMontantSaisi('125.5'), lireLeMontantSaisi('1 250'), lireLeMontantSaisi('-12,3')]).toEqual([125.5, 125.5, 1250, -12.3])
    expect(lireLeMontantSaisi('  ')).toBeNull()
    expect(lireLeMontantSaisi('12,345')).toBe(12.345)
  })

  it('illisible : ni lettre, ni deux signes, ni deux virgules', () => {
    for (const t of ['abc', '12 €', '1,2,3', '--5', '12-', ',5']) expect(lireLeMontantSaisi(t), t).toBe('illisible')
  })
})

describe('la saisie telle qu’elle part', () => {
  it('une recette d’un dossier assujetti : sa catégorie, son taux, le montant, et l’écriture que compose le module', () => {
    const ctx = contexte({ assujettiTva: true })
    const f = formulaire({ genre: 'recette', date: '2026-03-12', categorieId: HONORAIRES.id, taux: '20', montant: '120' })
    const s = saisieDuFormulaire(f, ctx, [HONORAIRES], etatDeLaCaisseLu(MODELE, donnees()))
    expect(s).toEqual({
      genre: 'recette', date: '2026-03-12', montant: 120, categorie_id: HONORAIRES.id, taux_tva: 20, encaissements_du_jour: [],
      ecritures: ecritureDeLOperation({ genre: 'recette', date: '2026-03-12', montant: 120, taux_tva: 20, categorie: HONORAIRES }, MODELE),
    })
    // Le produit hors taxe et la TVA : 100 € et 20 €, face à la caisse.
    expect(s.ecritures).toEqual([
      { compte: CAISSE, sens: 'debit', montant: 120, libelle: 'Recettes en espèces du 12/03/2026 — Honoraires' },
      { compte: '706000', sens: 'credit', montant: 100, libelle: 'Recettes en espèces du 12/03/2026 — Honoraires' },
      { compte: PLAN_PAR_DEFAUT.tva_collectee, sens: 'credit', montant: 20, libelle: 'Recettes en espèces du 12/03/2026 — Honoraires' },
    ])
  })

  it('un dossier qui n’est pas assujetti ne porte aucun taux, même tapé ; un apport ni catégorie, ni taux, ni ensemble du jour', () => {
    const recette = saisieDuFormulaire(formulaire({ genre: 'recette', date: '2026-03-12', categorieId: HONORAIRES.id, taux: '20', montant: '85' }),
      contexte(), [HONORAIRES], etatDeLaCaisseLu(MODELE, donnees()))
    expect(recette.taux_tva).toBeNull()
    expect(recette.ecritures).toHaveLength(2)
    const apport = saisieDuFormulaire(formulaire({ genre: 'apport', date: '2026-03-12', categorieId: HONORAIRES.id, taux: '20', montant: '100' }),
      contexte({ assujettiTva: true }), [HONORAIRES], etatDeLaCaisseLu(MODELE, donnees()))
    expect([apport.categorie_id, apport.taux_tva, apport.encaissements_du_jour]).toEqual([null, null, null])
    expect(apport.ecritures).toEqual(ecritureDeLOperation({ genre: 'apport', date: '2026-03-12', montant: 100, taux_tva: null, categorie: null }, MODELE))
  })

  it('un champ vide ou une catégorie inconnue : pas d’écriture, et le module dira le refus', () => {
    const etat = etatDeLaCaisseLu(MODELE, donnees())
    expect(saisieDuFormulaire(formulaire({ genre: 'recette', date: '2026-03-12', montant: '85' }), contexte(), [HONORAIRES], etat))
      .toMatchObject({ categorie_id: null, ecritures: [] })
    expect(saisieDuFormulaire(formulaire({ genre: 'recette', date: '2026-03-12', categorieId: 'inconnue', montant: '85' }), contexte(), [HONORAIRES], etat))
      .toMatchObject({ categorie_id: 'inconnue', ecritures: [] })
    expect(saisieDuFormulaire(formulaire({ genre: 'apport', date: '', montant: '' }), contexte(), [], etat))
      .toMatchObject({ date: null, montant: null, ecritures: [] })
  })

  it('l’ensemble du jour d’une recette est celui que la caisse compte ce jour-là, trié', () => {
    const d = donnees({ especes: { etat: 'lues', encaissements: [ESPECES('e2', '2026-03-12', 20), ESPECES('e1', '2026-03-12', 30), ESPECES('e3', '2026-03-13', 5)], factures: [FACTURE] } })
    const etat = etatDeLaCaisseLu(MODELE, d)
    const s = saisieDuFormulaire(formulaire({ genre: 'recette', date: '2026-03-12', categorieId: HONORAIRES.id, montant: '85' }), contexte(), d.categories, etat)
    expect(s.encaissements_du_jour).toEqual(['e1', 'e2'])
    expect(s.encaissements_du_jour).toEqual(ensembleDuJour(etat, '2026-03-12'))
  })
})

describe('les espèces des factures du jour, nommées dans le formulaire d’une recette', () => {
  const d = donnees({ especes: { etat: 'lues', encaissements: [ESPECES('e1', '2026-03-12', 120), ESPECES('e2', '2026-03-12', 30, 'f2')], factures: [FACTURE, { id: 'f2', numero: 'F-2026-0013', source_de_la_vente: true }] } })
  const etat = etatDeLaCaisseLu(MODELE, d)

  it('une facture : le montant, le numéro, et ce que la recette ne compte pas', () => {
    const une = especesDuJour(etatDeLaCaisseLu(MODELE, donnees({ especes: { etat: 'lues', encaissements: [ESPECES('e1', '2026-03-12', 120)], factures: [FACTURE] } })), '2026-03-12')
    expect(sansEspaceInsecable(phraseDesEspecesDuJour(une)!))
      .toBe('Les 120,00 € de la facture F-2026-0012, reçus ce jour-là, sont déjà dans la caisse : ce total ne les compte pas.')
  })

  it('plusieurs factures : chacune nommée', () => {
    expect(sansEspaceInsecable(phraseDesEspecesDuJour(especesDuJour(etat, '2026-03-12'))!))
      .toBe('Les 120,00 € de la facture F-2026-0012 et 30,00 € de la facture F-2026-0013, reçus ce jour-là, sont déjà dans la caisse : ce total ne les compte pas.')
  })

  it('aucune espèce ce jour-là, ou celles d’une facture qui n’est pas source : rien à dire', () => {
    expect(phraseDesEspecesDuJour(especesDuJour(etat, '2026-03-13'))).toBeNull()
    const horsSource = etatDeLaCaisseLu(MODELE, donnees({ especes: { etat: 'lues', encaissements: [ESPECES('e9', '2026-03-12', 50, 'f9')], factures: [{ id: 'f9', numero: 'F-9', source_de_la_vente: false }] } }))
    expect(especesDuJour(horsSource, '2026-03-12')).toEqual([])
  })
})

describe('le verdict du formulaire, avant le clic', () => {
  it('rien de tapé qui permette de juger (la date ou le montant manque) n’est pas un refus', () => {
    expect(verdictDuFormulaire(formulaire(), contexte(), donnees())).toEqual({ etat: 'vide' })
    expect(verdictDuFormulaire(formulaire({ date: '2026-03-12' }), contexte(), donnees())).toEqual({ etat: 'vide' })
    expect(verdictDuFormulaire(formulaire({ montant: '12' }), contexte(), donnees())).toEqual({ etat: 'vide' })
  })

  it('un montant qui n’est pas un nombre se dit, sans appeler la base', () => {
    expect(verdictDuFormulaire(formulaire({ date: '2026-03-12', montant: 'douze' }), contexte(), donnees())).toEqual({ etat: 'illisible', message: MONTANT_ILLISIBLE })
  })

  it('permis : la saisie est celle que le module accepte, et rien d’autre', () => {
    const f = formulaire({ genre: 'recette', date: '2026-03-12', categorieId: HONORAIRES.id, montant: '85,00' })
    const v = verdictDuFormulaire(f, contexte(), donnees())
    expect(v.etat).toBe('permis')
    if (v.etat === 'permis') expect(refusDeLaSaisie(v.saisie, dossierDeLEcran(contexte(), donnees()))).toBeNull()
  })

  it('refusé : les mots de la base, dans son ordre — la nature d’abord, puis le taux d’un dossier assujetti', () => {
    const base = { genre: 'recette' as const, date: '2026-03-12', montant: '85' }
    const sansCategorie = verdictDuFormulaire(formulaire(base), contexte({ assujettiTva: true }), donnees())
    expect(sansCategorie).toMatchObject({ etat: 'refuse', message: 'La nature d\'une recette en espèces est une catégorie de produit du dossier : à choisir.' })
    const sansTaux = verdictDuFormulaire(formulaire({ ...base, categorieId: HONORAIRES.id }), contexte({ assujettiTva: true }), donnees())
    expect(sansTaux).toMatchObject({ etat: 'refuse', message: 'Sur un dossier assujetti à la TVA, une recette porte son taux : choisis-le, ou « exonérée ».' })
    const chargeChoisie = verdictDuFormulaire(formulaire({ ...base, categorieId: LOYER.id }), contexte(), donnees())
    expect(chargeChoisie).toMatchObject({ etat: 'refuse', message: 'La catégorie « Loyer » n\'a pas de compte de produit (classe 7) : une recette en espèces ne s\'y range pas.' })
  })

  it('refusé : le jour — l’avenir, avant l’ouverture, un exercice validé —, sous les mots de la base', () => {
    const f = (date: string) => formulaire({ genre: 'apport', date, montant: '10' })
    expect(verdictDuFormulaire(f('2026-11-02'), contexte(), donnees())).toMatchObject({ message: 'Une opération de caisse ne se date pas dans l\'avenir : nous sommes le 29/10/2026.' })
    const avecReprise = donnees({ ouvertures: mars().ouvertures })
    expect(verdictDuFormulaire(f('2025-12-31'), contexte(), avecReprise)).toMatchObject({ message: 'Cette opération précède l\'ouverture du dossier, le 01/01/2026 : elle est dans les comptes repris.' })
    expect(verdictDuFormulaire(f('2025-12-31'), contexte({ anneesValidees: [2025] }), donnees())).toMatchObject({ etat: 'refuse' })
  })

  it('refusé : un prélèvement qui rendrait la caisse négative dit le jour et le solde, sous les mots du geste', () => {
    const f = formulaire({ genre: 'prelevement', date: '2026-03-02', montant: '200' })
    const v = verdictDuFormulaire(f, contexte(), mars())
    expect(v.etat).toBe('refuse')
    if (v.etat === 'refuse') {
      expect(sansEspaceInsecable(v.message)).toBe(
        'Ce prélèvement de 200,00 € rendrait la caisse négative le 02/03/2026 (−50,00 €) : saisis d\'abord les recettes en espèces qui le précèdent.',
      )
    }
    // Des espèces rendues, de même, sous les leurs.
    const rendues = verdictDuFormulaire(formulaire({ genre: 'recette', date: '2026-03-02', categorieId: HONORAIRES.id, montant: '-200' }), contexte(), mars())
    expect(rendues).toMatchObject({ etat: 'refuse' })
    if (rendues.etat === 'refuse') expect(rendues.message).toMatch(/^Ces espèces rendues, 200,00 €, rendraient la caisse négative le 02\/03\/2026/)
  })

  it('refusé : les espèces d’une facture du jour comptées entre-temps — le module juge l’ensemble que l’écran a montré', () => {
    // La saisie part avec l'ensemble de l'écran ; une base qui en voit un autre dit « relis la caisse ».
    const d = donnees({ especes: { etat: 'lues', encaissements: [ESPECES('e1', '2026-03-12', 120)], factures: [FACTURE] } })
    const v = verdictDuFormulaire(formulaire({ genre: 'recette', date: '2026-03-12', categorieId: HONORAIRES.id, montant: '85' }), contexte(), d)
    expect(v).toMatchObject({ etat: 'permis' })
    if (v.etat === 'permis') {
      expect(v.saisie.encaissements_du_jour).toEqual(['e1'])
      const sansElle = { ...v.saisie, encaissements_du_jour: [] }
      expect(refusDeLaSaisie(sansElle, dossierDeLEcran(contexte(), d))?.message)
        .toBe('Un encaissement en espèces de la facture F-2026-0012 du même jour a été enregistré depuis ta lecture : relis la caisse.')
    }
  })

  it('un remplacement est jugé comme `remplacer_operation_caisse` : l’ancienne retirée, la nouvelle écrite à sa place', () => {
    // Remplacer l'apport de 100 € (le 1er) par un apport de 50 € : le versement de 120 € du 5 mars laisse encore 25 € en caisse.
    // Avec un prélèvement de 140 € le 2, l'apport de 1 € ne suffit plus.
    const d = mars()
    const permis = verdictDuFormulaire(formulaire({ genre: 'apport', date: '2026-03-01', montant: '50' }), contexte(), d, 'o1')
    expect(permis.etat).toBe('permis')
    const dernier = verdictDuFormulaire(formulaire({ genre: 'apport', date: '2026-03-01', montant: '1' }), contexte(), { ...d, operations: [...d.operations, operation({ id: 'o5', genre: 'prelevement', date: '2026-03-02', montant: 140 })] }, 'o1')
    expect(dernier.etat).toBe('refuse')
    if (dernier.etat === 'refuse') {
      expect(sansEspaceInsecable(dernier.message)).toBe(
        'Retirer cet apport de 100,00 € rendrait la caisse négative le 02/03/2026 (−89,00 €) : retire d\'abord les sorties d\'espèces qui le suivent.',
      )
    }
    // Une opération qui n'est plus dans la caisse : la base dit de relire.
    expect(verdictDuFormulaire(formulaire({ genre: 'apport', date: '2026-03-01', montant: '10' }), contexte(), d, 'absente'))
      .toMatchObject({ etat: 'refuse', message: 'Cette opération n\'est pas dans la caisse de ce dossier : relis ta caisse.' })
  })
})

describe('la saisie d’un mois', () => {
  const ligne = (o: Partial<FormulaireDeCaisse>) => formulaire({ genre: 'recette', categorieId: HONORAIRES.id, ...o })

  it('rien de tapé, ou des lignes vides : rien à envoyer', () => {
    expect(verdictDuMois([], contexte(), donnees())).toEqual({ etat: 'vide' })
    expect(verdictDuMois([formulaire(), formulaire(), formulaire()], contexte(), donnees())).toEqual({ etat: 'vide' })
    expect(ligneVide(formulaire())).toBe(true)
    expect(ligneVide(formulaire({ montant: '1' }))).toBe(false)
  })

  it('permis : le tableau qui part, une opération par ligne, chacune avec son écriture ; les lignes vides EN FIN écartées', () => {
    const lignes = [
      ligne({ date: '2026-03-02', montant: '85' }),
      formulaire({ genre: 'apport', date: '2026-03-03', montant: '100' }),
      formulaire({ genre: 'prelevement', date: '2026-03-04', montant: '40' }),
      formulaire(),
    ]
    const v = verdictDuMois(lignes, contexte(), donnees())
    expect(v.etat).toBe('permis')
    if (v.etat === 'permis') {
      expect(v.operations).toHaveLength(3)
      expect(v.operations.map((o) => o.genre)).toEqual(['recette', 'apport', 'prelevement'])
      expect(v.operations[0].ecritures).toEqual(ecritureDeLOperation({ genre: 'recette', date: '2026-03-02', montant: 85, taux_tva: null, categorie: HONORAIRES }, MODELE))
      expect(refusDeLaSaisieDUnMois(v.operations, dossierDeLEcran(contexte(), donnees()))).toBeNull()
    }
  })

  it('refusé : le premier refus est nommé par son rang et son jour — tout ou rien', () => {
    const v = verdictDuMois([
      ligne({ date: '2026-03-02', montant: '85' }),
      ligne({ date: '2026-03-12', montant: '40', categorieId: LOYER.id }),
      ligne({ date: '2026-03-14', montant: '10' }),
    ], contexte(), donnees())
    expect(v).toMatchObject({
      etat: 'refuse',
      message: 'Opération n° 2, du 12/03/2026 : La catégorie « Loyer » n\'a pas de compte de produit (classe 7) : une recette en espèces ne s\'y range pas.',
    })
  })

  it('une ligne vide au milieu est une ligne, que son rang nomme', () => {
    const v = verdictDuMois([ligne({ date: '2026-03-02', montant: '85' }), formulaire(), ligne({ date: '2026-03-14', montant: '10' })], contexte(), donnees())
    expect(v).toMatchObject({ etat: 'refuse', message: 'Opération n° 2 : La date de l\'opération de caisse est à renseigner.' })
  })

  it('un montant illisible est nommé par son rang, avant la base', () => {
    const v = verdictDuMois([ligne({ date: '2026-03-02', montant: '85' }), ligne({ date: '2026-03-03', montant: 'abc' })], contexte(), donnees())
    expect(v).toEqual({ etat: 'illisible', message: `Opération n° 2 : ${MONTANT_ILLISIBLE}` })
  })

  it('la caisse jamais négative se juge à la fin, sur tout le mois : un jour qui retire avant qu’un autre ajoute', () => {
    const lignes = [
      formulaire({ genre: 'prelevement', date: '2026-03-02', montant: '50' }),
      formulaire({ genre: 'apport', date: '2026-03-01', montant: '60' }),
    ]
    expect(verdictDuMois(lignes, contexte(), donnees()).etat).toBe('permis')
    const trop = verdictDuMois([formulaire({ genre: 'prelevement', date: '2026-03-02', montant: '50' }), formulaire({ genre: 'apport', date: '2026-03-03', montant: '60' })], contexte(), donnees())
    expect(trop.etat).toBe('refuse')
    if (trop.etat === 'refuse') expect(sansEspaceInsecable(trop.message)).toBe('La caisse serait négative le 02/03/2026 (−50,00 €) : saisis d\'abord les recettes en espèces qui précèdent ce jour.')
  })
})

describe('le retrait et le remplacement, nommés et jugés avant le clic', () => {
  const d = mars()

  it('la confirmation d’un retrait nomme l’opération, son écriture, et la caisse de son jour après le retrait', () => {
    const recette = d.operations.find((o) => o.id === 'o2')!
    expect(sansEspaceInsecable(confirmationDuRetrait(recette, contexte(), d)))
      .toBe('Retirer la recette du 03/03/2026 de 85,00 € (Honoraires) ? Son écriture est retirée avec elle ; la caisse du 03/03/2026 passera à 150,00 €.')
    const apport = d.operations.find((o) => o.id === 'o1')!
    expect(sansEspaceInsecable(confirmationDuRetrait(apport, contexte(), d)))
      .toBe('Retirer l’apport du 01/03/2026 de 100,00 € ? Son écriture est retirée avec elle ; la caisse du 01/03/2026 passera à 50,00 €.')
  })

  it('un retrait qui viderait la caisse se refuse sous les mots de la base — celui de l’opération, pas un autre', () => {
    // L'apport de 100 € de mars couvre le prélèvement du 4 : tant que 50 € d'ouverture et la recette suivent, le retirer passe.
    expect(sansEspaceInsecable(refusDuRetraitDeLOperation('o1', contexte(), d)!)).toBe(
      'Retirer cet apport de 100,00 € rendrait la caisse négative le 05/03/2026 (−25,00 €) : retire d\'abord les sorties d\'espèces qui le suivent.',
    )
    const serre = donnees({ operations: [
      operation({ id: 'a', genre: 'apport', date: '2026-03-01', montant: 100 }),
      operation({ id: 'p', genre: 'prelevement', date: '2026-03-02', montant: 80 }),
    ] })
    expect(sansEspaceInsecable(refusDuRetraitDeLOperation('a', contexte(), serre)!)).toBe(
      'Retirer cet apport de 100,00 € rendrait la caisse négative le 02/03/2026 (−80,00 €) : retire d\'abord les sorties d\'espèces qui le suivent.',
    )
    // Un prélèvement ne fait que rendre des espèces : il se retire toujours.
    expect(refusDuRetraitDeLOperation('p', contexte(), serre)).toBeNull()
  })

  it('l’exercice validé fige la caisse de ses jours : rien ne s’y retire', () => {
    const msg = refusDuRetraitDeLOperation('o1', contexte({ anneesValidees: [2026] }), d)
    expect(msg).toMatch(/sa caisse ne change plus\.$/)
  })

  it('une opération que la caisse ne connaît pas se refuse comme la base la refuserait', () => {
    expect(refusDuRetraitDeLOperation('absente', contexte(), d)).toBe('Cette opération n\'est pas dans la caisse de ce dossier : relis ta caisse.')
  })

  it('la confirmation d’un remplacement nomme l’ancienne et la nouvelle', () => {
    const ancienne = d.operations.find((o) => o.id === 'o2')!
    const nouvelle = saisieDuFormulaire(formulaire({ genre: 'recette', date: '2026-03-03', categorieId: HONORAIRES.id, montant: '90' }), contexte(), d.categories, etatDeLaCaisseLu(MODELE, d))
    expect(sansEspaceInsecable(confirmationDuRemplacement(ancienne, nouvelle, d)))
      .toBe('Remplacer la recette du 03/03/2026 de 85,00 € (Honoraires) par une recette du 03/03/2026 de 90,00 € (Honoraires) ? L’ancienne est retirée avec son écriture ; la nouvelle est écrite à sa place, et la caisse se rejoue.')
  })

  it('les opérations retirées ou remplacées : la plus récemment retirée d’abord, et ce qu’elles sont devenues', () => {
    const ops = [
      operation({ id: 'v1', genre: 'apport', date: '2026-03-01', montant: 10, retire_le: '2026-03-05T10:00:00Z' }),
      operation({ id: 'v2', genre: 'apport', date: '2026-03-01', montant: 20, remplace_id: 'v1' }),
      operation({ id: 'w1', genre: 'prelevement', date: '2026-03-02', montant: 5, retire_le: '2026-03-06T10:00:00Z' }),
      operation({ id: 'vivante', genre: 'apport', date: '2026-03-02', montant: 5 }),
    ]
    const retirees = operationsRetirees(ops)
    expect(retirees.map((o) => o.id)).toEqual(['w1', 'v1'])
    expect(etatDUneOperationRetiree(retirees[0], ops)).toBe('retirée')
    expect(etatDUneOperationRetiree(retirees[1], ops)).toBe('remplacée par l’opération du 01/03/2026')
    expect(sansEspaceInsecable(nomDeLOperation(ops[2], []))).toBe('le prélèvement du 02/03/2026 de 5,00 €')
    expect(sansEspaceInsecable(nomDeLOperation(ops[2], [], 'un'))).toBe('un prélèvement du 02/03/2026 de 5,00 €')
    expect(sansEspaceInsecable(nomDeLOperation(ops[2], [], null))).toBe('prélèvement du 02/03/2026 de 5,00 €')
    expect(sansEspaceInsecable(nomDeLOperation(operation({ id: 'z', genre: 'recette', date: '2026-03-02', montant: -7 }), [], 'le'))).toBe('les espèces rendues du 02/03/2026 de 7,00 €')
  })
})

describe('la caisse dans la fiche d’un mouvement du relevé', () => {
  // 340 € en caisse le 12/03 : 50 + 100 + 85 + 105 de recette.
  const d = donnees({
    ouvertures: mars().ouvertures,
    operations: [
      operation({ id: 'a', genre: 'apport', date: '2026-03-01', montant: 100 }),
      operation({ id: 'r', genre: 'recette', date: '2026-03-12', montant: 190, categorie_id: HONORAIRES.id, encaissements_du_jour: [] }),
    ],
  })
  const etat = etatDeLaCaisseLu(MODELE, d)
  const lecture = { etat: 'lue' as const, caisse: etat }
  const operations = operationsDeCaisseDuDossier({ dossierId: 'd1', enBase: true, lignes: d.operations, complete: true, motif: null }, 'd1')

  it('un crédit : la caisse du jour, sans lui puis avec lui classé « Versement d’espèces » — aucun refus tant qu’elle tient', () => {
    const fiche = caisseDeLaFiche({ id: 'c1', date: '2026-03-12', montant: 200, compte_bilan: null }, lecture, operations)
    expect(fiche).toEqual({ etat: 'lue', tenue: 'oui', surLaCaisse: false, soldeSans: 34000, soldeAvec: 14000, refusDuClassement: null, refusDuRetrait: null })
  })

  it('un crédit qui rendrait la caisse négative : le refus de la base, ses mots, le jour et le solde', () => {
    const fiche = caisseDeLaFiche({ id: 'c2', date: '2026-03-12', montant: 500, compte_bilan: null }, lecture, operations)
    expect(fiche.etat).toBe('lue')
    if (fiche.etat === 'lue') {
      expect(fiche.soldeAvec).toBe(-16000)
      expect(sansEspaceInsecable(fiche.refusDuClassement!)).toBe(
        'Ce versement de 500,00 € rendrait la caisse négative le 12/03/2026 (−160,00 €) : saisis d\'abord les recettes en espèces qui le précèdent.',
      )
    }
  })

  it('un versement trop tôt vide aussi les jours d’après : le premier jour négatif est celui que le geste crée', () => {
    // Un prélèvement de 300 € le 13/03 serait couvert par la caisse de 340 € ; un versement de 100 € le 12/03 le découvre.
    const avecSortie = etatDeLaCaisseLu(MODELE, { ...d, operations: [...d.operations, operation({ id: 'p', genre: 'prelevement', date: '2026-03-13', montant: 300 })] })
    const fiche = caisseDeLaFiche({ id: 'c3', date: '2026-03-12', montant: 100, compte_bilan: null }, { etat: 'lue', caisse: avecSortie }, operations)
    expect(fiche.etat === 'lue' && sansEspaceInsecable(fiche.refusDuClassement ?? '')).toBe(
      'Ce versement de 100,00 € rendrait la caisse négative le 13/03/2026 (−60,00 €) : saisis d\'abord les recettes en espèces qui le précèdent.',
    )
  })

  it('un débit (des espèces retirées pour la caisse) l’alimente : aucun refus', () => {
    const fiche = caisseDeLaFiche({ id: 'c4', date: '2026-03-12', montant: -80, compte_bilan: null }, lecture, operations)
    expect(fiche).toMatchObject({ etat: 'lue', surLaCaisse: false, soldeSans: 34000, soldeAvec: 42000, refusDuClassement: null, refusDuRetrait: null })
  })

  it('un débit déjà classé sur la caisse : le retirer vide la caisse des espèces qu’il y avait mises — le refus dit « retrait d’espèces »', () => {
    const classe = { id: 'c5', date: '2026-03-02', montant: -80, libelle: 'RETRAIT', compte_bilan: CAISSE }
    const dessus = etatDeLaCaisseLu(MODELE, { ...d, mouvements: [classe], operations: [...d.operations, operation({ id: 'p', genre: 'prelevement', date: '2026-03-03', montant: 220 })] })
    const fiche = caisseDeLaFiche(classe, { etat: 'lue', caisse: dessus }, operations)
    expect(fiche).toMatchObject({ etat: 'lue', surLaCaisse: true })
    if (fiche.etat === 'lue') {
      expect(fiche.soldeSans).toBe(15000)
      expect(fiche.soldeAvec).toBe(23000)
      expect(sansEspaceInsecable(fiche.refusDuRetrait!)).toBe(
        'Retirer ce retrait d\'espèces de 80,00 € pour la caisse rendrait la caisse négative le 03/03/2026 (−70,00 €) : retire d\'abord les sorties d\'espèces qui le suivent.',
      )
    }
  })

  it('un crédit déjà classé sur la caisse : le retirer ne la vide jamais', () => {
    const classe = { id: 'c6', date: '2026-03-02', montant: 40, libelle: 'VERSEMENT', compte_bilan: CAISSE }
    const dessus = etatDeLaCaisseLu(MODELE, { ...d, mouvements: [classe] })
    const fiche = caisseDeLaFiche(classe, { etat: 'lue', caisse: dessus }, operations)
    expect(fiche).toMatchObject({ surLaCaisse: true, refusDuRetrait: null, soldeSans: 15000, soldeAvec: 11000 })
  })

  it('le reste dit ce que la fiche peut en dire : la caisse absente (le drapeau baissé), la caisse pas lue en entier', () => {
    expect(caisseDeLaFiche({ id: 'x', date: '2026-03-12', montant: 10, compte_bilan: null }, { etat: 'absente' }, { etat: 'absente' })).toBe(CAISSE_ABSENTE_DE_LA_FICHE)
    expect(caisseDeLaFiche({ id: 'x', date: '2026-03-12', montant: 10, compte_bilan: null }, { etat: 'pas_lue', motif: 'la reprise : lecture partielle' }, operations))
      .toEqual({ etat: 'pas_lue', tenue: 'oui', motif: 'la reprise : lecture partielle' })
    expect(CAISSE_ABSENTE_DE_LA_FICHE).toEqual({ etat: 'absente', tenue: 'non' })
  })
})

describe('la caisse que l’onglet Banque juge, ou ce qui l’en empêche', () => {
  const entrees = (o: Partial<EntreesDeLaCaisseDeBanque> = {}): EntreesDeLaCaisseDeBanque => ({
    dossierId: 'd1',
    caisse: { dossierId: 'd1', enBase: true, lignes: [operation({ id: 'a' })], complete: true, motif: null },
    ouvertures: { dossierId: 'd1', lignes: [], complete: true, motif: null },
    releve: [], releveIncomplet: null, especes: { etat: 'sans_objet' }, modele: MODELE, ...o,
  })

  it('le drapeau baissé : absente, et rien de plus ne se calcule', () => {
    expect(caisseDeBanque(entrees({ caisse: { dossierId: 'd1', enBase: false, lignes: [], complete: false, motif: 'pas en base' }, ouvertures: null }))).toEqual({ etat: 'absente' })
  })

  it('lue en entier : la caisse rejouée sur les opérations, la reprise, le relevé entier et les espèces des factures', () => {
    const releve = [{ id: 'm', date: '2026-03-05', montant: 20, libelle: 'VERSEMENT', compte_bilan: CAISSE }]
    const lue = caisseDeBanque(entrees({
      ouvertures: { dossierId: 'd1', lignes: mars().ouvertures, complete: true, motif: null }, releve,
      especes: { etat: 'lues', encaissements: [ESPECES('e1', '2026-03-10', 30)], factures: [FACTURE] },
    }))
    expect(lue.etat).toBe('lue')
    if (lue.etat === 'lue') {
      expect(lue.caisse.compteCaisse).toBe(CAISSE)
      expect(lue.caisse.mouvements).toEqual(releve)
      expect(lue.caisse.ouvertures).toHaveLength(1)
      expect(lue.caisse.encaissements).toHaveLength(1)
      expect(lue.caisse.operations).toHaveLength(1)
    }
  })

  it('une seule entrée qui manque, et la caisse n’est pas jugée : chacune dit son motif', () => {
    const motif = (o: Partial<EntreesDeLaCaisseDeBanque>) => { const r = caisseDeBanque(entrees(o)); return r.etat === 'pas_lue' ? r.motif : r.etat }
    expect(motif({ caisse: null })).toBe('la caisse du dossier n’est pas encore lue')
    expect(motif({ caisse: { dossierId: 'd2', enBase: true, lignes: [], complete: true, motif: null } })).toBe('la caisse du dossier n’est pas encore lue')
    expect(motif({ caisse: { dossierId: 'd1', enBase: true, lignes: [], complete: false, motif: '500 lues sur 900' } })).toBe('500 lues sur 900')
    expect(motif({ ouvertures: null })).toBe('la reprise du dossier n’est pas encore lue')
    expect(motif({ ouvertures: { dossierId: 'd2', lignes: [], complete: true, motif: null } })).toBe('la reprise du dossier n’est pas encore lue')
    expect(motif({ ouvertures: { dossierId: 'd1', lignes: [], complete: false, motif: 'lecture interrompue' } })).toBe('la reprise du dossier : lecture interrompue')
    expect(motif({ releveIncomplet: '200 lus sur 900' })).toBe('le relevé : 200 lus sur 900')
    expect(motif({ especes: { etat: 'incomplete', motif: 'les encaissements' } })).toBe('les espèces des factures : les encaissements')
  })

  it('la caisse que la fiche juge tient compte de toutes ses entrées : les espèces d’une facture du jour comptent', () => {
    const lue = caisseDeBanque(entrees({
      caisse: { dossierId: 'd1', enBase: true, lignes: [], complete: true, motif: null },
      especes: { etat: 'lues', encaissements: [ESPECES('e1', '2026-03-10', 30)], factures: [FACTURE] },
    }))
    expect(lue.etat === 'lue' && premierJourNegatif(lue.caisse as EtatDeLaCaisse)).toBeNull()
    expect(lue.etat === 'lue' && soldeAuJour(lue.caisse as EtatDeLaCaisse, '2026-03-10')).toBe(3000)
  })
})

describe('les taux proposés', () => {
  it('sont ceux du module, l’exonérée en tête', () => {
    expect(TAUX_PROPOSES.map((t) => t.valeur)).toEqual([0, 5.5, 8.5, 10, 20])
    expect(TAUX_PROPOSES.map((t) => t.libelle)).toEqual(['0 % (exonérée)', '5,5 %', '8,5 %', '10 %', '20 %'])
  })
})

describe('une batterie tirée : tout ce que l’écran laisse partir, la base l’accepte, et la caisse ne passe jamais sous zéro', () => {
  it('300 saisies tirées (graine 20261030), chacune jugée par le verdict puis ajoutée à la caisse si elle est permise', () => {
    const suivant = tirage(20261030)
    let d = donnees({ ouvertures: [] })
    // Plus de sorties que d'entrées : la caisse se vide, et le verdict refuse.
    const genres = ['recette', 'recette', 'apport', 'prelevement', 'prelevement', 'prelevement'] as const
    let permises = 0
    let refusees = 0
    for (let i = 0; i < 300; i++) {
      const genre = genres[entierTire(suivant, genres.length)]
      const jour = 1 + entierTire(suivant, 28)
      const montant = (entierTire(suivant, 30000) / 100) * (genre === 'recette' && entierTire(suivant, 10) === 0 ? -1 : 1)
      const f = formulaire({
        genre, date: `2026-03-${String(jour).padStart(2, '0')}`, montant: String(montant).replace('.', ','),
        categorieId: genre === 'recette' ? (entierTire(suivant, 8) === 0 ? '' : HONORAIRES.id) : '',
      })
      const v = verdictDuFormulaire(f, contexte(), d)
      if (v.etat === 'permis') {
        permises++
        // La saisie qui part est celle que le module accepte, avec l'écriture qu'il compose.
        const dossier = dossierDeLEcran(contexte(), d)
        const jugee = jugerLaSaisie(v.saisie, dossier, false, `t${i}`)
        expect(jugee.refus, `saisie ${i}`).toBeNull()
        const op: OperationCaisse = operation({
          id: `t${i}`, genre, date: f.date, montant, categorie_id: v.saisie.categorie_id, encaissements_du_jour: genre === 'recette' ? [] : null,
        })
        d = { ...d, operations: [...d.operations, op] }
        expect(premierJourNegatif(etatDeLaCaisseLu(MODELE, d)), `après la saisie ${i}`).toBeNull()
      } else if (v.etat === 'refuse') {
        refusees++
        expect(v.message).toBe(refusDeLaSaisie(v.saisie, dossierDeLEcran(contexte(), d))!.message)
      }
    }
    // Un plancher : une batterie qui n'accepterait ou ne refuserait rien serait aveugle.
    expect(permises).toBeGreaterThan(60)
    expect(refusees).toBeGreaterThan(30)
  })
})

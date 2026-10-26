import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  anneesDuReleve, argumentsDeLaPrecision, argumentsDeProposer, argumentsDeRetirer, attendUnePiece, auteurPourLeClient,
  BLANCS_D_UNE_PRECISION, COLONNES_DE_LA_PIECE, COLONNES_DES_ENCAISSEMENTS, COLONNES_DES_FACTURES, COLONNES_DU_MOUVEMENT,
  correspondAuFiltre, couvertureDuReleve, ENCAISSEMENTS_LUS_EN_PARTIE, ETATS_DU_MOUVEMENT, FACTURES_LUES_EN_PARTIE, etatAvecLesVentes, etatDuMouvement, exerciceFige, FILTRES_D_ETAT,
  LIBELLE_DE_L_ETAT, libelleDuMois, longueurEnCaracteres, LONGUEUR_MAX_PRECISION, maBanqueOuverte, proposableParLeClient,
  REFUS_PRECISION, REFUS_PROPOSER, REFUS_RETIRER, refusDeLaPrecision, refusDeProposer, refusDeRetirer, sensDeLaVente,
  situationsDuReleve, soldeAuReleve, venteDuMouvement, ventesLues, type EncaissementDuClient, type FactureDuClient,
  type MouvementDuClient, type VentesDuClient,
} from './banqueClient'
import { motsDuCabinet } from './espaceVentes'
import type { LectureComplete } from './lectureComplete'
import type { ControleReleveBancaire, JustificatifPropose, PrecisionMouvement, ReglementGroupe } from './types'
import { derniereDefinitionSql } from '../test/schema'
import { argumentsSql, codesSql, messagesSql, nombreDeValeurs, numerosSql } from '../test/raiseSql'

// « MA BANQUE » (espace client, étape P9) : le module qui dit, pour le client, l'état de chaque mouvement de son relevé, le
// solde lu, la couverture, et les refus des trois fonctions de la base avant le clic. Données FICTIVES.

const DOSSIER = 'd1'
const MOI = 'u-client'

function mouvement(o: Partial<MouvementDuClient> = {}): MouvementDuClient {
  return {
    id: 'l1', dossier_id: DOSSIER, date: '2026-09-15', libelle: 'PRLV FICTIF', montant: -42.5, statut: 'non_rapprochee',
    piece_id: null, cotisation_id: null, categorie_id: null, emprunt_id: null, ventilee: false, reglement_groupe: false,
    compte_bilan: null, declaration_tva_id: null, prelevement_personnel: false, encaissements_de_factures: false,
    created_at: '2026-09-20T08:00:00Z', ...o,
  }
}

function proposition(o: Partial<JustificatifPropose> = {}): JustificatifPropose {
  return {
    id: 'j1', dossier_id: DOSSIER, ligne_bancaire_id: 'l1', piece_id: 'p1', auteur_id: MOI, origine: 'client',
    created_at: '2026-09-21T08:00:00Z', retire_le: null, retire_par: null, ...o,
  }
}

function precision(o: Partial<PrecisionMouvement> = {}): PrecisionMouvement {
  return {
    id: 'q1', dossier_id: DOSSIER, ligne_bancaire_id: 'l1', auteur_id: 'u-cabinet', origine: 'cabinet',
    texte: 'De quoi s’agit-il ?', created_at: '2026-09-21T09:00:00Z', ...o,
  }
}

function part(o: Partial<ReglementGroupe> = {}): ReglementGroupe {
  return { id: 'r1', dossier_id: DOSSIER, ligne_bancaire_id: 'l1', piece_id: 'p1', montant: 10, created_at: '2026-09-21T08:00:00Z', ...o }
}

function controle(o: Partial<ControleReleveBancaire> = {}): ControleReleveBancaire {
  return {
    id: 'c1', dossier_id: DOSSIER, source_fichier: null, solde_initial: 100, solde_final: 1234.56, somme_mouvements: 1134.56,
    ecart: 0, coherent: true, periode_debut: '2026-08-01', periode_fin: '2026-08-31', created_at: '2026-09-02T08:00:00Z', ...o,
  }
}

// Étape VF5g : une facture SOURCE de sa vente et un encaissement qui cite le mouvement l1.
function facture(o: Partial<FactureDuClient> = {}): FactureDuClient {
  return {
    id: 'f1', dossier_id: DOSSIER, numero: 'F2026-0001', type: 'facture', statut: 'validee', facture_origine_id: null,
    source_de_la_vente: true, ...o,
  }
}

function encaissement(o: Partial<EncaissementDuClient> = {}): EncaissementDuClient {
  return {
    id: 'e1', dossier_id: DOSSIER, facture_id: 'f1', montant: 100, ligne_bancaire_id: 'l1', annule_id: null, retire_le: null,
    cree_le: '2026-09-21T08:00:00Z', ...o,
  }
}

const BANQUE_SEULE: VentesDuClient = { droit: 'banque_seule' }

const lue = <T,>(lignes: T[]): LectureComplete<T> => ({ lignes, complete: true, motif: null })
const partielle = <T,>(lignes: T[]): LectureComplete<T> => ({ lignes, complete: false, motif: '1 ligne(s) lue(s) sur 2' })

// ── Les refus, confrontés au texte exporté des trois fonctions ──────────────────────────────────────────────────────
const FONCTIONS = [
  {
    nom: 'proposer_justificatif', liste: REFUS_PROPOSER, codes42501: ['acces'],
    valeurs: { exercice_fige: ['public.exercice_fige(p_dossier_id, extract(year from v_mouvement.date)::integer)'] } as Record<string, string[]>,
    parametres: Object.keys(argumentsDeProposer('d', 'm', 'p')),
  },
  {
    nom: 'retirer_proposition', liste: REFUS_RETIRER, codes42501: ['acces', 'pas_l_auteur'],
    valeurs: { deja_retiree: ["to_char(v_proposition.retire_le at time zone 'Europe/Paris', 'DD/MM/YYYY')"] } as Record<string, string[]>,
    parametres: Object.keys(argumentsDeRetirer('d', 'j')),
  },
  {
    nom: 'ecrire_precision_mouvement', liste: REFUS_PRECISION, codes42501: ['acces'],
    valeurs: {} as Record<string, string[]>,
    parametres: Object.keys(argumentsDeLaPrecision('d', 'm', 't')),
  },
] as const

describe.each(FONCTIONS)('les refus de $nom, tels que la migration les écrit', ({ nom, liste, codes42501, valeurs, parametres }) => {
  const sql = derniereDefinitionSql(nom)

  it('les mêmes messages, dans le même ordre, sous les mêmes numéros', () => {
    expect(liste.map((r) => r.modele)).toEqual(messagesSql(sql))
    expect(liste.map((r) => r.refus)).toEqual(numerosSql(sql))
    expect(new Set(liste.map((r) => r.cle)).size).toBe(liste.length)
  })

  it('les mêmes codes : 42501 pour l’accès (et l’auteur), 22023 pour les autres', () => {
    const codes = codesSql(sql)
    expect(codes).toHaveLength(liste.length)
    liste.forEach((r, i) => expect(codes[i], r.cle).toBe((codes42501 as readonly string[]).includes(r.cle) ? '42501' : '22023'))
  })

  it('les valeurs des « % » sont celles que le module écrit', () => {
    const args = argumentsSql(sql)
    liste.forEach((r, i) => {
      expect(args[i], r.cle).toEqual(valeurs[r.cle] ?? [])
      expect(nombreDeValeurs(r.modele), r.cle).toBe(args[i].length)
    })
  })

  it('les arguments portent les noms des paramètres de la fonction, dans leur ordre', () => {
    const signature = /function public\.\w+\(([^)]*)\)/.exec(sql)
    expect(signature).not.toBeNull()
    expect((signature as RegExpExecArray)[1].split(',').map((p) => p.trim().split(/\s+/)[0])).toEqual([...parametres])
  })

  it('vire au rouge sur une dérive plantée dans le texte de la fonction', () => {
    const second = `'${liste[1].modele.replace(/'/g, "''")}'`
    expect(sql).toContain(second)
    expect(messagesSql(sql.replace(second, "'Un autre mot.'"))).not.toEqual(liste.map((r) => r.modele))
    expect(numerosSql(sql.replace(/-- 2\./, '-- 22.'))).not.toEqual(liste.map((r) => r.refus))
  })
})

describe('la précision, telle que la base la juge', () => {
  const sql = derniereDefinitionSql('ecrire_precision_mouvement')
  it('les mêmes blancs ôtés, la même borne, comptée en caractères', () => {
    expect(BLANCS_D_UNE_PRECISION).toBe(' \t\n\r')
    expect(sql).toContain(String.raw`btrim(p_texte, E' \t\n\r') = ''`)
    expect(sql).toContain(`if length(p_texte) > ${LONGUEUR_MAX_PRECISION} then`)
  })

  const base = { dossierId: DOSSIER, gereLaBanque: true, mouvement: mouvement() }
  const cle = (texte: string) => refusDeLaPrecision({ ...base, texte })?.cle ?? null
  it('vide, ou faite des seuls blancs que la base ôte', () => {
    expect(cle('')).toBe('precision_vide')
    expect(cle(' \t\n\r ')).toBe('precision_vide')
    // Une espace insécable n'est pas un blanc pour `btrim(…, E' \t\n\r')` : la base l'accepterait.
    expect(cle(' ')).toBeNull()
    expect(cle('  Un loyer.  ')).toBeNull()
  })
  it('2 000 caractères au plus, une émoticône comptant pour un', () => {
    expect(cle('a'.repeat(2000))).toBeNull()
    expect(cle('a'.repeat(2001))).toBe('precision_trop_longue')
    const emoticones = '😀'.repeat(1500)
    expect(emoticones.length).toBe(3000)
    expect(longueurEnCaracteres(emoticones)).toBe(1500)
    expect(cle(emoticones)).toBeNull()
  })
  it('dans l’ordre : l’accès, le mouvement, puis le texte', () => {
    expect(refusDeLaPrecision({ ...base, gereLaBanque: false, texte: '' })?.message).toBe('Accès refusé à ce dossier.')
    expect(refusDeLaPrecision({ ...base, mouvement: mouvement({ dossier_id: 'd2' }), texte: '' })?.message)
      .toBe("Ce mouvement n'est pas un mouvement de ce dossier.")
    expect(refusDeLaPrecision({ ...base, texte: '' })?.message).toBe("Une précision vide ne s'écrit pas.")
    expect(refusDeLaPrecision({ ...base, texte: 'a'.repeat(2001) })?.message).toBe('Une précision tient en 2 000 caractères au plus.')
  })
})

describe('ce que proposer_justificatif refuserait', () => {
  const base = {
    dossierId: DOSSIER, gereLaBanque: true, mouvement: mouvement(), piece: { id: 'p1', dossier_id: DOSSIER },
    propositions: [] as JustificatifPropose[], exercicesValides: { lus: false } as const,
  }
  const cle = (o: Partial<typeof base> | Record<string, unknown>) => refusDeProposer({ ...base, ...o })?.cle ?? null

  it('accepte une pièce du dossier pour un mouvement du dossier', () => {
    expect(cle({})).toBeNull()
  })
  it('dans l’ordre de la fonction', () => {
    expect(cle({ gereLaBanque: false, mouvement: mouvement({ dossier_id: 'd2' }) })).toBe('acces')
    expect(cle({ mouvement: mouvement({ dossier_id: 'd2' }), piece: { id: 'p1', dossier_id: 'd2' } })).toBe('mouvement_hors_dossier')
    expect(cle({ piece: { id: 'p1', dossier_id: 'd2' }, propositions: [proposition()] })).toBe('piece_hors_dossier')
    expect(cle({ exercicesValides: { lus: true, annees: [2026] }, propositions: [proposition()] })).toBe('exercice_fige')
    expect(cle({ propositions: [proposition()] })).toBe('deja_proposee')
  })
  it('la même pièce déjà proposée, et pas retirée, pour CE mouvement seulement', () => {
    expect(cle({ propositions: [proposition({ retire_le: '2026-09-22T08:00:00Z', retire_par: MOI })] })).toBeNull()
    expect(cle({ propositions: [proposition({ ligne_bancaire_id: 'l2' })] })).toBeNull()
    expect(cle({ propositions: [proposition({ piece_id: 'p2' })] })).toBeNull()
  })
  it('l’exercice figé, seulement quand l’appelant lit les exercices validés : au 31 décembre du dernier', () => {
    const fige = (date: string, annees: number[]) =>
      refusDeProposer({ ...base, mouvement: mouvement({ date }), exercicesValides: { lus: true, annees } })?.message ?? null
    expect(fige('2025-12-31', [2024, 2025])).toBe("L'exercice 2025 est validé : un justificatif ne s'y propose plus.")
    expect(fige('2026-01-01', [2024, 2025])).toBeNull()
    expect(fige('2023-06-30', [2025])).toBe("L'exercice 2023 est figé par la validation de l'exercice 2025 : un justificatif ne s'y propose plus.")
    expect(fige('2023-06-30', [])).toBeNull()
    // Le client ne lit pas les exercices validés : rien n'est affirmé, ni dans un sens ni dans l'autre.
    expect(refusDeProposer({ ...base, mouvement: mouvement({ date: '2001-01-01' }) })).toBeNull()
  })
  it('exercice_fige : « validé », sinon le premier exercice validé après lui', () => {
    expect(exerciceFige(2024, [2024, 2026])).toBe("L'exercice 2024 est validé")
    expect(exerciceFige(2023, [2022, 2024, 2026])).toBe("L'exercice 2023 est figé par la validation de l'exercice 2024")
  })
})

describe('ce que retirer_proposition refuserait', () => {
  const base = { dossierId: DOSSIER, gereLaBanque: true, proposition: proposition(), appelant: MOI, estCabinet: false }
  const cle = (o: Record<string, unknown>) => refusDeRetirer({ ...base, ...o })?.cle ?? null
  it('son auteur la retire ; le cabinet aussi ; un autre accès, non', () => {
    expect(cle({})).toBeNull()
    expect(cle({ appelant: 'u-cabinet', estCabinet: true })).toBeNull()
    expect(cle({ appelant: 'u-autre' })).toBe('pas_l_auteur')
  })
  it('dans l’ordre de la fonction', () => {
    const retiree = proposition({ retire_le: '2026-09-22T08:00:00Z', retire_par: MOI })
    expect(cle({ gereLaBanque: false, proposition: { ...retiree, dossier_id: 'd2' } })).toBe('acces')
    expect(cle({ proposition: { ...retiree, dossier_id: 'd2' }, appelant: 'u-autre' })).toBe('proposition_hors_dossier')
    expect(cle({ proposition: retiree, appelant: 'u-autre' })).toBe('pas_l_auteur')
    expect(cle({ proposition: retiree })).toBe('deja_retiree')
  })
  it('la date d’un retrait, au jour de Paris', () => {
    const tard = proposition({ retire_le: '2026-03-31T22:30:00Z', retire_par: MOI })
    expect(refusDeRetirer({ ...base, proposition: tard })?.message).toBe('Cette proposition est déjà retirée, depuis le 01/04/2026.')
  })
})

// ── L'état d'un mouvement ────────────────────────────────────────────────────────────────────────────────────────
describe('l’état d’un mouvement, pour le client', () => {
  const etat = (o: Partial<MouvementDuClient>, propositions = 0, question = false) => etatDuMouvement(mouvement(o), propositions, question)

  it('rapproché : d’une pièce ou d’un virement groupé, justifié par une pièce ; classé sans pièce, par le relevé', () => {
    expect(etat({ statut: 'rapprochee', piece_id: 'p1' })).toBe('justifie_piece')
    expect(etat({ statut: 'rapprochee', reglement_groupe: true })).toBe('justifie_piece')
    for (const lien of [{ categorie_id: 'c1' }, { emprunt_id: 'e1' }, { cotisation_id: 'k1' }, { ventilee: true },
      { compte_bilan: '580000' }, { declaration_tva_id: 't1' }]) {
      expect(etat({ statut: 'rapprochee', ...lien }), JSON.stringify(lien)).toBe('justifie_releve')
    }
    // Rapproché sans aucun lien lisible : le cabinet l'a traité, sans qu'on sache dire comment.
    expect(etat({ statut: 'rapprochee' })).toBe('traite')
  })
  it('un virement personnel est justifié par le relevé ; un mouvement ignoré n’attend rien', () => {
    expect(etat({ statut: 'ignoree', prelevement_personnel: true })).toBe('justifie_releve')
    expect(etat({ statut: 'ignoree' })).toBe('rien_a_fournir')
    expect(etat({ statut: 'ignoree' }, 1, true)).toBe('rien_a_fournir')
  })
  it('à traiter : une pièce envoyée l’emporte sur la question ; sinon la question, sinon rien', () => {
    expect(etat({}, 1, true)).toBe('propose')
    expect(etat({}, 0, true)).toBe('demande')
    expect(etat({}, 0, false)).toBe('sans_justificatif')
    expect(etat({ statut: 'rapprochee', piece_id: 'p1' }, 1, true)).toBe('justifie_piece')
  })
  it('ce qui attend une pièce, et ce qu’on peut proposer', () => {
    expect(ETATS_DU_MOUVEMENT.filter(attendUnePiece)).toEqual(['sans_justificatif', 'demande'])
    expect(proposableParLeClient(mouvement(), 'sans_justificatif')).toBe(true)
    expect(proposableParLeClient(mouvement({ statut: 'rapprochee' }), 'traite')).toBe(false)
    expect(proposableParLeClient(mouvement({ statut: 'ignoree' }), 'rien_a_fournir')).toBe(false)
    expect(proposableParLeClient(mouvement({ prelevement_personnel: true }), 'sans_justificatif')).toBe(false)
    // Étape VF5g : un mouvement réservé aux encaissements de ses factures reste à traiter, et ne prend pourtant aucune pièce ;
    // tout autre état d'un mouvement à traiter en prend une.
    expect(proposableParLeClient(mouvement(), 'encaissement_enregistre')).toBe(false)
    for (const e of ETATS_DU_MOUVEMENT.filter((x) => x !== 'encaissement_enregistre')) {
      expect(proposableParLeClient(mouvement(), e), e).toBe(true)
    }
  })
  it('chaque état a son libellé, tutoyé, et chaque filtre range chaque état', () => {
    expect(Object.keys(LIBELLE_DE_L_ETAT)).toEqual([...ETATS_DU_MOUVEMENT])
    for (const e of ETATS_DU_MOUVEMENT) {
      const filtres = FILTRES_D_ETAT.filter((f) => f.valeur !== 'tous' && correspondAuFiltre(e, f.valeur))
      expect(filtres, e).toHaveLength(1)
      expect(correspondAuFiltre(e, 'tous')).toBe(true)
    }
    expect(correspondAuFiltre('traite', 'justifie')).toBe(true)
    expect(correspondAuFiltre('demande', 'attend')).toBe(true)
    // Étape VF5g : classé, il est justifié ; réservé, il attend son cabinet comme un justificatif envoyé.
    expect(correspondAuFiltre('encaissement_factures', 'justifie')).toBe(true)
    expect(correspondAuFiltre('encaissement_enregistre', 'propose')).toBe(true)
    expect(Object.values(LIBELLE_DE_L_ETAT).flatMap(motsDuCabinet)).toEqual([])
  })
})

describe('les situations du relevé', () => {
  const sources = (o: Partial<Parameters<typeof situationsDuReleve>[0]> = {}) => ({
    mouvements: lue([mouvement(), mouvement({ id: 'l2', statut: 'rapprochee', reglement_groupe: true }),
      mouvement({ id: 'l3', statut: 'rapprochee', piece_id: 'p9' })]),
    propositions: lue<JustificatifPropose>([]),
    precisions: lue<PrecisionMouvement>([]),
    reglements: lue([part({ ligne_bancaire_id: 'l2', piece_id: 'p1' }), part({ id: 'r2', ligne_bancaire_id: 'l2', piece_id: 'p2' })]),
    ventes: BANQUE_SEULE,
    ...o,
  })

  it('muettes sur une lecture partielle des mouvements, des propositions ou du fil', () => {
    expect(situationsDuReleve(sources({ mouvements: partielle([mouvement()]) })).lues).toBe(false)
    expect(situationsDuReleve(sources({ propositions: partielle([]) })).lues).toBe(false)
    expect(situationsDuReleve(sources({ precisions: partielle([]) }))).toEqual({ lues: false, motif: 'les précisions n’ont pas été lues en entier' })
  })

  it('les parts lues en partie ne taisent que les pièces des virements groupés', () => {
    const s = situationsDuReleve(sources({ reglements: partielle([part({ ligne_bancaire_id: 'l2' })]) }))
    if (!s.lues) throw new Error('muettes')
    expect(s.parMouvement.get('l2')?.etat).toBe('justifie_piece')
    expect(s.parMouvement.get('l2')?.piecesQuiJustifient).toBeNull()
    expect(s.parMouvement.get('l3')?.piecesQuiJustifient).toEqual(['p9'])
    expect(s.parMouvement.get('l1')?.piecesQuiJustifient).toEqual([])
  })

  it('les pièces d’un virement groupé, lues en entier', () => {
    const s = situationsDuReleve(sources())
    if (!s.lues) throw new Error('muettes')
    expect(s.parMouvement.get('l2')?.piecesQuiJustifient).toEqual(['p1', 'p2'])
  })

  it('une proposition retirée ne compte plus ; le fil se lit dans l’ordre où il s’est écrit', () => {
    const s = situationsDuReleve(sources({
      propositions: lue([
        proposition({ id: 'j2', created_at: '2026-09-23T08:00:00Z' }),
        proposition({ id: 'j1', retire_le: '2026-09-22T08:00:00Z', retire_par: MOI }),
        proposition({ id: 'j3', created_at: '2026-09-22T08:00:00Z', piece_id: 'p3' }),
      ]),
      precisions: lue([
        precision({ id: 'q2', origine: 'client', auteur_id: MOI, created_at: '2026-09-22T09:00:00Z' }),
        precision({ id: 'q1' }),
      ]),
    }))
    if (!s.lues) throw new Error('muettes')
    const l1 = s.parMouvement.get('l1')
    expect(l1?.propositions.map((p) => p.id)).toEqual(['j3', 'j2'])
    expect(l1?.precisions.map((p) => p.id)).toEqual(['q1', 'q2'])
    expect(l1?.questionEnAttente).toBe(false)
    expect(l1?.etat).toBe('propose')
  })

  it('la question du cabinet attend tant que le client n’a pas répondu après elle', () => {
    const avec = (precisions: PrecisionMouvement[]) => {
      const s = situationsDuReleve(sources({ precisions: lue(precisions) }))
      if (!s.lues) throw new Error('muettes')
      return s.parMouvement.get('l1')
    }
    expect(avec([precision()])?.etat).toBe('demande')
    expect(avec([precision(), precision({ id: 'q2', origine: 'client', created_at: '2026-09-22T09:00:00Z' })])?.etat).toBe('sans_justificatif')
    // À instant égal, l'identifiant départage : « q0 » vient avant « q1 », la question du cabinet reste la dernière.
    expect(avec([precision(), precision({ id: 'q0', origine: 'client' })])?.questionEnAttente).toBe(true)
    // Un message d'un autre mouvement ne répond pas.
    expect(avec([precision(), precision({ id: 'q2', origine: 'client', ligne_bancaire_id: 'l2', created_at: '2026-09-22T09:00:00Z' })])?.etat).toBe('demande')
  })
})

// ── Les encaissements de ses factures (étape VF5g) ───────────────────────────────────────────────────────────────
describe('les encaissements des factures d’un client « Ventes »', () => {
  // Un crédit libre que l'encaissement e1 de F2026-0001 RÉSERVE ; un crédit que ses encaissements CLASSENT.
  const reserve = mouvement({ montant: 100 })
  const classe = mouvement({ id: 'l2', montant: 250, statut: 'rapprochee', encaissements_de_factures: true })
  const ventes = (factures: FactureDuClient[], encaissements: EncaissementDuClient[]): VentesDuClient =>
    ({ droit: 'ventes', lues: true, factures, encaissements })
  const registre = ventes(
    [facture(), facture({ id: 'f2', numero: 'F2026-0002' }), facture({ id: 'f3', numero: 'F2026-0003' })],
    [
      encaissement(),
      // Deux factures sur le mouvement classé, la seconde enregistrée la première : l'ordre de la garde, sans doublon.
      encaissement({ id: 'e3', facture_id: 'f3', ligne_bancaire_id: 'l2', montant: 150, cree_le: '2026-09-22T08:00:00Z' }),
      encaissement({ id: 'e2', facture_id: 'f2', ligne_bancaire_id: 'l2', montant: 50, cree_le: '2026-09-20T08:00:00Z' }),
      encaissement({ id: 'e4', facture_id: 'f3', ligne_bancaire_id: 'l2', montant: 50, cree_le: '2026-09-23T08:00:00Z' }),
    ],
  )
  const PARTIEL: VentesDuClient = { droit: 'ventes', lues: false, motif: ENCAISSEMENTS_LUS_EN_PARTIE }

  it('les deux lectures entières, composées : toutes du dossier, ou le motif de la première qui en sort', () => {
    expect(ventesLues(DOSSIER, [facture()], [encaissement()]))
      .toEqual({ droit: 'ventes', lues: true, factures: [facture()], encaissements: [encaissement()] })
    expect(ventesLues(DOSSIER, [facture({ dossier_id: 'd2' })], [encaissement({ dossier_id: 'd2' })]))
      .toEqual({ droit: 'ventes', lues: false, motif: 'tes factures n’ont pas été lues pour cette seule société' })
    expect(ventesLues(DOSSIER, [facture()], [encaissement(), encaissement({ id: 'e9', dossier_id: 'd2' })]))
      .toEqual({ droit: 'ventes', lues: false, motif: 'les encaissements de tes factures n’ont pas été lus pour cette seule société' })
    // Rien encore de facturé : lu, et vide.
    expect(ventesLues(DOSSIER, [], [])).toEqual({ droit: 'ventes', lues: true, factures: [], encaissements: [] })
    // Les motifs d'une lecture partielle, que l'écran dit (ClientBanque.test.tsx), tutoyés.
    expect([FACTURES_LUES_EN_PARTIE, ENCAISSEMENTS_LUS_EN_PARTIE]).toEqual(['tes factures n’ont pas été lues en entier',
      'les encaissements de tes factures n’ont pas été lus en entier'])
  })

  it('le registre lu : classé, réservé, avec les numéros de leurs factures dans l’ordre de la garde', () => {
    expect(venteDuMouvement(reserve, registre)).toEqual({ vente: 'reserve', factures: ['F2026-0001'] })
    expect(venteDuMouvement(classe, registre)).toEqual({ vente: 'classe', factures: ['F2026-0002', 'F2026-0003'] })
    expect(venteDuMouvement(mouvement({ id: 'l9' }), registre)).toEqual({ vente: null, factures: [] })
  })

  it('ne réservent que les encaissements vivants, d’une facture source, qui justifient le mouvement', () => {
    expect(venteDuMouvement(reserve, ventes([facture({ source_de_la_vente: false })], [encaissement()])).vente).toBeNull()
    expect(venteDuMouvement(reserve, ventes([facture()], [encaissement({ retire_le: '2026-09-22T08:00:00Z' })])).vente).toBeNull()
    expect(venteDuMouvement(reserve, ventes([facture()], [encaissement({ ligne_bancaire_id: 'l9' })])).vente).toBeNull()
    expect(venteDuMouvement(reserve, ventes([facture()], [encaissement({ ligne_bancaire_id: null })])).vente).toBeNull()
    // Contre-passé SANS mouvement, l'encaissement n'a pas eu lieu sur ce crédit ; en citant un débit, il l'a justifié.
    const contrePasse = (ligne: string | null) => ventes([facture()], [
      encaissement(), encaissement({ id: 'c1', montant: -100, annule_id: 'e1', ligne_bancaire_id: ligne, cree_le: '2026-10-01T08:00:00Z' }),
    ])
    expect(venteDuMouvement(reserve, contrePasse(null)).vente).toBeNull()
    expect(venteDuMouvement(reserve, contrePasse('l7')).vente).toBe('reserve')
    // Le débit que cette contre-passation cite est réservé, lui aussi.
    expect(venteDuMouvement(mouvement({ id: 'l7', montant: -100 }), contrePasse('l7'))).toEqual({ vente: 'reserve', factures: ['F2026-0001'] })
  })

  it('un client « Banque » seul n’en apprend rien (VF5-Q3), même du mouvement que la colonne dit classé', () => {
    expect(venteDuMouvement(reserve, BANQUE_SEULE)).toEqual({ vente: null, factures: [] })
    expect(venteDuMouvement(classe, BANQUE_SEULE)).toEqual({ vente: null, factures: [] })
  })

  it('le registre lu en partie : un mouvement libre se tait ; tout autre garde ce que dit le relevé seul', () => {
    expect(venteDuMouvement(reserve, PARTIEL)).toEqual({ vente: 'tue' })
    expect(venteDuMouvement(classe, PARTIEL)).toEqual({ vente: null, factures: [] })
    for (const autre of [{ statut: 'rapprochee' as const, piece_id: 'p1' }, { statut: 'ignoree' as const }, { categorie_id: 'c1' },
      { prelevement_personnel: true }]) {
      expect(venteDuMouvement(mouvement(autre), PARTIEL), JSON.stringify(autre)).toEqual({ vente: null, factures: [] })
    }
  })

  it('les ventes l’emportent sur l’état d’hier ; sans elles, il reste', () => {
    for (const e of ETATS_DU_MOUVEMENT) {
      expect(etatAvecLesVentes(e, 'classe')).toBe('encaissement_factures')
      expect(etatAvecLesVentes(e, 'reserve')).toBe('encaissement_enregistre')
      expect(etatAvecLesVentes(e, null)).toBe(e)
    }
  })

  describe('dans les situations du relevé', () => {
    const sourcesVF5g = (v: VentesDuClient) => ({
      mouvements: lue([reserve, classe, mouvement({ id: 'l3', statut: 'rapprochee', piece_id: 'p9' })]),
      // Le client avait envoyé une pièce pour le mouvement réservé, et le cabinet lui avait posé une question.
      propositions: lue([proposition()]),
      precisions: lue([precision()]),
      reglements: lue<ReglementGroupe>([]),
      ventes: v,
    })

    it('« Ventes », lu : la réserve l’emporte sur la pièce envoyée et la question, qui restent dites', () => {
      const s = situationsDuReleve(sourcesVF5g(registre))
      if (!s.lues) throw new Error('muettes')
      expect(s.tus).toBeNull()
      const l1 = s.parMouvement.get('l1')
      expect(l1?.etat).toBe('encaissement_enregistre')
      expect(l1?.propositions.map((p) => p.id)).toEqual(['j1'])
      expect(l1?.questionEnAttente).toBe(true)
      expect(l1?.facturesDeLaVente).toEqual(['F2026-0001'])
      expect(s.parMouvement.get('l2')?.etat).toBe('encaissement_factures')
      expect(s.parMouvement.get('l2')?.facturesDeLaVente).toEqual(['F2026-0002', 'F2026-0003'])
      expect(s.parMouvement.get('l3')?.etat).toBe('justifie_piece')
      expect(s.parMouvement.get('l3')?.facturesDeLaVente).toEqual([])
    })

    it('« Banque » seul : les états d’hier', () => {
      const s = situationsDuReleve(sourcesVF5g(BANQUE_SEULE))
      if (!s.lues) throw new Error('muettes')
      expect(s.tus).toBeNull()
      expect(s.parMouvement.get('l1')?.etat).toBe('propose')
      expect(s.parMouvement.get('l2')?.etat).toBe('traite')
      expect(s.parMouvement.get('l1')?.facturesDeLaVente).toEqual([])
    })

    it('le registre lu en partie : le mouvement libre se tait, avec le motif ; les autres restent', () => {
      const s = situationsDuReleve(sourcesVF5g(PARTIEL))
      if (!s.lues) throw new Error('muettes')
      expect(s.parMouvement.has('l1')).toBe(false)
      expect(s.tus).toEqual({ ids: new Set(['l1']), motif: 'les encaissements de tes factures n’ont pas été lus en entier' })
      expect(s.parMouvement.get('l2')?.etat).toBe('traite')
      expect(s.parMouvement.get('l3')?.etat).toBe('justifie_piece')
      // Aucun mouvement libre : rien ne se tait, et rien ne le dit.
      const sansLibre = situationsDuReleve({ ...sourcesVF5g(PARTIEL), mouvements: lue([classe]) })
      if (!sansLibre.lues) throw new Error('muettes')
      expect(sansLibre.tus).toBeNull()
    })
  })

  it('le sens de chaque état neuf, selon le sens du mouvement, avec ses factures ; tutoyé, sans un mot du cabinet', () => {
    expect(sensDeLaVente('encaissement_factures', 250, ['F2026-0002', 'F2026-0003'])).toBe('Ton cabinet a classé ce mouvement par '
      + 'les encaissements de tes factures : il n’attend rien de toi. Facture(s) : F2026-0002, F2026-0003.')
    expect(sensDeLaVente('encaissement_factures', -120, [])).toBe('Ton cabinet a classé ce débit : il défait l’encaissement '
      + 'd’une de tes factures — un chèque revenu impayé, une somme rendue. Il n’attend rien de toi.')
    expect(sensDeLaVente('encaissement_enregistre', 100, ['F2026-0001'])).toBe('L’encaissement d’une de tes factures est '
      + 'enregistré sur ce mouvement : ton cabinet le classera par cet encaissement. Il n’attend pas de pièce de toi — une pièce '
      + 'envoyée ici ne pourrait pas lui être rattachée. Facture(s) : F2026-0001.')
    expect(sensDeLaVente('encaissement_enregistre', -360.8, [])).toBe('L’encaissement défait d’une de tes factures — un chèque '
      + 'revenu impayé, une somme rendue — est enregistré sur ce débit : ton cabinet le classera. Il n’attend pas de pièce de '
      + 'toi — une pièce envoyée ici ne pourrait pas lui être rattachée.')
    const phrases = (['encaissement_factures', 'encaissement_enregistre'] as const)
      .flatMap((e) => [sensDeLaVente(e, 1, ['F1']), sensDeLaVente(e, -1, [])])
    expect(phrases.flatMap(motsDuCabinet)).toEqual([])
  })
})

describe('la facture d’avant d’un virement mixte (étape VF8h ; VF5H-Q3)', () => {
  // Un crédit de 900 € que le cabinet a CLASSÉ par ses encaissements : F2026-0002, source de sa vente, et deux factures
  // d'avant la bascule, qui ne le sont pas — F2025-0187 en deux encaissements, F2025-0190. Puis un crédit libre que
  // l'encaissement de F2026-0002 RÉSERVE, et qui porte aussi celui d'une facture d'avant.
  const classe = mouvement({ id: 'l2', montant: 900, statut: 'rapprochee', encaissements_de_factures: true })
  const reserve = mouvement({ id: 'l3', montant: 300 })
  const registre: VentesDuClient = {
    droit: 'ventes', lues: true,
    factures: [
      facture({ id: 'f2', numero: 'F2026-0002' }),
      facture({ id: 'fa', numero: 'F2025-0187', source_de_la_vente: false }),
      facture({ id: 'fb', numero: 'F2025-0190', source_de_la_vente: false }),
      facture({ id: 'fc', numero: 'F2025-0199', source_de_la_vente: false }),
    ],
    encaissements: [
      // Dans l'ordre de la garde : ea1 (le 20), e2 (le 21), ea2 (le 22), eb (le 23) — la liste reçue dans un autre ordre.
      encaissement({ id: 'eb', facture_id: 'fb', ligne_bancaire_id: 'l2', montant: 200, cree_le: '2026-09-23T08:00:00Z' }),
      encaissement({ id: 'e2', facture_id: 'f2', ligne_bancaire_id: 'l2', montant: 400, cree_le: '2026-09-21T08:00:00Z' }),
      encaissement({ id: 'ea2', facture_id: 'fa', ligne_bancaire_id: 'l2', montant: 100, cree_le: '2026-09-22T08:00:00Z' }),
      encaissement({ id: 'ea1', facture_id: 'fa', ligne_bancaire_id: 'l2', montant: 200, cree_le: '2026-09-20T08:00:00Z' }),
      // Ce qui ne se nomme pas : l'encaissement retiré d'une autre facture d'avant, et un autre mouvement.
      encaissement({ id: 'ex', facture_id: 'fc', ligne_bancaire_id: 'l2', retire_le: '2026-09-24T08:00:00Z' }),
      encaissement({ id: 'ey', facture_id: 'fb', ligne_bancaire_id: 'l9', cree_le: '2026-09-19T08:00:00Z' }),
      // Le crédit réservé : l'encaissement de F2026-0002, et celui de F2025-0190, enregistré avant lui.
      encaissement({ id: 'e3', facture_id: 'f2', ligne_bancaire_id: 'l3', montant: 200, cree_le: '2026-09-25T08:00:00Z' }),
      encaissement({ id: 'eb3', facture_id: 'fb', ligne_bancaire_id: 'l3', montant: 100, cree_le: '2026-09-24T09:00:00Z' }),
    ],
  }
  const PARTIEL: VentesDuClient = { droit: 'ventes', lues: false, motif: ENCAISSEMENTS_LUS_EN_PARTIE }

  it('classé : les factures d’avant nommées avec les factures sources, ensemble, dans l’ordre de la garde, sans doublon', () => {
    expect(venteDuMouvement(classe, registre)).toEqual({ vente: 'classe', factures: ['F2025-0187', 'F2026-0002', 'F2025-0190'] })
    // Sans facture d'avant, la ligne d'hier.
    const sansAvant: VentesDuClient = { ...registre, encaissements: registre.encaissements.filter((e) => e.facture_id === 'f2') }
    expect(venteDuMouvement(classe, sansAvant)).toEqual({ vente: 'classe', factures: ['F2026-0002'] })
  })

  it('réservé : la facture d’avant nommée aussi, dans l’ordre de la garde (VF8H-Q1, écrite sur la recommandation)', () => {
    expect(venteDuMouvement(reserve, registre)).toEqual({ vente: 'reserve', factures: ['F2025-0190', 'F2026-0002'] })
    // La facture d'avant seule ne réserve rien : le mouvement reste libre.
    const avantSeule: VentesDuClient = { ...registre, encaissements: registre.encaissements.filter((e) => e.id === 'eb3') }
    expect(venteDuMouvement(reserve, avantSeule)).toEqual({ vente: null, factures: [] })
  })

  it('« Banque » seul : rien (VF5-Q3) ; le registre lu en partie : le classé garde ce que dit le relevé seul', () => {
    expect(venteDuMouvement(classe, BANQUE_SEULE)).toEqual({ vente: null, factures: [] })
    expect(venteDuMouvement(classe, PARTIEL)).toEqual({ vente: null, factures: [] })
    expect(venteDuMouvement(reserve, PARTIEL)).toEqual({ vente: 'tue' })
  })

  it('dans les situations du relevé, et dans la phrase du détail : la même ligne, tutoyée', () => {
    const sources = (v: VentesDuClient) => ({
      mouvements: lue([classe, reserve]), propositions: lue<JustificatifPropose>([]), precisions: lue<PrecisionMouvement>([]),
      reglements: lue<ReglementGroupe>([]), ventes: v,
    })
    const s = situationsDuReleve(sources(registre))
    if (!s.lues) throw new Error('muettes')
    expect(s.parMouvement.get('l2')?.etat).toBe('encaissement_factures')
    expect(s.parMouvement.get('l2')?.facturesDeLaVente).toEqual(['F2025-0187', 'F2026-0002', 'F2025-0190'])
    expect(s.parMouvement.get('l3')?.facturesDeLaVente).toEqual(['F2025-0190', 'F2026-0002'])
    const banque = situationsDuReleve(sources(BANQUE_SEULE))
    if (!banque.lues) throw new Error('muettes')
    expect(banque.parMouvement.get('l2')).toMatchObject({ etat: 'traite', facturesDeLaVente: [] })
    const phrase = sensDeLaVente('encaissement_factures', classe.montant, s.parMouvement.get('l2')?.facturesDeLaVente ?? [])
    expect(phrase).toBe('Ton cabinet a classé ce mouvement par les encaissements de tes factures : il n’attend rien de toi. '
      + 'Facture(s) : F2025-0187, F2026-0002, F2025-0190.')
    expect(motsDuCabinet(phrase)).toEqual([])
  })
})

// ── Le solde, la couverture ──────────────────────────────────────────────────────────────────────────────────────
describe('le solde, LU au dernier relevé contrôlé', () => {
  it('le plus récent des relevés cohérents et datés', () => {
    expect(soldeAuReleve(lue([
      controle({ id: 'c1', periode_fin: '2026-07-31', solde_final: 1 }),
      controle({ id: 'c2', periode_fin: '2026-08-31', solde_final: 2 }),
      controle({ id: 'c3', periode_fin: '2026-09-30', solde_final: 3, coherent: false }),
      controle({ id: 'c4', periode_fin: null, solde_final: 4 }),
    ]))).toEqual({ etat: 'lu', solde: 2, au: '2026-08-31' })
  })
  it('à fin de période égale, le contrôle enregistré le dernier', () => {
    expect(soldeAuReleve(lue([
      controle({ id: 'c2', created_at: '2026-09-03T08:00:00Z', solde_final: 2 }),
      controle({ id: 'c1', created_at: '2026-09-02T08:00:00Z', solde_final: 1 }),
    ]))).toEqual({ etat: 'lu', solde: 2, au: '2026-08-31' })
    expect(soldeAuReleve(lue([
      controle({ id: 'c1', solde_final: 1 }), controle({ id: 'c2', solde_final: 2 }),
    ]))).toEqual({ etat: 'lu', solde: 2, au: '2026-08-31' })
  })
  it('aucun relevé ; des relevés sans solde sûr ; une lecture partielle', () => {
    expect(soldeAuReleve(lue([]))).toEqual({ etat: 'aucun_releve' })
    expect(soldeAuReleve(lue([controle({ coherent: false }), controle({ id: 'c2', periode_fin: null })])))
      .toEqual({ etat: 'aucun_solde_sur', releves: 2 })
    expect(soldeAuReleve(partielle([controle()])).etat).toBe('muet')
  })
})

describe('les mois que le relevé couvre', () => {
  const couverture = (dates: string[]) => couvertureDuReleve(lue(dates.map((date) => ({ date }))))
  it('le premier et le dernier mois, les mois couverts et ceux sans mouvement entre eux, par-delà l’année', () => {
    expect(couverture(['2026-02-03', '2025-11-30', '2025-11-02', '2026-02-28'])).toEqual({
      etat: 'lue', premierMois: '2025-11', dernierMois: '2026-02', moisCouverts: 2, moisSansMouvement: ['2025-12', '2026-01'],
      dernierMouvement: '2026-02-28',
    })
    expect(couverture(['2026-09-01'])).toEqual({
      etat: 'lue', premierMois: '2026-09', dernierMois: '2026-09', moisCouverts: 1, moisSansMouvement: [], dernierMouvement: '2026-09-01',
    })
  })
  it('vide, ou muette sur une lecture partielle', () => {
    expect(couverture([])).toEqual({ etat: 'vide' })
    expect(couvertureDuReleve(partielle([{ date: '2026-09-01' }])).etat).toBe('muet')
  })
  it('le nom d’un mois', () => {
    expect(libelleDuMois('2026-03')).toBe('mars 2026')
    expect(libelleDuMois('2025-12')).toBe('décembre 2025')
  })
  it('les années du relevé, la plus récente d’abord', () => {
    expect(anneesDuReleve([{ date: '2025-01-01' }, { date: '2026-12-31' }, { date: '2025-06-01' }])).toEqual([2026, 2025])
  })
})

describe('qui voit « Ma banque »', () => {
  it('la case « Banque », et seulement une fois la banque du client en base', () => {
    expect(maBanqueOuverte(true, true)).toBe(true)
    expect(maBanqueOuverte(true, false)).toBe(false)
    expect(maBanqueOuverte(false, true)).toBe(false)
    expect(maBanqueOuverte(false, false)).toBe(false)
  })
})

describe('ce que l’écran lit, et qui a écrit', () => {
  it('les colonnes lues sont celles du type, sans rien de plus', () => {
    const attendues: (keyof MouvementDuClient)[] = ['id', 'dossier_id', 'date', 'libelle', 'montant', 'statut', 'piece_id',
      'cotisation_id', 'categorie_id', 'emprunt_id', 'ventilee', 'reglement_groupe', 'compte_bilan', 'declaration_tva_id',
      'prelevement_personnel', 'encaissements_de_factures', 'created_at']
    expect(COLONNES_DU_MOUVEMENT.split(', ')).toEqual(attendues)
    // Étape VF5g : ce que la garde G2 lit d'une facture et d'un encaissement, et rien de plus — ni montant ni client d'une
    // facture, ni moyen ni auteur d'un encaissement.
    const deLaFacture: (keyof FactureDuClient)[] = ['id', 'dossier_id', 'numero', 'type', 'statut', 'facture_origine_id', 'source_de_la_vente']
    expect(COLONNES_DES_FACTURES.split(', ')).toEqual(deLaFacture)
    const deLEncaissement: (keyof EncaissementDuClient)[] = ['id', 'dossier_id', 'facture_id', 'montant', 'ligne_bancaire_id',
      'annule_id', 'retire_le', 'cree_le']
    expect(COLONNES_DES_ENCAISSEMENTS.split(', ')).toEqual(deLEncaissement)
    // Ni montant, ni catégorie, ni tiers d'une pièce : son nom et son jour de dépôt.
    expect(COLONNES_DE_LA_PIECE).toBe('id, dossier_id, nom_fichier, created_at')
  })
  it('l’auteur, vu du client', () => {
    expect(auteurPourLeClient({ origine: 'cabinet', auteur_id: MOI }, MOI)).toBe('Ton cabinet')
    expect(auteurPourLeClient({ origine: 'client', auteur_id: MOI }, MOI)).toBe('Toi')
    expect(auteurPourLeClient({ origine: 'client', auteur_id: 'u-autre' }, MOI)).toBe('Un autre accès de ta société')
  })
})

describe('un module pur', () => {
  it('n’atteint pas supabase.ts, ni par lui-même ni par ce qu’il importe', () => {
    const racine = new URL('./', import.meta.url).pathname
    const vus = new Set<string>()
    const aVoir = ['banqueClient.ts']
    while (aVoir.length > 0) {
      const fichier = aVoir.pop() as string
      if (vus.has(fichier)) continue
      vus.add(fichier)
      const texte = readFileSync(racine + fichier, 'utf8')
      for (const m of texte.matchAll(/^import (?!type )[\s\S]*?from '\.\/([\w.]+)'/gm)) aVoir.push(/\.tsx?$/.test(m[1]) ? m[1] : `${m[1]}.ts`)
    }
    expect(vus.size).toBeGreaterThan(3)
    expect([...vus]).not.toContain('supabase.ts')
  })
})

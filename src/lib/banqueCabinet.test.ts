import { describe, expect, it } from 'vitest'
import {
  accesDuReleveDeLaLecture, associable, auteurDuMessage, ceQueVoitLeClient, envoisDeLaLecture, envoisDuMouvement,
  etatDeLaProposition, etatDuFiltreProposes, gardeParLeFiltre, lecteursDeLaQuestion, mouvementsProposesParLeClient,
  phraseDeLaProposition, phraseDeLEtat, phraseDuRetrait, signauxDeLaProposition, silenceDesEnvois, titreDesPropositions,
  type ContexteDeLaProposition, type EnvoisDuClient,
} from './banqueCabinet'
import type { AccesDuDossier } from './auteursVentes'
import type { JustificatifPropose, LigneBancaire, Piece, PrecisionMouvement } from './types'

function proposition(o: Partial<JustificatifPropose> = {}): JustificatifPropose {
  return {
    id: 'prop-1', dossier_id: 'd1', ligne_bancaire_id: 'l1', piece_id: 'p1', auteur_id: 'client-1', origine: 'client',
    created_at: '2026-06-05T10:00:00Z', retire_le: null, retire_par: null, ...o,
  }
}

function precision(o: Partial<PrecisionMouvement> = {}): PrecisionMouvement {
  return {
    id: 'q1', dossier_id: 'd1', ligne_bancaire_id: 'l1', auteur_id: 'cabinet-1', origine: 'cabinet', texte: 'De quoi s’agit-il ?',
    created_at: '2026-06-06T10:00:00Z', ...o,
  }
}

function ligne(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return {
    id: 'l1', dossier_id: 'd1', date: '2026-06-02', montant: -100, libelle: 'PRLV FICTIF', libelle_brut: null,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
    reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2026-06-02T09:00:00Z', ...o,
  }
}

function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: 'd1/fictive.pdf', nom_fichier: 'fictive.pdf',
    storage_hash: null, date_piece: '2026-06-01', tiers: 'Fournisseur fictif', montant_ht: null, montant_tva: null, montant_ttc: 100,
    devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null,
    type_piece: 'achat', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null,
    lisible_path: null, identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null,
    created_at: '2026-06-01T09:00:00Z', updated_at: '2026-06-01T09:00:00Z', ...o,
  }
}

const LUS: AccesDuDossier = { etat: 'lus', comptes: ['client-1'] }
const lues = <T,>(lignes: T[]) => ({ lignes, complete: true, motif: null })

function contexte(o: Partial<ContexteDeLaProposition> = {}): ContexteDeLaProposition {
  return {
    ligne: ligne(), figeePar: null, piecesDuReglement: [], pieces: [piece()], piecesLuesEnEntier: true, piecesFigees: new Set(),
    horsRapprochement: new Set(), restesARegler: new Map(), paiementsDeLaPiece: [], refusSecondPaiement: null, ...o,
  }
}

describe('les envois du client, lus ensemble', () => {
  it('lus en entier : les deux listes', () => {
    const e = envoisDeLaLecture(lues([proposition()]), lues([precision()]))
    expect(e).toEqual({ etat: 'lus', propositions: [proposition()], precisions: [precision()] })
    expect(silenceDesEnvois(e)).toBeNull()
  })

  it('l’une ou l’autre partielle : rien, même des lignes revenues, et le motif nommé', () => {
    const p = envoisDeLaLecture({ lignes: [proposition()], complete: false, motif: '1 sur 2' }, lues([]))
    expect(p).toEqual({ etat: 'incomplets', motif: 'les pièces proposées n’ont pas été lues en entier (1 sur 2)' })
    const q = envoisDeLaLecture(lues([]), { lignes: [], complete: false, motif: null })
    expect(q).toEqual({ etat: 'incomplets', motif: 'le fil des mouvements n’a pas été lu en entier (lecture incomplète)' })
    expect(silenceDesEnvois(q)).toBe('Rien n’est dit de ce que le client a envoyé : le fil des mouvements n’a pas été lu en entier (lecture incomplète). Recharge la page.')
    expect(silenceDesEnvois({ etat: 'en_cours' })).toBe('Les pièces proposées par le client et le fil sont en cours de lecture.')
  })
})

describe('les accès du dossier', () => {
  it('lus en entier : les comptes et le nombre d’accès « Banque »', () => {
    const a = accesDuReleveDeLaLecture(lues([
      { user_id: 'client-1', droit_banque: true }, { user_id: 'client-2', droit_banque: false }, { user_id: 'client-1', droit_banque: false },
    ]))
    expect(a).toEqual({ acces: { etat: 'lus', comptes: ['client-1', 'client-2'] }, avecBanque: 1 })
    expect(lecteursDeLaQuestion(a)).toBeNull()
  })

  it('aucun accès « Banque » sur une liste entière : la question n’a pas de lecteur, et c’est dit', () => {
    const a = accesDuReleveDeLaLecture(lues([{ user_id: 'client-1', droit_banque: false }]))
    expect(a.avecBanque).toBe(0)
    expect(lecteursDeLaQuestion(a)).toMatch(/^Aucun accès de ce dossier ne porte la case « Banque »/)
    expect(lecteursDeLaQuestion(accesDuReleveDeLaLecture(lues([])))).not.toBeNull()
  })

  it('partielle : aucun compte reconnu, et rien sur les lecteurs', () => {
    const a = accesDuReleveDeLaLecture({ lignes: [{ user_id: 'client-1', droit_banque: true }], complete: false, motif: '1 sur 3' })
    expect(a).toEqual({ acces: { etat: 'incomplets', motif: '1 sur 3' }, avecBanque: null })
    expect(lecteursDeLaQuestion(a)).toBeNull()
    expect(accesDuReleveDeLaLecture({ lignes: [], complete: false, motif: null }).acces).toEqual({ etat: 'incomplets', motif: 'lecture incomplète' })
  })
})

describe('qui a proposé, qui a écrit', () => {
  it('l’origine écrite par la base, le compte reconnu parmi les accès lus', () => {
    expect(phraseDeLaProposition(LUS, proposition())).toBe('Proposée par le client le 05/06/2026')
    expect(phraseDeLaProposition(LUS, proposition({ origine: 'cabinet', auteur_id: 'cabinet-1' }))).toBe('Proposée par le cabinet le 05/06/2026')
  })

  it('un accès retiré n’est pas deviné, et des accès pas lus ne reconnaissent personne', () => {
    expect(phraseDeLaProposition({ etat: 'lus', comptes: [] }, proposition()))
      .toBe('Proposée depuis l’espace client le 05/06/2026, par un compte qui ne porte plus d’accès à ce dossier')
    expect(phraseDeLaProposition({ etat: 'en_cours' }, proposition()))
      .toBe('Proposée depuis l’espace client le 05/06/2026 (les accès du dossier sont en cours de lecture)')
    expect(phraseDeLaProposition({ etat: 'incomplets', motif: 'x' }, proposition()))
      .toBe('Proposée depuis l’espace client le 05/06/2026 (les accès du dossier n’ont pas été lus en entier : le compte n’est pas reconnu)')
    expect(phraseDeLaProposition({ etat: 'sans_objet' }, proposition())).toBe('Proposée depuis l’espace client le 05/06/2026')
  })

  it('le retrait : par son auteur, sinon par le cabinet (seuls admis par la base)', () => {
    expect(phraseDuRetrait(proposition())).toBeNull()
    expect(phraseDuRetrait(proposition({ retire_le: '2026-06-07T10:00:00Z', retire_par: 'client-1' }))).toBe('retirée le 07/06/2026 par son auteur')
    expect(phraseDuRetrait(proposition({ retire_le: '2026-06-07T10:00:00Z', retire_par: 'cabinet-1' }))).toBe('retirée le 07/06/2026 par le cabinet')
  })

  it('l’auteur d’un message du fil', () => {
    expect(auteurDuMessage(LUS, precision())).toBe('Le cabinet')
    expect(auteurDuMessage(LUS, precision({ origine: 'client', auteur_id: 'client-1' }))).toBe('Le client')
    expect(auteurDuMessage({ etat: 'lus', comptes: [] }, precision({ origine: 'client', auteur_id: 'client-1' })))
      .toBe('Depuis l’espace client, un compte qui ne porte plus d’accès à ce dossier')
    expect(auteurDuMessage({ etat: 'incomplets', motif: 'x' }, precision({ origine: 'client', auteur_id: 'client-1' }))).toBe('Depuis l’espace client')
  })
})

describe('les envois d’un mouvement', () => {
  const envois: Extract<EnvoisDuClient, { etat: 'lus' }> = {
    etat: 'lus',
    propositions: [
      proposition({ id: 'a', created_at: '2026-06-03T10:00:00Z' }),
      proposition({ id: 'b', piece_id: 'p2', created_at: '2026-06-05T10:00:00Z' }),
      proposition({ id: 'c', piece_id: 'p3', created_at: '2026-06-04T10:00:00Z', retire_le: '2026-06-04T11:00:00Z', retire_par: 'client-1' }),
      proposition({ id: 'd', ligne_bancaire_id: 'l2' }),
    ],
    precisions: [
      precision({ id: 'q2', origine: 'client', auteur_id: 'client-1', created_at: '2026-06-07T10:00:00Z' }),
      precision({ id: 'q1', created_at: '2026-06-06T10:00:00Z' }),
      precision({ id: 'q3', ligne_bancaire_id: 'l2' }),
    ],
  }

  it('les courantes la plus récente d’abord, les retirées à part, le fil dans l’ordre écrit', () => {
    const e = envoisDuMouvement(envois, 'l1')
    expect(e.courantes.map((p) => p.id)).toEqual(['b', 'a'])
    expect(e.retirees.map((p) => p.id)).toEqual(['c'])
    expect(e.fil.map((q) => q.id)).toEqual(['q1', 'q2'])
    expect(e.questionEnAttente).toBe(false)
  })

  it('le dernier message du cabinet attend une réponse ; à instant égal, l’identifiant départage', () => {
    const e = envoisDuMouvement({ ...envois, precisions: [precision({ id: 'z', origine: 'client' }), precision({ id: 'y' })] }, 'l1')
    expect(e.fil.map((q) => q.id)).toEqual(['y', 'z'])
    expect(e.questionEnAttente).toBe(false)
    expect(envoisDuMouvement({ ...envois, precisions: [precision()] }, 'l1').questionEnAttente).toBe(true)
    expect(envoisDuMouvement({ ...envois, precisions: [] }, 'l1').questionEnAttente).toBe(false)
  })

  it('le titre, et ce que voit le client', () => {
    expect(titreDesPropositions([{ origine: 'client' }])).toBe('Pièce proposée par le client')
    expect(titreDesPropositions([{ origine: 'client' }, { origine: 'client' }])).toBe('2 pièces proposées par le client')
    expect(titreDesPropositions([{ origine: 'cabinet' }])).toBe('Pièce proposée pour ce mouvement')
    expect(titreDesPropositions([{ origine: 'client' }, { origine: 'cabinet' }])).toBe('2 pièces proposées pour ce mouvement')
    expect(ceQueVoitLeClient(ligne(), { courantes: [proposition()], questionEnAttente: true })).toBe('Justificatif envoyé')
    expect(ceQueVoitLeClient(ligne(), { courantes: [], questionEnAttente: true })).toBe('Demandé par ton cabinet')
    expect(ceQueVoitLeClient(ligne({ statut: 'rapprochee', piece_id: 'p1' }), { courantes: [proposition()], questionEnAttente: false }))
      .toBe('Justifié par une pièce')
  })
})

describe('ce qu’il advient d’une proposition', () => {
  const p = proposition()

  it('à associer, sans réserve', () => {
    const e = etatDeLaProposition(p, contexte())
    expect(e).toEqual({ etat: 'a_associer' })
    expect(associable(e)).toBe(true)
    expect(phraseDeLEtat(e)).toBeNull()
  })

  it('retenue : le mouvement rapproché de cette pièce, seule ou parmi les parts lues d’un virement groupé', () => {
    expect(etatDeLaProposition(p, contexte({ ligne: ligne({ statut: 'rapprochee', piece_id: 'p1' }) }))).toEqual({ etat: 'retenue' })
    const groupe = ligne({ statut: 'rapprochee', reglement_groupe: true })
    expect(etatDeLaProposition(p, contexte({ ligne: groupe, piecesDuReglement: ['p0', 'p1'] }))).toEqual({ etat: 'retenue' })
    // Les parts pas lues en entier ne disent pas la pièce retenue : le mouvement est classé, sans plus.
    expect(etatDeLaProposition(p, contexte({ ligne: groupe, piecesDuReglement: null }))).toEqual({ etat: 'mouvement_classe' })
    expect(etatDeLaProposition(p, contexte({ ligne: ligne({ statut: 'non_rapprochee', piece_id: 'p1' }) }))).toEqual({ etat: 'a_associer' })
    expect(phraseDeLEtat({ etat: 'retenue' })).toMatch(/^Retenue : ce mouvement est rapproché de cette pièce/)
    expect(associable({ etat: 'retenue' })).toBe(false)
  })

  it('le mouvement classé autrement : rapproché d’autre chose, ignoré, virement personnel', () => {
    for (const l of [ligne({ statut: 'rapprochee', piece_id: 'p9' }), ligne({ statut: 'ignoree' }), ligne({ prelevement_personnel: true })]) {
      expect(etatDeLaProposition(p, contexte({ ligne: l }))).toEqual({ etat: 'mouvement_classe' })
    }
    expect(phraseDeLEtat({ etat: 'mouvement_classe' })).toMatch(/rien ne la retire d’elle-même/)
  })

  it('le mouvement figé, puis la pièce : absente, figée, payée ailleurs, payée en partie', () => {
    expect(etatDeLaProposition(p, contexte({ figeePar: 'L’exercice 2026 est validé' })))
      .toEqual({ etat: 'mouvement_fige', figeePar: 'L’exercice 2026 est validé' })
    expect(phraseDeLEtat({ etat: 'mouvement_fige', figeePar: 'L’exercice 2026 est validé' })).toMatch(/^L’exercice 2026 est validé : /)
    expect(etatDeLaProposition(p, contexte({ pieces: [] }))).toEqual({ etat: 'piece_non_lue', lecturePartielle: false })
    expect(etatDeLaProposition(p, contexte({ pieces: [], piecesLuesEnEntier: false }))).toEqual({ etat: 'piece_non_lue', lecturePartielle: true })
    expect(phraseDeLEtat({ etat: 'piece_non_lue', lecturePartielle: true })).toMatch(/pas été en entier/)
    expect(phraseDeLEtat({ etat: 'piece_non_lue', lecturePartielle: false })).toMatch(/supprimée/)
    expect(etatDeLaProposition(p, contexte({ piecesFigees: new Set(['p1']), restesARegler: new Map([['p1', 10]]) }))).toEqual({ etat: 'piece_figee' })
    const paiements = [{ date: '2026-05-30', montant: -100 }]
    const ailleurs = etatDeLaProposition(p, contexte({ horsRapprochement: new Set(['p1']), paiementsDeLaPiece: paiements }))
    expect(ailleurs).toEqual({ etat: 'piece_rapprochee_ailleurs', paiements })
    expect(phraseDeLEtat(ailleurs)?.replace(/\s/g, ' ')).toBe('Cette pièce est déjà rapprochée d’un autre mouvement (30/05/2026, -100,00 €) : elle ne s’associe pas à celui-ci.')
    expect(phraseDeLEtat({ etat: 'piece_rapprochee_ailleurs', paiements: [] })).toBe('Cette pièce est déjà rapprochée d’un autre mouvement : elle ne s’associe pas à celui-ci.')
    expect(associable(ailleurs)).toBe(false)
    const partie = etatDeLaProposition(p, contexte({ horsRapprochement: new Set(['p1']), restesARegler: new Map([['p1', 40]]) }))
    expect(partie).toEqual({ etat: 'piece_payee_en_partie', reste: 40, refus: null })
    expect(associable(partie)).toBe(true)
    expect(phraseDeLEtat(partie)?.replace(/\s/g, ' ')).toBe('Cette pièce est déjà payée en partie : ce mouvement en règlerait le reste (40,00 €).')
    const refusee = etatDeLaProposition(p, contexte({ restesARegler: new Map([['p1', 40]]), refusSecondPaiement: 'Trop.' }))
    expect(refusee).toEqual({ etat: 'piece_payee_en_partie', reste: 40, refus: 'Trop.' })
    expect(associable(refusee)).toBe(false)
    expect(phraseDeLEtat(refusee)).toBe('Trop.')
  })
})

describe('les signaux d’une pièce proposée', () => {
  it('même montant, sens juste : une coche', () => {
    expect(signauxDeLaProposition(piece(), ligne())).toEqual([{ ok: true, texte: 'Même montant, au centime près' }])
  })

  it('à valider, montant différent ou absent, sens contraire : chacun dit', () => {
    const s = signauxDeLaProposition(piece({ statut: 'a_valider', montant_ttc: 90 }), ligne({ montant: 100 }))
    expect(s.map((x) => [x.ok, x.texte.replace(/\s/g, ' ')])).toEqual([
      [false, 'Pièce à valider : ses montants n’ont pas encore été relus'],
      [false, 'Montants différents : 90,00 € sur la pièce, 100,00 € au relevé'],
      [false, 'Sens contraire : la pièce attend un paiement, le relevé montre un crédit'],
    ])
    expect(signauxDeLaProposition(piece({ montant_ttc: null }), ligne())[0]).toEqual({ ok: false, texte: 'Aucun montant lu sur la pièce' })
    expect(signauxDeLaProposition(piece({ type_piece: 'vente' }), ligne()).at(-1)?.texte)
      .toBe('Sens contraire : la pièce attend un encaissement, le relevé montre un débit')
    // Au centime : 100,004 et 100 se valent, 100,01 non.
    expect(signauxDeLaProposition(piece({ montant_ttc: 100.004 }), ligne())[0].ok).toBe(true)
    expect(signauxDeLaProposition(piece({ montant_ttc: 100.01 }), ligne())[0].ok).toBe(false)
  })
})

describe('le filtre « Proposés par le client »', () => {
  const envois: EnvoisDuClient = {
    etat: 'lus',
    propositions: [
      proposition({ ligne_bancaire_id: 'l1' }),
      proposition({ id: 'r', ligne_bancaire_id: 'l2', retire_le: '2026-06-06T10:00:00Z', retire_par: 'client-1' }),
      proposition({ id: 'k', ligne_bancaire_id: 'l3', origine: 'cabinet' }),
    ],
    precisions: [],
  }

  it('les mouvements d’une proposition courante venue de l’espace client, et eux seuls', () => {
    const proposes = mouvementsProposesParLeClient(envois)
    expect([...proposes]).toEqual(['l1'])
    expect(gardeParLeFiltre(envois, true, proposes, 'l1')).toBe(true)
    expect(gardeParLeFiltre(envois, true, proposes, 'l2')).toBe(false)
    expect(gardeParLeFiltre(envois, false, proposes, 'l2')).toBe(true)
    expect(etatDuFiltreProposes(envois)).toEqual({ disponible: true })
  })

  it('sur des envois pas lus en entier : grisé avec sa raison, et coché il ne filtre plus', () => {
    for (const e of [{ etat: 'en_cours' }, { etat: 'incomplets', motif: 'x' }] as EnvoisDuClient[]) {
      expect(mouvementsProposesParLeClient(e).size).toBe(0)
      expect(gardeParLeFiltre(e, true, new Set(), 'l2')).toBe(true)
      const f = etatDuFiltreProposes(e)
      expect(f.disponible).toBe(false)
      expect(f.disponible ? '' : f.raison).toBe(silenceDesEnvois(e))
    }
  })
})

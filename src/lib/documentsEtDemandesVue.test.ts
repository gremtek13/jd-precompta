import { describe, expect, it } from 'vitest'
import { DOCUMENTS_ET_DEMANDES_PREVUS, MOTS_DE_L_ETAT, REFUS } from './documentsEtDemandes'
import {
  attenduDit, auteurDitAuClient, confirmationDeLaCloture, confirmationDeLaPublication, confirmationDuRetrait, demandesDites,
  depotsCitables, documentDit, fichierDeLaReponseDit, lecteursDesDocuments, mesDemandesOuvertes, mesDocumentsOuverts,
  motifDit, natureDite, ouverturesDuDocument, PRESENTATION_DE_MES_DEMANDES, PRESENTATION_DE_MES_DOCUMENTS,
  SANS_LA_CASE_DOCUMENTS, type DemandeDuCabinet, type DocumentDuCabinet, type ReponseALaDemande,
} from './documentsEtDemandesVue'
import { motsDuCabinet } from './espaceVentes'
import { TROIS_CASES_EXPORTEES } from './troisCasesDeLAcces'
import { LIBELLE_TEXTE_DE_LA_REPONSE } from './documentsEtDemandes'

// Ce que les écrans des documents et des demandes montrent (étape B3a) : les mots d'une ligne, qui a ouvert, ce que nomment
// les confirmations, l'état et l'ordre des demandes, ce que le client peut joindre, et ce que le client lit — au tutoiement,
// sans un mot du cabinet.

const document = (p: Partial<DocumentDuCabinet>): DocumentDuCabinet => ({
  id: 'doc1', dossier_id: 'd1', titre: 'Liasse 2025', nature: 'liasse', exercice: 2025, chemin: 'c', nom_fichier: 'liasse.pdf',
  sha256: 'a'.repeat(64), taille: 10, type_mime: 'application/pdf', publie_par: 'u0', publie_le: '2026-05-02T08:00:00Z',
  retire_par: null, retire_le: null, ...p,
})
const demande = (p: Partial<DemandeDuCabinet>): DemandeDuCabinet => ({
  id: 'dm1', dossier_id: 'd1', objet: 'Relevé de décembre', detail: null, echeance: null, attendu: 'fichier', auteur: 'u0',
  ouverte_le: '2026-11-10T09:00:00Z', close_par: null, close_le: null, motif_de_cloture: null, ...p,
})
const reponse = (p: Partial<ReponseALaDemande>): ReponseALaDemande => ({
  id: 'r1', dossier_id: 'd1', demande_id: 'dm1', auteur: 'u1', texte: 'Voici', fichier: null, piece_id: null, document_id: null,
  fichier_sha256: null, ecrite_le: '2026-11-10T10:00:00Z', ...p,
})

describe('les mots d’une ligne', () => {
  it('la nature, l’attendu et le motif se disent ; une valeur inconnue ne se devine pas', () => {
    expect(natureDite('liasse')).toBe('La liasse fiscale')
    expect(natureDite('bilan')).toBe('Nature inconnue')
    expect(attenduDit('les_deux')).toBe('Un fichier et une réponse')
    expect(motifDit('remplacee')).toBe('Remplacée par une autre demande')
    expect(motifDit(null)).toBe('Motif inconnu')
    expect(documentDit(document({}))).toBe('« Liasse 2025 » — La liasse fiscale, exercice 2025')
    expect(documentDit(document({ exercice: null, nature: 'courrier' }))).toBe('« Liasse 2025 » — Un courrier')
  })
})

describe('qui a ouvert un document, et qui le lira', () => {
  it('les premières ouvertures par date, sous l’adresse de l’accès ; un accès retiré sans adresse', () => {
    const lectures = [
      { id: 'l2', dossier_id: 'd1', document_id: 'doc1', lecteur: 'u2', lu_le: '2026-05-04T08:00:00Z' },
      { id: 'l1', dossier_id: 'd1', document_id: 'doc1', lecteur: 'u1', lu_le: '2026-05-03T08:00:00Z' },
      { id: 'l3', dossier_id: 'd1', document_id: 'doc2', lecteur: 'u1', lu_le: '2026-05-01T08:00:00Z' },
    ]
    const acces = [{ user_id: 'u1', email: 'a@exemple.fr', droit_documents: true }]
    expect(ouverturesDuDocument('doc1', lectures, acces)).toEqual([
      { email: 'a@exemple.fr', lu_le: '2026-05-03T08:00:00Z' },
      { email: null, lu_le: '2026-05-04T08:00:00Z' },
    ])
  })

  it('le liront : les accès qui portent la case « Documents », eux seuls', () => {
    expect(lecteursDesDocuments([
      { user_id: 'u1', email: 'a@exemple.fr', droit_documents: true },
      { user_id: 'u2', email: 'b@exemple.fr', droit_documents: false },
      { user_id: 'u3', email: 'c@exemple.fr', droit_documents: null },
    ])).toEqual(['a@exemple.fr'])
  })
})

describe('ce que nomment les confirmations', () => {
  it('publier nomme le document, le fichier et qui le lira — ou personne', () => {
    const avec = confirmationDeLaPublication({ titre: 'Liasse 2025', nature: 'liasse', exercice: 2025 }, 'liasse.pdf', ['a@exemple.fr'])
    expect(avec.titre).toBe('Publier « Liasse 2025 » — La liasse fiscale, exercice 2025')
    expect(avec.paragraphes.join(' ')).toContain('« liasse.pdf »')
    expect(avec.paragraphes.join(' ')).toContain('Le liront, dans leur espace : a@exemple.fr')
    const sans = confirmationDeLaPublication({ titre: 'Liasse 2025', nature: 'liasse', exercice: 2025 }, 'liasse.pdf', [])
    expect(sans.paragraphes.join(' ')).toContain('personne ne le lira')
  })

  it('retirer dit ce qui reste ; des ouvertures non comptées ne se disent pas « personne »', () => {
    expect(confirmationDuRetrait(document({}), 0).paragraphes.join(' ')).toContain('Personne ne l’a encore ouvert')
    expect(confirmationDuRetrait(document({}), 2).paragraphes.join(' ')).toContain('ses 2 premières ouvertures')
    expect(confirmationDuRetrait(document({}), null).paragraphes.join(' ')).not.toContain('Personne')
  })

  it('clore nomme la demande et le motif ; « remplacée » dit d’ouvrir la suivante', () => {
    const c = confirmationDeLaCloture({ objet: 'Relevé' }, 'remplacee')
    expect(c.titre).toBe('Clore la demande « Relevé »')
    expect(c.paragraphes).toContain('Motif : Remplacée par une autre demande.')
    expect(c.paragraphes.join(' ')).toContain('Ouvre ensuite la demande qui la remplace')
    expect(confirmationDeLaCloture({ objet: 'Relevé' }, 'satisfaite').paragraphes.join(' ')).not.toContain('remplace')
  })
})

describe('les demandes, leur état et leur ordre', () => {
  it('l’état se déduit de la clôture, des réponses et de l’échéance ; en retard d’abord, closes à la fin', () => {
    const dites = demandesDites([
      demande({ id: 'a', ouverte_le: '2026-11-01T09:00:00Z', close_le: '2026-11-05T09:00:00Z', motif_de_cloture: 'satisfaite' }),
      demande({ id: 'b', ouverte_le: '2026-11-02T09:00:00Z' }),
      demande({ id: 'c', ouverte_le: '2026-11-03T09:00:00Z', echeance: '2026-11-05' }),
      demande({ id: 'd', ouverte_le: '2026-11-04T09:00:00Z' }),
    ], [reponse({ id: 'r2', demande_id: 'd', ecrite_le: '2026-11-06T09:00:00Z' }), reponse({ id: 'r1', demande_id: 'd', ecrite_le: '2026-11-05T09:00:00Z' })],
    [{ id: 'x', dossier_id: 'd1', demande_id: 'b', canal: 'ecran', email_id: null, relancee_par: 'u0', relancee_le: '2026-11-08T09:00:00Z' }],
    '2026-11-11')
    expect(dites.map((d) => [d.demande.id, d.etat])).toEqual([['c', 'en_retard'], ['b', 'ouverte'], ['d', 'repondue'], ['a', 'close']])
    expect(dites.find((d) => d.demande.id === 'd')!.reponses.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(dites.find((d) => d.demande.id === 'b')!.relances).toHaveLength(1)
  })

  it('ce qu’une réponse a joint reste dit quand le lien s’est défait (B2-Q3)', () => {
    expect(fichierDeLaReponseDit(reponse({}), null)).toBeNull()
    expect(fichierDeLaReponseDit(reponse({ fichier: 'piece', piece_id: 'p1' }), 'releve.pdf')).toBe('Fichier joint : « releve.pdf ».')
    expect(fichierDeLaReponseDit(reponse({ fichier: 'piece', piece_id: 'p1' }), null)).toBe('Fichier joint : une pièce.')
    expect(fichierDeLaReponseDit(reponse({ fichier: 'document', document_id: null }), null))
      .toBe('Un fichier était joint (un document) ; il n’est plus au dossier.')
  })
})

describe('ce que le client peut joindre, comme la base le juge', () => {
  it('ses pièces et les documents du dossier déposés depuis l’ouverture, qu’aucune réponse ne cite', () => {
    const d = demande({ ouverte_le: '2026-11-10T09:00:00.000000+00:00' })
    const pieces = [
      { id: 'p1', nom_fichier: 'avant.pdf', created_at: '2026-11-10T08:59:59Z', uploaded_by: 'u1' },
      { id: 'p2', nom_fichier: 'a-moi.pdf', created_at: '2026-11-10T09:00:00Z', uploaded_by: 'u1' },
      { id: 'p3', nom_fichier: 'autre.pdf', created_at: '2026-11-10T10:00:00Z', uploaded_by: 'u2' },
      { id: 'p4', nom_fichier: 'cite.pdf', created_at: '2026-11-10T11:00:00Z', uploaded_by: 'u1' },
    ]
    const documents = [{ id: 'x1', nom_fichier: 'attestation.pdf', created_at: '2026-11-10T12:00:00Z' }]
    const citables = depotsCitables(d, pieces, documents, [reponse({ fichier: 'piece', piece_id: 'p4' })], 'u1')
    expect(citables.map((c) => `${c.genre}:${c.id}`)).toEqual(['document:x1', 'piece:p2'])
  })
})

describe('ce que lit le client', () => {
  it('au tutoiement, sans un mot du cabinet', () => {
    const phrases = [
      PRESENTATION_DE_MES_DOCUMENTS, PRESENTATION_DE_MES_DEMANDES, SANS_LA_CASE_DOCUMENTS, LIBELLE_TEXTE_DE_LA_REPONSE,
      auteurDitAuClient('u1', 'u1'), auteurDitAuClient('u2', 'u1'), ...Object.values(MOTS_DE_L_ETAT),
      fichierDeLaReponseDit(reponse({ fichier: 'piece', piece_id: null }), null)!,
      REFUS.rienARepondre, REFUS.texteDeLaReponse, REFUS.pieceEtDocument, REFUS.closeSansReponse, REFUS.pasSonDepot,
      REFUS.accesALaDemande, REFUS.accesAuDocument,
    ]
    for (const p of phrases) expect(motsDuCabinet(p), p).toEqual([])
  })
})

describe('les entrées de l’espace client, sous le drapeau', () => {
  it('« Mes documents » demande la migration ET la case ; « Mes demandes », la migration seule', () => {
    expect(mesDocumentsOuverts(false, true)).toBe(false)
    expect(mesDocumentsOuverts(true, false)).toBe(false)
    expect(mesDocumentsOuverts(true, true)).toBe(true)
    expect(mesDemandesOuvertes(false)).toBe(false)
    expect(mesDemandesOuvertes(true)).toBe(true)
  })

  it('levé, le drapeau suppose les trois cases de B1 : la case « Documents » se lit alors à la connexion', () => {
    expect(!DOCUMENTS_ET_DEMANDES_PREVUS || TROIS_CASES_EXPORTEES).toBe(true)
  })
})

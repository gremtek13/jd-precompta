import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { definitionsSql } from '../test/schema'
import {
  REFUS_DE_LA_PROPOSITION, REFUS_DE_LA_REPONSE, REFUS_DU_BROUILLON, REFUS_DU_MODELE, REFUS_DU_RETRAIT, REFUS_DU_RETRAIT_DU_MODELE,
  motsDuRefus,
} from './lettresDeMission'
import {
  COLONNES_SANS_MONTANT, REFUS_DU_PAPIER_SIGNE, avisDuModele, confirmationDeLaProposition, confirmationDeLaReponse, confirmationDuModele,
  confirmationDuRetrait, contenuDuBrouillon, contenuDuPdf, messageDUneSuppressionRetenue, missionsEnVigueur, montantEnCentimes,
  montantEnEuros, nomDuPdf, refusDeLaNouvelleVersion, refusDeLaProposition, refusDeLaReponse, refusDuBrouillon, refusDuModele,
  refusDuPapierSigne, refusDuRetrait, refusDuRetraitDuModele, saisieDeLaLettre,
  type LettreComplete, type ModeleLu, type SaisieDeLaLettre, type SaisieDuModele,
} from './lettresDeMissionVue'
import { couperEnLignes, enWinAnsi, pdfDeLaLettre } from './pdfLettreDeMission'

// L'ÉCRAN DES LETTRES DE MISSION (ligne 47, LM5) : les refus dits avant le clic suivent l'ordre de chaque fonction et ses
// mots ; le contenu d'un brouillon n'a que les clés que la fonction accepte ; le PDF ne lit que des valeurs figées ; le
// papier signé se dit avant la suppression que sa clé retient (23503) ; un membre lit les missions SANS montant.
// Données FICTIVES.

const MIGRATION = (() => {
  const dossier = new URL('../../supabase/preparees/', import.meta.url).pathname
  const nom = readdirSync(dossier).find((n) => /^\d{14}_lettres_de_mission\.sql$/.test(n))
  expect(nom).toBeDefined()
  return readFileSync(dossier + nom, 'utf8')
})()
const fonction = (nom: string) => definitionsSql(nom, [{ chemin: 'lettres_de_mission', texte: MIGRATION }]).at(-1)!.definition

const CLIENT = 'c0000000-0000-4000-8000-000000000001'
const CABINET = 'k0000000-0000-4000-8000-000000000001'
const EMPREINTE = 'a'.repeat(64)

const modele = (p: Partial<ModeleLu> = {}): ModeleLu => ({
  id: 'm1', titre: 'Modèle fictif', conditions_generales: 'Conditions fictives, renvoi aux règles de l’Ordre, inscription n° 0.',
  missions: { tenue_comptable: 'Tenir les comptes.', declaration_2035: 'Établir la 2035.' },
  clauses: { sous_traitance: 'Clause fictive de sous-traitance.' }, remplace_id: null, cree_le: '2026-11-01T10:00:00Z', retire_le: null, ...p,
})

const lettre = (p: Partial<LettreComplete> = {}): LettreComplete => ({
  id: 'l1', remplace_id: null, dossier_client_id: CLIENT, date_effet: '2027-01-01', fin_initiale: '2027-12-31',
  reconduction_tacite: true, proposee_le: null, acceptee_le: null, refusee_le: null, retiree_le: null, fin_au: null,
  modele_id: 'm1', missions: ['tenue_comptable'], repartition: [{ tache: 'Déposer les pièces', par: 'client' }],
  honoraires: [{ forme: 'forfait', libelle: 'Tenue', montant_ht: 150, periodicite: 'mois' }], premier_exercice: 2027,
  preavis_mois: 3, signataire_nom: 'Signataire fictif', signataire_qualite: 'Gérant', signataire_compte: null,
  modifiee_le: '2026-11-10T10:00:00Z', identite_client: null, identite_cabinet: null, clauses: null, empreinte: null,
  mode_acceptation: null, document_signe_id: null, empreinte_papier: null, signee_le: null, cree_le: '2026-11-10T10:00:00Z', ...p,
})
const proposee = (p: Partial<LettreComplete> = {}) => lettre({
  proposee_le: '2026-11-10T23:30:00Z', empreinte: EMPREINTE, clauses: ['sous_traitance'],
  identite_client: { nom: 'Client fictif', siret: '00000000000000', adresse: '1 rue fictive' },
  identite_cabinet: { cabinet: 'Cabinet fictif', siret: '11111111111111', adresse: '2 rue fictive' }, ...p,
})

const saisie = (p: Partial<SaisieDeLaLettre> = {}): SaisieDeLaLettre => ({ ...saisieDeLaLettre(lettre()), ...p })
const ctxBrouillon = (p: Partial<Parameters<typeof refusDuBrouillon>[1]> = {}) => ({
  dossierDuCabinet: true, dossierDuCabinetId: CABINET, clients: [{ id: CLIENT, nom: 'Client fictif', adresse: '1 rue' }],
  modeles: [modele()], lettres: [lettre()], existante: null, remplace: null, ...p,
})

describe('le montant saisi', () => {
  it('se lit exactement au centime, jamais par un flottant ; nul, négatif ou trop fin, illisible', () => {
    expect(montantEnCentimes('1 200,50')).toBe(120050)
    expect(montantEnCentimes('0.1')).toBe(10)
    expect(montantEnCentimes('19.99')).toBe(1999)
    for (const x of ['', '0', '-3', '1,234', 'abc', '1e3', '1000000000']) expect(montantEnCentimes(x), x).toBeNull()
    expect(montantEnEuros(1234567.5)).toBe('1 234 567,50 €')
  })
})

describe('le brouillon', () => {
  it('ne porte que les clés que la fonction accepte, et des honoraires à la forme que la base valide', () => {
    const cles = /k not in \(([^)]*)\)/.exec(fonction('enregistrer_brouillon_de_lettre'))![1].match(/'([a-z_]+)'/g)!.map((s) => s.slice(1, -1))
    const c = contenuDuBrouillon(saisie(), 'l0')
    expect(c.ok).toBe(true)
    if (!c.ok) return
    for (const k of Object.keys(c.contenu)) expect(cles, k).toContain(k)
    expect(c.contenu.honoraires).toEqual([{ forme: 'forfait', libelle: 'Tenue', montant_ht: 150, periodicite: 'mois' }])
    // Les clés d'une ligne d'honoraires sont celles que `honoraires_valides` admet.
    const admises = /k not in \(([^)]*)\)/.exec(fonction('honoraires_valides'))![1].match(/'([a-z_]+)'/g)!.map((s) => s.slice(1, -1))
    for (const h of c.contenu.honoraires as object[]) for (const k of Object.keys(h)) expect(admises).toContain(k)
    expect(c.contenu.signataire_compte).toBeNull()
  })

  it('un champ blanc vaut nul ; un montant illisible ne se range jamais à zéro', () => {
    const c = contenuDuBrouillon(saisie({ dateEffet: '', premierExercice: '', signataireNom: ' ' }), null)
    expect(c.ok && [c.contenu.date_effet, c.contenu.premier_exercice, c.contenu.signataire_nom]).toEqual([null, null, null])
    expect(contenuDuBrouillon(saisie({ honoraires: [{ forme: 'tache', libelle: 'x', montant: 'douze', periodicite: 'mois', livrable: 'bilan' }] }), null))
      .toEqual({ ok: false, cle: 'honoraires' })
  })

  it('ses refus, dans l’ordre de la fonction, à ses mots', () => {
    const mots = (cle: string) => motsDuRefus(REFUS_DU_BROUILLON, cle)
    expect(refusDuBrouillon(saisie(), ctxBrouillon())).toBeNull()
    expect(refusDuBrouillon(saisie(), ctxBrouillon({ dossierDuCabinet: false }))).toBe(mots('horsDuDossierDuCabinet'))
    // La répartition passe avant les honoraires, qui passent avant les dates.
    expect(refusDuBrouillon(saisie({ repartition: [{ tache: ' ', par: 'client' }], dateEffet: '1999-01-01' }), ctxBrouillon())).toBe(mots('repartition'))
    expect(refusDuBrouillon(saisie({ finInitiale: '2026-01-01' }), ctxBrouillon())).toBe(mots('dates'))
    expect(refusDuBrouillon(saisie({ preavisMois: '13' }), ctxBrouillon())).toBe(mots('preavis'))
    expect(refusDuBrouillon(saisie({ dossierClientId: CABINET }), ctxBrouillon())).toBe(mots('clientHorsDuCabinet'))
    expect(refusDuBrouillon(saisie({ modeleId: 'autre' }), ctxBrouillon())).toBe(mots('modeleHorsDuDossier'))
    const p = proposee()
    expect(refusDuBrouillon(saisie(), ctxBrouillon({ remplace: lettre(), lettres: [lettre()] }))).toBe(mots('remplaceeNonProposee'))
    expect(refusDuBrouillon(saisie({ dossierClientId: '' }), ctxBrouillon({ remplace: p, lettres: [p] }))).toBe(mots('memeClient'))
    const suite = lettre({ id: 'l2', remplace_id: p.id })
    expect(refusDuBrouillon(saisie(), ctxBrouillon({ remplace: p, lettres: [p, suite] }))).toBe(mots('suiteVivante'))
    expect(refusDuBrouillon(saisie(), ctxBrouillon({ existante: p, lettres: [p] }))).toBe(mots('proposee'))
    const retiree = lettre({ retiree_le: '2026-11-11T10:00:00Z' })
    expect(refusDuBrouillon(saisie(), ctxBrouillon({ existante: retiree, lettres: [retiree] }))).toBe(mots('retiree'))
  })
})

describe('le modèle', () => {
  const s = (p: Partial<SaisieDuModele> = {}): SaisieDuModele => ({
    titre: 'Modèle fictif', conditionsGenerales: 'Règles de l’Ordre.', missions: { tenue_comptable: 'Tenir.' }, clauses: {}, ...p,
  })
  const mots = (cle: string) => motsDuRefus(REFUS_DU_MODELE, cle)
  it('ses refus dans l’ordre ; une mission au texte blanc n’est pas décrite', () => {
    const ctx = { dossierDuCabinet: true, remplace: null, modeles: [modele()] }
    expect(refusDuModele(s(), ctx)).toBeNull()
    expect(refusDuModele(s({ titre: ' ', conditionsGenerales: '' }), ctx)).toBe(mots('titre'))
    expect(refusDuModele(s({ conditionsGenerales: '' }), ctx)).toBe(mots('conditions'))
    expect(refusDuModele(s({ missions: { tenue_comptable: '   ' } }), ctx)).toBe(mots('missions'))
    const remplace = modele()
    const suite = modele({ id: 'm2', remplace_id: 'm1' })
    expect(refusDuModele(s(), { ...ctx, remplace, modeles: [remplace, suite] })).toBe(mots('remplaceDepuis'))
    const retire = modele({ retire_le: '2026-11-02T10:00:00Z' })
    expect(refusDuModele(s(), { ...ctx, remplace: retire, modeles: [retire] })).toBe(mots('remplaceRetire'))
    expect(refusDuRetraitDuModele(retire, [retire], true)).toBe(motsDuRefus(REFUS_DU_RETRAIT_DU_MODELE, 'dejaRetire'))
  })
  it('l’avis : l’Ordre absent des conditions (LM4-Q2), la clause exigée sans texte (LM4-Q1)', () => {
    const avis = avisDuModele(s({ conditionsGenerales: 'Rien.' }))
    expect(avis[0]).toContain('ne nomment pas l’Ordre')
    expect(avis[1]).toContain('Sous-traitance des données personnelles')
    expect(avisDuModele(s({ clauses: { sous_traitance: 'Texte.' } }))).toEqual([])
    expect(confirmationDuModele(s(), modele())).toContain('nouvelle version du modèle « Modèle fictif »')
  })
})

describe('la proposition', () => {
  const ctx = {
    dossierDuCabinet: true, clients: [{ id: CLIENT, nom: 'Client fictif', adresse: '1 rue' }], modeles: [modele()],
    identiteDuCabinet: { siret: '1', adresse: '2 rue' },
  }
  const mots = (cle: string) => motsDuRefus(REFUS_DE_LA_PROPOSITION, cle)
  it('ses refus dans l’ordre de la fonction', () => {
    expect(refusDeLaProposition(lettre(), ctx)).toBeNull()
    expect(refusDeLaProposition(proposee(), ctx)).toBe(mots('dejaProposee'))
    expect(refusDeLaProposition(lettre({ dossier_client_id: null, modele_id: null }), ctx)).toBe(mots('sansClient'))
    expect(refusDeLaProposition(lettre(), { ...ctx, clients: [{ id: CLIENT, nom: 'x', adresse: ' ' }] })).toBe(mots('adresseDuClient'))
    expect(refusDeLaProposition(lettre({ modele_id: null }), ctx)).toBe(mots('sansModele'))
    expect(refusDeLaProposition(lettre(), { ...ctx, modeles: [modele(), modele({ id: 'm2', remplace_id: 'm1' })] })).toBe(mots('modeleNonCourant'))
    expect(refusDeLaProposition(lettre({ missions: ['volet_social'] }), ctx)).toBe(mots('missionNonDecrite'))
    expect(refusDeLaProposition(lettre(), { ...ctx, modeles: [modele({ clauses: {} })] })).toBe(mots('clauseSansTexte'))
    expect(refusDeLaProposition(lettre({ honoraires: [{ forme: 'temps', libelle: 'h', montant_ht: 80 }] }), ctx)).toBe(mots('tempsPasse'))
    expect(refusDeLaProposition(lettre({ premier_exercice: null }), ctx)).toBe(mots('duree'))
    expect(refusDeLaProposition(lettre({ signataire_nom: null }), ctx)).toBe(mots('sansSignataire'))
    expect(refusDeLaProposition(lettre(), { ...ctx, identiteDuCabinet: { siret: null, adresse: 'x' } })).toBe(mots('identiteDuCabinet'))
    // Un dossier client que ce compte ne lit pas n'est pas dit « hors du cabinet » : la base en juge.
    expect(refusDeLaProposition(lettre(), { ...ctx, clients: [] })).toBeNull()
  })
  it('la confirmation nomme tout ce qui se fige', () => {
    const t = confirmationDeLaProposition(lettre(), { nomDuClient: 'Client fictif', modele: modele() })
    for (const attendu of ['« Client fictif »', 'FIGE', 'Tenue de la comptabilité', 'Tenue : 150,00 € HT par mois', 'Signataire fictif, Gérant',
      '« Modèle fictif »', 'Sous-traitance des données personnelles', 'l’identité du client et celle du cabinet', 'empreinte']) {
      expect(t, attendu).toContain(attendu)
    }
  })
})

describe('la réponse, le retrait, la nouvelle version', () => {
  const docs = [{ id: 'd1', nom_fichier: 'lettre-signee.pdf', storage_hash: EMPREINTE, created_at: '2026-11-11T09:00:00Z' }]
  const base = { dossierDuCabinet: true, documents: docs, aujourdhui: '2026-11-11' }
  const mots = (cle: string) => motsDuRefus(REFUS_DE_LA_REPONSE, cle)
  it('la réponse : ses refus, la date de signature jugée au jour de PARIS de la proposition', () => {
    const p = proposee()
    const ctx = { ...base, lettres: [p], reponse: 'acceptee_sur_papier' as const, document: docs[0], signeeLe: '2026-11-11' }
    expect(refusDeLaReponse(p, ctx)).toBeNull()
    expect(refusDeLaReponse(lettre(), ctx)).toBe(mots('nonProposee'))
    expect(refusDeLaReponse(proposee({ acceptee_le: '2026-11-11T10:00:00Z' }), ctx)).toBe(mots('dejaRepondue'))
    expect(refusDeLaReponse(p, { ...ctx, lettres: [p, lettre({ id: 'l2', remplace_id: 'l1' })] })).toBe(mots('suiteVivante'))
    expect(refusDeLaReponse(p, { ...ctx, document: null })).toBe(mots('papierHorsDuDossier'))
    expect(refusDeLaReponse(p, { ...ctx, document: { ...docs[0], storage_hash: null }, documents: [{ ...docs[0], storage_hash: null }] }))
      .toBe(mots('papierSansEmpreinte'))
    // Proposée le 10/11 à 23 h 30 UTC : le 11/11 à Paris ; signée le 10/11, c'est AVANT la proposition.
    expect(refusDeLaReponse(p, { ...ctx, signeeLe: '2026-11-10' })).toBe(mots('dateDeSignature'))
    expect(refusDeLaReponse(p, { ...ctx, signeeLe: '2026-11-12' })).toBe(mots('dateDeSignature'))
    expect(refusDeLaReponse(p, { ...ctx, reponse: 'refusee', document: null, signeeLe: '' })).toBeNull()
    expect(confirmationDeLaReponse(p, { nomDuClient: 'Client fictif', reponse: 'acceptee_sur_papier', document: docs[0], signeeLe: '2026-11-11' }))
      .toContain('« lettre-signee.pdf », signé le 11/11/2026')
  })
  it('le retrait et la résiliation', () => {
    const m = (cle: string) => motsDuRefus(REFUS_DU_RETRAIT, cle)
    const acceptee = proposee({ acceptee_le: '2026-11-11T10:00:00Z' })
    expect(refusDuRetrait(acceptee, { dossierDuCabinet: true, lettres: [acceptee], finAu: '' })).toBe(m('resiliationSansDate'))
    expect(refusDuRetrait(acceptee, { dossierDuCabinet: true, lettres: [acceptee], finAu: '2026-12-31' })).toBe(m('resiliationSansDate'))
    expect(refusDuRetrait(acceptee, { dossierDuCabinet: true, lettres: [acceptee], finAu: '2027-06-30' })).toBeNull()
    expect(refusDuRetrait(lettre(), { dossierDuCabinet: true, lettres: [lettre()], finAu: '2027-06-30' })).toBe(m('dateSansAcceptation'))
    expect(refusDuRetrait(proposee({ refusee_le: '2026-11-11T10:00:00Z' }), { dossierDuCabinet: true, lettres: [], finAu: '' })).toBe(m('refusee'))
    expect(confirmationDuRetrait(acceptee, { nomDuClient: 'Client fictif', finAu: '2027-06-30' })).toContain('RÉSILIER')
    expect(refusDeLaNouvelleVersion(lettre(), { dossierDuCabinet: true, lettres: [] })).toBe(motsDuRefus(REFUS_DU_BROUILLON, 'remplaceeNonProposee'))
    expect(refusDeLaNouvelleVersion(acceptee, { dossierDuCabinet: true, lettres: [acceptee] })).toBeNull()
  })
})

describe('le papier signé ne se supprime plus', () => {
  it('la clé est SANS action en base : sa suppression lève 23503, que l’écran dit avant le clic et en clair', () => {
    expect(MIGRATION).toMatch(/document_signe_id uuid references public\.documents_divers \(id\),/i)
    expect(refusDuPapierSigne('d1', { ids: new Set(['d1']), motif: null })).toBe(REFUS_DU_PAPIER_SIGNE)
    expect(refusDuPapierSigne('d1', null)).toBeNull()
    expect(messageDUneSuppressionRetenue({ code: '23503', message: 'violates foreign key constraint "lettres_de_mission_document_signe_id_fkey" on table "lettres_de_mission"' }))
      .toBe(REFUS_DU_PAPIER_SIGNE)
    expect(messageDUneSuppressionRetenue({ code: '23503', message: 'on table "revision_preuves"' })).toBeNull()
  })
})

describe('le PDF d’une lettre proposée', () => {
  it('se tire des seules valeurs figées : rien d’un brouillon, rien d’un autre modèle', () => {
    expect(contenuDuPdf(lettre(), modele())).toBeNull()
    expect(contenuDuPdf(proposee(), modele({ id: 'autre' }))).toBeNull()
    const blocs = contenuDuPdf(proposee(), modele())!
    const texte = blocs.map((b) => b.texte).join('\n')
    for (const attendu of ['Cabinet fictif', 'Client fictif', 'Tenir les comptes.', 'Clause fictive de sous-traitance.', EMPREINTE, 'proposée le 11/11/2026']) {
      expect(texte, attendu).toContain(attendu)
    }
    expect(nomDuPdf(proposee())).toBe('lettre-de-mission-2026-11-11-aaaaaaaa.pdf')
  })

  it('les mêmes octets à chaque impression ; un caractère hors de WinAnsi devient « ? », jamais une levée', async () => {
    const blocs = contenuDuPdf(proposee(), modele({ conditions_generales: 'Ligne avec espace fine et 😀 '.repeat(200) }))!
    const a = await pdfDeLaLettre(blocs, { empreinte: EMPREINTE, instant: '2026-11-10T23:30:00Z' })
    const b = await pdfDeLaLettre(blocs, { empreinte: EMPREINTE, instant: '2026-11-10T23:30:00Z' })
    expect(new TextDecoder().decode(a.slice(0, 5))).toBe('%PDF-')
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
    expect(enWinAnsi('a b – « c » 😀')).toBe('a b – « c » ??')
    expect(couperEnLignes('un deux trois', 7, (s) => s.length)).toEqual(['un deux', 'trois'])
    expect(couperEnLignes('abcdefghij', 4, (s) => s.length)).toEqual(['abcd', 'efgh', 'ij'])
  })
})

describe('les missions en vigueur, lues depuis le dossier d’un client', () => {
  it('les colonnes lues sont de la table, et aucune ne porte un montant, un texte ou une identité', () => {
    const table = /create table public\.lettres_de_mission \(([\s\S]*?)\n\);/i.exec(MIGRATION)![1]
    const colonnes = COLONNES_SANS_MONTANT.split(',').map((c) => c.trim())
    for (const c of colonnes) expect(table, c).toMatch(new RegExp(`^  ${c} `, 'mi'))
    for (const interdite of ['honoraires', 'repartition', 'identite_client', 'identite_cabinet', 'signataire_nom', 'empreinte']) {
      expect(colonnes).not.toContain(interdite)
    }
  })
  it('acceptée et d’effet atteint : ses missions et ses dates, rien d’autre', () => {
    const l = { ...proposee({ acceptee_le: '2026-11-11T10:00:00Z' }) }
    const vues = missionsEnVigueur([l], CLIENT, '2027-02-01')
    expect(vues).toEqual([{ lettreId: 'l1', missions: ['tenue_comptable'], dateEffet: '2027-01-01', finInitiale: '2027-12-31', reconduction: true }])
    expect(missionsEnVigueur([l], CLIENT, '2026-12-01')).toEqual([])
  })
})

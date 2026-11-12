import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CLES_D_UNE_LETTRE, COMMENT_ACCEPTER, DRAPEAU_DES_LETTRES_DU_CLIENT, FONCTION_DES_LETTRES_DU_CLIENT, REFUS_DES_LETTRES_DU_CLIENT,
  REFUS_DU_PDF_SANS_EMPREINTE, etatPourLeClient, lettresDuClientOuvertes, lettresDuClientPrevues, lettresDuClientRendues,
  pdfDeLaLettreDuClient, quiSigne, type LettreDuClient,
} from './lettresDuClient'
import { contenuDuPdf } from './lettresDeMissionVue'
import {
  lettreDeMissionAuRegard, phraseDeLaLettreDeduite, sansEntreeNiLettre,
} from './dossierPermanentEcran'
import type { LettreSansMontant } from './lettresDeMissionVue'

const MIGRATION = readFileSync(new URL('../../supabase/preparees/20261112100000_lettres_du_client.sql', import.meta.url), 'utf8')
const RETOUR = readFileSync(new URL('../../supabase/preparees/retour/20261112100100_retour_lettres_du_client.sql', import.meta.url), 'utf8')
const ESSAI = readFileSync(new URL('../../supabase/essais/lettresDuClient.sql', import.meta.url), 'utf8')

const modele = { id: 'm1', titre: 'Modèle', conditions_generales: 'CG', missions: { tenue_comptable: 'Tenir.' }, clauses: { sous_traitance: 'RGPD.' } }
const brute = (p: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'l1', remplace_id: null, missions: ['tenue_comptable'], repartition: [{ tache: 'Transmettre', par: 'client' }],
  honoraires: [{ forme: 'forfait', libelle: 'Tenue', montant_ht: 4321.98, periodicite: 'trimestre' }],
  date_effet: '2026-01-01', premier_exercice: 2026, fin_initiale: '2026-12-31', reconduction_tacite: true, preavis_mois: 3,
  signataire_nom: 'Jeanne Essai', signataire_qualite: 'Titulaire', signataire_designe: false,
  identite_client: { denomination: 'CLIENT ESSAI' }, identite_cabinet: { denomination: 'CABINET ESSAI' }, clauses: ['sous_traitance'],
  modele, proposee_le: '2025-12-01T10:00:00+00:00', empreinte: 'a'.repeat(64), empreinte_verifiee: true,
  acceptee_le: null, mode_acceptation: null, signee_le: null, refusee_le: null, retiree_le: null, fin_au: null, ...p,
})
const valeur = (lettres: Record<string, unknown>[], designe = true) => ({ dossier_du_cabinet_designe: designe, lettres })
const lue = (p: Record<string, unknown> = {}): LettreDuClient => lettresDuClientRendues(valeur([brute(p)]))!.lettres[0]

describe('le drapeau et la route', () => {
  it('baissé par défaut : rien ne s’offre ; levé, la case « Documents » décide', () => {
    expect(lettresDuClientPrevues()).toBe(false)
    expect(lettresDuClientOuvertes(lettresDuClientPrevues(), true)).toBe(false)
    DRAPEAU_DES_LETTRES_DU_CLIENT.prevues = true
    try {
      expect(lettresDuClientOuvertes(lettresDuClientPrevues(), true)).toBe(true)
      expect(lettresDuClientOuvertes(lettresDuClientPrevues(), false)).toBe(false)
    } finally { DRAPEAU_DES_LETTRES_DU_CLIENT.prevues = false }
  })
})

describe('confronté à la migration, à son retour et à son essai', () => {
  it('les vingt-six clés d’une lettre sont celles de la fonction, dans son ordre, et celles de l’essai', () => {
    const corps = MIGRATION.slice(MIGRATION.indexOf("'lettres', coalesce(("), MIGRATION.indexOf('order by l.proposee_le, l.id)'))
    const cles = [...corps.matchAll(/^ {15}'([a-z_]+)', /gm)].map((m) => m[1])
    expect(cles).toEqual([...CLES_D_UNE_LETTRE])
    const essai = ESSAI.slice(ESSAI.indexOf('cles constant text[] := array['), ESSAI.indexOf('missions_m constant'))
    expect([...essai.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...CLES_D_UNE_LETTRE])
  })
  it('le nom, le refus, la case « Documents », aucun brouillon ; le retour retire la fonction', () => {
    expect(MIGRATION).toContain(`create function public.${FONCTION_DES_LETTRES_DU_CLIENT}(p_dossier_id uuid)`)
    expect(MIGRATION).toContain(`raise exception '${REFUS_DES_LETTRES_DU_CLIENT.acces}' using errcode = '${REFUS_DES_LETTRES_DU_CLIENT.code}'`)
    expect(MIGRATION).toContain("if not public.client_du_dossier(p_dossier_id, 'documents') then")
    expect(MIGRATION).toContain('and l.proposee_le is not null')
    expect(MIGRATION).not.toMatch(/'(proposee_par|auteur|signataire_compte|document_signe_id|empreinte_papier|dossier_id)', l\./)
    expect(MIGRATION).not.toMatch(/\b(drop|delete|truncate)\b/i)
    expect(RETOUR).toContain(`drop function public.${FONCTION_DES_LETTRES_DU_CLIENT}(uuid);`)
  })
})

describe('la valeur, reconnue entière', () => {
  it('se lit telle quelle', () => {
    const v = lettresDuClientRendues(valeur([brute()]))
    expect(v?.lettres[0].honoraires[0].montant_ht).toBe(4321.98)
    expect(v?.dossierDuCabinetDesigne).toBe(true)
  })
  it('une clé de plus, de moins, ou une lettre sans dossier désigné la rendent illisible', () => {
    expect(lettresDuClientRendues(valeur([{ ...brute(), proposee_par: 'x' }]))).toBeNull()
    const sans = brute(); delete sans.empreinte_verifiee
    expect(lettresDuClientRendues(valeur([sans]))).toBeNull()
    expect(lettresDuClientRendues(valeur([brute()], false))).toBeNull()
    expect(lettresDuClientRendues({ ...valeur([]), autre: 1 })).toBeNull()
    expect(lettresDuClientRendues(valeur([brute({ modele: { ...modele, auteur: 'x' } })]))).toBeNull()
    expect(lettresDuClientRendues(valeur([brute({ missions: ['inconnue'] })]))).toBeNull()
  })
})

describe('l’état dit au client', () => {
  const j = '2026-06-15'
  it('proposée, ou remplacée par une version plus récente qui lui a été proposée', () => {
    const l1 = lue()
    expect(etatPourLeClient(l1, [l1], j)).toBe('proposee')
    const l2 = lue({ id: 'l2', remplace_id: 'l1' })
    expect(etatPourLeClient(l1, [l1, l2], j)).toBe('remplacee')
    expect(etatPourLeClient(l1, [l1, lue({ id: 'l2', remplace_id: 'l1', refusee_le: '2026-02-01T00:00:00+00:00' })], j)).toBe('proposee')
  })
  it('en vigueur, à venir, remplacée par un avenant accepté, échue, refusée, retirée, résiliée', () => {
    const acceptee = { acceptee_le: '2026-01-02T09:00:00+00:00', mode_acceptation: 'papier', signee_le: '2026-01-02' }
    const l1 = lue(acceptee)
    expect(etatPourLeClient(l1, [l1], j)).toBe('en_vigueur')
    expect(etatPourLeClient(l1, [l1], '2025-12-20')).toBe('a_venir')
    const avenant = lue({ ...acceptee, id: 'l2', remplace_id: 'l1', date_effet: '2026-04-01' })
    expect(etatPourLeClient(l1, [l1, avenant], j)).toBe('remplacee')
    expect(etatPourLeClient(lue({ ...acceptee, reconduction_tacite: false }), [], '2027-01-05')).toBe('echue')
    expect(etatPourLeClient(lue({ refusee_le: '2026-01-02T00:00:00+00:00' }), [], j)).toBe('refusee')
    expect(etatPourLeClient(lue({ retiree_le: '2026-01-02T00:00:00+00:00' }), [], j)).toBe('retiree')
    expect(etatPourLeClient(lue({ ...acceptee, retiree_le: '2026-03-01T00:00:00+00:00', fin_au: '2026-03-31' }), [], j)).toBe('resiliee')
  })
  it('l’acceptation se dit hors ligne (LM-Q10), et qui signe', () => {
    expect(COMMENT_ACCEPTER).toContain('n’est pas encore ouverte')
    expect(quiSigne(lue({ signataire_designe: true }))).toBe('Ton cabinet t’a désigné pour la signer.')
    expect(quiSigne(lue())).toBe('Elle est à signer par Jeanne Essai, Titulaire.')
  })
})

describe('le PDF', () => {
  it('se refuse d’une lettre dont la base n’a pas retrouvé l’empreinte', () => {
    expect(pdfDeLaLettreDuClient(lue({ empreinte_verifiee: false }))).toEqual({ ok: false, message: REFUS_DU_PDF_SANS_EMPREINTE })
  })
  it('sinon, les blocs mêmes du cabinet, ses honoraires compris', () => {
    const pdf = pdfDeLaLettreDuClient(lue())
    expect(pdf.ok).toBe(true)
    if (!pdf.ok) return
    expect(pdf.empreinte).toBe('a'.repeat(64))
    expect(pdf.blocs.map((b) => b.texte).join('\n')).toContain('Tenue')
    const cabinet = contenuDuPdf({
      id: 'l1', remplace_id: null, dossier_client_id: 'dossier', date_effet: '2026-01-01', fin_initiale: '2026-12-31',
      reconduction_tacite: true, proposee_le: '2025-12-01T10:00:00+00:00', acceptee_le: null, refusee_le: null, retiree_le: null,
      fin_au: null, modele_id: 'm1', missions: ['tenue_comptable'], repartition: [{ tache: 'Transmettre', par: 'client' }],
      honoraires: [{ forme: 'forfait', libelle: 'Tenue', montant_ht: 4321.98, periodicite: 'trimestre' }], premier_exercice: 2026,
      preavis_mois: 3, signataire_nom: 'Jeanne Essai', signataire_qualite: 'Titulaire', signataire_compte: 'compte', modifiee_le: 'x',
      identite_client: { denomination: 'CLIENT ESSAI' }, identite_cabinet: { denomination: 'CABINET ESSAI' }, clauses: ['sous_traitance'],
      empreinte: 'a'.repeat(64), mode_acceptation: null, document_signe_id: null, empreinte_papier: null, signee_le: null, cree_le: 'x',
    }, { ...modele, remplace_id: null, cree_le: 'x', retire_le: null })
    expect(pdf.blocs).toEqual(cabinet)
  })
})

describe('la déduction de R7', () => {
  const lettre = (p: Partial<LettreSansMontant>): LettreSansMontant => ({
    id: 'l1', remplace_id: null, dossier_client_id: 'd', missions: ['tenue_comptable'], date_effet: '2026-03-01', fin_initiale: '2026-12-31',
    reconduction_tacite: true, proposee_le: '2026-02-01T00:00:00+00:00', acceptee_le: '2026-02-10T00:00:00+00:00', refusee_le: null,
    retiree_le: null, fin_au: null, ...p,
  })
  const lu = (lettres: LettreSansMontant[]) => ({ etat: 'lue' as const, dossierClientId: 'd', lettres })
  it('une lettre acceptée qui touche l’exercice le satisfait ; ni avant son effet, ni après sa résiliation', () => {
    expect(lettreDeMissionAuRegard(lu([lettre({})]), 'd', 2026, '2026-11-12')).toEqual({ etat: 'en_vigueur', accepteeLe: '2026-02-10T00:00:00+00:00' })
    expect(lettreDeMissionAuRegard(lu([lettre({})]), 'd', 2025, '2026-11-12')).toEqual({ etat: 'aucune' })
    expect(lettreDeMissionAuRegard(lu([lettre({ retiree_le: '2026-05-01T00:00:00+00:00', fin_au: '2026-05-31' })]), 'd', 2027, '2026-11-12')).toEqual({ etat: 'aucune' })
    expect(lettreDeMissionAuRegard(lu([lettre({ acceptee_le: null })]), 'd', 2026, '2026-11-12')).toEqual({ etat: 'aucune' })
    expect(lettreDeMissionAuRegard(lu([lettre({})]), 'd', null, '2026-02-15')).toEqual({ etat: 'aucune' })
    expect(lettreDeMissionAuRegard(lu([lettre({})]), 'd', null, '2026-03-01').etat).toBe('en_vigueur')
  })
  it('une lecture fermée, refusée ou illisible ne dit rien ; sans dossier du cabinet, aucune', () => {
    expect(lettreDeMissionAuRegard({ etat: 'fermee', dossierClientId: 'd' }, 'd', 2026, '2026-11-12').etat).toBe('illisible')
    expect(lettreDeMissionAuRegard({ etat: 'illisible', dossierClientId: 'd', motif: 'm' }, 'd', 2026, '2026-11-12')).toEqual({ etat: 'illisible', motif: 'm' })
    expect(lettreDeMissionAuRegard({ etat: 'sansDossierDuCabinet', dossierClientId: 'd' }, 'd', 2026, '2026-11-12')).toEqual({ etat: 'aucune' })
  })
  it('la liste « à titre d’information » : la lettre n’y est que si aucune n’est en vigueur, lue ; lettres non prévues, à l’identique', () => {
    const liste = ['lettre_mission', 'description'] as const
    expect(sansEntreeNiLettre([...liste], null, false)).toEqual([...liste])
    expect(sansEntreeNiLettre([...liste], null, true)).toEqual(['description'])
    expect(sansEntreeNiLettre([...liste], { etat: 'aucune' }, true)).toEqual([...liste])
    expect(sansEntreeNiLettre([...liste], { etat: 'en_vigueur', accepteeLe: 'x' }, true)).toEqual(['description'])
    expect(sansEntreeNiLettre([...liste], { etat: 'illisible', motif: 'm' }, true)).toEqual(['description'])
    expect(phraseDeLaLettreDeduite({ etat: 'aucune' }, 2026)).toBeNull()
    expect(phraseDeLaLettreDeduite({ etat: 'illisible', motif: 'm' }, 2026)).toContain('rien ne se dit ici')
    expect(phraseDeLaLettreDeduite({ etat: 'en_vigueur', accepteeLe: '2026-02-10T00:00:00+00:00' }, 2026)).toContain('en vigueur en 2026')
  })
})

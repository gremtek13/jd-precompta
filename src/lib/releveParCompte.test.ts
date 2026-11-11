import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CompteDuReleve, LectureDesComptes } from './importParCompte'
import {
  banquesAuTrenteEtUn, compteAttenduLeMois, jonctionsParCompte, moisManquantsParCompte, nomsDesComptes, premiersRelevesParCompte,
  rappelDuReleveSuivant, releveParCompte, tenuDansLExercice,
} from './releveParCompte'
import { moisManquantsDe } from './resteAEnvoyer'
import { detailDesRuptures, jonctionsDesReleves, phraseDeLaRupture, rupturesDesReleves } from './suiteDesReleves'
import type { ControleReleveBancaire, LigneBancaire } from './types'

// LE RELEVÉ JUGÉ COMPTE PAR COMPTE (MCB4) : le partage, la suite des soldes, les mois manquants (et la règle de
// `couverture_du_releve`, confrontée au texte de sa migration), le 31 décembre par 512, le premier relevé, le rappel de janvier.

const compte = (id: string, extra: Partial<CompteDuReleve> = {}): CompteDuReleve => ({
  id, libelle: `Compte ${id}`, principal: false, fin_d_identifiant: null, compte: '512100', compte_propre_depuis: '2026-01-01',
  ouvert_le: null, clos_le: null, ...extra,
})
const P = compte('P', { libelle: 'Principal', principal: true, compte: null, compte_propre_depuis: null })
const B = compte('B', { libelle: 'Livret pro' })
const lus = (...comptes: CompteDuReleve[]): LectureDesComptes => ({ etat: 'lus', comptes })
const SANS: LectureDesComptes = { etat: 'sans_objet' }

let n = 0
const ligne = (compteId: string | undefined, date: string, montant: number, source_fichier: string | null = null): LigneBancaire =>
  ({ id: `l${n++}`, dossier_id: 'd', compte_bancaire_id: compteId, date, libelle: 'x', montant, statut: 'non_rapprochee',
    source_fichier } as LigneBancaire)
const controle = (compteId: string | undefined, o: Partial<ControleReleveBancaire>): ControleReleveBancaire => ({
  id: `k${n++}`, dossier_id: 'd', compte_bancaire_id: compteId, source_fichier: null, solde_initial: 0, solde_final: 0,
  somme_mouvements: 0, ecart: 0, coherent: true, periode_debut: '2025-12-01', periode_fin: '2025-12-31', created_at: '2026-01-01T00:00:00Z', ...o,
})
const parts = <L extends { compte_bancaire_id?: string | null }, C extends { compte_bancaire_id?: string | null }>(r: ReturnType<typeof releveParCompte<L, C>>) => {
  if (r.etat !== 'parts') throw new Error(r.raison)
  return r.parts
}

describe('le partage du relevé entre les comptes', () => {
  const lignes = [ligne('P', '2026-01-05', -10), ligne('B', '2026-01-06', -20)]
  it('drapeau baissé : une part, sans compte ni nom, tout le relevé', () => {
    expect(parts(releveParCompte(SANS, lignes, []))).toEqual([{ compte: null, nom: null, lignes, controles: [] }])
  })
  it('un seul compte lu : une part, jamais nommée, qui reçoit tout', () => {
    expect(parts(releveParCompte(lus(P), [ligne(undefined, '2026-01-05', -1)], []))[0]).toMatchObject({ compte: P, nom: null })
  })
  it('deux comptes : une part chacun, nommée, dans l’ordre de la lecture', () => {
    const p = parts(releveParCompte(lus(P, B), lignes, []))
    expect(p.map((x) => [x.nom, x.lignes.length])).toEqual([['Principal', 1], ['Livret pro', 1]])
  })
  it('retenu : en cours, illisible, une ligne d’un compte inconnu, ou sans compte dès deux', () => {
    expect(releveParCompte({ etat: 'en_cours' }, [], []).etat).toBe('retenu')
    expect(releveParCompte({ etat: 'illisible', motif: 'refus' }, [], [])).toMatchObject({ etat: 'retenu', raison: expect.stringContaining('refus') })
    expect(releveParCompte(lus(P), [ligne('X', '2026-01-05', -1)], []).etat).toBe('retenu')
    expect(releveParCompte(lus(P, B), [ligne(undefined, '2026-01-05', -1)], []).etat).toBe('retenu')
  })
})

describe('la suite des soldes, compte après compte', () => {
  // Deux relevés de deux comptes, de janvier puis de février : mêlés, ils se « suivraient » avec un écart inventé.
  const controles = [
    controle('P', { periode_debut: '2026-01-01', periode_fin: '2026-01-31', solde_initial: 100, solde_final: 150 }),
    controle('B', { periode_debut: '2026-02-01', periode_fin: '2026-02-28', solde_initial: 900, solde_final: 900 }),
  ]
  it('mêlés (drapeau baissé), une rupture ; par compte, aucune', () => {
    expect(rupturesDesReleves(jonctionsParCompte(parts(releveParCompte(SANS, [], controles))))).toHaveLength(1)
    expect(jonctionsParCompte(parts(releveParCompte(lus(P, B), [], controles)))).toEqual([])
  })
  it('une rupture d’un compte se dit sous son nom dès deux comptes, et sans nom sinon', () => {
    const deux = [...controles, controle('B', { periode_debut: '2026-03-01', periode_fin: '2026-03-31', solde_initial: 950, solde_final: 950 })]
    const [r] = rupturesDesReleves(jonctionsParCompte(parts(releveParCompte(lus(P, B), [], deux))))
    expect(phraseDeLaRupture(r)).toMatch(/^Sur le compte « Livret pro », le relevé du 01\/02\/2026 au 28\/02\/2026 finit à 900,00/)
    expect(detailDesRuptures([r])).toMatch(/^compte « Livret pro », du 01\/02\/2026/)
    const [seul] = rupturesDesReleves(jonctionsDesReleves(deux.filter((k) => k.compte_bancaire_id === 'B'), []))
    expect(phraseDeLaRupture(seul)).toMatch(/^Le relevé du 01\/02\/2026/)
  })
})

describe('les mois manquants, compte par compte (la règle de couverture_du_releve)', () => {
  const ex = { annee: 2026, moisAttendus: [1, 2, 3, 4], enCours: true }
  const mois = (lect: LectureDesComptes, lignes: LigneBancaire[]) => moisManquantsParCompte(ex, parts(releveParCompte(lect, lignes, [])))
  it('une part (drapeau baissé, un compte) : exactement moisManquantsDe', () => {
    const lignes = [ligne('P', '2026-01-05', -1), ligne('P', '2026-03-05', -1)]
    expect(mois(SANS, lignes)).toEqual({ mois: moisManquantsDe(ex, lignes), comptes: new Map() })
    expect(mois(lus(P), lignes).mois).toEqual(moisManquantsDe(ex, lignes))
  })
  it('le trou d’un compte n’est plus couvert par l’autre, et se nomme', () => {
    const lignes = [1, 2, 3, 4].map((m) => ligne('P', `2026-0${m}-05`, -1)).concat([ligne('B', '2026-02-06', -1), ligne('B', '2026-04-06', -1)])
    const r = mois(lus(P, B), lignes)
    expect(r.mois).toEqual([3])
    expect(r.comptes.get(3)).toEqual(['Livret pro'])
  })
  it('un autre compte attend depuis son ouverture, sinon son premier mouvement ; le principal toujours ; jusqu’à la clôture', () => {
    const part = (c: CompteDuReleve, dates: string[]) => ({ compte: c, nom: c.libelle, lignes: dates.map((d) => ligne(c.id, d, -1)), controles: [] })
    expect(compteAttenduLeMois(part(B, ['2026-03-02']), '2026-02')).toBe(false)
    expect(compteAttenduLeMois(part({ ...B, ouvert_le: '2026-01-15' }, ['2026-03-02']), '2026-01')).toBe(true)
    expect(compteAttenduLeMois(part(B, []), '2026-02')).toBe(false)
    expect(compteAttenduLeMois(part(P, []), '2020-01')).toBe(true)
    expect(compteAttenduLeMois(part({ ...P, ouvert_le: '2026-03-01' }, []), '2026-02')).toBe(false)
    expect(compteAttenduLeMois(part({ ...B, clos_le: '2026-02-20' }, ['2026-01-02']), '2026-03')).toBe(false)
  })
  it('la migration dit la même règle', () => {
    const dossier = new URL('../../supabase/preparees/', import.meta.url)
    const nom = readdirSync(dossier).find((f) => /^\d{14}_couverture_du_releve_par_compte\.sql$/.test(f))
    const sql = readFileSync(new URL(nom as string, dossier), 'utf8').replace(/\s+/g, ' ')
    expect(sql).toContain("and (c.clos_le is null or date_trunc('month', c.clos_le::timestamp)::date >= m.mois)")
    expect(sql).toContain("case when c.ouvert_le is not null then date_trunc('month', c.ouvert_le::timestamp)::date <= m.mois when c.principal then true")
    expect(sql).toContain('else (select date_trunc(\'month\', min(p.date)::timestamp)::date from public.lignes_bancaires p where p.compte_bancaire_id = c.id) <= m.mois end')
    expect(sql).toContain('create or replace function public.couverture_du_releve(p_dossier_id uuid) returns date[]')
    expect(sql).not.toMatch(/\b(drop|delete|truncate)\b/i)
  })
})

describe('le 31 décembre, par compte du plan', () => {
  const k = (id: string, solde: number) => controle(id, { periode_debut: '2025-12-01', periode_fin: '2025-12-31', solde_final: solde })
  it('2025 : les deux comptes s’écrivent au 512 du principal, leurs soldes s’additionnent', () => {
    const [g] = banquesAuTrenteEtUn(parts(releveParCompte(lus(P, B), [ligne('B', '2025-12-02', -1)], [k('P', 100), k('B', 250.5)])), 2025, '512000')
    expect(g).toMatchObject({ compte: '512000', centimes: 35050 })
  })
  it('2026 : le second compte tient son propre 512 depuis son 1er janvier, confronté à lui seul', () => {
    const p = parts(releveParCompte(lus(P, B), [], [k('P', 100), k('B', 250.5)].map((c) => ({ ...c, periode_debut: '2026-12-01', periode_fin: '2026-12-31' }))))
    expect(banquesAuTrenteEtUn(p, 2026, '512000').map((g) => [g.compte, g.centimes])).toEqual([['512000', 10000], ['512100', 25050]])
  })
  it('un compte sans relevé rend la somme inconnue ; clos dans l’exercice, il compte pour zéro ; ouvert après, il n’y est pas', () => {
    const avec = (c: CompteDuReleve) => parts(releveParCompte(lus(P, c), [ligne(c.id, '2025-06-02', -1)], [k('P', 100)]))
    expect(banquesAuTrenteEtUn(avec(B), 2025, '512000')[0]).toMatchObject({ centimes: null })
    expect(banquesAuTrenteEtUn(avec({ ...B, clos_le: '2025-06-30' }), 2025, '512000')[0]).toMatchObject({ centimes: 10000 })
    expect(tenuDansLExercice({ compte: { ...B, ouvert_le: '2026-02-01' }, nom: 'x', lignes: [], controles: [] }, 2025)).toBe(false)
  })
  it('un compte qui dit deux soldes différents se nomme « plusieurs »', () => {
    const [g] = banquesAuTrenteEtUn(parts(releveParCompte(lus(P, B), [], [k('P', 100), k('B', 1), k('B', 2)])), 2025, '512000')
    expect(g.soldes.map((s) => s.etat)).toEqual(['connu', 'plusieurs'])
  })
  it('le premier relevé de chaque compte', () => {
    const p = parts(releveParCompte(lus(P, B), [], [k('P', 1), controle('B', { periode_debut: '2025-03-01', periode_fin: '2025-03-31' })]))
    expect(premiersRelevesParCompte(p, null).map((x) => [x.part.nom, x.premier.periode_debut])).toEqual([['Principal', '2025-12-01'], ['Livret pro', '2025-03-01']])
  })
})

describe('le rappel du relevé de janvier', () => {
  it('à un compte, les mots d’hier ; dès deux, chacun nommé', () => {
    expect(rappelDuReleveSuivant([2025], [])).toMatch(/importer et rapprocher le relevé de janvier 2026 avant de valider 2025\. /)
    expect(rappelDuReleveSuivant([2025], ['A', 'B'])).toMatch(/le relevé de janvier 2026 de chacun des comptes « A » et « B » avant de valider 2025\./)
    expect(nomsDesComptes(lus(P))).toEqual([])
    expect(nomsDesComptes(lus(P, B))).toEqual(['Principal', 'Livret pro'])
    expect(nomsDesComptes(SANS)).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { preuveDuCompte, preuveSuffisanteSeule, textesDesPreuves, type DonneesDesPreuves, type PreuveProposee } from './revisionPreuves'
import { controleReleve, donnees, ligne } from '../test/revision'
import { PLAN_PAR_DEFAUT } from './planComptable'
import type { CompteDuReleve, LectureDesComptes } from './importParCompte'

// LA PREUVE DU RELEVÉ, COMPTE BANCAIRE PAR COMPTE BANCAIRE (ligne 26.6, MCB6). Le drapeau `COMPTES_BANCAIRES_PREVUS` baissé, la
// lecture des comptes est `sans_objet` et la preuve d'hier tient au caractère près (revisionPreuves.test.ts, inchangé). Lus, la
// base dit de quel compte est chaque relevé : la preuve suit `banquesAuTrenteEtUn` (lib/releveParCompte.ts), comme la
// validation — chaque compte par ses seuls relevés, jamais additionnés à l'intérieur d'un compte. Données FICTIVES.

const preuve = (compte: string, solde: number, d: Partial<DonneesDesPreuves>): PreuveProposee => preuveDuCompte(compte, solde, donnees(d))
const cles = (p: PreuveProposee) => p.faits.map((f) => f.cle)

function compte(o: Partial<CompteDuReleve>): CompteDuReleve {
  return { id: 'cb-p', libelle: 'Compte principal', principal: true, fin_d_identifiant: null, compte: null, compte_propre_depuis: null, ouvert_le: null, clos_le: null, ...o }
}
const PRINCIPAL = compte({})
const LIVRET = compte({ id: 'cb-2', libelle: 'Compte pro 2', principal: false, compte: '512100', compte_propre_depuis: '2026-01-01' })
const lus = (...comptes: CompteDuReleve[]): LectureDesComptes => ({ etat: 'lus', comptes })

const decembre = controleReleve({
  id: 'c-dec', source_fichier: 'releve-12.pdf', periode_debut: '2025-11-30', periode_fin: '2025-12-31', solde_initial: 1000,
  solde_final: 1034.25, somme_mouvements: 34.25, compte_bancaire_id: 'cb-p',
})
const annuel = controleReleve({
  id: 'c-an', source_fichier: null, periode_debut: '2025-01-01', periode_fin: '2025-12-31', solde_initial: 0,
  solde_final: 1034.25, somme_mouvements: 1034.25, compte_bancaire_id: 'cb-p',
})
const mouvementsDeDecembre = [
  ligne({ id: 'l1', date: '2025-12-05', montant: 100, source_fichier: 'releve-12.pdf', compte_bancaire_id: 'cb-p' }),
  ligne({ id: 'l2', date: '2025-12-20', montant: -65.75, source_fichier: 'releve-12.pdf', compte_bancaire_id: 'cb-p' }),
]
const duSecond = controleReleve({
  id: 'c-2', source_fichier: 'second.pdf', periode_debut: '2025-12-01', periode_fin: '2025-12-31', solde_initial: 10,
  solde_final: 20, somme_mouvements: 10, compte_bancaire_id: 'cb-2',
})
const mouvementDuSecond = ligne({ id: 'l3', date: '2025-12-10', montant: 10, source_fichier: 'second.pdf', compte_bancaire_id: 'cb-2' })

describe('la preuve du relevé, les comptes bancaires lus (MCB6)', () => {
  it('un seul compte : le mensuel et l’annuel disent le même solde, il ne compte qu’une fois, et la preuve conclut', () => {
    const p = preuve('512000', 103425, { comptesBancaires: lus(PRINCIPAL), controlesReleves: [decembre, annuel], lignes: mouvementsDeDecembre })
    expect(p.verdict).toBe('concorde')
    expect(p.attenduCentimes).toBe(103425)
    expect(preuveSuffisanteSeule(p)).toBe(true)
    // Les deux relevés se montrent un à un, sans nom de compte (un seul compte au dossier) ; aucun doute dit.
    expect(p.detail.map((l) => [l.libelle, l.montantCentimes])).toEqual([
      ['Relevé du 01/01/2025 au 31/12/2025 : solde au 31/12/2025', 103425],
      ['Relevé du 30/11/2025 au 31/12/2025 : solde au 31/12/2025', 103425],
    ])
    expect(cles(p)).toEqual([])
  })

  it('un seul compte : deux relevés qui disent des soldes différents ne s’additionnent pas, la preuve ne conclut pas', () => {
    const faux = controleReleve({ ...annuel, solde_final: 999, somme_mouvements: 999 })
    const p = preuve('512000', 103425, { comptesBancaires: lus(PRINCIPAL), controlesReleves: [decembre, faux], lignes: mouvementsDeDecembre })
    expect(p.verdict).toBe('incomplete')
    expect(p.attenduCentimes).toBeNull()
    expect(p.faits.find((f) => f.cle === 'plusieurs-releves')).toMatchObject({ nombre: 2, montantCentimes: null })
    expect(p.faits.find((f) => f.cle === 'plusieurs-releves')?.texte).toMatch(/^2 relevés disent des soldes différents au 31\/12\/2025 \(999,00\s€ au débit ; 1\s034,25\s€ au débit\) : l’un d’eux ne dit pas le bon solde, ou est d’un autre compte\.$/)
    expect(p.resume).toBe('Relevé au 31/12/2025 : les relevés disent des soldes différents au 31/12/2025.')
  })

  it('2025 : deux comptes au 512 du principal (MCB-Q7), leurs soldes s’additionnent, nommés', () => {
    const p = preuve('512000', 105425, {
      comptesBancaires: lus(PRINCIPAL, LIVRET), controlesReleves: [decembre, duSecond], lignes: [...mouvementsDeDecembre, mouvementDuSecond],
    })
    expect(p.verdict).toBe('concorde')
    expect(p.attenduCentimes).toBe(105425)
    expect(p.detail.map((l) => l.libelle)).toEqual([
      'Relevé du 30/11/2025 au 31/12/2025 du compte « Compte principal » : solde au 31/12/2025',
      'Relevé du 01/12/2025 au 31/12/2025 du compte « Compte pro 2 » : solde au 31/12/2025',
    ])
  })

  it('2025 : un compte sans relevé au 31 décembre retient la preuve, et se nomme', () => {
    const p = preuve('512000', 103425, {
      comptesBancaires: lus(PRINCIPAL, LIVRET), controlesReleves: [decembre], lignes: [...mouvementsDeDecembre, mouvementDuSecond],
    })
    expect(p.verdict).toBe('incomplete')
    expect(p.faits.find((f) => f.cle === 'aucun-releve')?.texte)
      .toBe('Aucun relevé importé du compte « Compte pro 2 » ne finit le 31/12/2025 ni ne couvre la fin de ce jour.')
    expect(p.resume).toBe('Relevé au 31/12/2025 : aucun relevé qui boucle ne donne le solde au 31/12/2025 du compte « Compte pro 2 ».')
  })

  it('2026 : le compte qui tient son propre 512 se prouve à part, et le 512 du principal sans lui', () => {
    const fin26 = (id: string, cb: string, solde: number, fichier: string) => controleReleve({
      id, source_fichier: fichier, periode_debut: '2026-12-01', periode_fin: '2026-12-31', solde_initial: solde, solde_final: solde,
      somme_mouvements: 0, compte_bancaire_id: cb,
    })
    const d = { comptesBancaires: lus(PRINCIPAL, LIVRET), annee: 2026, controlesReleves: [fin26('k1', 'cb-p', 500, 'p.pdf'), fin26('k2', 'cb-2', 70, 's.pdf')] }
    const principal = preuve('512000', 50000, d)
    expect(principal).toMatchObject({ type: 'releve', verdict: 'concorde', attenduCentimes: 50000 })
    const propre = preuve('512100', 7000, d)
    expect(propre).toMatchObject({ type: 'releve', verdict: 'concorde', attenduCentimes: 7000 })
    expect(propre.detail.map((l) => l.libelle)).toEqual(['Relevé du 01/12/2026 au 31/12/2026 du compte « Compte pro 2 » : solde au 31/12/2026'])
    // Le drapeau baissé, le même 512100 n'a pas de preuve : rien ne change.
    expect(preuve('512100', 7000, { ...d, comptesBancaires: { etat: 'sans_objet' } }).type).toBe('aucune')
  })

  it('un compte clos dans l’exercice compte pour zéro, sans relevé', () => {
    const clos = { ...LIVRET, clos_le: '2025-06-30' }
    const avantLaCloture = ligne({ id: 'l4', date: '2025-03-01', montant: 0, source_fichier: null, compte_bancaire_id: 'cb-2' })
    const p = preuve('512000', 103425, { comptesBancaires: lus(PRINCIPAL, clos), controlesReleves: [decembre], lignes: [...mouvementsDeDecembre, avantLaCloture] })
    expect(p.verdict).toBe('concorde')
    expect(p.detail.at(-1)).toEqual({ libelle: 'Compte « Compte pro 2 » clos le 30/06/2025 : solde nul au 31/12/2025', montantCentimes: 0, reference: null })
  })

  it('les comptes lus en partie : la preuve ne conclut pas, et dit pourquoi', () => {
    const p = preuve('512000', 103425, {
      comptesBancaires: { etat: 'illisible', motif: 'lecture incomplète' }, controlesReleves: [decembre], lignes: mouvementsDeDecembre,
    })
    expect(p.verdict).toBe('incomplete')
    expect(p.resume).toBe('Relevé au 31/12/2025 : les comptes bancaires du dossier n’ont pas été lus en entier (lecture incomplète) : le solde de chaque compte au 31/12/2025 ne se lit pas.')
  })

  it('l’écart est la somme des soldes initiaux des premiers relevés des deux comptes : elle se dit, nommée', () => {
    const p = preuve('512000', 0, {
      comptesBancaires: lus(PRINCIPAL, LIVRET), controlesReleves: [decembre, duSecond], lignes: [...mouvementsDeDecembre, mouvementDuSecond],
    })
    expect(p.verdict).toBe('ecart')
    expect(p.faits.find((f) => f.cle === 'ecart-egal-solde-initial')).toBeUndefined()
    expect(p.faits.find((f) => f.cle === 'ouverture-absente')?.texte).toMatch(
      /^L’exercice n’a pas d’ouverture sur le 512000, et les premiers relevés des comptes « Compte principal » \(1\s000,00\s€ au débit au 30\/11\/2025\) et « Compte pro 2 » \(10,00\s€ au débit au 01\/12\/2025\) commencent à 1\s010,00\s€ au débit à eux tous : sans balance reprise, le 512000 part de zéro\.$/)
    const juste = preuve('512000', 105425 - 101000, {
      comptesBancaires: lus(PRINCIPAL, LIVRET), controlesReleves: [decembre, duSecond], lignes: [...mouvementsDeDecembre, mouvementDuSecond],
    })
    expect(juste.faits.find((f) => f.cle === 'ecart-egal-solde-initial')?.texte).toMatch(/^L’écart est exactement la somme des soldes initiaux des premiers relevés des comptes .* : l’exercice n’a pas d’ouverture sur le 512000, qui part de zéro\.$/)
  })

  it('ce que la preuve n’établit pas change avec les comptes lus, et seulement alors', () => {
    expect(textesDesPreuves(PLAN_PAR_DEFAUT, true).releve.netablitPas).toContain('chaque relevé se juge sous son compte')
    expect(textesDesPreuves(PLAN_PAR_DEFAUT, false).releve.netablitPas).toContain('un relevé ne dit pas de quel compte il est')
    expect(textesDesPreuves(PLAN_PAR_DEFAUT, true)['virements-internes'].netablitPas).not.toContain('second compte bancaire')
    expect(textesDesPreuves(PLAN_PAR_DEFAUT, false)['virements-internes'].netablitPas).toContain('second compte bancaire')
    expect(preuve('512000', 103425, { comptesBancaires: lus(PRINCIPAL), controlesReleves: [decembre], lignes: mouvementsDeDecembre }).netablitPas)
      .toBe(textesDesPreuves(PLAN_PAR_DEFAUT, true).releve.netablitPas)
  })
})

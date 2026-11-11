import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { COMPTES_BANCAIRES_PREVUS } from './comptesBancaires'
import {
  compteAEcrire, compteDeLImport, finAPoser, partDuCompte, refusDeLIdentifiant, refusDuCompte, refusDuNomDuFichier,
  type CompteDuReleve, type LectureDesComptes,
} from './importParCompte'
import { partagerParMultiplicite, recouvrements } from './importReleve'
import { finDeLIdentifiant, lireReleveOfxQif } from './releveOfxQif'

// L'IMPORT D'UN RELEVÉ PAR COMPTE BANCAIRE (MCB2) : le compte choisi, la part du relevé contre laquelle le fichier se juge,
// le nom d'un fichier unique dans le dossier, l'OFX confronté au compte, et la migration de la fin d'identifiant.

const compte = (id: string, extra: Partial<CompteDuReleve> = {}): CompteDuReleve =>
  ({ id, libelle: `Compte ${id}`, principal: false, fin_d_identifiant: null, ...extra })
const PRINCIPAL = compte('p', { libelle: 'Compte principal', principal: true })
const SECOND = compte('s', { libelle: 'Compte épargne pro' })
const lus = (...comptes: CompteDuReleve[]): LectureDesComptes => ({ etat: 'lus', comptes })

describe('le compte de l’import', () => {
  it('drapeau baissé : tout le dossier, comme avant MCB, rien à écrire', () => {
    const c = compteDeLImport({ etat: 'sans_objet' }, null)
    expect(c).toEqual({ cas: 'tout_le_dossier' })
    expect(refusDuCompte(c)).toBeNull()
    expect(compteAEcrire(c)).toBeNull()
  })
  it('aucun compte encore : la base crée le principal, rien à écrire ni à choisir', () => {
    const c = compteDeLImport(lus(), null)
    expect(c).toEqual({ cas: 'premier' })
    expect(refusDuCompte(c)).toBeNull()
    expect(compteAEcrire(c)).toBeNull()
  })
  it('un seul compte : pris sans rien demander, et écrit', () => {
    const c = compteDeLImport(lus(PRINCIPAL), null)
    expect(c).toEqual({ cas: 'compte', compte: PRINCIPAL, seul: true })
    expect(refusDuCompte(c)).toBeNull()
    expect(compteAEcrire(c)).toBe('p')
  })
  it('deux comptes : aucun par défaut, l’import se refuse tant qu’aucun n’est choisi', () => {
    const c = compteDeLImport(lus(PRINCIPAL, SECOND), null)
    expect(c.cas).toBe('a_choisir')
    expect(refusDuCompte(c)).toMatch(/^Ce dossier tient 2 comptes bancaires : choisis celui/)
    expect(compteAEcrire(c)).toBeNull()
    // Un choix qui n'est plus un compte du dossier ne vaut rien.
    expect(compteDeLImport(lus(PRINCIPAL, SECOND), 'disparu').cas).toBe('a_choisir')
  })
  it('deux comptes, l’un choisi : celui-là', () => {
    const c = compteDeLImport(lus(PRINCIPAL, SECOND), 's')
    expect(c).toEqual({ cas: 'compte', compte: SECOND, seul: false })
    expect(compteAEcrire(c)).toBe('s')
  })
  it('une lecture en cours ou partielle retient l’import', () => {
    expect(refusDuCompte(compteDeLImport({ etat: 'en_cours' }, null))).toMatch(/en cours de lecture/)
    expect(refusDuCompte(compteDeLImport({ etat: 'illisible', motif: '3 ligne(s) lue(s) sur 4 annoncée(s)' }, 'p')))
      .toMatch(/n’ont pas été lus en entier \(3 ligne\(s\) lue\(s\) sur 4 annoncée\(s\)\)/)
  })
})

describe('la part du relevé du compte : le dédoublonnage et le recouvrement par compte', () => {
  const frais = (compteId: string) => ({ date: '2026-03-31', libelle: 'FRAIS TENUE DE COMPTE', montant: -2.5, source_fichier: `${compteId}-mars.csv`, compte_bancaire_id: compteId })
  const enBase = [frais('p'), frais('s')]
  const fichier = [{ date: '2026-03-31', libelle: 'FRAIS TENUE DE COMPTE', montant: -2.5 }]
  it('des frais identiques sur l’autre compte ne sont plus un doublon', () => {
    const c = compteDeLImport(lus(PRINCIPAL, SECOND), 's')
    // Le compte s porte déjà ses frais : doublon. Le compte p aussi. Mais un troisième compte neuf n'en porte aucun.
    expect(partagerParMultiplicite(fichier, partDuCompte(enBase, c)).dejaPresentes).toBe(1)
    const troisieme = compte('t')
    const ct = compteDeLImport(lus(PRINCIPAL, SECOND, troisieme), 't')
    expect(partagerParMultiplicite(fichier, partDuCompte(enBase, ct)).nouvelles).toHaveLength(1)
    // Avant MCB, le même fichier sous le dossier entier se disait déjà importé.
    expect(partagerParMultiplicite(fichier, partDuCompte(enBase, { cas: 'tout_le_dossier' })).nouvelles).toHaveLength(0)
  })
  it('le même mois d’un autre compte ne recouvre pas', () => {
    const ct = compteDeLImport(lus(PRINCIPAL, SECOND, compte('t')), 't')
    expect(recouvrements(['2026-03-01', '2026-04-02'], partDuCompte(enBase, ct))).toEqual([])
    expect(recouvrements(['2026-03-01', '2026-04-02'], partDuCompte(enBase, { cas: 'tout_le_dossier' }))).toHaveLength(2)
  })
  it('rien tant que le compte n’est pas connu, tout quand il n’y a pas encore de compte', () => {
    expect(partDuCompte(enBase, compteDeLImport(lus(PRINCIPAL, SECOND), null))).toEqual([])
    expect(partDuCompte(enBase, { cas: 'premier' })).toHaveLength(2)
  })
})

describe('le nom d’un fichier de relevé, unique dans le dossier (MCB-Q6)', () => {
  const lignes = [{ source_fichier: 'releve-mars.csv', compte_bancaire_id: 'p' }]
  const controles = [{ source_fichier: 'releve-avril.csv', compte_bancaire_id: 'p' }]
  const sousS = compteDeLImport(lus(PRINCIPAL, SECOND), 's')
  it('se refuse sous un compte quand il est celui d’un relevé de l’autre, par ses mouvements ou par son contrôle', () => {
    expect(refusDuNomDuFichier('releve-mars.csv', sousS, lignes, [], lus(PRINCIPAL, SECOND)))
      .toBe('Le relevé « releve-mars.csv » est déjà importé sous le compte « Compte principal » : le nom d’un fichier de relevé '
        + 'est unique dans le dossier. S’il est bien l’extrait de « Compte épargne pro », renomme le fichier avant de l’importer ; '
        + 'sinon, choisis le compte dont il est l’extrait.')
    expect(refusDuNomDuFichier('releve-avril.csv', sousS, [], controles, lus(PRINCIPAL, SECOND))).toMatch(/^Le relevé « releve-avril\.csv »/)
  })
  it('passe sous le même compte (un relevé redéposé), sous un autre nom, et drapeau baissé', () => {
    const sousP = compteDeLImport(lus(PRINCIPAL, SECOND), 'p')
    expect(refusDuNomDuFichier('releve-mars.csv', sousP, lignes, controles, lus(PRINCIPAL, SECOND))).toBeNull()
    expect(refusDuNomDuFichier('releve-mai.csv', sousS, lignes, controles, lus(PRINCIPAL, SECOND))).toBeNull()
    expect(refusDuNomDuFichier('releve-mars.csv', { cas: 'tout_le_dossier' }, lignes, controles, { etat: 'sans_objet' })).toBeNull()
    expect(refusDuNomDuFichier(null, sousS, lignes, controles, lus(PRINCIPAL, SECOND))).toBeNull()
  })
})

const ofx = (acctid: string | null) => `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:UTF-8

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR
<BANKACCTFROM><BANKID>30002<BRANCHID>00550${acctid === null ? '' : `<ACCTID>${acctid}`}<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260310<TRNAMT>-12.50<FITID>1<NAME>FRAIS
<BANKACCTTO><BANKID>1<ACCTID>99999999<ACCTTYPE>CHECKING</BANKACCTTO></STMTTRN></BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

describe('l’OFX confronté au compte choisi', () => {
  it('un OFX rend les quatre derniers caractères de son compte, jamais le numéro, ni dans ses lignes', () => {
    const lu = lireReleveOfxQif(ofx('0000123456 7'))
    expect(lu && lu.refus === null && lu.finDIdentifiant).toBe('4567')
    expect(JSON.stringify(lu && lu.refus === null ? lu.lignes : null)).not.toMatch(/123456/)
    // Le compte du virement (BANKACCTTO, dans l'opération) n'est pas celui du relevé.
    expect(lu && lu.refus === null && lu.finDIdentifiant).not.toBe('9999')
    const sans = lireReleveOfxQif(ofx(null))
    expect(sans && sans.refus === null && sans.finDIdentifiant).toBeNull()
    expect(finDeLIdentifiant('f-12')).toBeNull()
    expect(finDeLIdentifiant('ab-cd12')).toBe('CD12')
  })
  it('se refuse quand un autre compte retient ces caractères, ou que le compte choisi en retient d’autres', () => {
    const p = { ...PRINCIPAL, fin_d_identifiant: '4567' }
    const lecture = lus(p, SECOND)
    expect(refusDeLIdentifiant('4567', compteDeLImport(lecture, 's'), lecture))
      .toBe('Ce relevé OFX est celui du compte « Compte principal » : l’identifiant de compte qu’il porte finit comme celui des '
        + 'relevés OFX déjà importés sous lui. Choisis ce compte, plutôt que « Compte épargne pro ».')
    expect(refusDeLIdentifiant('8888', compteDeLImport(lecture, 'p'), lecture)).toMatch(/n’est pas celui du compte « Compte principal ».*Choisis le compte/)
    // Un seul compte : l'OFX d'un autre compte se refuse, et dit qu'il se crée d'abord.
    expect(refusDeLIdentifiant('8888', compteDeLImport(lus(p), null), lus(p))).toMatch(/ce compte se crée d’abord/)
  })
  it('passe : les mêmes caractères, un compte qui n’en retient encore aucun, un CSV ou un QIF, un dossier sans compte', () => {
    const p = { ...PRINCIPAL, fin_d_identifiant: '4567' }
    const lecture = lus(p, SECOND)
    expect(refusDeLIdentifiant('4567', compteDeLImport(lecture, 'p'), lecture)).toBeNull()
    expect(refusDeLIdentifiant('8888', compteDeLImport(lecture, 's'), lecture)).toBeNull()
    expect(refusDeLIdentifiant(null, compteDeLImport(lecture, 's'), lecture)).toBeNull()
    expect(refusDeLIdentifiant('8888', { cas: 'premier' }, lus())).toBeNull()
    expect(refusDeLIdentifiant('8888', { cas: 'tout_le_dossier' }, { etat: 'sans_objet' })).toBeNull()
  })
  it('la fin se pose sur un compte qui n’en retient aucune, jamais par-dessus une autre', () => {
    const lecture = lus(PRINCIPAL, SECOND)
    expect(finAPoser('8888', compteDeLImport(lecture, 's'))).toBe('8888')
    expect(finAPoser('4567', compteDeLImport(lus({ ...PRINCIPAL, fin_d_identifiant: '4567' }), null))).toBeNull()
    expect(finAPoser(null, compteDeLImport(lecture, 's'))).toBeNull()
    expect(finAPoser('8888', { cas: 'premier' })).toBeNull()
  })
})

describe('la migration de la fin d’identifiant', () => {
  const trouver = (motif: RegExp, dossiers: readonly string[]) => {
    const trouves: string[] = []
    for (const dossier of dossiers) {
      const chemin = new URL(dossier, import.meta.url).pathname
      if (!existsSync(chemin)) continue
      for (const nom of readdirSync(chemin)) if (motif.test(nom)) trouves.push(chemin + nom)
    }
    expect(trouves, String(motif)).toHaveLength(1)
    return trouves[0]
  }
  const chemin = trouver(/^\d{14}_fin_d_identifiant_des_comptes_bancaires\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
  const migration = readFileSync(chemin, 'utf8')
  const retour = readFileSync(trouver(/^\d{14}_retour_fin_d_identifiant_des_comptes_bancaires\.sql$/, ['../../supabase/preparees/retour/']), 'utf8')
  it('la forme que la base tient est celle que le module rend', () => {
    expect(migration).toContain("check (fin_d_identifiant ~ '^[0-9A-Z]{4}$')")
    for (const v of ['0000123456 7', 'ab-cd12', '12345678901234']) expect(finDeLIdentifiant(v)).toMatch(/^[0-9A-Z]{4}$/)
  })
  it('n’ajoute qu’une colonne, sans rien retirer ; son retour la retire', () => {
    expect(migration).not.toMatch(/\b(drop|delete|truncate)\b/i)
    expect(migration).not.toMatch(/create (policy|function|trigger)|security definer/i)
    expect(retour).toMatch(/alter table public\.comptes_bancaires drop column fin_d_identifiant;/)
  })
  it('elle suit MCB1 sous le même drapeau : levé, elle est dans l’export elle aussi', () => {
    expect(COMPTES_BANCAIRES_PREVUS).toBe(chemin.includes('/supabase/schema/'))
  })
  it('son essai est rejoué par la liste des essais', () => {
    expect(existsSync(new URL('../../supabase/essais/finDIdentifiantDesComptes.sql', import.meta.url))).toBe(true)
  })
})

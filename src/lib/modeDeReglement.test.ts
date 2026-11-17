import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contientSql, indiceSql } from '../test/schema'
import { MODES_REGLEMENT } from './champsBncDuFec'
import {
  argumentsDuMode, estUnModeDUnMouvement, libelleDuMode, MODE_DE_REGLEMENT_PREVU, modeDeLaFiche, MODES_D_UN_MOUVEMENT,
  MOUVEMENTS_PAR_APPEL, proposerModeDeReglement, raisonDeLaProposition, REFUS_DU_MODE_DE_REGLEMENT, type ModeDUnMouvement,
} from './modeDeReglement'
import type { LigneBancaire } from './types'

// EXP58-Q1 : LE MODE DE RÈGLEMENT D'UN MOUVEMENT DU RELEVÉ. La proposition tirée des seuls mots sûrs du libellé (et rien
// sinon), les mots et l'état de la fiche, et la liste, les refus et la borne confrontés au texte de la migration
// `mode_de_reglement_des_mouvements`, à son retour et à son essai ; le drapeau suit l'export. Données FICTIVES : les noms et
// les commerçants des libellés n'appartiennent à personne.

function leFichier(motif: RegExp, dossiers: readonly string[]): string {
  const trouves: string[] = []
  for (const dossier of dossiers) {
    const chemin = new URL(dossier, import.meta.url).pathname
    if (!existsSync(chemin)) continue
    for (const nom of readdirSync(chemin)) if (motif.test(nom)) trouves.push(chemin + nom)
  }
  expect(trouves, String(motif)).toHaveLength(1)
  return readFileSync(trouves[0], 'utf8')
}

const MIGRATION = leFichier(/^\d{14}_mode_de_reglement_des_mouvements\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
const RETOUR = leFichier(/^\d{14}_retour_mode_de_reglement_des_mouvements\.sql$/, ['../../supabase/preparees/retour/'])
const ESSAI = readFileSync(new URL('../../supabase/essais/modeDeReglementDesMouvements.sql', import.meta.url), 'utf8')
const MODULE = readFileSync(new URL('./modeDeReglement.ts', import.meta.url), 'utf8')
const EXPORTEE = readdirSync(new URL('../../supabase/schema/', import.meta.url).pathname)
  .some((f) => /^\d{14}_mode_de_reglement_des_mouvements\.sql$/.test(f))
// La définition que le catalogue rend de la contrainte (relue sur une copie de la réplique le 17/11/2026).
const DEFINITION = "CHECK (((mode_reglement IS NULL) OR (mode_reglement = ANY (ARRAY['Virement'::text, 'Prélèvement'::text, 'Carte bancaire'::text, "
  + "'Chèque'::text, 'Espèces'::text, 'Effet'::text, 'Autre'::text]))))"
const sql = (texte: string) => texte.replaceAll("'", "''")
const ligne = (libelle: string, montant: number, mode?: ModeDUnMouvement | null): Pick<LigneBancaire, 'libelle' | 'montant' | 'mode_reglement'> =>
  ({ libelle, montant, ...(mode === undefined ? {} : { mode_reglement: mode }) })

describe('la liste fermée des modes d’un mouvement', () => {
  it('sept modes, chacun un mode du FEC, sans « Banque », la poche de l’exploitant, la compensation ni « Sans règlement »', () => {
    expect(MODES_D_UN_MOUVEMENT).toEqual(['Virement', 'Prélèvement', 'Carte bancaire', 'Chèque', 'Espèces', 'Effet', 'Autre'])
    for (const m of MODES_D_UN_MOUVEMENT) expect(MODES_REGLEMENT).toContain(m)
    expect(MODES_D_UN_MOUVEMENT.filter((m) => ['Banque', 'Compte personnel', 'Compensation', 'Sans règlement'].includes(m))).toEqual([])
    expect(MODES_D_UN_MOUVEMENT.every(estUnModeDUnMouvement)).toBe(true)
    for (const v of ['Banque', 'carte', '', null, undefined, 3]) expect(estUnModeDUnMouvement(v)).toBe(false)
  })
})

describe('la proposition, tirée des seuls mots sûrs en tête du libellé de la banque', () => {
  const sures: [string, number, ModeDUnMouvement, string][] = [
    ['PRLV SEPA FOURNISSEUR ENERGIE', -45.5, 'Prélèvement', 'PRLV'],
    ['Prlv. sepa assurance', -12, 'Prélèvement', 'PRLV'],
    ['Prélèvement SEPA URSSAF', -300, 'Prélèvement', 'PRELEVEMENT'],
    ['PRELEVEMENT EUROPEEN 1234', -20, 'Prélèvement', 'PRELEVEMENT'],
    ['VIR SEPA RECU /DE CPAM', 120, 'Virement', 'VIR'],
    ['VIR INST LOYER CABINET', -800, 'Virement', 'VIR'],
    ['VIREMENT EN VOTRE FAVEUR', 60, 'Virement', 'VIREMENT'],
    ['CB LIBRAIRIE IMAGINAIRE 12/03', -19.9, 'Carte bancaire', 'CB'],
    ['CB*AVOIR LIBRAIRIE', 19.9, 'Carte bancaire', 'CB'],
    ['CARTE X1234 12/03 PHARMACIE', -8, 'Carte bancaire', 'CARTE'],
    ['CARTE 12/03/26 STATION', -40, 'Carte bancaire', 'CARTE'],
    ['PAIEMENT CB 1203 FOURNITURES', -25, 'Carte bancaire', 'PAIEMENT CB'],
    ['PAIEMENT PAR CARTE STATION', -40, 'Carte bancaire', 'PAIEMENT PAR CARTE'],
    ['FACTURE CARTE DU 120326 MATERIEL', -30, 'Carte bancaire', 'FACTURE CARTE'],
    ['ACHAT CB 12.03 MATERIEL', -99, 'Carte bancaire', 'ACHAT CB'],
    ['CHQ 1234567', -150, 'Chèque', 'CHQ'],
    ['CHQ. 1234567', -150, 'Chèque', 'CHQ'],
    ['CHEQUE N° 1234567', -150, 'Chèque', 'CHEQUE'],
    ['CHEQUE', -150, 'Chèque', 'CHEQUE'],
    ['REMISE CHEQUES N 12', 300, 'Chèque', 'REMISE CHEQUES'],
    ['REM CHQ 0012345', 300, 'Chèque', 'REM CHQ'],
    ['REMISE DE CHEQUES', 300, 'Chèque', 'REMISE DE CHEQUES'],
    ['VERSEMENT ESPECES', 200, 'Espèces', 'VERSEMENT ESPECES'],
    ['VRST ESP 12', 200, 'Espèces', 'VRST ESP'],
    ['Dépôt d’espèces agence', 200, 'Espèces', 'DEPOT D ESPECES'],
    ['REMISE ESPECES', 100, 'Espèces', 'REMISE ESPECES'],
    ['RETRAIT DAB 12/03 VILLE', -60, 'Espèces', 'RETRAIT'],
    ['RETRAIT 12/03 DISTRIBUTEUR', -60, 'Espèces', 'RETRAIT'],
    ['CB RETRAIT DU 12/03', -40, 'Espèces', 'CB RETRAIT'],
  ]
  it.each(sures)('« %s » (%d) : %s, par « %s »', (libelle, montant, mode, mots) => {
    expect(proposerModeDeReglement({ libelle, montant })).toEqual({ mode, mots })
  })

  const douteuses: [string, number][] = [
    ['CARTE GRISE PREFECTURE', -42.76],
    ['CHEQUE DEJEUNER', -10],
    ['COTIS CARTE VISA', -45],
    ['FRAIS TENUE DE COMPTE', -5],
    ['COMMISSION INTERVENTION', -8],
    ['REJET PRLV SEPA', 45],
    ['AVOIR CB LIBRAIRIE', 19.9],
    ['12/03 CB LIBRAIRIE', -19.9],
    ['Mouvement bancaire', -10],
    ['ECHEANCE PRET 12345', -500],
    ['LCR DOMICILIEE', -300],
    ['AGIOS', -3],
    ['VIRGIN MOBILE', -20],
    ['CBX SOCIETE IMAGINAIRE', -20],
    ['PRLVT INCONNU', -20],
    // Le sens qui va avec le mot : un débit ne se « verse » pas, un crédit ne se « retire » pas, une remise est un crédit.
    ['VERSEMENT ESPECES', -200],
    ['RETRAIT DAB', 60],
    ['REMISE CHEQUES', -300],
    ['', -10],
  ]
  it.each(douteuses)('« %s » (%d) : rien de proposé', (libelle, montant) => {
    expect(proposerModeDeReglement({ libelle, montant })).toBeNull()
  })

  it('un montant nul ou illisible, un libellé absent : rien', () => {
    expect(proposerModeDeReglement({ libelle: 'PRLV SEPA', montant: 0 })).toBeNull()
    expect(proposerModeDeReglement({ libelle: 'PRLV SEPA', montant: Number.NaN })).toBeNull()
    expect(proposerModeDeReglement({ libelle: null as unknown as string, montant: -5 })).toBeNull()
  })

  it('jamais « Effet » ni « Autre » : le cabinet les choisit', () => {
    const proposes = new Set([...sures, ...douteuses].map(([libelle, montant]) => proposerModeDeReglement({ libelle, montant })?.mode))
    expect(proposes.has('Effet')).toBe(false)
    expect(proposes.has('Autre')).toBe(false)
  })

  it('la raison ne cite que les mots de type, jamais la suite du libellé (un nom, un commerçant)', () => {
    const p = proposerModeDeReglement({ libelle: 'VIR SEPA RECU /DE ZEPHYRIN FICTIF', montant: 80 })
    expect(p).toEqual({ mode: 'Virement', mots: 'VIR' })
    expect(raisonDeLaProposition(p!)).toBe('le libellé de la banque commence par « VIR »')
    expect(raisonDeLaProposition(p!)).not.toMatch(/ZEPHYRIN|FICTIF|SEPA/)
  })
})

describe('les mots et l’état de la fiche', () => {
  it('les espèces disent leur sens ; les autres modes, leur nom', () => {
    expect(libelleDuMode('Espèces', 200)).toBe('Espèces (un versement)')
    expect(libelleDuMode('Espèces', -60)).toBe('Espèces (un retrait)')
    for (const m of MODES_D_UN_MOUVEMENT.filter((x) => x !== 'Espèces')) expect(libelleDuMode(m, -10)).toBe(m)
  })

  it('le drapeau baissé, ou un dossier en engagement : rien, la fiche d’hier', () => {
    expect(modeDeLaFiche(ligne('PRLV SEPA', -10, null), null, 'tresorerie', false)).toEqual({ etat: 'absent' })
    expect(modeDeLaFiche(ligne('PRLV SEPA', -10, null), null, 'engagement', true)).toEqual({ etat: 'absent' })
  })

  it('un mouvement lu sans sa colonne, ou avec une valeur hors de la liste : illisible, aucun geste', () => {
    expect(modeDeLaFiche(ligne('PRLV SEPA', -10), null, 'tresorerie', true)).toEqual({ etat: 'illisible' })
    expect(modeDeLaFiche({ libelle: 'PRLV SEPA', montant: -10, mode_reglement: 'Banque' as ModeDUnMouvement }, null, 'tresorerie', true))
      .toEqual({ etat: 'illisible' })
  })

  it('figé par un exercice validé : le mode se dit, sans geste ni proposition', () => {
    expect(modeDeLaFiche(ligne('PRLV SEPA', -10, 'Chèque'), 'L’exercice 2025 est validé', 'tresorerie', true))
      .toEqual({ etat: 'fige', mode: 'Chèque', figeePar: 'L’exercice 2025 est validé' })
    expect(modeDeLaFiche(ligne('PRLV SEPA', -10, null), 'L’exercice 2025 est validé', 'tresorerie', true))
      .toEqual({ etat: 'fige', mode: null, figeePar: 'L’exercice 2025 est validé' })
  })

  it('ouvert : le mode posé, et la proposition du libellé seulement quand elle en diffère', () => {
    expect(modeDeLaFiche(ligne('PRLV SEPA', -10, null), null, 'tresorerie', true))
      .toEqual({ etat: 'ouvert', mode: null, proposition: { mode: 'Prélèvement', mots: 'PRLV' } })
    expect(modeDeLaFiche(ligne('PRLV SEPA', -10, 'Prélèvement'), null, 'tresorerie', true))
      .toEqual({ etat: 'ouvert', mode: 'Prélèvement', proposition: null })
    expect(modeDeLaFiche(ligne('PRLV SEPA', -10, 'Virement'), null, 'tresorerie', true))
      .toEqual({ etat: 'ouvert', mode: 'Virement', proposition: { mode: 'Prélèvement', mots: 'PRLV' } })
    expect(modeDeLaFiche(ligne('FRAIS TENUE DE COMPTE', -5, null), null, 'tresorerie', true))
      .toEqual({ etat: 'ouvert', mode: null, proposition: null })
  })

  it('les arguments de la fonction pour un mouvement : un mode, ou nul pour le retirer', () => {
    expect(argumentsDuMode('d1', 'm1', 'Chèque')).toEqual({ p_dossier_id: 'd1', p_lignes: ['m1'], p_modes: ['Chèque'] })
    expect(argumentsDuMode('d1', 'm1', null)).toEqual({ p_dossier_id: 'd1', p_lignes: ['m1'], p_modes: [null] })
  })

  it('un module pur : ni base, ni horloge', () => {
    expect(MODULE).not.toMatch(/from '\.\/supabase'/)
    expect(MODULE).not.toMatch(/new Date\(|Date\.now\(/)
  })
})

describe('la migration mode_de_reglement_des_mouvements', () => {
  // Les listes entre parenthèses qui suivent un motif, mot à mot.
  const listeApres = (texte: string, motif: string) => {
    const debut = texte.indexOf(motif)
    expect(debut, motif).toBeGreaterThan(0)
    const fin = texte.indexOf(')', debut + motif.length)
    return [...texte.slice(debut + motif.length, fin).matchAll(/'([^']*)'/g)].map((m) => m[1])
  }

  it('la contrainte et la fonction tiennent la liste du module, dans son ordre ; la garde de fin, le retour et l’essai, son rendu', () => {
    expect(listeApres(MIGRATION, 'or mode_reglement in (')).toEqual([...MODES_D_UN_MOUVEMENT])
    expect(listeApres(MIGRATION, 'and m not in (')).toEqual([...MODES_D_UN_MOUVEMENT])
    expect(MIGRATION).toContain(`is distinct from '${sql(DEFINITION)}'`)
    expect(RETOUR).toContain(`is distinct from '${sql(DEFINITION)}'`)
    expect(ESSAI).toContain(sql(DEFINITION))
    expect(contientSql(MIGRATION, 'alter table public.lignes_bancaires add column mode_reglement text;')).toBe(true)
  })

  it('chaque refus de la fonction et de sa garde, sous les mots et le code que le module redit, dans l’ordre de la base', () => {
    const r = REFUS_DU_MODE_DE_REGLEMENT
    expect(MIGRATION).toContain(`raise exception '${sql(r.acces.message)}' using errcode = '${r.acces.code}'`)
    expect(MIGRATION).toContain(`c_forme constant text := '${sql(r.forme.message)}'`)
    expect(MIGRATION).toContain(`raise exception '%', c_forme using errcode = '${r.forme.code}'`)
    expect(MIGRATION).toContain(`raise exception '${sql(r.horsDuDossier.message)}' using errcode = '${r.horsDuDossier.code}'`)
    expect(MIGRATION).toMatch(new RegExp(`raise exception '${sql(r.horsDeLaListe.message).replace(/[().]/g, '\\$&')}'\\s+using errcode = '${r.horsDeLaListe.code}'`))
    expect(MIGRATION).toMatch(new RegExp(`raise exception '${sql(r.ecritureDirecte.message).replace(/[().]/g, '\\$&')}'\\s+using errcode = '${r.ecritureDirecte.code}'`))
    expect(MIGRATION).toMatch(new RegExp(`raise exception '${sql(r.insertion.message).replace(/[().]/g, '\\$&')}'\\s+using errcode = '${r.insertion.code}'`))
    // L'ordre : l'accès avant toute lecture, puis la forme, le dossier, la liste.
    const corps = MIGRATION.slice(indiceSql(MIGRATION, 'create function public.poser_modes_de_reglement'))
    const rangs = [r.acces, r.forme, r.horsDuDossier, r.horsDeLaListe].map((x) => corps.indexOf(x === r.forme ? "'%', c_forme" : sql(x.message)))
    expect(rangs.every((x) => x > 0)).toBe(true)
    expect([...rangs].sort((a, b) => a - b)).toEqual(rangs)
    expect(corps.indexOf('admin_du_dossier(p_dossier_id)')).toBeLessThan(corps.indexOf('from public.lignes_bancaires'))
    // L'essai attend les mêmes mots.
    for (const x of Object.values(r)) expect(ESSAI).toContain(`'${sql(x.message)}'`)
  })

  it('la borne d’un appel, celle du module', () => {
    expect(MOUVEMENTS_PAR_APPEL).toBe(1000)
    expect(MIGRATION).toContain(`cardinality(p_lignes) not between 1 and ${MOUVEMENTS_PAR_APPEL}`)
  })

  it('aucune branche client : la seule porte est admin_du_dossier', () => {
    const corps = MIGRATION.slice(indiceSql(MIGRATION, 'create function public.poser_modes_de_reglement'),
      indiceSql(MIGRATION, 'comment on function public.poser_modes_de_reglement'))
    expect(corps).not.toMatch(/client_du_dossier|memberships|droits_sur_le_dossier|gere_la_banque/)
    expect(corps.match(/admin_du_dossier/g)).toHaveLength(1)
  })

  it('le figement relu en tête et en fin : le corps de garder_mouvement_valide qui compare la ligne entière', () => {
    expect(MIGRATION.match(/f10207e741e52cd7684e2b9e5ccd5328/g)).toHaveLength(2)
    expect(ESSAI).toContain('f10207e741e52cd7684e2b9e5ccd5328')
  })

  it('s’applique par l’outil : aucune instruction qui retire, aucune barre oblique inverse, aucune fonction remplacée', () => {
    expect(MIGRATION.replaceAll('attisdropped', '')).not.toMatch(/\b(drop|delete|truncate)\b/i)
    expect(MIGRATION).not.toContain('\\')
    expect(MIGRATION).not.toMatch(/create\s+or\s+replace/i)
  })

  it('le retour se colle par le cabinet, et refuse dès qu’un mouvement porte un mode', () => {
    expect(RETOUR).toMatch(/À COLLER par le cabinet/)
    expect(RETOUR).toContain('where mode_reglement is not null')
    expect(contientSql(RETOUR, 'alter table public.lignes_bancaires drop column mode_reglement;')).toBe(true)
    expect(contientSql(RETOUR, 'drop function public.poser_modes_de_reglement(uuid, uuid[], text[]);')).toBe(true)
    expect(contientSql(RETOUR, 'drop function public.garder_mode_de_reglement();')).toBe(true)
  })

  it('le drapeau suit l’export : baissé tant que la migration n’y est pas, levé le jour où elle y entre', () => {
    expect(MODE_DE_REGLEMENT_PREVU).toBe(EXPORTEE)
  })
})

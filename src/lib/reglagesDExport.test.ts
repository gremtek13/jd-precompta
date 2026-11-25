import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FORMES_DES_TIERS, LONGUEUR_DES_COMPTES_MAX, LONGUEUR_DES_COMPTES_MIN, mettreEnFormePourAcd, PROFILS_D_EXPORT,
} from './profilsDExport'
import {
  CODE_DU_JOURNAL_DU_LOGICIEL, codeDeLaSaisie, COLONNES_DES_REGLAGES_D_EXPORT, JOURNAUX_DE_L_APPLICATION, LOGICIELS_DES_REGLAGES,
  longueurDeLaSaisie, memesReglages, phraseDeLEnregistrement, phraseDeRienAEnregistrer, phraseDesReglagesGardes, profilDeLaSaisie, REFUS_DE_LA_BASE,
  REGLAGES_D_EXPORT_PREVUS, refusDeLEnregistrement, reglagesLisibles, reglagesPourLaBase, SAISIE_A_SAISIR, saisieDesReglagesGardes,
  TABLES_DES_REGLAGES_D_EXPORT, type SaisieDesReglages,
} from './reglagesDExport'
import type { ReglagesDExport } from './types'

// LES RÉGLAGES DE L'EXPORT VERS UN LOGICIEL COMPTABLE, GARDÉS PAR DOSSIER (EXP-Q4 (A)) : le module confronté au texte de la
// migration préparée — ses refus sous leurs mots et dans leur ordre, ses listes fermées (les logiciels, les formes des tiers,
// les cinq journaux), ses bornes, ses colonnes —, son retour (les trois corps à leur empreinte), et ce que le module en fait :
// la saisie préremplie, le refus dit avant le clic, le profil de l'export ou ce qui reste « à saisir », jamais une valeur par
// défaut. Les essais de la base : supabase/essais/reglagesDExport.sql (une réplique) et le bloc RX de supabase/essais/rls.sql.

function fichiersDe(dossier: string, motif: RegExp): string[] {
  const chemin = resolve(process.cwd(), dossier)
  return existsSync(chemin) ? readdirSync(chemin).filter((n) => motif.test(n)).map((n) => `${dossier}/${n}`) : []
}

// La migration vit dans `supabase/preparees/` tant qu'elle n'est pas appliquée, puis dans l'export sous la version de sa ligne
// d'historique, texte inchangé : le test la trouve où elle est — un seul fichier en tout —, et juge le drapeau contre ce lieu.
const NOM_DE_LA_MIGRATION = /^\d{14}_reglages_d_export\.sql$/
const PREPAREES = fichiersDe('supabase/preparees', NOM_DE_LA_MIGRATION)
const DANS_L_EXPORT = fichiersDe('supabase/schema', NOM_DE_LA_MIGRATION)
const MIGRATION = [...PREPAREES, ...DANS_L_EXPORT][0]
const RETOUR = 'supabase/preparees/retour/20261124160100_retour_reglages_d_export.sql'
const ESSAI = 'supabase/essais/reglagesDExport.sql'
const texte = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8')
const retour = readFileSync(resolve(process.cwd(), RETOUR), 'utf8')
const essai = readFileSync(resolve(process.cwd(), ESSAI), 'utf8')
const rls = readFileSync(resolve(process.cwd(), 'supabase/essais/rls.sql'), 'utf8')

/** Le corps d'une fonction de la migration, tel que la base le garde (`prosrc`). */
function corpsDe(nom: string): string {
  const m = new RegExp(String.raw`create function public\.${nom}\([^)]*\)[\s\S]*?\bas (\$\w*\$)([\s\S]*?)\1`, 'i').exec(texte)
  if (!m) throw new Error(`la fonction ${nom} est introuvable dans la migration`)
  return m[2]
}

const gardes = (o: Partial<ReglagesDExport> = {}): ReglagesDExport => ({
  id: 'r1', dossier_id: 'd1', logiciel: 'acd', longueur_des_comptes: 8, forme_des_tiers: 'sans_auxiliaires',
  journal_ac: 'HA', journal_ve: 'VT', journal_bq: 'CA1', journal_od: 'OD', journal_an: null, version: 3,
  regle_par: 'u1', regle_le: '2026-11-24T10:00:00Z', ...o,
})
const saisieDe = (o: Partial<SaisieDesReglages> = {}): SaisieDesReglages => ({ ...SAISIE_A_SAISIR, ...o })

describe('le drapeau et les fichiers de la migration', () => {
  it('une seule migration, préparée tant que le drapeau est baissé, dans l’export une fois levé ; son retour et son essai à côté', () => {
    expect([...PREPAREES, ...DANS_L_EXPORT]).toHaveLength(1)
    expect(DANS_L_EXPORT).toHaveLength(REGLAGES_D_EXPORT_PREVUS ? 1 : 0)
    expect(PREPAREES).toHaveLength(REGLAGES_D_EXPORT_PREVUS ? 0 : 1)
    for (const f of [RETOUR, ESSAI]) expect(existsSync(resolve(process.cwd(), f)), f).toBe(true)
    expect(TABLES_DES_REGLAGES_D_EXPORT).toEqual(['reglages_d_export'])
  })

  it('aucune branche client, aucun mot que l’outil d’application retient, ni barre oblique inverse ni retour chariot', () => {
    expect(texte).not.toMatch(/client_du_dossier|droits_sur_le_dossier|gere_les_ventes|gere_la_banque|memberships/)
    expect(texte).not.toMatch(/\bdelete\s+from\b|\bdrop\b|\btruncate\b/i)
    expect(texte).not.toContain('\\')
    expect(texte).not.toContain('\r')
    // La lecture : le cabinet du dossier seul ; l'écriture : la fonction et la réinsertion du super-administrateur.
    expect(texte).toMatch(/create\s+policy\s+reglages_d_export_lecture\s+on\s+public\.reglages_d_export\s+for\s+select\s+to\s+authenticated\s+using\s+\(public\.admin_du_dossier\(dossier_id\)\);/i)
    expect(texte).toMatch(/create\s+policy\s+reglages_d_export_restauration\s+on\s+public\.reglages_d_export\s+for\s+insert\s+to\s+authenticated\s+with\s+check\s+\(public\.is_super_admin\(\)\);/i)
    expect(texte.match(/^create\s+policy\s/gim)).toHaveLength(2)
  })
})

describe('les refus de la base, redits sous leurs mots et dans leur ordre', () => {
  it('chaque refus est un littéral de la migration, l’apostrophe droite doublée', () => {
    for (const [nom, mots] of Object.entries(REFUS_DE_LA_BASE)) {
      expect(texte, nom).toContain(`'${mots.replace(/'/g, "''")}'`)
    }
  })

  it('la fonction les lève dans l’ordre du module : l’accès, le logiciel, l’objet, la longueur, la forme, les journaux, le code, la version', () => {
    const corps = corpsDe('enregistrer_reglages_d_export')
    const ordre = ['acces', 'logiciel', 'objet', 'longueur', 'forme', 'journaux', 'code', 'version'] as const
    const rangs = ordre.map((nom) => corps.indexOf(`'${REFUS_DE_LA_BASE[nom]}'`))
    expect(rangs.every((r) => r > 0)).toBe(true)
    expect([...rangs].sort((a, b) => a - b)).toEqual(rangs)
    expect(corpsDe('garder_reglages_d_export')).toContain(`'${REFUS_DE_LA_BASE.garde}'`)
    expect(corpsDe('garder_reglages_d_export')).toContain(`'${REFUS_DE_LA_BASE.cle}'`)
  })

  it('les codes des refus : 42501 pour l’accès et la garde, 22023 pour une saisie, 40001 pour la version, 23514 pour la clé', () => {
    const corps = corpsDe('enregistrer_reglages_d_export')
    const code = (mots: string, dans: string) => new RegExp(`'${mots.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\s+using errcode = '(\\d{5})'`).exec(dans)?.[1]
    expect(code(REFUS_DE_LA_BASE.acces, corps)).toBe('42501')
    for (const nom of ['logiciel', 'objet', 'longueur', 'forme', 'journaux', 'code'] as const) expect(code(REFUS_DE_LA_BASE[nom], corps), nom).toBe('22023')
    expect(code(REFUS_DE_LA_BASE.version, corps)).toBe('40001')
    expect(code(REFUS_DE_LA_BASE.garde, corpsDe('garder_reglages_d_export'))).toBe('42501')
    expect(code(REFUS_DE_LA_BASE.cle, corpsDe('garder_reglages_d_export'))).toBe('23514')
  })
})

describe('les listes fermées, les bornes et les colonnes sont celles de la base', () => {
  it('les logiciels : la liste de `logiciels_d_export()` est celle des profils de l’application', () => {
    expect(corpsDe('logiciels_d_export').trim()).toBe(`select array[${LOGICIELS_DES_REGLAGES.map((l) => `'${l}'`).join(', ')}]::text[]`)
    expect(LOGICIELS_DES_REGLAGES).toEqual(PROFILS_D_EXPORT.map((p) => p.id))
    expect(texte).toContain('check (logiciel = any (public.logiciels_d_export()))')
  })

  it('les formes des tiers : celles du profil, dans la contrainte et dans la fonction', () => {
    const liste = FORMES_DES_TIERS.map((f) => `'${f.id}'`).join(', ')
    expect(texte).toContain(`check (forme_des_tiers in (${liste}))`)
    expect(corpsDe('enregistrer_reglages_d_export')).toContain(`(v_valeur #>> '{}') not in (${liste})`)
  })

  it('les cinq journaux : leur liste dans la fonction, une colonne chacun, la même forme du code partout', () => {
    expect(corpsDe('enregistrer_reglages_d_export')).toContain(`k.cle not in (${JOURNAUX_DE_L_APPLICATION.map((j) => `'${j.code}'`).join(', ')})`)
    for (const j of JOURNAUX_DE_L_APPLICATION) {
      expect(texte, j.code).toContain(`constraint reglages_d_export_${j.colonne} check (${j.colonne} ~ '${CODE_DU_JOURNAL_DU_LOGICIEL.source}')`)
      expect(corpsDe('enregistrer_reglages_d_export'), j.code).toContain(`${j.colonne} = v_codes ->> '${j.code}'`)
    }
    expect(corpsDe('enregistrer_reglages_d_export')).toContain(`(v_valeur #>> '{}') !~ '${CODE_DU_JOURNAL_DU_LOGICIEL.source}'`)
  })

  it('la longueur des comptes : les bornes du profil, dans la contrainte et dans la fonction', () => {
    expect([LONGUEUR_DES_COMPTES_MIN, LONGUEUR_DES_COMPTES_MAX]).toEqual([6, 12])
    expect(texte).toContain(`check (longueur_des_comptes between ${LONGUEUR_DES_COMPTES_MIN} and ${LONGUEUR_DES_COMPTES_MAX})`)
    expect(corpsDe('enregistrer_reglages_d_export'))
      .toContain(`v_nombre < ${LONGUEUR_DES_COMPTES_MIN} or v_nombre > ${LONGUEUR_DES_COMPTES_MAX}`)
  })

  it('les colonnes que l’écran lit sont celles de la table, dans leur ordre', () => {
    const corps = /create\s+table\s+public\.reglages_d_export\s*\(([\s\S]*?)\n\);/i.exec(texte)![1]
    const colonnes = [...corps.matchAll(/^ {2}([a-z_]+) (?:uuid|text|integer|timestamptz)\b/gm)].map((m) => m[1])
    expect(COLONNES_DES_REGLAGES_D_EXPORT.split(', ')).toEqual(colonnes)
  })

  it('les réglages de l’essai et du bloc RX ont la forme que le module envoie', () => {
    const complets = JSON.parse(/complets jsonb := '([^']+)';/.exec(essai)![1])
    const duBloc = JSON.parse(/reglages jsonb := '([^']+)';/.exec(rls.slice(rls.indexOf('do $rx$')))![1])
    const attendu = reglagesPourLaBase(saisieDe({
      longueurDesComptes: '8', formeDesTiers: 'sans_auxiliaires', journaux: { AC: 'HA', VE: 'VT', BQ: 'CA1', OD: 'OD', AN: 'AN' },
    }))
    expect(complets).toEqual(attendu)
    expect(duBloc).toEqual(attendu)
  })
})

describe('le retour', () => {
  it('exige les trois corps de la migration, à l’empreinte, et retire la table et ses trois fonctions', () => {
    for (const nom of ['enregistrer_reglages_d_export', 'garder_reglages_d_export', 'logiciels_d_export']) {
      const empreinte = createHash('md5').update(corpsDe(nom)).digest('hex')
      expect(retour, nom).toMatch(new RegExp(`'public\\.${nom}\\([^)]*\\)'\\)\\)\\s+is distinct from '${empreinte}'`))
    }
    expect(retour).toMatch(/drop\s+function\s+public\.enregistrer_reglages_d_export\(uuid,\s*text,\s*jsonb,\s*integer\);/i)
    expect(retour).toMatch(/drop\s+table\s+public\.reglages_d_export;/i)
    expect(retour).toMatch(/drop\s+function\s+public\.garder_reglages_d_export\(\);/i)
    expect(retour).toMatch(/drop\s+function\s+public\.logiciels_d_export\(\);/i)
    expect(retour).toContain('if exists (select 1 from public.reglages_d_export) then')
  })
})

describe('la saisie', () => {
  it('sans ligne gardée, tout est à saisir : ni huit chiffres, ni nos codes de journaux, ni une forme des tiers', () => {
    expect(saisieDesReglagesGardes(null)).toEqual({ longueurDesComptes: '', formeDesTiers: null, journaux: { AC: '', VE: '', BQ: '', OD: '', AN: '' } })
  })

  it('préremplie des réglages gardés, un réglage nul restant à saisir', () => {
    expect(saisieDesReglagesGardes(gardes({ longueur_des_comptes: null }))).toEqual({
      longueurDesComptes: '', formeDesTiers: 'sans_auxiliaires', journaux: { AC: 'HA', VE: 'VT', BQ: 'CA1', OD: 'OD', AN: '' },
    })
    expect(saisieDesReglagesGardes(gardes()).longueurDesComptes).toBe('8')
  })

  it('la longueur tapée : vide à saisir, un entier, ou illisible', () => {
    expect(longueurDeLaSaisie('')).toBeNull()
    expect(longueurDeLaSaisie('  ')).toBeNull()
    expect(longueurDeLaSaisie(' 8 ')).toBe(8)
    for (const t of ['8.5', '8,5', 'huit', '-8', '1e1', '0x8']) expect(longueurDeLaSaisie(t), t).toBeNaN()
  })

  it('le code tapé : rogné de ses blancs de bout, vide à saisir', () => {
    expect(codeDeLaSaisie('  CA1 ')).toBe('CA1')
    expect(codeDeLaSaisie('   ')).toBeNull()
  })

  it('ce qui part vers la base : chaque réglage, nul s’il est à saisir, les cinq journaux toujours nommés', () => {
    expect(reglagesPourLaBase(saisieDe({ longueurDesComptes: '10', journaux: { ...SAISIE_A_SAISIR.journaux, BQ: ' BNP ' } }))).toEqual({
      longueur_des_comptes: 10, forme_des_tiers: null, journaux: { AC: null, VE: null, BQ: 'BNP', OD: null, AN: null },
    })
  })
})

describe('le refus de l’enregistrement, dit avant le clic sous les mots de la base', () => {
  it('une longueur hors de 6 à 12, ou illisible', () => {
    for (const t of ['5', '13', 'huit', '8.5']) expect(refusDeLEnregistrement(saisieDe({ longueurDesComptes: t })), t).toBe(REFUS_DE_LA_BASE.longueur)
    for (const t of ['', '6', '12']) expect(refusDeLEnregistrement(saisieDe({ longueurDesComptes: t })), t).toBeNull()
  })

  it('un code de journal hors de 1 à 20 lettres ou chiffres ; vide, il reste à saisir', () => {
    for (const c of ['B Q', 'BQé', 'BQ-1', 'A'.repeat(21), 'Ｂ']) {
      expect(refusDeLEnregistrement(saisieDe({ journaux: { ...SAISIE_A_SAISIR.journaux, OD: c } })), c).toBe(REFUS_DE_LA_BASE.code)
    }
    for (const c of ['', 'A'.repeat(20), 'od9']) expect(refusDeLEnregistrement(saisieDe({ journaux: { ...SAISIE_A_SAISIR.journaux, OD: c } })), c).toBeNull()
  })

  it('l’ordre de la base : la longueur avant les codes', () => {
    expect(refusDeLEnregistrement(saisieDe({ longueurDesComptes: '99', journaux: { ...SAISIE_A_SAISIR.journaux, BQ: 'B Q' } })))
      .toBe(REFUS_DE_LA_BASE.longueur)
  })

  it('la forme du code est celle de la base, caractère par caractère : les lettres et les chiffres de l’ASCII seuls', () => {
    expect(CODE_DU_JOURNAL_DU_LOGICIEL.test('Zz09')).toBe(true)
    for (const c of ['É', 'ß', 'ı', '١', 'Ⅳ', '_', ' ']) expect(CODE_DU_JOURNAL_DU_LOGICIEL.test(c), c).toBe(false)
  })
})

describe('les réglages gardés, relus', () => {
  it('rien à enregistrer quand la saisie dit ce que la base garde, aux blancs de bout près ; sans ligne, une saisie vide', () => {
    expect(memesReglages(saisieDesReglagesGardes(gardes()), gardes())).toBe(true)
    expect(memesReglages(saisieDe({ ...saisieDesReglagesGardes(gardes()), journaux: { AC: 'HA ', VE: 'VT', BQ: 'CA1', OD: 'OD', AN: '' } }), gardes())).toBe(true)
    expect(memesReglages(saisieDe({ ...saisieDesReglagesGardes(gardes()), longueurDesComptes: '9' }), gardes())).toBe(false)
    expect(memesReglages(saisieDe({ ...saisieDesReglagesGardes(gardes()), formeDesTiers: 'nos_auxiliaires' }), gardes())).toBe(false)
    expect(memesReglages(SAISIE_A_SAISIR, null)).toBe(true)
    expect(memesReglages(saisieDe({ longueurDesComptes: '8' }), null)).toBe(false)
  })

  it('la phrase de « rien à enregistrer » ne dit « ceux que le dossier garde » que d’un dossier qui garde une ligne (EXPQ4E-Q1)', () => {
    expect(phraseDeRienAEnregistrer(null)).toBe('Rien n’est saisi : rien à enregistrer.')
    expect(phraseDeRienAEnregistrer(gardes())).toBe('Ces réglages sont ceux que le dossier garde : rien à enregistrer.')
  })

  it('une ligne d’une forme que la base ne donne pas est illisible, jamais corrigée', () => {
    expect(reglagesLisibles(gardes())).toBe(true)
    expect(reglagesLisibles(gardes({ longueur_des_comptes: null, forme_des_tiers: null, journal_ac: null }))).toBe(true)
    for (const o of [{ longueur_des_comptes: 13 }, { longueur_des_comptes: 7.5 }, { forme_des_tiers: 'racines' as never },
      { journal_bq: 'B Q' }, { journal_an: '' }, { version: 0 }]) {
      expect(reglagesLisibles(gardes(o)), JSON.stringify(o)).toBe(false)
    }
  })

  it('ce que l’écran dit de la lecture', () => {
    expect(phraseDesReglagesGardes({ dossierId: 'd1', logiciel: 'acd', etat: 'lus', gardes: null })).toMatch(/^Aucun réglage n’est gardé pour ce dossier : chacun est à saisir/)
    expect(phraseDesReglagesGardes({ dossierId: 'd1', logiciel: 'acd', etat: 'lus', gardes: gardes() })).toMatch(/\(version 3\) sont préremplis/)
    expect(phraseDesReglagesGardes({ dossierId: 'd1', logiciel: 'acd', etat: 'illisibles', motif: 'lecture incomplète' }))
      .toMatch(/n’ont pas pu être lus \(lecture incomplète\) : rien n’est prérempli et rien ne s’enregistre/)
    expect(phraseDeLEnregistrement(4)).toBe('Réglages enregistrés pour ce dossier (version 4).')
  })
})

describe('le profil de l’export, ou ce qui reste à saisir', () => {
  const ENTETE = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
    'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'].join('\t')
  const ligne = (journal: string, num: string, compte: string, aux: string, auxLib: string, debit: string, credit: string) =>
    [journal, 'Libellé', num, '20260105', compte, 'Compte', aux, auxLib, 'REL-1', '20260105', 'Relevé', debit, credit, '', '', '20260105', '', ''].join('\t')
  const FEC = [ENTETE,
    ligne('VE', 'VE00001', '411000', 'CDUPONT', 'Dupont SA', '100,00', '0,00'),
    ligne('VE', 'VE00001', '706000', '', '', '0,00', '100,00'),
    ligne('BQ', 'BQ00001', '512000', '', '', '100,00', '0,00'),
    ligne('BQ', 'BQ00001', '411000', 'CDUPONT', 'Dupont SA', '0,00', '100,00'),
  ].join('\r\n')
  const choix = { quatreChamps: 'nos_valeurs' as const, sansANouveaux: false }

  it('rien de dit : la longueur, la forme des tiers et chaque journal du fichier sont à saisir — aucun défaut', () => {
    expect(profilDeLaSaisie(SAISIE_A_SAISIR, ['AN', 'VE', 'BQ'], choix)).toEqual({ ok: false, aSaisir: [
      'La longueur des comptes dans le logiciel : à saisir.',
      'La forme des comptes de tiers : à saisir.',
      'Le code du journal AN (À-nouveaux) dans le logiciel : à saisir.',
      'Le code du journal VE (Ventes) dans le logiciel : à saisir.',
      'Le code du journal BQ (Banque) dans le logiciel : à saisir.',
    ] })
  })

  it('un journal que le fichier porte et que la saisie ne dit pas ne garde jamais notre code', () => {
    const r = profilDeLaSaisie(saisieDe({ longueurDesComptes: '8', formeDesTiers: 'nos_auxiliaires', journaux: { ...SAISIE_A_SAISIR.journaux, VE: 'VT' } }),
      ['VE', 'BQ'], choix)
    expect(r).toEqual({ ok: false, aSaisir: ['Le code du journal BQ (Banque) dans le logiciel : à saisir.'] })
  })

  it('sans les à-nouveaux, leur journal n’est pas demandé ; un journal inconnu du fichier se dit', () => {
    const complete = saisieDe({ longueurDesComptes: '8', formeDesTiers: 'nos_auxiliaires', journaux: { ...SAISIE_A_SAISIR.journaux, BQ: 'CA1' } })
    expect(profilDeLaSaisie(complete, ['AN', 'BQ'], { ...choix, sansANouveaux: true }).ok).toBe(true)
    expect(profilDeLaSaisie(complete, ['AN', 'BQ'], choix).ok).toBe(false)
    expect(profilDeLaSaisie(complete, ['BQ', 'XX'], choix)).toEqual({ ok: false, aSaisir: ['Le journal « XX » du fichier n’est pas un journal que les réglages connaissent : rien ne part.'] })
  })

  it('tout dit : le profil, que la mise en forme applique — les codes du cabinet, la longueur, la forme des tiers', () => {
    const r = profilDeLaSaisie(saisieDe({
      longueurDesComptes: '8', formeDesTiers: 'sans_auxiliaires', journaux: { AC: '', VE: 'VT', BQ: ' CA1 ', OD: '', AN: '' },
    }), ['VE', 'BQ'], choix)
    expect(r).toEqual({ ok: true, reglages: { longueurDesComptes: 8, journaux: { VE: 'VT', BQ: 'CA1' }, quatreChamps: 'nos_valeurs', sansANouveaux: false, formeDesTiers: 'sans_auxiliaires' } })
    if (!r.ok) throw new Error('refusé')
    const m = mettreEnFormePourAcd(FEC, r.reglages)
    if (!m.ok) throw new Error(m.refus.join(' '))
    const lignes = m.texte.replace(/\r\n$/, '').split('\r\n').slice(1).map((l) => l.split('\t'))
    expect(lignes.map((l) => [l[0], l[4], l[6], l[7]])).toEqual([
      ['VT', '41100000', '', ''], ['VT', '70600000', '', ''], ['CA1', '51200000', '', ''], ['CA1', '41100000', '', ''],
    ])
  })

  it('une longueur dite mais fausse passe telle quelle : la mise en forme la refuse sous ses mots', () => {
    const r = profilDeLaSaisie(saisieDe({ longueurDesComptes: '13', formeDesTiers: 'nos_auxiliaires', journaux: { ...SAISIE_A_SAISIR.journaux, VE: 'VT', BQ: 'CA1' } }),
      ['VE', 'BQ'], choix)
    if (!r.ok) throw new Error(r.aSaisir.join(' '))
    const m = mettreEnFormePourAcd(FEC, r.reglages)
    expect(m.ok).toBe(false)
    if (!m.ok) expect(m.refus[0]).toMatch(/de 6 à 12/)
  })
})

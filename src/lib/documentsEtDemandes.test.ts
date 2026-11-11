import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CE_QU_ATTEND_UNE_DEMANDE, DOCUMENTS_ET_DEMANDES_PREVUS, etatDUneDemande, MOTIFS_DE_CLOTURE, NATURES_DES_DOCUMENTS, REFUS,
  refusDeLaCloture, refusDeLaDemande, refusDeLaPublication, refusDeLaReponse, TABLES_DES_DOCUMENTS_ET_DEMANDES,
} from './documentsEtDemandes'
import { CASES_SANS_EFFET, casesSansEffetSelon, ceQueDitLaCaseDocuments } from './droitsAcces'
import { ACHATS_DU_CLIENT_PREVUS } from './achatsClient'

// LES DOCUMENTS ET LES DEMANDES DU CABINET (ligne 51.5, étape B2) : le module redit la migration PRÉPARÉE
// `documents_et_demandes` — chaque refus à la lettre et dans son ordre, chaque liste fermée — et son essai la rejoue.

const PREPAREES = new URL('../../supabase/preparees/', import.meta.url).pathname
const SCHEMA = new URL('../../supabase/schema/', import.meta.url).pathname
const NOM = /^\d{14}_documents_et_demandes\.sql$/
const MIGRATION = readFileSync(PREPAREES + readdirSync(PREPAREES).find((n) => NOM.test(n))!, 'utf8')
const RETOUR = readFileSync(PREPAREES + 'retour/' + readdirSync(PREPAREES + 'retour').find((n) => /^\d{14}_retour_documents_et_demandes\.sql$/.test(n))!, 'utf8')
const ESSAI = readFileSync(new URL('../../supabase/essais/documentsCabinet.sql', import.meta.url), 'utf8')
const ESSAI_SUPPRESSION = readFileSync(new URL('../../supabase/essais/documentsCabinetSuppression.sql', import.meta.url), 'utf8')

/** Le texte d'une fonction de la migration, de sa création à la fin de son corps. */
function corps(nom: string): string {
  const debut = MIGRATION.search(new RegExp(`create function public\\.${nom}\\(`, 'i'))
  if (debut < 0) throw new Error(`${nom} absente de la migration`)
  return MIGRATION.slice(debut, MIGRATION.indexOf('\n$$;', debut))
}

/** Les mots d'un refus tels que la base les lève : la chaîne SQL, ses apostrophes doublées. */
const enSql = (mots: string) => `'${mots.replace(/'/g, "''")}'`

/** Les messages qu'une fonction lève, dans l'ordre de son texte. */
function refusDe(nom: string): string[] {
  return [...corps(nom).matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
}

/** Les valeurs d'une contrainte `check (colonne in (…))` de la migration. */
function valeurs(contrainte: string): string[] {
  const m = new RegExp(`constraint ${contrainte}\\s+check \\(\\w+ in \\(([^)]*)\\)\\)`).exec(MIGRATION)
  if (!m) throw new Error(`contrainte ${contrainte} introuvable`)
  return m[1].split(',').map((v) => v.trim().replace(/^'|'$/g, ''))
}

describe('la migration, préparée et pas appliquée', () => {
  it('le drapeau est baissé : la migration est préparée, une seule fois, et l’export ne la porte pas', () => {
    expect(DOCUMENTS_ET_DEMANDES_PREVUS).toBe(false)
    expect(readdirSync(PREPAREES).filter((n) => NOM.test(n))).toHaveLength(1)
    expect(readdirSync(SCHEMA).filter((n) => NOM.test(n))).toHaveLength(0)
  })

  it('elle crée les cinq tables du module, et le retour les retire toutes', () => {
    const creees = [...MIGRATION.matchAll(/^create table public\.(\w+) \(/gim)].map((m) => m[1])
    expect(creees).toEqual([...TABLES_DES_DOCUMENTS_ET_DEMANDES])
    const retirees = [...RETOUR.matchAll(/^drop table public\.(\w+);/gim)].map((m) => m[1]).sort()
    expect(retirees).toEqual([...TABLES_DES_DOCUMENTS_ET_DEMANDES].sort())
  })

  it('elle ne retire rien : aucun mot de retrait hors des clés, de la policy de suppression et des gardes', () => {
    const code = MIGRATION.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    expect(code).not.toMatch(/\b(drop|truncate)\b/i)
    const suppressions = [...code.matchAll(/\bdelete\b[^\n]*/gi)].map((m) => m[0].trim())
    for (const ligne of suppressions) {
      expect(ligne, ligne).toMatch(/^(delete\);|DELETE' then|delete on public\.\w+|delete to authenticated|delete cascade,?|delete set null,?)/i)
    }
    expect(code).not.toMatch(/\\u/)
    expect(MIGRATION).not.toContain('\r')
  })

  it('l’essai et l’essai de suppression attendent la migration, et la nomment', () => {
    expect(ESSAI).toContain("if to_regclass('public.documents_cabinet') is null then")
    expect(ESSAI).toContain('EN ATTENTE de la migration documents_et_demandes')
    expect(ESSAI_SUPPRESSION).toContain('ESSAI_HORS_REPLIQUE')
    expect(ESSAI).not.toMatch(/\bdelete\b/i)
  })
})

describe('les listes fermées sont celles de la base', () => {
  it('les natures d’un document', () => {
    expect(Object.keys(NATURES_DES_DOCUMENTS).sort()).toEqual(valeurs('documents_cabinet_nature').sort())
    expect(corps('publier_document_du_cabinet')).toContain(
      `p_nature not in (${valeurs('documents_cabinet_nature').map((v) => `'${v}'`).join(', ')})`)
  })

  it('ce qu’une demande attend', () => {
    expect(Object.keys(CE_QU_ATTEND_UNE_DEMANDE).sort()).toEqual(valeurs('demandes_cabinet_attendu').sort())
  })

  it('les motifs de clôture : une liste fermée, aucun texte libre (B2-Q1)', () => {
    expect(Object.keys(MOTIFS_DE_CLOTURE).sort()).toEqual(valeurs('demandes_cabinet_motif').sort())
    expect(MIGRATION).toMatch(/motif_de_cloture text\n\s+constraint demandes_cabinet_motif check/)
  })
})

describe('les refus, à la lettre et dans l’ordre de chaque fonction', () => {
  it.each([
    ['publier_document_du_cabinet', [REFUS.accesAuDossier, REFUS.titre, REFUS.nature, REFUS.exercice, REFUS.nomDuFichier, REFUS.chemin,
      REFUS.dejaPublie, REFUS.fichierAbsent, REFUS.fichierInadmis]],
    ['retirer_document_du_cabinet', [REFUS.accesAuDocument, REFUS.dejaRetire]],
    ['marquer_document_lu', [REFUS.accesAuDocument]],
    ['ouvrir_demande', [REFUS.accesAuDossier, REFUS.objet, REFUS.detail, REFUS.attendu, REFUS.echeance]],
    ['clore_demande', [REFUS.accesALaDemande, REFUS.motif, REFUS.dejaClose]],
    ['relancer_demande', [REFUS.accesALaDemande, REFUS.closeSansRelance]],
    ['repondre_a_la_demande', [REFUS.accesALaDemande, REFUS.rienARepondre, REFUS.texteDeLaReponse, REFUS.pieceEtDocument,
      REFUS.closeSansReponse, REFUS.pasSonDepot]],
  ] as const)('%s', (nom, attendus) => {
    expect(refusDe(nom)).toEqual([...attendus])
  })

  it('chaque refus du module est dans la migration, et l’essai l’attend sous ses mots', () => {
    for (const mots of Object.values(REFUS)) {
      expect(MIGRATION, mots).toContain(enSql(mots))
      if (mots !== REFUS.chemin) expect(ESSAI, mots).toContain(enSql(mots))
    }
    expect(ESSAI).toContain(enSql(REFUS.chemin))
  })
})

describe('ce que l’écran redit avant le clic', () => {
  const juste = { titre: '2035 de 2025', nature: '2035', exercice: 2025, nomFichier: 'la 2035.pdf' }

  it('une publication : le premier refus de la base, dans son ordre', () => {
    expect(refusDeLaPublication(juste)).toBeNull()
    expect(refusDeLaPublication({ ...juste, titre: '   ', nature: 'bilan' })).toBe(REFUS.titre)
    expect(refusDeLaPublication({ ...juste, titre: 'x'.repeat(201) })).toBe(REFUS.titre)
    expect(refusDeLaPublication({ ...juste, titre: 'é'.repeat(200) })).toBeNull()
    expect(refusDeLaPublication({ ...juste, nature: 'bilan', exercice: 1999 })).toBe(REFUS.nature)
    expect(refusDeLaPublication({ ...juste, exercice: 1999 })).toBe(REFUS.exercice)
    expect(refusDeLaPublication({ ...juste, exercice: null })).toBeNull()
    expect(refusDeLaPublication({ ...juste, nomFichier: '' })).toBe(REFUS.nomDuFichier)
  })

  it('une demande : l’échéance d’aujourd’hui passe, celle d’hier non', () => {
    const demande = { objet: 'Le relevé', detail: null, echeance: '2026-11-11', attendu: 'fichier' }
    expect(refusDeLaDemande(demande, '2026-11-11')).toBeNull()
    expect(refusDeLaDemande({ ...demande, echeance: '2026-11-10' }, '2026-11-11')).toBe(REFUS.echeance)
    expect(refusDeLaDemande({ ...demande, objet: '', attendu: 'rien' }, '2026-11-11')).toBe(REFUS.objet)
    expect(refusDeLaDemande({ ...demande, detail: ' ' }, '2026-11-11')).toBe(REFUS.detail)
    expect(refusDeLaDemande({ ...demande, attendu: 'rien' }, '2026-11-11')).toBe(REFUS.attendu)
  })

  it('une réponse et une clôture', () => {
    expect(refusDeLaReponse({ texte: null, pieceId: null, documentId: null }, false)).toBe(REFUS.rienARepondre)
    expect(refusDeLaReponse({ texte: '  ', pieceId: 'p', documentId: null }, false)).toBe(REFUS.texteDeLaReponse)
    expect(refusDeLaReponse({ texte: null, pieceId: 'p', documentId: 'd' }, false)).toBe(REFUS.pieceEtDocument)
    expect(refusDeLaReponse({ texte: 'Voilà', pieceId: null, documentId: null }, true)).toBe(REFUS.closeSansReponse)
    expect(refusDeLaReponse({ texte: 'Voilà', pieceId: 'p', documentId: null }, false)).toBeNull()
    expect(refusDeLaCloture('parce que', true)).toBe(REFUS.motif)
    expect(refusDeLaCloture('satisfaite', true)).toBe(REFUS.dejaClose)
    expect(refusDeLaCloture('remplacee', false)).toBeNull()
  })
})

describe('l’état d’une demande se déduit', () => {
  const ouverte = { echeance: '2026-11-15', close_le: null }
  it.each([
    [ouverte, 0, '2026-11-11', 'ouverte'],
    [ouverte, 0, '2026-11-15', 'ouverte'],
    [ouverte, 0, '2026-11-16', 'en_retard'],
    [ouverte, 1, '2026-11-16', 'repondue'],
    [{ echeance: null, close_le: null }, 0, '2099-01-01', 'ouverte'],
    [{ ...ouverte, close_le: '2026-11-12T10:00:00+00:00' }, 0, '2026-11-20', 'close'],
    [{ ...ouverte, close_le: '2026-11-12T10:00:00+00:00' }, 3, '2026-11-11', 'close'],
  ] as const)('%j, %i réponse(s), le %s : %s', (demande, reponses, jour, etat) => {
    expect(etatDUneDemande(demande, reponses, jour)).toBe(etat)
  })
})

describe('le jour où le drapeau se lève', () => {
  // L'onglet Accès dit, sous la case « Documents », qu'elle ne change encore rien (B1) tant que la migration n'est pas en
  // base ; avec elle, ce qu'elle ouvre (étape B3a). Les deux états se jouent par la fonction ; la constante suit le drapeau.
  it('« Documents » ne se dit sans effet que tant que la migration n’est pas en base — sous les deux états', () => {
    for (const enBase of [false, true]) {
      expect(casesSansEffetSelon(enBase, false).includes('documents')).toBe(!enBase)
      expect(casesSansEffetSelon(enBase, false)).toEqual(expect.arrayContaining(['achats', 'frais']))
    }
    expect(CASES_SANS_EFFET).toEqual(casesSansEffetSelon(DOCUMENTS_ET_DEMANDES_PREVUS, ACHATS_DU_CLIENT_PREVUS))
    expect(ceQueDitLaCaseDocuments()).not.toContain('ne change encore rien')
  })
})

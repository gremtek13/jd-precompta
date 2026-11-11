import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { indemniteKilometriqueCentimes } from './baremeKilometrique'
import { racinesDuDirigeantNonAssocieSelon } from './dirigeantAu468'
import {
  centimesDesKilometres, depassementDeLaPremiereTranche, ETATS_DES_NOTES, MOYENS_DE_REMBOURSEMENT, NATURES_DE_FRAIS,
  NOTES_DE_FRAIS_PREVUES, REFUS_DES_NOTES, refusDeLaSaisie, ROLE_DU_PERSONNEL, type SaisieDeNote, TABLES_DES_NOTES_DE_FRAIS,
} from './notesDeFrais'
import { ROLES_COMPTABLES } from './planComptable'

// LES NOTES DE FRAIS (ligne 51.5, B7) : le module confronté au texte de la migration PRÉPARÉE, à son essai et à celui du plan
// comptable — les mots et l'ordre des refus, les listes fermées, le rôle du personnel et l'empreinte du catalogue qui le
// porte, le barème appelé en base et jamais recopié.

const RACINE = new URL('../../', import.meta.url)
const PREPAREES = new URL('supabase/preparees/', RACINE)
const NOM = readdirSync(PREPAREES).find((n) => /^\d{14}_notes_de_frais\.sql$/.test(n))!
const MIGRATION = readFileSync(new URL(NOM, PREPAREES), 'utf8')
const RETOUR = readFileSync(new URL('retour/20261111238100_retour_notes_de_frais.sql', PREPAREES), 'utf8')
const ESSAI = readFileSync(new URL('supabase/essais/notesDeFrais.sql', RACINE), 'utf8')
const ESSAI_DU_PLAN = readFileSync(new URL('supabase/essais/planComptable.sql', RACINE), 'utf8')

/** Le corps d'une fonction de la migration, de son `create function` à la fin de son corps. */
function corps(nom: string): string {
  const debut = new RegExp(`create function public\\.${nom}\\(`, 'i').exec(MIGRATION)?.index ?? -1
  expect(debut, nom).toBeGreaterThanOrEqual(0)
  return MIGRATION.slice(debut, MIGRATION.indexOf('\n$$;', debut))
}
/** Un message tel que la migration l'écrit : l'apostrophe doublée. */
const enSql = (m: string) => m.replace(/'/g, "''")
/** La liste d'une contrainte `… in ('a', 'b')` de la migration. */
function liste(contrainte: string): string[] {
  const m = new RegExp(`constraint ${contrainte} check \\(\\w+ in \\(([^)]*)\\)\\)`).exec(MIGRATION)
  expect(m, contrainte).not.toBeNull()
  return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
}

const SAISIE: SaisieDeNote = {
  dateDepense: '2026-11-02', nature: 'repas', motif: 'Déjeuner', montantTtc: 24.5, montantTva: 2.23, beneficiaireSalarie: null,
  pieceId: null, distanceKm: null, vehicule: null,
}
const KM: SaisieDeNote = {
  ...SAISIE, nature: 'kilometres', montantTtc: 23.81, montantTva: null, distanceKm: 45,
  vehicule: { type: 'voiture', puissanceFiscale: 3, electrique: false },
}
const CONTEXTE = { aujourdHui: '2026-11-11', achats: false, justificatif: null }

describe('le drapeau et la migration préparée', () => {
  it('le drapeau est baissé tant que la migration n’est pas dans l’export', () => {
    const exportee = readdirSync(new URL('supabase/schema/', RACINE)).some((n) => /^\d{14}_notes_de_frais\.sql$/.test(n))
    expect(NOTES_DE_FRAIS_PREVUES).toBe(exportee)
    expect(NOTES_DE_FRAIS_PREVUES).toBe(false)
  })

  it('la migration crée la table du module, ni drop ni truncate ni suppression de ligne, sans barre oblique inverse ni retour chariot', () => {
    for (const t of TABLES_DES_NOTES_DE_FRAIS) expect(MIGRATION).toContain(`create table public.${t} (`)
    const code = MIGRATION.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
    expect(code).not.toMatch(/\b(drop|truncate)\b/i)
    expect(code).not.toMatch(/delete\s+from/i)
    expect(MIGRATION).not.toMatch(/[\\\r]/)
    // Le retour, lui, retire la table et le rôle : destructif, à coller.
    expect(RETOUR).toMatch(/drop table public\.notes_de_frais;/i)
    expect(RETOUR).toMatch(/delete from public\.roles_comptables where role = 'personnel';/)
  })
})

describe('les listes fermées, celles des contraintes de la table', () => {
  it('les natures, les états, les moyens du remboursement', () => {
    expect(liste('notes_de_frais_nature')).toEqual([...NATURES_DE_FRAIS])
    expect(liste('notes_de_frais_etat_connu')).toEqual([...ETATS_DES_NOTES])
    expect(liste('notes_de_frais_moyen')).toEqual([...MOYENS_DE_REMBOURSEMENT])
  })
})

describe('les refus, sous les mots de la base et dans son ordre', () => {
  it('chaque mot du module est dans la migration, au caractère près', () => {
    for (const [cle, valeur] of Object.entries(REFUS_DES_NOTES)) {
      const texte = typeof valeur === 'function'
        ? valeur(2026).replace('2026', '%') : valeur
      expect(MIGRATION.includes(enSql(texte)), cle).toBe(true)
    }
  })

  it('enregistrer_note_de_frais refuse dans l’ordre que le module suit', () => {
    const R = REFUS_DES_NOTES
    const ordre = [R.accesDossier, R.accesNote, R.plusUnBrouillon, R.version, R.salarieSansAchats, R.nomDuSalarie, R.date, R.nature,
      R.motif, R.distance, R.vehicule, R.tvaDesKilometres, R.justificatifDesKilometres, R.baremeAbsent(0).replace('0', '%'),
      R.montantDesKilometres(0).replace('0', '%'), R.pasUnVehicule, R.ttc, R.tva, R.justificatifDeLAuteur, R.justificatifValide,
      R.justificatifCite]
    const texte = corps('enregistrer_note_de_frais')
    const rangs = ordre.map((m) => texte.indexOf(enSql(m)))
    for (const [i, r] of rangs.entries()) expect(r, ordre[i]).toBeGreaterThanOrEqual(0)
    expect([...rangs].sort((a, b) => a - b)).toEqual(rangs)
  })

  it('les décisions : l’accès, puis l’état, puis la version, puis la saisie', () => {
    const R = REFUS_DES_NOTES
    for (const [nom, etat, saisie] of [['approuver_note_de_frais', R.pasSoumise, null], ['refuser_note_de_frais', R.pasSoumise, R.motifDuRefus],
      ['rembourser_note_de_frais', R.pasApprouvee, R.dateDuRemboursement]] as const) {
      const texte = corps(nom)
      const rangs = [R.accesNote, etat, R.version, ...(saisie ? [saisie] : [])].map((m) => texte.indexOf(enSql(m)))
      for (const r of rangs) expect(r, nom).toBeGreaterThanOrEqual(0)
      expect([...rangs].sort((a, b) => a - b), nom).toEqual(rangs)
    }
  })

  it('la saisie juste passe ; chaque défaut rend son refus, le premier rencontré', () => {
    const R = REFUS_DES_NOTES
    expect(refusDeLaSaisie(SAISIE, CONTEXTE)).toBeNull()
    expect(refusDeLaSaisie(KM, CONTEXTE)).toBeNull()
    expect(refusDeLaSaisie({ ...SAISIE, beneficiaireSalarie: 'Salarié fictif A' }, CONTEXTE)).toBe(R.salarieSansAchats)
    expect(refusDeLaSaisie({ ...SAISIE, beneficiaireSalarie: ' Salarié fictif A' }, { ...CONTEXTE, achats: true })).toBe(R.nomDuSalarie)
    expect(refusDeLaSaisie({ ...SAISIE, beneficiaireSalarie: 'Salarié fictif A' }, { ...CONTEXTE, achats: true })).toBeNull()
    expect(refusDeLaSaisie({ ...SAISIE, dateDepense: '2026-11-12' }, CONTEXTE)).toBe(R.date)
    expect(refusDeLaSaisie({ ...SAISIE, nature: 'cadeau' }, CONTEXTE)).toBe(R.nature)
    expect(refusDeLaSaisie({ ...SAISIE, motif: '   ' }, CONTEXTE)).toBe(R.motif)
    expect(refusDeLaSaisie({ ...SAISIE, motif: ' ' }, CONTEXTE)).toBeNull()
    expect(refusDeLaSaisie({ ...SAISIE, montantTtc: 24.505 }, CONTEXTE)).toBe(R.ttc)
    expect(refusDeLaSaisie({ ...SAISIE, montantTva: 24.5 }, CONTEXTE)).toBe(R.tva)
    expect(refusDeLaSaisie({ ...SAISIE, distanceKm: 45 }, CONTEXTE)).toBe(R.pasUnVehicule)
    expect(refusDeLaSaisie({ ...KM, montantTtc: 23.8 }, CONTEXTE)).toBe(R.montantDesKilometres(2026))
    expect(refusDeLaSaisie({ ...KM, dateDepense: '2024-06-03' }, CONTEXTE)).toBe(R.baremeAbsent(2024))
    expect(refusDeLaSaisie({ ...KM, vehicule: { type: 'cyclomoteur', puissanceFiscale: 5, electrique: false } }, CONTEXTE)).toBe(R.baremeAbsent(2026))
    expect(refusDeLaSaisie({ ...KM, montantTva: 1 }, CONTEXTE)).toBe(R.tvaDesKilometres)
    expect(refusDeLaSaisie({ ...KM, pieceId: 'p' }, CONTEXTE)).toBe(R.justificatifDesKilometres)
    expect(refusDeLaSaisie({ ...KM, distanceKm: 0 }, CONTEXTE)).toBe(R.distance)
    expect(refusDeLaSaisie({ ...KM, vehicule: { type: 'camion', puissanceFiscale: 3, electrique: false } }, CONTEXTE)).toBe(R.vehicule)
    const piece = { ...SAISIE, pieceId: 'p' }
    expect(refusDeLaSaisie(piece, CONTEXTE)).toBe(R.justificatifDeLAuteur)
    const sien = { deposeParLAuteurDansCeDossier: true, aValider: true, citeParUneAutreNote: false }
    expect(refusDeLaSaisie(piece, { ...CONTEXTE, justificatif: sien })).toBeNull()
    expect(refusDeLaSaisie(piece, { ...CONTEXTE, justificatif: { ...sien, aValider: false } })).toBe(R.justificatifValide)
    expect(refusDeLaSaisie(piece, { ...CONTEXTE, justificatif: { ...sien, citeParUneAutreNote: true } })).toBe(R.justificatifCite)
  })
})

describe('les kilomètres : le barème que la base tient, appelé, jamais recopié', () => {
  it('la migration appelle indemnite_kilometrique_centimes à l’enregistrement et à la soumission, et ne porte aucun barème', () => {
    expect(corps('enregistrer_note_de_frais')).toContain('public.indemnite_kilometrique_centimes(v_annee, p_vehicule_type, p_puissance_fiscale, p_electrique, p_distance_km)')
    expect(corps('soumettre_note_de_frais')).toContain('public.indemnite_kilometrique_centimes(v_annee, v_note.vehicule_type')
    expect(MIGRATION).not.toMatch(/bareme_kilometrique\(\)|\b(529|606|636|665|697)\b/)
  })

  it('le montant du module est celui du barème de l’année, en entiers ; l’essai le confronte en base (45 km, 3 CV : 23,81 €)', () => {
    expect(centimesDesKilometres('2026-11-03', 45, { type: 'voiture', puissanceFiscale: 3, electrique: false }))
      .toBe(indemniteKilometriqueCentimes({ type: 'voiture', puissanceFiscale: 3, kmProfessionnel: 45, electrique: false }, 2026))
    expect(centimesDesKilometres('2026-11-03', 45, { type: 'voiture', puissanceFiscale: 3, electrique: false })).toBe(2381n)
    expect(ESSAI).toContain("'kilometres', 'Visite chez un client', 23.81, null, null, null, 45, 'voiture', 3, false")
    expect(ESSAI).toContain("'kilometres', 'Visite', 23.80, null, null, null, 45, 'voiture', 3, false")
    expect(centimesDesKilometres('2024-06-03', 45, { type: 'voiture', puissanceFiscale: 3, electrique: false })).toBeNull()
    expect(centimesDesKilometres('2026-11-03', 45, { type: 'cyclomoteur', puissanceFiscale: 5, electrique: false })).toBeNull()
  })

  it('le dépassement de la première tranche se dit, lu dans le barème de l’année (MEG2-Q8)', () => {
    expect(depassementDeLaPremiereTranche(2026, 'voiture', 5000)).toBe(false)
    expect(depassementDeLaPremiereTranche(2026, 'voiture', 5001)).toBe(true)
    expect(depassementDeLaPremiereTranche(2026, 'moto', 3001)).toBe(true)
    expect(depassementDeLaPremiereTranche(2026, 'cyclomoteur', 3000)).toBe(false)
    expect(depassementDeLaPremiereTranche(2024, 'voiture', 9000)).toBeNull()
  })
})

describe('le rôle du personnel au catalogue (MEG2-Q7, B7-Q4)', () => {
  it('est celui que la migration insère, colonne par colonne', () => {
    const m = /insert into public\.roles_comptables \(role, racines, compte_defaut, libelle_defaut, prefixe_auxiliaire_defaut, ordre\)\nvalues \('(\w+)', array\[([^\]]*)\], '(\d+)', '([^']*)', null, (\d+)\);/.exec(MIGRATION)
    expect(m).not.toBeNull()
    const [, role, racines, compte, libelle, ordre] = m!
    expect({ role, racines: [...racines.matchAll(/'(\d+)'/g)].map((x) => x[1]), compteDefaut: compte, libelleDefaut: libelle, prefixeAuxiliaireDefaut: null, ordre: Number(ordre) })
      .toEqual(ROLE_DU_PERSONNEL)
  })

  it('n’est pas dans le catalogue de l’application : aucune racine ni aucun rang d’un autre rôle', () => {
    expect(ROLES_COMPTABLES.map((r) => r.role)).not.toContain('personnel')
    expect(ROLES_COMPTABLES.map((r) => r.ordre)).not.toContain(ROLE_DU_PERSONNEL.ordre)
    for (const r of ROLES_COMPTABLES) {
      for (const a of r.racines) for (const b of ROLE_DU_PERSONNEL.racines) {
        expect(a.startsWith(b) || b.startsWith(a), `${r.role} ${a} / ${b}`).toBe(false)
      }
    }
  })

  it('l’empreinte du catalogue qui le porte est celle que planComptable.sql exige, avec et sans le 468', () => {
    const ligne = (r: { role: string; racines: readonly string[]; compteDefaut: string; libelleDefaut: string | null; prefixeAuxiliaireDefaut: string | null; ordre: number }, au468: boolean) =>
      [r.role, (r.role === 'autres_debiteurs_crediteurs' ? racinesDuDirigeantNonAssocieSelon(au468) : r.racines).join(','), r.compteDefaut,
        r.libelleDefaut ?? '', r.prefixeAuxiliaireDefaut ?? '', String(r.ordre)].join('|')
    for (const [au468, nom] of [[false, 'empreinte_catalogue_personnel'], [true, 'empreinte_catalogue_468_personnel']] as const) {
      const epinglee = new RegExp(`${nom} constant text := '([0-9a-f]{32})'`).exec(ESSAI_DU_PLAN)?.[1]
      const texte = [...ROLES_COMPTABLES, ROLE_DU_PERSONNEL].map((r) => ligne(r, au468)).join('\n')
      expect(createHash('md5').update(texte, 'utf8').digest('hex'), nom).toBe(epinglee)
    }
    expect(ESSAI_DU_PLAN).toContain("m.name = 'notes_de_frais'")
  })
})

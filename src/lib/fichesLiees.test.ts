import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contientSql, indiceSql } from '../test/schema'
import {
  FICHES_LIEES_PREVUES, REFUS_DE_LA_FICHE_LIEE, REFUS_LECTURE_HORS_DU_DOSSIER_DU_CABINET, choixDeFicheLiee, identiteDuDossier,
  motsDuRefusDeLaFicheLiee, refusDeLaFicheLiee, saisieDeLaFicheLiee, type EtatDeLaFicheLiee, type FicheLiee, type IdentiteLue,
} from './fichesLiees'

// La migration, son retour, son essai et le bloc de rls.sql : ce module les redit, ces tests les confrontent.
const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), 'utf8')
const MIGRATION = lire('supabase/preparees/20261111233000_fiche_liee_au_dossier_du_client.sql')
const RETOUR = lire('supabase/preparees/retour/20261111233100_retour_fiche_liee_au_dossier_du_client.sql')
const LM7 = lire('supabase/preparees/20261111190000_honoraires_factures.sql')
const ESSAI = lire('supabase/essais/fichesLieesAuxDossiers.sql')
const RLS = lire('supabase/essais/rls.sql')
// Un mot du module, tel que le texte SQL l'écrit : l'apostrophe doublée.
const enSql = (mots: string) => mots.replace(/’/g, "''")

const K = '1b300000-0000-4000-8000-0000000000a1'
const C = '1b300000-0000-4000-8000-0000000000c1'
const C2 = '1b300000-0000-4000-8000-0000000000c2'
const etat = (e: Partial<EtatDeLaFicheLiee> = {}): EtatDeLaFicheLiee => ({
  estDossierDuCabinet: true, dossierDuCabinetId: K, dossiersDuCabinet: [K, C, C2], fiches: [], ficheReecrite: null, ...e,
})
const fiche = (f: Partial<FicheLiee> = {}): FicheLiee => ({
  id: 'f1', dossier_client_id: C, adresse_electronique: '987654321', email: null, delai_paiement_jours: 30, observations: null,
  retire_le: null, efface_le: null, ...f,
})
const lue = (i: Partial<IdentiteLue> = {}): IdentiteLue => ({
  contact_id: 'f1', dossier_client_id: C, dossier_present: true, tiers_nom: 'CLIENT SARL', tiers_adresse: '1 rue A',
  tiers_siret: '98765432100017', tiers_siren: '987654321', type_client: 'assujetti', ...i,
})

describe('la fiche liée au dossier du client (LM3)', () => {
  it('le drapeau est baissé tant que la migration n’est pas en production', () => {
    expect(FICHES_LIEES_PREVUES).toBe(false)
  })

  it('chaque refus est celui de la migration, à son code, dans l’ordre du rang 4 bis', () => {
    const corps = MIGRATION.slice(indiceSql(MIGRATION, 'create or replace function public.enregistrer_contact'))
    let depuis = 0
    for (const r of REFUS_DE_LA_FICHE_LIEE.filter((x) => x.cle !== 'dejaLieeRetiree')) {
      const mots = r.cle === 'dejaLiee' ? 'Ce dossier a déjà sa fiche de facturation%.' : enSql(r.modele)
      const i = corps.indexOf(`'${mots}'`, depuis)
      expect(i, r.cle).toBeGreaterThan(depuis)
      expect(corps.slice(i, i + mots.length + 260)).toContain(`errcode = '${r.code}'`)
      depuis = i
    }
    expect(corps).toContain("case when v_autre.retire_le is not null then ' (retirée : la reprendre)' else '' end")
    expect(MIGRATION).toContain(`'${enSql(REFUS_LECTURE_HORS_DU_DOSSIER_DU_CABINET)}' using errcode = '22023'`)
  })

  it('la lecture compose l’identité comme facturer_honoraires (LM7), fragment par fragment', () => {
    const lecture = MIGRATION.slice(indiceSql(MIGRATION, 'create function public.identites_des_fiches_liees'))
    const deLm7 = (f: string) => f.replace(/v_dossier_client\./g, 'c.')
    expect(LM7).toContain("coalesce(nullif(btrim(v_dossier_client.denomination_imprimee), ''), v_dossier_client.nom)")
    expect(lecture).toContain(deLm7("coalesce(nullif(btrim(v_dossier_client.denomination_imprimee), ''), v_dossier_client.nom)"))
    expect(LM7).toContain("v_siret := case when v_dossier_client.siret ~ '^[0-9]{14}$' then v_dossier_client.siret end;")
    expect(lecture).toContain("case when c.siret ~ '^[0-9]{14}$' then c.siret end")
    expect(LM7).toContain("'type_client', case when v_siret is not null then 'assujetti' else 'non_assujetti' end")
    expect(lecture).toContain("when c.siret ~ '^[0-9]{14}$' then 'assujetti' else 'non_assujetti' end")
    expect(LM7).toContain("'tiers_siren', left(v_siret, 9)")
    expect(lecture).toContain("left(case when c.siret ~ '^[0-9]{14}$' then c.siret end, 9)")
    // Et la fonction d'écriture juge l'adresse électronique sur le même type et le même SIREN.
    expect(MIGRATION).toContain("v_siren := left(case when v_client.siret ~ '^[0-9]{14}$' then v_client.siret end, 9);")
    expect(MIGRATION).toContain("v_type := case when v_client.siret ~ '^[0-9]{14}$' then 'assujetti' else 'non_assujetti' end;")
  })

  it('l’identité du dossier : le nom imprimé sans ses espaces de bord, sinon le nom ; le SIRET de quatorze chiffres seul', () => {
    expect(identiteDuDossier({ nom: 'Dossier', denomination_imprimee: '  CLIENT SARL ', adresse: 'Rue', siret: '98765432100017' }))
      .toEqual({ tiersNom: 'CLIENT SARL', tiersAdresse: 'Rue', tiersSiret: '98765432100017', tiersSiren: '987654321', typeClient: 'assujetti' })
    expect(identiteDuDossier({ nom: 'Dossier', denomination_imprimee: '   ', adresse: null, siret: '9876543210001' }))
      .toEqual({ tiersNom: 'Dossier', tiersAdresse: null, tiersSiret: null, tiersSiren: null, typeClient: 'non_assujetti' })
    expect(identiteDuDossier({ nom: 'Dossier', denomination_imprimee: null, adresse: 'Rue', siret: null }).tiersNom).toBe('Dossier')
    // `btrim` sans second argument ne retire que l'espace : une tabulation reste, comme en base.
    expect(identiteDuDossier({ nom: 'D', denomination_imprimee: '\tX', adresse: null, siret: null }).tiersNom).toBe('\tX')
  })

  it('les refus avant le clic suivent l’ordre de la base', () => {
    expect(refusDeLaFicheLiee(etat(), 'pas un identifiant', false)).toBe('identifiant')
    expect(refusDeLaFicheLiee(etat({ estDossierDuCabinet: false }), C, false)).toBe('horsDuDossierDuCabinet')
    expect(refusDeLaFicheLiee(etat({ estDossierDuCabinet: false }), null, true)).toBeNull()
    expect(refusDeLaFicheLiee(etat({ ficheReecrite: { id: 'f1', dossier_client_id: C } }), null, true)).toBe('lienFixe')
    expect(refusDeLaFicheLiee(etat({ ficheReecrite: { id: 'f1', dossier_client_id: C } }), C2, false)).toBe('lienFixe')
    expect(refusDeLaFicheLiee(etat({ ficheReecrite: { id: 'u', dossier_client_id: null } }), C, false)).toBe('lienFixe')
    expect(refusDeLaFicheLiee(etat(), K, false)).toBe('dossier')
    expect(refusDeLaFicheLiee(etat(), '1b300000-0000-4000-8000-0000000000ff', false)).toBe('dossier')
    expect(refusDeLaFicheLiee(etat({ fiches: [{ id: 'f9', dossier_client_id: C, retire_le: null }] }), C, false)).toBe('dejaLiee')
    expect(refusDeLaFicheLiee(etat({ fiches: [{ id: 'f9', dossier_client_id: C, retire_le: '2026-11-11T10:00:00Z' }] }), C, false))
      .toBe('dejaLieeRetiree')
    expect(refusDeLaFicheLiee(etat(), C, true)).toBe('identite')
    // La fiche réécrite ne se heurte pas à elle-même ; une majuscule dans l'identifiant ne trompe pas.
    expect(refusDeLaFicheLiee(etat({ fiches: [{ id: 'f1', dossier_client_id: C, retire_le: null }],
      ficheReecrite: { id: 'f1', dossier_client_id: C } }), C.toUpperCase(), false)).toBeNull()
    expect(motsDuRefusDeLaFicheLiee('dossier')).toBe('Le client est un dossier de ce cabinet, autre que le dossier du cabinet.')
  })

  it('le choix d’une fiche liée remplit la facture de l’identité LUE, jamais devinée', () => {
    const choix = choixDeFicheLiee(fiche(), [lue()], '2026-11-11')
    expect(choix).toEqual({
      etat: 'choisi',
      client: { tiersNom: 'CLIENT SARL', tiersAdresse: '1 rue A', tiersSiret: '98765432100017', typeClient: 'assujetti',
        siren: '987654321', adresseElectronique: '987654321', codeService: '' },
      echeance: { delai: 30, date: '2026-12-11' },
    })
    // Un non-assujetti n'a pas d'adresse de facturation électronique ; sans délai, pas d'échéance ; une date à moitié saisie.
    const sansSiret = choixDeFicheLiee(fiche({ delai_paiement_jours: null }), [lue({ tiers_siret: null, tiers_siren: null, type_client: 'non_assujetti' })], '2026-1')
    expect(sansSiret).toMatchObject({ etat: 'choisi', client: { adresseElectronique: '', siren: '', tiersSiret: '' }, echeance: null })
    expect(choixDeFicheLiee(fiche({ delai_paiement_jours: 10 }), [lue()], '2026-1')).toMatchObject({ echeance: { delai: 10, date: null } })
    expect(choixDeFicheLiee(fiche(), [lue({ dossier_present: false, tiers_nom: null, type_client: null })], '2026-11-11'))
      .toEqual({ etat: 'dossierParti' })
    expect(choixDeFicheLiee(fiche(), [], '2026-11-11')).toEqual({ etat: 'illisible' })
    expect(choixDeFicheLiee(fiche(), [lue({ dossier_client_id: C2 })], '2026-11-11')).toEqual({ etat: 'illisible' })
    expect(choixDeFicheLiee(fiche(), [lue({ tiers_nom: null })], '2026-11-11')).toEqual({ etat: 'illisible' })
  })

  it('la saisie qui part n’a aucune clé d’identité, ce que la base exige', () => {
    const s = saisieDeLaFicheLiee({ dossierClientId: C, adresseElectronique: ' 987 654 321 ', email: ' ', delai: '30', observations: '' })
    expect(s).toEqual({ dossier_client_id: C, adresse_electronique: '987654321', email: null, delai_paiement_jours: 30, observations: null })
    for (const cle of ['nom', 'adresse', 'type_client', 'siren', 'siret', 'code_service']) {
      expect(Object.keys(s)).not.toContain(cle)
      expect(MIGRATION).toContain(`'${cle}'`)
    }
    expect(saisieDeLaFicheLiee({ dossierClientId: C, adresseElectronique: '', email: 'a@b.fr', delai: 'x', observations: 'Note' }))
      .toMatchObject({ adresse_electronique: null, email: 'a@b.fr', delai_paiement_jours: null, observations: 'Note' })
  })

  it('la migration, son retour, son essai et rls.sql se tiennent', () => {
    // À coller : le `not null` du nom et deux contraintes remplacées ; rien d'autre ne se retire.
    expect(MIGRATION.match(/^alter table public\.contacts (alter column nom drop not null|drop constraint \w+);$/gmi)).toEqual([
      'alter table public.contacts alter column nom drop not null;',
      'alter table public.contacts drop constraint contacts_vivant_complet;',
      'alter table public.contacts drop constraint contacts_adresse_electronique_routee;',
    ])
    expect(MIGRATION).not.toMatch(/\b(delete|truncate)\b/i)
    // La garde de tête relit les deux corps de production que la migration remplace, et le retour les rend à l'octet.
    expect(MIGRATION).toContain("is distinct from '8a16d9e16ef17d368d3d3e4846abce5d'")
    expect(MIGRATION).toContain("is distinct from '6e67c4614cb715df285f739c3cf31a87'")
    const production = lire('supabase/schema/20261015070431_contacts.sql')
    for (const nom of ['enregistrer_contact', 'effacer_contact']) {
      const corps = production.match(new RegExp(`create function public\\.${nom}\\(.*?\\n\\$\\$;\\n`, 'si'))?.[0]
      expect(corps, nom).toBeDefined()
      expect(RETOUR).toContain((corps as string).replace('create function', 'create or replace function'))
    }
    expect(contientSql(RETOUR, 'alter table public.contacts alter column nom set not null;')).toBe(true)
    expect(contientSql(RETOUR, 'alter table public.contacts drop column dossier_client_id;')).toBe(true)
    expect(ESSAI).toContain('EN ATTENTE de la migration fiche_liee_au_dossier_du_client')
    expect(RLS).toContain('FL. la fiche liée au dossier du client : EN ATTENTE de la migration fiche_liee_au_dossier_du_client')
    for (const m of ['M-FL2', 'M-FL3', 'M-FL6']) expect(RLS).toContain(m)
  })
})

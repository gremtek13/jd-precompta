import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { definitionsSql } from '../test/schema'
import {
  DOSSIER_DU_CABINET_PREVU, REFUS_ACCES_CLIENT, REFUS_CHANGEMENT_DE_CABINET, REFUS_DE_LA_DESIGNATION, REFUS_SUPPRESSION, estLeDossierDuCabinet,
  motsDuRefus, refusDeLaDesignation, refusDeLaSuppression, valideAuNomDuClient, type EtatDeLaDesignation,
} from './dossierDuCabinet'

// LE DOSSIER DU CABINET (ligne 47, LM1) : le module redit les refus de la migration `dossier_du_cabinet` — préparée le
// 11/11/2026, dans l'export le jour de son application —, dans l'ordre de `designer_dossier_du_cabinet`, à leurs mots (les
// apostrophes typographiques du module rendues droites) et à leur code ; la migration ne change que deux lignes des deux
// fonctions qu'elle recopie, et son retour les rend ; l'essai attend les mêmes mots.

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

const MIGRATION = leFichier(/^\d{14}_dossier_du_cabinet\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
const RETOUR = leFichier(/^\d{14}_retour_dossier_du_cabinet\.sql$/, ['../../supabase/preparees/retour/'])
const ESSAI = readFileSync(new URL('../../supabase/essais/dossierDuCabinet.sql', import.meta.url), 'utf8')
const RLS = readFileSync(new URL('../../supabase/essais/rls.sql', import.meta.url), 'utf8')

const droit = (s: string) => s.replace(/’/g, "'")
/** Une fonction de la migration : sa dernière définition, capitales comprises (`definitionsSql`, src/test/schema.ts). */
function fonction(nom: string): string {
  const definitions = definitionsSql(nom, [{ chemin: 'dossier_du_cabinet', texte: MIGRATION }])
  expect(definitions, nom).not.toHaveLength(0)
  return definitions[definitions.length - 1].definition
}
/** Les refus d'un texte SQL, dans l'ordre : leurs mots (les apostrophes doublées rendues) et leur code. */
const refusSql = (sql: string) =>
  [...sql.matchAll(/raise exception '((?:[^']|'')*)'[\s\S]*?using errcode = '([0-9A-Z]{5})'/g)]
    .map((m) => ({ code: m[2], modele: m[1].replace(/''/g, "'") }))

const etat = (p: Partial<EtatDeLaDesignation>): EtatDeLaDesignation => ({
  estChefDuCabinet: true, cabinetId: 'cab', dossierActuel: null, actuelPorteUneFactureValidee: false,
  dossierVise: 'd', cabinetDuDossierVise: 'cab', visePorteUnAccesClient: false, visePorteUneFactureEnMandataire: false, ...p,
})

describe('le dossier du cabinet, confronté à sa migration', () => {
  it('designer_dossier_du_cabinet refuse dans l’ordre du module, à ses mots et à ses codes', () => {
    expect(refusSql(fonction('designer_dossier_du_cabinet')))
      .toEqual(REFUS_DE_LA_DESIGNATION.map((r) => ({ code: r.code, modele: droit(r.modele) })))
  })
  it('les deux gardes disent les mots du module, en 23514 ; la colonne se refuse en 42501', () => {
    expect(refusSql(fonction('garder_acces_au_dossier_du_cabinet'))).toEqual([{ code: '23514', modele: droit(REFUS_ACCES_CLIENT) }])
    expect(refusSql(fonction('garder_suppression_du_dossier_du_cabinet'))).toEqual([{ code: '23514', modele: droit(REFUS_SUPPRESSION) }])
    expect(refusSql(fonction('garder_cabinet_du_dossier_du_cabinet')))
      .toEqual([{ code: '23514', modele: droit(REFUS_CHANGEMENT_DE_CABINET) }])
    expect(refusSql(fonction('garder_dossier_du_cabinet'))).toEqual([
      { code: '42501', modele: 'Le dossier du cabinet se désigne par designer_dossier_du_cabinet seule.' },
    ])
  })
  it('la suppression laisse passer le super-administrateur, et la désignation suit la ligne', () => {
    expect(fonction('garder_suppression_du_dossier_du_cabinet')).toContain('and not public.is_super_admin() then')
    expect(MIGRATION).toContain('foreign key (dossier_du_cabinet) references public.dossiers (id) on delete set null;')
    expect(MIGRATION).toContain('add constraint cabinets_dossier_du_cabinet_key unique (dossier_du_cabinet);')
  })
  it('les deux fonctions recopiées ne changent que le prédicat du mandataire, et le retour les rend', () => {
    expect(MIGRATION.split("    if v_cabinet and not public.est_dossier_du_cabinet(p_dossier_id) then\n")).toHaveLength(2)
    expect(MIGRATION.split('  v_emetteur := case when public.admin_du_dossier(p_dossier_id) and not public.est_dossier_du_cabinet(p_dossier_id)\n'))
      .toHaveLength(2)
    expect(MIGRATION).not.toContain('    if v_cabinet then\n      select c.nom into v_mandataire')
    expect(RETOUR).toContain("    if v_cabinet then\n      select c.nom into v_mandataire from cabinets c where c.id = v_dossier.cabinet_id;")
    expect(RETOUR).toContain("  v_emetteur := case when public.admin_du_dossier(p_dossier_id) then 'mandataire' else 'client' end;")
    for (const empreinte of ['b32fc74f9e04a3787047fb5128aac5f3', 'f27f512229aed85c990a17e46171ecdf']) expect(MIGRATION).toContain(empreinte)
  })
  it('le retour retire tout ce que la migration pose', () => {
    for (const nom of ['est_dossier_du_cabinet(uuid)', 'garder_dossier_du_cabinet()', 'designer_dossier_du_cabinet(uuid, uuid)',
      'garder_acces_au_dossier_du_cabinet()', 'garder_suppression_du_dossier_du_cabinet()', 'garder_cabinet_du_dossier_du_cabinet()']) {
      expect(RETOUR).toContain(`drop function public.${nom};`)
    }
    for (const declencheur of ['dossiers_dossier_du_cabinet on public.dossiers', 'dossiers_cabinet_du_dossier_du_cabinet on public.dossiers', 'memberships_dossier_du_cabinet on public.memberships',
      'cabinets_dossier_du_cabinet on public.cabinets']) {
      expect(MIGRATION).toContain(`create trigger ${declencheur.split(' on ')[0]}`)
      expect(RETOUR).toContain(`drop trigger ${declencheur};`)
    }
    expect(RETOUR).toContain('alter table public.cabinets drop column dossier_du_cabinet;')
    expect(RETOUR).toContain('alter table public.cabinets drop constraint cabinets_dossier_du_cabinet_key;')
  })
  it('l’essai et le bloc DC de rls.sql attendent les mots du module', () => {
    for (const r of REFUS_DE_LA_DESIGNATION.filter((r) => r.cle !== 'cabinet')) expect(ESSAI).toContain(droit(r.modele).replace(/'/g, "''"))
    expect(ESSAI).toContain(droit(REFUS_ACCES_CLIENT).replace(/'/g, "''"))
    expect(ESSAI).toContain(droit(REFUS_SUPPRESSION).replace(/'/g, "''"))
    expect(ESSAI).toContain(REFUS_CHANGEMENT_DE_CABINET)
    expect(RLS).toContain('DC. le dossier du cabinet : EN ATTENTE de la migration dossier_du_cabinet')
  })
  it('le drapeau reste baissé tant que la migration n’est pas dans l’export', () => {
    const exportee = readdirSync(new URL('../../supabase/schema/', import.meta.url).pathname).some((n) => /^\d{14}_dossier_du_cabinet\.sql$/.test(n))
    expect(DOSSIER_DU_CABINET_PREVU).toBe(exportee)
  })
})

describe('les refus dits avant le clic', () => {
  it('dans l’ordre de la fonction', () => {
    expect(refusDeLaDesignation(etat({ estChefDuCabinet: false, cabinetDuDossierVise: 'autre' }))).toBe('acces')
    expect(refusDeLaDesignation(etat({ cabinetDuDossierVise: 'autre', visePorteUnAccesClient: true }))).toBe('horsDuCabinet')
    expect(refusDeLaDesignation(etat({ dossierActuel: 'a', actuelPorteUneFactureValidee: true, visePorteUnAccesClient: true }))).toBe('irreversible')
    expect(refusDeLaDesignation(etat({ visePorteUnAccesClient: true, visePorteUneFactureEnMandataire: true }))).toBe('accesClient')
    expect(refusDeLaDesignation(etat({ visePorteUneFactureEnMandataire: true }))).toBe('mandataire')
    expect(refusDeLaDesignation(etat({}))).toBeNull()
  })
  it('redésigner le dossier déjà désigné ne change rien, même irréversible', () => {
    expect(refusDeLaDesignation(etat({ dossierActuel: 'd', actuelPorteUneFactureValidee: true }))).toBeNull()
  })
  it('retirer la désignation : refusé après une facture validée, accepté avant', () => {
    expect(refusDeLaDesignation(etat({ dossierVise: null, cabinetDuDossierVise: null, dossierActuel: 'a', actuelPorteUneFactureValidee: true })))
      .toBe('irreversible')
    expect(refusDeLaDesignation(etat({ dossierVise: null, cabinetDuDossierVise: null, dossierActuel: 'a' }))).toBeNull()
  })
  it('les mots, le mandataire, la suppression', () => {
    expect(motsDuRefus('mandataire')).toBe(REFUS_DE_LA_DESIGNATION[5].modele)
    expect(estLeDossierDuCabinet('d', 'd')).toBe(true)
    expect(estLeDossierDuCabinet(null, 'd')).toBe(false)
    expect(estLeDossierDuCabinet(undefined, 'd')).toBe(false)
    expect(valideAuNomDuClient({ valideParLeCabinet: true, estLeDossierDuCabinet: false })).toBe(true)
    expect(valideAuNomDuClient({ valideParLeCabinet: true, estLeDossierDuCabinet: true })).toBe(false)
    expect(valideAuNomDuClient({ valideParLeCabinet: false, estLeDossierDuCabinet: false })).toBe(false)
    expect(refusDeLaSuppression({ estLeDossierDuCabinet: true, superAdministrateur: false })).toBe(REFUS_SUPPRESSION)
    expect(refusDeLaSuppression({ estLeDossierDuCabinet: true, superAdministrateur: true })).toBeNull()
    expect(refusDeLaSuppression({ estLeDossierDuCabinet: false, superAdministrateur: false })).toBeNull()
  })
})

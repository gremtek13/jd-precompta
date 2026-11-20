import { describe, expect, it } from 'vitest'
import type { BordereauLu } from './bordereauDeTeletransmission'
import { motsDuCabinet } from './espaceVentes'
import { factureDesBordereaux, type FactureDesBordereaux } from './factureAssuranceMaladie'
import { REFUS_DE_L_IMPORT_DU_FACTURE } from './importDuFactureAssuranceMaladie'
import {
  CONSIGNE_DU_FACTURE_AU_CABINET, PRESENTATION_DU_FACTURE_AU_CLIENT, REGIMES_OFFERTS, SANS_LA_CASE_BANQUE_DU_FACTURE,
  TAILLE_BORDEREAU_MAX, VIDE_DU_FACTURE_DIT, aideDuChoixDesRegimes, choixRetenus, cleDeLOrganisme,
  confirmationDeLImportDuFacture, confirmationDuRetraitDuFacture, fichierLuDit, fichiersDeLEnvoi, organismeDuFactureDit,
  organismesAChoisir, partsDeLImport, phraseApresLImportDuFacture, refusAvantLEnvoiDuFacture, refusDeLaTailleDuBordereau,
  refusDesFichiers, refusDuFactureDit, resumeDit, totauxDeLApercu, type FichierDeLEnvoi,
} from './factureAssuranceMaladieVue'
import type { FactureAssuranceMaladie, ImportFacturesAssuranceMaladie } from './types'

// LA VUE DE L'IMPORT DU FACTURÉ (BOR4), SUR DES BORDEREAUX FICTIFS : des numéros de lot faits de 9, des caisses « VILLE
// FICTIVE », des montants inventés. Aucun numéro de lot ne paraît dans ce que la vue dit ; le refus de la base se juge avant le
// clic sur l'envoi tel qu'il partira ; chaque phrase du client passe le garde des mots.

const AUJOURDHUI = '2026-11-20'
const lisible = (t: string) => t.replace(/[\u00a0\u202f]/g, ' ')

function bordereau(o: Partial<BordereauLu> = {}): BordereauLu {
  return {
    lot: 999999001, creeLe: '2026-10-05', securise: false, organisme: { code: '999', libelle: 'CPAM - VILLE FICTIVE' },
    nombreDeFactures: 3, totaux: { totalCentimes: 6540, caisseCentimes: 4580, mutuelleCentimes: 1960, assureCentimes: 0 },
    ...o,
  }
}
const lu = (cle: number, nom: string, ...bordereaux: BordereauLu[]): FichierDeLEnvoi => ({ cle, nom, lecture: { etat: 'lu', bordereaux } })
const refuse = (cle: number, nom: string, raison: string): FichierDeLEnvoi => ({ cle, nom, lecture: { etat: 'refuse', raison } })

function pret(r: FactureDesBordereaux) {
  if (r.etat !== 'pret') throw new Error(`attendu prêt, reçu ${r.etat}`)
  return r
}

describe('les fichiers de l’envoi', () => {
  it('les bordereaux mis bout à bout, chaque fichier sous le rang de ses bordereaux ; un refus garde sa raison', () => {
    const { dits, bordereaux } = fichiersDeLEnvoi([
      lu(0, 'a.pdf', bordereau(), bordereau({ lot: 999999002 })),
      refuse(1, 'b.pdf', 'le fichier ne s’ouvre pas comme un PDF'),
      lu(2, 'c.pdf', bordereau({ lot: 999999003 })),
    ])
    expect(bordereaux.map((b) => b.lot)).toEqual([999999001, 999999002, 999999003])
    expect(dits).toEqual([
      { cle: 0, nom: 'a.pdf', etat: 'lu', premier: 1, dernier: 2 },
      { cle: 1, nom: 'b.pdf', etat: 'refuse', raison: 'le fichier ne s’ouvre pas comme un PDF' },
      { cle: 2, nom: 'c.pdf', etat: 'lu', premier: 3, dernier: 3 },
    ])
    expect(fichierLuDit({ cle: 0, nom: 'a.pdf', etat: 'lu', premier: 1, dernier: 2 })).toBe('2 bordereaux (1 à 2 de l’envoi)')
    expect(fichierLuDit({ cle: 2, nom: 'c.pdf', etat: 'lu', premier: 3, dernier: 3 })).toBe('1 bordereau (le bordereau 3 de l’envoi)')
  })

  it('la taille : jusqu’à 20 Mo, rien ; au-delà, le refus, dans les deux espaces', () => {
    expect(refusDeLaTailleDuBordereau(TAILLE_BORDEREAU_MAX, 'client')).toBeNull()
    expect(refusDeLaTailleDuBordereau(TAILLE_BORDEREAU_MAX + 1, 'client')).toMatch(/Vérifie/)
    expect(refusDeLaTailleDuBordereau(TAILLE_BORDEREAU_MAX + 1, 'cabinet')).toMatch(/Vérifier/)
  })
})

describe('les régimes à choisir', () => {
  const msa = { code: '998', libelle: 'MSA - VILLE FICTIVE' }
  const cgss = { code: '997', libelle: 'CGSS - ILE FICTIVE' }
  const autre = { code: '996', libelle: 'CAISSE FICTIVE' }

  it('tous les organismes dont le libellé ne dit pas le régime, une fois chacun, triés ; un libellé reconnu n’y est pas', () => {
    const bordereaux = [bordereau({ organisme: cgss }), bordereau({ organisme: autre }), bordereau({ organisme: cgss }), bordereau({ organisme: msa })]
    expect(organismesAChoisir(bordereaux)).toEqual([autre, cgss])
  })

  it('les choix retenus : ceux d’un organisme encore dans l’envoi, d’un régime de la liste ; le reste tombe sans refuser l’envoi', () => {
    const choix = new Map([[cleDeLOrganisme(cgss), 1], [cleDeLOrganisme(autre), 55], ['000|PARTI', 2]])
    expect(choixRetenus([cgss, autre], choix)).toEqual([{ ...cgss, regime: 1 }])
    const bordereaux = [bordereau({ organisme: cgss }), bordereau({ lot: 999999002 })]
    const r = factureDesBordereaux(bordereaux, { aujourdHui: AUJOURDHUI, regimesChoisis: choixRetenus(organismesAChoisir(bordereaux), choix) })
    expect(r.etat).toBe('pret')
  })

  it('les régimes offerts : la liste fermée, sous son code sur deux chiffres', () => {
    expect(REGIMES_OFFERTS[0]).toEqual({ code: 1, libelle: '01 — CPAM' })
    expect(REGIMES_OFFERTS.map((r) => r.code)).toContain(99)
  })
})

describe('les agrégats et les totaux, dits', () => {
  it('l’aperçu prend la forme des totaux de la base ; l’organisme se dit par des codes', () => {
    const r = pret(factureDesBordereaux([bordereau()], { aujourdHui: AUJOURDHUI, regimesChoisis: [] }))
    const totaux = totauxDeLApercu(r.agregats)
    expect(totaux).toEqual([
      { date_creation_lot: '2026-10-05', part: 'obligatoire', regime: 1, caisse: 999, organisme_complementaire: null, montant_centimes: 4580, nombre_de_lots: 1, nombre_de_factures: 3 },
      { date_creation_lot: '2026-10-05', part: 'complementaire', regime: null, caisse: null, organisme_complementaire: null, montant_centimes: 1960, nombre_de_lots: 1, nombre_de_factures: 3 },
    ])
    expect(organismeDuFactureDit(totaux[0])).toBe('CPAM (régime 01), caisse 999')
    expect(organismeDuFactureDit({ ...totaux[0], caisse: 7 })).toBe('CPAM (régime 01), caisse 007')
    expect(organismeDuFactureDit(totaux[1])).toBe('organisme complémentaire non dit')
    expect(organismeDuFactureDit({ ...totaux[1], organisme_complementaire: 12345 })).toBe('organisme complémentaire 12345')
    expect(organismeDuFactureDit({ ...totaux[0], regime: 42 })).toBe('régime 42, caisse 999')
  })

  it('le résumé, une période ou un jour ; aucun numéro de lot dans ce que la vue dit', () => {
    const r = pret(factureDesBordereaux([bordereau(), bordereau({ lot: 999999002, creeLe: '2026-10-07' })], { aujourdHui: AUJOURDHUI, regimesChoisis: [] }))
    const resume = lisible(resumeDit(r.resume))
    expect(resume).toBe('2 lots créés du 05/10/2026 au 07/10/2026, environ 6 factures (un ordre de grandeur) : part obligatoire '
      + '91,60 €, part complémentaire 39,20 €, soit 130,80 € facturés à l’assurance maladie.')
    expect(lisible(resumeDit({ ...r.resume, nombreDeLots: 1, derniereDate: r.resume.premiereDate }))).toMatch(/^1 lot créé le 05\/10\/2026/)
    for (const espace of ['client', 'cabinet'] as const) {
      const dit = confirmationDeLImportDuFacture(r.resume, r.agregats.length, espace)
      expect(dit).not.toMatch(/99999900/)
      expect(lisible(dit)).toMatch(/^4 totaux du facturé partent en base — 2 lots créés du 05\/10\/2026/)
      expect(dit).toContain('aucun numéro n’est écrit en base')
    }
    expect(confirmationDeLImportDuFacture(r.resume, 1, 'cabinet')).toMatch(/^1 total du facturé part en base/)
  })

  it('le refus d’un envoi par BOR2 se dit tel quel, avec ce qu’il emporte', () => {
    expect(refusDuFactureDit('bordereaux 1 et 2 de l’envoi : le même lot deux fois', 'client'))
      .toBe('Bordereaux 1 et 2 de l’envoi : le même lot deux fois. Rien ne peut partir : un bordereau douteux ne se lit pas à moitié. Vérifie tes fichiers.')
  })
})

describe('le refus de la base, avant le clic, sur l’envoi tel qu’il partira', () => {
  it('un envoi conforme : rien ; un lot créé après le jour de Paris : le refus de la base', () => {
    const r = pret(factureDesBordereaux([bordereau()], { aujourdHui: AUJOURDHUI, regimesChoisis: [] }))
    expect(refusAvantLEnvoiDuFacture(r, AUJOURDHUI)).toBeNull()
    // Le jour de Paris a pu changer entre la lecture et le jugement : la base jugerait au sien.
    expect(refusAvantLEnvoiDuFacture(r, '2026-10-04')).toBe(REFUS_DE_L_IMPORT_DU_FACTURE.aVenir)
  })

  it('plus de 10 000 factures dans un lot : BOR2 l’admet, la base le refuse, et la vue le dit avant le clic', () => {
    const r = pret(factureDesBordereaux([bordereau({ nombreDeFactures: 10_001 })], { aujourdHui: AUJOURDHUI, regimesChoisis: [] }))
    expect(refusAvantLEnvoiDuFacture(r, AUJOURDHUI)).toBe(REFUS_DE_L_IMPORT_DU_FACTURE.lot)
  })
})

describe('un import en base, et son retrait', () => {
  const imp: ImportFacturesAssuranceMaladie = {
    id: 'i1', dossier_id: 'd1', premier_lot_le: '2026-10-05', dernier_lot_le: '2026-10-07', nombre_de_lots: 2,
    nombre_de_factures: 6, importe_par: 'u1', importe_le: '2026-11-20T09:00:00Z',
  }
  const total = (o: Partial<FactureAssuranceMaladie>): FactureAssuranceMaladie => ({
    id: 't', dossier_id: 'd1', import_id: 'i1', date_creation_lot: '2026-10-05', part: 'obligatoire', regime: 1, caisse: 999,
    organisme_complementaire: null, montant_centimes: 0, nombre_de_lots: 1, nombre_de_factures: 3, ...o,
  })
  const totaux = [
    total({ montant_centimes: 4580 }), total({ montant_centimes: 5000 }),
    total({ part: 'complementaire', regime: null, caisse: null, montant_centimes: 1960 }),
    total({ import_id: 'i2', montant_centimes: 99_99 }),
  ]

  it('les deux parts de l’import, de ses seuls totaux ; la confirmation nomme ce qui part', () => {
    expect(partsDeLImport('i1', totaux)).toEqual({ obligatoire: 9580, complementaire: 1960 })
    expect(lisible(confirmationDuRetraitDuFacture(imp, totaux, 'client'))).toBe('Retirer l’import des lots créés du 05/10/2026 au '
      + '07/10/2026 : 2 lots, environ 6 factures, 95,80 € de part obligatoire et 19,60 € de part complémentaire partent avec lui, '
      + 'et l’empreinte de ses lots aussi. Tu pourras importer de nouveau les mêmes bordereaux.')
    expect(confirmationDuRetraitDuFacture({ ...imp, dernier_lot_le: '2026-10-05' }, totaux, 'cabinet')).toMatch(/créés le 05\/10\/2026 .* pourront s’importer de nouveau\.$/)
  })
})

describe('les mots', () => {
  it('le client est tutoyé, sans un mot du cabinet', () => {
    const r = pret(factureDesBordereaux([bordereau()], { aujourdHui: AUJOURDHUI, regimesChoisis: [] }))
    const textes = [
      PRESENTATION_DU_FACTURE_AU_CLIENT, SANS_LA_CASE_BANQUE_DU_FACTURE, VIDE_DU_FACTURE_DIT.client, aideDuChoixDesRegimes('client'),
      refusDesFichiers('client'), phraseApresLImportDuFacture('client'), refusDuFactureDit('un doute', 'client'),
      confirmationDeLImportDuFacture(r.resume, 2, 'client'), refusDeLaTailleDuBordereau(TAILLE_BORDEREAU_MAX + 1, 'client') ?? '',
    ]
    for (const t of textes) expect(motsDuCabinet(t), t).toEqual([])
  })

  it('la consigne du cabinet : sur place ou de la main à la main, jamais par e-mail ; rien sur le support (BOR3RGPD-Q2 (B))', () => {
    expect(CONSIGNE_DU_FACTURE_AU_CABINET).toContain('sur place')
    expect(CONSIGNE_DU_FACTURE_AU_CABINET).toContain('de la main à la main')
    expect(CONSIGNE_DU_FACTURE_AU_CABINET).toContain('jamais par e-mail')
    for (const espace of ['client', 'cabinet'] as const) {
      expect(`${CONSIGNE_DU_FACTURE_AU_CABINET} ${phraseApresLImportDuFacture(espace)}`).not.toMatch(/supprim|effac|détrui|clé USB/i)
    }
  })
})

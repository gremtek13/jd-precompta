import { describe, expect, it } from 'vitest'
import { lireBordereauxDeTeletransmission, type BordereauLu, type PageDeTexte } from './bordereauDeTeletransmission'
import {
  estUneDateCivile,
  factureDesBordereaux,
  type AgregatDuFacture,
  type ChoixDuRegime,
  type FactureDesBordereaux,
  type ParametresDuFacture,
} from './factureAssuranceMaladie'
import { entierTire, tirage } from '../test/encaissementsBatterie'

// LE FACTURÉ À L'ASSURANCE MALADIE, SUR DES BORDEREAUX FICTIFS (conception 59, BOR2). Aucune valeur du bordereau réel montré
// par le cabinet : des numéros de lot faits de 9, des caisses « VILLE FICTIVE », des montants inventés.

const AUJOURDHUI = '2026-11-19'

function bordereau(o: Partial<BordereauLu> & { caisse?: number; mutuelle?: number; assure?: number } = {}): BordereauLu {
  const caisse = o.caisse ?? 45780
  const mutuelle = o.mutuelle ?? 19620
  const assure = o.assure ?? 0
  return {
    lot: o.lot ?? 999999001,
    creeLe: o.creeLe ?? '2026-10-05',
    securise: o.securise ?? false,
    organisme: o.organisme ?? { code: '999', libelle: 'CPAM - VILLE FICTIVE' },
    nombreDeFactures: o.nombreDeFactures ?? 3,
    totaux: o.totaux ?? { totalCentimes: caisse + mutuelle + assure, caisseCentimes: caisse, mutuelleCentimes: mutuelle, assureCentimes: assure },
  }
}

const parametres = (regimesChoisis: readonly ChoixDuRegime[] = []): ParametresDuFacture => ({ aujourdHui: AUJOURDHUI, regimesChoisis })

function pret(r: FactureDesBordereaux) {
  if (r.etat !== 'pret') throw new Error(`attendu prêt, reçu : ${JSON.stringify(r)}`)
  return r
}
function raison(r: FactureDesBordereaux): string {
  if (r.etat !== 'refuse') throw new Error(`attendu un refus, reçu : ${r.etat}`)
  return r.raison
}

describe('estUneDateCivile', () => {
  it('le calendrier, sans l’horloge', () => {
    expect(estUneDateCivile('2024-02-29')).toBe(true)
    expect(estUneDateCivile('2026-02-29')).toBe(false)
    expect(estUneDateCivile('2100-02-29')).toBe(false)
    expect(estUneDateCivile('2000-02-29')).toBe(true)
    expect(estUneDateCivile('2026-04-31')).toBe(false)
    expect(estUneDateCivile('2026-12-31')).toBe(true)
    expect(estUneDateCivile('2026-13-01')).toBe(false)
    expect(estUneDateCivile('1989-12-31')).toBe(false)
    expect(estUneDateCivile('05/10/2026')).toBe(false)
    expect(estUneDateCivile('2026-10-5')).toBe(false)
  })
})

describe('les agrégats du facturé', () => {
  it('un lot : la caisse en part obligatoire sous le régime 01 et le code imprimé, la mutuelle sous un organisme non dit ; « Assuré » oublié', () => {
    const r = pret(factureDesBordereaux([bordereau({ caisse: 8641, mutuelle: 2469, assure: 1235 })], parametres()))
    expect(r.agregats).toEqual<AgregatDuFacture[]>([
      { part: 'obligatoire', date: '2026-10-05', regime: 1, caisse: 999, montantCentimes: 8641, nombreDeLots: 1, nombreDeFactures: 3 },
      { part: 'complementaire', date: '2026-10-05', organismeComplementaire: 'non_dit', montantCentimes: 2469, nombreDeLots: 1, nombreDeFactures: 3 },
    ])
    expect(r.resume).toEqual({
      nombreDeLots: 1, nombreDeFactures: 3, premiereDate: '2026-10-05', derniereDate: '2026-10-05',
      obligatoireCentimes: 8641, complementaireCentimes: 2469, duCentimes: 11110,
    })
    expect(JSON.stringify(r)).not.toContain('1235')
  })

  it('deux lots d’un même jour et d’une même caisse se somment ; un autre jour, une autre caisse, un autre régime restent à part ; l’ordre est stable', () => {
    const r = pret(factureDesBordereaux([
      bordereau({ lot: 999999003, creeLe: '2026-10-06', caisse: 1000, mutuelle: 0, nombreDeFactures: 1 }),
      bordereau({ lot: 999999001, caisse: 100, mutuelle: 10, nombreDeFactures: 2 }),
      bordereau({ lot: 999999002, caisse: 200, mutuelle: 20, nombreDeFactures: 4 }),
      bordereau({ lot: 999999004, organisme: { code: '091', libelle: 'MSA - VILLE FICTIVE' }, caisse: 300, mutuelle: 0, nombreDeFactures: 1 }),
      bordereau({ lot: 999999005, organisme: { code: '998', libelle: 'CPAM - AUTRE VILLE FICTIVE' }, caisse: 400, mutuelle: 40, nombreDeFactures: 1 }),
    ], parametres()))
    expect(r.agregats).toEqual<AgregatDuFacture[]>([
      { part: 'obligatoire', date: '2026-10-05', regime: 1, caisse: 998, montantCentimes: 400, nombreDeLots: 1, nombreDeFactures: 1 },
      { part: 'obligatoire', date: '2026-10-05', regime: 1, caisse: 999, montantCentimes: 300, nombreDeLots: 2, nombreDeFactures: 6 },
      { part: 'obligatoire', date: '2026-10-05', regime: 2, caisse: 91, montantCentimes: 300, nombreDeLots: 1, nombreDeFactures: 1 },
      { part: 'complementaire', date: '2026-10-05', organismeComplementaire: 'non_dit', montantCentimes: 70, nombreDeLots: 3, nombreDeFactures: 7 },
      { part: 'obligatoire', date: '2026-10-06', regime: 1, caisse: 999, montantCentimes: 1000, nombreDeLots: 1, nombreDeFactures: 1 },
    ])
    expect(r.resume).toMatchObject({ nombreDeLots: 5, nombreDeFactures: 9, premiereDate: '2026-10-05', derniereDate: '2026-10-06', duCentimes: 2070 })
  })

  it('une part nulle ne fait pas d’agrégat ; une part négative (un avoir) se somme telle quelle', () => {
    const r = pret(factureDesBordereaux([
      bordereau({ lot: 999999001, caisse: 5000, mutuelle: 0 }),
      bordereau({ lot: 999999002, caisse: -1500, mutuelle: 0, nombreDeFactures: 1 }),
    ], parametres()))
    expect(r.agregats).toEqual<AgregatDuFacture[]>([
      { part: 'obligatoire', date: '2026-10-05', regime: 1, caisse: 999, montantCentimes: 3500, nombreDeLots: 2, nombreDeFactures: 4 },
    ])
  })

  it('l’identification des lots : rendue par la seule fonction, dans l’ordre de l’envoi, figée — la caisse et les factures avec (BOR3)', () => {
    const r = pret(factureDesBordereaux([bordereau({ lot: 999999007, creeLe: '2026-10-07', organisme: { code: '012', libelle: 'CPAM - VILLE FICTIVE' } }),
      bordereau({ lot: 999999001, nombreDeFactures: 5 })], parametres()))
    expect(r.identificationDesLots.nombre).toBe(2)
    const lots = r.identificationDesLots.pourLAppelDImport()
    expect(lots).toEqual([{ numero: 999999007, creeLe: '2026-10-07', caisse: 12, nombreDeFactures: 3 },
      { numero: 999999001, creeLe: '2026-10-05', caisse: 999, nombreDeFactures: 5 }])
    expect(Object.isFrozen(lots)).toBe(true)
    expect(Object.isFrozen(lots[0])).toBe(true)
    expect(JSON.stringify(r.identificationDesLots)).toBe('{"nombre":2}')
  })
})

describe('le régime : lu sur le libellé, sinon à choisir', () => {
  const cgss = { code: '997', libelle: 'CGSS - ILE FICTIVE' }

  it('un libellé qui ne dit pas le régime : les organismes à choisir, et le résumé, sans agrégat ni identification', () => {
    const r = factureDesBordereaux([bordereau({ lot: 999999001, organisme: cgss }), bordereau({ lot: 999999002 })], parametres())
    expect(r).toEqual({
      etat: 'regimes_a_choisir',
      organismes: [cgss],
      resume: expect.objectContaining({ nombreDeLots: 2 }) as unknown,
    })
    expect(JSON.stringify(r)).not.toContain('999999001')
  })

  it('le choix dans la liste fermée range l’organisme sous ce régime', () => {
    const r = pret(factureDesBordereaux([bordereau({ organisme: cgss, mutuelle: 0 })], parametres([{ ...cgss, regime: 1 }])))
    expect(r.agregats).toEqual([expect.objectContaining({ part: 'obligatoire', regime: 1, caisse: 997 })])
  })

  it('un choix hors de la liste, en double, pour un organisme reconnu ou absent se refuse', () => {
    const lots = [bordereau({ lot: 999999001, organisme: cgss }), bordereau({ lot: 999999002 })]
    expect(raison(factureDesBordereaux(lots, parametres([{ ...cgss, regime: 11 }])))).toBe('l’organisme 997 - CGSS - ILE FICTIVE : le régime choisi n’est pas dans la liste des régimes')
    expect(raison(factureDesBordereaux(lots, parametres([{ ...cgss, regime: 1 }, { ...cgss, regime: 2 }])))).toBe('l’organisme 997 - CGSS - ILE FICTIVE : deux choix de régime')
    expect(raison(factureDesBordereaux(lots, parametres([{ ...cgss, regime: 1 }, { code: '999', libelle: 'CPAM - VILLE FICTIVE', regime: 2 }]))))
      .toBe('l’organisme 999 - CPAM - VILLE FICTIVE : son libellé dit déjà son régime, aucun choix n’est attendu')
    expect(raison(factureDesBordereaux(lots, parametres([{ ...cgss, regime: 1 }, { code: '997', libelle: 'CGSS - AUTRE ILE', regime: 1 }]))))
      .toBe('l’organisme 997 - CGSS - AUTRE ILE : absent de l’envoi')
  })
})

describe('tout doute se refuse, aux mots dits avant le clic, sans numéro de lot', () => {
  const refuse = (bs: BordereauLu[], aujourdHui = AUJOURDHUI) => raison(factureDesBordereaux(bs, { aujourdHui, regimesChoisis: [] }))

  it('un envoi vide, un jour de référence impossible', () => {
    expect(refuse([])).toBe('aucun bordereau dans l’envoi')
    expect(refuse([bordereau()], '2026-11-31')).toBe('le jour de référence n’est pas une date possible')
  })

  it('un total qui ne se referme pas, un montant hors de ses bornes ou non entier', () => {
    const t = { totalCentimes: 1000, caisseCentimes: 600, mutuelleCentimes: 300, assureCentimes: 99 }
    expect(refuse([bordereau(), bordereau({ lot: 999999002, totaux: t })]))
      .toBe('bordereau 2 de l’envoi : le total du lot ne se referme pas (il n’est pas la somme de la caisse, de la mutuelle et de l’assuré)')
    expect(refuse([bordereau({ totaux: { ...t, assureCentimes: 100.5, totalCentimes: 1000.5 } })])).toBe('bordereau 1 de l’envoi : un total du lot n’est pas un montant lisible')
    expect(refuse([bordereau({ caisse: 1_000_000_001, mutuelle: 0 })])).toBe('bordereau 1 de l’envoi : un total du lot n’est pas un montant lisible')
  })

  it('le même lot deux fois dans l’envoi, sous la même date ou sous une autre', () => {
    expect(refuse([bordereau(), bordereau({ lot: 999999002 }), bordereau()])).toBe('bordereaux 1 et 3 de l’envoi : le même lot deux fois')
    expect(refuse([bordereau(), bordereau({ creeLe: '2026-10-09' })])).toBe('bordereaux 1 et 2 de l’envoi : le même lot deux fois')
  })

  it('une date impossible, ou après aujourd’hui ; le jour même passe', () => {
    expect(refuse([bordereau({ creeLe: '2026-02-30' })])).toBe('bordereau 1 de l’envoi : la date de création du lot n’est pas une date possible')
    expect(refuse([bordereau({ creeLe: '05/10/2026' })])).toBe('bordereau 1 de l’envoi : la date de création du lot n’est pas une date possible')
    expect(refuse([bordereau({ creeLe: '2026-11-20' })])).toBe('bordereau 1 de l’envoi : le lot serait créé après aujourd’hui')
    expect(factureDesBordereaux([bordereau({ creeLe: AUJOURDHUI })], parametres()).etat).toBe('pret')
  })

  it('un numéro de lot, un code de caisse, un nombre de factures sans leur forme', () => {
    expect(refuse([bordereau({ lot: 0 })])).toBe('bordereau 1 de l’envoi : le numéro du lot ne se lit pas')
    expect(refuse([bordereau({ lot: 1_000_000_000 })])).toBe('bordereau 1 de l’envoi : le numéro du lot ne se lit pas')
    expect(refuse([bordereau({ lot: 12.5 })])).toBe('bordereau 1 de l’envoi : le numéro du lot ne se lit pas')
    expect(refuse([bordereau({ organisme: { code: '99', libelle: 'CPAM - VILLE FICTIVE' } })])).toBe('bordereau 1 de l’envoi : le code de la caisse ne se lit pas (trois chiffres)')
    expect(refuse([bordereau({ nombreDeFactures: 0 })])).toBe('bordereau 1 de l’envoi : le nombre de factures du lot ne se lit pas')
  })

  it('un refus tranche avant le choix des régimes', () => {
    const r = factureDesBordereaux([bordereau({ organisme: { code: '997', libelle: 'CGSS - ILE FICTIVE' }, creeLe: '2027-01-01' })], parametres())
    expect(r.etat).toBe('refuse')
  })
})

// ── De bout en bout : le texte d'un bordereau, lu par BOR1, puis agrégé. ──

function euros(centimes: number): string {
  const entier = String(Math.floor(Math.abs(centimes) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${centimes < 0 ? '-' : ''}${entier},${String(Math.abs(centimes) % 100).padStart(2, '0')}`
}

/** Une page de bordereau fictif : des lignes aux noms et numéros manifestement faux. */
function pageFictive(lot: number, jour: string, organisme: string, lignes: [number, number, number][]): PageDeTexte {
  const tot = lignes.reduce((s, [c, m, a]) => [s[0] + c + m + a, s[1] + c, s[2] + m, s[3] + a], [0, 0, 0, 0])
  return {
    lignes: [
      'Bordereau de Teletransmission',
      'PRATICIEN FICTIF 99 9 99999/9',
      `Lot : ${lot} créé le ${jour}`,
      'LOT NON SECURISE',
      `Organisme assurance maladie destinataire : ${organisme}`,
      'Destinataire du réglement : MME CANARI DESTINATAIRE',
      'Facture Date prescription Numéro Assuré Nom Bénéficiaire Naissance Total Caisse Mutuelle Assuré',
      ...lignes.map(([c, m, a], i) => `90000000${i + 1} 01/10/2026 1999999999999 7${i} CANARI BENEFICIAIRE${i} 01/01/1950 ${[c + m + a, c, m, a].map(euros).join(' ')}`),
      `TOTAL: LOT de ${lignes.length} Factures ${tot.map(euros).join(' ')}`,
      '18/11/2026 1/1 Réalisé par Televitale',
    ],
  }
}

describe('de bout en bout : BOR1 puis BOR2', () => {
  it('deux fichiers d’un même envoi : agrégés ensemble, rien d’une ligne de facture ni du destinataire dans le résultat', () => {
    const premier = lireBordereauxDeTeletransmission([pageFictive(999999101, '05/10/2026', '999 - CPAM - VILLE FICTIVE', [[45780, 19620, 0], [394610, 0, 0]])])
    const second = lireBordereauxDeTeletransmission([pageFictive(999999102, '05/10/2026', '999 - CPAM - VILLE FICTIVE', [[8641, 2469, 1235]])])
    if (premier.etat !== 'lu' || second.etat !== 'lu') throw new Error('lecture refusée')
    const r = pret(factureDesBordereaux([...premier.bordereaux, ...second.bordereaux], parametres()))
    expect(r.agregats).toEqual<AgregatDuFacture[]>([
      { part: 'obligatoire', date: '2026-10-05', regime: 1, caisse: 999, montantCentimes: 45780 + 394610 + 8641, nombreDeLots: 2, nombreDeFactures: 3 },
      { part: 'complementaire', date: '2026-10-05', organismeComplementaire: 'non_dit', montantCentimes: 19620 + 2469, nombreDeLots: 2, nombreDeFactures: 3 },
    ])
    const texte = JSON.stringify(r)
    for (const interdit of ['CANARI', '999999101', '999999102', '1999999999999', '900000001', 'VILLE', 'CPAM', '01/10/2026', '1950']) {
      expect(texte).not.toContain(interdit)
    }
    expect(r.identificationDesLots.pourLAppelDImport().map((l) => l.numero)).toEqual([999999101, 999999102])
  })

  it('le même lot dans deux fichiers d’un même envoi se refuse', () => {
    const a = lireBordereauxDeTeletransmission([pageFictive(999999101, '05/10/2026', '999 - CPAM - VILLE FICTIVE', [[100, 0, 0]])])
    if (a.etat !== 'lu') throw new Error('lecture refusée')
    expect(raison(factureDesBordereaux([...a.bordereaux, ...a.bordereaux], parametres()))).toBe('bordereaux 1 et 2 de l’envoi : le même lot deux fois')
  })
})

// ── Le canari, sur une batterie tirée d'une graine. ──

describe('le canari : ni numéro de lot ni libellé dans ce qui se sérialise, et les sommes se referment', () => {
  it('cent envois tirés : agrégats, résumé et raisons sans numéro de lot ; caisse et mutuelle retrouvées au centime', () => {
    const t = tirage(20261119)
    const libelles = ['CPAM - VILLE FICTIVE', 'MSA - BOURG FICTIF', 'CPAM - CITE FICTIVE']
    for (let essai = 0; essai < 100; essai++) {
      const n = 1 + entierTire(t, 6)
      const bs: BordereauLu[] = []
      for (let i = 0; i < n; i++) {
        // Neuf chiffres : aucun montant tiré (au plus sept chiffres une fois sommé) ne peut les contenir.
        const lot = 900_000_000 + entierTire(t, 99_999_999)
        if (bs.some((b) => b.lot === lot)) continue
        const caisse = entierTire(t, 500_000) - (entierTire(t, 10) === 0 ? 250_000 : 0)
        const mutuelle = entierTire(t, 3) === 0 ? 0 : entierTire(t, 200_000)
        bs.push(bordereau({
          lot,
          creeLe: `2026-${String(1 + entierTire(t, 10)).padStart(2, '0')}-${String(1 + entierTire(t, 28)).padStart(2, '0')}`,
          organisme: { code: String(entierTire(t, 1000)).padStart(3, '0'), libelle: libelles[entierTire(t, libelles.length)] },
          nombreDeFactures: 1 + entierTire(t, 40),
          caisse,
          mutuelle,
          assure: entierTire(t, 5_000),
        }))
      }
      // Un envoi sur cinq porte un doute : un lot créé après aujourd'hui, ou un lot repris.
      const doute = entierTire(t, 5)
      if (doute === 0) bs.push(bordereau({ lot: bs[0].lot }))
      if (doute === 1) bs.push(bordereau({ lot: 999_999_998, creeLe: '2026-12-01' }))
      const r = factureDesBordereaux(bs, parametres())
      const texte = JSON.stringify(r)
      for (const b of bs) {
        expect(texte).not.toContain(String(b.lot))
        expect(texte).not.toContain(b.organisme.libelle)
        expect(texte).not.toContain('FICTI')
      }
      if (doute <= 1) {
        expect(r.etat).toBe('refuse')
        continue
      }
      const p = pret(r)
      const somme = (part: AgregatDuFacture['part']) => p.agregats.filter((a) => a.part === part).reduce((s, a) => s + a.montantCentimes, 0)
      expect(somme('obligatoire')).toBe(bs.reduce((s, b) => s + b.totaux.caisseCentimes, 0))
      expect(somme('complementaire')).toBe(bs.reduce((s, b) => s + b.totaux.mutuelleCentimes, 0))
      expect(p.resume.duCentimes).toBe(somme('obligatoire') + somme('complementaire'))
      expect(p.identificationDesLots.pourLAppelDImport()).toHaveLength(bs.length)
      for (const a of p.agregats) {
        expect(Object.keys(a).sort()).toEqual(a.part === 'obligatoire'
          ? ['caisse', 'date', 'montantCentimes', 'nombreDeFactures', 'nombreDeLots', 'part', 'regime']
          : ['date', 'montantCentimes', 'nombreDeFactures', 'nombreDeLots', 'organismeComplementaire', 'part'])
        // Les seules chaînes : la date, la part, « non_dit ».
        for (const [cle, valeur] of Object.entries(a)) {
          if (typeof valeur === 'string') expect(['date', 'part', 'organismeComplementaire']).toContain(cle)
        }
      }
    }
  })
})

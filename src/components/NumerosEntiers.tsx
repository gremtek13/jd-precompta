// LE NUMÉRO D'UNE ÉCRITURE LIBRE NE SE COUPE PAS À SON TRAIT D'UNION (EL6, vu au banc le 24/11/2026). « EL2026-0002 » offre une
// coupure au navigateur après le trait d'union : dans le détail du Bilan, sur téléphone, la marque se lisait « EL2026- / 0002 ».
// Le texte reste celui du module (lib/ecrituresLibresDuDetail.ts, lib/revisionPreuves.ts) : seul chaque numéro y est posé dans un
// `span` qui ne se coupe pas (`.numero-entier`), le reste du texte passant à la ligne comme avant.

const NUMERO = /EL\d{4}-\d{4}/g

/** Un texte dont chaque numéro d'écriture libre (« EL2026-0002 ») reste sur une seule ligne. */
export function NumerosEntiers({ texte }: { texte: string }) {
  const morceaux: (string | { numero: string })[] = []
  let depuis = 0
  for (const m of texte.matchAll(NUMERO)) {
    const debut = m.index ?? 0
    if (debut > depuis) morceaux.push(texte.slice(depuis, debut))
    morceaux.push({ numero: m[0] })
    depuis = debut + m[0].length
  }
  if (depuis < texte.length) morceaux.push(texte.slice(depuis))
  return (
    <>
      {morceaux.map((m, n) => (typeof m === 'string' ? m : <span key={n} className="numero-entier">{m.numero}</span>))}
    </>
  )
}

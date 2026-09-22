#!/usr/bin/env python3
"""Éprouve `supabase/schema/socle/tables_sans_migration.sql` contre la base vivante.

POURQUOI CE FICHIER EXISTE. `supabase/schema/` porte un export des migrations, et son contrôle de
dérive compare les FICHIERS aux MIGRATIONS par empreinte agrégée. Il était vert le 22/09/2026
(58 = 58) pendant que DOUZE des 41 tables n'avaient aucun `create table` nulle part : elles ont été
créées hors `apply_migration`. Le contrôle prouvait une chose plus faible que celle qu'on lui
prêtait, et ce qu'on lui prêtait était le plan de reprise.

`tables_sans_migration.sql` comble ce trou. Mais un fichier de reconstruction que rien ne confronte
à la base est exactement le plan de reprise qu'on CROIT avoir : il dérive au premier `alter table`,
et son silence est indiscernable d'un fichier juste.

COMMENT ÇA MARCHE. Le fichier n'est PAS écrit à la main : chaque instruction est le rendu exact du
catalogue. Ce harnais peut donc comparer AU CARACTÈRE PRÈS, sans normaliser quoi que ce soit — et ne
pas normaliser est ce qui le rend honnête, une comparaison indulgente finissant par tout accepter.

    1. jouer `supabase/essais/socle.sql` (outil MCP `execute_sql`), qui rend une empreinte
    2. python3 supabase/essais/socle.py            → rend l'empreinte du fichier
    3. les deux sont égales ⇒ le fichier décrit la base ; elles diffèrent ⇒ `--detail` des deux côtés

Cet environnement n'atteint pas la base depuis un shell : les deux moitiés sont donc séparées, comme
pour `allerretour.py`. Le coût est de deux commandes ; ce qu'on achète est une reconstruction dont on
sait qu'elle est encore vraie.
"""
import hashlib
import re
import sys
from pathlib import Path

FICHIER = Path(__file__).resolve().parents[1] / 'schema' / 'socle' / 'tables_sans_migration.sql'


def instructions(texte: str) -> list[str]:
    """Les instructions SQL du fichier, commentaires retirés.

    On ne coupe QUE les lignes entièrement en commentaire, jamais un `--` de fin de ligne : le SQL
    fautif serait de toute façon avant, et couper là risquerait d'avaler un littéral contenant `--`.
    C'est la règle déjà posée par `retraitsStockage.test.ts` pour le scanner de `.catch(() => {})`.
    """
    lignes = [l for l in texte.split('\n') if not l.lstrip().startswith('--')]
    brut = '\n'.join(lignes)
    return [s.strip() + ';' for s in re.split(r';\s*\n', brut) if s.strip()]


def empreinte(instrs: list[str]) -> str:
    # TRIÉES : le fichier range les tables par dépendance (il doit s'appliquer dans cet ordre), la
    # base les rend par nom. Comparer l'ordre ferait échouer le contrôle pour une raison qui n'a rien
    # à voir avec son objet — et un contrôle qui crie à tort cesse d'être cru.
    return hashlib.md5('\n'.join(sorted(instrs)).encode('utf-8')).hexdigest()


def main() -> int:
    instrs = instructions(FICHIER.read_text(encoding='utf-8'))
    if '--detail' in sys.argv:
        for s in sorted(instrs):
            print(hashlib.md5(s.encode('utf-8')).hexdigest(), s.split('\n')[0][:90])
        return 0
    print(f'{len(instrs)} instructions   empreinte {empreinte(instrs)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

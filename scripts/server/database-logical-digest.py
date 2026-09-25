#!/usr/bin/env python3
import base64
import hashlib
import json
import sqlite3
import sys
from pathlib import Path


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def normalize(value):
    if value is None:
        return ["null", None]
    if isinstance(value, bytes):
        return ["blob", base64.b64encode(value).decode("ascii")]
    return [type(value).__name__, value]


def main() -> int:
    if len(sys.argv) != 2:
        print(f"Usage: {Path(sys.argv[0]).name} PATH_TO_GATEWAY_DB", file=sys.stderr)
        return 2

    database_path = Path(sys.argv[1]).resolve()
    connection = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
    digest = hashlib.sha256()
    tables = [
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]

    for table in tables:
        columns = [
            row[1]
            for row in connection.execute(f"PRAGMA table_info({quote_identifier(table)})")
        ]
        order_by = ", ".join(quote_identifier(column) for column in columns)
        query = f"SELECT * FROM {quote_identifier(table)}"
        if order_by:
            query += f" ORDER BY {order_by}"
        digest.update(json.dumps(["table", table, columns], ensure_ascii=False).encode("utf-8"))
        for row in connection.execute(query):
            digest.update(
                json.dumps([normalize(value) for value in row], ensure_ascii=False).encode("utf-8")
            )

    connection.close()
    print(digest.hexdigest())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

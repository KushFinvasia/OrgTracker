"""Add nullable columns that the models gained after a database was created (there is no Alembic yet).

Nullable columns, and non-null columns with a simple scalar default, are added; anything else is logged for a manual migration. Safe to run at every startup.
"""

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.core.database import Base

log = logging.getLogger("orgtrack")


def add_missing_columns(engine: Engine) -> list[str]:
    insp = inspect(engine)
    added = []
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in have:
                    continue
                default = ""
                if not col.nullable:
                    arg = getattr(col.default, "arg", None)
                    if isinstance(arg, bool):
                        default = f" NOT NULL DEFAULT {'TRUE' if arg else 'FALSE'}"
                    elif isinstance(arg, (int, float)):
                        default = f" NOT NULL DEFAULT {arg}"
                    else:
                        log.error("Column %s.%s is missing, not nullable and has no simple default; migrate it manually.", table.name, col.name)
                        continue
                conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN {col.name} {col.type.compile(engine.dialect)}{default}'))
                added.append(f"{table.name}.{col.name}")
    return added

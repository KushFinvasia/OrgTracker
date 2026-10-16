"""Add nullable columns that the models gained after a database was created (there is no Alembic yet).

Only nullable columns are added; anything else is logged for a manual migration. Safe to run at every startup.
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
                if not col.nullable:
                    log.error("Column %s.%s is missing and not nullable; migrate it manually.", table.name, col.name)
                    continue
                conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN {col.name} {col.type.compile(engine.dialect)}'))
                added.append(f"{table.name}.{col.name}")
    return added

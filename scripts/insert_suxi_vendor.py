import sqlite3
from pathlib import Path

db = Path(__file__).resolve().parents[1] / "data" / "db2.sqlite"
conn = sqlite3.connect(db)
cur = conn.cursor()
cur.execute(
    "INSERT OR IGNORE INTO o_vendorConfig (id, inputValues, models, enable) VALUES (?, ?, ?, ?)",
    ("suxi", "{}", "[]", 1),
)
conn.commit()
print(cur.execute("SELECT id, enable FROM o_vendorConfig WHERE id='suxi'").fetchone())
conn.close()

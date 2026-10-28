"""Carga inicial de la base desde los CSV provistos (products.csv, sales.csv).

Las 5 tiendas se fijan explícitamente (Cancún, Chihuahua, CDMX, Monterrey,
Mérida). OJO: Mérida NO aparece en el historial de ventas del dataset -> es el
caso de "arranque en frío" por tienda que el recomendador debe manejar.
"""
import csv
from pathlib import Path

from .database import Base, SessionLocal, engine
from . import models

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CANONICAL_STORES = ["Cancún", "Chihuahua", "CDMX", "Monterrey", "Mérida"]


def seed(reset: bool = True) -> dict:
    if reset:
        Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        # Productos
        if db.query(models.Product).count() == 0:
            with open(DATA_DIR / "products.csv", encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    db.add(models.Product(
                        sku=row["sku"].strip(),
                        nombre=row["nombre"].strip(),
                        descripcion=row.get("descripcion", "").strip(),
                        categoria=row.get("categoria", "").strip(),
                        material=row.get("material", "").strip(),
                        uso_recomendado=row.get("uso_recomendado", "").strip(),
                        precio=float(row["precio"]),
                        stock=int(row["stock"]),
                    ))

        # Ventas históricas + nombres de tienda
        store_names = set(CANONICAL_STORES)
        sales_rows = []
        with open(DATA_DIR / "sales.csv", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                sales_rows.append(row)
                store_names.add(row["tienda"].strip())

        if db.query(models.Store).count() == 0:
            for name in sorted(store_names):
                db.add(models.Store(nombre=name))

        if db.query(models.Sale).count() == 0:
            for row in sales_rows:
                db.add(models.Sale(
                    ticket_id=row["ticket_id"].strip(),
                    sku=row["sku"].strip(),
                    cantidad=int(row["cantidad"]),
                    tienda=row["tienda"].strip(),
                    fecha=row["fecha"].strip(),
                    origen="historico",
                ))

        db.commit()
        return {
            "productos": db.query(models.Product).count(),
            "tiendas": db.query(models.Store).count(),
            "ventas": db.query(models.Sale).count(),
        }
    finally:
        db.close()


if __name__ == "__main__":
    stats = seed(reset=True)
    print("Base sembrada:", stats)

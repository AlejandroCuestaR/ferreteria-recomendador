"""Configuración de la base de datos (SQLite + SQLAlchemy).

Se usa SQLite por simplicidad (lo pide la prueba). El archivo vive en
backend/ferreteria.db. Se habilita `check_same_thread=False` porque FastAPI
puede atender peticiones desde distintos hilos.
"""
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

BASE_DIR = Path(__file__).resolve().parent.parent
# Carga backend/.env (si existe) para la capa de IA opcional.
load_dotenv(BASE_DIR / ".env")
DB_PATH = BASE_DIR / "ferreteria.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, _):
    """Activa las llaves foráneas en SQLite (vienen apagadas por defecto)."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Dependencia de FastAPI: entrega una sesión y la cierra al terminar."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

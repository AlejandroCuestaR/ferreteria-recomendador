"""Modelos de datos (tablas).

Decisión de diseño clave: el inventario es COMPARTIDO entre las 5 tiendas, por
lo que el `stock` vive en el producto (una sola existencia por SKU). Cualquier
compra, desde cualquier tienda, descuenta de ese mismo contador. Así el
inventario "nunca se sobrevende sin importar desde qué tienda se compre".
"""
from sqlalchemy import Column, Float, ForeignKey, Integer, String, UniqueConstraint

from .database import Base


class Product(Base):
    __tablename__ = "products"

    sku = Column(String, primary_key=True)
    nombre = Column(String, nullable=False)
    descripcion = Column(String, default="")
    categoria = Column(String, index=True, default="")
    material = Column(String, default="")
    uso_recomendado = Column(String, default="")
    precio = Column(Float, nullable=False, default=0.0)
    stock = Column(Integer, nullable=False, default=0)  # existencia compartida


class Store(Base):
    __tablename__ = "stores"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nombre = Column(String, unique=True, nullable=False)


class Sale(Base):
    """Renglón de venta. El histórico (origen='historico') viene de sales.csv.

    Cada compra hecha en la POC se guarda también aquí (origen='poc'), de modo
    que las nuevas ventas retroalimentan al recomendador en caliente.
    """

    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ticket_id = Column(String, index=True, nullable=False)
    sku = Column(String, ForeignKey("products.sku"), index=True, nullable=False)
    cantidad = Column(Integer, nullable=False, default=1)
    tienda = Column(String, index=True, nullable=False)
    fecha = Column(String, nullable=False)  # ISO 'YYYY-MM-DD'
    origen = Column(String, default="historico")  # 'historico' | 'poc'


class RuleOverride(Base):
    """Ajuste manual del negocio sobre una relación A->B.

    action='hide'  -> nunca recomendar B cuando el seed es A.
    action='boost' -> multiplicar el score por `weight` (p. ej. 2.0).
    Satisface: "el negocio debe poder ver qué relaciones encuentra el sistema,
    y ajustarlas".
    """

    __tablename__ = "rule_overrides"
    __table_args__ = (UniqueConstraint("sku_a", "sku_b", name="uq_pair"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    sku_a = Column(String, index=True, nullable=False)
    sku_b = Column(String, index=True, nullable=False)
    action = Column(String, nullable=False)  # 'hide' | 'boost'
    weight = Column(Float, default=2.0)

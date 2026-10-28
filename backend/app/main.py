"""API FastAPI de la ferretería.

Expone: CRUD de productos, compra por tienda con inventario COMPARTIDO a prueba
de sobreventa, recomendaciones (con explicación opcional por IA) y un panel de
relaciones que el negocio puede ver y ajustar, más un endpoint de evaluación.
"""
import time
from datetime import date
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from . import llm, models, recommender, schemas
from .database import Base, SessionLocal, engine, get_db
from .seed import seed

app = FastAPI(title="Ferretería · Recomendador", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    """Crea las tablas y siembra la base si está vacía (arranque directo)."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        empty = db.query(models.Product).count() == 0
    finally:
        db.close()
    if empty:
        seed(reset=False)


# --------------------------- helpers ---------------------------
def _products_by_sku(db: Session):
    return {p.sku: p for p in db.query(models.Product).all()}


def _overrides_map(db: Session):
    return {
        (o.sku_a, o.sku_b): (o.action, o.weight)
        for o in db.query(models.RuleOverride).all()
    }


def _build_model(db: Session):
    sales = db.query(models.Sale).all()
    baskets = recommender.build_baskets(sales)
    return recommender.build_model(baskets), baskets


# --------------------------- salud / tiendas ---------------------------
@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/stores")
def stores(db: Session = Depends(get_db)):
    return [s.nombre for s in db.query(models.Store).order_by(models.Store.nombre)]


# --------------------------- CRUD de productos ---------------------------
@app.get("/api/products", response_model=List[schemas.ProductOut])
def list_products(db: Session = Depends(get_db)):
    return db.query(models.Product).order_by(models.Product.sku).all()


@app.get("/api/products/{sku}", response_model=schemas.ProductOut)
def get_product(sku: str, db: Session = Depends(get_db)):
    p = db.get(models.Product, sku)
    if not p:
        raise HTTPException(404, "Producto no encontrado")
    return p


@app.post("/api/products", response_model=schemas.ProductOut, status_code=201)
def create_product(payload: schemas.ProductCreate, db: Session = Depends(get_db)):
    if db.get(models.Product, payload.sku):
        raise HTTPException(409, "El SKU ya existe")
    p = models.Product(**payload.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@app.put("/api/products/{sku}", response_model=schemas.ProductOut)
def update_product(sku: str, payload: schemas.ProductUpdate, db: Session = Depends(get_db)):
    p = db.get(models.Product, sku)
    if not p:
        raise HTTPException(404, "Producto no encontrado")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(p, key, value)
    db.commit()
    db.refresh(p)
    return p


@app.delete("/api/products/{sku}", status_code=204)
def delete_product(sku: str, db: Session = Depends(get_db)):
    p = db.get(models.Product, sku)
    if not p:
        raise HTTPException(404, "Producto no encontrado")
    db.delete(p)
    db.commit()


# --------------------------- compra (anti-sobreventa) ---------------------------
@app.post("/api/purchases", response_model=schemas.PurchaseResult)
def purchase(req: schemas.PurchaseRequest, db: Session = Depends(get_db)):
    """Descuenta del inventario compartido. Todo o nada (transacción).

    El descuento usa un UPDATE condicional atómico:
        UPDATE products SET stock = stock - :q WHERE sku = :s AND stock >= :q
    Si afecta 0 filas, no había existencia suficiente y se aborta TODA la
    compra (rollback). Así el inventario nunca se sobrevende, sin importar la
    tienda ni la concurrencia.
    """
    if not req.items:
        raise HTTPException(400, "La compra no tiene productos")
    if not db.query(models.Store).filter_by(nombre=req.tienda).first():
        raise HTTPException(400, f"Tienda desconocida: {req.tienda}")

    ticket_id = f"P{int(time.time() * 1000)}"
    fecha = date.today().isoformat()
    lineas = []
    total = 0.0
    try:
        for it in req.items:
            p = db.get(models.Product, it.sku)
            if not p:
                raise HTTPException(404, f"Producto no encontrado: {it.sku}")
            res = db.execute(
                text("UPDATE products SET stock = stock - :q "
                     "WHERE sku = :sku AND stock >= :q"),
                {"q": it.cantidad, "sku": it.sku},
            )
            if res.rowcount == 0:
                raise HTTPException(
                    409,
                    f"Stock insuficiente para {it.sku} ({p.nombre}): "
                    f"disponible {p.stock}, solicitado {it.cantidad}",
                )
            subtotal = round(p.precio * it.cantidad, 2)
            total += subtotal
            lineas.append(schemas.PurchaseLine(
                sku=p.sku, nombre=p.nombre, cantidad=it.cantidad,
                precio_unitario=p.precio, subtotal=subtotal,
            ))
            db.add(models.Sale(
                ticket_id=ticket_id, sku=it.sku, cantidad=it.cantidad,
                tienda=req.tienda, fecha=fecha, origen="poc",
            ))
        db.commit()
    except HTTPException:
        db.rollback()
        raise

    return schemas.PurchaseResult(
        ticket_id=ticket_id, tienda=req.tienda, fecha=fecha,
        lineas=lineas, total=round(total, 2),
    )


# --------------------------- recomendaciones ---------------------------
@app.get("/api/recommendations/{sku}", response_model=schemas.RecommendationResponse)
def recommendations(
    sku: str,
    store: Optional[str] = None,
    k: int = 5,
    db: Session = Depends(get_db),
):
    pbs = _products_by_sku(db)
    if sku not in pbs:
        raise HTTPException(404, "Producto no encontrado")
    model, _ = _build_model(db)
    recs = recommender.recommend(model, pbs, sku, store, k=k, overrides=_overrides_map(db))
    items = [
        schemas.RecommendationItem(
            sku=pbs[r["sku"]].sku, nombre=pbs[r["sku"]].nombre,
            categoria=pbs[r["sku"]].categoria, precio=pbs[r["sku"]].precio,
            stock=pbs[r["sku"]].stock, score=round(r["score"], 4),
            reason=r["reason"], boosted=r["boosted"], metrics=r["metrics"],
        )
        for r in recs
    ]
    return schemas.RecommendationResponse(
        seed=sku, seed_nombre=pbs[sku].nombre, tienda=store, recomendaciones=items,
    )


@app.post("/api/recommendations/{sku}/explain")
def explain_recommendations(
    sku: str,
    store: Optional[str] = None,
    k: int = 5,
    db: Session = Depends(get_db),
):
    """Explicación en lenguaje natural del combo (IA opcional con fallback)."""
    pbs = _products_by_sku(db)
    if sku not in pbs:
        raise HTTPException(404, "Producto no encontrado")
    model, _ = _build_model(db)
    recs = recommender.recommend(model, pbs, sku, store, k=k, overrides=_overrides_map(db))
    payload = [
        {"nombre": pbs[r["sku"]].nombre, "categoria": pbs[r["sku"]].categoria}
        for r in recs
    ]
    resultado = llm.explain(pbs[sku].nombre, payload)
    return {"seed": pbs[sku].nombre, "llm_enabled": llm.is_enabled(), **resultado}


# --------------------------- relaciones / ajustes del negocio ---------------------------
@app.get("/api/rules", response_model=List[schemas.RuleOut])
def rules(min_count: int = 1, db: Session = Depends(get_db)):
    pbs = _products_by_sku(db)
    model, _ = _build_model(db)
    ov = _overrides_map(db)
    out = []
    for r in recommender.all_rules(model, min_count=min_count):
        a, b = r["sku_a"], r["sku_b"]
        if a not in pbs or b not in pbs:
            continue
        out.append(schemas.RuleOut(
            sku_a=a, sku_b=b, nombre_a=pbs[a].nombre, nombre_b=pbs[b].nombre,
            count=r["count"], support=r["support"], confidence=r["confidence"],
            lift=r["lift"], override=ov.get((a, b), (None,))[0],
        ))
    return out


@app.get("/api/overrides", response_model=List[schemas.OverrideOut])
def list_overrides(db: Session = Depends(get_db)):
    return db.query(models.RuleOverride).all()


@app.post("/api/overrides", response_model=schemas.OverrideOut, status_code=201)
def create_override(payload: schemas.OverrideCreate, db: Session = Depends(get_db)):
    if payload.action not in ("hide", "boost"):
        raise HTTPException(400, "action debe ser 'hide' o 'boost'")
    existing = (
        db.query(models.RuleOverride)
        .filter_by(sku_a=payload.sku_a, sku_b=payload.sku_b)
        .first()
    )
    if existing:
        existing.action = payload.action
        existing.weight = payload.weight
        db.commit()
        db.refresh(existing)
        return existing
    o = models.RuleOverride(**payload.model_dump())
    db.add(o)
    db.commit()
    db.refresh(o)
    return o


@app.delete("/api/overrides/{oid}", status_code=204)
def delete_override(oid: int, db: Session = Depends(get_db)):
    o = db.get(models.RuleOverride, oid)
    if not o:
        raise HTTPException(404, "Override no encontrado")
    db.delete(o)
    db.commit()


# --------------------------- evaluación ---------------------------
@app.get("/api/evaluation", response_model=schemas.EvaluationResult)
def evaluation(k: int = 3, db: Session = Depends(get_db)):
    pbs = _products_by_sku(db)
    _, baskets = _build_model(db)
    return recommender.evaluate(baskets, pbs, k=k)

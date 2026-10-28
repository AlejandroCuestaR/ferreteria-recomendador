"""Esquemas de entrada/salida (Pydantic v2)."""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------- Productos ----------
class ProductBase(BaseModel):
    nombre: str
    descripcion: str = ""
    categoria: str = ""
    material: str = ""
    uso_recomendado: str = ""
    precio: float = Field(ge=0)
    stock: int = Field(ge=0)


class ProductCreate(ProductBase):
    sku: str


class ProductUpdate(BaseModel):
    nombre: Optional[str] = None
    descripcion: Optional[str] = None
    categoria: Optional[str] = None
    material: Optional[str] = None
    uso_recomendado: Optional[str] = None
    precio: Optional[float] = Field(default=None, ge=0)
    stock: Optional[int] = Field(default=None, ge=0)


class ProductOut(ProductBase):
    model_config = ConfigDict(from_attributes=True)
    sku: str


# ---------- Compras ----------
class PurchaseItem(BaseModel):
    sku: str
    cantidad: int = Field(gt=0)


class PurchaseRequest(BaseModel):
    tienda: str
    items: List[PurchaseItem]


class PurchaseLine(BaseModel):
    sku: str
    nombre: str
    cantidad: int
    precio_unitario: float
    subtotal: float


class PurchaseResult(BaseModel):
    ticket_id: str
    tienda: str
    fecha: str
    lineas: List[PurchaseLine]
    total: float


# ---------- Recomendaciones ----------
class RecommendationItem(BaseModel):
    sku: str
    nombre: str
    categoria: str
    precio: float
    stock: int
    score: float
    reason: str  # 'comprados_juntos' | 'relacionado_por_uso'
    boosted: bool = False
    metrics: Dict[str, Any] = {}


class RecommendationResponse(BaseModel):
    seed: str
    seed_nombre: str
    tienda: Optional[str] = None
    recomendaciones: List[RecommendationItem]


# ---------- Reglas / overrides del negocio ----------
class RuleOut(BaseModel):
    sku_a: str
    sku_b: str
    nombre_a: str
    nombre_b: str
    count: int
    support: float
    confidence: float
    lift: float
    override: Optional[str] = None  # 'hide' | 'boost' | None


class OverrideCreate(BaseModel):
    sku_a: str
    sku_b: str
    action: str  # 'hide' | 'boost'
    weight: float = 2.0


class OverrideOut(OverrideCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ---------- Evaluación ----------
class EvaluationResult(BaseModel):
    k: int
    trials: int
    hit_rate: float
    precision_at_k: float
    recall_at_k: float
    baseline_popularity_hit_rate: float
    nota: str

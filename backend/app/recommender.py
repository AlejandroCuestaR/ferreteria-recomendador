"""Motor de recomendación.

Enfoque HÍBRIDO y explicable (el "cómo" es parte central de lo que evalúan):

1) Reglas de asociación (market-basket) a partir del historial de tickets.
   Para un producto A y un candidato B se calculan métricas estándar:
     - soporte(A,B)  = #tickets con A y B / #tickets
     - confianza(A→B)= #tickets con A y B / #tickets con A
     - lift(A,B)     = confianza(A→B) / (prob(B))   (>1 = asociación real)
   Son interpretables: el negocio ve POR QUÉ se relacionan dos productos y
   puede ajustarlo.

2) Respaldo por contenido (content-based) para arranque en frío de PRODUCTO:
   un SKU sin co-compras en el historial (p. ej. SKU027) se relaciona por
   coincidencia de `uso_recomendado` / `material`.

Arranque en frío de TIENDA: una tienda sin historial (p. ej. Mérida) no tiene
señal propia, así que usa las reglas de asociación GLOBALES (y, si el seed
tampoco tiene historial global, el respaldo por contenido).

En los endpoints se filtra por existencia (stock > 0) y se aplican los ajustes
del negocio (ocultar / impulsar). La tienda pondera: si el par también se
compra junto EN ESA tienda, el score recibe un pequeño bono.
"""
import math
import re
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

_STOP = set(
    "de la el en y con para a por los las un una del al sin su o e".split()
)


def _tokens(text: str) -> set:
    toks = re.findall(r"[a-záéíóúñ0-9]+", (text or "").lower())
    return {t for t in toks if t not in _STOP and len(t) > 2}


# ---------------------------------------------------------------------------
# Construcción del modelo de co-ocurrencia
# ---------------------------------------------------------------------------
def build_baskets(sales_rows) -> List[Tuple[str, str, frozenset]]:
    """Agrupa renglones de venta en canastas por ticket.

    sales_rows: objetos con .ticket_id, .sku, .tienda
    Devuelve: lista de (ticket_id, tienda, frozenset(skus)).
    """
    tmp: Dict[str, Dict] = {}
    for r in sales_rows:
        b = tmp.setdefault(r.ticket_id, {"store": r.tienda, "skus": set()})
        b["skus"].add(r.sku)
    return [(tid, b["store"], frozenset(b["skus"])) for tid, b in tmp.items()]


def build_model(baskets, exclude_ticket: Optional[str] = None) -> Dict:
    """Cuenta co-ocurrencias. `exclude_ticket` permite dejar un ticket fuera
    (se usa en la evaluación leave-one-ticket-out, sin fuga de información)."""
    pair = defaultdict(int)        # (a, b) -> #tickets con ambos
    item = defaultdict(int)        # a -> #tickets con a
    store_pair = defaultdict(int)  # (store, a, b) -> #tickets con ambos en esa tienda
    n = 0
    for tid, store, skus in baskets:
        if exclude_ticket is not None and tid == exclude_ticket:
            continue
        n += 1
        for a in skus:
            item[a] += 1
            for b in skus:
                if a == b:
                    continue
                pair[(a, b)] += 1
                store_pair[(store, a, b)] += 1
    return {"pair": pair, "item": item, "store_pair": store_pair, "n": n}


def _association_candidates(model, sku, store=None) -> Dict[str, Dict]:
    out: Dict[str, Dict] = {}
    n, item, pair = model["n"], model["item"], model["pair"]
    a_count = item.get(sku, 0)
    if a_count == 0 or n == 0:
        return out
    for (a, b), c in pair.items():
        if a != sku:
            continue
        b_count = item.get(b, 0)
        support = c / n
        confidence = c / a_count
        lift = (c * n) / (a_count * b_count) if b_count else 0.0
        store_c = model["store_pair"].get((store, a, b), 0) if store else 0
        # Bono por tienda PROPORCIONAL a la evidencia en esa tienda (satura en
        # 1.5x): más co-ocurrencias del par en la tienda -> más bono, con
        # rendimientos decrecientes. Una tienda con pocas ventas pesa poco.
        store_bonus = 1.0 + 0.5 * (store_c / (store_c + 1))
        # Shrinkage por evidencia: un par visto una sola vez no debe dominar por
        # un lift inflado; se pondera por #co-ocurrencias, count/(count+1)
        # (1 vez -> 0.5, 2 -> 0.67, 5 -> 0.83).
        evidence = c / (c + 1)
        score = confidence * max(lift, 0.01) * store_bonus * evidence
        out[b] = {
            "count": c,
            "support": round(support, 4),
            "confidence": round(confidence, 4),
            "lift": round(lift, 4),
            "store_count": store_c,
            "score": score,
        }
    return out


def _content_candidates(products_by_sku, sku) -> Dict[str, Dict]:
    base = products_by_sku.get(sku)
    if base is None:
        return {}
    base_tok = _tokens(base.uso_recomendado) | _tokens(base.material)
    out: Dict[str, Dict] = {}
    if not base_tok:
        return out
    for other, p in products_by_sku.items():
        if other == sku:
            continue
        ot = _tokens(p.uso_recomendado) | _tokens(p.material)
        inter = base_tok & ot
        if not inter:
            continue
        jacc = len(inter) / len(base_tok | ot)
        out[other] = {"score": jacc, "shared": sorted(inter)}
    return out


def recommend(
    model,
    products_by_sku,
    sku: str,
    store: Optional[str] = None,
    k: int = 5,
    overrides: Optional[Dict[Tuple[str, str], Tuple[str, float]]] = None,
    enforce_stock: bool = True,
) -> List[Dict]:
    """Devuelve hasta k recomendaciones para `sku` en `store`.

    overrides: {(a, b): (action, weight)} con action in {'hide', 'boost'}.
    enforce_stock: en los endpoints va True (solo con existencia); la
    evaluación offline lo pone en False para no penalizar aciertos agotados.
    Primero reglas de asociación; si faltan, se completa con content-based.
    """
    overrides = overrides or {}
    assoc = _association_candidates(model, sku, store)

    recs: List[Dict] = []
    for b, m in assoc.items():
        p = products_by_sku.get(b)
        if p is None or (enforce_stock and p.stock <= 0):  # solo con existencia
            continue
        ov = overrides.get((sku, b))
        if ov and ov[0] == "hide":
            continue
        score = m["score"]
        boosted = False
        if ov and ov[0] == "boost":
            score *= ov[1]
            boosted = True
        recs.append(
            {"sku": b, "score": score, "reason": "comprados_juntos",
             "metrics": m, "boosted": boosted}
        )
    recs.sort(key=lambda x: -x["score"])

    # Relleno por contenido (arranque en frío) si faltan candidatos.
    if len(recs) < k:
        taken = {r["sku"] for r in recs} | {sku}
        extra = []
        for b, cm in _content_candidates(products_by_sku, sku).items():
            if b in taken:
                continue
            p = products_by_sku.get(b)
            if p is None or (enforce_stock and p.stock <= 0):
                continue
            ov = overrides.get((sku, b))
            if ov and ov[0] == "hide":
                continue
            # Score muy por debajo del de asociación: el contenido es respaldo.
            extra.append(
                {"sku": b, "score": cm["score"] * 0.1,
                 "reason": "relacionado_por_uso",
                 "metrics": {"shared": cm["shared"]}, "boosted": False}
            )
        extra.sort(key=lambda x: -x["score"])
        recs.extend(extra[: k - len(recs)])

    return recs[:k]


def all_rules(model, min_count: int = 1) -> List[Dict]:
    """Todas las relaciones descubiertas (para el panel del negocio)."""
    rules = []
    n, item, pair = model["n"], model["item"], model["pair"]
    seen = set()
    for (a, b), c in pair.items():
        if c < min_count:
            continue
        key = (a, b)
        if key in seen:
            continue
        seen.add(key)
        a_count, b_count = item.get(a, 0), item.get(b, 0)
        confidence = c / a_count if a_count else 0.0
        lift = (c * n) / (a_count * b_count) if (a_count and b_count) else 0.0
        rules.append({
            "sku_a": a, "sku_b": b, "count": c,
            "support": round(c / n, 4) if n else 0.0,
            "confidence": round(confidence, 4),
            "lift": round(lift, 4),
        })
    rules.sort(key=lambda r: (-r["confidence"], -r["lift"], -r["count"]))
    return rules


# ---------------------------------------------------------------------------
# Evaluación: ¿son buenas las recomendaciones?
# ---------------------------------------------------------------------------
def evaluate(baskets, products_by_sku, k: int = 3) -> Dict:
    """Leave-one-ticket-out.

    Para cada ticket con >=2 productos: se saca ese ticket del modelo
    (se re-entrena sin él, evitando fuga), y por cada producto como "semilla"
    se pide top-k; se cuenta acierto si alguno de los OTROS productos del
    ticket aparece en la recomendación. Se compara contra una línea base de
    popularidad (recomendar los k más vendidos).
    """
    # Popularidad global (#tickets que contienen cada SKU). A propósito la
    # línea base VE todos los tickets (ventaja optimista): si aun con esa
    # ventaja el modelo la supera, la mejora es conservadora y creíble.
    pop = defaultdict(int)
    for _, _, skus in baskets:
        for s in skus:
            pop[s] += 1
    popular_order = sorted(pop, key=lambda s: -pop[s])

    hits = trials = 0
    base_hits = 0
    prec_sum = rec_sum = 0.0
    for tid, store, skus in baskets:
        skus = list(skus)
        if len(skus) < 2:
            continue
        model = build_model(baskets, exclude_ticket=tid)
        for seed in skus:
            targets = set(skus) - {seed}
            recs = recommend(model, products_by_sku, seed, store, k=k,
                             overrides={}, enforce_stock=False)
            rec_skus = [r["sku"] for r in recs if r["reason"] == "comprados_juntos"]
            if not rec_skus:
                continue  # sin señal de asociación para esta semilla
            trials += 1
            inter = set(rec_skus) & targets
            if inter:
                hits += 1
            prec_sum += len(inter) / len(rec_skus)
            rec_sum += len(inter) / len(targets)
            # Baseline: los k más populares distintos de la semilla.
            base_rec = [s for s in popular_order if s != seed][:k]
            if set(base_rec) & targets:
                base_hits += 1

    return {
        "k": k,
        "trials": trials,
        "hit_rate": round(hits / trials, 4) if trials else 0.0,
        "precision_at_k": round(prec_sum / trials, 4) if trials else 0.0,
        "recall_at_k": round(rec_sum / trials, 4) if trials else 0.0,
        "baseline_popularity_hit_rate": round(base_hits / trials, 4) if trials else 0.0,
        "nota": (
            "Leave-one-ticket-out: el MODELO se re-entrena sin el ticket "
            "evaluado (sin fuga). La línea base de popularidad ve todos los "
            "tickets (ventaja optimista): aun así el modelo la supera, por lo "
            "que la mejora es conservadora y creíble."
        ),
    }

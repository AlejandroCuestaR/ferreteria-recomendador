"""Pruebas del motor de recomendación (lógica pura, sin base de datos)."""
from types import SimpleNamespace

from app import recommender


def _prod(sku, stock=10, uso="", material="", nombre=None, categoria=""):
    return SimpleNamespace(
        sku=sku, stock=stock, uso_recomendado=uso, material=material,
        nombre=nombre or sku, categoria=categoria,
    )


def _baskets():
    # A y B casi siempre juntos; C/E aparte.
    return [
        ("T1", "CDMX", frozenset({"A", "B"})),
        ("T2", "CDMX", frozenset({"A", "B"})),
        ("T3", "CDMX", frozenset({"A", "B", "D"})),
        ("T4", "CDMX", frozenset({"C", "E"})),
    ]


def test_asociacion_recomienda_par_frecuente():
    model = recommender.build_model(_baskets())
    pbs = {s: _prod(s) for s in ["A", "B", "C", "D", "E"]}
    recs = recommender.recommend(model, pbs, "A", "CDMX", k=3)
    assert "B" in [r["sku"] for r in recs]
    assert recs[0]["reason"] == "comprados_juntos"
    assert recs[0]["metrics"]["confidence"] > 0


def test_solo_recomienda_con_existencia():
    model = recommender.build_model(_baskets())
    pbs = {s: _prod(s) for s in ["A", "B", "C", "D", "E"]}
    pbs["B"].stock = 0  # agotado -> no debe recomendarse
    recs = recommender.recommend(model, pbs, "A", "CDMX", k=3)
    assert "B" not in [r["sku"] for r in recs]


def test_override_hide_oculta_par():
    model = recommender.build_model(_baskets())
    pbs = {s: _prod(s) for s in ["A", "B", "C", "D", "E"]}
    recs = recommender.recommend(
        model, pbs, "A", "CDMX", k=3, overrides={("A", "B"): ("hide", 1.0)}
    )
    assert "B" not in [r["sku"] for r in recs]


def test_arranque_en_frio_por_contenido():
    # Z no tiene historial de ventas; se recomienda por uso/material compartido.
    model = recommender.build_model(_baskets())
    pbs = {s: _prod(s) for s in ["A", "B", "C", "D", "E"]}
    pbs["Z"] = _prod("Z", uso="soldadura y corte", material="acero")
    pbs["Y"] = _prod("Y", uso="soldadura de alta resistencia", material="latón")
    recs = recommender.recommend(model, pbs, "Z", "Mérida", k=3)
    assert any(r["reason"] == "relacionado_por_uso" for r in recs)

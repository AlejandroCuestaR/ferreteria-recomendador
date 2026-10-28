"""Prueba de que el inventario compartido NUNCA se sobrevende."""
from fastapi.testclient import TestClient

from app.main import app
from app.seed import seed


def setup_module(_):
    seed(reset=True)


client = TestClient(app)


def test_compra_dentro_de_stock_descuenta():
    before = client.get("/api/products/SKU027").json()["stock"]
    r = client.post(
        "/api/purchases",
        json={"tienda": "Mérida", "items": [{"sku": "SKU027", "cantidad": 3}]},
    )
    assert r.status_code == 200
    after = client.get("/api/products/SKU027").json()["stock"]
    assert after == before - 3


def test_no_sobreventa():
    stock = client.get("/api/products/SKU027").json()["stock"]
    r = client.post(
        "/api/purchases",
        json={"tienda": "CDMX", "items": [{"sku": "SKU027", "cantidad": stock + 100}]},
    )
    assert r.status_code == 409
    assert client.get("/api/products/SKU027").json()["stock"] == stock  # sin cambio


def test_compra_multiple_hace_rollback():
    # Un item válido + uno imposible => no debe descontar ninguno (transacción).
    s_valido = client.get("/api/products/SKU005").json()["stock"]
    r = client.post(
        "/api/purchases",
        json={"tienda": "CDMX", "items": [
            {"sku": "SKU005", "cantidad": 1},
            {"sku": "SKU007", "cantidad": 999999},
        ]},
    )
    assert r.status_code == 409
    assert client.get("/api/products/SKU005").json()["stock"] == s_valido

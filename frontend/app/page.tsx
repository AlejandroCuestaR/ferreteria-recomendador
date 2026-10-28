"use client";

import { useCallback, useEffect, useState } from "react";
import { getErrorMessage, getProducts, getStores, type Product } from "@/lib/api";
import InventoryTab from "./components/InventoryTab";
import PurchaseTab from "./components/PurchaseTab";
import RecommendationsTab from "./components/RecommendationsTab";
import RulesTab from "./components/RulesTab";

type TabId = "inventario" | "comprar" | "recomendaciones" | "relaciones";

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "inventario", label: "Inventario" },
  { id: "comprar", label: "Comprar" },
  { id: "recomendaciones", label: "Recomendaciones" },
  { id: "relaciones", label: "Relaciones (negocio)" },
];

export default function DashboardPage() {
  const [stores, setStores] = useState<string[]>([]);
  const [store, setStore] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("inventario");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Recarga el catálogo de productos (se usa tras crear/editar/eliminar/comprar). */
  const refreshProducts = useCallback(async () => {
    const data = await getProducts();
    setProducts(data);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      try {
        const [storesData, productsData] = await Promise.all([
          getStores(),
          getProducts(),
        ]);
        if (cancelled) return;
        setStores(storesData);
        setStore((current) => current || storesData[0] || "");
        setProducts(productsData);
        setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadInitialData();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="container header-inner">
          <h1 className="app-title">
            Ferretería <span className="title-sep">·</span> Recomendador
          </h1>
          <label className="store-selector">
            <span>Tienda:</span>
            <select
              value={store}
              onChange={(e) => setStore(e.target.value)}
              disabled={stores.length === 0}
            >
              {stores.length === 0 && <option value="">Cargando…</option>}
              {stores.map((storeName) => (
                <option key={storeName} value={storeName}>
                  {storeName}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <nav className="tabs">
        <div className="container tabs-inner">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tab ${activeTab === tab.id ? "tab-active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="container main-content">
        {loadError && (
          <p className="error-msg">
            {loadError} — verifica que el backend esté corriendo y recarga la página.
          </p>
        )}

        {loading ? (
          <p className="muted">Cargando datos iniciales…</p>
        ) : (
          // Los 4 tabs se mantienen SIEMPRE montados y solo se alterna su
          // visibilidad con CSS. Si se desmontaran al cambiar de pestaña
          // (renderizado condicional), se perdería el estado interno de cada
          // uno (p. ej. el carrito de "Comprar") cada vez que el usuario
          // navega a otra pestaña y regresa.
          <>
            <div style={{ display: activeTab === "inventario" ? "block" : "none" }}>
              <InventoryTab products={products} onRefresh={refreshProducts} />
            </div>
            <div style={{ display: activeTab === "comprar" ? "block" : "none" }}>
              <PurchaseTab
                products={products}
                store={store}
                onRefresh={refreshProducts}
              />
            </div>
            <div
              style={{ display: activeTab === "recomendaciones" ? "block" : "none" }}
            >
              <RecommendationsTab products={products} store={store} />
            </div>
            <div style={{ display: activeTab === "relaciones" ? "block" : "none" }}>
              <RulesTab />
            </div>
          </>
        )}
      </main>

      <footer className="app-footer">
        <div className="container">
          <p className="muted">
            POC de prueba técnica · 5 tiendas con inventario compartido · Backend
            FastAPI en {process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}
          </p>
        </div>
      </footer>
    </div>
  );
}

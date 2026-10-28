"use client";

import { useEffect, useRef, useState } from "react";
import {
  explainRecommendations,
  getErrorMessage,
  getRecommendations,
  type AssociationMetrics,
  type ContentMetrics,
  type ExplainResponse,
  type Product,
  type RecommendationsResponse,
} from "@/lib/api";
import { formatMoney, formatPercent } from "@/lib/format";

interface RecommendationsTabProps {
  products: Product[];
  store: string;
}

/** Type guard: distingue métricas de asociación de métricas de contenido. */
function isAssociationMetrics(
  metrics: AssociationMetrics | ContentMetrics,
): metrics is AssociationMetrics {
  return "confidence" in metrics;
}

export default function RecommendationsTab({ products, store }: RecommendationsTabProps) {
  const [seedSku, setSeedSku] = useState("");
  const [data, setData] = useState<RecommendationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<ExplainResponse | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  // Refs que siempre reflejan la semilla/tienda MÁS RECIENTE (se actualizan en
  // cada render). handleExplain las usa para saber, cuando su petición async
  // resuelve, si el usuario sigue mirando el mismo producto/tienda; los valores
  // capturados por closure dentro de la propia función no cambian con el tiempo,
  // así que no sirven para detectar que el usuario navegó a otro lado.
  const seedSkuRef = useRef(seedSku);
  seedSkuRef.current = seedSku;
  const storeRef = useRef(store);
  storeRef.current = store;

  // Al cambiar el producto semilla o la tienda, se recargan las recomendaciones.
  useEffect(() => {
    if (!seedSku || !store) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExplanation(null);
    setExplainError(null);
    // Si había una explicación en curso para el producto/tienda anterior, el
    // resultado se descartará (ver stillCurrent en handleExplain); liberamos
    // el botón aquí para que no quede trabado en "Generando explicación…".
    setExplaining(false);

    getRecommendations(seedSku, store, 5)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setData(null);
          setError(getErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [seedSku, store]);

  async function handleExplain() {
    if (!seedSku || !store) return;
    // Capturamos la semilla/tienda vigentes al iniciar la petición: si el usuario
    // cambia de producto o tienda antes de que responda, descartamos el resultado
    // viejo en vez de pisar el estado con una explicación que ya no corresponde.
    const requestSeed = seedSku;
    const requestStore = store;
    setExplaining(true);
    setExplainError(null);
    try {
      const result = await explainRecommendations(requestSeed, requestStore, 5);
      const stillCurrent =
        requestSeed === seedSkuRef.current && requestStore === storeRef.current;
      if (stillCurrent) {
        setExplanation(result);
      }
    } catch (err) {
      const stillCurrent =
        requestSeed === seedSkuRef.current && requestStore === storeRef.current;
      if (stillCurrent) {
        setExplainError(getErrorMessage(err));
      }
    } finally {
      const stillCurrent =
        requestSeed === seedSkuRef.current && requestStore === storeRef.current;
      if (stillCurrent) {
        setExplaining(false);
      }
    }
  }

  return (
    <section>
      <div className="section-header">
        <h2>Recomendaciones de productos</h2>
      </div>

      <div className="panel">
        <div className="purchase-controls">
          <label>
            Producto semilla
            <select value={seedSku} onChange={(e) => setSeedSku(e.target.value)}>
              <option value="">— Selecciona un producto —</option>
              {products.map((product) => (
                <option key={product.sku} value={product.sku}>
                  {product.nombre} ({product.sku})
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            Tienda activa: <strong>{store || "sin seleccionar"}</strong>
          </p>
        </div>
      </div>

      {loading && <p className="muted">Buscando recomendaciones…</p>}
      {error && <p className="error-msg">{error}</p>}

      {data && !loading && (
        <>
          <h3>
            Recomendaciones para <strong>{data.seed_nombre}</strong> en{" "}
            <strong>{data.tienda}</strong>
          </h3>

          {data.recomendaciones.length === 0 ? (
            <p className="muted">
              No hay recomendaciones disponibles para este producto todavía.
            </p>
          ) : (
            <div className="cards-grid">
              {data.recomendaciones.map((rec) => (
                <article key={rec.sku} className="rec-card">
                  <div>
                    {rec.reason === "comprados_juntos" ? (
                      <span className="badge badge-blue">Comprados juntos</span>
                    ) : (
                      <span className="badge badge-gray">Relacionado por uso</span>
                    )}
                    {rec.boosted && (
                      <span className="badge badge-boost">Impulsado</span>
                    )}
                  </div>
                  <h4>{rec.nombre}</h4>
                  <p className="rec-meta">{rec.categoria}</p>
                  <p className="rec-price">{formatMoney(rec.precio)}</p>
                  <p className="rec-meta">Stock: {rec.stock}</p>
                  {isAssociationMetrics(rec.metrics) ? (
                    <p className="rec-meta">
                      Confianza: {formatPercent(rec.metrics.confidence)} · Lift:{" "}
                      {rec.metrics.lift.toFixed(2)}
                    </p>
                  ) : (
                    <p className="rec-meta">
                      Coincide en: {rec.metrics.shared.join(", ")}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}

          <div className="explain-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleExplain}
              disabled={explaining}
            >
              {explaining ? "Generando explicación…" : "Explicar con IA"}
            </button>
          </div>
          {explainError && <p className="error-msg">{explainError}</p>}
          {explanation && (
            <div className="explain-box">
              {explanation.texto}
              <span className="explain-source">Fuente: {explanation.fuente}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

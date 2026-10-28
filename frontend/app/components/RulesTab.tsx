"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createOverride,
  deleteOverride,
  getErrorMessage,
  getEvaluation,
  getOverrides,
  getRules,
  type Evaluation,
  type Override,
  type OverrideAction,
  type Rule,
} from "@/lib/api";
import { formatPercent } from "@/lib/format";

function ruleKey(rule: Rule): string {
  return `${rule.sku_a}|${rule.sku_b}`;
}

export default function RulesTab() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [rulesData, overridesData] = await Promise.all([
        getRules(2),
        getOverrides(),
      ]);
      setRules(rulesData);
      setOverrides(overridesData);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // El override del backend es direccional (tupla ordenada sku_a, sku_b):
  // comparamos SOLO en ese orden para no borrar el override de la regla inversa.
  function findOverride(rule: Rule): Override | undefined {
    return overrides.find(
      (o) => o.sku_a === rule.sku_a && o.sku_b === rule.sku_b,
    );
  }

  async function handleCreateOverride(rule: Rule, action: OverrideAction) {
    setBusyKey(ruleKey(rule));
    setError(null);
    try {
      await createOverride({
        sku_a: rule.sku_a,
        sku_b: rule.sku_b,
        action,
        weight: 2,
      });
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRemoveOverride(rule: Rule) {
    const override = findOverride(rule);
    if (!override) return;
    setBusyKey(ruleKey(rule));
    setError(null);
    try {
      await deleteOverride(override.id);
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleEvaluate() {
    setEvaluating(true);
    setEvalError(null);
    try {
      const result = await getEvaluation(3);
      setEvaluation(result);
    } catch (err) {
      setEvalError(getErrorMessage(err));
    } finally {
      setEvaluating(false);
    }
  }

  const beatsBaseline =
    evaluation !== null &&
    evaluation.hit_rate > evaluation.baseline_popularity_hit_rate;

  return (
    <section>
      <div className="section-header">
        <h2>Relaciones entre productos (vista de negocio)</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleEvaluate}
          disabled={evaluating}
        >
          {evaluating ? "Evaluando…" : "Evaluar recomendaciones"}
        </button>
      </div>

      {evalError && <p className="error-msg">{evalError}</p>}

      {evaluation && (
        <div className="panel">
          <h3>
            Evaluación offline (k = {evaluation.k}, {evaluation.trials} pruebas)
          </h3>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-value">{formatPercent(evaluation.hit_rate)}</div>
              <div className="metric-label">Hit rate (recomendador)</div>
            </div>
            <div className="metric-card">
              <div className="metric-value">
                {formatPercent(evaluation.baseline_popularity_hit_rate)}
              </div>
              <div className="metric-label">Hit rate (línea base: popularidad)</div>
            </div>
            <div className="metric-card">
              <div className="metric-value">
                {formatPercent(evaluation.precision_at_k)}
              </div>
              <div className="metric-label">Precision@{evaluation.k}</div>
            </div>
            <div className="metric-card">
              <div className="metric-value">
                {formatPercent(evaluation.recall_at_k)}
              </div>
              <div className="metric-label">Recall@{evaluation.k}</div>
            </div>
          </div>
          <p className={beatsBaseline ? "success-msg" : "muted"}>
            {beatsBaseline
              ? "El recomendador supera a la línea base de popularidad: aporta valor real frente a sugerir simplemente lo más vendido."
              : "Superar la línea base de popularidad significa que el recomendador aporta valor; si no la supera, conviene revisar las reglas y los datos."}
          </p>
          {evaluation.nota && <p className="muted">{evaluation.nota}</p>}
        </div>
      )}

      {error && <p className="error-msg">{error}</p>}

      {loading ? (
        <p className="muted">Cargando relaciones…</p>
      ) : rules.length === 0 ? (
        <p className="muted">
          Aún no hay relaciones detectadas (se calculan a partir del historial de
          compras).
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Relación (A → B)</th>
                <th className="num">Veces juntos</th>
                <th className="num">Support</th>
                <th className="num">Confidence</th>
                <th className="num">Lift</th>
                <th>Override</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => {
                const key = ruleKey(rule);
                const busy = busyKey === key;
                return (
                  <tr key={key}>
                    <td>
                      <strong>{rule.nombre_a}</strong> → {rule.nombre_b}
                    </td>
                    <td className="num">{rule.count}</td>
                    <td className="num">{formatPercent(rule.support)}</td>
                    <td className="num">{formatPercent(rule.confidence)}</td>
                    <td className="num">{rule.lift.toFixed(2)}</td>
                    <td>
                      {rule.override === "hide" && (
                        <span className="badge badge-hide">Oculta</span>
                      )}
                      {rule.override === "boost" && (
                        <span className="badge badge-boost">Impulsada</span>
                      )}
                      {rule.override === null && <span className="muted">—</span>}
                    </td>
                    <td>
                      <div className="row-actions">
                        {rule.override === null ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => handleCreateOverride(rule, "hide")}
                              disabled={busy}
                            >
                              Ocultar
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              onClick={() => handleCreateOverride(rule, "boost")}
                              disabled={busy}
                            >
                              Impulsar
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => handleRemoveOverride(rule)}
                            disabled={busy}
                          >
                            Quitar override
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

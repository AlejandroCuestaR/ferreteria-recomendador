/**
 * Cliente HTTP tipado para la API del backend (FastAPI).
 * La URL base se toma de NEXT_PUBLIC_API_URL (default: http://localhost:8000).
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ---------------------------------------------------------------------------
// Tipos de datos (espejo del contrato de la API)
// ---------------------------------------------------------------------------

export interface Product {
  sku: string;
  nombre: string;
  descripcion: string;
  categoria: string;
  material: string;
  uso_recomendado: string;
  precio: number;
  stock: number;
}

export interface PurchaseItem {
  sku: string;
  cantidad: number;
}

export interface TicketLine {
  sku: string;
  nombre: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

export interface Ticket {
  ticket_id: string;
  tienda: string;
  fecha: string;
  lineas: TicketLine[];
  total: number;
}

/** Métricas cuando la recomendación viene de reglas de asociación (comprados juntos). */
export interface AssociationMetrics {
  count: number;
  support: number;
  confidence: number;
  lift: number;
  store_count: number;
  score: number;
}

/** Métricas cuando la recomendación viene de similitud de contenido (relacionado por uso). */
export interface ContentMetrics {
  shared: string[];
}

export type RecommendationReason = "comprados_juntos" | "relacionado_por_uso";

export interface Recommendation {
  sku: string;
  nombre: string;
  categoria: string;
  precio: number;
  stock: number;
  score: number;
  reason: RecommendationReason;
  boosted: boolean;
  metrics: AssociationMetrics | ContentMetrics;
}

export interface RecommendationsResponse {
  seed: string;
  seed_nombre: string;
  tienda: string;
  recomendaciones: Recommendation[];
}

export interface ExplainResponse {
  seed: string;
  llm_enabled: boolean;
  texto: string;
  fuente: string;
}

export type OverrideAction = "hide" | "boost";

export interface Rule {
  sku_a: string;
  sku_b: string;
  nombre_a: string;
  nombre_b: string;
  count: number;
  support: number;
  confidence: number;
  lift: number;
  override: OverrideAction | null;
}

export interface Override {
  id: number;
  sku_a: string;
  sku_b: string;
  action: OverrideAction;
  weight: number;
}

export interface Evaluation {
  k: number;
  trials: number;
  hit_rate: number;
  precision_at_k: number;
  recall_at_k: number;
  baseline_popularity_hit_rate: number;
  nota: string;
}

export interface Health {
  status: string;
}

// ---------------------------------------------------------------------------
// Infraestructura de peticiones
// ---------------------------------------------------------------------------

/** Error de la API que conserva el código HTTP y el `detail` que envía el backend. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Extrae un mensaje legible de cualquier error capturado en un catch. */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Ocurrió un error inesperado.";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    throw new ApiError(0, `No se pudo conectar con el backend (${API_BASE}).`);
  }

  if (!response.ok) {
    let message = `Error ${response.status} del servidor.`;
    try {
      const body: unknown = await response.json();
      if (
        typeof body === "object" &&
        body !== null &&
        "detail" in body &&
        typeof (body as { detail: unknown }).detail === "string"
      ) {
        message = (body as { detail: string }).detail;
      }
    } catch {
      // Respuesta sin cuerpo JSON: se conserva el mensaje genérico.
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export function getHealth(): Promise<Health> {
  return request<Health>("/api/health");
}

export function getStores(): Promise<string[]> {
  return request<string[]>("/api/stores");
}

export function getProducts(): Promise<Product[]> {
  return request<Product[]>("/api/products");
}

export function getProduct(sku: string): Promise<Product> {
  return request<Product>(`/api/products/${encodeURIComponent(sku)}`);
}

export function createProduct(product: Product): Promise<Product> {
  return request<Product>("/api/products", {
    method: "POST",
    body: JSON.stringify(product),
  });
}

export function updateProduct(
  sku: string,
  changes: Partial<Omit<Product, "sku">>,
): Promise<Product> {
  return request<Product>(`/api/products/${encodeURIComponent(sku)}`, {
    method: "PUT",
    body: JSON.stringify(changes),
  });
}

export function deleteProduct(sku: string): Promise<void> {
  return request<void>(`/api/products/${encodeURIComponent(sku)}`, {
    method: "DELETE",
  });
}

export function createPurchase(tienda: string, items: PurchaseItem[]): Promise<Ticket> {
  return request<Ticket>("/api/purchases", {
    method: "POST",
    body: JSON.stringify({ tienda, items }),
  });
}

export function getRecommendations(
  sku: string,
  store: string,
  k = 5,
): Promise<RecommendationsResponse> {
  const params = new URLSearchParams({ store, k: String(k) });
  return request<RecommendationsResponse>(
    `/api/recommendations/${encodeURIComponent(sku)}?${params.toString()}`,
  );
}

export function explainRecommendations(
  sku: string,
  store: string,
  k = 5,
): Promise<ExplainResponse> {
  const params = new URLSearchParams({ store, k: String(k) });
  return request<ExplainResponse>(
    `/api/recommendations/${encodeURIComponent(sku)}/explain?${params.toString()}`,
    { method: "POST" },
  );
}

export function getRules(minCount = 1): Promise<Rule[]> {
  return request<Rule[]>(`/api/rules?min_count=${minCount}`);
}

export function getOverrides(): Promise<Override[]> {
  return request<Override[]>("/api/overrides");
}

export function createOverride(input: {
  sku_a: string;
  sku_b: string;
  action: OverrideAction;
  weight: number;
}): Promise<Override> {
  return request<Override>("/api/overrides", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteOverride(id: number): Promise<void> {
  return request<void>(`/api/overrides/${id}`, { method: "DELETE" });
}

export function getEvaluation(k = 3): Promise<Evaluation> {
  return request<Evaluation>(`/api/evaluation?k=${k}`);
}

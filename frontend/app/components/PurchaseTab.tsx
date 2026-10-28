"use client";

import { useMemo, useState } from "react";
import {
  createPurchase,
  getErrorMessage,
  type Product,
  type Ticket,
} from "@/lib/api";
import { formatMoney } from "@/lib/format";

interface PurchaseTabProps {
  products: Product[];
  store: string;
  onRefresh: () => Promise<void>;
}

interface CartItem {
  sku: string;
  cantidad: number;
}

export default function PurchaseTab({ products, store, onRefresh }: PurchaseTabProps) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedSku, setSelectedSku] = useState("");
  const [qty, setQty] = useState("1");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  // Valor de texto temporal de cada input de cantidad del carrito mientras se edita.
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});

  const productsBySku = useMemo(() => {
    const map = new Map<string, Product>();
    for (const product of products) map.set(product.sku, product);
    return map;
  }, [products]);

  const total = cart.reduce((sum, item) => {
    const product = productsBySku.get(item.sku);
    return product ? sum + product.precio * item.cantidad : sum;
  }, 0);

  function addToCart() {
    const cantidad = Number.parseInt(qty, 10);
    if (!selectedSku || Number.isNaN(cantidad) || cantidad < 1) return;
    setCart((prev) => {
      const existing = prev.find((item) => item.sku === selectedSku);
      if (existing) {
        return prev.map((item) =>
          item.sku === selectedSku
            ? { ...item, cantidad: item.cantidad + cantidad }
            : item,
        );
      }
      return [...prev, { sku: selectedSku, cantidad }];
    });
    setQty("1");
  }

  // Mientras el usuario edita, el input vive como string en `qtyDrafts` para
  // permitir borrar/reescribir sin que un valor intermedio (p. ej. "") rebote.
  // La cantidad real del carrito solo se corrige al perder el foco (onBlur).
  function handleQuantityChange(sku: string, value: string) {
    setQtyDrafts((prev) => ({ ...prev, [sku]: value }));
  }

  function commitQuantity(sku: string) {
    const draft = qtyDrafts[sku];
    setQtyDrafts((prev) => {
      const next = { ...prev };
      delete next[sku];
      return next;
    });
    if (draft === undefined) return;
    const cantidad = Number.parseInt(draft, 10);
    if (Number.isNaN(cantidad) || cantidad < 1) return;
    setCart((prev) =>
      prev.map((item) => (item.sku === sku ? { ...item, cantidad } : item)),
    );
  }

  function removeFromCart(sku: string) {
    setCart((prev) => prev.filter((item) => item.sku !== sku));
    setQtyDrafts((prev) => {
      const next = { ...prev };
      delete next[sku];
      return next;
    });
  }

  async function handleBuy() {
    if (cart.length === 0 || !store) return;
    setBuying(true);
    setError(null);
    setTicket(null);
    try {
      const result = await createPurchase(
        store,
        cart.map((item) => ({ sku: item.sku, cantidad: item.cantidad })),
      );
      setTicket(result);
      setCart([]);
      setQtyDrafts({});
      // El inventario es compartido: refrescamos el stock tras la venta.
      await onRefresh();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBuying(false);
    }
  }

  return (
    <section>
      <div className="section-header">
        <h2>
          Comprar en tienda: <strong>{store || "sin seleccionar"}</strong>
        </h2>
      </div>

      <div className="panel">
        <h3>Agregar productos al carrito</h3>
        <div className="purchase-controls">
          <label>
            Producto
            <select
              value={selectedSku}
              onChange={(e) => setSelectedSku(e.target.value)}
            >
              <option value="">— Selecciona un producto —</option>
              {products.map((product) => (
                <option key={product.sku} value={product.sku}>
                  {product.nombre} — {formatMoney(product.precio)} (stock:{" "}
                  {product.stock})
                </option>
              ))}
            </select>
          </label>
          <label>
            Cantidad
            <input
              type="number"
              min={1}
              step={1}
              className="qty-input"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            onClick={addToCart}
            disabled={!selectedSku}
          >
            Agregar
          </button>
        </div>
      </div>

      {cart.length === 0 ? (
        <p className="muted">El carrito está vacío. Agrega productos para comprar.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num">Precio unitario</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Subtotal</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {cart.map((item) => {
                  const product = productsBySku.get(item.sku);
                  if (!product) return null;
                  return (
                    <tr key={item.sku}>
                      <td>{product.nombre}</td>
                      <td className="num">{formatMoney(product.precio)}</td>
                      <td className="num">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          className="qty-input"
                          value={qtyDrafts[item.sku] ?? String(item.cantidad)}
                          onChange={(e) =>
                            handleQuantityChange(item.sku, e.target.value)
                          }
                          onBlur={() => commitQuantity(item.sku)}
                        />
                      </td>
                      <td className="num">
                        {formatMoney(product.precio * item.cantidad)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => removeFromCart(item.sku)}
                        >
                          Quitar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="cart-total">Total: {formatMoney(total)}</p>
          <div className="actions-right">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleBuy}
              disabled={buying || !store}
            >
              {buying ? "Procesando…" : "Comprar"}
            </button>
          </div>
        </>
      )}

      {error && <p className="error-msg">{error}</p>}

      {ticket && (
        <div className="ticket">
          <h3>Compra exitosa — Ticket {ticket.ticket_id}</h3>
          <p className="muted">
            Tienda: {ticket.tienda} · Fecha: {ticket.fecha}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Precio unitario</th>
                  <th className="num">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {ticket.lineas.map((linea) => (
                  <tr key={linea.sku}>
                    <td className="mono">{linea.sku}</td>
                    <td>{linea.nombre}</td>
                    <td className="num">{linea.cantidad}</td>
                    <td className="num">{formatMoney(linea.precio_unitario)}</td>
                    <td className="num">{formatMoney(linea.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cart-total">Total pagado: {formatMoney(ticket.total)}</p>
        </div>
      )}
    </section>
  );
}

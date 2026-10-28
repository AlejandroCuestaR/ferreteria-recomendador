"use client";

import { useState, type FormEvent } from "react";
import {
  createProduct,
  deleteProduct,
  getErrorMessage,
  updateProduct,
  type Product,
} from "@/lib/api";
import { formatMoney } from "@/lib/format";

interface InventoryTabProps {
  products: Product[];
  onRefresh: () => Promise<void>;
}

type FormMode = "closed" | "create" | "edit";

/** Estado del formulario: los numéricos se capturan como texto y se validan al guardar. */
interface ProductFormState {
  sku: string;
  nombre: string;
  descripcion: string;
  categoria: string;
  material: string;
  uso_recomendado: string;
  precio: string;
  stock: string;
}

const EMPTY_FORM: ProductFormState = {
  sku: "",
  nombre: "",
  descripcion: "",
  categoria: "",
  material: "",
  uso_recomendado: "",
  precio: "",
  stock: "",
};

export default function InventoryTab({ products, onRefresh }: InventoryTabProps) {
  const [mode, setMode] = useState<FormMode>("closed");
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setMode("create");
    setEditingSku(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  function openEdit(product: Product) {
    setMode("edit");
    setEditingSku(product.sku);
    setForm({
      sku: product.sku,
      nombre: product.nombre,
      descripcion: product.descripcion,
      categoria: product.categoria,
      material: product.material,
      uso_recomendado: product.uso_recomendado,
      precio: String(product.precio),
      stock: String(product.stock),
    });
    setFormError(null);
  }

  function closeForm() {
    setMode("closed");
    setEditingSku(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  function updateField(field: keyof ProductFormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const precio = Number.parseFloat(form.precio);
    const stock = Number.parseInt(form.stock, 10);

    if (!form.sku.trim() || !form.nombre.trim()) {
      setFormError("SKU y nombre son obligatorios.");
      return;
    }
    if (Number.isNaN(precio) || precio < 0) {
      setFormError("El precio debe ser un número mayor o igual a 0.");
      return;
    }
    if (Number.isNaN(stock) || stock < 0) {
      setFormError("El stock debe ser un entero mayor o igual a 0.");
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      if (mode === "edit" && editingSku) {
        await updateProduct(editingSku, {
          nombre: form.nombre.trim(),
          descripcion: form.descripcion.trim(),
          categoria: form.categoria.trim(),
          material: form.material.trim(),
          uso_recomendado: form.uso_recomendado.trim(),
          precio,
          stock,
        });
      } else {
        await createProduct({
          sku: form.sku.trim(),
          nombre: form.nombre.trim(),
          descripcion: form.descripcion.trim(),
          categoria: form.categoria.trim(),
          material: form.material.trim(),
          uso_recomendado: form.uso_recomendado.trim(),
          precio,
          stock,
        });
      }
      await onRefresh();
      closeForm();
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(product: Product) {
    const confirmed = window.confirm(
      `¿Eliminar el producto "${product.nombre}" (${product.sku})?`,
    );
    if (!confirmed) return;
    setListError(null);
    try {
      await deleteProduct(product.sku);
      await onRefresh();
    } catch (err) {
      setListError(getErrorMessage(err));
    }
  }

  return (
    <section>
      <div className="section-header">
        <h2>Inventario (compartido entre las 5 tiendas)</h2>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          + Nuevo producto
        </button>
      </div>

      {listError && <p className="error-msg">{listError}</p>}

      {mode !== "closed" && (
        <form className="panel" onSubmit={handleSubmit}>
          <h3>
            {mode === "create"
              ? "Nuevo producto"
              : `Editar producto ${editingSku ?? ""}`}
          </h3>
          <div className="form-grid">
            <label>
              SKU
              <input
                value={form.sku}
                onChange={(e) => updateField("sku", e.target.value)}
                disabled={mode === "edit"}
                required
              />
            </label>
            <label>
              Nombre
              <input
                value={form.nombre}
                onChange={(e) => updateField("nombre", e.target.value)}
                required
              />
            </label>
            <label>
              Categoría
              <input
                value={form.categoria}
                onChange={(e) => updateField("categoria", e.target.value)}
              />
            </label>
            <label>
              Material
              <input
                value={form.material}
                onChange={(e) => updateField("material", e.target.value)}
              />
            </label>
            <label>
              Precio
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.precio}
                onChange={(e) => updateField("precio", e.target.value)}
                required
              />
            </label>
            <label>
              Stock
              <input
                type="number"
                min={0}
                step={1}
                value={form.stock}
                onChange={(e) => updateField("stock", e.target.value)}
                required
              />
            </label>
            <label className="full">
              Uso recomendado
              <input
                value={form.uso_recomendado}
                onChange={(e) => updateField("uso_recomendado", e.target.value)}
              />
            </label>
            <label className="full">
              Descripción
              <textarea
                value={form.descripcion}
                onChange={(e) => updateField("descripcion", e.target.value)}
              />
            </label>
          </div>
          {formError && <p className="error-msg">{formError}</p>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={closeForm}
              disabled={saving}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {products.length === 0 ? (
        <p className="muted">No hay productos registrados.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Nombre</th>
                <th>Categoría</th>
                <th className="num">Precio</th>
                <th className="num">Stock</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.sku}>
                  <td className="mono">{product.sku}</td>
                  <td>{product.nombre}</td>
                  <td>{product.categoria}</td>
                  <td className="num">{formatMoney(product.precio)}</td>
                  <td className="num">{product.stock}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => openEdit(product)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDelete(product)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

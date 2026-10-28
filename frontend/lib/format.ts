/** Helpers de formato para montos y porcentajes (es-MX). */

export function formatMoney(value: number): string {
  return value.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
  });
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

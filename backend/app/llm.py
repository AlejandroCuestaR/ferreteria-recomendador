"""Capa de IA OPCIONAL: explicación en lenguaje natural del combo recomendado.

La prueba sugiere usar APIs gratuitas (NVIDIA, Gemini, Kimi, etc.). Se usa un
cliente compatible con la API de OpenAI (chat/completions), que casi todos esos
proveedores exponen. Todo se configura por variables de entorno:

    LLM_API_KEY   -> clave del proveedor (si falta, se usa una plantilla local)
    LLM_BASE_URL  -> p. ej. https://integrate.api.nvidia.com/v1
    LLM_MODEL     -> p. ej. meta/llama-3.1-8b-instruct

DISEÑO IMPORTANTE: si no hay API key, el sistema NO se rompe; genera una
explicación por plantilla a partir de los mismos datos. Así el proyecto
arranca sin configurar nada, y la IA es un plus que se activa con una env var.
"""
import os
import time

import httpx


def is_enabled() -> bool:
    return bool(os.getenv("LLM_API_KEY"))


def _template(seed_nombre: str, recomendados: list) -> str:
    if not recomendados:
        return f"No hay complementos con existencia para «{seed_nombre}» ahora mismo."
    nombres = ", ".join(r["nombre"] for r in recomendados[:3])
    return (
        f"Quien lleva «{seed_nombre}» suele completar el trabajo con: {nombres}. "
        "Ofrécelos en caja para subir el ticket promedio."
    )


def explain(seed_nombre: str, recomendados: list) -> dict:
    """Devuelve {'texto': str, 'fuente': str}. Nunca lanza excepción."""
    key = os.getenv("LLM_API_KEY")
    if not key:
        return {"texto": _template(seed_nombre, recomendados), "fuente": "plantilla"}

    base = os.getenv("LLM_BASE_URL", "https://integrate.api.nvidia.com/v1")
    model = os.getenv("LLM_MODEL", "meta/llama-3.1-8b-instruct")
    lista = "; ".join(
        f"{r['nombre']} (categoría {r['categoria']})" for r in recomendados[:5]
    )
    prompt = (
        "Eres un vendedor experto de una ferretería. En UNA sola frase breve y "
        "en español, explica al cajero por qué conviene ofrecer estos productos "
        f"a quien compra «{seed_nombre}». Productos sugeridos: {lista}. "
        "No inventes productos fuera de la lista."
    )
    # Hasta 3 intentos: los proveedores gratuitos devuelven 429/503 por picos
    # de demanda. Si aun así falla, se degrada a la plantilla local.
    ultimo_error = "desconocido"
    for intento in range(3):
        try:
            resp = httpx.post(
                f"{base}/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.4,
                    "max_tokens": 160,
                },
                timeout=25.0,
            )
            if resp.status_code in (429, 500, 502, 503, 504):
                ultimo_error = f"HTTP {resp.status_code}"
                time.sleep(1.5)
                continue
            resp.raise_for_status()
            texto = resp.json()["choices"][0]["message"]["content"].strip()
            return {"texto": texto, "fuente": model}
        except Exception as exc:  # red/timeout/parseo: reintentar o degradar
            ultimo_error = exc.__class__.__name__
            time.sleep(1.0)
    return {
        "texto": _template(seed_nombre, recomendados),
        "fuente": f"plantilla (LLM no disponible: {ultimo_error})",
    }

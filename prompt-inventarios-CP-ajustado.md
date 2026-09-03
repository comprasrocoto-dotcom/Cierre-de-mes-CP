# PROMPT AJUSTADO — MODELO DE INVENTARIOS Y RENTABILIDAD DEL CENTRO DE PRODUCCIÓN
### (Escalado a los datos que realmente existen hoy: sin mano de obra, sin costos indirectos por concepto)

Actúa como un **experto en costos de alimentos y bebidas, inventarios, contabilidad de costos, producción gastronómica y control financiero para cadenas de restaurantes**.

Tengo un **Centro de Producción (CP)** que abastece a dos marcas: **San Agustín** y **Rocoto**. Necesito un modelo para el juego de inventarios del CP, consumo real, faltantes/sobrantes, costo de producción y reparto entre marcas — **construido exclusivamente con las fuentes de datos que ya tengo**, sin inventar categorías que no existen en mi información.

---

## FUENTES DE DATOS REALES (esto es todo lo que hay — no asumas nada más)

| Pestaña | Qué trae | Qué NO trae |
|---|---|---|
| **Compras** | Marca (derivada de Almacén), Fecha, Proveedor, Familia, Artículo, Uds., Valor Unitario, Total Neto | Ningún desglose de mano de obra ni de costos indirectos |
| **Fabricacion** | Marca, Fecha, Código (SUB###), Producto fabricado (Artifabri), Unidad, Cantidad (Variación Stock), Coste Unitario, Coste Variación (costo total) | Receta estándar / BOM (no hay desglose de qué insumo y cuánto lleva cada fabricación) |
| **Traslados** | Marca, Fecha, Sede destino, Artículo, Unidad, Cantidad, Coste, Coste Variación | — |
| **Inv Final** | Marca, Mes, Almacén, Artículo, Unidad, Stock a Fecha, Stock Inventario, Total (valorizado) | Conteo físico independiente del sistema (es el inventario que reporta el ERP, no una auditoría física separada) |
| **Base_Conversion** | Código, Artículo, Unidad, factor de conversión a kilos | Cobertura parcial: ~20% de las referencias de Fabricación no tienen código de conversión |
| **Costos_Compartidos_CP** | Fecha, N° Factura, Marca, Proveedor, Motivo, Total | **Sin desglose por concepto** (no distingue nómina de servicios de mantenimiento) — es un solo total por factura |

**No existe en ninguna fuente:** mano de obra directa, horas de producción, horas máquina, capacidad máxima de la planta, costos indirectos discriminados por concepto (gas, energía, arriendo, depreciación), inventario de producto en proceso, tabla de bajas separada, ni precio de proveedor externo para comparar "fabricar vs. comprar".

**Regla de oro para este modelo: si un cálculo necesita un dato que no está en la tabla de arriba, el modelo debe decirlo explícitamente en vez de estimarlo o inventarlo.**

---

## OBJETIVO PRINCIPAL

**¿Cuánto cuesta operar el Centro de Producción y cuánto cuesta producir cada sub-receta, usando solo insumos (materia prima + costos compartidos sin discriminar), sin mano de obra ni costos indirectos por concepto?**

Además:

* Si existen faltantes o sobrantes de inventario, por producto.
* Si el inventario que predice el propio movimiento del CP coincide con el que reporta el ERP.
* Cuánto cuesta cada fabricación y cada kilogramo/unidad producida.
* Cuánto producto quedó en inventario vs. cuánto fue trasladado.
* Cuánto costo le corresponde a cada marca — repartido por su participación real en kilos fabricados, no 50/50.
* Qué productos rotan más y cuáles menos, medido por lo que realmente se traslada a los puntos de venta.

---

## PRINCIPIO IMPORTANTE (se mantiene del prompt original)

No usar solo `Inventario inicial + Compras − Inventario final = Costo`, porque esconde faltantes y sobrantes.

### Consumo / movimiento real disponible

Con los datos que hay, el "consumo real" del CP para un producto en un mes se arma así:

```
Final Esperado = Inicial (Inv Final del mes anterior)
               + Fabricado (Fabricacion del mes)
               − Trasladado (Traslados del mes)
```

Comparado contra:

```
Final Real = Inv Final del mes actual
```

```
Variación = Final Real − Final Esperado
```

**Esto YA está construido** (es el Kardex por producto del dashboard). Aplica solo a sub-recetas (artículos que empiezan por "SUB.") porque la fórmula asume que "Fabricado" es una entrada al producto — cierto para una sub-receta terminada, falso para un insumo (que se consume, no se fabrica). Por eso el modelo debe **excluir insumos y materia prima de esta fórmula específica**.

### Lo que NO se puede calcular: consumo teórico por receta

El prompt original pedía comparar consumo real contra un "consumo teórico" derivado de una receta estándar (ej. "cada kg de salsa usa 600g de A, 300g de B..."). **Esa receta/BOM no existe en los datos.** `Fabricacion` registra el producto terminado y su costo total, no el desglose insumo por insumo que se usó para hacerlo.

Si se quiere ese nivel de detalle en el futuro, hace falta una fuente nueva: una tabla de recetas estándar (Código de producto → insumo → cantidad estándar por unidad). Sin eso, el modelo debe limitarse a la comparación de inventario (arriba), no a la comparación receta vs. consumo real.

---

## FALTANTES Y SOBRANTES (semáforo, ya construido)

Sobre la Variación calculada arriba, clasificar por severidad de la desviación (no por si sobra o falta):

* 🟢 **Bien**: |Variación| ≤ 5% del Final Esperado
* 🟡 **Manejable**: entre 5% y 20%
* 🔴 **Muy elevado**: más de 20%

Tolerancias configurables si se quiere ajustar el umbral, pero el diseño base es este.

---

## FABRICACIONES

Con los datos disponibles, cada fila de `Fabricacion` ya da:

* Cantidad real producida (Variación Stock).
* Costo total de esa fabricación (Coste Variación).
* Costo unitario (Coste Unitario).
* Kilos producidos, vía `Base_Conversion` (cuando el código tiene conversión registrada).

**No disponible:** cantidad teórica esperada por receta, rendimiento vs. estándar, merma específica de la etapa de fabricación (solo se ve la merma/faltante a nivel de inventario general, no aislada a "se perdió en el proceso de cocción" vs. "se perdió después").

---

## COSTO DE FABRICACIÓN — solo dos componentes

### 1. Costo directo (materia prima)
Viene de `Fabricacion.Coste Variación` — ya incluye el costo de los insumos consumidos en esa fabricación.

### 2. Costos compartidos del CP (pool único, sin discriminar por concepto)
Viene de `Costos_Compartidos_CP`, repartido entre marcas por **% de participación en kilos fabricados** (Fabricación × Base_Conversion) — no por concepto individual, porque la fuente no distingue nómina de servicios de mantenimiento.

```
Costo total del CP (mes) = Σ Fabricacion.Coste Variación + Σ Costos_Compartidos_CP.Total
```

No hay mano de obra directa ni costos indirectos de fabricación (gas, energía, arriendo, depreciación) como líneas separadas — quedan **fuera del modelo** hasta que exista una fuente de datos que los registre.

---

## COSTO DE PRODUCCIÓN — versión simplificada (sin mano de obra ni CIF, sin producto en proceso)

```
Costo de producción del mes = Materia prima consumida (Fabricacion)
                             + Parte proporcional de Costos_Compartidos_CP asignada por % de kilos
```

No se resta/suma inventario de producto en proceso porque esa etapa no se registra por separado (el CP fabrica y el producto pasa directo a inventario de producto terminado).

```
Costo del producto trasladado = Inventario inicial de producto terminado (Inv Final mes anterior)
                               + Producción terminada (Fabricacion)
                               − Inventario final de producto terminado (Inv Final mes actual)
```

---

## TRASLADOS A LOS RESTAURANTES

Ya disponible en `Traslados`: Marca, Sede destino, Artículo, Cantidad, Costo. Se puede reportar por marca, por sede, por artículo y por mes — sin cambios respecto al prompt original, esta parte sí está completamente cubierta por los datos.

---

## RENTABILIDAD DEL CP — indicadores que sí se pueden calcular

1. **Costo por kilogramo producido** — costo total del CP ÷ kilos fabricados (solo referencias con conversión).
2. **Costo por referencia** — costo real por sub-receta, vía `Fabricacion`.
3. **Inventario esperado vs. real** — el semáforo ya construido, en vez de "costo teórico vs. real" a nivel de receta.
4. **Rotación** — cantidad trasladada a puntos de venta por sub-receta, para ver cuáles se mueven más y cuáles menos (no requiere inventario inicial/final, así que tiene cobertura de datos en casi todos los meses).

**No disponible sin nueva fuente de datos:**
- Utilización de capacidad (no hay capacidad máxima registrada).
- Ahorro frente a comprar externamente (no hay precio de proveedor externo para las sub-recetas). *Si se quiere este indicador, la única forma es que el usuario ingrese manualmente el precio externo de referencia por producto — el modelo no debe inventarlo.*

---

## RENTABILIDAD POR MARCA — un solo driver, no varios

El prompt original proponía un driver distinto por tipo de costo (mano de obra por horas, gas por kg, arriendo por capacidad, etc.). **Sin esos datos, hay un único driver disponible y ya construido:**

```
% San Agustín = kilos fabricados por San Agustín / kilos totales fabricados (del mes)
% Rocoto      = kilos fabricados por Rocoto / kilos totales fabricados (del mes)
```

Aplicado sobre `Costos_Compartidos_CP` completo (no por concepto, porque la fuente no lo permite):

```
Costo compartido de San Agustín = Total Costos_Compartidos_CP del mes × % San Agustín
Costo compartido de Rocoto      = Total Costos_Compartidos_CP del mes × % Rocoto
```

El costo directo de materia prima (`Fabricacion`) ya viene marcado por marca desde el origen — eso no necesita repartirse, es 100% de quien fabricó.

**Pregunta abierta que el modelo debe dejar visible, no resolver solo:** este % se basa únicamente en lo que pasa por Fabricación. Las compras que van directo a una marca sin pasar por una orden de fabricación no pesan en el %, aunque sí son costo real de esa marca. Confirmar con el usuario si el % debe ser solo sobre fabricado o debe ponderar también el volumen bruto que mueve cada marca.

---

## INDICADORES DEL DASHBOARD (ajustado — solo lo calculable)

* Valor de inventario inicial y final (por marca y mes).
* Compras (total y por marca).
* Costo de fabricación (materia prima).
* Costos compartidos del mes y su reparto por marca.
* Producción total y kilos producidos por marca.
* Costo por kilogramo.
* Traslados por marca y por sede.
* Faltantes / sobrantes por producto, con semáforo (🟢🟡🔴).
* Top de proveedores, productos más comprados, productos más fabricados.
* Productos más y menos trasladados (proxy de rotación).

**Se elimina del dashboard original:** bajas (no hay tabla), mermas como categoría aparte (se ve embebida en la variación de inventario, no aislada), utilización de capacidad, ahorro frente a compra externa (a menos que el usuario cargue el precio externo manualmente).

---

## ESTRUCTURA DE DATOS REAL (reemplaza las tablas idealizadas del prompt original)

Seis fuentes, todas dentro de un mismo archivo Google Sheets / XLSX exportado:

1. **Compras** — Marca, Fecha, Almacén, Proveedor, Familia, Artículo, Subartículo, Uds., Valor Unitario, Total Neto.
2. **Fabricacion** — Marca, Fecha, Código, Artículo fabricado, Unidad, Cantidad, Coste Unitario, Coste Variación.
3. **Traslados** — Marca, Fecha, Sede destino, Artículo, Unidad, Cantidad, Coste, Coste Variación.
4. **Inv Final** — Marca, Mes, Almacén, Artículo, Unidad, Stock a Fecha, Stock Inventario, Total.
5. **Base_Conversion** — Código, Artículo, Unidad, factor de conversión a kg.
6. **Costos_Compartidos_CP** — Fecha, N° Factura, Marca, Proveedor, Motivo, Total.

No se proponen tablas nuevas (mano de obra, bajas, costos por concepto) a menos que el usuario decida empezar a registrar esa información — en ese momento este modelo se puede ampliar.

---

## LO QUE DEBE ENTREGAR CLAUDE AL TRABAJAR CON ESTE PROMPT

1. El flujo de inventarios del CP usando solo las 6 fuentes reales.
2. Las fórmulas de arriba (consumo/movimiento real, faltante/sobrante, costo de fabricación, reparto por marca).
3. Un ejemplo con números reales de las fuentes ya cargadas.
4. Qué preguntas dejar abiertas al usuario en vez de asumir (ej. el % de reparto solo-fabricado vs. ponderado).
5. Qué parte del prompt original queda fuera por falta de datos, dicho explícitamente, no omitido en silencio.
6. Los KPI de la lista ajustada de arriba.
7. Semáforos con los umbrales ya definidos (5% / 20%).
8. Errores frecuentes a evitar: no forzar que el inventario cuadre, no inventar un consumo teórico por receta que no existe, no repartir costos compartidos 50/50 por default, no mezclar insumos con sub-recetas en el mismo cálculo de faltante/sobrante.

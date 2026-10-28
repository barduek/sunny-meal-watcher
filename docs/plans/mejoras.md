# Mejoras

Ideas para después del MVP. Complementan la sección "Fuera de alcance del MVP (mejoras futuras)" de [mvp-sol-y-sombras.md](mvp-sol-y-sombras.md).

## Hechas

- **Datasets fuera del repo** y **carga de edificios por zonas o por partes:** Task 10 del plan. Los datos se generan con `npm run fetch:buildings` en `public/data/` (en `.gitignore`), se pueden publicar en otro servidor con `VITE_DATA_BASE_URL`, y la app los baja por zonas según lo que mira el usuario.
- **Sombras sobre techos y fachadas:** Task 11 del plan. La sombra de un edificio alto se ve también sobre el techo o la pared de uno más bajo.

## Pendientes

### Rendimiento y compatibilidad

- **Probar en una GPU real y en celulares.** Todo se verificó en un renderizador por software, que no sirve para medir velocidad. Si en alguna máquina no anda fluido, hay dos palancas: celdas más grandes en el techo de sombra (menos detalle) y menos pasadas.
- **Navegadores sin texturas de punto flotante.** El código ya los detecta y muestra los edificios sin las sombras entre sí, pero ese camino no se probó. Si hace falta cubrirlos, se puede codificar la altura en un formato de 8 bits.

### Sombras

- **Bordes más finos sobre techos y paredes.** Hoy salen hasta ~2 m más gruesos que los exactos por la resolución de la grilla (1,25 m). Se puede afinar con celdas más chicas o ajustando el ensanche del contorno.
- **Sombras de edificios que todavía no se cargaron.** El techo de sombra solo conoce los edificios ya cargados. Al abrir la app, o al mover el mapa rápido, un techo puede verse al sol hasta que llegue el edificio alto que lo tapa. Se corrige solo cuando llegan las zonas, pero se podría pedir también las zonas vecinas hacia el lado del sol.
- **Saber si un lugar concreto recibe sol** (una terraza, una ventana, un local a cierto piso). La función que lo decide ya existe (`isLit` en `src/shadows/shadowCeiling.ts`) y se evaluaría en cada punto de interés. Es la base para la parte de lugares y para calcular las horas de sol de cada uno.

### Datos

- **Publicar los datos en un servidor real.** Hoy está probado con un servidor local en otro puerto. Falta elegir el proveedor (por ejemplo S3 o Cloudflare R2 con CDN), subir `public/data/` ahí y activar CORS. Conviene darle una caché larga a las zonas: la URL lleva la versión de los datos, así que cambia cuando cambian.
- **Generar y subir los datos desde un paso automático** (CI o un script de publicación), en vez de a mano.

### Carga de edificios

- **Descargar zonas lejanas de memoria.** Hoy una zona que se cargó se queda en memoria. Para Palermo (19 MB) alcanza, pero para toda la Ciudad (~1,4 millones de volúmenes) habría que soltar las zonas que quedan lejos de la vista.
- **Cubrir más de una zona o toda la Ciudad.** Con el reparto por zonas ya se puede generar un dataset de cualquier tamaño, pero el techo de sombra usa una textura que cubre toda el área configurada: para áreas grandes, esa textura tendría que seguir a la cámara. Si el área crece mucho, PMTiles sería otra opción.
- **Selector de zonas o barrios,** si se suman más áreas a la app.

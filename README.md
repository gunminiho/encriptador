# Encriptador de Archivos — API v2

Servicio HTTP para **encriptar** y **desencriptar** archivos. Implementado con PayloadCMS (Node.js, TypeScript).  
> **Importante:** Todos los endpoints aceptan **solo** `multipart/form-data`.

---

## Base URL

```
https://crypto.omn.pe/api
```

---

## Autenticación

Enviar el header **exacto**:

```
Authorization: tenants API-Key <API_KEY>
```

- Requerido en **todas** las rutas.
- Si falta o es inválido → `401 Unauthorized`.

---

## Límites y políticas

- **Tamaño máximo por archivo:** **20 MB**
- **Máximo de archivos por request (masivo):** **1000**
- **Tamaño total máximo por request (masivo):** **2 GB**
- **Content-Type de entrada:** `multipart/form-data` (no se acepta `raw`/`binary`)
- **Nombres de archivo:**
  - **Encriptar** → conserva el nombre original y agrega `.enc`
  - **Desencriptar** → remueve `.enc` y conserva el nombre original

### Extensiones bloqueadas

Se rechazan archivos con las siguientes extensiones (o tipo no reconocido):

```
exe, msi, msp, bat, cmd, com, pif, scr, cpl, msc, sh, htm,
js, jse, vbs, vbe, wsf, wsh, hta, ps1, psm1,
py, pyc, rb, pl, php, jar,
dll, so, dylib,
zip, rar, 7z, tar, gz, bz2, apk, app, dmg,
unknown
```

> Si el tipo no se reconoce y no está permitido, se trata como **unknown** y se rechaza.

---

## Criptografía 

- **Algoritmo:** AES-256-GCM  
- **Derivación de clave:** `scrypt`  


---

## Formato de error

Para errores de validación y casos de negocio:

```json
{
  "message": "mensaje de error",
  "data": {
    "error": ["detalle 1", "detalle 2"]
  }
}
```

- **400**: errores de validación o petición inválida  
- **413**: tamaño por archivo, cantidad o tamaño total excedidos  
- **401**: autenticación inválida  
- **500**: error interno

> En encriptación masiva, el servidor **puede** incluir headers adicionales en `Headers`.

---

# Endpoints

## 1) Encriptación individual

**POST** `/encryption_operations/v2/encrypt`

Encripta **un** archivo con una contraseña. Devuelve el archivo `*.enc` por **streaming**.

### Headers
- `Authorization: tenants API-Key <API_KEY>`

### Form-data
| Campo      | Tipo | Requerido | Descripción                        |
|------------|------|-----------|------------------------------------|
| `file`     | File | Sí        | Archivo a encriptar (≤ 20 MB)      |
| `password` | Text | Sí        | Contraseña (string, no vacía)      |

### Respuesta (200)
- `Content-Type: application/octet-stream`
- `Content-Disposition: attachment; filename="<original>.enc"`
- Puede **no** incluir `Content-Length` (transferencia por streaming).

### cURL
```bash
curl -X POST "https://crypto.omn.pe/api/encryption_operations/v2/encrypt"   -H "Authorization: tenants API-Key <API_KEY>"   -F "file=@/ruta/al/archivo.pdf"   -F "password=mi_password"   -o archivo.pdf.enc
```

---

## 2) Desencriptación individual

**POST** `/encryption_operations/v2/decrypt`

Desencripta **un** archivo `*.enc` con su contraseña. Devuelve el archivo original por **streaming**.

### Headers
- `Authorization: tenants API-Key <API_KEY>`

### Form-data
| Campo      | Tipo | Requerido | Descripción                      |
|------------|------|-----------|----------------------------------|
| `file`     | File | Sí        | Archivo cifrado `*.enc` (≤ 20 MB)|
| `password` | Text | Sí        | Contraseña (string, no vacía)    |

### Respuesta (200)
- `Content-Type: application/octet-stream`
- `Content-Disposition: attachment; filename="<original>"`
- Puede **no** incluir `Content-Length`.

> **Errores típicos (400):** `Contraseña incorrecta o archivo cifrado inválido` cuando el GCM no autentica.

### cURL
```bash
curl -X POST "https://crypto.omn.pe/api/encryption_operations/v2/decrypt"   -H "Authorization: tenants API-Key <API_KEY>"   -F "file=@/ruta/al/archivo.pdf.enc"   -F "password=mi_password"   -o archivo.pdf
```

---

## 3) Encriptación masiva (ZIP por streaming)

**POST** `/encryption_operations/v2/massive-encrypt`

Encripta **múltiples** archivos en una sola petición. Cada archivo se cifra por separado (AES-256-GCM) y se entrega **dentro de un ZIP** generado por streaming.

### Reglas
- Requiere **≥ 2** archivos.
- **Máximo:** 1000 archivos y **2 GB** totales.
- **Cada** archivo ≤ **20 MB**.
- Proporcionar contraseñas vía CSV (`passwords`) o una única contraseña (`password`) si se sube **un** archivo.
- Si se encuentra el archivo en el envío y también se encuentra declarado en el .csv pero no hay contraseña declarada en el csv, **se omitirá la encriptación.**

### Headers
- `Authorization: tenants API-Key <API_KEY>`

### Form-data
| Campo        | Tipo   | Requerido | Descripción |
|--------------|--------|-----------|-------------|
| `file`       | File[] | Sí        | Múltiples archivos a encriptar. Cada uno ≤ 20 MB. |
| `passwords`  | File   | Sí*       | CSV con columnas `file_name,password`. Requerido **≥ 2** archivos. |


**CSV `passwords`**  
- Codificación: UTF-8  
- Primera línea: **cabecera**  
- Columnas: `file_name,password`  
- Delimitador:  **;**  o  **,**
- El `file_name` debe coincidir con el nombre real subido ( se normaliza quitando rutas/`fakepath`, trim, minúsculas,etc ).

**Ejemplo de CSV:**
```csv
file_name,password
reporte.pdf,Alpha#2025
imagen1.png,Beta!2025
imagen2.png,Beta!2024
imagen3.jpg,Alfa!2023
```

### Respuesta (200)
- `Content-Type: application/zip`
- `Content-Disposition: attachment; filename="encrypted_bundle.zip"`
- ZIP por streaming (normalmente **sin** `Content-Length`).

### cURL
```bash
curl -X POST "https://crypto.omn.pe/api/encryption_operations/v2/massive-encrypt"   -H "Authorization: tenants API-Key <API_KEY>"   -F "file=@/ruta/reporte.pdf"   -F "file=@/ruta/imagen.png"   -F "passwords=@/ruta/passwords.csv;type=text/csv"   -o encrypted_bundle.zip
```

---

## Códigos de estado

| Código | Cuándo                                                                  |
|-------:|-------------------------------------------------------------------------|
| **200** | Descarga del archivo encriptado/desencriptado o ZIP (streaming).        |
| **400** | Validación fallida (campos faltantes, contraseña vacía, CSV inválido, tipo no permitido, etc.). También puede usarse cuando se exceden límites, según el caso. |
| **413** | Tamaño por archivo, cantidad de archivos, o tamaño total **excedidos**. |
| **401** | Falta/invalidación del header de autenticación.                         |
| **500** | Error interno.                                                          |

**Ejemplo de error 400**
```json
{
  "message": "Error en la validación de la solicitud",
  "data": {
    "error": [
      "No se detectó password para encriptar",
      "El tipo de archivo .exe no está permitido"
    ]
  }
}
```

**Ejemplo de error 413**
```json
{
  "message": "Límites excedidos",
  "data": {
    "error": [
      "Archivo reporte.pdf excede el tamaño máximo de 20MB",
      "Tamaño total 2.1GB supera el máximo de 2GB"
    ]
  }
}
```

---

## Notas operativas

- **Streaming**: el servidor transmite la respuesta a medida que procesa; algunos clientes no verán `Content-Length`.
- **No almacenamiento**: el servicio no persiste los archivos; solo procesa y devuelve el resultado.
- **Trazabilidad**: cada operación se registra.

---

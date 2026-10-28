/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL base de los datos de edificios, si están en otro servidor (ver `src/dataUrl.ts`). */
  readonly VITE_DATA_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

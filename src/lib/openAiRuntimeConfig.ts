export const OPENAI_PROXY_URL = import.meta.env.VITE_OPENAI_PROXY_URL?.trim() || undefined

/**
 * Same-origin endpoint that returns the shared proxy token at runtime. Only
 * relevant when the Node proxy is in use (Docker / `npm start`); static
 * deployments talk to the model API directly and do not need it.
 */
export const OPENAI_PROXY_TOKEN_URL = OPENAI_PROXY_URL
  ? import.meta.env.VITE_OPENAI_PROXY_TOKEN_URL?.trim() || '/api/proxy-token'
  : undefined

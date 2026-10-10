/** Builder settings for this environment, read on the server. */
export function builderConfig() {
  const value = (name: string, fallback?: string) => {
    const v = process.env[name] ?? fallback;
    if (!v) throw new Error(`${name} must be set`);
    return v;
  };
  return {
    contentApiUrl: value("BUILDER_CONTENT_API_URL", "http://localhost:4000"),
    deliveryUrl: value("BUILDER_DELIVERY_URL", "http://localhost:4001"),
    deliveryKey: value("BUILDER_DELIVERY_KEY"),
    siteId: value("BUILDER_SITE_ID", "st_demo"),
    env: value("BUILDER_ENV", "dev"),
    locale: value("BUILDER_LOCALE", "en"),
    editorOrigin: value("BUILDER_EDITOR_ORIGIN", "http://localhost:5173"),
  };
}

# Keycloak for the builder: an optimized build for Postgres with the builder
# realm imported on first start. Build from this directory:
#   docker build -t builder-keycloak infra/keycloak
#
# Runtime settings (environment):
#   KC_DB_URL, KC_DB_USERNAME, KC_DB_PASSWORD   Postgres for Keycloak's own data
#   KC_HOSTNAME                                 public URL, e.g. https://auth.example.com
#   KC_BOOTSTRAP_ADMIN_USERNAME/PASSWORD        first admin of the master realm
#   KC_PROXY_HEADERS=xforwarded                 behind an ingress that terminates TLS
#   KC_HTTP_ENABLED=true                        plain HTTP inside the cluster
#   BUILDER_EDITOR_URL                          the editor's URL (redirect URIs, web origins)
#   BUILDER_SMTP_HOST/PORT/FROM/AUTH/USER/PASSWORD/STARTTLS   email for verification and resets
# Health: :9000/health/ready and /health/live. Metrics: :9000/metrics.

FROM keycloak/keycloak:26.7.5 AS build
ENV KC_DB=postgres KC_HEALTH_ENABLED=true KC_METRICS_ENABLED=true
RUN /opt/keycloak/bin/kc.sh build

FROM keycloak/keycloak:26.7.5
COPY --from=build /opt/keycloak/ /opt/keycloak/
# Imported once; later starts keep the realm as edited in the admin console.
COPY realm/ /opt/keycloak/data/import/
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized", "--import-realm"]

# GitLab CI

The repository runs CI on self-hosted GitLab (`.gitlab-ci.yml`). Images go to Harbor.

| Job | Image | What it does |
| --- | --- | --- |
| `check` | `node:22-bookworm` + Postgres service | Lint, typecheck, unit and integration tests, build |
| `images: [<name>]` | `docker` + `docker:dind` | Builds one deployable, migrates a fresh database from it (service images), starts it and checks it answers, then pushes it |
| `e2e` | Playwright image + Postgres and Keycloak services | Playwright suite; Keycloak runs from the image `images` just pushed |

`check` and `images` start together; `e2e` waits only for the Keycloak image. Pipelines run for
merge requests, branches without an open merge request, and tags.

## Images and tags

Every image is pushed as `$HARBOR_HOST/$HARBOR_PROJECT/<name>:<commit sha>`, only after it
started and answered. The default branch also gets `:main` (the branch's name), and a git tag gets
the same tag. The build cache lives next to each image as `:buildcache`.

Names: `content-api`, `delivery-api`, `worker`, `sample-host`, `editor`, `keycloak`. Deploy by
commit sha; `docs/kubernetes.md` is the contract each image offers.

## Setup

### Runner

- Docker executor with `privileged = true` (the `images` job runs Docker in Docker).
- The runner pulls the Keycloak image for `e2e` from Harbor, so it needs Harbor credentials:
  set the CI/CD variable `DOCKER_AUTH_CONFIG` (below), or give the runner host a Docker login.
- Docker Hub and `mcr.microsoft.com` must be reachable, or mirrored (base images, Postgres,
  Docker, Playwright).
- Two cores and 4 GB of memory per job is enough; `e2e` runs six processes and Chromium.

### CI/CD variables (project settings)

| Variable | Example | Notes |
| --- | --- | --- |
| `HARBOR_HOST` | `harbor.example.com` | No scheme |
| `HARBOR_PROJECT` | `builder` | The project must exist |
| `HARBOR_USER` | `robot$builder+ci` | A robot account with push and pull on the project |
| `HARBOR_PASSWORD` | | Masked |
| `DOCKER_AUTH_CONFIG` | `{"auths":{"harbor.example.com":{"auth":"<base64 user:password>"}}}` | Masked; lets the runner pull the Keycloak service image |

Every pipeline pushes, so leave these variables unprotected, or merge request pipelines on
unprotected branches fail at login.

### Harbor with a private certificate

If Harbor's certificate is not from a public CA, Docker in Docker and BuildKit must trust it:
mount the CA into the dind service through the runner's config
(`/etc/docker/certs.d/<harbor host>/ca.crt`), and the runner host must trust it to pull service
images.

## Tool versions

Pinned at the top of `.gitlab-ci.yml`: `NODE_IMAGE`, `POSTGRES_IMAGE`, `DOCKER_VERSION`. The
Playwright image tag must match `@playwright/test` in `e2e/package.json`; bump both together.

## How e2e reaches Keycloak

The browser, the Content API and the issuer in Keycloak's tokens must agree on one URL, and the
suite uses `http://localhost:8080`. A GitLab service is reachable only by its alias, so the job
forwards `localhost:8080` to `keycloak:8080` (`scripts/ci/forward-port.mjs`) before the tests.

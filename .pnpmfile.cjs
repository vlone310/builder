// Peer dependencies that would otherwise split or bloat the install:
// - drizzle-orm's optional kysely peer: better-auth brings kysely along, and the
//   resolved peer gives drizzle-orm a second copy whose types do not mix with
//   the one @builder/db uses.
// - better-auth's optional framework peers (next, react, vitest, prisma, …):
//   the Content API uses only its Drizzle adapter.
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === "drizzle-orm") {
        delete pkg.peerDependencies?.kysely;
        delete pkg.peerDependenciesMeta?.kysely;
      }
      if (pkg.name === "better-auth" && pkg.peerDependencies) {
        for (const name of Object.keys(pkg.peerDependencies)) {
          if (name !== "drizzle-orm") {
            delete pkg.peerDependencies[name];
            delete pkg.peerDependenciesMeta?.[name];
          }
        }
      }
      return pkg;
    },
  },
};

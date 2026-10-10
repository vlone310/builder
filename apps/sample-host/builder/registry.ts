import { createRegistry } from "@builder/core";
import { coreLibrary } from "./components/core";
import { igamingLibrary } from "./components/igaming";

export const registry = createRegistry(coreLibrary, igamingLibrary);

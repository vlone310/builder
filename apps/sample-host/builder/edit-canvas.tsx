"use client";

import { EditCanvas } from "@builder/react/edit";
import { registry } from "./registry";

/** Client entry for edit mode; only the edit route loads this chunk. */
export function HostEditCanvas(props: { editorOrigin: string; editToken: string }) {
  return <EditCanvas registry={registry} endpoint="/builder-edit/api" {...props} />;
}
